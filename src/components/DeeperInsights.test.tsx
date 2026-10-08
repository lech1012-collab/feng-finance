import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { DeeperInsights } from "./DeeperInsights";
import { accounts, transaction } from "../tests/helpers";
import { defaultCategories } from "../storage/database";
import type { Statement } from "../domain/models";
import { monthBounds } from "../domain/dates";
import { shiftDate } from "../analytics/analysis-period";

vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => [] }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function fixture(months: string[], increases = false) {
  const statements: Statement[] = months.map((month) => {
    const expense =
      increases && month === "2026-08"
        ? 50000
        : increases && month === "2026-09"
          ? 80000
          : 10000;
    return {
      id: month,
      accountId: "a1",
      institution: "Barclays",
      currency: "GBP",
      statementPeriodStart: `${month}-01`,
      statementPeriodEnd: shiftDate(monthBounds(month)[1], -1),
      openingBalance: 100000,
      closingBalance: 200000 - expense,
      importedAt: "2026-10-07",
      sourceFilename: "synthetic.pdf",
      sourceFileHash: month,
      parserVersion: "1",
      extractionMethod: "embedded-text",
      validationStatus: "reconciled",
      transactionCount: 2,
      warnings: [],
    };
  });
  const transactions = statements.flatMap((statement) => [
    transaction({
      id: `${statement.id}-income`,
      statementId: statement.id,
      date: statement.statementPeriodStart,
      merchant: "EMPLOYER",
      amount: 100000,
      type: "income",
      categoryId: "salary",
    }),
    transaction({
      id: `${statement.id}-expense`,
      statementId: statement.id,
      date: statement.statementPeriodStart,
      amount: statement.closingBalance! - 200000,
      categoryId: "shopping",
    }),
  ]);
  return { transactions, statements };
}
function show(data: ReturnType<typeof fixture>, months?: string[]) {
  return render(
    <MemoryRouter>
      <DeeperInsights
        {...data}
        accounts={[accounts[0]]}
        categories={defaultCategories}
        month="2026-09"
        currency="GBP"
        months={months}
      />
    </MemoryRouter>,
  );
}

it("collapses missing comparison history to one line with its verified sample count", () => {
  const { container } = show(fixture(["2026-08", "2026-09"]));
  expect(
    screen.getByText(
      /Comparisons start after 3 verified previous months · 1 of 3/,
    ),
  ).toBeVisible();
  expect(container.querySelector("section.card")).toBeNull();
  expect(
    screen.queryByRole("heading", { name: "What changed?" }),
  ).not.toBeInTheDocument();
});
it("does not trust reconciliation metadata if the source rows are missing", () => {
  const data = fixture(["2026-06", "2026-07", "2026-08", "2026-09"]);
  show({
    ...data,
    transactions: data.transactions.filter((row) =>
      row.date.startsWith("2026-09"),
    ),
  });
  expect(screen.getByText(/0 of 3/)).toBeVisible();
});
it("reports a quiet period compactly once three complete months exist", () => {
  show(fixture(["2026-06", "2026-07", "2026-08", "2026-09"]));
  expect(
    screen.getByText("No significant changes in the selected period."),
  ).toBeVisible();
});
it("retains separate monthly changes inside a selected multi-month range", () => {
  show(
    fixture(
      ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
      true,
    ),
    ["2026-08", "2026-09"],
  );
  expect(screen.getByText(/August 2026 · Spending rose/)).toBeVisible();
  expect(screen.getByText(/September 2026 · Spending rose/)).toBeVisible();
});
