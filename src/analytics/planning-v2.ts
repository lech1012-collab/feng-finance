import type {
  Account,
  MonthlyBudget,
  MonthClose,
  Pot,
  RecurringSeries,
  Scenario,
  Setting,
  Statement,
  Transaction,
  ManualValuation,
} from "../domain/models";
import { monthBounds, monthOffset, parseDate } from "../domain/dates";
import { currencyPrecision, money, safeSum } from "../domain/money";
import { normalizeMerchant } from "../domain/normalize";
import { detectSubscriptions, readReview } from "./subscriptions";
import { shiftPlannedDate, paymentPatterns } from "./planning";
import { liabilityTypes } from "./net-worth";
import { reportingPeriod } from "../domain/period";
import { convertMinor } from "./fx";
import { verifiedStatements } from "./coverage";
import {
  statementBalanceDate,
  statementBalanceEvidence,
} from "./statement-balances";
import {
  effectiveTransactions,
  ledgerTransactions,
} from "./effective-transactions";
import { manualCashBalance } from "./manual-cash";
import { recurringDate, recurringMerchant } from "./recurring-events";
import { accountSnapshot } from "./balances";
import { latestValuation } from "./net-worth";

const stamp = (date: string) => Date.parse(`${date}T00:00:00Z`);
const addDays = (date: string, days: number) =>
  new Date(stamp(date) + days * 86400000).toISOString().slice(0, 10);
const monthDifference = (a: string, b: string) =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 +
  Number(b.slice(5, 7)) -
  Number(a.slice(5, 7));
export function potProgress(
  pot: Pot,
  today: string,
  linkedBalance?: number,
  transactions: Transaction[] = [],
) {
  parseDate(today);
  const grossSaved = safeSum(
    pot.contributions
      .filter((c) => c.month <= today.slice(0, 7))
      .map((c) => c.amountMinor),
  );
  let consumedMinor = 0,
    covered = false,
    nextTargetDate = pot.targetDate,
    cycleStart = pot.createdAt.slice(0, 7),
    lastBillMonth = "";
  if (pot.type === "sinking" && pot.linkedCategoryId && nextTargetDate) {
    const bills = effectiveTransactions(
      transactions.filter((t) => t.date <= today),
    )
      .filter(
        (t) =>
          t.currency === pot.currency &&
          t.categoryId === pot.linkedCategoryId &&
          t.amount < 0 &&
          !t.isTransfer &&
          t.kind !== "split_parent" &&
          t.date >= pot.createdAt.slice(0, 10) &&
          t.date <= today &&
          Math.abs(Math.abs(t.amount) - pot.targetMinor) <=
            Math.max(1, Math.floor(pot.targetMinor / 10)),
      )
      .sort((a, b) => a.date.localeCompare(b.date));
    for (const bill of bills) {
      if (Math.abs(stamp(bill.date) - stamp(nextTargetDate)) > 45 * 86400000)
        continue;
      const available =
        safeSum(
          pot.contributions
            .filter((c) => c.month <= bill.date.slice(0, 7))
            .map((c) => c.amountMinor),
        ) - consumedMinor;
      const cost = Math.abs(bill.amount);
      if (pot.linkedAccountId) {
        const before =
          bill.accountId === pot.linkedAccountId &&
          bill.balanceAfterTransaction !== undefined
            ? safeSum([bill.balanceAfterTransaction, cost])
            : linkedBalance;
        covered = before !== undefined && before >= cost;
      } else {
        covered = available >= cost;
        consumedMinor = safeSum([
          consumedMinor,
          Math.min(Math.max(0, available), cost),
        ]);
      }
      lastBillMonth = bill.date.slice(0, 7);
      cycleStart = monthOffset(lastBillMonth, 1);
      nextTargetDate = shiftPlannedDate(
        nextTargetDate,
        pot.cadence === "monthly" ? 1 : pot.cadence === "quarterly" ? 3 : 12,
      );
    }
  }
  const savedMinor =
    pot.linkedAccountId && linkedBalance !== undefined
      ? Math.max(0, linkedBalance)
      : Math.max(0, grossSaved - consumedMinor);
  const months = nextTargetDate
    ? Math.max(1, monthDifference(cycleStart, nextTargetDate.slice(0, 7)) + 1)
    : 12;
  const elapsed = Math.min(
    months,
    Math.max(0, monthDifference(cycleStart, today.slice(0, 7)) + 1),
  );
  const expectedMinor = Math.min(
    pot.targetMinor,
    Number(
      (BigInt(pot.targetMinor) * BigInt(elapsed) + BigInt(months) - 1n) /
        BigInt(months),
    ),
  );
  const currentContributionConfirmed =
    pot.contributions.some((c) => c.month === today.slice(0, 7)) ||
    lastBillMonth === today.slice(0, 7);
  const remainingMonths = nextTargetDate
    ? Math.max(
        1,
        monthDifference(today.slice(0, 7), nextTargetDate.slice(0, 7)) +
          1 -
          (currentContributionConfirmed ? 1 : 0),
      )
    : 12;
  const monthlyMinor = Number(
    (BigInt(Math.max(0, pot.targetMinor - savedMinor)) +
      BigInt(remainingMonths) -
      1n) /
      BigInt(remainingMonths),
  );
  return {
    savedMinor,
    linkedUnavailable: !!pot.linkedAccountId && linkedBalance === undefined,
    consumedMinor,
    nextTargetDate,
    monthlyMinor,
    expectedMinor,
    behindMinor: Math.max(0, expectedMinor - savedMinor),
    onTrack: savedMinor >= expectedMinor,
    covered,
    remainingMinor: Math.max(0, pot.targetMinor - savedMinor),
    progress: pot.targetMinor
      ? Math.min(100, (savedMinor / pot.targetMinor) * 100)
      : 100,
  };
}
/** Historical earmarks are calculated from the native ledger before reporting conversion.
 * Missing rates or account balances stay unknown, and shared savings accounts count once. */
export function potsOverview(
  pots: Pot[],
  accounts: Account[],
  statements: Statement[],
  rawTransactions: Transaction[],
  currency: string,
  date: string,
  rates: import("../domain/models").FxRate[],
  valuations: import("../domain/models").ManualValuation[] = [],
) {
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const verified = new Set(
    verifiedStatements(statements, rawTransactions, date).map((s) => s.id),
  );
  const items = pots.map((pot) => {
    const account = pot.linkedAccountId
      ? accountMap.get(pot.linkedAccountId)
      : undefined;
    const statement = account
      ? statements
          .filter(
            (s) =>
              s.accountId === account.id &&
              s.currency === account.currency &&
              statementBalanceDate(s) <= date,
          )
          .sort(
            (a, b) =>
              statementBalanceDate(b).localeCompare(statementBalanceDate(a)) ||
              b.importedAt.localeCompare(a.importedAt),
          )[0]
      : undefined;
    const cash =
      account?.tracking === "manual" &&
      ["current", "savings"].includes(account.accountType)
        ? manualCashBalance(account, valuations, rawTransactions, date)
        : undefined;
    const sourceDate =
      cash?.date ?? (statement ? statementBalanceDate(statement) : undefined);
    const reliable =
      !!statement &&
      verified.has(statement.id) &&
      statement.closingBalance !== undefined;
    const progress = potProgress(
      pot,
      date,
      cash?.valueMinor ?? (reliable ? statement!.closingBalance : undefined),
      rawTransactions,
    );
    const conversion = progress.linkedUnavailable
      ? undefined
      : convertMinor(progress.savedMinor, pot.currency, currency, date, rates);
    const monthlyConversion = progress.linkedUnavailable
      ? undefined
      : convertMinor(
          progress.monthlyMinor,
          pot.currency,
          currency,
          date,
          rates,
        );
    const sharedAccount =
      !!pot.linkedAccountId &&
      pots.filter((p) => p.linkedAccountId === pot.linkedAccountId).length > 1;
    const partial =
      progress.linkedUnavailable ||
      !conversion ||
      !monthlyConversion ||
      (!!sourceDate && sourceDate.slice(0, 7) !== date.slice(0, 7));
    return {
      pot,
      progress,
      sourceDate,
      conversion,
      monthlyConversion,
      savedMinor: conversion?.amount,
      monthlyMinor: monthlyConversion?.amount,
      partial,
      sharedAccount,
    };
  });
  const seen = new Set<string>();
  const known = items.filter((i) => {
    if (i.savedMinor === undefined) return false;
    const key = i.pot.linkedAccountId;
    if (key && seen.has(key)) return false;
    if (key) seen.add(key);
    return true;
  });
  return {
    items,
    setAsideMinor: known.length
      ? safeSum(known.map((i) => i.savedMinor!))
      : items.length
        ? undefined
        : 0,
    partial: items.some((i) => i.partial),
    converted: items.some((i) => i.pot.currency !== currency),
    missing: items.filter((i) => i.savedMinor === undefined).length,
  };
}
export function rolloverBudget(
  budget: MonthlyBudget,
  budgets: MonthlyBudget[],
  transactions: Transaction[],
  closes: MonthClose[],
  today: string,
  settings: Setting[] = [],
  rawTransactions: Transaction[] = transactions,
) {
  const previous = budgets
    .filter(
      (b) =>
        b.categoryId === budget.categoryId &&
        b.currency === budget.currency &&
        b.month < budget.month,
    )
    .sort((a, b) => a.month.localeCompare(b.month));
  const spend = (month: string) => {
    const [from, to] = reportingPeriod(month, settings, rawTransactions);
    return -safeSum(
      transactions
        .filter(
          (t) =>
            t.currency === budget.currency &&
            t.categoryId === budget.categoryId &&
            t.date >= from &&
            t.date < to &&
            !t.isTransfer &&
            t.type !== "transfer" &&
            t.kind !== "split_parent" &&
            !t.transferPairId,
        )
        .map((t) => t.amount),
    );
  };
  let carryMinor = 0,
    provisional = false;
  const timeline: MonthlyBudget[] = [];
  if (previous.length) {
    for (let m = previous[0].month; m < budget.month; m = monthOffset(m, 1)) {
      const prior = previous.filter((b) => b.month <= m).at(-1)!;
      timeline.push({ ...prior, month: m });
    }
  }
  for (const prior of timeline) {
    const left = safeSum([prior.amountMinor, carryMinor, -spend(prior.month)]);
    carryMinor =
      prior.rollover === "none"
        ? 0
        : prior.rollover === "surplus"
          ? Math.max(0, left)
          : left;
    if (
      prior.rollover !== "none" &&
      !closes.some(
        (c) =>
          c.month === prior.month &&
          (!c.currency || c.currency === prior.currency),
      )
    )
      provisional = true;
  }
  if (budget.rollover === "none") {
    carryMinor = 0;
    provisional = false;
  } else if (budget.rollover === "surplus")
    carryMinor = Math.max(0, carryMinor);
  const spentMinor = spend(budget.month),
    availableMinor = safeSum([budget.amountMinor, carryMinor]);
  const end = reportingPeriod(budget.month, settings, rawTransactions)[1];
  return {
    spentMinor,
    carryMinor,
    availableMinor,
    leftMinor: safeSum([availableMinor, -spentMinor]),
    provisional,
    daysRemaining: Math.max(
      0,
      Math.ceil((stamp(end) - stamp(today)) / 86400000),
    ),
  };
}
export function detectRecurringSeries(
  transactions: Transaction[],
  currency: string,
  today: string,
  settings: Setting[] = [],
): RecurringSeries[] {
  const subs = detectSubscriptions(
    transactions,
    settings,
    currency,
    today,
  ).filter(
    (s) => s.cadence && !s.stale && !["ignore", "cancelled"].includes(s.status),
  );
  const omitted = new Set(
    settings
      .map((s) => readReview(s.value))
      .filter((r) => r && ["ignore", "cancelled"].includes(r.status))
      .map((r) => r!.groupKey),
  );
  const result: RecurringSeries[] = subs.map((s) => ({
    id: `detected:${s.key}`,
    matchKey: s.key,
    accountId: s.accountId,
    name: s.merchant,
    currency,
    cadence:
      s.cadence === "yearly"
        ? "annual"
        : (s.cadence as RecurringSeries["cadence"]),
    expectedAmountMinor: -s.amount,
    amountHistory: s.charges.map((t) => ({
      date: t.date,
      amountMinor: t.amount,
    })),
    nextDue: nextSeriesDate(
      s.charges.at(-1)!.date,
      s.cadence === "yearly"
        ? "annual"
        : (s.cadence as RecurringSeries["cadence"]),
    ),
    status: "active",
  }));
  for (const p of paymentPatterns(transactions, settings, currency, today)) {
    const last = p.rows.at(-1)!;
    if (
      omitted.has(
        JSON.stringify([
          last.accountId,
          currency,
          normalizeMerchant(last.merchant || last.description),
          !!last.isDemo,
        ]),
      )
    )
      continue;
    if (
      p.cadence === "fortnightly" ||
      result.some(
        (s) =>
          s.accountId === last.accountId &&
          normalizeMerchant(s.name) ===
            normalizeMerchant(last.merchant || last.description),
      )
    )
      continue;
    const cadence =
      p.cadence === "yearly"
        ? "annual"
        : (p.cadence as RecurringSeries["cadence"]);
    result.push({
      id: `detected:${p.group}`,
      matchKey: p.group,
      accountId: last.accountId,
      name: last.merchant || last.description,
      currency,
      cadence,
      expectedAmountMinor: p.amount,
      amountHistory: p.rows.map((t) => ({
        date: t.date,
        amountMinor: t.amount,
      })),
      nextDue: nextSeriesDate(last.date, cadence),
      status: "active",
    });
  }
  return result;
}
export function nextSeriesDate(
  date: string,
  cadence: RecurringSeries["cadence"],
  count = 1,
) {
  return recurringDate(date, cadence, count);
}
export function seriesMerchant(series: RecurringSeries) {
  return recurringMerchant(series);
}
export interface CalendarItem {
  id: string;
  date: string;
  amountMinor: number;
  currency: string;
  name: string;
  expected: boolean;
  accountId: string;
  seriesId?: string;
  transactionId?: string;
  payday?: boolean;
}
export function recurringCalendar(
  series: RecurringSeries[],
  transactions: Transaction[],
  month: string,
  currency: string,
): CalendarItem[] {
  const [start, end] = monthBounds(month);
  const actual = transactions
    .filter(
      (t) =>
        (currency === "*" || t.currency === currency) &&
        t.date >= start &&
        t.date < end &&
        !t.parentId &&
        !t.isTransfer &&
        t.type !== "transfer",
    )
    .map((t) => ({
      id: t.id,
      date: t.date,
      amountMinor: t.amount,
      currency: t.currency,
      name: t.merchant || t.description,
      expected: false,
      accountId: t.accountId,
      transactionId: t.id,
      payday: t.categoryId === "salary",
    }));
  const expected: CalendarItem[] = [];
  for (const s of series.filter(
    (s) =>
      (currency === "*" || s.currency === currency) && s.status !== "ignored",
  )) {
    for (let i = 0; i < 400; i++) {
      const date = nextSeriesDate(s.nextDue, s.cadence, i);
      if (date >= end || (s.endDate && date > s.endDate)) break;
      if (date < start) continue;
      if (
        actual.some(
          (t) =>
            t.accountId === s.accountId &&
            t.currency === s.currency &&
            normalizeMerchant(t.name) === seriesMerchant(s) &&
            Math.sign(t.amountMinor) === Math.sign(s.expectedAmountMinor) &&
            Math.abs(stamp(t.date) - stamp(date)) <= 5 * 86400000,
        )
      )
        continue;
      expected.push({
        id: `${s.id}:${date}`,
        date,
        amountMinor: s.expectedAmountMinor,
        currency: s.currency,
        name: s.name,
        expected: true,
        accountId: s.accountId,
        seriesId: s.id,
        payday: s.expectedAmountMinor > 0,
      });
    }
  }
  return [...actual, ...expected].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || Number(a.expected) - Number(b.expected),
  );
}
export interface DebtInput {
  id: string;
  name: string;
  balanceMinor: number;
  apr: number;
  minimumMinor?: number;
  floorMinor?: number;
  currency?: string;
  accountType?: Account["accountType"];
}
export interface DebtPlan {
  points: {
    month: string;
    balanceMinor: number;
    interestMinor: number;
    paidMinor: number;
  }[];
  totalInterestMinor: number;
  totalPaidMinor: number;
  payoff: Record<string, string | undefined>;
  reason?: string;
  requiredMinimumMinor?: number;
}
/** Interest and payments round to minor units every month, matching a monthly spreadsheet. */
export function debtPayoff(
  debts: DebtInput[],
  availableMinor: number | undefined,
  strategy: "avalanche" | "snowball" | "custom",
  startMonth: string,
  customOrder: string[] = [],
): DebtPlan {
  if (
    availableMinor !== undefined &&
    (!Number.isSafeInteger(availableMinor) || availableMinor <= 0)
  )
    throw new Error("Enter a positive monthly payment.");
  for (const d of debts)
    if (
      !Number.isSafeInteger(d.balanceMinor) ||
      d.balanceMinor < 0 ||
      !Number.isFinite(d.apr) ||
      d.apr < 0 ||
      d.apr > 100 ||
      (d.minimumMinor !== undefined &&
        (!Number.isSafeInteger(d.minimumMinor) || d.minimumMinor < 0)) ||
      (d.floorMinor !== undefined &&
        (!Number.isSafeInteger(d.floorMinor) || d.floorMinor < 0))
    )
      throw new Error("Enter valid debt balances, APRs and minimum payments.");
  const balance = new Map(debts.map((d) => [d.id, d.balanceMinor]));
  const payoff: DebtPlan["payoff"] = {},
    points: DebtPlan["points"] = [];
  let totalInterestMinor = 0,
    totalPaidMinor = 0;
  const missingPayment = debts.find(
    (d) =>
      d.accountType &&
      !["credit", "credit_card"].includes(d.accountType) &&
      !(d.minimumMinor && d.minimumMinor > 0),
  );
  if (missingPayment)
    return {
      points,
      totalInterestMinor,
      totalPaidMinor,
      payoff,
      reason: `Enter the actual monthly payment for ${missingPayment.name} before including it in a debt plan.`,
    };
  for (let i = 0; i < 600; i++) {
    const active = debts.filter((d) => balance.get(d.id)! > 0);
    if (!active.length)
      return { points, totalInterestMinor, totalPaidMinor, payoff };
    const month = monthOffset(startMonth, i);
    let interestMinor = 0,
      paidMinor = 0;
    const minimum = new Map<string, number>();
    for (const d of active) {
      const before = balance.get(d.id)!;
      const interest = Number(
        (BigInt(before) * BigInt(Math.round(d.apr * 10000)) + 6000000n) /
          12000000n,
      );
      interestMinor = safeSum([interestMinor, interest]);
      balance.set(d.id, safeSum([before, interest]));
      const standard = Math.max(
        d.floorMinor ?? 25 * 10 ** currencyPrecision(d.currency ?? "GBP"),
        Number((BigInt(before) + 99n) / 100n) + interest,
      );
      minimum.set(
        d.id,
        Math.min(balance.get(d.id)!, d.minimumMinor ?? standard),
      );
    }
    const required = safeSum([...minimum.values()]);
    if (availableMinor !== undefined && required > availableMinor)
      return {
        points,
        totalInterestMinor,
        totalPaidMinor,
        payoff,
        requiredMinimumMinor: required,
        reason: `Monthly amount is below the required minimum of ${money(required, debts[0]?.currency ?? "GBP")}. Increase the amount or remove a debt from the plan.`,
      };
    let allowance = availableMinor ?? required;
    for (const d of active) {
      const payment = minimum.get(d.id)!;
      balance.set(d.id, balance.get(d.id)! - payment);
      allowance -= payment;
      paidMinor = safeSum([paidMinor, payment]);
    }
    const order = [...active].sort((a, b) =>
      strategy === "avalanche"
        ? b.apr - a.apr || balance.get(a.id)! - balance.get(b.id)!
        : strategy === "snowball"
          ? balance.get(a.id)! - balance.get(b.id)! || b.apr - a.apr
          : (customOrder.indexOf(a.id) < 0
              ? Number.MAX_SAFE_INTEGER
              : customOrder.indexOf(a.id)) -
            (customOrder.indexOf(b.id) < 0
              ? Number.MAX_SAFE_INTEGER
              : customOrder.indexOf(b.id)),
    );
    for (const d of order) {
      const extra = Math.min(allowance, balance.get(d.id)!);
      balance.set(d.id, balance.get(d.id)! - extra);
      allowance -= extra;
      paidMinor = safeSum([paidMinor, extra]);
    }
    for (const d of active) if (balance.get(d.id) === 0) payoff[d.id] = month;
    totalInterestMinor = safeSum([totalInterestMinor, interestMinor]);
    totalPaidMinor = safeSum([totalPaidMinor, paidMinor]);
    const remaining = safeSum([...balance.values()]);
    points.push({ month, balanceMinor: remaining, interestMinor, paidMinor });
    if (paidMinor <= interestMinor && remaining > 0)
      return {
        points,
        totalInterestMinor,
        totalPaidMinor,
        payoff,
        reason: "Payments do not reduce the debt. Increase the monthly amount.",
      };
  }
  return {
    points,
    totalInterestMinor,
    totalPaidMinor,
    payoff,
    reason: "Debt continues beyond the 50-year calculation limit.",
  };
}
export function paidInFullMonthly(
  account: Account,
  statements: Statement[],
  transactions: Transaction[],
  today = new Date().toISOString().slice(0, 10),
) {
  if (!["credit", "credit_card"].includes(account.accountType)) return false;
  const docs = statements
    .filter(
      (s) => s.accountId === account.id && statementBalanceDate(s) <= today,
    )
    .sort((a, b) => b.statementPeriodEnd.localeCompare(a.statementPeriodEnd))
    .slice(0, 3);
  return (
    docs.length >= 3 &&
    docs.every((s) => {
      if (
        statementBalanceEvidence(s, transactions, today).status !== "reconciled"
      )
        return false;
      const paid = safeSum(
        transactions
          .filter(
            (t) =>
              t.statementId === s.id &&
              !t.parentId &&
              t.amount > 0 &&
              t.kind !== "refund" &&
              (t.kind === "card_repayment" ||
                t.type === "transfer" ||
                /\b(PAYMENT|REPAYMENT|DIRECT DEBIT|THANK YOU)\b/i.test(
                  t.description,
                )),
          )
          .map((t) => t.amount),
      );
      return paid >= Math.max(0, -s.openingBalance!) && paid > 0;
    })
  );
}
/** A reported balance never becomes a debt-plan input without its original ledger proof. */
export function debtBalances(
  accounts: Account[],
  statements: Statement[],
  valuations: ManualValuation[],
  transactions: Transaction[],
  month: string,
  today = new Date().toISOString().slice(0, 10),
) {
  const end = addDays(monthBounds(month)[1], -1),
    asOf = end < today ? end : today;
  const rows = ledgerTransactions(transactions);
  return accounts
    .filter((a) => liabilityTypes.has(a.accountType))
    .map((account) => {
      const valuation =
        account.tracking === "manual"
          ? latestValuation(account, valuations, asOf)
          : undefined;
      const snapshot =
        account.tracking !== "manual"
          ? accountSnapshot(account, statements, month, asOf)
          : undefined;
      const evidence = snapshot?.statement
        ? statementBalanceEvidence(snapshot.statement, rows, today)
        : undefined;
      const valid =
        account.tracking === "manual"
          ? !!valuation
          : evidence?.status === "reconciled";
      const native = valuation
        ? -Math.abs(valuation.valueMinor)
        : snapshot?.balance;
      return {
        account,
        balance:
          valid && native !== undefined ? Math.max(0, -native) : undefined,
        full:
          valid &&
          paidInFullMonthly(
            account,
            statements.filter((s) => statementBalanceDate(s) <= asOf),
            rows,
            today,
          ),
        reason: evidence?.reason,
        sourceDate: valuation?.date ?? snapshot?.asOfDate,
        estimated: valuation?.note?.startsWith("Estimated") ?? false,
      };
    });
}
export function scenarioForecast<T extends { date: string; balance: number }>(
  baseline: T[],
  scenario: Scenario,
  series: RecurringSeries[] = [],
  asOf = baseline[0]?.date,
): (T & { scenario: number })[] {
  const changes: { date: string; amount: number }[] = [];
  const end = baseline.at(-1)?.date;
  if (!end) return [];
  for (const c of scenario.changes) {
    if (c.type === "one-off") {
      if (!asOf || c.date >= asOf)
        changes.push({ date: c.date, amount: c.amountMinor });
      continue;
    }
    const adjustsExisting = c.type === "pause" || c.type === "recurring-change";
    const recurring = adjustsExisting
      ? series.find((s) => s.id === c.recurringSeriesId)
      : undefined;
    if (adjustsExisting && (!recurring || recurring.status === "ignored"))
      continue;
    for (let i = 0; i < 400; i++) {
      const date = nextSeriesDate(
        recurring?.nextDue ?? c.date,
        recurring?.cadence ?? "monthly",
        i,
      );
      if (
        date > end ||
        (c.endDate && date > c.endDate) ||
        (recurring?.endDate && date > recurring.endDate)
      )
        break;
      if (date < c.date || (asOf && date < asOf)) continue;
      const amount =
        c.type === "pause"
          ? -(recurring?.expectedAmountMinor ?? 0)
          : c.type === "recurring-change"
            ? safeSum([c.amountMinor, -(recurring?.expectedAmountMinor ?? 0)])
            : c.amountMinor;
      changes.push({ date, amount });
    }
  }
  return baseline.map((p) => ({
    ...p,
    scenario: safeSum([
      p.balance,
      ...changes.filter((c) => c.date <= p.date).map((c) => c.amount),
    ]),
  }));
}
