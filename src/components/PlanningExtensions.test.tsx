import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { db, initializeDatabase } from "../storage/database";
import { accounts, transaction } from "../tests/helpers";
import Planning from "../pages/Planning";
import { CalendarPanel, PotsPanel, ScenarioPanel } from "./PlanningExtensions";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await initializeDatabase();
  await db.accounts.put(accounts[0]);
});
afterEach(async () => {
  cleanup();
  await db.delete();
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
  expect(screen.getByRole("link", { name: "Review charge" })).toHaveAttribute(
    "href",
    "/subscriptions",
  );
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
  fireEvent.click(screen.getByRole("button", { name: "Edit scenario" }));
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
