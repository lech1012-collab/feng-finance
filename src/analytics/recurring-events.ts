import type { RecurringSeries, Transaction } from "../domain/models";
import { monthBounds, monthOffset } from "../domain/dates";
import { normalizeMerchant } from "../domain/normalize";
import type { PlannedPayment } from "./planning";

const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86400000;
export function recurringDate(
  date: string,
  cadence: RecurringSeries["cadence"],
  count = 1,
) {
  if (cadence === "weekly")
    return new Date((day(date) + 7 * count) * 86400000)
      .toISOString()
      .slice(0, 10);
  const month = monthOffset(
    date.slice(0, 7),
    count * (cadence === "monthly" ? 1 : cadence === "quarterly" ? 3 : 12),
  );
  const last = day(monthBounds(month)[1]) - day(`${month}-01`);
  return `${month}-${String(Math.min(Number(date.slice(8)), last)).padStart(2, "0")}`;
}
export function recurringMerchant(series: RecurringSeries) {
  try {
    const key: unknown = JSON.parse(series.matchKey);
    if (Array.isArray(key) && typeof key[2] === "string")
      return normalizeMerchant(key[2]);
  } catch {
    /* A manually entered series uses its name. */
  }
  return normalizeMerchant(series.name);
}
export function recurringMatches(series: RecurringSeries, row: Transaction) {
  return (
    row.accountId === series.accountId &&
    row.currency === series.currency &&
    Math.sign(row.amount) === Math.sign(series.expectedAmountMinor) &&
    normalizeMerchant(row.merchant || row.description) ===
      recurringMerchant(series)
  );
}
/** All expected consumers use the same confirmed cadence and due-date anchor. */
export function confirmedPaymentEvents(
  series: RecurringSeries[],
  start: string,
  end: string,
  observed: Transaction[],
): PlannedPayment[] {
  const events: PlannedPayment[] = [];
  for (const s of series.filter((s) => s.status !== "ignored")) {
    for (let i = 0; i < 400; i++) {
      const date = recurringDate(s.nextDue, s.cadence, i);
      if (date > end || (s.endDate && date > s.endDate)) break;
      if (date <= start) continue;
      if (
        observed.some(
          (row) =>
            recurringMatches(s, row) &&
            Math.abs(day(row.date) - day(date)) <= 5,
        )
      )
        continue;
      events.push({
        id: `${s.id}:${date}`,
        group: s.matchKey,
        accountId: s.accountId,
        merchant: s.name,
        date,
        amount: s.expectedAmountMinor,
        cadence: s.cadence,
        evidence: s.amountHistory.length,
      });
    }
  }
  return events;
}
