import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ReportBuilder } from "./ReportBuilder";
import { db, initializeDatabase } from "../storage/database";
import { accounts, transaction } from "../tests/helpers";
import type { Transaction } from "../domain/models";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await initializeDatabase();
  await db.accounts.bulkPut(accounts);
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await db.delete();
});
async function show(rows: Transaction[]) {
  const categories = await db.categories.toArray();
  return render(
    <MemoryRouter>
      <ReportBuilder
        transactions={rows}
        accounts={accounts}
        categories={categories}
        currency="GBP"
      />
    </MemoryRouter>,
  );
}

it("opens with report values and saves a named report from a sheet with local Undo", async () => {
  const original = transaction({ amount: -349, categoryId: "entertainment" });
  await db.transactions.put(original);
  await show([original]);
  expect(
    screen.getByRole("rowheader", { name: "Entertainment" }),
  ).toBeVisible();
  expect(screen.getByText("−£3.49")).toBeVisible();
  expect(screen.queryByLabelText("Report name")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit report" }));
  const editor = screen.getByRole("dialog", { name: "Edit report" });
  expect(within(editor).getByLabelText("Report name")).toHaveValue(
    "Spending by category",
  );
  expect(
    within(editor).getByRole("button", { name: "Save report" }),
  ).toBeEnabled();
  fireEvent.change(within(editor).getByLabelText("Report name"), {
    target: { value: "My spending" },
  });
  fireEvent.click(within(editor).getByRole("button", { name: "Save report" }));
  await screen.findByText("Report saved and pinned to Analyse.");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect((await db.savedReports.toArray())[0]?.name).toBe("My spending");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(async () => expect(await db.savedReports.count()).toBe(0));
  expect(await db.transactions.get(original.id)).toEqual(original);
});

it("shows an empty result for zero aggregate amounts and retains their transaction count", async () => {
  await show([
    transaction({ id: "purchase", amount: -500, categoryId: undefined }),
    transaction({
      id: "credit",
      amount: 500,
      categoryId: undefined,
      type: "income",
    }),
  ]);
  expect(
    screen.getByText("No non-zero amounts match this report."),
  ).toBeVisible();
  expect(screen.queryByText("£0.00")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit report" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Measure" }), {
    target: { value: "count" },
  });
  fireEvent.click(screen.getByRole("button", { name: "View report" }));
  expect(
    screen.getByRole("rowheader", { name: "Uncategorised" }),
  ).toBeVisible();
  expect(screen.getByRole("cell", { name: "2" })).toBeVisible();
  expect(screen.getAllByRole("columnheader", { name: "Count" })).toHaveLength(
    1,
  );
});

it("shows Self Assessment results first and keeps allowable-category choices in a sheet", async () => {
  await db.settings.put({ key: "property-tax-report", value: "true" });
  const year = new Date().getFullYear() - 1;
  const original = [
    transaction({
      id: "rent",
      date: `${year}-09-05`,
      amount: 210000,
      categoryId: "property-income",
      type: "income",
    }),
    transaction({
      id: "repair",
      date: `${year}-09-06`,
      amount: -50000,
      categoryId: "property",
    }),
    transaction({
      id: "groceries",
      date: `${year}-09-07`,
      amount: -20000,
      categoryId: "groceries",
    }),
  ];
  await db.transactions.bulkPut(original);
  await show(original);
  const tax = await screen.findByRole("region", {
    name: "Property income for Self Assessment",
  });
  const summary = tax.querySelector<HTMLElement>(".property-tax-summary")!;
  expect(within(summary).getByText("£2,100.00")).toBeVisible();
  expect(within(summary).getByText("£500.00")).toBeVisible();
  expect(within(summary).getByText("£1,600.00")).toBeVisible();
  expect(within(tax).getByText("Not tax advice.")).toBeVisible();
  expect(within(tax).queryByRole("checkbox")).not.toBeInTheDocument();
  expect(within(tax).getByRole("group", { name: "Tax year" })).toBeVisible();
  fireEvent.click(
    within(tax).getByRole("button", { name: "Choose allowable expenses" }),
  );
  const choices = screen.getByRole("dialog", {
    name: "Allowable expense categories",
  });
  const checkboxes = within(choices).getAllByRole("checkbox");
  expect(checkboxes[0]).toHaveAccessibleName("Property");
  expect(checkboxes[0]).toBeChecked();
  fireEvent.click(within(choices).getByRole("checkbox", { name: "Property" }));
  fireEvent.click(within(choices).getByRole("checkbox", { name: "Groceries" }));
  fireEvent.click(
    within(choices).getByRole("button", { name: "View tax summary" }),
  );
  expect(within(summary).getByText("£200.00")).toBeVisible();
  expect(within(summary).getByText("£1,900.00")).toBeVisible();
  expect(await db.transactions.toArray()).toEqual(
    [...original].sort((a, b) => a.id.localeCompare(b.id)),
  );
});

it("does not show zero totals for a report and tax year without matching records", async () => {
  await db.settings.put({ key: "property-tax-report", value: "true" });
  await show([]);
  await screen.findByRole("region", {
    name: "Property income for Self Assessment",
  });
  expect(screen.getByText("No transactions match this report.")).toBeVisible();
  expect(
    screen.getByText("No transactions match this tax year."),
  ).toBeVisible();
  expect(screen.queryByText("£0.00")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Export property tax transactions" }),
  ).toBeDisabled();
});

it("asks before deleting a saved report and lets Undo restore it locally", async () => {
  const report = {
    id: "fictitious-report",
    name: "My groceries",
    groupBy: "category" as const,
    measure: "sum" as const,
    chart: "table" as const,
    conditions: [],
    pinned: true,
  };
  await db.savedReports.put(report);
  await show([]);
  fireEvent.click(await screen.findByText("Manage saved reports"));
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(await db.savedReports.get(report.id)).toEqual(report);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await screen.findByText("Report deleted.");
  expect(await db.savedReports.get(report.id)).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(async () =>
    expect(await db.savedReports.get(report.id)).toEqual(report),
  );
});
