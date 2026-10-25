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
  expect(
    screen.queryByText(/Based on up to three years/),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Transactions through")).toHaveTextContent("4 Oct");
  fireEvent.click(
    screen.getByRole("button", { name: "About Recurring charge detection" }),
  );
  const detection = await screen.findByRole("dialog", {
    name: "Recurring charge detection",
  });
  expect(
    within(detection).getByText(/Based on up to three years/),
  ).toBeVisible();
  expect(
    within(detection).getByText(/Regular payments are candidates/),
  ).toBeVisible();
  fireEvent.click(
    within(detection).getByRole("button", {
      name: "Close Recurring charge detection",
    }),
  );
  expect(screen.queryByText(/Swipe a charge left/)).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "About Reviewing recurring charges" }),
  );
  const reviewHelp = await screen.findByRole("dialog", {
    name: "Reviewing recurring charges",
  });
  expect(within(reviewHelp).getByText(/Swipe a charge left/)).toBeVisible();
  fireEvent.click(
    within(reviewHelp).getByRole("button", {
      name: "Close Reviewing recurring charges",
    }),
  );
  const card = await screen.findByRole("article", { name: "NETFLIX" });
  expect(
    within(card).getByText("Needs review", { exact: true }),
  ).toBeInTheDocument();
  expect(
    within(card).getByText(/Latest charge increased by £2.00/),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/median of the previous three charges/),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(card).getByRole("button", {
      name: "About charge warnings for NETFLIX",
    }),
  );
  const chargeHelp = await screen.findByRole("dialog", {
    name: "Recurring charge warnings",
  });
  expect(
    within(chargeHelp).getByText(/median of the previous three charges/),
  ).toBeVisible();
  fireEvent.click(
    within(chargeHelp).getByRole("button", {
      name: "Close Recurring charge warnings",
    }),
  );
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

it("keeps manual cancellation and price changes visible while revealing provider instructions on demand", async () => {
  render(
    <MemoryRouter>
      <Subscriptions currency="GBP" />
    </MemoryRouter>,
  );
  const card = await screen.findByRole("article", { name: "NETFLIX" });
  fireEvent.click(within(card).getByRole("button", { name: "Plan to cancel" }));
  await waitFor(() =>
    expect(
      within(card).getByRole("button", { name: "Plan to cancel" }),
    ).toHaveAttribute("aria-pressed", "true"),
  );
  expect(
    within(card).getByText("Finish cancellation with the provider"),
  ).toBeVisible();
  expect(within(card).getByText(/Feng cannot cancel it for you/)).toBeVisible();
  expect(
    within(card).getByText(/Latest charge increased by £2.00/),
  ).toBeVisible();
  expect(
    within(card).queryByText(/use that store’s Subscriptions settings/),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(card).getByRole("button", { name: "Help cancelling NETFLIX" }),
  );
  const help = await screen.findByRole("dialog", {
    name: "Cancelling with the provider",
  });
  expect(
    within(help).getByText(/use that store’s Subscriptions settings/),
  ).toBeVisible();
  expect((await db.transactions.get("netflix-polish-3"))?.amount).toBe(-1499);
});

it("shows compact duplicate and stale-charge warnings with their explanations available", async () => {
  await db.transactions.bulkPut([
    transaction({
      id: "netflix-other-account",
      accountId: "a2",
      date: "2026-10-04",
      merchant: "NETFLIX",
      categoryId: "subscriptions",
      amount: -1499,
    }),
    transaction({
      id: "old-spotify",
      date: "2026-06-04",
      merchant: "SPOTIFY",
      categoryId: "subscriptions",
      amount: -999,
    }),
  ]);
  render(
    <MemoryRouter>
      <Subscriptions currency="GBP" />
    </MemoryRouter>,
  );
  const cards = await screen.findAllByRole("article", { name: "NETFLIX" });
  expect(within(cards[0]).getByText("Possible duplicate")).toBeVisible();
  expect(
    within(cards[0]).queryByText(/Also charged on another account/),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(cards[0]).getByRole("button", {
      name: "About charge warnings for NETFLIX",
    }),
  );
  const duplicateHelp = await screen.findByRole("dialog", {
    name: "Recurring charge warnings",
  });
  expect(
    within(duplicateHelp).getByText(/Check whether both plans are needed/),
  ).toBeVisible();
  fireEvent.click(
    within(duplicateHelp).getByRole("button", {
      name: "Close Recurring charge warnings",
    }),
  );
  const stale = screen.getByRole("article", { name: "SPOTIFY" });
  expect(within(stale).getByText("No recent charge")).toBeVisible();
  expect(
    within(stale).queryByText(/This does not prove cancellation/),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(stale).getByRole("button", {
      name: "About charge warnings for SPOTIFY",
    }),
  );
  const staleHelp = await screen.findByRole("dialog", {
    name: "Recurring charge warnings",
  });
  expect(
    within(staleHelp).getByText(/This does not prove cancellation/),
  ).toBeVisible();
});
