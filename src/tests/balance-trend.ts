import type { Account, Statement } from "../domain/models";
import { accounts, transaction } from "./helpers";

/** Fictional, reconciled bank ledgers with deliberately sparse card snapshots. */
export function balanceTrendFixture() {
  const sources: Account[] = [
    { ...accounts[0], displayName: "Barclays" },
    { ...accounts[1], displayName: "Revolut" },
    { ...accounts[2], displayName: "Amex" },
    {
      ...accounts[2],
      id: "a4",
      institution: "Barclays",
      displayName: "Barclaycard",
      maskedAccountIdentifier: "•••• 4444",
    },
  ];
  const base: Statement = {
    id: "bank",
    accountId: "a1",
    institution: "Barclays",
    currency: "GBP",
    statementPeriodStart: "2026-09-01",
    statementPeriodEnd: "2026-09-30",
    openingBalance: 100000,
    closingBalance: 93500,
    importedAt: "2026-10-08",
    sourceFilename: "fictional-balance-source.pdf",
    sourceFileHash: "fictional-balance-source",
    parserVersion: "2",
    extractionMethod: "embedded-text",
    validationStatus: "reconciled",
    transactionCount: 2,
    warnings: [],
  };
  const statements: Statement[] = [
    base,
    {
      ...base,
      id: "revolut",
      accountId: "a2",
      institution: "Revolut",
      openingBalance: 25000,
      closingBalance: 40000,
      transactionCount: 1,
    },
    {
      ...base,
      id: "amex",
      accountId: "a3",
      institution: "American Express",
      statementPeriodStart: "2026-08-01",
      statementPeriodEnd: "2026-08-31",
      statementDate: "2026-09-05",
      periodSource: "transaction-coverage",
      openingBalance: 0,
      closingBalance: -30000,
      transactionCount: 1,
    },
    {
      ...base,
      id: "card",
      accountId: "a4",
      statementPeriodStart: "2026-09-02",
      statementPeriodEnd: "2026-10-04",
      statementDate: "2026-10-04",
      periodSource: "transaction-coverage",
      openingBalance: 0,
      closingBalance: -10968,
      transactionCount: 1,
    },
  ];
  const transactions = [
    transaction({
      id: "salary",
      accountId: "a1",
      statementId: "bank",
      date: "2026-09-15",
      amount: 50000,
      description: "Fictional salary",
      merchant: "Example Employer",
      type: "income",
      categoryId: "salary",
    }),
    transaction({
      id: "bank-shop",
      accountId: "a1",
      statementId: "bank",
      date: "2026-09-20",
      amount: -56500,
      merchant: "Example Shop",
      description: "Fictional purchase",
    }),
    transaction({
      id: "revolut-income",
      accountId: "a2",
      statementId: "revolut",
      date: "2026-09-05",
      amount: 15000,
      type: "income",
    }),
    transaction({
      id: "amex-purchase",
      accountId: "a3",
      statementId: "amex",
      date: "2026-08-15",
      amount: -30000,
    }),
    transaction({
      id: "card-purchase",
      accountId: "a4",
      statementId: "card",
      date: "2026-09-15",
      amount: -10968,
    }),
  ];
  return { accounts: sources, statements, transactions };
}
