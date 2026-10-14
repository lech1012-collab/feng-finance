import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PositionSummary } from "./PositionSummary";
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
const card = {
  ...accounts[2],
  displayName: "Barclaycard",
  institution: "Barclays" as const,
};
const row = transaction({
  id: "cardpurchase",
  accountId: card.id,
  statementId: "card-statement",
  date: "2026-09-05",
  amount: -10968,
});
const statement: Statement = {
  id: "card-statement",
  accountId: card.id,
  institution: "Barclays",
  currency: "GBP",
  statementPeriodStart: "2026-09-05",
  statementPeriodEnd: "2026-09-30",
  periodSource: "transaction-coverage",
  statementDate: "2026-10-02",
  openingBalance: 0,
  closingBalance: -10968,
  importedAt: "2026-10-02",
  sourceFilename: "synthetic.pdf",
  sourceFileHash: "hash",
  parserVersion: "2",
  extractionMethod: "embedded-text",
  validationStatus: "reconciled",
  transactionCount: 1,
  warnings: [],
};
const view = (month: string, historyOnly = false) =>
  render(
    <MemoryRouter>
      <PositionSummary
        accounts={[card]}
        statements={[statement]}
        transactions={[row]}
        valuations={[]}
        rates={[]}
        pots={[]}
        month={month}
        currency="GBP"
        period={1}
        onPeriodChange={() => {}}
        historyOnly={historyOnly}
      />
    </MemoryRouter>,
  );
it("shows dated card debt but leaves cash and net position unavailable when no cash source exists", () => {
  view("2026-10");
  expect(screen.getByRole("link", { name: /Card debt/ })).toHaveTextContent(
    "£109.68",
  );
  expect(screen.getByRole("link", { name: /Cash/ })).toHaveTextContent(
    "Not imported",
  );
  expect(screen.getByRole("link", { name: /Net worth/ })).toHaveTextContent(
    "Unavailable",
  );
  expect(screen.getByRole("link", { name: "1 accounts ›" })).toHaveAttribute(
    "href",
    "/accounts",
  );
});
it("does not attribute an October issue-date balance to September", () => {
  view("2026-09");
  expect(screen.getByRole("link", { name: /Card debt/ })).toHaveTextContent(
    "Unknown",
  );
  expect(screen.getByRole("link", { name: /Net worth/ })).toHaveTextContent(
    "Unavailable",
  );
});
it("retains the card's single dated chart point with a debt label instead of fabricating a trend", () => {
  const rendered = view("2026-10", true);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Account breakdown" }));
  expect(
    screen.getByRole("img", { name: /Verified daily account balances/ }),
  ).toBeVisible();
  expect(rendered.container.querySelectorAll("circle")).toHaveLength(1);
  expect(rendered.container.querySelector("circle title")).toHaveTextContent(
    "2 Oct 2026: £109.68 debt owed",
  );
});
it("a removed stored card row invalidates debt and net while keeping the reported account observation explicit", () => {
  render(
    <MemoryRouter>
      <PositionSummary
        accounts={[card]}
        statements={[statement]}
        transactions={[]}
        valuations={[]}
        rates={[]}
        pots={[]}
        month="2026-10"
        currency="GBP"
        period={1}
        onPeriodChange={() => {}}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: /Card debt/ })).toHaveTextContent(
    "Unknown",
  );
  expect(screen.getByRole("link", { name: /Net worth/ })).toHaveTextContent(
    "Unavailable",
  );
  expect(screen.getByRole("link", { name: "1 accounts ›" })).toHaveAttribute(
    "href",
    "/accounts",
  );
});
const openingRow = transaction({
  id: "september-salary",
  accountId: accounts[0].id,
  statementId: "september-bank",
  date: "2026-09-15",
  amount: 100000,
  type: "income",
});
const openingStatement: Statement = {
  ...statement,
  id: "september-bank",
  accountId: accounts[0].id,
  institution: accounts[0].institution,
  statementPeriodStart: "2026-09-01",
  statementPeriodEnd: "2026-09-30",
  periodSource: "printed",
  statementDate: "2026-09-30",
  openingBalance: 100000,
  closingBalance: 200000,
  transactionCount: 1,
};
const openingView = (period: number, rows = [openingRow]) =>
  render(
    <MemoryRouter>
      <PositionSummary
        accounts={[accounts[0]]}
        statements={[openingStatement]}
        transactions={rows}
        valuations={[]}
        rates={[]}
        pots={[]}
        month="2026-09"
        currency="GBP"
        period={period}
        onPeriodChange={() => {}}
      />
    </MemoryRouter>,
  );
it("uses the first statement's verified August opening point for September's month comparison", () => {
  openingView(1);
  expect(screen.getByText(/100\.0% vs last month/)).toHaveTextContent(
    "31 Aug 2026",
  );
});
it("does not invent an earlier quarterly baseline or use an opening point from corrupted rows", () => {
  const first = openingView(3);
  expect(screen.queryByText(/% vs/)).not.toBeInTheDocument();
  first.unmount();
  openingView(1, [{ ...openingRow, amount: 99900 }]);
  expect(screen.queryByText(/% vs/)).not.toBeInTheDocument();
});
