import { expect, it, vi } from "vitest";
import { db } from "./database";
import { clearLocalData } from "./backup";
import { SECURITY_CHANGE_EVENT } from "../security/events";
import { appLockConfiguration } from "../security/app-lock";

it("refreshes the mounted lock only after a full wipe removes its configuration", async () => {
  await db.settings.bulkPut([
    { key: "security:enabled", value: "true" },
    { key: "security:delay", value: "1" },
  ]);
  expect((await appLockConfiguration()).enabled).toBe(true);
  const observed: Promise<boolean>[] = [];
  const listener = vi.fn(() => {
    observed.push(appLockConfiguration().then((config) => config.enabled));
  });
  window.addEventListener(SECURITY_CHANGE_EVENT, listener);
  try {
    await clearLocalData();
    expect(listener).toHaveBeenCalledOnce();
    expect(await Promise.all(observed)).toEqual([false]);
  } finally {
    window.removeEventListener(SECURITY_CHANGE_EVENT, listener);
  }
});
