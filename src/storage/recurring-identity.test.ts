import { afterEach, beforeEach, expect, it } from "vitest";
import { FinanceDB, initializeDatabase } from "./database";
import { undoChange } from "./audit";
import { saveRecurringMatchDecision } from "./recurring-identity";
import {
  recurringDecisionKey,
  resolveRecurringSeries,
} from "../analytics/recurring-identity";
import { accounts, transaction } from "../tests/helpers";
import { createBackup, restoreBackup } from "./backup";
import { confirmedPaymentEvents } from "../analytics/recurring-events";
import { savedBill, detectedBill } from "../tests/recurring-fixtures";
let database: FinanceDB;
beforeEach(async () => {
  database = new FinanceDB(`recurring-match-${crypto.randomUUID()}`);
  await initializeDatabase(database);
  await database.accounts.put(accounts[0]);
  await database.recurringSeries.put(savedBill);
  await database.transactions.put(transaction());
});
afterEach(async () => {
  await database.delete();
});
it("persists an explicit identity with Undo and never edits accounts, series or ledger rows", async () => {
  const before = await database.transactions.toArray();
  const result = await saveRecurringMatchDecision(
    savedBill.id,
    detectedBill,
    "same",
    database,
  );
  const settings = await database.settings.toArray();
  expect(
    resolveRecurringSeries([savedBill], [detectedBill], settings).series,
  ).toHaveLength(1);
  expect(await database.recurringSeries.get(savedBill.id)).toEqual(savedBill);
  expect(await database.transactions.toArray()).toEqual(before);
  await undoChange(result.changeId, database);
  expect(
    await database.settings.get(
      await recurringDecisionKey(savedBill.id, detectedBill.matchKey),
    ),
  ).toBeUndefined();
  expect(
    resolveRecurringSeries(
      [savedBill],
      [detectedBill],
      await database.settings.toArray(),
    ).proposals,
  ).toHaveLength(1);
});
it("remembers separate bills and rejects a changed or unrelated canonical identity", async () => {
  const receipt = await saveRecurringMatchDecision(
    savedBill.id,
    detectedBill,
    "separate",
    database,
  );
  const series = await database.recurringSeries.toArray();
  expect(series).toHaveLength(2);
  expect(
    confirmedPaymentEvents(
      series,
      "2026-10-01",
      "2026-10-31",
      [],
      await database.settings.toArray(),
    ),
  ).toHaveLength(2);
  expect(
    resolveRecurringSeries(
      [savedBill],
      [detectedBill],
      await database.settings.toArray(),
    ).proposals,
  ).toHaveLength(0);
  await expect(
    saveRecurringMatchDecision(
      savedBill.id,
      { ...detectedBill, accountId: "another" },
      "same",
      database,
    ),
  ).rejects.toThrow("changed");
  await undoChange(receipt.changeId, database);
  expect(await database.recurringSeries.toArray()).toEqual([savedBill]);
});

it("preserves the explicit same-bill decision through a validated JSON backup and restore", async () => {
  await database.transactions.clear();
  await saveRecurringMatchDecision(
    savedBill.id,
    detectedBill,
    "same",
    database,
  );
  const backup = await createBackup({}, database);
  const restored = new FinanceDB(`restored-match-${crypto.randomUUID()}`);
  try {
    await restoreBackup(JSON.parse(JSON.stringify(backup)), restored);
    expect(
      resolveRecurringSeries(
        await restored.recurringSeries.toArray(),
        [detectedBill],
        await restored.settings.toArray(),
      ).series,
    ).toHaveLength(1);
  } finally {
    await restored.delete();
  }
});

it("keeps long bank descriptions within backup identifier limits and preserves separate bills", async () => {
  await database.transactions.clear();
  const candidate = {
    ...detectedBill,
    id: `detected:${"x".repeat(500)}`,
    matchKey: JSON.stringify([
      "a1",
      "GBP",
      `NETFLIX ${"X".repeat(500)}`,
      false,
    ]),
  };
  await saveRecurringMatchDecision(
    savedBill.id,
    candidate,
    "separate",
    database,
  );
  const backup = await createBackup({}, database);
  expect(backup.recurringSeries).toHaveLength(2);
  expect(backup.recurringSeries?.every((s) => s.id.length <= 200)).toBe(true);
  expect(
    backup.settings
      .filter((s) => s.key.startsWith("recurring:match:"))
      .every((s) => s.key.length <= 200),
  ).toBe(true);
});
