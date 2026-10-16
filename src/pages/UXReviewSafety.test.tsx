import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { db, initializeDatabase } from "../storage/database";
import { accounts, transaction } from "../tests/helpers";
import type { Statement } from "../domain/models";
import TransactionDetail from "./TransactionDetail";
import Settings from "./Settings";
import Accounts from "./Accounts";
import { ToastProvider } from "../components/Toast";
import { merchantExpenses } from "../analytics/merchant-expenses";

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  await db.delete();
  await db.open();
  await initializeDatabase();
  await db.accounts.bulkPut(accounts);
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await db.delete();
});
const detail = () =>
  render(
    <MemoryRouter initialEntries={["/transactions/t1"]}>
      <ToastProvider>
        <Routes>
          <Route path="/transactions/:id" element={<TransactionDetail />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );

it("saves a category immediately, remembers it and undoes both changes without changing the statement amount", async () => {
  await db.transactions.put(transaction({ categoryId: "groceries" }));
  detail();
  const category = await screen.findByRole("combobox", { name: "Category" });
  fireEvent.change(category, { target: { value: "shopping" } });
  await waitFor(async () =>
    expect((await db.transactions.get("t1"))?.categoryId).toBe("shopping"),
  );
  const remembered = await db.rules
    .filter((r) => !!r.auto && r.categoryId === "shopping")
    .toArray();
  expect(remembered).toHaveLength(1);
  expect((await db.transactions.get("t1"))?.amount).toBe(-1000);
  expect(
    screen.queryByRole("button", { name: "Save changes" }),
  ).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(async () =>
    expect((await db.transactions.get("t1"))?.categoryId).toBe("groceries"),
  );
  await waitFor(() => expect(category).toHaveValue("groceries"));
  expect(await db.rules.get(remembered[0].id)).toBeUndefined();
});

it("autosaves the latest private note and keeps an edited display name separate from raw bank text", async () => {
  await db.transactions.put(transaction({ categoryId: "groceries" }));
  detail();
  const display = await screen.findByRole("textbox", { name: "Display name" });
  expect(display).toHaveValue("Waitrose");
  fireEvent.change(display, { target: { value: "Weekly groceries" } });
  fireEvent.blur(display);
  await waitFor(async () =>
    expect((await db.transactions.get("t1"))?.merchant).toBe(
      "Weekly groceries",
    ),
  );
  expect((await db.transactions.get("t1"))?.description).toBe("WAITROSE");
  expect(
    await screen.findByRole("heading", { name: "Weekly groceries" }),
  ).toBeVisible();
  const note = screen.getByRole("textbox", { name: "Private note" });
  fireEvent.change(note, { target: { value: "First draft" } });
  fireEvent.change(note, { target: { value: "Latest private note" } });
  await waitFor(
    async () =>
      expect((await db.transactions.get("t1"))?.note).toBe(
        "Latest private note",
      ),
    { timeout: 3000 },
  );
  expect(
    screen.queryByRole("button", { name: "Save note" }),
  ).not.toBeInTheDocument();
});

it("groups Settings without rendering unrelated financial forms or duplicating the Home Accounts entry", async () => {
  render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  );
  expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
  expect(
    screen.queryByRole("textbox", { name: /Rename/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Erase everything" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /Accounts/ }),
  ).not.toBeInTheDocument();
});

it("shows the native credit-card balance and its verification reason in Accounts, with editing in a sheet", async () => {
  const statement: Statement = {
    id: "card",
    accountId: accounts[2].id,
    institution: "American Express",
    currency: "GBP",
    statementPeriodStart: "2026-09-01",
    statementPeriodEnd: "2026-09-30",
    openingBalance: 0,
    closingBalance: -1000,
    transactionCount: 1,
    sourceFilename: "fictitious.pdf",
    sourceFileHash: "synthetic",
    importedAt: "2026-10-01T12:00:00Z",
    parserVersion: "synthetic",
    extractionMethod: "embedded-text",
    validationStatus: "reconciled",
    warnings: [],
  };
  await db.statements.put(statement);
  await db.transactions.put(
    transaction({ accountId: accounts[2].id, statementId: statement.id }),
  );
  render(
    <MemoryRouter>
      <ToastProvider>
        <Accounts />
      </ToastProvider>
    </MemoryRouter>,
  );
  const card = await screen.findByRole("button", {
    name: /Card.*£10.00.*Debt owed/,
  });
  expect(card).toHaveTextContent("Verified");
  fireEvent.click(card);
  const sheet = await screen.findByRole("dialog", { name: "Edit account" });
  expect(within(sheet).getByRole("textbox", { name: "Nickname" })).toHaveValue(
    "Card",
  );
  expect(
    within(sheet).queryByRole("combobox", { name: "Currency" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(sheet).getByRole("button", { name: "Close Edit account" }),
  );
  await db.transactions.delete("t1");
  await waitFor(() => expect(card).toHaveTextContent("Unverified"));
  expect((await db.statements.get("card"))?.closingBalance).toBe(-1000);
});

it("groups repeated expenses for analysis while excluding transfers and preserving separate currencies", () => {
  const rows = [
    transaction({
      id: "first",
      merchant: "LITTLE OAK NURSERY",
      amount: -85000,
    }),
    transaction({
      id: "second",
      merchant: "Little Oak Nursery",
      amount: -85000,
    }),
    transaction({
      id: "move",
      merchant: "Little Oak Nursery",
      amount: -85000,
      type: "transfer",
      isTransfer: true,
    }),
    transaction({
      id: "eur",
      merchant: "Little Oak Nursery",
      amount: -85000,
      currency: "EUR",
    }),
  ];
  const grouped = merchantExpenses(rows);
  expect(grouped).toHaveLength(2);
  expect(grouped[0]).toMatchObject({
    name: "Little Oak Nursery",
    amount: -170000,
    count: 2,
    currency: "GBP",
    ids: ["first", "second"],
  });
});
