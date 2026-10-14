import { settingsSection } from "./flows";
import { test, expect, type Page } from "./fixtures";
import { resolve } from "node:path";

async function records(page: Page, table: string) {
  return page.evaluate(
    (name) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(name, "readonly");
          const items = transaction.objectStore(name).getAll();
          items.onerror = () => {
            database.close();
            reject(items.error);
          };
          items.onsuccess = () => {
            database.close();
            resolve(items.result as Record<string, unknown>[]);
          };
        };
      }),
    table,
  );
}
async function openImport(page: Page) {
  await page.goto("/#/import");
  await expect(
    page.getByRole("heading", { name: "Import statements", exact: true }),
  ).toBeVisible();
}
async function confirm(page: Page) {
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
}
async function expandFirst(page: Page) {
  const card = page.locator(".import-statement-card").first();
  await expect(card).toBeVisible();
  if (!(await card.evaluate((element) => (element as HTMLDetailsElement).open)))
    await card.locator(":scope > summary").click();
  return card;
}

test("custom CSV maps columns once, imports locally, and returns directly to Home", async ({
  page,
}) => {
  await openImport(page);
  const requests: { url: string; method: string; body: string | null }[] = [];
  page.on("request", (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData(),
    }),
  );
  await page.getByLabel("Select statements").setInputFiles({
    name: "fictional.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Date,Description,Amount,Balance\n01/09/2026,FICTITIOUS SALARY,2500.00,2600.00\n02/09/2026,FICTITIOUS SHOP,-45.00,2555.00\n03/09/2026,FICTITIOUS WATER,-10.00,2545.00",
    ),
  });
  await page
    .getByRole("combobox", { name: "CSV Bank", exact: true })
    .selectOption("Barclays");
  await page
    .getByLabel("CSV Account name", { exact: true })
    .fill("Fictitious current account");
  await page.getByLabel("CSV Account digits", { exact: true }).fill("4321");
  await page
    .getByRole("button", { name: "Check this export", exact: true })
    .click();
  const card = await expandFirst(page);
  await expect(
    card.getByText("✓ Statement reconciled", { exact: true }),
  ).toBeVisible();
  await expect(card).toContainText("CSV export");
  await expect(page.locator(".import-outcome-footer")).toContainText("3 new");
  await confirm(page);
  const imported = await records(page, "transactions");
  expect(imported).toHaveLength(3);
  expect(imported.every((item) => item.source === "csv")).toBe(true);
  expect(
    (await records(page, "settings")).some((setting) =>
      String(setting.key).startsWith("csv-mapping:"),
    ),
  ).toBe(true);
  expect(
    requests.filter(
      (request) => new URL(request.url).origin !== new URL(page.url()).origin,
    ),
  ).toEqual([]);
  expect(
    requests.every(
      (request) => request.method === "GET" && request.body === null,
    ),
  ).toBe(true);
});

test("QFX and Barclays CSV share one account in a sequential batch", async ({
  page,
}) => {
  await openImport(page);
  const qfx =
    "<OFX><FI><ORG>BARCLAYS</ORG></FI><STMTTRS><CURDEF>GBP<BANKACCTFROM><ACCTID>12344321<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST><DTSTART>20260901<DTEND>20260902<STMTTRN><DTPOSTED>20260902<TRNAMT>-10.00<FITID>fictitious-qfx-1<NAME>FICTITIOUS FIRST</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>90.00<DTASOF>20260902</LEDGERBAL></STMTTRS></OFX>";
  await page.getByLabel("Select statements").setInputFiles([
    {
      name: "fictitious.qfx",
      mimeType: "application/x-ofx",
      buffer: Buffer.from(qfx),
    },
    {
      name: "barclays.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Date,Description,Money out,Money in,Balance\n03/09/2026,FICTITIOUS SECOND,5.00,,85.00",
      ),
    },
  ]);
  await expect(page.locator(".import-statement-card")).toHaveCount(2);
  await expect(page.locator(".import-outcome-footer")).toContainText("2 new");
  await confirm(page);
  expect(await records(page, "accounts")).toHaveLength(1);
  const statements = await records(page, "statements");
  expect(
    statements.map((statement) => statement.extractionMethod).sort(),
  ).toEqual(["CSV", "OFX"]);
  expect(await records(page, "transactions")).toHaveLength(2);
});

test("a PDF and its CSV export never double count identical rows", async ({
  page,
}) => {
  await openImport(page);
  await page
    .getByLabel("Select statements")
    .setInputFiles(resolve("tests/fixtures/barclays-drag.pdf"));
  await expect(page.locator(".import-outcome-footer")).toContainText("3 new");
  await confirm(page);
  await openImport(page);
  await page.getByLabel("Select statements").setInputFiles({
    name: "barclays.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Date,Description,Money out,Money in,Balance\n02/09/2026,FICTIONAL WATER,10.00,,990.00\n03/09/2026,CITY LEISURE MEMBERSHIP,20.00,,970.00\n04/09/2026,UNKNOWN MERCHANT,30.00,,940.00",
    ),
  });
  await expect(page.locator(".import-outcome-footer")).toContainText(
    "0 new · 3 duplicates skipped",
  );
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toHaveCount(0);
  expect(await records(page, "transactions")).toHaveLength(3);
});

test("QIF uses an explicit account and remains unverified without balances", async ({
  page,
}) => {
  await openImport(page);
  await page
    .getByLabel("Select statements")
    .setInputFiles(resolve("tests/fixtures/barclays-drag.pdf"));
  await expect(page.locator(".import-outcome-footer")).toContainText("3 new");
  await confirm(page);
  await openImport(page);
  await page.getByLabel("Select statements").setInputFiles({
    name: "fictional.qif",
    mimeType: "application/qif",
    buffer: Buffer.from(
      "!Type:Bank\nD09/10/2026\nT-15.00\nPFICTITIOUS QIF PURCHASE\n^\n",
    ),
  });
  const card = await expandFirst(page);
  await card
    .getByRole("combobox", { name: "Bank", exact: true })
    .selectOption("Barclays");
  const account = (await records(page, "accounts"))[0];
  await card
    .getByRole("combobox", { name: "Account", exact: true })
    .selectOption(String(account.id));
  await card
    .getByRole("combobox", { name: "QIF date format", exact: true })
    .selectOption("month-first");
  await card.getByRole("button", { name: "Parse again", exact: true }).click();
  await expect(page.locator(".import-outcome-footer")).toContainText("1 new");
  await expandFirst(page);
  await expect(
    card.getByText("File has no balances", { exact: true }),
  ).toBeVisible();
  await confirm(page);
  const imported = (await records(page, "transactions")).filter(
    (item) => item.source === "qif",
  );
  expect(imported).toHaveLength(1);
  expect(imported[0].amount).toBe(-1500);
  const statement = (await records(page, "statements")).find(
    (item) => item.extractionMethod === "QIF",
  );
  expect(statement?.validationStatus).toBe("unavailable");
});

test("a card repayment is confirmed in import review and linked atomically with its counterpart", async ({
  page,
}) => {
  await openImport(page);
  const current =
    "<OFX><FI><ORG>BARCLAYS</ORG></FI><STMTTRS><CURDEF>GBP<ACCTID>12344321<ACCTTYPE>CHECKING<BANKTRANLIST><DTSTART>20260901<DTEND>20260930<STMTTRN><DTPOSTED>20260910<TRNAMT>-950.00<FITID>demo-card-debit<NAME>PAYMENT TO AMEX</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>50.00<DTASOF>20260930</LEDGERBAL></STMTTRS></OFX>";
  const card =
    "<OFX><FI><ORG>AMEX</ORG></FI><CCSTMTRS><CURDEF>GBP<ACCTID>99991008<BANKTRANLIST><DTSTART>20260901<DTEND>20260930<STMTTRN><DTPOSTED>20260912<TRNAMT>950.00<FITID>demo-card-credit<NAME>BARCLAYS PAYMENT THANK YOU</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>-50.00<DTASOF>20260930</LEDGERBAL></CCSTMTRS></OFX>";
  await page.getByLabel("Select statements").setInputFiles([
    {
      name: "demo-current.ofx",
      mimeType: "application/x-ofx",
      buffer: Buffer.from(current),
    },
    {
      name: "demo-card.ofx",
      mimeType: "application/x-ofx",
      buffer: Buffer.from(card),
    },
  ]);
  const review = page.getByRole("region", {
    name: "Confirm internal transfers",
  });
  await expect(review).toBeVisible();
  const confirmation = review.getByRole("checkbox", {
    name: /Confirm Barclays to American Express/,
  });
  await expect(confirmation).not.toBeChecked();
  expect(await records(page, "transactions")).toHaveLength(0);
  await confirmation.check();
  await confirm(page);
  const imported = await records(page, "transactions");
  expect(imported).toHaveLength(2);
  expect(
    imported.every(
      (row) => row.type === "transfer" && row.kind === "card_repayment",
    ),
  ).toBe(true);
  expect(imported[0].transferPairId).toBe(imported[1].transferPairId);
  expect(await records(page, "transferLinks")).toHaveLength(1);
  const changes = await records(page, "changeLog");
  const committed = changes.find(
    (change) => change.label === "Import demo-card.ofx",
  );
  const changedRows = (
    committed!.changes as { table: string; after?: { type?: string } }[]
  ).filter(
    (change) =>
      change.table === "transactions" && change.after?.type === "transfer",
  );
  expect(changedRows).toHaveLength(2);
});

for (const leaveUnlinked of [false, true]) {
  test(`Automatic import review ${leaveUnlinked ? "remembers an unchecked pair" : "shows planned pairs and reports actual links after saving"}`, async ({
    page,
  }) => {
    await settingsSection(page, "transfers");
    const matching = page.getByRole("combobox", {
      name: "Transfer matching",
      exact: true,
    });
    await matching.selectOption("automatic");
    await expect(matching).toHaveValue("automatic");
    await openImport(page);
    const current =
      "<OFX><FI><ORG>BARCLAYS</ORG></FI><STMTTRS><CURDEF>GBP<ACCTID>12344321<ACCTTYPE>CHECKING<BANKTRANLIST><DTSTART>20260901<DTEND>20260930<STMTTRN><DTPOSTED>20260910<TRNAMT>-950.00<FITID>automatic-debit<NAME>PAYMENT TO AMEX</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>50.00<DTASOF>20260930</LEDGERBAL></STMTTRS></OFX>";
    const card =
      "<OFX><FI><ORG>AMEX</ORG></FI><CCSTMTRS><CURDEF>GBP<ACCTID>99991008<BANKTRANLIST><DTSTART>20260901<DTEND>20260930<STMTTRN><DTPOSTED>20260912<TRNAMT>950.00<FITID>automatic-credit<NAME>BARCLAYS PAYMENT THANK YOU</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>-50.00<DTASOF>20260930</LEDGERBAL></CCSTMTRS></OFX>";
    await page.getByLabel("Select statements").setInputFiles([
      {
        name: "automatic-current.ofx",
        mimeType: "application/x-ofx",
        buffer: Buffer.from(current),
      },
      {
        name: "automatic-card.ofx",
        mimeType: "application/x-ofx",
        buffer: Buffer.from(card),
      },
    ]);
    const review = page.getByRole("region", {
      name: "Confirm internal transfers",
    });
    await expect(review).toContainText("1 pair will link automatically");
    expect(await records(page, "transferLinks")).toHaveLength(0);
    await review.getByRole("button", { name: "Review", exact: true }).click();
    const link = review.getByRole("checkbox", {
      name: /Link automatically Barclays to American Express/,
    });
    await expect(link).toBeChecked();
    await expect(review).toContainText("£950.00");
    if (leaveUnlinked) {
      await link.uncheck();
      await expect(review).toContainText("0 pairs will link automatically");
      await expect(review).toContainText("left unlinked");
    }
    await confirm(page);
    const imported = await records(page, "transactions");
    expect(imported).toHaveLength(2);
    expect(imported.every((row) => row.isTransfer)).toBe(!leaveUnlinked);
    const links = await records(page, "transferLinks");
    expect(links).toHaveLength(leaveUnlinked ? 0 : 1);
    if (leaveUnlinked) {
      expect((await records(page, "transferProposals"))[0].status).toBe(
        "rejected",
      );
      await page.reload();
      expect(await records(page, "transferLinks")).toHaveLength(0);
    } else {
      expect(links[0].manual).toBe(false);
      await expect(page.locator(".import-result")).toContainText(
        "1 pair linked automatically",
      );
      await page.getByRole("link", { name: "Review linked transfers" }).click();
      await expect(
        page.getByRole("heading", { name: "Transactions", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".transaction-row")).toHaveCount(2);
    }
  });
}
