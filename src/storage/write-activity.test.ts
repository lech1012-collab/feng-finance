import { afterEach, expect, it } from "vitest";
import { FinanceDB } from "./database";
import { auditedMutation, keepAuditAlive } from "./audit";
import {
  hasPendingFinancialWrites,
  subscribeFinancialWrites,
  duringFinancialWrite,
} from "./write-activity";
import { transaction } from "../tests/helpers";
import { mayShowUpdate } from "../beta/policy";

const databases: FinanceDB[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) await database.delete();
  expect(hasPendingFinancialWrites()).toBe(false);
});

it("withholds a Home reload until a held financial write has committed", async () => {
  const database = new FinanceDB(`pending-write-${crypto.randomUUID()}`);
  databases.push(database);
  await database.transactions.put(transaction());
  let release!: () => void;
  let started!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  const statuses: boolean[] = [];
  const unsubscribe = subscribeFinancialWrites(() =>
    statuses.push(hasPendingFinancialWrites()),
  );
  try {
    const save = auditedMutation(
      "Save held note",
      ["transactions"],
      async () => {
        started();
        await keepAuditAlive(hold);
        return database.transactions.update("t1", {
          note: "Fictitious saved note",
        });
      },
      database,
    );
    await begun;
    expect(hasPendingFinancialWrites()).toBe(true);
    expect(mayShowUpdate("/", hasPendingFinancialWrites(), false)).toBe(false);
    release();
    await save;
    expect((await database.transactions.get("t1"))?.note).toBe(
      "Fictitious saved note",
    );
    expect(await database.changeLog.count()).toBe(1);
    expect(hasPendingFinancialWrites()).toBe(false);
    expect(mayShowUpdate("/", hasPendingFinancialWrites(), false)).toBe(true);
    expect(statuses).toEqual([true, false]);
  } finally {
    release();
    unsubscribe();
  }
});

it("keeps overlapping writes active and releases activity after rejection", async () => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = duringFinancialWrite(() => hold);
  await expect(
    duringFinancialWrite(async () => {
      throw new Error("Fictitious failed write");
    }),
  ).rejects.toThrow("Fictitious failed write");
  expect(hasPendingFinancialWrites()).toBe(true);
  release();
  await first;
  expect(hasPendingFinancialWrites()).toBe(false);
});
