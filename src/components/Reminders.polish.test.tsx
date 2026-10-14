import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Reminders } from "./Reminders";
import { db, initializeDatabase } from "../storage/database";
import { accounts, transaction } from "../tests/helpers";
import { readReminderConfig, REMINDER_KEY } from "../analytics/reminders";
import * as backups from "../storage/backup";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await initializeDatabase();
  await db.accounts.put(accounts[0]);
  await db.transactions.put(transaction());
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await db.delete();
});
const view = () =>
  render(
    <MemoryRouter>
      <Reminders currency="GBP" settings />
    </MemoryRouter>,
  );

it("saves and undoes reminder visibility where it changed without touching transactions", async () => {
  const original = await db.transactions.toArray();
  view();
  const toggle = await screen.findByRole("switch", {
    name: "Show statement and bill reminders",
  });
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  await waitFor(async () =>
    expect(
      readReminderConfig((await db.settings.get(REMINDER_KEY))?.value).enabled,
    ).toBe(false),
  );
  expect(screen.getByRole("status")).toHaveTextContent("Reminders turned off.");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(toggle).toBeChecked());
  expect(await db.settings.get(REMINDER_KEY)).toBeUndefined();
  expect(await db.transactions.toArray()).toEqual(original);
  expect((await db.changeLog.toArray())[0].undoneAt).toBeDefined();
});

it("undos a review-day change to the exact prior saved preference", async () => {
  const prior = {
    key: REMINDER_KEY,
    value: JSON.stringify({ enabled: true, day: 7 }),
  };
  await db.settings.put(prior);
  view();
  const day = await screen.findByLabelText("Monthly statement review day");
  fireEvent.change(day, { target: { value: "12" } });
  await waitFor(() => expect(day).toHaveValue("12"));
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() => expect(day).toHaveValue("7"));
  expect(await db.settings.get(REMINDER_KEY)).toEqual(prior);
});

it("confirms calendar download in a toast without creating a meaningless Undo or exporting financial text", async () => {
  const download = vi.spyOn(backups, "download").mockImplementation(() => {});
  view();
  fireEvent.click(
    await screen.findByRole("button", { name: "Export calendar reminders" }),
  );
  expect(download).toHaveBeenCalledOnce();
  const [calendar, mime, filename] = download.mock.calls[0];
  expect(mime).toBe("text/calendar");
  expect(filename).toBe("feng-finance-reminders.ics");
  expect(calendar).not.toContain("WAITROSE");
  expect(calendar).not.toContain("4321");
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Calendar file prepared.",
  );
  expect(
    screen.queryByRole("button", { name: "Undo" }),
  ).not.toBeInTheDocument();
  expect(await db.changeLog.count()).toBe(0);
});
