import type { Setting, Transaction } from "../domain/models";
import { reportingPeriod, readPeriodStart } from "../domain/period";
import { monthBounds, monthOffset } from "../domain/dates";

export const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);

export function monthsInRange(start: string, end: string) {
  if (!start || !end || start >= end) return [];
  const months: string[] = [];
  for (
    let month = start.slice(0, 7);
    `${month}-01` < end;
    month = monthOffset(month, 1)
  )
    months.push(month);
  return months;
}

/** A single date scope drives the totals, chart and lists. End is exclusive. */
export function analysisPeriod(
  month: string,
  period: string,
  customFrom: string,
  customTo: string,
  settings: Setting[] = [],
  transactions: Transaction[] = [],
) {
  const taxYear =
    Number(month.slice(0, 4)) - (Number(month.slice(5, 7)) < 4 ? 1 : 0);
  const aligned = readPeriodStart(settings).mode !== "calendar";
  const start =
    period === "tax"
      ? `${taxYear}-04-06`
      : period === "custom"
        ? customFrom
        : period === "ytd" || period === "annual"
          ? `${month.slice(0, 4)}-01-01`
          : reportingPeriod(
              monthOffset(month, 1 - Number(period)),
              settings,
              transactions,
            )[0];
  const end =
    period === "tax"
      ? `${taxYear + 1}-04-06`
      : period === "custom"
        ? customTo
          ? shiftDate(customTo, 1)
          : ""
        : period === "annual"
          ? `${Number(month.slice(0, 4)) + 1}-01-01`
          : reportingPeriod(month, settings, transactions)[1];
  const months =
    aligned && /^\d+$/.test(period)
      ? Array.from({ length: Number(period) }, (_, i) =>
          monthOffset(month, i - Number(period) + 1),
        )
      : monthsInRange(start, end);
  const days = months.length
    ? (Date.parse(end) - Date.parse(start)) / 86400000
    : 0;
  const previousStart =
    period === "custom" || period === "tax"
      ? months.length
        ? shiftDate(start, -days)
        : ""
      : months.length
        ? aligned
          ? reportingPeriod(
              monthOffset(month, 1 - months.length * 2),
              settings,
              transactions,
            )[0]
          : `${monthOffset(start.slice(0, 7), -months.length)}-01`
        : "";
  return {
    start,
    end,
    months,
    previousStart,
    previousEnd: start,
    valid: months.length > 0,
  };
}
