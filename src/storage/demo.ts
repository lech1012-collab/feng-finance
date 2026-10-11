import { db, initializeDatabase } from "./database";
import type {
  Account,
  Statement,
  Transaction,
  TransferLink,
  TransferProposal,
  Pot,
  RecurringSeries,
  ManualValuation,
  FxRate,
} from "../domain/models";
import { fingerprint } from "../domain/normalize";
import { monthOffset } from "../domain/dates";
import { auditedMutation } from "./audit";
import { updateClosedMonthSnapshots } from "./month-review";

/** Entirely fictitious examples cover the v2 journeys without any personal statement data. */
export async function loadDemo() {
  await initializeDatabase();
  if (await db.accounts.get("demo-barclays"))
    return { result: undefined, changeId: "" };
  const now = new Date().toISOString(),
    end = now.slice(0, 7);
  const specifications: [
    string,
    Account["institution"],
    string,
    Account["accountType"],
    string,
    string,
  ][] = [
    ["barclays", "Barclays", "Everyday account", "current", "4321", "GBP"],
    ["amex", "American Express", "Rewards card", "credit", "1008", "GBP"],
    ["barclaycard", "Barclays", "Barclaycard", "credit", "7788", "GBP"],
    ["revolut", "Revolut", "Travel account", "current", "9002", "GBP"],
    ["savings", "Barclays", "Rainy day savings", "savings", "5566", "GBP"],
    ["eur", "Revolut", "Euro account", "current", "8899", "EUR"],
    ["house", "Other", "Home valuation", "property", "Manual", "GBP"],
    ["mortgage", "Other", "Mortgage", "mortgage", "Manual", "GBP"],
  ];
  const accounts: Account[] = specifications.map(
    ([key, institution, displayName, accountType, masked, currency]) => ({
      id: `demo-${key}`,
      institution,
      displayName,
      accountType,
      currency,
      maskedAccountIdentifier: masked === "Manual" ? masked : `•••• ${masked}`,
      tracking: ["house", "mortgage"].includes(key) ? "manual" : "statement",
      includeInNetWorth: true,
      apr:
        key === "mortgage"
          ? 4.5
          : key === "barclaycard"
            ? 24
            : key === "amex"
              ? 18
              : undefined,
      minPaymentMinor: ["amex", "barclaycard"].includes(key) ? 2500 : undefined,
      createdAt: now,
      updatedAt: now,
      isDemo: true,
    }),
  );
  const statements: Statement[] = [],
    transactions: Transaction[] = [],
    links: TransferLink[] = [],
    proposals: TransferProposal[] = [];
  const balance: Record<string, number> = {
    barclays: 240000,
    amex: -120000,
    barclaycard: -30000,
    revolut: 50000,
    savings: 100000,
    eur: 200000,
  };
  type Row = {
    key: string;
    description: string;
    amount: number;
    day: number;
    categoryId?: string;
    subcategoryId?: string;
    kind?: Transaction["kind"];
    pair?: string;
    reviewed?: boolean;
  };
  for (let offset = -6; offset <= 0; offset++) {
    const month = monthOffset(end, offset),
      age = -offset;
    const last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0))
      .toISOString()
      .slice(0, 10);
    const rows: Row[] = [
      {
        key: "barclays",
        description: "SIEMENS SALARY",
        amount: 625000,
        day: 25,
        categoryId: "salary",
      },
      {
        key: "barclays",
        description: "RENT RECEIVED",
        amount: 210000,
        day: 3,
        categoryId: "property-income",
      },
      {
        key: "barclays",
        description: "WAITROSE FULHAM",
        amount: -7346 - age * 140,
        day: 4,
        categoryId: "groceries",
      },
      {
        key: "barclays",
        description: "SAINSBURYS",
        amount: -8420,
        day: 8,
        categoryId: "groceries",
      },
      {
        key: "amex",
        description: "JOHN LEWIS",
        amount: -38500 + age * 2100,
        day: 9,
        categoryId: "shopping",
      },
      {
        key: "revolut",
        description: "TFL TRAVEL",
        amount: -8650,
        day: 10,
        categoryId: "transport",
      },
      {
        key: "amex",
        description: "NETFLIX",
        amount: offset === 0 ? -1499 : -1299,
        day: 4,
        categoryId: "subscriptions",
      },
      {
        key: "amex",
        description: "SPOTIFY",
        amount: -1199,
        day: 6,
        categoryId: "subscriptions",
      },
      {
        key: "barclays",
        description: "LITTLE OAK NURSERY",
        amount: -85000,
        day: 1,
        categoryId: "childcare",
      },
      {
        key: "barclays",
        description: "MORTGAGE",
        amount: -62000,
        day: 2,
        categoryId: "property",
        subcategoryId: "property-mortgage-financing",
      },
      {
        key: "barclays",
        description: "SERVICE CHARGE",
        amount: -18000,
        day: 5,
        categoryId: "property",
        subcategoryId: "property-service-charge",
      },
      {
        key: "barclays",
        description: "PROPERTY REPAIRS",
        amount: offset === 0 ? -12500 : -6500,
        day: 12,
        categoryId: "property",
        subcategoryId: "property-repairs",
      },
      {
        key: "amex",
        description: "THE RIVER RESTAURANT",
        amount: -14250 - age * 220,
        day: 14,
        categoryId: "restaurants",
      },
      {
        key: "barclays",
        description: "OCTOPUS ENERGY",
        amount: -15400,
        day: 16,
        categoryId: "utilities",
      },
      {
        key: "barclays",
        description: "HOME INSURANCE",
        amount: -4700,
        day: 18,
        categoryId: "insurance",
      },
      {
        key: "barclays",
        description: "TRANSFER TO SAVINGS",
        amount: -25000,
        day: 26,
        kind: "transfer",
        pair: "savings",
      },
      {
        key: "savings",
        description: "TRANSFER FROM BARCLAYS",
        amount: 25000,
        day: 26,
        kind: "transfer",
        pair: "savings",
      },
      {
        key: "barclays",
        description: "AMEX CARD PAYMENT",
        amount: -50000,
        day: 20,
        kind: "card_repayment",
        pair: "amex",
      },
      {
        key: "amex",
        description: "BARCLAYS PAYMENT RECEIVED",
        amount: 50000,
        day: 21,
        kind: "card_repayment",
        pair: "amex",
      },
      {
        key: "barclaycard",
        description: "FICTITIOUS DEPARTMENT STORE",
        amount: -15000,
        day: 15,
        categoryId: "shopping",
      },
      {
        key: "barclays",
        description: "BARCLAYCARD PAYMENT",
        amount: -10000,
        day: 22,
        kind: "card_repayment",
        pair: "barclaycard",
      },
      {
        key: "barclaycard",
        description: "PAYMENT RECEIVED",
        amount: 10000,
        day: 23,
        kind: "card_repayment",
        pair: "barclaycard",
      },
      {
        key: "eur",
        description: "FICTITIOUS EURO CAFE",
        amount: -4599,
        day: 6,
        categoryId: "restaurants",
      },
    ];
    // Missing statements are intentional. The chart must leave both months empty.
    if (![-2, -3].includes(offset))
      rows.push(
        {
          key: "barclays",
          description: "TRANSFER TO REVOLUT",
          amount: -30000,
          day: 19,
          kind: "transfer",
          pair: "revolut",
        },
        {
          key: "revolut",
          description: "TRANSFER FROM BARCLAYS",
          amount: 30000,
          day: 19,
          kind: "transfer",
          pair: "revolut",
        },
      );
    if (offset === 0)
      rows.push(
        {
          key: "barclays",
          description: "TRANSFER TO TRAVEL ACCOUNT",
          amount: -17500,
          day: 7,
          reviewed: false,
          pair: "pending",
        },
        {
          key: "revolut",
          description: "TRANSFER FROM EVERYDAY ACCOUNT",
          amount: 17500,
          day: 8,
          reviewed: false,
          pair: "pending",
        },
        {
          key: "barclays",
          description: "TRANSFER TO OTHER SAVINGS ACCOUNT",
          amount: -4500,
          day: 8,
          kind: "transfer",
        },
        {
          key: "barclays",
          description: "TESCO MIXED SHOP",
          amount: -6000,
          day: 11,
          kind: "split_parent",
        },
        {
          key: "amex",
          description: "JOHN LEWIS REFUND",
          amount: 5000,
          day: 13,
          kind: "refund",
        },
      );
    const pairRows = new Map<string, Transaction[]>();
    for (const account of accounts.filter(
      (account) => account.tracking === "statement",
    )) {
      const key = account.id.slice(5);
      if (key === "revolut" && [-2, -3].includes(offset)) continue;
      const sid = `demo-statement-${key}-${month}`;
      const local: Transaction[] = [];
      for (const [index, row] of rows.entries())
        if (row.key === key) {
          const isTransfer =
            row.kind === "transfer" || row.kind === "card_repayment";
          const transaction: Transaction = {
            id: `demo-transaction-${month}-${index}`,
            accountId: account.id,
            statementId: sid,
            date: `${month}-${String(row.day).padStart(2, "0")}`,
            description: row.description,
            merchant: row.description,
            amount: row.amount,
            currency: account.currency,
            type: isTransfer
              ? "transfer"
              : row.amount > 0
                ? "income"
                : "expense",
            categoryId: row.categoryId,
            subcategoryId: row.subcategoryId,
            tags: [],
            sourcePage: 1,
            extractionConfidence: 1,
            transactionFingerprint: "",
            occurrence: 0,
            isTransfer,
            isReviewed: row.reviewed ?? true,
            kind: row.kind ?? "normal",
            source: "pdf",
            attachmentIds: [],
            createdAt: now,
            updatedAt: now,
            isDemo: true,
          };
          transaction.transactionFingerprint = await fingerprint(transaction);
          local.push(transaction);
          if (row.pair)
            pairRows.set(row.pair, [
              ...(pairRows.get(row.pair) ?? []),
              transaction,
            ]);
        }
      const opening = balance[key],
        closing = opening + local.reduce((sum, row) => sum + row.amount, 0);
      balance[key] = closing;
      statements.push({
        id: sid,
        institution: account.institution,
        accountId: account.id,
        statementPeriodStart: `${month}-01`,
        statementPeriodEnd: last,
        periodSource: "printed",
        openingBalance: opening,
        closingBalance: closing,
        currency: account.currency,
        sourceFilename: "Fictitious demo statement",
        sourceFileHash: sid,
        importedAt: now,
        parserVersion: "demo-2",
        extractionMethod: "manual-review",
        validationStatus: "reconciled",
        validationDifference: 0,
        transactionCount: local.length,
        warnings: [],
        isDemo: true,
      });
      transactions.push(...local);
    }
    for (const [pair, pairTransactions] of pairRows)
      if (pairTransactions.length === 2) {
        const debit = pairTransactions.find((row) => row.amount < 0)!,
          credit = pairTransactions.find((row) => row.amount > 0)!;
        if (pair === "pending")
          proposals.push({
            id: `demo-proposal-${month}`,
            debitTxId: debit.id,
            creditTxId: credit.id,
            score: 1,
            status: "pending",
            pairKind: "transfer",
            createdAt: now,
          });
        else {
          const linkId = `demo-link-${pair}-${month}`;
          links.push({
            id: linkId,
            transactionIds: [debit.id, credit.id],
            createdAt: now,
            manual: true,
          });
          debit.transferPairId = linkId;
          credit.transferPairId = linkId;
        }
      }
  }
  const refund = transactions.find(
    (transaction) => transaction.kind === "refund",
  )!;
  const purchase = transactions.find(
    (transaction) =>
      transaction.date.startsWith(monthOffset(end, -1)) &&
      transaction.description === "JOHN LEWIS",
  )!;
  refund.refundAllocations = [{ transactionId: purchase.id, amount: 5000 }];
  const split = transactions.find(
    (transaction) => transaction.kind === "split_parent",
  )!;
  for (const [index, [categoryId, amount]] of (
    [
      ["groceries", -4500],
      ["household", -1500],
    ] as const
  ).entries()) {
    const child: Transaction = {
      ...split,
      id: `${split.id}-child-${index}`,
      amount,
      categoryId,
      kind: "normal",
      parentId: split.id,
      source: "split",
      transactionFingerprint: "",
      tags: index === 1 ? ["demo-home"] : [],
    };
    child.transactionFingerprint = await fingerprint(child);
    transactions.push(child);
  }
  const valuations: ManualValuation[] = [
    {
      id: "demo-house-valuation",
      accountId: "demo-house",
      date: `${end.slice(0, 4)}-06-01`,
      valueMinor: 45000000,
      note: "Fictitious example value",
      isDemo: true,
    },
    {
      id: "demo-mortgage-valuation",
      accountId: "demo-mortgage",
      date: `${end.slice(0, 4)}-06-01`,
      valueMinor: 28000000,
      note: "Fictitious outstanding loan",
      isDemo: true,
    },
  ];
  const targetYear = +end.slice(0, 4) + (+end.slice(5, 7) >= 3 ? 1 : 0);
  const pot: Pot = {
    id: "demo-insurance-pot",
    cadence: "annual",
    type: "sinking",
    name: "Annual car insurance",
    targetMinor: 54000,
    currency: "GBP",
    targetDate: `${targetYear}-03-15`,
    linkedCategoryId: "insurance",
    contributions: [{ month: end, amountMinor: 9000 }],
    createdAt: now,
    isDemo: true,
  };
  const netflix = transactions
    .filter((transaction) => transaction.description === "NETFLIX")
    .sort((a, b) => a.date.localeCompare(b.date));
  const series: RecurringSeries = {
    id: "demo-netflix-series",
    matchKey: "NETFLIX",
    accountId: "demo-amex",
    name: "Netflix",
    currency: "GBP",
    cadence: "monthly",
    expectedAmountMinor: -1499,
    amountHistory: netflix.map((transaction) => ({
      date: transaction.date,
      amountMinor: transaction.amount,
    })),
    nextDue: `${monthOffset(end, 1)}-04`,
    status: "active",
    isDemo: true,
  };
  for (const transaction of netflix) transaction.recurringSeriesId = series.id;
  const rates: FxRate[] = [];
  // Fictitious local rates exercise conversion offline. A Friday rate serves the following weekend.
  for (let offset = -6; offset <= 0; offset++) {
    const month = monthOffset(end, offset);
    for (const day of [4, 5, 6, 25, 28]) {
      const date = new Date(
        `${month}-${String(day).padStart(2, "0")}T12:00:00Z`,
      );
      while ([0, 6].includes(date.getUTCDay()))
        date.setUTCDate(date.getUTCDate() - 1);
      const iso = date.toISOString().slice(0, 10);
      if (!rates.some((rate) => rate.date === iso))
        rates.push({
          id: `demo-fx-${iso}`,
          date: iso,
          base: "EUR",
          quote: "GBP",
          rate: "0.86425",
          source: "manual",
        });
    }
  }
  return auditedMutation(
    "Load demo data",
    [
      "accounts",
      "statements",
      "transactions",
      "transferLinks",
      "transferProposals",
      "valuations",
      "pots",
      "tags",
      "recurringSeries",
      "fxRates",
    ],
    async () => {
      if (await db.accounts.get("demo-barclays")) return;
      await db.accounts.bulkAdd(accounts);
      await db.statements.bulkAdd(statements);
      await db.transactions.bulkAdd(transactions);
      await db.transferLinks.bulkAdd(links);
      await db.transferProposals.bulkAdd(proposals);
      await db.valuations.bulkAdd(valuations);
      await db.pots.add(pot);
      await db.tags.add({
        id: "demo-home",
        name: "Home project",
        colour: "#A99BD6",
        archived: false,
        isDemo: true,
      });
      await db.recurringSeries.add(series);
      for (const rate of rates) {
        // A demonstration rate must not replace a rate already used by real accounts.
        if (
          !(await db.fxRates
            .where("[base+quote+date]")
            .equals([rate.base, rate.quote, rate.date])
            .first())
        )
          await db.fxRates.add(rate);
      }
    },
  );
}

/** Delete only demo rows. Real accounts, learned rules, goals, receipts and rates survive. */
export async function deleteDemo() {
  return auditedMutation(
    "Delete demo data",
    db.tables.map((table) => table.name),
    async () => {
      const demoIds = new Set(
        await db.transactions.filter((row) => !!row.isDemo).primaryKeys(),
      );
      const accountIds = new Set(
        await db.accounts.filter((row) => !!row.isDemo).primaryKeys(),
      );
      for (const link of await db.transferLinks.toArray())
        if (link.transactionIds.some((id) => demoIds.has(id))) {
          for (const retained of link.transactionIds.filter(
            (id) => !demoIds.has(id),
          )) {
            const other = await db.transactions.get(retained);
            if (other)
              await db.transactions.update(retained, {
                transferPairId: undefined,
                linkId: undefined,
                isTransfer: false,
                type: other.amount >= 0 ? "income" : "expense",
                kind: "normal",
                isReviewed: false,
              });
          }
          await db.transferLinks.delete(link.id);
        }
      await db.transferProposals
        .filter(
          (row) => demoIds.has(row.debitTxId) || demoIds.has(row.creditTxId),
        )
        .delete();
      await db.attachments
        .filter((row) => demoIds.has(row.transactionId))
        .delete();
      await db.rules
        .filter((row) => !!row.accountId && accountIds.has(row.accountId))
        .delete();
      await db.valuations
        .filter((row) => !!row.isDemo || accountIds.has(row.accountId))
        .delete();
      const demoSeriesIds = new Set(
        await db.recurringSeries
          .filter((row) => !!row.isDemo || accountIds.has(row.accountId))
          .primaryKeys(),
      );
      await db.recurringSeries.bulkDelete([...demoSeriesIds]);
      // A user-created goal attached to a demo account is retained, with its account link removed.
      for (const pot of await db.pots.toArray()) {
        if (pot.isDemo) await db.pots.delete(pot.id);
        else if (pot.linkedAccountId && accountIds.has(pot.linkedAccountId))
          await db.pots.update(pot.id, { linkedAccountId: undefined });
      }
      const demoTags = new Set(
        await db.tags.filter((row) => !!row.isDemo).primaryKeys(),
      );
      await db.tags.bulkDelete([...demoTags]);
      for (const rule of await db.rules.toArray())
        if (rule.actions) {
          const actions = rule.actions.flatMap((action) => {
            if (
              action.type === "recurring" &&
              action.recurringSeriesId &&
              demoSeriesIds.has(action.recurringSeriesId)
            )
              return [];
            if (action.type === "tag") {
              const tagIds = action.tagIds?.filter((tag) => !demoTags.has(tag));
              return tagIds?.length ? [{ ...action, tagIds }] : [];
            }
            if (action.type === "split")
              return [
                {
                  ...action,
                  splits: action.splits?.map((line) => ({
                    ...line,
                    tagIds: line.tagIds?.filter((tag) => !demoTags.has(tag)),
                  })),
                },
              ];
            return [action];
          });
          if (JSON.stringify(actions) !== JSON.stringify(rule.actions)) {
            if (!actions.length && !rule.categoryId && rule.type !== "transfer")
              await db.rules.delete(rule.id);
            else await db.rules.update(rule.id, { actions });
          }
        }
      for (const real of await db.transactions
        .filter((row) => !row.isDemo)
        .toArray()) {
        const changes: Partial<Transaction> = {};
        if (real.tags.some((tag) => demoTags.has(tag)))
          changes.tags = real.tags.filter((tag) => !demoTags.has(tag));
        if (real.parentId && demoIds.has(real.parentId))
          changes.parentId = undefined;
        if (
          real.refundAllocations?.some((allocation) =>
            demoIds.has(allocation.transactionId),
          )
        ) {
          // A partial allocation cannot describe the full refund. Keep the
          // user's credit as a refund and ask them to relink its whole amount.
          changes.refundAllocations = undefined;
          changes.kind = "refund";
          changes.isReviewed = false;
          changes.updatedAt = new Date().toISOString();
        }
        if (real.recurringSeriesId && demoSeriesIds.has(real.recurringSeriesId))
          changes.recurringSeriesId = undefined;
        if (Object.keys(changes).length)
          await db.transactions.update(real.id, changes);
      }
      await db.fxRates.filter((row) => row.id.startsWith("demo-")).delete();
      await db.budgets.filter((row) => row.id.startsWith("demo-")).delete();
      await db.savedViews.filter((row) => row.id.startsWith("demo-")).delete();
      await db.savedReports
        .filter((row) => row.id.startsWith("demo-"))
        .delete();
      await db.scenarios.filter((row) => row.id.startsWith("demo-")).delete();
      await db.transactions.bulkDelete([...demoIds]);
      await db.statements.filter((row) => !!row.isDemo).delete();
      await db.accounts.bulkDelete([...accountIds]);
      await updateClosedMonthSnapshots();
    },
  );
}
