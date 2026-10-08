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
  const groceriesShortcut = () =>
    within(
      within(screen.getByRole("dialog")).getByRole("region", {
        name: "Suggested categories",
      }),
    ).getByRole("button", { name: "Categorize as Groceries" });
  // The explanation can appear before the asynchronous queue/evidence refresh
  // settles. Wait for the actual enabled shortcut, use the current board, and
  // focus its button before sending a keyboard event through the live DOM.
  await waitFor(() => {
    expect(groceriesShortcut()).toBeEnabled();
    expect(within(groceriesShortcut()).getByText("1")).toBeVisible();
  });
  await act(async () => groceriesShortcut().focus());
  // Wait for the real atomic write, rather than racing IndexedDB with
  // waitFor's one-second default when the suite runs under CI load.
  await act(async () => {
    const target = groceriesShortcut();
    expect(target).toHaveFocus();
    fireEvent.keyDown(target, { key: "1" });
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
  expect(
    within(screen.getByRole("dialog")).getByText("1 of 1 to sort"),
  ).toBeVisible();
  const categorySearch = within(screen.getByRole("dialog")).getByRole(
    "searchbox",
    {
      name: "Find a category",
    },
  );
  fireEvent.change(categorySearch, { target: { value: "club" } });
  fireEvent.keyDown(categorySearch, { key: "z", ctrlKey: true });
  expect(undoCategory).not.toHaveBeenCalled();
  expect((await db.transactions.get(first.id))?.categoryId).toBe("groceries");
  fireEvent.change(categorySearch, { target: { value: "" } });
  await act(async () => {
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "z", metaKey: true });
    expect(undoCategory).toHaveBeenCalledOnce();
    await undoCategory.mock.results[0].value;
  });
  expect(await db.transactions.get(first.id)).toEqual(first);
  expect(await db.rules.filter((r) => !r.builtIn).count()).toBe(0);
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByText("1 of 2 to sort"),
    ).toBeVisible(),
  );
  expect(
    within(screen.getByRole("dialog")).getByText("Waitrose"),
  ).toBeVisible();
  expect(
    await screen.findByRole("button", { name: "Uncategorized 2" }),
  ).toBeVisible();
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
  expect(
    within(screen.getByRole("dialog")).getByText("1 of 1 to sort"),
  ).toBeVisible();
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

it("restores all backfilled queue entries on Undo and can sort them again", async () => {
  const saveCategory = vi.spyOn(categoryStorage, "categorizeCards");
  const undoCategory = vi.spyOn(categoryStorage, "undoCategory");
  const first = transaction({ id: "waitrose", date: "2026-09-05" });
  const matching = transaction({ id: "matching", date: "2026-09-04" });
  const last = transaction({
    id: "remaining",
    date: "2026-09-03",
    merchant: "CITY CLUB",
    description: "CITY CLUB",
  });
  await db.transactions.bulkPut([first, matching, last]);
  render(
    <MemoryRouter
      initialEntries={["/transactions?uncategorized=1&allDates=1&sort=1"]}
    >
      <Transactions month="2026-09" currency="GBP" />
    </MemoryRouter>,
  );
  const dialog = await screen.findByRole("dialog", {}, { timeout: 8000 });
  expect(within(dialog).getByText("1 of 3 to sort")).toBeVisible();
  await act(async () => {
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Categorize as Groceries" }),
    );
    await saveCategory.mock.results[0].value;
  });
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByText("1 of 1 to sort"),
    ).toBeVisible(),
  );
  await act(async () => {
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "z", metaKey: true });
    await undoCategory.mock.results[0].value;
  });
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByText("1 of 3 to sort"),
    ).toBeVisible(),
  );
  expect(
    await db.transactions.bulkGet([first.id, matching.id, last.id]),
  ).toEqual([first, matching, last]);
  expect(await db.rules.filter((r) => !r.builtIn).count()).toBe(0);
  await act(async () => {
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Categorize as Groceries",
      }),
    );
    await saveCategory.mock.results[1].value;
  });
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByText("1 of 1 to sort"),
    ).toBeVisible(),
  );
  expect((await db.transactions.get(matching.id))?.categoryId).toBe(
    "groceries",
  );
  expect(await db.rules.filter((r) => !r.builtIn).count()).toBe(1);
}, 15000);

it("refreshes a live queue when records are deleted or categorized elsewhere", async () => {
  const first = transaction({ id: "first", date: "2026-09-05" });
  const second = transaction({
    id: "second",
    date: "2026-09-04",
    merchant: "CITY CLUB",
  });
  const third = transaction({
    id: "third",
    date: "2026-09-03",
    merchant: "LAST SHOP",
  });
  await db.transactions.bulkPut([first, second, third]);
  render(
    <MemoryRouter
      initialEntries={["/transactions?uncategorized=1&allDates=1&sort=1"]}
    >
      <Transactions month="2026-09" currency="GBP" />
    </MemoryRouter>,
  );
  const dialog = await screen.findByRole("dialog", {}, { timeout: 8000 });
  expect(within(dialog).getByText("1 of 3 to sort")).toBeVisible();
  await db.transactions.delete(second.id);
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByText("1 of 2 to sort"),
    ).toBeVisible(),
  );
  await db.transactions.update(first.id, { categoryId: "groceries" });
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByText("Last Shop"),
    ).toBeVisible(),
  );
  expect(
    within(screen.getByRole("dialog")).getByText("1 of 1 to sort"),
  ).toBeVisible();
  expect((await db.transactions.get(first.id))?.categoryId).toBe("groceries");
  expect(await db.transactions.get(second.id)).toBeUndefined();
  expect(await db.transactions.get(third.id)).toEqual(third);
  expect(await db.rules.filter((r) => !r.builtIn).count()).toBe(0);
}, 15000);

it("keeps skipped cards deferred when Undo reopens a completed sorting queue", async () => {
  const saveCategory = vi.spyOn(categoryStorage, "categorizeCards");
  const undoCategory = vi.spyOn(categoryStorage, "undoCategory");
  const first = transaction({
    id: "skip-first",
    date: "2026-09-05",
    merchant: "FIRST SHOP",
    description: "FIRST SHOP",
  });
  const second = transaction({ id: "save-second", date: "2026-09-04" });
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
      within(screen.getByRole("dialog")).getByText("Waitrose"),
    ).toBeVisible(),
  );
  await act(async () => {
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Categorize as Groceries",
      }),
    );
    await saveCategory.mock.results[0].value;
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await undoCategory.mock.results[0].value;
  });
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByText("1 of 1 to sort"),
    ).toBeVisible(),
  );
  expect(
    within(screen.getByRole("dialog")).getByText("Waitrose"),
  ).toBeVisible();
  expect(await db.transactions.bulkGet([first.id, second.id])).toEqual([
    first,
    second,
  ]);
  expect(await db.rules.filter((r) => !r.builtIn).count()).toBe(0);
}, 15000);

it("keeps transaction detail navigation inside the board until a category save completes", async () => {
  await db.transactions.put(transaction());
  let rejectSave: (reason: Error) => void = () => undefined;
  vi.spyOn(categoryStorage, "categorizeCards").mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectSave = reject;
      }),
  );
  render(
    <MemoryRouter
      initialEntries={["/transactions?uncategorized=1&allDates=1&sort=1"]}
    >
      <Transactions month="2026-09" currency="GBP" />
    </MemoryRouter>,
  );
  const dialog = await screen.findByRole("dialog", {}, { timeout: 8000 });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Categorize as Groceries" }),
  );
  const details = within(dialog).getByRole("link", {
    name: "View transaction details",
  });
  expect(details).toHaveAttribute("aria-disabled", "true");
  expect(fireEvent.click(details)).toBe(false);
  expect(screen.getByRole("dialog")).toBe(dialog);
  await act(async () =>
    rejectSave(new Error("Storage temporarily unavailable.")),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Storage temporarily unavailable.",
  );
  expect(details).not.toHaveAttribute("aria-disabled");
  expect(await db.transactions.get("t1")).toEqual(transaction());
}, 15000);
