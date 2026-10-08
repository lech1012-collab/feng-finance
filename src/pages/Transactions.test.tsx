import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Transactions from "./Transactions";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { accounts, transaction } from "../tests/helpers";
import * as categoryStorage from "../storage/categorize";
import type { Statement } from "../domain/models";

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

it("verifies account chips against complete indexed statement rows beyond the transaction date filter", async () => {
  const rows = [
    transaction({ id: "first", date: "2026-09-01" }),
    transaction({ id: "last", date: "2026-09-30" }),
  ];
  const statement: Statement = {
    id: "s1",
    accountId: "a1",
    institution: "Barclays",
    statementPeriodStart: "2026-09-01",
    statementPeriodEnd: "2026-09-30",
    periodSource: "printed",
    openingBalance: 100000,
    closingBalance: 98000,
    currency: "GBP",
    sourceFilename: "synthetic.pdf",
    sourceFileHash: "synthetic",
    importedAt: "2026-10-03T00:00:00.000Z",
    parserVersion: "synthetic",
    extractionMethod: "embedded-text",
    validationStatus: "reconciled",
    transactionCount: 2,
    warnings: [],
  };
  await db.transactions.bulkPut(rows);
  await db.statements.put(statement);
  render(
    <MemoryRouter
      initialEntries={[
        "/transactions?allDates=0&from=2026-09-30&to=2026-09-30",
      ]}
    >
      <Transactions month="2026-09" currency="GBP" />
    </MemoryRouter>,
  );
  const chips = await screen.findByRole(
    "group",
    { name: "Filter by account" },
    { timeout: 8000 },
  );
  expect(await within(chips).findByText(/£980.00/)).toBeVisible();
  await db.transactions.delete("first");
  await waitFor(() =>
    expect(
      within(chips).getByText(/£980.00.*Reported.*Unverified/),
    ).toBeVisible(),
  );
}, 15000);

it("keeps category save errors outside the desktop-only rail so mobile users see them", async () => {
  await db.transactions.put(
    transaction({
      merchant: "WAITROSE STORE 1234",
      description: "WAITROSE STORE 1234",
    }),
  );
  vi.spyOn(categoryStorage, "categorizeCards").mockRejectedValue(
    new Error("Local storage is full."),
  );
  render(
    <MemoryRouter initialEntries={["/transactions?uncategorized=1&allDates=1"]}>
      <Transactions month="2026-09" currency="GBP" />
    </MemoryRouter>,
  );
  fireEvent.click(
    await screen.findByRole(
      "button",
      { name: "Select Waitrose" },
      { timeout: 8000 },
    ),
  );
  fireEvent.click(
    within(
      screen.getByRole("complementary", { name: "Category drop targets" }),
    ).getByRole("button", { name: "Groceries" }),
  );
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Local storage is full.");
  expect(alert.closest(".category-rail")).toBeNull();
}, 15000);

it("sorts a counted queue with explanation, keyboard choice, next item and atomic Undo", async () => {
  const saveCategory = vi.spyOn(categoryStorage, "categorizeCards");
  const undoCategory = vi.spyOn(categoryStorage, "undoCategory");
  const first = transaction({
    id: "waitrose",
    date: "2026-09-05",
    merchant: "WAITROSE STORE 1234",
    description: "WAITROSE STORE 1234",
  });
  const second = transaction({
    id: "other",
    date: "2026-09-04",
    merchant: "CITY CLUB",
    description: "CITY CLUB",
  });
  await db.transactions.bulkPut([first, second]);
  render(
    <MemoryRouter initialEntries={["/transactions?uncategorized=1&allDates=1"]}>
      <Transactions month="2026-09" currency="GBP" />
    </MemoryRouter>,
  );
  await screen.findByRole(
    "button",
    { name: "Uncategorized 2" },
    { timeout: 8000 },
  );
  expect(screen.getByText("Waitrose")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Start sorting" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("1 of 2 to sort")).toBeVisible();
  expect(
    await within(dialog).findByText(
      /Known merchant match/,
      {},
      { timeout: 8000 },
    ),
  ).toBeVisible();
  // Wait for the real atomic write, rather than racing IndexedDB with
  // waitFor's one-second default when the suite runs under CI load.
  await act(async () => {
    fireEvent.keyDown(dialog, { key: "1" });
    expect(saveCategory).toHaveBeenCalledOnce();
    await saveCategory.mock.results[0].value;
  });
  expect((await db.transactions.get(first.id))?.categoryId).toBe("groceries");
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByText("City Club"),
    ).toBeVisible(),
  );
  expect(
    await screen.findByRole(
      "button",
      { name: "Uncategorized 1" },
      { timeout: 8000 },
    ),
  ).toBeVisible();
  expect(
    screen.getByText(
      /Waitrose on Barclays.*Future matching payments will follow/,
    ),
  ).toBeVisible();
  await act(async () => {
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "z", metaKey: true });
    expect(undoCategory).toHaveBeenCalledOnce();
    await undoCategory.mock.results[0].value;
  });
  expect(await db.transactions.get(first.id)).toEqual(first);
  expect(await db.rules.filter((r) => !r.builtIn).count()).toBe(0);
}, 15000);

it("lets the user skip in the queue without learning or changing any transaction", async () => {
  const first = transaction({
    id: "one",
    date: "2026-09-05",
    merchant: "FIRST SHOP",
    description: "FIRST SHOP",
  });
  const second = transaction({
    id: "two",
    date: "2026-09-04",
    merchant: "SECOND SHOP",
    description: "SECOND SHOP",
  });
  await db.transactions.bulkPut([first, second]);
  render(
    <MemoryRouter
      initialEntries={["/transactions?uncategorized=1&allDates=1&sort=1"]}
    >
      <Transactions month="2026-09" currency="GBP" />
    </MemoryRouter>,
  );
  const dialog = await screen.findByRole("dialog", {}, { timeout: 8000 });
  fireEvent.click(within(dialog).getByRole("button", { name: "Skip" }));
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByText("Second Shop"),
    ).toBeVisible(),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Skip" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(await db.transactions.bulkGet([first.id, second.id])).toEqual([
    first,
    second,
  ]);
  expect(await db.rules.filter((r) => !r.builtIn).count()).toBe(0);
}, 15000);
