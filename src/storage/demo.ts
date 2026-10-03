import { db, initializeDatabase } from "./database";
import type { Account, Statement, Transaction } from "../domain/models";
import { fingerprint, id } from "../domain/normalize";
import { monthOffset } from "../domain/dates";
import { categorize } from "../categorization/engine";
export async function loadDemo() {
  await initializeDatabase();
  if (await db.accounts.get("demo-barclays")) return;
  const now = new Date().toISOString();
  const accounts: Account[] = [
    ["barclays", "Barclays", "Everyday account", "current", "4321"],
    ["amex", "American Express", "Rewards card", "credit", "1008"],
    ["revolut", "Revolut", "Travel account", "current", "9002"],
  ].map(([key, institution, displayName, accountType, masked]) => ({
    id: `demo-${key}`,
    institution: institution as Account["institution"],
    displayName,
    accountType: accountType as Account["accountType"],
    currency: "GBP",
    maskedAccountIdentifier: `•••• ${masked}`,
    createdAt: now,
    updatedAt: now,
    isDemo: true,
  }));
  const rules = await db.rules.toArray();
  const statements: Statement[] = [];
  const transactions: Transaction[] = [];
  const end = new Date().toISOString().slice(0, 7);
  for (let i = 0; i < 7; i++) {
    const month = monthOffset(end, -i);
    const last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0))
      .toISOString()
      .slice(0, 10);
    const rows: [string, number, string, string?, string?][] = [
      ["SIEMENS SALARY", 625000, "barclays", "salary"],
      ["RENT RECEIVED", 210000, "barclays", "property-income"],
      ["WAITROSE FULHAM", -7346 - i * 140, "barclays", "groceries"],
      ["SAINSBURYS", -8420, "barclays", "groceries"],
      ["JOHN LEWIS", -38500 + i * 2100, "amex", "shopping"],
      ["TFL TRAVEL", -8650, "revolut", "transport"],
      ["NETFLIX", -1299, "amex", "subscriptions"],
      ["SPOTIFY", -1199, "amex", "subscriptions"],
      ["LITTLE OAK NURSERY", -85000, "barclays", "childcare"],
      [
        "MORTGAGE",
        -62000,
        "barclays",
        "property",
        "property-mortgage-financing",
      ],
      [
        "SERVICE CHARGE",
        -18000,
        "barclays",
        "property",
        "property-service-charge",
      ],
      [
        "PROPERTY REPAIRS",
        i === 0 ? -12500 : -6500,
        "barclays",
        "property",
        "property-repairs",
      ],
      ["THE RIVER RESTAURANT", -14250 - i * 220, "amex", "restaurants"],
      ["OCTOPUS ENERGY", -15400, "barclays", "utilities"],
      ["HOME INSURANCE", -4700, "barclays", "insurance"],
      ["TRANSFER TO REVOLUT", -30000, "barclays"],
      ["TRANSFER FROM BARCLAYS", 30000, "revolut"],
      ["AMEX CARD PAYMENT", -100000, "barclays"],
      ["BARCLAYS PAYMENT RECEIVED", 100000, "amex"],
    ];
    for (const account of accounts) {
      const sid = `demo-${account.id}-${month}`;
      const local: Transaction[] = [];
      for (const [
        index,
        [description, amount, key, categoryId, subcategoryId],
      ] of rows.entries())
        if (account.id === `demo-${key}`) {
          const transfer = /TRANSFER|PAYMENT/.test(description);
          const t: Transaction = {
            id: id(),
            accountId: account.id,
            statementId: sid,
            date: `${month}-${String(Math.min(28, index + 2)).padStart(2, "0")}`,
            description,
            merchant: description,
            amount,
            currency: "GBP",
            type: transfer ? "transfer" : amount > 0 ? "income" : "expense",
            categoryId,
            subcategoryId,
            tags: [],
            sourcePage: 1,
            extractionConfidence: 1,
            transactionFingerprint: "",
            occurrence: 0,
            isTransfer: transfer,
            isReviewed: true,
            createdAt: now,
            updatedAt: now,
            isDemo: true,
          };
          if (!categoryId && !transfer) Object.assign(t, categorize(t, rules));
          t.transactionFingerprint = await fingerprint(t);
          local.push(t);
        }
      const opening = account.accountType === "credit" ? -120000 : 240000;
      const closing = opening + local.reduce((s, t) => s + t.amount, 0);
      statements.push({
        id: sid,
        institution: account.institution,
        accountId: account.id,
        statementPeriodStart: `${month}-01`,
        statementPeriodEnd: last,
        openingBalance: opening,
        closingBalance: closing,
        currency: "GBP",
        sourceFilename: "Fictitious demo statement",
        sourceFileHash: sid,
        importedAt: now,
        parserVersion: "demo-1",
        extractionMethod: "manual-review",
        validationStatus: "reconciled",
        validationDifference: 0,
        transactionCount: local.length,
        warnings: [],
        isDemo: true,
      });
      transactions.push(...local);
    }
  }
  await db.transaction(
    "rw",
    db.accounts,
    db.statements,
    db.transactions,
    async () => {
      await db.accounts.bulkAdd(accounts);
      await db.statements.bulkAdd(statements);
      await db.transactions.bulkAdd(transactions);
    },
  );
}
export async function deleteDemo() {
  await db.transaction(
    "rw",
    db.accounts,
    db.statements,
    db.transactions,
    db.transferLinks,
    db.rules,
    async () => {
      const demo = await db.transactions
        .filter((t) => !!t.isDemo)
        .primaryKeys();
      const removedAccounts = await db.accounts
        .filter((a) => !!a.isDemo)
        .primaryKeys();
      const demoLinks = await db.transferLinks
        .filter((l) => l.transactionIds.some((id) => demo.includes(id)))
        .toArray();
      for (const link of demoLinks) {
        for (const tid of link.transactionIds.filter(
          (tid) => !demo.includes(tid),
        )) {
          const other = await db.transactions.get(tid);
          if (other)
            await db.transactions.update(tid, {
              transferPairId: undefined,
              isTransfer: false,
              type: other.amount >= 0 ? "income" : "expense",
              isReviewed: false,
            });
        }
        await db.transferLinks.delete(link.id);
      }
      await db.rules
        .filter((r) => !!r.accountId && removedAccounts.includes(r.accountId))
        .delete();
      await db.transactions.bulkDelete(demo);
      await db.statements.filter((s) => !!s.isDemo).delete();
      await db.accounts.filter((a) => !!a.isDemo).delete();
    },
  );
}
