import { expect, it } from "vitest";
import { deeperInsights } from "./deeper";
import { accounts, transaction } from "../tests/helpers";
import { defaultCategories } from "../storage/database";
import type { Statement } from "../domain/models";
const docs: Statement[] = ["2026-04", "2026-05", "2026-06", "2026-07"].map(
  (m) => ({
    id: m,
    accountId: "a1",
    institution: "Barclays",
    currency: "GBP",
    statementPeriodStart: `${m}-01`,
    statementPeriodEnd: `${m}-${m.endsWith("04") || m.endsWith("06") ? "30" : "31"}`,
    importedAt: "2026-08-01",
    sourceFilename: "synthetic.pdf",
    sourceFileHash: m,
    parserVersion: "1",
    extractionMethod: "embedded-text",
    validationStatus: "reconciled",
    transactionCount: 2,
    warnings: [],
  }),
);
const rows = docs.flatMap((s) => [
  transaction({
    id: `${s.id}-expense`,
    date: s.statementPeriodStart,
    amount: s.id === "2026-07" ? -50000 : -10000,
    categoryId: "shopping",
  }),
  transaction({
    id: `${s.id}-income`,
    date: s.statementPeriodStart,
    amount: s.id === "2026-07" ? 40000 : 100000,
    type: "income",
    categoryId: "salary",
  }),
]);
const analyze = (tx = rows, statements = docs) =>
  deeperInsights(
    tx,
    [accounts[0]],
    statements,
    defaultCategories,
    [],
    "2026-07",
    "GBP",
    "2026-08-02",
  );
it("explains spending drivers, statistically unusual spending and reduced income from verified months", () => {
  const result = analyze();
  expect(result.baselineCount).toBe(3);
  expect(result.items.map((i) => i.id)).toEqual(
    expect.arrayContaining([
      "spending-drivers",
      "unusual-spending",
      "income-fall",
    ]),
  );
  expect(
    result.items.find((i) => i.id === "spending-drivers")?.detail,
  ).toContain("Shopping +£400.00");
});
it("does not issue monthly alerts from incomplete, failed or insufficient statement coverage", () => {
  for (const statements of [
    docs.slice(1),
    docs.map((s) =>
      s.id === "2026-07" ? { ...s, validationStatus: "warning" as const } : s,
    ),
    docs.map((s) =>
      s.id === "2026-07" ? { ...s, statementPeriodEnd: "2026-07-20" } : s,
    ),
  ])
    expect(
      analyze(rows, statements).items.some((i) =>
        ["spending-drivers", "unusual-spending", "income-fall"].includes(i.id),
      ),
    ).toBe(false);
});
it("honours strict source eligibility when otherwise-complete statements overlap unverified imports", () => {
  const result = deeperInsights(
    rows,
    [accounts[0]],
    docs,
    defaultCategories,
    [],
    "2026-07",
    "GBP",
    "2026-08-02",
    (month) => ["2026-04", "2026-06"].includes(month),
  );
  expect(result.baselineCount).toBe(2);
  expect(result.complete).toBe(false);
  expect(
    result.items.some((item) =>
      ["spending-drivers", "income-fall", "unusual-spending"].includes(item.id),
    ),
  ).toBe(false);
});
it("excludes other currencies, future dates and all transfer representations", () => {
  const extra = [
    transaction({
      id: "transfer",
      date: "2026-07-01",
      amount: -999999,
      type: "transfer",
    }),
    transaction({
      id: "pair",
      date: "2026-07-01",
      amount: -999999,
      transferPairId: "pair",
    }),
    transaction({
      id: "eur",
      date: "2026-07-01",
      amount: -999999,
      currency: "EUR",
    }),
    transaction({ id: "future", date: "2026-09-01", amount: -999999 }),
  ];
  expect(analyze([...rows, ...extra])).toEqual(analyze());
});
it("flags larger merchant payments using same-account historical median without requiring complete months", () => {
  expect(analyze().items.some((i) => i.id === "purchase-2026-07-expense")).toBe(
    true,
  );
  expect(
    analyze(
      rows.map((t) =>
        t.date.startsWith("2026-07") ? t : { ...t, accountId: "a2" },
      ),
    ).items.some((i) => i.id.startsWith("purchase-")),
  ).toBe(false);
});
it("finds recurring price rises and labels cross-account overlaps as possible", () => {
  const subscriptions = ["2026-05-01", "2026-06-01", "2026-07-01"].flatMap(
    (date, i) => [
      transaction({
        id: `s${i}`,
        merchant: "NETFLIX",
        description: "NETFLIX",
        date,
        amount: i === 2 ? -2000 : -1500,
        categoryId: "subscriptions",
      }),
      transaction({
        id: `other${i}`,
        accountId: "a2",
        merchant: "NETFLIX",
        date,
        amount: -1500,
        categoryId: "subscriptions",
      }),
    ],
  );
  const result = analyze(subscriptions);
  expect(result.items.some((i) => i.title.includes("price increase"))).toBe(
    true,
  );
  expect(result.items.filter((i) => i.id.startsWith("overlap-"))).toHaveLength(
    1,
  );
});

it("only shows a cancellation alert for a selected month containing a later charge", () => {
  const payments = [
    "2026-05-01",
    "2026-06-01",
    "2026-07-01",
    "2026-08-01",
    "2026-09-01",
  ].map((date, index) =>
    transaction({
      id: `cancel-${index}`,
      date,
      merchant: "NETFLIX",
      description: "NETFLIX",
      amount: -1000,
      categoryId: "subscriptions",
    }),
  );
  const groupKey = JSON.stringify(["a1", "GBP", "NETFLIX", false]);
  const settings = [
    {
      key: "subscription:test",
      value: JSON.stringify({
        groupKey,
        status: "cancelled",
        date: "2026-06-15",
        amount: 1000,
      }),
    },
  ];
  const cancellationAlert = (month: string) =>
    deeperInsights(
      payments,
      [accounts[0]],
      [],
      defaultCategories,
      settings,
      month,
      "GBP",
      "2026-10-04",
    ).items.filter((item) => item.id.startsWith("cancel-"));
  // Existing charges before cancellation, or no charges in a month, do not
  // inherit an alert from the later September payment.
  expect(cancellationAlert("2026-05")).toHaveLength(0);
  expect(cancellationAlert("2026-06")).toHaveLength(0);
  expect(cancellationAlert("2026-10")).toHaveLength(0);
  expect(cancellationAlert("2026-09")).toHaveLength(1);
  // An earlier affected month still has its own evidence even if a later
  // recurring charge exists elsewhere in the imported history.
  expect(cancellationAlert("2026-07")).toHaveLength(1);
});
