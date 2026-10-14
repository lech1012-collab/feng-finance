import type { RecurringSeries } from "../domain/models";
import {
  compatibleRecurringBills,
  recurringDecisionKey,
  type RecurringMatchDecision,
} from "../analytics/recurring-identity";
import { db, type FinanceDB } from "./database";
import { auditedMutation } from "./audit";
import { parseDate } from "../domain/dates";
import { recurringSchema } from "./backup-schema";

/** Only records an explicit identity decision. Ledger rows and amounts are never written. */
export async function saveRecurringMatchDecision(
  seriesId: string,
  candidate: RecurringSeries,
  choice: "same" | "separate",
  database: FinanceDB = db,
) {
  if (!["same", "separate"].includes(choice))
    throw new Error("Choose whether these are the same bill.");
  const key = await recurringDecisionKey(seriesId, candidate.matchKey);
  return auditedMutation(
    "Confirm recurring bill match",
    ["recurringSeries", "settings", "accounts"],
    async () => {
      const series = await database.recurringSeries.get(seriesId);
      if (
        !series ||
        series.status === "ignored" ||
        !compatibleRecurringBills(series, candidate)
      )
        throw new Error(
          "This recurring payment changed. Review it again before matching.",
        );
      if (choice === "separate") {
        parseDate(candidate.nextDue);
        if (
          !Number.isSafeInteger(candidate.expectedAmountMinor) ||
          candidate.id === series.id
        )
          throw new Error(
            "Review the detected recurring payment before confirming it.",
          );
        // Persist the second confirmed bill so every forecast consumer retains
        // both identities. No imported row, category or amount is changed.
        const existing = await database.recurringSeries
          .filter(
            (s) =>
              s.matchKey === candidate.matchKey &&
              s.accountId === candidate.accountId &&
              s.currency === candidate.currency,
          )
          .first();
        if (
          existing &&
          (existing.matchKey !== candidate.matchKey ||
            existing.accountId !== candidate.accountId ||
            existing.currency !== candidate.currency)
        )
          throw new Error(
            "The detected recurring payment changed. Review it again.",
          );
        if (!existing) {
          const account = await database.accounts.get(series.accountId);
          if (!account || account.currency !== series.currency)
            throw new Error("The recurring account changed. Review it again.");
          await database.recurringSeries.put(
            recurringSchema.parse({
              ...candidate,
              id: crypto.randomUUID(),
              isDemo: account.isDemo,
            }),
          );
        }
      }
      const decision: RecurringMatchDecision = {
        seriesId,
        matchKey: candidate.matchKey,
        accountId: series.accountId,
        currency: series.currency,
        cadence: series.cadence,
        direction: Math.sign(series.expectedAmountMinor),
        choice,
      };
      await database.settings.put({
        key,
        value: JSON.stringify(decision),
      });
    },
    database,
  );
}
