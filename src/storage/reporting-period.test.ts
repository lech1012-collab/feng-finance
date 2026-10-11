import { afterEach, beforeEach, expect, it } from "vitest";
import { FinanceDB } from "./database";
import {
  changeReportingPeriod,
  ClosedPeriodChangeError,
} from "./reporting-period";
import { readPeriodStart } from "../domain/period";
import { undoChange } from "./audit";
let database: FinanceDB;
beforeEach(async () => {
  database = new FinanceDB(`period-safety-${crypto.randomUUID()}`);
  await database.monthCloses.add({
    month: "2026-08",
    currency: "GBP",
    closedAt: "2026-10-08T00:00:00.000Z",
    snapshot: {
      income: 0,
      expenses: 4000,
      net: -4000,
      transactionCount: 1,
      categoryTotals: { shopping: 4000 },
    },
  });
});
afterEach(async () => {
  database.close();
  await database.delete();
});
it("refuses to change reporting ranges while retaining closed snapshots", async () => {
  const before = await database.monthCloses.toArray();
  await expect(
    changeReportingPeriod({ mode: "fixed", day: 25 }, false, database),
  ).rejects.toBeInstanceOf(ClosedPeriodChangeError);
  expect(readPeriodStart(await database.settings.toArray())).toEqual({
    mode: "calendar",
    day: 1,
  });
  expect(await database.monthCloses.toArray()).toEqual(before);
  expect(await database.changeLog.count()).toBe(0);
});
it("atomically reopens all closed months and changes range with one Undo", async () => {
  const before = await database.monthCloses.toArray();
  const changed = await changeReportingPeriod(
    { mode: "fixed", day: 25 },
    true,
    database,
  );
  expect(changed.result.reopened).toBe(1);
  expect(await database.monthCloses.count()).toBe(0);
  expect(readPeriodStart(await database.settings.toArray())).toEqual({
    mode: "fixed",
    day: 25,
  });
  expect(await database.changeLog.count()).toBe(1);
  await undoChange(changed.changeId, database);
  expect(readPeriodStart(await database.settings.toArray())).toEqual({
    mode: "calendar",
    day: 1,
  });
  expect(await database.monthCloses.toArray()).toEqual(before);
});
it("does not reopen a month for an unchanged setting", async () => {
  const result = await changeReportingPeriod(
    { mode: "calendar", day: 1 },
    false,
    database,
  );
  expect(result.changeId).toBe("");
  expect(await database.monthCloses.count()).toBe(1);
});
