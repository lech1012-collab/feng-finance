import { expect, it } from "vitest";
import { financialType } from "./transaction-type";
import { transaction, accounts } from "../tests/helpers";
import {
  cashFlow,
  monthlySeries,
  categorySpending,
} from "../analytics/calculations";
import { datedBalanceHistory, balanceOverview } from "../analytics/balances";
import { categorize } from "../categorization/engine";
import { defaultCategories } from "../storage/database";
import type { Statement } from "./models";
it("counts Salary and other incoming money as income despite stale type labels", () => {
  const salary = transaction({
    amount: 372600,
    categoryId: "salary",
    type: "expense",
  });
  const incoming = transaction({
    id: "in",
    amount: 50000,
    categoryId: "other-income",
    type: "expense",
  });
  const debit = transaction({ id: "out", amount: -10000, type: "income" });
  expect(financialType(salary)).toBe("income");
  expect(financialType(incoming)).toBe("income");
  expect(financialType(debit)).toBe("expense");
  expect(cashFlow([salary, incoming, debit], "GBP")).toEqual({
    income: 422600,
    expenses: 10000,
    net: 412600,
  });
  expect(
    monthlySeries([salary, incoming, debit], "2026-09", 1, "GBP")[0].net,
  ).toBe(412600);
  expect(cashFlow([{ ...salary, currency: "EUR" }], "GBP").income).toBe(0);
});
it("honours every transfer marker without allowing Salary to override it", () => {
  for (const patch of [
    { isTransfer: true },
    { type: "transfer" as const },
    { transferPairId: "linked" },
  ]) {
    const credit = transaction({
      amount: 372600,
      categoryId: "salary",
      ...patch,
    });
    const debit = transaction({
      amount: -50000,
      categoryId: "shopping",
      ...patch,
    });
    expect(financialType(credit)).toBe("transfer");
    expect(cashFlow([credit, debit], "GBP")).toEqual({
      income: 0,
      expenses: 0,
      net: 0,
    });
    expect(categorySpending([debit], defaultCategories, "GBP")).toEqual([]);
  }
});
it("preserves account balances and reconciled history when Salary metadata changes", () => {
  const salary = transaction({
    id: "salary",
    amount: 372600,
    categoryId: "salary",
    date: "2026-09-25",
    type: "expense",
  });
  const cost = transaction({ id: "cost", amount: -10000, date: "2026-09-26" });
  const doc: Statement = {
    id: "s1",
    accountId: "a1",
    institution: "Barclays",
    currency: "GBP",
    statementPeriodStart: "2026-09-01",
    statementPeriodEnd: "2026-09-30",
    openingBalance: 100000,
    closingBalance: 462600,
    transactionCount: 2,
    validationStatus: "reconciled",
    sourceFilename: "synthetic",
    sourceFileHash: "hash",
    importedAt: "2026-10-01",
    parserVersion: "1",
    extractionMethod: "embedded-text",
    warnings: [],
  };
  const before = datedBalanceHistory(
    [accounts[0]],
    [doc],
    [salary, cost],
    "2026-09",
    "GBP",
    1,
  );
  const after = datedBalanceHistory(
    [accounts[0]],
    [doc],
    [{ ...salary, type: "income" }, cost],
    "2026-09",
    "GBP",
    1,
  );
  expect(before.data).toEqual(after.data);
  expect(after.data.find((p) => p.date === "2026-09-25")!.total).toBe(472600);
  expect(after.data.at(-1)!.total).toBe(462600);
  expect(balanceOverview([accounts[0]], [doc], "2026-09", "GBP").total).toBe(
    462600,
  );
});
it("categorization rules cannot reverse the financial direction", () => {
  const credit = transaction({
    amount: 372600,
    merchant: "SIEMENS",
    description: "SIEMENS",
    type: "expense",
  });
  const rule = {
    id: "rule",
    name: "Salary",
    match: "contains" as const,
    pattern: "SIEMENS",
    direction: "positive" as const,
    categoryId: "salary",
    type: "expense" as const,
    priority: 100,
    builtIn: false,
  };
  expect(categorize(credit, [rule])).toMatchObject({
    categoryId: "salary",
    type: "income",
    isTransfer: false,
  });
  expect(categorize({ ...credit, type: "transfer" }, [rule])).toMatchObject({
    type: "transfer",
    isTransfer: true,
    categoryId: undefined,
  });
});
