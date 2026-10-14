import type { RecurringSeries, Setting } from "../domain/models";
import { displayMerchant } from "../domain/presentation";
import { sha256 } from "../domain/normalize";

export interface RecurringMatchDecision {
  seriesId: string;
  matchKey: string;
  accountId: string;
  currency: string;
  cadence: RecurringSeries["cadence"];
  direction: number;
  choice: "same" | "separate";
}

export const recurringDecisionKey = async (
  seriesId: string,
  matchKey: string,
) =>
  `recurring:match:${await sha256(new TextEncoder().encode(JSON.stringify([seriesId, matchKey])))}`;

const displayName = (s: RecurringSeries) =>
  displayMerchant({ merchant: s.name, description: s.name }).toLocaleLowerCase(
    "en-GB",
  );

/** Similar names propose a choice; they never establish identity on their own. */
export function compatibleRecurringBills(
  a: RecurringSeries,
  b: RecurringSeries,
) {
  return (
    a.matchKey !== b.matchKey &&
    a.accountId === b.accountId &&
    a.currency === b.currency &&
    a.cadence === b.cadence &&
    Math.sign(a.expectedAmountMinor) === Math.sign(b.expectedAmountMinor) &&
    displayName(a) === displayName(b)
  );
}

export function recurringDecisions(
  series: RecurringSeries,
  settings: Setting[],
): RecurringMatchDecision[] {
  const result: RecurringMatchDecision[] = [];
  for (const setting of settings) {
    if (!/^recurring:match:[a-f0-9]{64}$/.test(setting.key)) continue;
    try {
      const d: unknown = JSON.parse(setting.value);
      if (!d || typeof d !== "object") continue;
      const r = d as Partial<RecurringMatchDecision>;
      if (
        r.seriesId === series.id &&
        typeof r.matchKey === "string" &&
        r.accountId === series.accountId &&
        r.currency === series.currency &&
        r.cadence === series.cadence &&
        r.direction === Math.sign(series.expectedAmountMinor) &&
        (r.choice === "same" || r.choice === "separate")
      )
        result.push(r as RecurringMatchDecision);
    } catch {
      /* An invalid local decision cannot combine bills. */
    }
  }
  return result;
}

export function resolveRecurringSeries(
  confirmed: RecurringSeries[],
  detected: RecurringSeries[],
  settings: Setting[],
) {
  const series = [...confirmed];
  const proposals: { confirmed: RecurringSeries; detected: RecurringSeries }[] =
    [];
  for (const candidate of detected) {
    if (
      confirmed.some(
        (s) =>
          s.accountId === candidate.accountId &&
          s.currency === candidate.currency &&
          (s.matchKey === candidate.matchKey ||
            recurringDecisions(s, settings).some(
              (d) => d.matchKey === candidate.matchKey && d.choice === "same",
            )),
      )
    )
      continue;
    series.push(candidate);
    const match = confirmed.find(
      (s) =>
        s.status !== "ignored" &&
        compatibleRecurringBills(s, candidate) &&
        !recurringDecisions(s, settings).some(
          (d) => d.matchKey === candidate.matchKey,
        ),
    );
    if (match) proposals.push({ confirmed: match, detected: candidate });
  }
  return { series, proposals };
}
