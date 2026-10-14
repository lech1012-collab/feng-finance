import { resolve } from "node:path";
import { test, expect, type Page } from "./fixtures";

const fixture = (name: string) =>
  resolve(`tests/fixtures/known-bank-${name}.pdf`);
const readingOptionsSelector =
  'details.generic-parser-details:has(> summary:text-is("Reading details"))';

interface StoredTransaction {
  statementId: string;
  amount: number;
  date: string;
  bookingDate?: string;
  description: string;
  type: string;
  isTransfer: boolean;
  sourcePage: number;
  parseRowId?: string;
  parseSource?: string;
  checkLevel?: string;
  categoryId?: string;
}
interface StoredStatement {
  id: string;
  sourceFilename: string;
  institution: string;
  openingBalance?: number;
  closingBalance?: number;
  transactionCount: number;
  validationStatus: string;
  validationDifference?: number;
  validationPolicy?: string;
  parserMethod?: string;
  bankProfileId?: string;
  periodSource?: string;
  warnings: string[];
}

async function records(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        transactions: StoredTransaction[];
        statements: StoredStatement[];
        accounts: Array<{ accountType: string; institution: string }>;
      }>((resolveRecords, reject) => {
        const opening = indexedDB.open("feng-finance");
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const database = opening.result;
          const transaction = database.transaction(
            ["transactions", "statements", "accounts"],
            "readonly",
          );
          const transactions = transaction.objectStore("transactions").getAll();
          const statements = transaction.objectStore("statements").getAll();
          const accounts = transaction.objectStore("accounts").getAll();
          transaction.oncomplete = () => {
            database.close();
            resolveRecords({
              transactions: transactions.result,
              statements: statements.result,
              accounts: accounts.result,
            });
          };
          transaction.onerror = () => {
            database.close();
            reject(transaction.error);
          };
        };
      }),
  );
}

async function select(page: Page, names: string[]) {
  await page.goto("/#/import");
  await page
    .getByLabel("Select statements", { exact: true })
    .setInputFiles(names.map(fixture));
  await expect(page.locator(".import-review-list")).toBeVisible({
    timeout: 120000,
  });
  await expect(page.locator(".import-statement-card")).toHaveCount(
    names.length,
  );
}

async function openCard(page: Page, name: string) {
  const card = page.locator(".import-statement-card").filter({
    has: page.locator(".import-source-name").filter({
      hasText: `known-bank-${name}.pdf`,
    }),
  });
  await expect(card).toHaveCount(1);
  if (!(await card.evaluate((element) => (element as HTMLDetailsElement).open)))
    await card.locator(":scope > summary").click();
  return card;
}

test("recognised digital Barclays, Barclaycard, Amex and Revolut import together with one confirmation", async ({
  page,
}) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const expected = [
    {
      name: "barclays-current",
      institution: "Barclays",
      profile: "barclays-current",
      count: 6,
      opening: 100000,
      closing: 105000,
      moneyIn: 20000,
      moneyOut: 15000,
    },
    {
      name: "barclaycard",
      institution: "Barclays",
      profile: "barclaycard",
      count: 6,
      opening: -90000,
      closing: -10968,
      moneyIn: 90500,
      moneyOut: 11468,
    },
    {
      name: "amex",
      institution: "American Express",
      profile: "amex",
      count: 7,
      opening: -120000,
      closing: -16000,
      moneyIn: 121000,
      moneyOut: 17000,
    },
    {
      name: "revolut",
      institution: "Revolut",
      profile: "revolut",
      count: 6,
      opening: 50000,
      closing: 94000,
      moneyIn: 95000,
      moneyOut: 51000,
    },
  ];
  await select(
    page,
    expected.map((statement) => statement.name),
  );
  for (const statement of expected) {
    const card = await openCard(page, statement.name);
    await expect(
      card.getByRole("heading", {
        name: `${statement.institution} detected`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      card.getByText("✓ Statement reconciled", { exact: true }),
    ).toBeVisible();
    const alternative = card.locator(readingOptionsSelector);
    await expect(alternative).toHaveCount(1);
    await expect(alternative).not.toHaveAttribute("open");
    await expect(
      card.getByRole("region", { name: "Statement reading and checks" }),
    ).toHaveCount(0);
    await expect(
      card.getByLabel(/I compared the extracted rows with the source file/),
    ).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "Accept extracted values" }),
    ).not.toBeVisible();
  }
  const confirm = page.getByRole("button", {
    name: "Confirm import",
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  expect((await records(page)).transactions).toHaveLength(0);
  await confirm.click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  const saved = await records(page);
  expect(saved.statements).toHaveLength(4);
  expect(saved.transactions).toHaveLength(25);
  expect(
    saved.accounts.filter((account) => account.accountType === "credit"),
  ).toHaveLength(2);
  for (const statement of expected) {
    const actual = saved.statements.find(
      (value) => value.sourceFilename === `known-bank-${statement.name}.pdf`,
    );
    expect(actual).toMatchObject({
      institution: statement.institution,
      bankProfileId: statement.profile,
      openingBalance: statement.opening,
      closingBalance: statement.closing,
      transactionCount: statement.count,
      validationStatus: "reconciled",
      validationDifference: 0,
      validationPolicy: "exact-v2.2",
      parserMethod: "text",
      periodSource: "printed",
      warnings: [],
    });
    const rows = saved.transactions.filter(
      (transaction) => transaction.statementId === actual!.id,
    );
    expect(rows).toHaveLength(statement.count);
    expect(
      rows
        .filter((transaction) => transaction.amount > 0)
        .reduce((sum, transaction) => sum + transaction.amount, 0),
    ).toBe(statement.moneyIn);
    expect(
      rows
        .filter((transaction) => transaction.amount < 0)
        .reduce((sum, transaction) => sum - transaction.amount, 0),
    ).toBe(statement.moneyOut);
    expect(
      new Set(rows.map((transaction) => transaction.parseRowId)).size,
    ).toBe(statement.count);
    expect(
      rows.every(
        (transaction) =>
          transaction.parseSource === "text" &&
          ["balance", "total"].includes(transaction.checkLevel ?? ""),
      ),
    ).toBe(true);
  }
  // Inherited dates across a page break preserve all six distinct Barclays rows.
  const current = saved.statements.find(
    (statement) => statement.bankProfileId === "barclays-current",
  )!;
  const currentRows = saved.transactions.filter(
    (transaction) => transaction.statementId === current.id,
  );
  expect(
    currentRows.filter((transaction) => transaction.date === "2026-09-03"),
  ).toHaveLength(5);
  expect(
    currentRows.some(
      (transaction) =>
        transaction.sourcePage === 2 && transaction.amount === -4000,
    ),
  ).toBe(true);
  // Financial validation does not silently assume a payee is an owned account.
  expect(
    saved.transactions.find((transaction) =>
      /To AMERICAN EXP 9999/i.test(transaction.description),
    ),
  ).toMatchObject({ amount: -16000, type: "expense", isTransfer: false });
  expect(errors).toEqual([]);
});

test("an unknown HSBC statement retains the generic source-reading workflow", async ({
  page,
}) => {
  await select(page, ["hsbc"]);
  const card = await openCard(page, "hsbc");
  await expect(
    card.getByRole("heading", { name: "Other detected", exact: true }),
  ).toBeVisible();
  await expect(card.locator(readingOptionsSelector)).toHaveCount(1);
  const proof = card.getByRole("region", {
    name: "Statement reading and checks",
  });
  await expect(proof).toBeVisible();
  await expect(proof).toContainText("Statement figures match exactly");
  const confirm = page.getByRole("button", {
    name: "Confirm import",
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  const saved = await records(page);
  expect(saved.statements).toHaveLength(1);
  expect(saved.statements[0]).toMatchObject({
    institution: "Other",
    openingBalance: 50000,
    closingBalance: 242000,
    validationStatus: "reconciled",
    validationDifference: 0,
    transactionCount: 2,
  });
  expect(saved.statements[0].bankProfileId).toBeUndefined();
  expect(
    saved.transactions.map((transaction) => transaction.amount).sort(),
  ).toEqual([-8000, 200000]);
});

test("a known-bank transaction that contradicts printed balances still requires review", async ({
  page,
}) => {
  test.setTimeout(150000);
  await select(page, ["barclays-malformed"]);
  const card = await openCard(page, "barclays-malformed");
  await expect(
    card.getByRole("heading", { name: "Barclays detected", exact: true }),
  ).toBeVisible();
  await expect(card.locator(readingOptionsSelector)).not.toHaveAttribute(
    "open",
  );
  await expect(card.locator(".validation")).toContainText("£1.00");
  await expect(
    card.getByRole("region", { name: "Statement reading and checks" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  expect((await records(page)).transactions).toHaveLength(0);
  expect((await records(page)).statements).toHaveLength(0);
});

test("a bank-reader source correction opens generic review only on request and rechecks the corrected values", async ({
  page,
}) => {
  test.setTimeout(150000);
  await select(page, ["barclays-malformed"]);
  const card = await openCard(page, "barclays-malformed");
  await card.getByRole("button", { name: /All transactions/ }).click();
  const nativeRow = card
    .locator(".review-row")
    .filter({ hasText: "FICTIONAL GROCER" });
  await nativeRow.locator("summary").click();
  await expect(nativeRow.getByLabel("Date", { exact: true })).toHaveAttribute(
    "readonly",
  );
  await expect(
    nativeRow.getByRole("textbox", { name: /Amount for/ }),
  ).toHaveAttribute("readonly");
  await nativeRow
    .getByLabel("Category", { exact: true })
    .selectOption("shopping");
  const options = card.locator(readingOptionsSelector);
  await options.locator(":scope > summary").click();
  await options
    .getByRole("button", { name: "Review PDF layout", exact: true })
    .click();
  const proof = card.getByRole("region", {
    name: "Statement reading and checks",
  });
  await expect(proof).toBeVisible();
  await expect(proof).toContainText("This statement is not verified yet");
  const row = proof.locator(".generic-review-row").filter({
    has: page.locator("summary strong", { hasText: "FICTIONAL GROCER" }),
  });
  await row
    .getByRole("button", { name: "Correct this row", exact: true })
    .click();
  await row.getByLabel("Amount (GBP)", { exact: true }).fill("-80.00");
  await row
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await expect(proof).toContainText("Statement figures match exactly");
  const confirm = page.getByRole("button", {
    name: "Confirm import",
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  const saved = await records(page);
  expect(
    saved.transactions
      .map((transaction) => transaction.amount)
      .sort((a, b) => a - b),
  ).toEqual([-8000, 200000]);
  expect(saved.statements[0]).toMatchObject({
    validationStatus: "reconciled",
    validationDifference: 0,
  });
  expect(
    saved.transactions.find((transaction) => transaction.amount === -8000)
      ?.categoryId,
  ).toBe("shopping");
});
