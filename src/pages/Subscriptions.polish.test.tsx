import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { db, initializeDatabase } from "../storage/database";
import { accounts, transaction } from "../tests/helpers";
import Subscriptions from "./Subscriptions";

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
  await db.delete();
  await db.open();
  await initializeDatabase();
  await db.accounts.bulkPut(accounts);
  await db.transactions.bulkPut(
    ["2026-07-04", "2026-08-04", "2026-09-04", "2026-10-04"].map(
      (date, index) =>
        transaction({
          id: `netflix-polish-${index}`,
          accountId: "a3",
          date,
          description: "CARD PAYMENT TO NETFLIX REF: FICTIONAL",
          merchant: "NETFLIX",
          categoryId: "subscriptions",
          amount: index === 3 ? -1499 : -1299,
        }),
    ),
  );
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await db.delete();
});

it("keeps the price alert and original amounts while making recurring review and evidence clear", async () => {
  render(
    <MemoryRouter>
      <Subscriptions currency="GBP" />
    </MemoryRouter>,
  );
  expect(
    await screen.findByRole("heading", { name: "Subscriptions" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("NOTIFICATION CENTRE")).not.toBeInTheDocument();
  const card = await screen.findByRole("article", { name: "NETFLIX" });
  expect(
    within(card).getByText("Needs review", { exact: true }),
  ).toBeInTheDocument();
  expect(
    within(card).getByText(/Latest charge increased by £2.00/),
  ).toBeInTheDocument();
  expect(
    within(card).getByRole("button", { name: "Keep" }),
  ).toBeInTheDocument();
  expect(
    within(card).getByRole("button", { name: "Plan to cancel" }),
  ).toBeInTheDocument();
  fireEvent.click(within(card).getByText(/View 4 charges/));
  const evidence = within(card).getAllByRole("link");
  expect(evidence).toHaveLength(4);
  expect(evidence[0]).toHaveTextContent("Netflix");
  expect(evidence[0]).toHaveTextContent("Price changed");
  expect(evidence[0]).toHaveTextContent("−£14.99");
  expect(evidence[0]).not.toHaveTextContent("FICTIONAL");
  const source = await db.transactions.get("netflix-polish-3");
  expect(source).toMatchObject({
    description: "CARD PAYMENT TO NETFLIX REF: FICTIONAL",
    amount: -1499,
  });
});
