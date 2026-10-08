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
  const { container } = render(
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
  expect(container.querySelectorAll("rect[data-series]")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Aug: No statements" }));
  expect(screen.getByRole("status")).toHaveTextContent("Aug: No statements");
});

it("renders positive SVG dimensions with spending below zero and income above it", () => {
  const { container } = render(
    <CashChart
      currency="GBP"
      data={[
        {
          month: "2026-09",
          label: "Sep",
          income: 10000,
          expenses: 5000,
          net: 5000,
          coverage: coverage("Complete"),
        },
      ]}
    />,
  );
  const income = container.querySelector('rect[data-series="income"]')!;
  const spending = container.querySelector('rect[data-series="expenses"]')!;
  const zero = Number(
    container
      .querySelector(".recharts-reference-line line")!
      .getAttribute("y1"),
  );
  for (const bar of [income, spending]) {
    expect(bar).not.toBeNull();
    expect(Number(bar.getAttribute("height"))).toBeGreaterThan(0);
    expect(Number(bar.getAttribute("width"))).toBeGreaterThan(0);
  }
  const incomeY = Number(income.getAttribute("y"));
  const incomeHeight = Number(income.getAttribute("height"));
  const spendingY = Number(spending.getAttribute("y"));
  const spendingHeight = Number(spending.getAttribute("height"));
  expect(incomeY).toBeLessThan(zero);
  expect(incomeY + incomeHeight).toBeCloseTo(zero);
  expect(spendingY).toBeCloseTo(zero);
  expect(spendingY + spendingHeight).toBeGreaterThan(zero);
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("-£50.00");
});

it("keeps partial spending visible without inventing missing income or net bars", () => {
  const { container } = render(
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
          income: null,
          expenses: 135790,
          net: null,
          coverage: coverage("Partial"),
        },
      ]}
    />,
  );
  const spending = container.querySelector('rect[data-series="expenses"]')!;
  const zero = Number(
    container
      .querySelector(".recharts-reference-line line")!
      .getAttribute("y1"),
  );
  expect(spending).not.toBeNull();
  expect(Number(spending.getAttribute("height"))).toBeGreaterThan(0);
  expect(Number(spending.getAttribute("y"))).toBeCloseTo(zero);
  expect(spending).toHaveAttribute("opacity", "0.55");
  expect(container.querySelectorAll("rect[data-series]")).toHaveLength(1);
  expect(
    container.querySelector(".recharts-line-curve")?.getAttribute("d"),
  ).toBeFalsy();
  expect(screen.getAllByRole("row")[1]).not.toHaveTextContent("£0.00");
});

it("normalizes negative income geometry without changing its signed value", () => {
  const { container } = render(
    <CashChart
      currency="GBP"
      data={[
        {
          label: "Sep",
          income: -5000,
          expenses: 7000,
          net: -12000,
        },
        {
          label: "Oct",
          income: 10000,
          expenses: 5000,
          net: 5000,
        },
      ]}
    />,
  );
  const income = container.querySelector('rect[data-series="income"]')!;
  const zero = Number(
    container
      .querySelector(".recharts-reference-line line")!
      .getAttribute("y1"),
  );
  expect(income).not.toBeNull();
  expect(Number(income.getAttribute("height"))).toBeGreaterThan(0);
  expect(Number(income.getAttribute("y"))).toBeCloseTo(zero);
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("-£50.00");
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
