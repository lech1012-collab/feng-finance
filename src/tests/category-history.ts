import type { Statement, Transaction } from "../domain/models";
import { monthBounds, monthOffset } from "../domain/dates";
import { accounts, transaction } from "./helpers";

/** Entirely fictional: complete bank history beside incomplete, unrelated
 * card and Revolut history. Never seed real statements into browser tests. */
export function categoryHistoryFixture() {
  const documents: Statement[] = [];
  const transactions: Transaction[] = [];
  for (let index = 0; index < 7; index++) {
    const month = monthOffset("2026-04", index);
    const id = `bank-${month}`;
    const cost = 80000 + index * 20000;
    transactions.push(
      transaction({
        id: `${id}-cost`,
        statementId: id,
        date: `${month}-10`,
        categoryId: "property",
        amount: -cost,
        merchant: "Fictional property cost",
        description: "Fictional property cost",
      }),
      transaction({
        id: `${id}-salary`,
        statementId: id,
        date: `${month}-25`,
        categoryId: "salary",
        amount: 300000,
        type: "income",
        merchant: "Example employer",
        description: "Example salary",
      }),
    );
    documents.push({
      id,
      accountId: accounts[0].id,
      institution: "Barclays",
      currency: "GBP",
      statementPeriodStart: `${month}-01`,
      statementPeriodEnd: new Date(Date.parse(monthBounds(month)[1]) - 86400000)
        .toISOString()
        .slice(0, 10),
      periodSource: "printed",
      openingBalance: 100000,
      closingBalance: 400000 - cost,
      sourceFilename: `fictional-${month}.pdf`,
      sourceFileHash: id,
      importedAt: "2026-11-08T12:00:00Z",
      parserVersion: "test",
      extractionMethod: "embedded-text",
      validationStatus: "reconciled",
      warnings: [],
      transactionCount: 2,
    });
  }
  transactions.push(
    transaction({
      id: "card-purchase",
      statementId: "card",
      accountId: accounts[2].id,
      date: "2026-09-10",
      amount: -990,
      categoryId: "subscriptions",
      merchant: "Example streaming",
      description: "Example streaming",
    }),
  );
  documents.push({
    ...documents[0],
    id: "card",
    accountId: accounts[2].id,
    institution: "American Express",
    statementPeriodStart: "2026-09-06",
    statementPeriodEnd: "2026-10-05",
    periodSource: "transaction-coverage",
    statementDate: "2026-10-05",
    openingBalance: 0,
    closingBalance: -990,
    transactionCount: 1,
    sourceFilename: "fictional-card.pdf",
    sourceFileHash: "card",
  });
  return {
    accounts: structuredClone(accounts),
    statements: documents,
    transactions,
  };
}
