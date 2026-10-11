import type { Transaction, MonthClose } from "../domain/models";
import { db } from "./database";
import { auditedMutation } from "./audit";
import { periodMonth, reportingPeriod } from "../domain/period";
import {
  effectiveTransactions,
  needsReview,
} from "../analytics/effective-transactions";
import { projectedReportingTransactions } from "../analytics/fx";
import { cashFlow, categorySpending } from "../analytics/calculations";
import { reportingCoverage } from "../analytics/reporting";
export const MONTH_REVIEW_TABLES = [
  "transactions",
  "monthCloses",
  "settings",
  "fxRates",
  "categories",
];
export class ClosedMonthError extends Error {
  constructor(public months: string[]) {
    super("This changes a closed month. Reopen?");
  }
}
export async function ensureMonthsOpen(rows: Pick<Transaction, "date">[]) {
  const [settings, transactions, closes] = await Promise.all([
    db.settings.toArray(),
    db.transactions.toArray(),
    db.monthCloses.toArray(),
  ]);
  const affected = new Set(
    rows.map((row) => periodMonth(row.date, settings, transactions)),
  );
  const months = closes
    .filter((close) => affected.has(close.month))
    .map((close) => close.month);
  if (months.length) throw new ClosedMonthError(months);
}
export async function reopenMonths(months: string[]) {
  return auditedMutation("Reopen month", ["monthCloses"], async () =>
    db.monthCloses.bulkDelete(months),
  );
}
export async function authorizeMonthEdit(rows: Pick<Transaction, "date">[]) {
  try {
    await ensureMonthsOpen(rows);
    return true;
  } catch (error) {
    if (!(error instanceof ClosedMonthError)) throw error;
    if (!window.confirm("This changes a closed month. Reopen?")) return false;
    await reopenMonths(error.months);
    return true;
  }
}
async function snapshot(month: string, currency: string) {
  const [rows, settings, rates, categories] = await Promise.all([
    db.transactions.toArray(),
    db.settings.toArray(),
    db.fxRates.toArray(),
    db.categories.toArray(),
  ]);
  const [from, to] = reportingPeriod(month, settings, rows);
  const projected = projectedReportingTransactions(
    effectiveTransactions(rows),
    currency,
    rates,
  );
  const selected = projected.transactions.filter(
    (t) => t.date >= from && t.date < to,
  );
  if (projected.missing.some((t) => t.date >= from && t.date < to))
    throw new Error(
      "Exchange rates are missing for this month. Add rates before closing it.",
    );
  return {
    ...cashFlow(selected, currency),
    transactionCount: rows.filter(
      (t) => !t.parentId && t.date >= from && t.date < to,
    ).length,
    categoryTotals: Object.fromEntries(
      categorySpending(selected, categories, currency).map((c) => [
        c.id,
        c.amount,
      ]),
    ),
  };
}
/** Refund exception: update existing snapshots in the SAME audit transaction as the allocation. */
export async function updateClosedMonthSnapshots() {
  for (const close of await db.monthCloses.toArray())
    await db.monthCloses.update(close.month, {
      snapshot: await snapshot(close.month, close.currency ?? "GBP"),
      updatedAt: new Date().toISOString(),
    });
}
export async function closeMonth(month: string, currency: string) {
  return auditedMutation(
    "Close month",
    [...MONTH_REVIEW_TABLES, "accounts", "statements", "transferProposals"],
    async () => {
      if (await db.monthCloses.get(month))
        throw new Error(
          "This month is already closed. Reopen it before changing the snapshot.",
        );
      const [accounts, statements, rows, settings, rates, proposals] =
        await Promise.all([
          db.accounts.toArray(),
          db.statements.toArray(),
          db.transactions.toArray(),
          db.settings.toArray(),
          db.fxRates.toArray(),
          db.transferProposals.toArray(),
        ]);
      const coverage = reportingCoverage(
        accounts,
        statements,
        rows,
        month,
        currency,
        rates,
        settings,
        proposals,
      );
      if (!coverage.complete)
        throw new Error(
          "Complete and verified account coverage is required before closing this month.",
        );
      const [from, to] = reportingPeriod(month, settings, rows);
      if (
        rows.some(
          (row) => row.date >= from && row.date < to && needsReview(row),
        )
      )
        throw new Error("Review every transaction before closing this month.");
      const record: MonthClose = {
        month,
        currency,
        closedAt: new Date().toISOString(),
        snapshot: await snapshot(month, currency),
      };
      await db.monthCloses.put(record);
      return record;
    },
  );
}

/** Only complete, reviewed old periods qualify. Missing data never auto-closes. */
export async function autoCloseEligibleMonths() {
  const [rows, accounts, statements, settings, rates, proposals, closes] =
    await Promise.all([
      db.transactions.toArray(),
      db.accounts.toArray(),
      db.statements.toArray(),
      db.settings.toArray(),
      db.fxRates.toArray(),
      db.transferProposals.toArray(),
      db.monthCloses.toArray(),
    ]);
  if (settings.some((s) => s.key === "review:autoClose" && s.value === "false"))
    return;
  const currency = settings.find((s) => s.key === "currency")?.value ?? "GBP";
  const closed = new Set(closes.map((c) => c.month));
  const months = [
    ...new Set(rows.map((r) => periodMonth(r.date, settings, rows))),
  ].sort();
  for (const month of months) {
    const [from, to] = reportingPeriod(month, settings, rows);
    if (
      closed.has(month) ||
      Date.now() - Date.parse(`${to}T00:00:00Z`) < 60 * 86400000 ||
      rows.some((r) => r.date >= from && r.date < to && needsReview(r))
    )
      continue;
    if (
      !reportingCoverage(
        accounts,
        statements,
        rows,
        month,
        currency,
        rates,
        settings,
        proposals,
      ).complete
    )
      continue;
    await closeMonth(month, currency);
  }
}
