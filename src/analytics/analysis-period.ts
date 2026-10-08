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
) {
  const start =
    period === "custom"
      ? customFrom
      : period === "ytd" || period === "annual"
        ? `${month.slice(0, 4)}-01-01`
        : monthBounds(monthOffset(month, 1 - Number(period)))[0];
  const end =
    period === "custom"
      ? customTo
        ? shiftDate(customTo, 1)
        : ""
      : period === "annual"
        ? `${Number(month.slice(0, 4)) + 1}-01-01`
        : monthBounds(month)[1];
  const months = monthsInRange(start, end);
  const days = months.length
    ? (Date.parse(end) - Date.parse(start)) / 86400000
    : 0;
  const previousStart =
    period === "custom"
      ? months.length
        ? shiftDate(start, -days)
        : ""
      : months.length
        ? `${monthOffset(start.slice(0, 7), -months.length)}-01`
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
