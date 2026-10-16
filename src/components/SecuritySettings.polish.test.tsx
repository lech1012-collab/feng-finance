import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { SecuritySettings } from "./SecuritySettings";
import { db, initializeDatabase } from "../storage/database";
import { enableAppLock, verifyAppPin } from "../security/app-lock";
import { accounts, transaction } from "../tests/helpers";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await initializeDatabase();
  await db.accounts.put(accounts[0]);
  await db.transactions.put(transaction());
});
afterEach(async () => {
  cleanup();
  await db.delete();
});

it("shows lock status first and asks for masked numeric PINs only in a cancellable setup sheet", async () => {
  render(<SecuritySettings />);
  await screen.findByText("App lock is off.");
  expect(
    screen.queryByLabelText("Choose a 6-digit app PIN"),
  ).not.toBeInTheDocument();
  const before = await db.settings.toArray();
  fireEvent.click(screen.getByRole("button", { name: "Set up app lock" }));
  const sheet = await screen.findByRole("dialog", { name: "Set up app lock" });
  const ui = within(sheet);
  const choose = ui.getByLabelText("Choose a 6-digit app PIN");
  expect(choose).toHaveAttribute("type", "password");
  expect(choose).toHaveAttribute("inputmode", "numeric");
  expect(choose).toHaveAttribute("maxlength", "6");
  fireEvent.change(choose, { target: { value: "52a7391" } });
  expect(choose).toHaveValue("527391");
  expect(ui.getByRole("button", { name: "Enable app lock" })).toBeDisabled();
  fireEvent.click(ui.getByRole("button", { name: "Cancel" }));
  expect(await db.settings.toArray()).toEqual(before);
  fireEvent.click(screen.getByRole("button", { name: "Set up app lock" }));
  expect(screen.getByLabelText("Choose a 6-digit app PIN")).toHaveValue("");
  expect(screen.getByLabelText("Confirm PIN")).toHaveValue("");
});

it("enables and disables through the existing PIN checks without keeping credentials in history or modifying financial records", async () => {
  const original = await db.transactions.toArray();
  render(<SecuritySettings />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Set up app lock" }),
  );
  fireEvent.change(screen.getByLabelText("Choose a 6-digit app PIN"), {
    target: { value: "527391" },
  });
  fireEvent.change(screen.getByLabelText("Confirm PIN"), {
    target: { value: "527391" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enable app lock" }));
  await screen.findByText("App lock is on.", {}, { timeout: 5000 });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(await verifyAppPin("527391")).toBe(true);
  expect(screen.getByRole("status")).toHaveTextContent("App lock enabled.");
  expect(
    screen.queryByRole("button", { name: "Undo" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Turn app lock off" }));
  const sheet = await screen.findByRole("dialog", {
    name: "Turn app lock off",
  });
  fireEvent.change(within(sheet).getByLabelText("Current PIN"), {
    target: { value: "111111" },
  });
  fireEvent.click(
    within(sheet).getByRole("button", { name: "Disable app lock" }),
  );
  await screen.findByRole("alert", {}, { timeout: 5000 });
  expect((await db.settings.get("security:enabled"))?.value).toBe("true");
  fireEvent.change(within(sheet).getByLabelText("Current PIN"), {
    target: { value: "527391" },
  });
  fireEvent.click(
    within(sheet).getByRole("button", { name: "Disable app lock" }),
  );
  await screen.findByText("App lock is off.", {}, { timeout: 5000 });
  expect(await db.settings.where("key").startsWith("security:").count()).toBe(
    0,
  );
  expect(await db.changeLog.count()).toBe(0);
  expect(await db.transactions.toArray()).toEqual(original);
}, 20000);

it("undos the lock delay in the toast without recording credential metadata", async () => {
  await enableAppLock("527391", 1);
  const keys = ["security:pinHash", "security:pinSalt", "security:enabled"];
  const original = await db.settings.bulkGet(keys);
  render(<SecuritySettings />);
  const delay = await screen.findByLabelText("Lock after being away");
  fireEvent.change(delay, { target: { value: "5" } });
  await waitFor(async () =>
    expect((await db.settings.get("security:delay"))?.value).toBe("5"),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(async () =>
    expect((await db.settings.get("security:delay"))?.value).toBe("1"),
  );
  expect(delay).toHaveValue("1");
  expect(await db.settings.bulkGet(keys)).toEqual(original);
  expect(await db.changeLog.count()).toBe(0);
});

it("refuses stale lock-delay Undo after a later setting change", async () => {
  await enableAppLock("527391", 1);
  render(<SecuritySettings />);
  fireEvent.change(await screen.findByLabelText("Lock after being away"), {
    target: { value: "5" },
  });
  const undo = await screen.findByRole("button", { name: "Undo" });
  await db.settings.put({ key: "security:delay", value: "15" });
  fireEvent.click(undo);
  await screen.findByText(/Security settings changed/);
  expect((await db.settings.get("security:delay"))?.value).toBe("15");
});
