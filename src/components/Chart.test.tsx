import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { CashChart } from "./Chart";
import type { MonthCoverage } from "../analytics/coverage";

vi.mock("recharts", async (original) => ({
  ...(await original<typeof import("recharts")>()),
  ResponsiveContainer: ({
    children,
  }: {
    children: ReactElement<Record<string, unknown>>;
  }) => cloneElement(children, { width: 350, height: 210 }),
}));
afterEach(cleanup);
const coverage = (status: MonthCoverage["status"]): MonthCoverage => ({
  status,
  complete: status === "Complete",
  covered: status === "No data" ? 0 : 1,
  total: 1,
  hasIncomeSource: status === "Complete",
  hasData: status !== "No data",
  hasUnverifiedStatements: status === "Unverified",
  verifiedStatements: [],
  missingAccountIds: [],
  incompleteAccountIds: [],
});

it("reports missing history without zero values and lets a user inspect a hatched gap", () => {
  render(
    <CashChart
      currency="GBP"
      data={[
        {
          month: "2026-08",
          label: "Aug",
          income: null,
          expenses: null,
          net: null,
          coverage: coverage("No data"),
        },
        {
          month: "2026-09",
          label: "Sep",
          income: 0,
          expenses: 0,
          net: 0,
          coverage: coverage("Complete"),
        },
      ]}
    />,
  );
  const rows = screen.getAllByRole("row");
  expect(rows[1]).toHaveTextContent("No data");
  expect(rows[1]).toHaveTextContent("No statements");
  expect(rows[1]).not.toHaveTextContent("£0.00");
  expect(rows[2]).toHaveTextContent("Complete");
  expect(within(rows[2]).getAllByText("£0.00")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Aug: No statements" }));
  expect(screen.getByRole("status")).toHaveTextContent("Aug: No statements");
});

it("keeps card-only partial income and net unavailable in the accessible values", () => {
  render(
    <CashChart
      currency="GBP"
      data={[
        {
          month: "2026-09",
          label: "Sep",
          income: null,
          expenses: 135790,
          net: null,
          coverage: coverage("Partial"),
        },
      ]}
    />,
  );
  const row = screen.getAllByRole("row")[1];
  expect(within(row).getAllByText("Not imported")).toHaveLength(2);
  expect(row).toHaveTextContent("-£1,357.90");
  expect(row).not.toHaveTextContent("£0.00");
  expect(
    screen.getByText("* Partial month · from imported accounts only."),
  ).toBeInTheDocument();
});

it("identifies unverified contributions while showing the same partial totals as the dashboard", () => {
  render(
    <CashChart
      currency="GBP"
      data={[
        {
          month: "2026-09",
          label: "Sep",
          income: 5000,
          expenses: 7000,
          net: -2000,
          coverage: {
            ...coverage("Partial"),
            hasIncomeSource: true,
            hasUnverifiedStatements: true,
          },
        },
      ]}
    />,
  );
  const row = screen.getAllByRole("row")[1];
  expect(row).toHaveTextContent("Partial · verification incomplete");
  expect(row).toHaveTextContent("-£70.00");
  expect(
    screen.getByText(
      "Statements with incomplete date or balance verification are included in partial months. Comparisons need verified dates and balances.",
    ),
  ).toBeInTheDocument();
});
