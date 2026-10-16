import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
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
  expect(screen.getAllByRole("radio")).toHaveLength(1);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.queryByText("Little Oak Nursery")).not.toBeInTheDocument();
  expect(screen.queryByText(/Feb/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Search all purchases" }));
  await screen.findByText("Little Oak Nursery");
  expect(screen.getAllByText("John Lewis")).toHaveLength(3);
  expect(
    (await db.transactions.get(credit.id))?.refundAllocations,
  ).toBeUndefined();
});

it("selects one suggested purchase at a time without changing the refund until confirmed", async () => {
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
      id: "latest",
      amount: -10000,
      date: "2026-09-19",
      merchant: "JOHN LEWIS",
      description: "JOHN LEWIS",
      categoryId: "shopping",
    }),
    transaction({
      id: "earlier",
      amount: -7500,
      date: "2026-09-01",
      merchant: "JOHN LEWIS",
      description: "JOHN LEWIS",
      categoryId: "shopping",
    }),
  ]);
  render(
    <MemoryRouter>
      <TransactionAccuracy transaction={credit} initialMode="refund" compact />
    </MemoryRouter>,
  );
  await screen.findByRole("button", { name: "Search all purchases" });
  const choices = screen.getAllByRole("radio");
  expect(choices[0]).toHaveAccessibleName(/19 Sep/);
  fireEvent.click(choices[0]);
  expect(choices[0]).toBeChecked();
  fireEvent.click(choices[1]);
  expect(choices[0]).not.toBeChecked();
  expect(choices[1]).toBeChecked();
  expect(
    screen.getAllByRole("textbox", { name: /Refund amount for/ }),
  ).toHaveLength(1);
  expect(
    (await db.transactions.get(credit.id))?.refundAllocations,
  ).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Link refund" }));
  await waitFor(async () =>
    expect((await db.transactions.get(credit.id))?.refundAllocations).toEqual([
      { transactionId: "earlier", amount: 5000 },
    ]),
  );
  expect((await db.transactions.get(credit.id))?.date).toBe("2026-09-20");
  expect((await db.transactions.get("earlier"))?.amount).toBe(-7500);
});

it("preserves multi-purchase reimbursements through the explicit Search all route", async () => {
  const credit = transaction({
    id: "credit",
    amount: 5000,
    date: "2026-09-20",
    merchant: "EMPLOYER",
    description: "EMPLOYER REIMBURSEMENT",
    type: "income",
  });
  await db.transactions.bulkPut([
    credit,
    transaction({
      id: "travel",
      amount: -3000,
      date: "2026-09-10",
      merchant: "TFL",
      description: "TFL",
      categoryId: "transport",
    }),
    transaction({
      id: "meal",
      amount: -2000,
      date: "2026-09-11",
      merchant: "PRET A MANGER",
      description: "PRET A MANGER",
      categoryId: "restaurants",
    }),
  ]);
  render(
    <MemoryRouter>
      <TransactionAccuracy transaction={credit} initialMode="refund" compact />
    </MemoryRouter>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Search all purchases" }),
  );
  const choices = screen.getAllByRole("checkbox");
  expect(choices).toHaveLength(2);
  fireEvent.click(choices[0]);
  fireEvent.click(choices[1]);
  expect(choices[0]).toBeChecked();
  expect(choices[1]).toBeChecked();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(screen.getByText("£0.00 unallocated")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Link refund" }));
  await waitFor(async () =>
    expect((await db.transactions.get(credit.id))?.refundAllocations).toEqual(
      expect.arrayContaining([
        { transactionId: "travel", amount: 3000 },
        { transactionId: "meal", amount: 2000 },
      ]),
    ),
  );
  expect((await db.transactions.get(credit.id))?.amount).toBe(5000);
});

it("opens an existing reimbursement with all allocated purchases intact", async () => {
  const credit = transaction({
    id: "credit",
    amount: 5000,
    date: "2026-09-20",
    merchant: "EMPLOYER",
    description: "EMPLOYER REIMBURSEMENT",
    type: "income",
    kind: "refund",
    refundAllocations: [
      { transactionId: "travel", amount: 3000 },
      { transactionId: "meal", amount: 2000 },
    ],
  });
  await db.transactions.bulkPut([
    credit,
    transaction({
      id: "travel",
      amount: -3000,
      date: "2026-09-10",
      merchant: "TFL",
      description: "TFL",
      categoryId: "transport",
    }),
    transaction({
      id: "meal",
      amount: -2000,
      date: "2026-09-11",
      merchant: "PRET A MANGER",
      description: "PRET A MANGER",
      categoryId: "restaurants",
    }),
  ]);
  render(
    <MemoryRouter>
      <TransactionAccuracy transaction={credit} initialMode="refund" compact />
    </MemoryRouter>,
  );
  await screen.findByRole("button", { name: "Show matching purchases" });
  expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(2);
  expect(screen.getByText("£0.00 unallocated")).toBeVisible();
  expect((await db.transactions.get(credit.id))?.refundAllocations).toEqual(
    credit.refundAllocations,
  );
});
