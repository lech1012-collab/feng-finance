import { afterEach, beforeEach, expect, it } from "vitest";
import { FinanceDB, initializeDatabase } from "./database";
import {
  saveManualAccount,
  savePot,
  confirmPotContribution,
  saveMonthlyBudget,
  saveScenario,
} from "./planning-v2";
import { undoChange } from "./audit";
import type { Pot, Scenario } from "../domain/models";
let database: FinanceDB;
beforeEach(async () => {
  database = new FinanceDB(`planning-${crypto.randomUUID()}`);
  await initializeDatabase(database);
});
afterEach(async () => {
  await database.delete();
});
it("saves manual values and atomically undoes both account and valuation", async () => {
  const saved = await saveManualAccount(
    {
      name: "Home",
      type: "property",
      currency: "GBP",
      date: "2026-06-01",
      valueMinor: 45000000,
    },
    database,
  );
  expect(await database.accounts.count()).toBe(1);
  expect(await database.valuations.count()).toBe(1);
  await undoChange(saved.changeId, database);
  expect(await database.accounts.count()).toBe(0);
  expect(await database.valuations.count()).toBe(0);
});
it("upserts a month contribution, backs it with one Undo record and never changes cash transactions", async () => {
  const pot: Pot = {
    id: "p",
    name: "Insurance",
    type: "sinking",
    currency: "GBP",
    targetMinor: 54000,
    targetDate: "2027-03-15",
    createdAt: "2026-10-01",
    contributions: [],
  };
  await savePot(pot, database);
  await confirmPotContribution(pot.id, "2026-10", 9000, database);
  const change = await confirmPotContribution(
    pot.id,
    "2026-10",
    9500,
    database,
  );
  expect((await database.pots.get(pot.id))?.contributions).toEqual([
    { month: "2026-10", amountMinor: 9500 },
  ]);
  expect(await database.transactions.count()).toBe(0);
  await undoChange(change.changeId, database);
  expect((await database.pots.get(pot.id))?.contributions[0].amountMinor).toBe(
    9000,
  );
});
it("stores one monthly budget per category, month and currency", async () => {
  await saveMonthlyBudget(
    {
      id: "a",
      categoryId: "groceries",
      month: "2026-09",
      currency: "GBP",
      amountMinor: 30000,
      rollover: "surplus",
    },
    database,
  );
  await saveMonthlyBudget(
    {
      id: "b",
      categoryId: "groceries",
      month: "2026-09",
      currency: "GBP",
      amountMinor: 34000,
      rollover: "both",
    },
    database,
  );
  expect(await database.budgets.count()).toBe(1);
  expect((await database.budgets.toArray())[0].amountMinor).toBe(34000);
});
it("rejects the sixth saved scenario and allows updating an existing one", async () => {
  for (let i = 0; i < 5; i++) {
    const scenario: Scenario = {
      id: `s${i}`,
      name: `Scenario ${i}`,
      createdAt: "2026-10-01",
      changes: [
        {
          id: `x${i}`,
          date: "2026-11-15",
          type: "one-off",
          amountMinor: -120000,
          description: "Holiday",
        },
      ],
    };
    await saveScenario(scenario, database);
  }
  const original = (await database.scenarios.get("s0"))!;
  await expect(
    saveScenario({ ...original, id: "s6" }, database),
  ).rejects.toThrow("up to five");
  await saveScenario({ ...original, name: "Updated" }, database);
  expect(await database.scenarios.count()).toBe(5);
});
it("rejects invalid negative goals and fractional balances without database writes", async () => {
  await expect(
    saveManualAccount(
      {
        name: "House",
        type: "property",
        currency: "GBP",
        date: "2026-06-01",
        valueMinor: 123.5,
      },
      database,
    ),
  ).rejects.toThrow();
  expect(await database.accounts.count()).toBe(0);
});
it("refuses to relabel existing valuation history into another currency", async () => {
  const result = await saveManualAccount(
    {
      name: "House",
      type: "property",
      currency: "GBP",
      date: "2026-06-01",
      valueMinor: 45000000,
    },
    database,
  );
  await expect(
    saveManualAccount(
      {
        id: result.result.id,
        name: "House",
        type: "property",
        currency: "EUR",
        date: "2026-10-01",
        valueMinor: 45000000,
      },
      database,
    ),
  ).rejects.toThrow("original currency");
  expect((await database.accounts.get(result.result.id))?.currency).toBe("GBP");
  expect(await database.valuations.count()).toBe(1);
});
