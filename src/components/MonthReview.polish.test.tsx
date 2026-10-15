import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { Category, Pot, Statement, Transaction } from "../domain/models";
import { accounts, transaction } from "../tests/helpers";
import { MonthReview } from "./MonthReview";

const fixture = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => fixture.value }));
vi.mock("./SuggestedRules", () => ({ SuggestedRules: () => null }));

function ledger() {
  const rows: Transaction[] = [];
  const statements: Statement[] = [];
  let balance = 100000;
  for (const month of ["2026-06", "2026-07", "2026-08", "2026-09"]) {
    const statementId = `review-polish-${month}`;
    const expense = month === "2026-09" ? -15000 : -10000;
    const opening = balance;
    balance += 500000 + expense;
    rows.push(
      transaction({
        id: `${statementId}-salary`,
        statementId,
        date: `${month}-01`,
        amount: 500000,
        type: "income",
        categoryId: "salary",
        merchant: "SIEMENS",
        description: "RECEIVED FROM SIEMENS",
      }),
      transaction({
        id: `${statementId}-groceries`,
        statementId,
        date: `${month}-04`,
        amount: expense,
        categoryId: "groceries",
      }),
    );
    statements.push({
      id: statementId,
      accountId: "a1",
      institution: "Barclays",
      currency: "GBP",
      statementPeriodStart: `${month}-01`,
      statementPeriodEnd: `${month}-${["2026-06", "2026-09"].includes(month) ? "30" : "31"}`,
      openingBalance: opening,
      closingBalance: balance,
      sourceFilename: "Fictitious review fixture",
      sourceFileHash: statementId,
      importedAt: "2026-10-03T12:00:00Z",
      parserVersion: "synthetic",
      extractionMethod: "embedded-text",
      validationStatus: "reconciled",
      validationDifference: 0,
      transactionCount: 2,
      warnings: [],
    });
  }
  const categories: Category[] = [
    {
      id: "groceries",
      name: "Groceries",
      kind: "expense",
      archived: false,
      color: "#F08A7E",
    },
    {
      id: "salary",
      name: "Salary",
      kind: "income",
      archived: false,
      color: "#6EA8FF",
    },
  ];
  return {
    rows,
    statements,
    categories,
    accounts: [accounts[0]],
    settings: [] as { key: string; value: string }[],
    rates: [],
    proposals: [],
    pots: [] as Pot[],
    valuations: [],
    closed: undefined,
  };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
  fixture.value = ledger();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const show = () =>
  render(
    <MemoryRouter>
      <MonthReview month="2026-09" currency="GBP" />
    </MemoryRouter>,
  );

it("shows a currency difference and percentage only for a complete month, without changing the source money", () => {
  const data = fixture.value as ReturnType<typeof ledger>;
  const before = structuredClone(data.rows);
  show();
  fireEvent.click(screen.getByRole("button", { name: "2. What changed" }));
  const change = screen.getByRole("link", { name: /Groceries/ });
  expect(change).toHaveTextContent("+£50.00");
  expect(change).toHaveTextContent("+50%");
  expect(change.querySelector("strong")).toHaveClass("spending-amount");
  expect(data.rows).toEqual(before);
});

it("withholds monthly comparisons when transactions lack their source statement", () => {
  const data = fixture.value as ReturnType<typeof ledger>;
  data.statements = data.statements.filter(
    (statement) => !statement.id.endsWith("2026-09"),
  );
  show();
  fireEvent.click(screen.getByRole("button", { name: "2. What changed" }));
  expect(
    screen.getByText(/Not comparable yet.*September 2026 unverified/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /Groceries/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("+50%")).not.toBeInTheDocument();
});

it("explains an actual price rise in the next period instead of moving it into the selected review", () => {
  const data = fixture.value as ReturnType<typeof ledger>;
  data.rows.push(
    ...[
      "2026-06-04",
      "2026-07-04",
      "2026-08-04",
      "2026-09-04",
      "2026-10-04",
    ].map((date, index) =>
      transaction({
        id: `review-price-${index}`,
        date,
        merchant: "NETFLIX",
        description: "NETFLIX",
        categoryId: "subscriptions",
        amount: index === 4 ? -1499 : -1299,
      }),
    ),
  );
  show();
  fireEvent.click(screen.getByRole("button", { name: "2. What changed" }));
  expect(
    screen.getByText(/you'll see it in October's review/),
  ).toHaveTextContent(
    /Netflix rose on 4 Oct; you'll see it in October's review/,
  );
  expect(
    screen.queryByText(/No subscription price increases/),
  ).not.toBeInTheDocument();
});

it("distinguishes the period cutoff and suggested amount from an already confirmed contribution", () => {
  const data = fixture.value as ReturnType<typeof ledger>;
  data.settings.push({
    key: "period:start",
    value: JSON.stringify({ mode: "fixed", day: 25 }),
  });
  data.pots.push({
    id: "review-insurance",
    type: "sinking",
    cadence: "annual",
    name: "Car insurance",
    targetMinor: 54000,
    targetDate: "2027-03-15",
    currency: "GBP",
    createdAt: "2026-09-01T12:00:00Z",
    contributions: [{ month: "2026-09", amountMinor: 9000 }],
  });
  show();
  fireEvent.click(screen.getByRole("button", { name: "3. Pots and goals" }));
  fireEvent.click(
    screen.getByRole("button", { name: /Car insurance.*Contribute/ }),
  );
  expect(screen.getByLabelText("Car insurance contribution (GBP)")).toHaveValue(
    "90.00",
  );
  expect(
    screen.getByText(/This month's confirmed £90.00 is shown above/),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Close Contribute to Car insurance" }),
  );
  fireEvent.click(
    screen.getByText("Why Planning may show a different suggestion"),
  );
  expect(
    screen.getByText(/calendar month, with suggestions as of/),
  ).toHaveTextContent(/calendar month, with suggestions as of 30 Sep/);
  expect(data.pots[0].contributions).toEqual([
    { month: "2026-09", amountMinor: 9000 },
  ]);
});
