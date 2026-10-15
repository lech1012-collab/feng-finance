import type { RecurringSeries, Setting, Transaction } from "../domain/models";
import { recurringDecisions } from "./recurring-identity";
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
export function recurringMatches(
  series: RecurringSeries,
  row: Pick<
    Transaction,
    "accountId" | "currency" | "amount" | "merchant" | "description"
  >,
  settings: Setting[] = [],
) {
  const merchants = [
    recurringMerchant(series),
    ...recurringDecisions(series, settings)
      .filter((d) => d.choice === "same")
      .map((d) => recurringMerchant({ ...series, matchKey: d.matchKey })),
  ];
  return (
    row.accountId === series.accountId &&
    row.currency === series.currency &&
    Math.sign(row.amount) === Math.sign(series.expectedAmountMinor) &&
    merchants.includes(normalizeMerchant(row.merchant || row.description))
  );
}
/** All expected consumers use the same confirmed cadence and due-date anchor. */
export function confirmedPaymentEvents(
  series: RecurringSeries[],
  start: string,
  end: string,
  observed: Transaction[],
  settings: Setting[] = [],
): PlannedPayment[] {
  const events: PlannedPayment[] = [];
  for (const s of series.filter((s) => s.status !== "ignored")) {
    for (let i = 0; i < 400; i++) {
      const date = recurringDate(s.nextDue, s.cadence, i);
      if (date > end || (s.endDate && date > s.endDate)) break;
      if (date <= start) continue;
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
  const separateIds = new Set<string>();
  for (const canonical of series) {
    for (const decision of recurringDecisions(canonical, settings).filter(
      (d) => d.choice === "separate",
    )) {
      const other = series.find(
        (s) =>
          s.matchKey === decision.matchKey &&
          s.accountId === canonical.accountId &&
          s.currency === canonical.currency,
      );
      if (other) {
        separateIds.add(canonical.id);
        separateIds.add(other.id);
      }
    }
  }
  const byId = new Map(series.map((s) => [s.id, s]));
  const source = (event: PlannedPayment) => byId.get(event.id.slice(0, -11))!;
  const eligible = (event: PlannedPayment, row: Transaction) =>
    recurringMatches(source(event), row, settings) &&
    Math.abs(day(row.date) - day(event.date)) <= 5;
  const matched = new Set<string>();
  // An imported payment can fulfil only one bill that the owner kept separate.
  // Exact amounts win, then the nearest date. Other series retain their existing
  // matching behaviour; ledger amounts and classifications are never changed.
  const pairs = events
    .filter((e) => separateIds.has(source(e).id))
    .flatMap((event) =>
      observed
        .filter((row) => eligible(event, row))
        .map((row) => ({
          event,
          row,
          amountDifference: Math.abs(event.amount - row.amount),
          dateDifference: Math.abs(day(event.date) - day(row.date)),
        })),
    );
  pairs.sort(
    (a, b) =>
      a.amountDifference - b.amountDifference ||
      a.dateDifference - b.dateDifference ||
      a.event.id.localeCompare(b.event.id) ||
      a.row.id.localeCompare(b.row.id),
  );
  const usedRows = new Set<string>();
  for (const pair of pairs) {
    if (matched.has(pair.event.id) || usedRows.has(pair.row.id)) continue;
    matched.add(pair.event.id);
    usedRows.add(pair.row.id);
  }
  for (const event of events.filter((e) => !separateIds.has(source(e).id)))
    if (observed.some((row) => eligible(event, row))) matched.add(event.id);
  return events.filter((event) => !matched.has(event.id));
}
