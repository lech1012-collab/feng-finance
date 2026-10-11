import type {
  Account,
  ManualValuation,
  Statement,
  Transaction,
} from "../domain/models";
import { monthBounds, parseDate } from "../domain/dates";
import { safeSum } from "../domain/money";
import { statementBalanceDate } from "./statement-balances";
import { manualCashBalance } from "./manual-cash";

export const liabilityTypes = new Set<Account["accountType"]>([
  "credit",
  "credit_card",
  "loan",
  "mortgage",
  "other_liability",
]);
export const manualAccountTypes = [
  "property",
  "vehicle",
  "pension",
  "investment",
  "mortgage",
  "loan",
  "other_asset",
  "other_liability",
] as const;
export function latestValuation(
  account: Account,
  valuations: ManualValuation[],
  date: string,
) {
  return valuations
    .filter((v) => v.accountId === account.id && v.date <= date)
    .sort(
      (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
    )[0];
}
export function valuationStale(account: Account, date: string, today: string) {
  const days =
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) /
    86400000;
  return (
    days >
    (account.valuationReminderDays ??
      (account.accountType === "property" ? 180 : 90))
  );
}
/** Manual valuations are carried forward as dated observations, never interpolated. */
export function netWorthOverview(
  accounts: Account[],
  statements: Statement[],
  valuations: ManualValuation[],
  date: string,
  currency: string,
  rawTransactions: Transaction[] = [],
) {
  parseDate(date);
  const items = accounts
    .filter((a) => a.currency === currency && a.includeInNetWorth !== false)
    .map((account) => {
      if (account.tracking === "manual") {
        if (["current", "savings"].includes(account.accountType)) {
          const cash = manualCashBalance(
            account,
            valuations,
            rawTransactions,
            date,
          );
          return {
            account,
            value: cash.valueMinor,
            date: cash.date,
            source: "manual" as const,
            complete: cash.valueMinor !== undefined,
            stale: false,
            estimated: false,
          };
        }
        const valuation = latestValuation(account, valuations, date);
        const value = valuation
          ? liabilityTypes.has(account.accountType)
            ? -Math.abs(valuation.valueMinor)
            : valuation.valueMinor
          : undefined;
        return {
          account,
          value,
          date: valuation?.date,
          source: "manual" as const,
          complete:
            !!valuation && !valuationStale(account, valuation.date, date),
          stale: !!valuation && valuationStale(account, valuation.date, date),
          estimated: valuation?.note?.startsWith("Estimated") ?? false,
        };
      }
      const statement = statements
        .filter(
          (s) =>
            s.accountId === account.id &&
            s.currency === currency &&
            statementBalanceDate(s) <= date,
        )
        .sort(
          (a, b) =>
            statementBalanceDate(b).localeCompare(statementBalanceDate(a)) ||
            b.importedAt.localeCompare(a.importedAt),
        )[0];
      return {
        account,
        value: statement?.closingBalance,
        date: statement && statementBalanceDate(statement),
        source: "statement" as const,
        complete:
          statement?.closingBalance !== undefined &&
          statement.validationStatus === "reconciled" &&
          statementBalanceDate(statement).slice(0, 7) === date.slice(0, 7),
        stale: false,
        estimated: false,
      };
    });
  const known = items.filter((i) => i.value !== undefined);
  const complete = items.length > 0 && items.every((i) => i.complete);
  return {
    items,
    total: known.length ? safeSum(known.map((i) => i.value!)) : undefined,
    complete,
    partial: !complete,
    assets: safeSum(known.filter((i) => i.value! >= 0).map((i) => i.value!)),
    liabilities: -safeSum(
      known.filter((i) => i.value! < 0).map((i) => i.value!),
    ),
  };
}
export function netWorthHistory(
  accounts: Account[],
  statements: Statement[],
  valuations: ManualValuation[],
  start: string,
  end: string,
  currency: string,
  rawTransactions: Transaction[] = [],
) {
  const dates = new Set([
    start,
    end,
    ...valuations.map((v) => v.date),
    ...statements.map(statementBalanceDate),
    ...rawTransactions.filter((t) => t.source === "manual").map((t) => t.date),
  ]);
  return [...dates]
    .filter((d) => d >= start && d <= end)
    .sort()
    .map((date) => {
      const result = netWorthOverview(
        accounts,
        statements,
        valuations,
        date,
        currency,
        rawTransactions,
      );
      return { date, total: result.total ?? null, complete: result.complete };
    });
}
/** Monthly amortisation with penny rounding; binary search avoids floating money arithmetic. */
export function estimateMortgage(
  principalMinor: number,
  apr: number,
  termMonths: number,
  elapsedMonths: number,
) {
  if (
    !Number.isSafeInteger(principalMinor) ||
    principalMinor < 0 ||
    !Number.isFinite(apr) ||
    apr < 0 ||
    apr > 100 ||
    !Number.isInteger(termMonths) ||
    termMonths < 1 ||
    termMonths > 600 ||
    !Number.isInteger(elapsedMonths) ||
    elapsedMonths < 0
  )
    throw new Error("Enter a valid principal, APR and term.");
  const basis = BigInt(Math.round(apr * 10000));
  const interest = (balance: bigint) =>
    (balance * basis + 6000000n) / 12000000n;
  const remainder = (payment: bigint, months: number) => {
    let balance = BigInt(principalMinor);
    for (let i = 0; i < months && balance > 0n; i++)
      balance = balance + interest(balance) - payment;
    return balance > 0n ? balance : 0n;
  };
  let low = 0n,
    high = BigInt(principalMinor) + interest(BigInt(principalMinor));
  while (low < high) {
    const mid = (low + high) / 2n;
    if (remainder(mid, termMonths) === 0n) high = mid;
    else low = mid + 1n;
  }
  return {
    paymentMinor: Number(low),
    valueMinor: Number(remainder(low, Math.min(elapsedMonths, termMonths))),
    estimated: true as const,
  };
}
export function monthEnd(month: string) {
  return new Date(Date.parse(`${monthBounds(month)[1]}T00:00:00Z`) - 86400000)
    .toISOString()
    .slice(0, 10);
}
