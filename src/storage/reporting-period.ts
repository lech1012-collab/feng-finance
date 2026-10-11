import type { FinanceDB } from "./database";
import { db } from "./database";
import { auditedMutation } from "./audit";
import {
  PERIOD_SETTING,
  readPeriodStart,
  type PeriodStart,
} from "../domain/period";
export class ClosedPeriodChangeError extends Error {
  constructor(readonly closedCount: number) {
    super("Changing the reporting period requires reopening closed months.");
  }
}
/** A reporting-range change cannot silently retain snapshots of the old ranges. */
export async function changeReportingPeriod(
  value: PeriodStart,
  reopenClosed = false,
  database: FinanceDB = db,
) {
  if (
    !["calendar", "fixed", "payday"].includes(value.mode) ||
    !Number.isInteger(value.day) ||
    value.day < 1 ||
    value.day > 28
  )
    throw new Error("Choose a valid reporting period and a day from 1 to 28.");
  return auditedMutation(
    "Change reporting month",
    ["settings", "monthCloses"],
    async () => {
      const current = readPeriodStart(await database.settings.toArray());
      if (current.mode === value.mode && current.day === value.day)
        return { reopened: 0 };
      const closedCount = await database.monthCloses.count();
      if (closedCount && !reopenClosed)
        throw new ClosedPeriodChangeError(closedCount);
      if (closedCount) await database.monthCloses.clear();
      await database.settings.put({
        key: PERIOD_SETTING,
        value: JSON.stringify(value),
      });
      return { reopened: closedCount };
    },
    database,
  );
}
