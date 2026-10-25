import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { db, initializeDatabase } from "../storage/database";
import { accounts, transaction } from "../tests/helpers";
import {
  CalendarPanel,
  MonthlyBudgetsPanel,
  PotsPanel,
  ScenarioPanel,
} from "./PlanningExtensions";

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
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

it("presents scenario results before fields and keeps a £200 preview separate from saved and actual records", async () => {
  render(
    <MemoryRouter>
      <ScenarioPanel
        currency="GBP"
        points={[
          { date: "2026-10-13", balance: 1000000 },
          { date: "2026-10-14", balance: 1000000 },
          { date: "2026-11-14", balance: 1000000 },
        ]}
      />
    </MemoryRouter>,
  );
  const edit = await screen.findByRole("button", { name: "Edit scenario" });
  expect(
    screen.queryByRole("textbox", { name: "Amount (GBP)" }),
  ).not.toBeInTheDocument();
  fireEvent.click(edit);
  expect(
    screen.getByRole("dialog", { name: "Edit scenario" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Amount (GBP)" }), {
    target: { value: "200" },
  });
  fireEvent.change(screen.getByLabelText("Label"), {
    target: { value: "Car repair" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add adjustment" }));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByText(/less on/)).toHaveTextContent(
    "£200.00 less on 14 Nov",
  );
  expect(screen.queryByText("13 Oct")).not.toBeInTheDocument();
  expect(await db.scenarios.count()).toBe(0);
  expect(await db.transactions.count()).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Edit scenario" }));
  fireEvent.click(screen.getByRole("button", { name: "Save scenario" }));
  await waitFor(async () => expect(await db.scenarios.count()).toBe(1));
  expect((await db.scenarios.toArray())[0].changes).toEqual([
    expect.objectContaining({
      amountMinor: -20000,
      description: "Car repair",
      date: "2026-10-14",
    }),
  ]);
  expect(await db.transactions.count()).toBe(0);
});

it("uses a status chip for a pot and retains its confirmed contribution and dated context", async () => {
  const pot = {
    id: "polish-pot",
    type: "sinking" as const,
    cadence: "annual" as const,
    name: "Car insurance",
    targetMinor: 54000,
    targetDate: "2027-03-15",
    currency: "GBP",
    createdAt: "2026-10-01T12:00:00Z",
    contributions: [{ month: "2026-10", amountMinor: 9000 }],
  };
  await db.pots.put(pot);
  const { container } = render(
    <MemoryRouter>
      <PotsPanel currency="GBP" month="2026-10" />
    </MemoryRouter>,
  );
  const status = await screen.findByText("On track");
  expect(status.closest(".ui-chip-visual")).not.toBeNull();
  expect(screen.queryByText(/Calculated as of/)).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", {
      name: "How this suggestion works for Car insurance",
    }),
  );
  expect(screen.getByText(/Calculated as of/)).toHaveTextContent(
    /Calculated as of 14 Oct for the calendar month/,
  );
  expect(container.querySelector(".ui-status-chip")).not.toBeNull();
  expect((await db.pots.get(pot.id))?.contributions).toEqual(pot.contributions);
});
it("shows the past budget result before setup actions and edits the category object in a sheet", async () => {
  const budget = {
    id: "past-budget",
    categoryId: "groceries",
    month: "2026-09",
    currency: "GBP",
    amountMinor: 16000,
    rollover: "none" as const,
  };
  await db.budgets.put(budget);
  await db.transactions.put(
    transaction({
      amount: -10000,
      categoryId: "groceries",
      date: "2026-09-04",
    }),
  );
  render(
    <MemoryRouter>
      <MonthlyBudgetsPanel currency="GBP" month="2026-09" />
    </MemoryRouter>,
  );
  const result = await screen.findByText("£60.00 unspent");
  const setup = screen.getByRole("button", { name: "Set budget" });
  expect(
    result.compareDocumentPosition(setup) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getByText("Ended 30 Sep")).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const category = screen.getByRole("button", { name: "Groceries" });
  expect(category.querySelector(".category-colour-dot")).not.toBeNull();
  fireEvent.click(category);
  expect(screen.getByRole("dialog", { name: "Monthly budget" })).toBeVisible();
  expect(await db.budgets.get(budget.id)).toEqual(budget);
});

it("keeps recurring direction values intact when choosing them through the segmented control", async () => {
  await db.transactions.bulkPut(
    ["2026-07-04", "2026-08-04", "2026-09-04"].map((date, index) =>
      transaction({
        id: `toggle-${index}`,
        date,
        merchant: "NETFLIX",
        amount: -349,
        categoryId: "subscriptions",
      }),
    ),
  );
  render(
    <MemoryRouter>
      <CalendarPanel currency="GBP" month="2026-10" />
    </MemoryRouter>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: /4 Oct(?: 2026)?, 1 payment/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Netflix" }));
  const direction = screen.getByRole("button", { name: "Money in" });
  fireEvent.click(direction);
  expect(direction).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText(/^Expected amount \(GBP\)/)).toHaveValue("3.49");
  fireEvent.click(screen.getByRole("button", { name: "Confirm series" }));
  await waitFor(async () => expect(await db.recurringSeries.count()).toBe(1));
  expect((await db.recurringSeries.toArray())[0].expectedAmountMinor).toBe(349);
});
