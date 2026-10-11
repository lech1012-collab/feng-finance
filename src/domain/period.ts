import type { Setting, Transaction } from "./models";
import { monthBounds, monthOffset, isoDate, formatDateRange } from "./dates";
export const PERIOD_SETTING = "period:start";
export type PeriodStart = {
  mode: "calendar" | "fixed" | "payday";
  day: number;
};
export function readPeriodStart(settings: Setting[]): PeriodStart {
  try {
    const value = JSON.parse(
      settings.find((s) => s.key === PERIOD_SETTING)?.value ?? "null",
    ) as PeriodStart | null;
    if (
      value &&
      ["calendar", "fixed", "payday"].includes(value.mode) &&
      Number.isInteger(value.day) &&
      value.day >= 1 &&
      value.day <= 28
    )
      return value;
  } catch {
    /* Older settings use calendar months. */
  }
  return { mode: "calendar", day: 1 };
}
function payday(month: string, transactions: Transaction[]) {
  const salary = transactions
    .filter(
      (t) =>
        t.categoryId === "salary" && t.amount > 0 && t.date.startsWith(month),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  if (salary) return salary.date;
  const end = new Date(`${monthBounds(month)[1]}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  while (end.getUTCDay() === 0 || end.getUTCDay() === 6)
    end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}
/** A label names the month in which a payday-aligned period ends. End is exclusive. */
export function reportingPeriod(
  month: string,
  settings: Setting[] = [],
  transactions: Transaction[] = [],
): [string, string] {
  const rule = readPeriodStart(settings);
  if (rule.mode === "calendar") return monthBounds(month);
  const previous = monthOffset(month, -1);
  if (rule.mode === "payday")
    return [payday(previous, transactions), payday(month, transactions)];
  const date = (m: string) =>
    isoDate(Number(m.slice(0, 4)), Number(m.slice(5, 7)), rule.day);
  return [date(previous), date(month)];
}
export function periodMonth(
  date: string,
  settings: Setting[] = [],
  transactions: Transaction[] = [],
) {
  const month = date.slice(0, 7);
  for (const candidate of [
    monthOffset(month, -1),
    month,
    monthOffset(month, 1),
    monthOffset(month, 2),
  ]) {
    const [from, to] = reportingPeriod(candidate, settings, transactions);
    if (date >= from && date < to) return candidate;
  }
  return month;
}
export function inReportingPeriod(
  date: string,
  month: string,
  settings: Setting[] = [],
  transactions: Transaction[] = [],
) {
  const [from, to] = reportingPeriod(month, settings, transactions);
  return date >= from && date < to;
}
export function reportingPeriodLabel(
  month: string,
  settings: Setting[] = [],
  transactions: Transaction[] = [],
) {
  const [from, to] = reportingPeriod(month, settings, transactions);
  const last = new Date(Date.parse(`${to}T12:00:00Z`) - 86400000)
    .toISOString()
    .slice(0, 10);
  return formatDateRange(from, last);
}
