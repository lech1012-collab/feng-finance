import { afterEach, beforeEach, expect, it } from "vitest";
import { db, initializeDatabase } from "./database";
import { createTagForTransaction } from "./tags";
import { undoChange } from "./audit";
import { accounts, transaction } from "../tests/helpers";
beforeEach(async () => {
  await db.delete();
  await db.open();
  await initializeDatabase();
  await db.accounts.put(accounts[0]);
  await db.transactions.put(transaction());
});
afterEach(async () => {
  await db.delete();
});
it("creates and attaches a tag atomically; one Undo removes both changes without altering money", async () => {
  const before = await db.transactions.get("t1");
  const result = await createTagForTransaction("t1", "Family trip");
  expect((await db.transactions.get("t1"))?.tags).toEqual([
    result.result.tag.id,
  ]);
  expect((await db.transactions.get("t1"))?.amount).toBe(before?.amount);
  await undoChange(result.changeId);
  expect(await db.tags.get(result.result.tag.id)).toBeUndefined();
  expect(await db.transactions.get("t1")).toEqual(before);
});
it("rejects duplicate names or missing transactions without leaving a tag behind", async () => {
  await createTagForTransaction("t1", "Family trip");
  await expect(createTagForTransaction("t1", "family TRIP")).rejects.toThrow(
    "already exists",
  );
  await expect(
    createTagForTransaction("missing", "Other trip"),
  ).rejects.toThrow("no longer exists");
  expect(await db.tags.count()).toBe(1);
});
