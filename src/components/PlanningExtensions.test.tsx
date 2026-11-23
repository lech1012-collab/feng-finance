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
import Planning from "../pages/Planning";
import {
  CalendarPanel,
  DebtPanel,
  MonthlyBudgetsPanel,
  PotsPanel,
  ScenarioPanel,
} from "./PlanningExtensions";
import { savedBill } from "../tests/recurring-fixtures";

it("asks before combining similar recurring names and lets Undo restore the question", async () => {
  await db.recurringSeries.put(savedBill);
  await db.transactions.bulkPut(
    ["2026-07-04", "2026-08-04", "2026-09-04"].map((date, i) =>
      transaction({
        id: `match-${i}`,
        date,
        merchant: "NETFLIX.COM",
        description: "NETFLIX.COM",
        amount: -1249,
        categoryId: "subscriptions",
      }),
    ),
  );
  const before = await db.transactions.toArray();
  render(
    <MemoryRouter>
      <CalendarPanel currency="GBP" month="2026-10" />
    </MemoryRouter>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Review possible match" }),
  );
  expect(
    screen.getByRole("dialog", { name: "Is this the same as Netflix?" }),
  ).toBeVisible();
  expect(screen.getByText("Saved payment")).toBeVisible();
  expect(screen.getByText("Detected payment")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Same bill" }));
  await waitFor(
    () =>
      expect(
        screen.queryByRole("button", { name: "Review possible match" }),
      ).not.toBeInTheDocument(),
    { timeout: 5000 },
  );
  expect(await db.transactions.toArray()).toEqual(before);
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  expect(
    await screen.findByRole(
      "button",
      { name: "Review possible match" },
      { timeout: 5000 },
    ),
  ).toBeVisible();
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
  await db.delete();
  await db.open();
  await initializeDatabase();
  await db.accounts.put(accounts[0]);
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await db.delete();
});
it("shows an ended subscription while retaining its independent calendar end date", async () => {
  const key = JSON.stringify(["a1", "GBP", "NETFLIX", false]);
  await db.recurringSeries.put({
    ...savedBill,
    matchKey: key,
    endDate: "2026-12-31",
  });
  await db.settings.put({
    key: "subscription:test",
    value: JSON.stringify({
      status: "cancelled",
      groupKey: key,
      date: "2026-10-01",
      effectiveDate: "2026-09-20",
      amount: 1099,
    }),
  });
  render(
    <MemoryRouter>
      <CalendarPanel currency="GBP" month="2026-10" />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByText("Recurring series (1)"));
  fireEvent.click(
    screen.getByRole("button", { name: /Netflix.*Ended 20 Sep/ }),
  );
  const sheet = await screen.findByRole("dialog", {
    name: "Recurring payment",
  });
  expect(
    within(sheet).getByText(/Subscription cancellation takes effect on 20 Sep/),
  ).toBeVisible();
  expect(
    within(sheet).getByRole("link", { name: "Cancellation plans" }),
  ).toHaveAttribute("href", "/subscriptions?view=cancel");
  expect(within(sheet).getByRole("textbox", { name: "End date" })).toHaveValue(
    "31/12/2026",
  );
  fireEvent.click(
    within(sheet).getByRole("button", { name: "Confirm series" }),
  );
  await waitFor(() => expect(sheet).not.toBeInTheDocument());
  expect((await db.recurringSeries.get(savedBill.id))?.endDate).toBe(
    "2026-12-31",
  );
});
it("creates a £540 irregular-cost pot, confirms October's £90 contribution and provides Undo", async () => {
  render(
    <MemoryRouter>
      <PotsPanel currency="GBP" month="2026-10" />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "New pot" }));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Car insurance" },
  });
  fireEvent.change(screen.getByLabelText("Type"), {
    target: { value: "sinking" },
  });
  fireEvent.change(screen.getByLabelText("Target amount"), {
    target: { value: "540" },
  });
  fireEvent.change(screen.getByLabelText("Due date"), {
    target: { value: "2027-03-15" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save pot" }));
  await waitFor(async () => expect(await db.pots.count()).toBe(1));
  await screen.findByRole("button", { name: "Confirm contribution" });
  fireEvent.change(screen.getByLabelText("Car insurance contribution"), {
    target: { value: "90" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm contribution" }));
  await waitFor(async () =>
    expect((await db.pots.toArray())[0].contributions).toEqual([
      { month: "2026-10", amountMinor: 9000 },
    ]),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(async () =>
    expect((await db.pots.toArray())[0].contributions).toEqual([]),
  );
});
it("opens expected calendar items as editable recurring objects and keeps original currency", async () => {
  const items = ["2026-07-04", "2026-08-04", "2026-09-04"].map((date, i) =>
    transaction({
      id: `netflix${i}`,
      date,
      merchant: "NETFLIX",
      amount: -349,
      categoryId: "subscriptions",
    }),
  );
  await db.transactions.bulkPut(items);
  render(
    <MemoryRouter>
      <CalendarPanel currency="GBP" month="2026-10" />
    </MemoryRouter>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: /4 Oct(?: 2026)?, 1 payment/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Netflix" }));
  expect(screen.getByLabelText(/^Expected amount \(GBP\)/)).toHaveValue("3.49");
  fireEvent.click(screen.getByRole("button", { name: "Confirm series" }));
  await waitFor(async () => expect(await db.recurringSeries.count()).toBe(1));
});
it("connects accessible Planning tabs to their own panels and presents no forecast until selected", async () => {
  render(
    <MemoryRouter>
      <Planning currency="GBP" month="2026-10" setMonth={() => {}} />
    </MemoryRouter>,
  );
  await screen.findByRole("tab", { name: "Budgets" });
  expect(screen.getByRole("tab", { name: "Budgets" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.queryByText("Projected total balance")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Debt" }));
  expect(
    await screen.findByRole("heading", { name: "Debt payoff planner" }),
  ).toBeVisible();
  expect(screen.getByRole("tab", { name: "Debt" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  fireEvent.click(screen.getByRole("tab", { name: "Forecast" }));
  expect(
    await screen.findByRole("heading", { name: "Projected total balance" }),
  ).toBeVisible();
  expect(
    await screen.findByRole("heading", { name: "What if?" }),
  ).toBeVisible();
  expect(
    screen.getByText("A shared verified balance is needed for every account."),
  ).toBeVisible();
  expect(
    screen.getByText(/0 of 1 account with recent verified balances/),
  ).toBeVisible();
  expect(screen.getByText(/Missing or stale balances: Current/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Import recent statements" }),
  ).toBeVisible();
  expect(screen.queryByLabelText("Selected month")).not.toBeInTheDocument();
  const horizon = within(
    screen.getByRole("group", { name: "Forecast horizon" }),
  );
  expect(screen.getByText("3 Oct to 2 Nov 2026")).toBeVisible();
  fireEvent.click(horizon.getByRole("button", { name: "60 days" }));
  expect(screen.getByText("3 Oct to 2 Dec 2026")).toBeVisible();
  fireEvent.click(horizon.getByRole("button", { name: "90 days" }));
  expect(screen.getByText("3 Oct 2026 to 1 Jan 2027")).toBeVisible();
  expect(
    screen.queryByText(/Cash and savings minus card debt/),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Forecast inputs and assumptions" }),
  );
  expect(
    screen.getByRole("dialog", { name: "Forecast inputs and assumptions" }),
  ).toHaveTextContent(/does not change imported balances or reporting totals/);
});
it("takes a forecast missing exchange rates directly to currency settings", async () => {
  render(
    <MemoryRouter initialEntries={["/planning?tab=forecast"]}>
      <Planning currency="EUR" month="2026-09" setMonth={() => {}} />
    </MemoryRouter>,
  );
  expect(
    await screen.findByRole("link", { name: "Review exchange rates" }),
  ).toHaveAttribute("href", "/settings?section=currency#global-currency");
  expect(
    screen.queryByRole("button", { name: "Import recent statements" }),
  ).not.toBeInTheDocument();
});
it("keeps the historical month and marks complete statements with an unresolved transfer as partial cash-flow coverage", async () => {
  const [cash, travel] = accounts;
  await db.accounts.put(travel);
  for (const [account, amount] of [
    [cash, -17500],
    [travel, 17500],
  ] as const) {
    const doc = `september-${account.id}`;
    await db.transactions.put(
      transaction({
        id: account.id,
        accountId: account.id,
        statementId: doc,
        amount,
        type: amount < 0 ? "expense" : "income",
      }),
    );
    await db.statements.put({
      id: doc,
      accountId: account.id,
      institution: account.institution,
      currency: "GBP",
      statementPeriodStart: "2026-09-01",
      statementPeriodEnd: "2026-09-30",
      periodSource: "printed",
      openingBalance: 50000,
      closingBalance: 50000 + amount,
      transactionCount: 1,
      sourceFilename: "synthetic.pdf",
      sourceFileHash: doc,
      importedAt: "2026-10-01T00:00:00Z",
      parserVersion: "test",
      extractionMethod: "embedded-text",
      validationStatus: "reconciled",
      warnings: [],
    });
  }
  await db.transferProposals.put({
    id: "pair",
    status: "pending",
    debitTxId: cash.id,
    creditTxId: travel.id,
    score: 1,
  });
  render(
    <MemoryRouter>
      <Planning currency="GBP" month="2026-09" setMonth={() => {}} />
    </MemoryRouter>,
  );
  expect(await screen.findByText(/Cash-flow coverage · Partial/)).toBeVisible();
  expect(screen.getByText(/Statement coverage · Complete/)).toBeVisible();
  expect(
    screen.getByRole("link", { name: "1 transfer to confirm" }),
  ).toHaveAttribute(
    "href",
    "/transactions?transfers=1&month=2026-09&allDates=0",
  );
  fireEvent.click(screen.getByRole("tab", { name: "Forecast" }));
  expect(screen.getByText("3 Oct to 2 Nov 2026")).toBeVisible();
  expect(screen.queryByLabelText("Selected month")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
  expect(screen.getByLabelText("Selected month")).toHaveValue("2026-09");
  await db.transferProposals.update("pair", { status: "rejected" });
  expect(
    await screen.findByText(/Cash-flow coverage · Complete/),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "1 transfer to confirm" }),
  ).not.toBeInTheDocument();
});
it("shows the median-based price change with yearly impact and respects Keep on the next review", async () => {
  const dates = ["2026-06-04", "2026-07-04", "2026-08-04", "2026-09-04"];
  const rows = dates.map((date, i) =>
    transaction({
      id: `rise${i}`,
      date,
      amount: i === 3 ? -1249 : -1099,
      merchant: "NETFLIX",
      description: "NETFLIX",
      categoryId: "subscriptions",
    }),
  );
  await db.transactions.bulkPut(rows);
  render(
    <MemoryRouter>
      <CalendarPanel currency="GBP" month="2026-10" />
    </MemoryRouter>,
  );
  const alert = await screen.findByRole("complementary", {
    name: "Recurring price changes",
  });
  expect(alert).toHaveTextContent("Was £10.99, now £12.49");
  expect(alert).toHaveTextContent("£18.00 more per year");
  expect(
    screen.getByRole("link", { name: "Review price changes" }),
  ).toHaveAttribute("href", "/subscriptions");
  await db.settings.put({
    key: "subscription:test",
    value: JSON.stringify({
      status: "keep",
      groupKey: JSON.stringify(["a1", "GBP", "NETFLIX", false]),
      date: "2026-10-01",
      amount: 1249,
    }),
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("complementary", { name: "Recurring price changes" }),
    ).not.toBeInTheDocument(),
  );
});
it("saving a new scenario selects it so a second save updates instead of duplicating", async () => {
  render(
    <MemoryRouter>
      <ScenarioPanel currency="GBP" points={[]} />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "What if?" });
  expect(
    screen.queryByText("Preview changes without editing your actual finances."),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "About what-if scenarios" }),
  );
  expect(
    screen.getByRole("dialog", { name: "What-if scenarios" }),
  ).toHaveTextContent("Scenario values never become actual balances.");
  fireEvent.click(
    screen.getByRole("button", { name: "Close What-if scenarios" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit scenario" }));
  expect(screen.getByText("Save up to five scenarios.")).toBeVisible();
  fireEvent.change(screen.getByRole("textbox", { name: /Amount \(GBP\)/ }), {
    target: { value: "-100" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add adjustment" }));
  fireEvent.change(screen.getByLabelText("Scenario name"), {
    target: { value: "Holiday" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save scenario" }));
  await waitFor(async () => expect(await db.scenarios.count()).toBe(1));
  const first = (await db.scenarios.toArray())[0];
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Edit scenario" }),
    ).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit scenario" }));
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Saved scenario" }),
    ).toHaveValue(first.id),
  );
  fireEvent.change(screen.getByLabelText("Scenario name"), {
    target: { value: "Holiday updated" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save scenario" }));
  await waitFor(async () =>
    expect((await db.scenarios.get(first.id))?.name).toBe("Holiday updated"),
  );
  expect(await db.scenarios.count()).toBe(1);
});

it("keeps incomplete budget amounts and missing-rate counts visible before opening their explanation", async () => {
  await db.budgets.put({
    id: "help-budget",
    categoryId: "groceries",
    month: "2026-10",
    currency: "GBP",
    amountMinor: 16000,
    rollover: "none",
  });
  await db.transactions.put(
    transaction({
      id: "help-missing-rate",
      date: "2026-10-04",
      categoryId: "groceries",
      currency: "EUR",
      amount: -1000,
    }),
  );
  const before = await db.transactions.toArray();
  render(
    <MemoryRouter>
      <MonthlyBudgetsPanel currency="GBP" month="2026-10" />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Monthly budgets" });
  expect(screen.getByText(/Unverified spending/)).toBeVisible();
  expect(
    screen.getByText(/Rates needed for 1 transaction · Partial totals/),
  ).toBeVisible();
  expect(screen.getByText("Left: unavailable")).toBeVisible();
  expect(screen.getByText("£160.00")).toBeVisible();
  expect(
    screen.queryByText(/Recorded spending is partial until/),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "How budgets work" }));
  const help = screen.getByRole("dialog", { name: "How budgets work" });
  expect(help).toHaveTextContent(
    /Recorded spending is partial until all accounts are imported and verified/,
  );
  expect(help).toHaveTextContent(/1 transaction needs exchange rates/);
  expect(await db.transactions.toArray()).toEqual(before);
  expect((await db.budgets.get("help-budget"))?.amountMinor).toBe(16000);
});

it("explains repayment strategies inside the existing sheet without saving its draft or opening another dialog", async () => {
  const before = await db.settings.toArray();
  render(
    <MemoryRouter>
      <DebtPanel currency="GBP" month="2026-10" />
    </MemoryRouter>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Edit repayment plan" }),
  );
  const sheet = screen.getByRole("dialog", { name: "Repayment plan" });
  fireEvent.change(
    within(sheet).getByRole("textbox", { name: "Monthly amount available" }),
    { target: { value: "451" } },
  );
  fireEvent.click(
    within(sheet).getByRole("button", {
      name: "About debt repayment strategies",
    }),
  );
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(
    within(sheet).getByRole("region", { name: "Debt repayment strategies" }),
  ).toHaveTextContent("Avalanche: pay the highest APR first.");
  expect(
    within(sheet).getByRole("textbox", { name: "Monthly amount available" }),
  ).toHaveValue("451");
  expect(
    within(sheet).getByRole("button", { name: "Avalanche" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await db.settings.toArray()).toEqual(before);
});
