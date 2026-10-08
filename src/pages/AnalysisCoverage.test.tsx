import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  Account,
  Category,
  Statement,
  Transaction,
} from "../domain/models";
import { accounts, transaction } from "../tests/helpers";
import { defaultCategories } from "../storage/database";
import CategoryPage from "./Category";
import Analysis from "./Analysis";

const state = vi.hoisted(() => ({
  data: undefined as
    | undefined
    | {
        accounts: Account[];
        categories: Category[];
        transactions: Transaction[];
        items: Transaction[];
        statements: Statement[];
      },
}));
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => state.data }));
vi.mock("../components/CategoryAnalysisPicker", () => ({
  CategoryAnalysisPicker: () => null,
}));
vi.mock("../components/DeeperInsights", () => ({ DeeperInsights: () => null }));
vi.mock("../components/Chart", () => ({
  CashChart: ({ data }: { data: unknown }) => (
    <div data-testid="cash-series">{JSON.stringify(data)}</div>
  ),
}));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
    children,
  ComposedChart: ({ data }: { data: { amount: number | null }[] }) => (
    <div data-testid="category-series">
      {JSON.stringify(data.map((point) => point.amount))}
    </div>
  ),
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ReferenceArea: () => null,
  ReferenceLine: () => null,
  Cell: () => null,
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function statement(
  accountId: string,
  id: string,
  closingBalance: number,
  validationStatus: Statement["validationStatus"] = "reconciled",
): Statement {
  return {
    id,
    accountId,
    institution: "Barclays",
    currency: "GBP",
    statementPeriodStart: "2026-09-01",
    statementPeriodEnd: "2026-09-30",
    openingBalance: 0,
    closingBalance,
    transactionCount: 1,
    validationStatus,
    sourceFilename: "synthetic.pdf",
    sourceFileHash: id,
    parserVersion: "test",
    extractionMethod: "embedded-text",
    importedAt: "2026-10-08",
    warnings: [],
  };
}
function fixture(
  scoped: Account[],
  rows: Transaction[],
  documents: Statement[],
) {
  state.data = {
    accounts: scoped,
    transactions: rows,
    items: rows,
    statements: documents,
    categories: defaultCategories,
  };
}
function showSalary() {
  return render(
    <MemoryRouter initialEntries={["/categories/salary"]}>
      <Routes>
        <Route
          path="/categories/:id"
          element={
            <CategoryPage month="2026-09" currency="GBP" setMonth={vi.fn()} />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

it("keeps card-only Salary history unknown instead of plotting zero", () => {
  const card = accounts[2];
  fixture(
    [accounts[0], card],
    [
      transaction({
        accountId: card.id,
        statementId: "card",
        amount: -1000,
        categoryId: "groceries",
      }),
    ],
    [statement(card.id, "card", -1000)],
  );
  const { container } = showSalary();
  expect(screen.getByTestId("category-series")).toHaveTextContent(
    "[null,null,null,null,null,null]",
  );
  expect(
    container.querySelector(".category-kpis .metric strong"),
  ).toHaveTextContent("Not imported");
  const september = Array.from(
    container.querySelectorAll(".category-months a"),
  ).find((row) => row.textContent?.includes("September 2026"));
  expect(september).toHaveTextContent("No income source imported");
  expect(september).not.toHaveTextContent("£0.00");
});
it("retains a genuine zero Salary value when an income source has complete verified coverage", () => {
  fixture(
    [accounts[0]],
    [
      transaction({
        statementId: "cash",
        amount: -1000,
        categoryId: "groceries",
      }),
    ],
    [statement("a1", "cash", -1000)],
  );
  showSalary();
  expect(screen.getByTestId("category-series")).toHaveTextContent(
    "[null,null,null,null,null,0]",
  );
});
it("warns about mixed unverified imports and plots the same recorded outflow as its KPI", () => {
  fixture(
    [accounts[0]],
    [
      transaction({
        id: "income",
        statementId: "good",
        merchant: "EMPLOYER",
        date: "2026-09-01",
        amount: 480000,
        type: "income",
        categoryId: "salary",
      }),
      transaction({
        id: "expense",
        statementId: "warning",
        date: "2026-09-10",
        amount: -10000,
        categoryId: "groceries",
      }),
    ],
    [
      statement("a1", "good", 480000),
      statement("a1", "warning", -10000, "warning"),
    ],
  );
  render(
    <MemoryRouter>
      <Analysis month="2026-09" currency="GBP" setMonth={vi.fn()} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Unverified statement amounts are included",
  );
  const points = JSON.parse(screen.getByTestId("cash-series").textContent!);
  expect(points.at(-1)).toMatchObject({
    expenses: 10000,
    income: 480000,
    net: 470000,
    coverage: {
      status: "Partial",
      complete: false,
      hasUnverifiedStatements: true,
    },
  });
  expect(screen.getByText(/Not comparable yet/)).toBeVisible();
});
it("does not invent zero income for custom dates outside the imported source coverage", () => {
  const source = {
    ...statement("a1", "early", 50000),
    statementPeriodEnd: "2026-09-05",
  };
  fixture(
    [accounts[0]],
    [
      transaction({
        statementId: "early",
        date: "2026-09-01",
        amount: 50000,
        type: "income",
        categoryId: "salary",
      }),
    ],
    [source],
  );
  const { container } = render(
    <MemoryRouter>
      <Analysis month="2026-09" currency="GBP" setMonth={vi.fn()} />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Period"), {
    target: { value: "custom" },
  });
  fireEvent.change(screen.getByLabelText("From"), {
    target: { value: "2026-09-20" },
  });
  expect(
    Array.from(
      container.querySelectorAll(".metric-strip .metric strong"),
      (element) => element.textContent,
    ),
  ).toEqual(["Not imported", "Not imported", "Unavailable"]);
  const points = JSON.parse(screen.getByTestId("cash-series").textContent!);
  expect(points).toHaveLength(1);
  expect(points[0]).toMatchObject({
    income: null,
    expenses: null,
    net: null,
    coverage: { status: "No data", hasData: false, hasIncomeSource: false },
  });
});
