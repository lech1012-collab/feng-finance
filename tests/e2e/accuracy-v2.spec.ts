import { expect, test, type Page } from "./fixtures";

async function seedAccuracy(page: Page) {
  await page.clock.setFixedTime(new Date("2026-10-08T12:00:00Z"));
  await page.goto("/#/");
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const write = database.transaction(
            ["accounts", "transactions", "transferProposals", "monthCloses"],
            "readwrite",
          );
          const stamp = "2026-10-08T12:00:00Z";
          for (const [id, name, type, institution] of [
            ["accuracy-cash", "Everyday", "current", "Barclays"],
            ["accuracy-card", "Card", "credit", "American Express"],
          ])
            write.objectStore("accounts").put({
              id,
              displayName: name,
              accountType: type,
              institution,
              currency: "GBP",
              maskedAccountIdentifier: "Fictitious",
              createdAt: stamp,
              updatedAt: stamp,
            });
          for (const [
            id,
            date,
            amount,
            merchant,
            accountId,
            kind,
            categoryId,
          ] of [
            [
              "accuracy-tesco",
              "2026-09-10",
              -6000,
              "TESCO",
              "accuracy-cash",
              "normal",
              "groceries",
            ],
            [
              "accuracy-purchase",
              "2026-08-20",
              -4000,
              "CLOTHING SHOP",
              "accuracy-cash",
              "normal",
              "shopping",
            ],
            [
              "accuracy-refund",
              "2026-09-03",
              4000,
              "CLOTHING SHOP",
              "accuracy-cash",
              "refund",
              undefined,
            ],
            [
              "accuracy-debit",
              "2026-09-15",
              -95000,
              "PAYMENT TO AMEX",
              "accuracy-cash",
              "normal",
              undefined,
            ],
            [
              "accuracy-credit",
              "2026-09-17",
              95000,
              "PAYMENT RECEIVED",
              "accuracy-card",
              "normal",
              undefined,
            ],
          ] as const)
            write.objectStore("transactions").put({
              id,
              accountId,
              statementId: "synthetic-statement",
              date,
              amount,
              merchant,
              description: merchant,
              currency: "GBP",
              type: amount > 0 ? "income" : "expense",
              kind,
              categoryId,
              tags: [],
              sourcePage: 1,
              source: "pdf",
              extractionConfidence: 1,
              transactionFingerprint: id,
              occurrence: 0,
              isTransfer: false,
              isReviewed: false,
              createdAt: stamp,
              updatedAt: stamp,
            });
          write.objectStore("transferProposals").put({
            id: "accuracy-proposal",
            debitTxId: "accuracy-debit",
            creditTxId: "accuracy-credit",
            pairKind: "card_repayment",
            score: 0.9,
            status: "pending",
            createdAt: stamp,
          });
          write.objectStore("monthCloses").put({
            month: "2026-08",
            currency: "GBP",
            closedAt: stamp,
            snapshot: {
              income: 0,
              expenses: 4000,
              net: -4000,
              transactionCount: 1,
            },
          });
          write.oncomplete = () => {
            database.close();
            resolve();
          };
          write.onerror = () => {
            database.close();
            reject(write.error);
          };
        };
      }),
  );
  // This synthetic fixture writes raw IndexedDB, so reload to refresh live-query
  // caches created before the external write (real imports use Dexie broadcasts).
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
}

async function record(page: Page, table: string, id: string) {
  return page.evaluate(
    ({ table, id }) =>
      new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const request = indexedDB.open("feng-finance");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const get = database
            .transaction(table, "readonly")
            .objectStore(table)
            .get(id);
          get.onsuccess = () => {
            database.close();
            resolve(get.result);
          };
          get.onerror = () => {
            database.close();
            reject(get.error);
          };
        };
      }),
    { table, id },
  );
}

test("split editor blocks an unallocated penny and refund updates the closed purchase month", async ({
  page,
}) => {
  await seedAccuracy(page);
  await page.goto("/#/transactions/accuracy-tesco");
  await page.getByRole("button", { name: "Split", exact: true }).click();
  const split = page.getByRole("dialog", {
    name: "Split transaction",
    exact: true,
  });
  await split
    .getByRole("combobox", { name: "Category", exact: true })
    .nth(0)
    .selectOption("groceries");
  await split
    .getByRole("combobox", { name: "Category", exact: true })
    .nth(1)
    .selectOption("household");
  await split.getByLabel("Split amount 1", { exact: true }).fill("45.00");
  await split.getByLabel("Split amount 2", { exact: true }).fill("14.99");
  await expect(
    split.getByRole("button", { name: "Save split", exact: true }),
  ).toBeDisabled();
  await expect(
    split.getByText("Remaining £0.01", { exact: true }),
  ).toBeVisible();
  await split.getByLabel("Split amount 2", { exact: true }).fill("15.00");
  await split.getByRole("button", { name: "Save split", exact: true }).click();
  await expect(split).toHaveCount(0);
  await expect(page.locator(".accuracy-split-summary")).toContainText(
    "Split · 2 lines",
  );
  await expect(page.locator(".accuracy-split-summary")).toContainText(
    "−£45.00",
  );
  await expect(page.locator(".accuracy-split-summary")).toContainText(
    "−£15.00",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(
      async () => (await record(page, "transactions", "accuracy-tesco"))?.kind,
    )
    .toBe("normal");

  await page.goto("/#/transactions/accuracy-refund");
  await page.getByRole("button", { name: "Refund of…", exact: true }).click();
  const refund = page.getByRole("dialog", { name: "Refund of…", exact: true });
  await refund.getByRole("checkbox", { name: /Clothing shop/i }).check();
  await refund
    .getByRole("button", { name: "Link refund", exact: true })
    .click();
  await expect(refund).toHaveCount(0);
  await expect(
    page.getByText("Refund · counted in August 2026", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await record(page, "monthCloses", "2026-08"))?.snapshot)
    .toMatchObject({ income: 0, expenses: 0, net: 0 });
  expect((await record(page, "transactions", "accuracy-refund"))?.date).toBe(
    "2026-09-03",
  );
});

test("manual transfer confirmation excludes both card-payment sides and offers one Undo", async ({
  page,
}) => {
  await seedAccuracy(page);
  await page.goto("/#/transactions?allDates=1");
  const review = page.getByRole("region", {
    name: "Transfers to confirm",
    exact: true,
  });
  await expect(review).toBeVisible();
  expect(
    (await record(page, "transactions", "accuracy-debit"))?.isTransfer,
  ).toBe(false);
  await review
    .getByRole("button", { name: "Confirm pair", exact: true })
    .click();
  await expect
    .poll(
      async () => (await record(page, "transactions", "accuracy-debit"))?.kind,
    )
    .toBe("card_repayment");
  await expect
    .poll(
      async () => (await record(page, "transactions", "accuracy-credit"))?.kind,
    )
    .toBe("card_repayment");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await record(page, "transactions", "accuracy-debit"))?.isTransfer,
    )
    .toBe(false);
  await expect
    .poll(
      async () =>
        (await record(page, "transferProposals", "accuracy-proposal"))?.status,
    )
    .toBe("pending");
  await expect(
    review.getByRole("button", { name: "Confirm pair", exact: true }),
  ).toBeVisible();
});

test("manual entries save to the selected account and can be removed with Undo", async ({
  page,
}) => {
  await seedAccuracy(page);
  await page.goto("/#/transactions?allDates=1");
  await page
    .getByRole("button", { name: "Add manual transaction", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Manual transaction",
    exact: true,
  });
  await editor
    .getByRole("combobox", { name: "Account", exact: true })
    .selectOption("accuracy-cash");
  await editor.getByLabel("Date", { exact: true }).fill("2026-10-08");
  await editor
    .getByLabel("Description", { exact: true })
    .fill("Cash groceries fixture");
  await editor.getByLabel("Amount (GBP)", { exact: true }).fill("12.34");
  await editor
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("groceries");
  await editor
    .getByRole("button", { name: "Save manual transaction", exact: true })
    .click();
  const notice = page.locator(".ux-toast");
  await expect(notice).toContainText("−£12.34");
  await notice.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(notice).toHaveCount(0);
});
