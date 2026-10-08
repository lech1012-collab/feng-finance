import { describe, it, expect } from "vitest";
import { categoryOverview, completeMonth } from "./category";
import { transaction, accounts } from "../tests/helpers";
import { defaultCategories } from "../storage/database";
import type { Statement } from "../domain/models";
const statement = (
  month: string,
  patch: Partial<Statement> = {},
): Statement => ({
  id: month,
  accountId: "a1",
  institution: "Barclays",
  currency: "GBP",
  statementPeriodStart: `${month}-01`,
  statementPeriodEnd: new Date(
    Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0),
  )
    .toISOString()
    .slice(0, 10),
  sourceFilename: "fictional.pdf",
  sourceFileHash: month,
  importedAt: "2026-05-01T00:00:00Z",
  parserVersion: "1.0.3",
  extractionMethod: "embedded-text",
  validationStatus: "reconciled",
  warnings: [],
  transactionCount: 2,
  ...patch,
});
const months = ["2026-01", "2026-02", "2026-03", "2026-04"];
const statements = months.map((m) => statement(m));
const tx = months.flatMap((m, i) => [
  transaction({
    id: `e${i}`,
    date: `${m}-10`,
    categoryId: "shopping",
    amount: -[10000, 20000, 30000, 45000][i],
  }),
  transaction({
    id: `i${i}`,
    date: `${m}-10`,
    categoryId: "salary",
    amount: 100000,
  }),
]);
const stats = (items = tx, docs = statements) =>
  categoryOverview(
    items,
    [accounts[0]],
    docs,
    defaultCategories,
    "shopping",
    "2026-04",
    "GBP",
    6,
    "2026-05-01",
  );
describe("category comparisons and coverage", () => {
  it("lets stricter source eligibility exclude a mixed-source month from averages and overspending", () => {
    const result = categoryOverview(
      tx,
      [accounts[0]],
      statements,
      defaultCategories,
      "shopping",
      "2026-04",
      "GBP",
      6,
      "2026-05-01",
      (month) => ["2026-01", "2026-03"].includes(month),
    );
    expect(result.baseline.map((point) => point.month)).toEqual([
      "2026-01",
      "2026-03",
    ]);
    expect(result.mean).toBe(20000);
    expect(result.std).toBeUndefined();
    expect(result.current.complete).toBe(false);
    expect(result.aboveUsual).toBe(false);
  });
  it("computes sample deviation from prior complete months and income share", () => {
    const s = stats();
    expect(s.baseline).toHaveLength(3);
    expect(s.mean).toBe(20000);
    expect(s.std).toBe(10000);
    expect(s.difference).toBe(25000);
    expect(s.change).toBe(125);
    expect(s.current.incomePercent).toBe(45);
    expect(s.aboveUsual).toBe(true);
  });
  it("counts genuine zero-spending months but omits missing statements", () => {
    const s = stats(tx.filter((t) => t.id !== "e0"));
    expect(s.baseline[0].amount).toBe(0);
    expect(
      stats(
        tx,
        statements.filter((s) => s.id !== "2026-01"),
      ).baseline,
    ).toHaveLength(2);
    expect(
      stats(
        tx,
        statements.filter((s) => s.id !== "2026-01"),
      ).std,
    ).toBeUndefined();
  });
  it("merges contiguous coverage and rejects gaps, inferred periods and failed reconciliation", () => {
    const a = statement("2026-03", { statementPeriodEnd: "2026-03-15" }),
      b = statement("2026-03", { id: "b", statementPeriodStart: "2026-03-16" });
    expect(completeMonth("2026-03", [accounts[0]], [a, b], "2026-05-01")).toBe(
      true,
    );
    expect(
      completeMonth(
        "2026-03",
        [accounts[0]],
        [a, { ...b, statementPeriodStart: "2026-03-17" }],
        "2026-05-01",
      ),
    ).toBe(false);
    for (const patch of [
      { periodSource: "transaction-coverage" as const },
      { validationStatus: "warning" as const },
    ])
      expect(
        completeMonth(
          "2026-03",
          [accounts[0]],
          [statement("2026-03", patch)],
          "2026-05-01",
        ),
      ).toBe(false);
  });
  it("requires the same accounts and does not flag partial months as overspending", () => {
    expect(
      completeMonth("2026-03", accounts.slice(0, 2), statements, "2026-05-01"),
    ).toBe(false);
    const s = categoryOverview(
      tx,
      [accounts[0]],
      statements,
      defaultCategories,
      "shopping",
      "2026-04",
      "GBP",
      6,
      "2026-04-20",
    );
    expect(s.current.complete).toBe(false);
    expect(s.aboveUsual).toBe(false);
  });
  it("isolates currency and excludes transfers in numerator and denominator", () => {
    const s = stats([
      ...tx,
      transaction({ date: "2026-04-10", amount: 900000, isTransfer: true }),
      transaction({
        date: "2026-04-10",
        amount: -900000,
        type: "transfer",
        categoryId: "shopping",
      }),
      transaction({
        date: "2026-04-10",
        amount: -900000,
        currency: "USD",
        categoryId: "shopping",
      }),
    ]);
    expect(s.current.amount).toBe(45000);
    expect(s.current.incomePercent).toBe(45);
  });
  it("handles absent income, zero variance and percentages over 100", () => {
    expect(
      stats(tx.filter((t) => t.amount < 0)).current.incomePercent,
    ).toBeUndefined();
    const s = stats(
      tx.map((t) => (t.id.startsWith("e") ? { ...t, amount: -200000 } : t)),
    );
    expect(s.std).toBe(0);
    expect(s.aboveUsual).toBe(false);
    expect(s.current.incomePercent).toBe(200);
  });
  it("supports income categories and property subcategories", () => {
    const income = categoryOverview(
      tx,
      [accounts[0]],
      statements,
      defaultCategories,
      "salary",
      "2026-04",
      "GBP",
      6,
      "2026-05-01",
    );
    expect(income.incomeCategory).toBe(true);
    expect(income.current.amount).toBe(100000);
    const t = transaction({
      date: "2026-04-10",
      categoryId: "property",
      subcategoryId: "property-repairs",
      amount: -7500,
    });
    const s = categoryOverview(
      [t],
      [accounts[0]],
      statements,
      defaultCategories,
      "property",
      "2026-04",
      "GBP",
      6,
      "2026-05-01",
    );
    expect(s.children.find((c) => c.id === "property-repairs")?.amount).toBe(
      7500,
    );
    expect(s.property.net).toBe(-7500);
  });
});
