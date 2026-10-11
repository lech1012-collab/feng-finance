import type {
  Account,
  FxRate,
  ManualValuation,
  Statement,
  Transaction,
} from "../domain/models";
import { monthBounds } from "../domain/dates";
import { safeSum } from "../domain/money";
import { datedBalanceHistory } from "./balances";
import { ledgerTransactions } from "./effective-transactions";
import { convertMinor, workingDayAge } from "./fx";
import { latestValuation, liabilityTypes, valuationStale } from "./net-worth";
import { manualCashBalance } from "./manual-cash";
import {
  statementBalanceDate,
  statementBalanceEvidence,
} from "./statement-balances";

const dayMs = 86400000;
const stamp = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (value: number) => new Date(value).toISOString().slice(0, 10);
function previousDate(date: string, months: number) {
  const d = new Date(`${date}T00:00:00Z`);
  const target = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, 1),
  );
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return iso(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      Math.min(d.getUTCDate(), last),
    ),
  );
}
export interface ReportingBalancePoint {
  date: string;
  values: Record<string, number | null>;
  nativeValues: Record<string, number | null>;
  verified: Record<string, boolean>;
  total: number | null;
  complete: boolean;
  cash: number | null;
  rateDates: Record<string, string | undefined>;
}
/** Bank positions come from reconciled native ledgers, never transaction/category projections.
 * Issue-date-only cards retain exactly one observation. Manual assets carry their dated
 * observations forward as steps; no bank value is carried through missing coverage. */
export function reportingBalanceHistory(
  accounts: Account[],
  statements: Statement[],
  rawTransactions: Transaction[],
  valuations: ManualValuation[],
  rates: FxRate[],
  month: string,
  currency: string,
  period: number,
  today = new Date().toISOString().slice(0, 10),
) {
  const included = accounts.filter((a) => a.includeInNetWorth !== false);
  const bankAccounts = included.filter((a) => a.tracking !== "manual");
  const bankRows = ledgerTransactions(rawTransactions).filter(
    (t) => t.source !== "manual",
  );
  const rowsByStatement = new Map<string, Transaction[]>();
  for (const t of bankRows) {
    const rows = rowsByStatement.get(t.statementId) ?? [];
    rows.push(t);
    rowsByStatement.set(t.statementId, rows);
  }
  const monthEnd = iso(stamp(monthBounds(month)[1]) - dayMs),
    asOf = monthEnd < today ? monthEnd : today;
  const observations = [
    ...statements
      .filter(
        (s) =>
          included.some((a) => a.id === s.accountId) &&
          statementBalanceDate(s) <= asOf,
      )
      .map(statementBalanceDate),
    ...valuations
      .filter(
        (v) => included.some((a) => a.id === v.accountId) && v.date <= asOf,
      )
      .map((v) => v.date),
    ...rawTransactions
      .filter(
        (t) =>
          t.source === "manual" &&
          t.date <= asOf &&
          included.some(
            (a) =>
              a.id === t.accountId &&
              a.tracking === "manual" &&
              ["current", "savings"].includes(a.accountType),
          ),
      )
      .map((t) => t.date),
  ];
  const end = observations.sort().at(-1) ?? asOf,
    start = previousDate(end, period);
  const nativeByAccount = new Map<
    string,
    Map<string, { value: number | null; verified: boolean }>
  >();
  const valid = statements.filter(
    (s) =>
      statementBalanceDate(s) <= asOf &&
      statementBalanceEvidence(s, rowsByStatement.get(s.id) ?? [], today)
        .status === "reconciled",
  );
  for (const native of new Set(bankAccounts.map((a) => a.currency))) {
    const scoped = bankAccounts.filter((a) => a.currency === native);
    const history = datedBalanceHistory(
      scoped,
      valid,
      bankRows,
      month,
      native,
      Math.max(1, period),
      today,
    );
    for (const [index, account] of scoped.entries()) {
      const points = new Map<
        string,
        { value: number | null; verified: boolean }
      >();
      for (const point of history.data)
        points.set(point.date, {
          value: point.balances[`account${index}`],
          verified: point.balances[`account${index}`] !== null,
        });
      nativeByAccount.set(account.id, points);
    }
  }
  // An unreconciled printed closing balance remains one clearly unverified observation.
  for (const statement of statements.filter(
    (s) =>
      bankAccounts.some((a) => a.id === s.accountId) &&
      statementBalanceDate(s) <= asOf &&
      Number.isSafeInteger(s.closingBalance) &&
      !valid.some((v) => v.id === s.id),
  )) {
    const values =
      nativeByAccount.get(statement.accountId) ??
      new Map<string, { value: number | null; verified: boolean }>();
    const date = statementBalanceDate(statement),
      previous = values.get(date);
    values.set(date, {
      value:
        previous?.value !== undefined &&
        previous.value !== null &&
        previous.value !== statement.closingBalance
          ? null
          : statement.closingBalance!,
      verified: false,
    });
    nativeByAccount.set(statement.accountId, values);
  }
  const cashAccounts = included.filter((a) =>
    ["current", "savings"].includes(a.accountType),
  );
  const hasManualAssets = included.some(
    (a) =>
      a.tracking === "manual" &&
      !["current", "savings"].includes(a.accountType),
  );
  const data: ReportingBalancePoint[] = [];
  for (const account of included.filter(
    (a) =>
      a.tracking === "manual" && ["current", "savings"].includes(a.accountType),
  )) {
    const walletRows = ledgerTransactions(rawTransactions).filter(
      (t) => t.accountId === account.id && t.source === "manual",
    );
    const walletValuations = valuations.filter(
      (v) => v.accountId === account.id,
    );
    const changes = new Map<string, number>();
    for (const t of walletRows)
      changes.set(t.date, safeSum([changes.get(t.date) ?? 0, t.amount]));
    const initial = manualCashBalance(
      account,
      walletValuations,
      walletRows,
      start,
    );
    const timeline = new Map<
      string,
      { value: number | null; verified: boolean }
    >();
    let value = initial.valueMinor;
    for (let time = stamp(start); time <= stamp(end); time += dayMs) {
      const date = iso(time),
        valuation = walletValuations.filter((v) => v.date === date).at(-1);
      if (valuation)
        value = safeSum([
          valuation.valueMinor,
          valuation.note === "Cash opening balance"
            ? (changes.get(date) ?? 0)
            : 0,
        ]);
      else if (time > stamp(start) && value !== undefined)
        value = safeSum([value, changes.get(date) ?? 0]);
      timeline.set(date, {
        value: value ?? null,
        verified: value !== undefined,
      });
    }
    nativeByAccount.set(account.id, timeline);
  }
  for (let time = stamp(start); time <= stamp(end); time += dayMs) {
    const date = iso(time),
      values: ReportingBalancePoint["values"] = {},
      nativeValues: ReportingBalancePoint["nativeValues"] = {},
      verified: ReportingBalancePoint["verified"] = {},
      rateDates: ReportingBalancePoint["rateDates"] = {};
    for (const account of included) {
      let amount: number | undefined | null,
        reliable = false;
      if (account.tracking === "manual") {
        if (["current", "savings"].includes(account.accountType)) {
          const cash = nativeByAccount.get(account.id)?.get(date);
          amount = cash?.value;
          reliable = cash?.verified ?? false;
        } else {
          const valuation = latestValuation(account, valuations, date);
          amount = valuation
            ? liabilityTypes.has(account.accountType)
              ? -Math.abs(valuation.valueMinor)
              : valuation.valueMinor
            : undefined;
          reliable =
            !!valuation &&
            !valuationStale(account, valuation.date, date) &&
            !valuation.note?.startsWith("Estimated");
        }
      } else {
        const observation = nativeByAccount.get(account.id)?.get(date);
        amount = observation?.value;
        reliable = observation?.verified ?? false;
      }
      nativeValues[account.id] = amount ?? null;
      const conversion =
        amount == null
          ? undefined
          : convertMinor(amount, account.currency, currency, date, rates);
      values[account.id] = conversion?.amount ?? null;
      rateDates[account.id] = conversion?.date;
      verified[account.id] =
        reliable &&
        !!conversion &&
        (account.currency === currency ||
          workingDayAge(conversion.date, date) <= 3);
    }
    const known = Object.values(values),
      cashKnown = cashAccounts.map((a) => values[a.id]);
    const cash =
      cashKnown.length && cashKnown.every((v) => v !== null)
        ? safeSum(cashKnown as number[])
        : null;
    const total =
      known.length &&
      known.every((v) => v !== null) &&
      (cash !== null || hasManualAssets)
        ? safeSum(known as number[])
        : null;
    data.push({
      date,
      values,
      nativeValues,
      verified,
      rateDates,
      cash,
      total,
      complete:
        total !== null &&
        Object.values(verified).every(Boolean) &&
        cashAccounts.length > 0,
    });
  }
  return {
    data,
    start,
    end,
    accounts: included,
    meaningful: included.some(
      (a) => data.filter((p) => p.values[a.id] !== null).length >= 2,
    ),
    converted: included.some((a) => a.currency !== currency),
  };
}
