import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Transactions from "../pages/Transactions";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { accounts, transaction } from "../tests/helpers";

beforeEach(async () => {
  await clearLocalData();
  await initializeDatabase();
  await db.accounts.bulkPut(accounts);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    }),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("searches, opens sorting tags and prepares a split without filling missing legacy fields in IndexedDB", async () => {
  const legacy = transaction({
    id: "legacy",
    description: "LOCAL BAKERY",
    merchant: "LOCAL BAKERY",
  });
  for (const key of ["tags", "occurrence", "isReviewed"])
    Reflect.deleteProperty(legacy, key);
  await db.transactions.put(legacy);
  await db.tags.put({
    id: "test-tag",
    name: "Test tag",
    colour: "#A99BD6",
    archived: false,
  });
  const before = await db.transactions.get(legacy.id);
  render(
    <MemoryRouter initialEntries={["/transactions?uncategorized=1&allDates=1"]}>
      <Transactions month="2026-09" currency="GBP" />
    </MemoryRouter>,
  );
  await screen.findByRole(
    "button",
    { name: "Uncategorized 1" },
    { timeout: 8000 },
  );
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search transactions" }),
    { target: { value: "LOCAL BAKERY" } },
  );
  await waitFor(() => expect(screen.getByText("Local Bakery")).toBeVisible());
  fireEvent.click(screen.getByRole("button", { name: "Start sorting" }));
  const board = await screen.findByRole("dialog");
  fireEvent.click(within(board).getByRole("button", { name: "Add tag" }));
  expect(
    await within(board).findByRole("checkbox", { name: "Test tag" }),
  ).not.toBeChecked();
  fireEvent.click(
    within(board).getByRole("button", { name: "Split between categories" }),
  );
  expect(await screen.findByLabelText("Split amount 1")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Add line" }));
  expect(screen.getByLabelText("Split amount 3")).toBeVisible();
  expect(await db.transactions.get(legacy.id)).toEqual(before);
  expect(await db.changeLog.count()).toBe(0);
}, 15000);
