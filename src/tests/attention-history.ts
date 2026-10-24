import type { Rule, Statement } from "../domain/models";
import { accounts, transaction } from "./helpers";

/** Fictional ledger only: a large, already classified backlog plus five real
 * decisions. Review flags deliberately reflect older imports and backfills. */
export function attentionHistoryFixture() {
  const transactions = Array.from({ length: 189 }, (_, index) =>
    transaction({
      id: `classified-${index}`,
      transactionFingerprint: `classified-${index}`,
      date: `2026-09-${String(1 + (index % 28)).padStart(2, "0")}`,
      merchant: `EXAMPLE MARKET ${index + 1}`,
      description: `EXAMPLE MARKET ${index + 1}`,
      categoryId: "groceries",
      categorySource: "rule",
      categoryRuleId: "saved-groceries",
      isReviewed: false,
      checkLevel: "total",
      amount: -1000,
    }),
  );
  transactions.push(
    transaction({
      id: "unknown-first",
      merchant: "FIRST UNKNOWN",
      description: "FIRST UNKNOWN",
      date: "2026-09-30",
      isReviewed: false,
    }),
    transaction({
      id: "unknown-next",
      merchant: "SECOND UNKNOWN",
      description: "SECOND UNKNOWN",
      date: "2026-09-29",
      isReviewed: false,
    }),
    transaction({
      id: "unlinked-refund",
      merchant: "EXAMPLE REFUND",
      description: "EXAMPLE REFUND",
      amount: 500,
      type: "income",
      kind: "refund",
      isReviewed: false,
    }),
    transaction({
      id: "rule-split",
      merchant: "EXAMPLE SPLIT",
      description: "EXAMPLE SPLIT",
      kind: "split_parent",
      amount: -500,
      isReviewed: false,
      categorySource: "rule",
    }),
    transaction({
      id: "split-groceries",
      parentId: "rule-split",
      source: "split",
      amount: -300,
      categoryId: "groceries",
      isReviewed: false,
    }),
    transaction({
      id: "split-household",
      parentId: "rule-split",
      source: "split",
      amount: -200,
      categoryId: "household",
      isReviewed: false,
    }),
    transaction({
      id: "source-check",
      merchant: "EXAMPLE SOURCE",
      description: "EXAMPLE SOURCE",
      categoryId: "shopping",
      checkLevel: "review",
      isReviewed: false,
    }),
    transaction({
      id: "transfer",
      type: "transfer",
      isTransfer: true,
      amount: 1000,
      isReviewed: false,
    }),
    transaction({
      id: "card-repayment",
      kind: "card_repayment",
      amount: -2000,
      isReviewed: false,
    }),
    transaction({
      id: "linked-refund",
      kind: "refund",
      type: "income",
      amount: 200,
      refundAllocations: [{ transactionId: "classified-0", amount: 200 }],
      isReviewed: false,
    }),
  );
  const ledger = transactions.filter((row) => !row.parentId);
  const statement: Statement = {
    id: "s1",
    accountId: "a1",
    institution: "Barclays",
    currency: "GBP",
    statementPeriodStart: "2026-09-01",
    statementPeriodEnd: "2026-09-30",
    periodSource: "printed",
    openingBalance: 500000,
    closingBalance: 500000 + ledger.reduce((sum, row) => sum + row.amount, 0),
    sourceFilename: "fictional-attention.pdf",
    sourceFileHash: "fictional-attention",
    importedAt: "2026-10-03T12:00:00Z",
    parserVersion: "synthetic",
    extractionMethod: "embedded-text",
    validationStatus: "reconciled",
    validationDifference: 0,
    transactionCount: ledger.length,
    warnings: [],
  };
  const rule: Rule = {
    id: "saved-groceries",
    name: "Example market",
    match: "contains",
    pattern: "EXAMPLE MARKET",
    accountId: "a1",
    direction: "negative",
    categoryId: "groceries",
    priority: 100,
    builtIn: false,
  };
  return {
    accounts: structuredClone([accounts[0]]),
    transactions,
    statements: [statement],
    rules: [rule],
  };
}
