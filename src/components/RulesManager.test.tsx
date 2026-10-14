import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { db } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { accounts, transaction } from "../tests/helpers";
import { RulesManager } from "./RulesManager";
import { AdvancedSearch } from "./AdvancedSearch";
import { TagPicker } from "./TagManager";
import { ReportBuilder } from "./ReportBuilder";
import { TagAnalysis } from "./TagAnalysis";
import { MemoryRouter } from "react-router-dom";
beforeEach(async () => {
  await clearLocalData();
  await db.accounts.bulkPut(accounts);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
afterEach(cleanup);

describe("reviewable rule workflow", () => {
  it("previews matches, applies a rule to existing records and offers Undo", async () => {
    const t = transaction({
      description: "AMZN DIGITAL",
      merchant: "AMZN",
      amount: -349,
      categoryId: undefined,
    });
    await db.transactions.put(t);
    render(<RulesManager />);
    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));
    await screen.findByRole(
      "option",
      { name: "Entertainment" },
      { timeout: 10000 },
    );
    fireEvent.change(screen.getByLabelText("Rule name"), {
      target: { value: "Prime Video" },
    });
    fireEvent.change(screen.getByLabelText("Condition 1 value"), {
      target: { value: "AMZN" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    expect(screen.getByRole("dialog", { name: "Create rule" })).toBeVisible();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Condition 2 field" }),
      { target: { value: "amount" } },
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Condition 2 comparison" }),
      { target: { value: "lt" } },
    );
    fireEvent.change(screen.getByLabelText("Condition 2 value"), {
      target: { value: "10" },
    });
    fireEvent.change(
      screen.getByLabelText("Category", { selector: "select" }),
      { target: { value: "entertainment" } },
    );
    await screen.findByRole("heading", {
      name: "Matches 1 existing transaction",
    });
    expect(
      screen.getByLabelText("Apply to existing transactions"),
    ).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    await waitFor(async () =>
      expect((await db.transactions.get(t.id))?.categoryId).toBe(
        "entertainment",
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(async () =>
      expect(await db.transactions.get(t.id)).toEqual(t),
    );
  });
});

describe("search, tags and report controls", () => {
  it("shows a split parent once when a child matches a saved tag query", async () => {
    const parent = transaction({
      id: "parent",
      amount: -6000,
      kind: "split_parent",
    });
    const children = [
      transaction({
        id: "a",
        amount: -4500,
        parentId: parent.id,
        tags: ["trip"],
        categoryId: "groceries",
      }),
      transaction({
        id: "b",
        amount: -1500,
        parentId: parent.id,
        categoryId: "household",
      }),
    ];
    const change = vi.fn();
    render(
      <AdvancedSearch
        transactions={children}
        sourceTransactions={[parent, ...children]}
        accounts={accounts}
        tags={[
          { id: "trip", name: "Lisbon", colour: "#A99BD6", archived: false },
        ]}
        onChange={change}
      />,
    );
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Advanced transaction query" }),
      { target: { value: "tag:lisbon" } },
    );
    await waitFor(() => expect(change).toHaveBeenLastCalledWith([parent]));
    expect(screen.getByText("1 matching transaction")).toBeVisible();
    expect(screen.getByText(/1 match is within split payments/)).toBeVisible();
  });
  it("creates and selects a tag without leaving the sorting surface", async () => {
    const change = vi.fn();
    render(<TagPicker value={[]} onChange={change} />);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Find or create a tag" }),
      { target: { value: "Lisbon trip" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Lisbon trip" }));
    await waitFor(async () =>
      expect((await db.tags.toArray())[0]?.name).toBe("Lisbon trip"),
    );
    const tag = (await db.tags.toArray())[0];
    expect(change).toHaveBeenCalledWith([tag.id]);
  });
  it("shows a tag total, dates and categories across six trip expenses", () => {
    const categories = ["travel", "restaurants", "transport"].map((id) => ({
      id,
      name: id[0].toUpperCase() + id.slice(1),
      kind: "expense" as const,
      archived: false,
      color: "#000000",
    }));
    const rows = Array.from({ length: 6 }, (_, i) =>
      transaction({
        id: String(i),
        tags: ["trip"],
        categoryId: categories[i % 3].id,
        amount: -1000,
        date: `2026-09-0${i + 1}`,
      }),
    );
    render(
      <MemoryRouter>
        <TagAnalysis
          transactions={rows}
          categories={categories}
          tags={[
            {
              id: "trip",
              name: "Lisbon trip",
              colour: "#A99BD6",
              archived: false,
            },
          ]}
          currency="GBP"
        />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Tag"), {
      target: { value: "trip" },
    });
    expect(screen.getByText("−£60.00")).toBeVisible();
    expect(screen.getByRole("rowheader", { name: "Travel" })).toBeVisible();
    expect(screen.getByText(/6 transactions/)).toBeVisible();
  });
  it("returns the same text-query results shown by the transaction filter", async () => {
    const change = vi.fn();
    const rows = [
      transaction({ id: "a", description: "AMZN", amount: -349 }),
      transaction({ id: "b", description: "AMZN", amount: -2499 }),
    ];
    render(
      <AdvancedSearch
        transactions={rows}
        accounts={accounts}
        onChange={change}
      />,
    );
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Advanced transaction query" }),
      { target: { value: "amzn <10 2026" } },
    );
    await waitFor(() => expect(change).toHaveBeenLastCalledWith([rows[0]]));
    expect(screen.getByText("1 matching transaction")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(change).toHaveBeenLastCalledWith(rows));
  });
  it("saves named view conditions and displays the pinned quick filter", async () => {
    const change = vi.fn();
    render(
      <AdvancedSearch
        transactions={[]}
        accounts={accounts}
        onChange={change}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Build a filter" }));
    fireEvent.change(screen.getByLabelText("View name"), {
      target: { value: "Small purchases" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    await screen.findByRole("button", { name: "Small purchases" });
    expect((await db.savedViews.toArray())[0]).toMatchObject({
      name: "Small purchases",
      pinned: true,
    });
  });
  it("makes tags selectable on the graphical tag object", async () => {
    await db.tags.put({
      id: "trip",
      name: "Lisbon trip",
      colour: "#A99BD6",
      archived: false,
    });
    const change = vi.fn();
    render(<TagPicker value={[]} onChange={change} />);
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Lisbon trip" }),
    );
    expect(change).toHaveBeenCalledWith(["trip"]);
  });
  it("groups signed spending and saves an analysis report", async () => {
    const categories = await db.categories.toArray();
    const rows = [transaction({ amount: -349, categoryId: "entertainment" })];
    render(
      <MemoryRouter>
        <ReportBuilder
          transactions={rows}
          accounts={accounts}
          categories={categories}
          currency="GBP"
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("rowheader", { name: "Entertainment" }),
    ).toBeVisible();
    expect(screen.getByText("−£3.49")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Edit report" }));
    fireEvent.change(screen.getByLabelText("Report name"), {
      target: { value: "My categories" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save report" }));
    await waitFor(async () =>
      expect((await db.savedReports.toArray())[0]).toMatchObject({
        name: "My categories",
        pinned: true,
      }),
    );
  });
});
