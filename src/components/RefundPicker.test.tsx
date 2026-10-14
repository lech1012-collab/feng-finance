import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { db, initializeDatabase } from "../storage/database";
import { accounts, transaction } from "../tests/helpers";
import { TransactionAccuracy } from "./TransactionAccuracy";

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

it("shows only eligible same-merchant purchases until Search all is explicitly chosen", async () => {
  const credit = transaction({
    id: "credit",
    amount: 5000,
    date: "2026-09-20",
    merchant: "JOHN LEWIS",
    description: "JOHN LEWIS REFUND",
    type: "income",
    kind: "refund",
    categoryId: "refund",
  });
  await db.transactions.bulkPut([
    credit,
    transaction({
      id: "same",
      amount: -10000,
      date: "2026-09-01",
      merchant: "JOHN LEWIS",
      description: "JOHN LEWIS",
    }),
    transaction({
      id: "unrelated",
      amount: -85000,
      date: "2026-09-01",
      merchant: "LITTLE OAK NURSERY",
      description: "LITTLE OAK NURSERY",
    }),
    transaction({
      id: "old",
      amount: -20000,
      date: "2026-02-01",
      merchant: "JOHN LEWIS",
      description: "JOHN LEWIS",
    }),
    transaction({
      id: "small",
      amount: -2000,
      date: "2026-09-03",
      merchant: "JOHN LEWIS",
      description: "JOHN LEWIS",
    }),
  ]);
  render(
    <MemoryRouter>
      <TransactionAccuracy transaction={credit} initialMode="refund" compact />
    </MemoryRouter>,
  );
  await screen.findByRole("button", { name: "Search all purchases" });
  expect(screen.getAllByText("John Lewis")).toHaveLength(1);
  expect(screen.queryByText("Little Oak Nursery")).not.toBeInTheDocument();
  expect(screen.queryByText(/Feb/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Search all purchases" }));
  await screen.findByText("Little Oak Nursery");
  expect(screen.getAllByText("John Lewis")).toHaveLength(3);
  expect(
    (await db.transactions.get(credit.id))?.refundAllocations,
  ).toBeUndefined();
});
