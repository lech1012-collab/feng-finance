import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { db, initializeDatabase } from "../storage/database";
import { accounts, transaction } from "../tests/helpers";
import TransactionDetail from "./TransactionDetail";
import { ToastProvider } from "../components/Toast";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await initializeDatabase();
  await db.accounts.bulkPut(accounts);
});
afterEach(async () => {
  cleanup();
  await db.delete();
});
const detail = (id = "t1") =>
  render(
    <MemoryRouter initialEntries={[`/transactions/${id}`]}>
      <ToastProvider>
        <Routes>
          <Route path="/transactions/:id" element={<TransactionDetail />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );

it("does not ask for another review of an already categorised rule match", async () => {
  const row = transaction({
    categoryId: "groceries",
    categorySource: "rule",
    isReviewed: false,
    checkLevel: "total",
  });
  await db.transactions.put(row);
  detail();
  expect(await screen.findByRole("combobox", { name: "Category" })).toHaveValue(
    "groceries",
  );
  expect(
    screen.queryByRole("button", { name: "Mark reviewed" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Confirm.*checked/ }),
  ).not.toBeInTheDocument();
  expect(await db.transactions.get(row.id)).toEqual(row);
});

it("still offers an explicit confirmation when a source check is genuinely outstanding", async () => {
  await db.transactions.put(
    transaction({
      categoryId: "groceries",
      isReviewed: false,
      checkLevel: "review",
    }),
  );
  detail();
  const confirm = await screen.findByRole("button", {
    name: "Confirm source checked",
  });
  fireEvent.click(confirm);
  await waitFor(async () =>
    expect((await db.transactions.get("t1"))?.isReviewed).toBe(true),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Confirm source checked" }),
    ).not.toBeInTheDocument(),
  );
});

it("shows the original counted month directly under a refund amount only once", async () => {
  await db.transactions.bulkPut([
    transaction({
      id: "purchase",
      amount: -10000,
      date: "2026-08-20",
      categoryId: "shopping",
    }),
    transaction({
      id: "credit",
      amount: 5000,
      date: "2026-09-20",
      type: "income",
      kind: "refund",
      refundAllocations: [{ transactionId: "purchase", amount: 5000 }],
    }),
  ]);
  detail("credit");
  const label = await screen.findByText("Refund · counted in August 2026");
  expect(screen.getAllByText("Refund · counted in August 2026")).toHaveLength(
    1,
  );
  expect(label.previousElementSibling).toHaveTextContent("+£50.00");
  expect((await db.transactions.get("credit"))?.date).toBe("2026-09-20");
});

it("keeps tag editing in a sheet and automatically saves with local Undo", async () => {
  await db.transactions.put(transaction({ categoryId: "groceries", tags: [] }));
  await db.tags.put({
    id: "trip",
    name: "Lisbon trip",
    colour: "#A99BD6",
    archived: false,
  });
  detail();
  fireEvent.click(await screen.findByRole("button", { name: "Add tag" }));
  const sheet = await screen.findByRole("dialog", { name: "Add tag" });
  fireEvent.click(
    await within(sheet).findByRole("checkbox", { name: "Lisbon trip" }),
  );
  await waitFor(async () =>
    expect((await db.transactions.get("t1"))?.tags).toEqual(["trip"]),
  );
  fireEvent.click(await within(sheet).findByRole("button", { name: "Undo" }));
  await waitFor(async () =>
    expect((await db.transactions.get("t1"))?.tags).toEqual([]),
  );
  expect((await db.transactions.get("t1"))?.amount).toBe(-1000);
  expect((await db.transactions.get("t1"))?.description).toBe("WAITROSE");
});

it("opens accounting and attachment education from nearby help without changing the transaction", async () => {
  const row = transaction({ categoryId: "groceries" });
  await db.transactions.put(row);
  detail();
  await screen.findByRole("combobox", { name: "Category" });
  expect(
    screen.queryByText(/Money in counts as income/),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "About How this counts" }),
  );
  const accounting = await screen.findByRole("dialog", {
    name: "How this counts",
  });
  expect(
    within(accounting).getByText(/A refund reduces the original spending/),
  ).toBeVisible();
  fireEvent.click(
    within(accounting).getByRole("button", { name: "Close How this counts" }),
  );
  expect(await screen.findByText("0 of 5 attachments")).toBeVisible();
  expect(screen.queryByText(/compressed to 1600/)).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "About Transaction attachments" }),
  );
  const attachments = await screen.findByRole("dialog", {
    name: "Transaction attachments",
  });
  expect(
    within(attachments).getByText(/Images are compressed to 1600 pixels/),
  ).toBeVisible();
  expect(await db.transactions.get(row.id)).toEqual(row);
});

it("keeps split education inside the editor without stacking another dialog", async () => {
  const row = transaction({ categoryId: "groceries" });
  await db.transactions.put(row);
  detail();
  fireEvent.click(await screen.findByRole("button", { name: "Split" }));
  const editor = await screen.findByRole("dialog", {
    name: "Split transaction",
  });
  expect(
    within(editor).queryByText(/The original amount and statement balance/),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(editor).getByRole("button", {
      name: "About Splitting a transaction",
    }),
  );
  expect(
    within(editor).getByText(/The original amount and statement balance/),
  ).toBeVisible();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(
    within(editor).getByRole("button", { name: "Save split" }),
  ).toBeDisabled();
  expect(await db.transactions.get(row.id)).toEqual(row);
});
