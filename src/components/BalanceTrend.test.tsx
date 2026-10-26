import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import { BalanceTrend, type BalanceTrendProps } from "./BalanceTrend";
import { accounts, transaction } from "../tests/helpers";
import type { Statement } from "../domain/models";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const bank: Statement = {
  id: "bank",
  accountId: "a1",
  institution: "Barclays",
  currency: "GBP",
  statementPeriodStart: "2026-09-01",
  statementPeriodEnd: "2026-09-30",
  openingBalance: 100000,
  closingBalance: 90000,
  importedAt: "2026-10-01",
  sourceFilename: "synthetic.pdf",
  sourceFileHash: "fake",
  parserVersion: "2",
  extractionMethod: "embedded-text",
  validationStatus: "reconciled",
  transactionCount: 1,
  warnings: [],
};
const card = {
  ...bank,
  id: "card",
  accountId: "a3",
  periodSource: "transaction-coverage" as const,
  statementDate: "2026-10-02",
  openingBalance: 0,
  closingBalance: -20000,
};
const rows = [
  transaction({
    accountId: "a1",
    statementId: "bank",
    date: "2026-09-15",
    amount: -10000,
  }),
  transaction({
    id: "card-row",
    accountId: "a3",
    statementId: "card",
    date: "2026-09-15",
    amount: -20000,
  }),
];
const base = {
  accounts: [accounts[0], { ...accounts[2], displayName: "Barclaycard" }],
  statements: [bank, card],
  transactions: rows,
  valuations: [],
  rates: [],
  month: "2026-10",
  currency: "GBP",
};
function View({ values = {} }: { values?: Partial<BalanceTrendProps> }) {
  const [period, setPeriod] = useState(1);
  return (
    <MemoryRouter>
      <BalanceTrend
        {...base}
        {...values}
        period={period}
        onPeriodChange={setPeriod}
      />
    </MemoryRouter>
  );
}
it("leads with cash, its dated value and exact change despite missing card history", () => {
  const view = render(<View />);
  expect(screen.getByLabelText("Balance to show")).toHaveValue("cash");
  expect(
    view.container.querySelector(".balance-trend-headline"),
  ).toHaveTextContent("£900.00As of 30 Sep 2026");
  expect(
    view.container.querySelector(".balance-trend-change"),
  ).toHaveTextContent("£100.00 lower (−10.0%)");
  expect(
    view.container.querySelector(".balance-trend-change"),
  ).toHaveTextContent("2 to 30 Sep 2026");
  expect(
    screen.getByRole("img", { name: /Cash balances balance trend/ }),
  ).toBeVisible();
  expect(view.container.querySelector("pattern")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Account breakdown" }),
  ).not.toBeInTheDocument();
});
it("inspects real dates and missing dates with the keyboard and resets the readout on account changes", () => {
  render(<View />);
  const slider = screen.getByRole("slider", {
    name: "Inspect balance history",
  });
  fireEvent.keyDown(slider, { key: "Home" });
  expect(slider).toHaveAttribute("aria-valuetext", "2 Sep 2026: £1,000.00");
  fireEvent.keyDown(slider, { key: "End" });
  expect(slider).toHaveAttribute(
    "aria-valuetext",
    "2 Oct 2026: No verified balance",
  );
  fireEvent.change(screen.getByLabelText("Balance to show"), {
    target: { value: "account:a3" },
  });
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText("Debt owed")).toBeVisible();
  expect(
    screen.getByText("As of", { exact: false }).closest("div"),
  ).toHaveTextContent("2 Oct 2026");
  expect(screen.getByText("£200.00")).toBeVisible();
  expect(screen.getByText(/Earlier statements will show/)).toBeVisible();
});
it("labels a card credit correctly instead of turning its magnitude into debt", () => {
  render(
    <View
      values={{
        accounts: [base.accounts[1]],
        statements: [{ ...card, closingBalance: 5000 }],
        transactions: [{ ...rows[1], amount: 5000 }],
      }}
    />,
  );
  expect(screen.getByText("£50.00")).toBeVisible();
  expect(screen.getByText("Credit balance")).toBeVisible();
  expect(screen.queryByText("Debt owed")).not.toBeInTheDocument();
});
it("does not turn an unverified reported balance into a line or comparison", () => {
  const view = render(
    <View
      values={{ transactions: [{ ...rows[0], amount: -20000 }, rows[1]] }}
    />,
  );
  fireEvent.change(screen.getByLabelText("Balance to show"), {
    target: { value: "account:a1" },
  });
  expect(
    view.container.querySelector(".balance-trend-headline"),
  ).toHaveAttribute("data-verified", "false");
  expect(
    view.container.querySelector(".balance-trend-headline"),
  ).toHaveTextContent("Reported, unverified");
  expect(view.container.querySelector(".balance-trend-change")).toBeNull();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});
it("automatically finds a useful range for card snapshots without drawing an invented line", () => {
  const old = {
    ...card,
    id: "old-card",
    statementPeriodStart: "2026-07-01",
    statementPeriodEnd: "2026-07-31",
    statementDate: "2026-08-01",
    closingBalance: -5000,
  };
  const view = render(
    <View
      values={{
        accounts: [base.accounts[1]],
        statements: [old, card],
        transactions: [
          transaction({
            id: "old-purchase",
            statementId: old.id,
            accountId: "a3",
            date: "2026-07-31",
            amount: -5000,
          }),
          rows[1],
        ],
      }}
    />,
  );
  expect(screen.getByRole("button", { name: "3 months" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    view.container.querySelector(".balance-trend-change"),
  ).toHaveTextContent("Debt increased by £150.00 (+300.0%)1 Aug to 2 Oct 2026");
  expect(
    view.container.querySelectorAll(".position-history path"),
  ).toHaveLength(0);
  expect(
    view.container.querySelectorAll(
      ".position-history circle[data-verified=true]",
    ),
  ).toHaveLength(2);
  expect(
    screen.queryByRole("button", { name: "12 months" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Statement dates only")).toBeVisible();
  expect(
    screen.queryByText(/No daily balance is assumed between them/),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: /Balance trend explained$/ }),
  );
  expect(
    screen.getByText(/No daily balance is assumed between them/),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Close Balance trend explained" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "1 month" }));
  expect(screen.getByRole("button", { name: "1 month" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText(/Choose a longer range/)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Import earlier statement" }),
  ).not.toBeInTheDocument();
});
it("explains unavailable net worth without showing a zero balance or an empty plot", () => {
  const view = render(<View />);
  fireEvent.change(screen.getByLabelText("Balance to show"), {
    target: { value: "net" },
  });
  expect(screen.getByText(/Net worth needs verified balances/)).toBeVisible();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(view.container.querySelector(".balance-trend-headline")).toBeNull();
});
it("describes a credit crossing as a position improvement instead of negative debt", () => {
  const old = {
    ...card,
    id: "old-card",
    statementPeriodStart: "2026-07-01",
    statementPeriodEnd: "2026-07-31",
    statementDate: "2026-08-01",
    closingBalance: -5000,
  };
  const view = render(
    <View
      values={{
        accounts: [base.accounts[1]],
        statements: [old, { ...card, closingBalance: 5000 }],
        transactions: [
          transaction({
            id: "old-purchase",
            statementId: old.id,
            accountId: "a3",
            date: "2026-07-31",
            amount: -5000,
          }),
          { ...rows[1], amount: 5000 },
        ],
      }}
    />,
  );
  expect(
    view.container.querySelector(".balance-trend-change"),
  ).toHaveTextContent("Card position improved by £100.00");
  expect(
    view.container.querySelector(".balance-trend-change"),
  ).not.toHaveTextContent("%");
  expect(screen.getByText("Credit balance")).toBeVisible();
});
it("does not blame historic missing FX for an empty current range", () => {
  render(
    <View
      values={{
        accounts: [{ ...base.accounts[0], currency: "EUR" }, base.accounts[1]],
        statements: [
          {
            ...bank,
            currency: "EUR",
            statementPeriodStart: "2026-05-01",
            statementPeriodEnd: "2026-05-31",
            openingBalance: 0,
            closingBalance: 0,
            transactionCount: 0,
          },
          card,
        ],
        transactions: [rows[1]],
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText("Balance to show"), {
    target: { value: "cash" },
  });
  expect(
    screen.getByText(/Cash history needs verified balances/),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Check exchange rates" }),
  ).not.toBeInTheDocument();
});
