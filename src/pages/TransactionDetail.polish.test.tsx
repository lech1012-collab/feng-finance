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
