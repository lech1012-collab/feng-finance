import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Statement } from "../domain/models";
import { accounts, transaction } from "../tests/helpers";
import { AccountBalances } from "./AccountBalances";
import { ImportPickerContext } from "./ImportPicker";

afterEach(cleanup);
const cash = accounts[0];
const card = accounts[2];
const document: Statement = {
  id: "card-statement",
  accountId: card.id,
  institution: card.institution,
  currency: "GBP",
  statementPeriodStart: "2026-09-01",
  statementPeriodEnd: "2026-09-05",
  openingBalance: 0,
  closingBalance: -135790,
  transactionCount: 1,
  sourceFilename: "synthetic.pdf",
  sourceFileHash: "synthetic",
  importedAt: "2026-10-01T00:00:00Z",
  parserVersion: "test",
  extractionMethod: "embedded-text",
  validationStatus: "reconciled",
  warnings: [],
};
const row = transaction({
  accountId: card.id,
  statementId: document.id,
  date: "2026-09-05",
  amount: -135790,
});
const cashDocument: Statement = {
  ...document,
  id: "cash-statement",
  accountId: cash.id,
  institution: cash.institution,
  openingBalance: 500000,
  closingBalance: 500000,
  transactionCount: 0,
};
function show(statements: Statement[], rows = [row], month = "2026-09") {
  return render(
    <MemoryRouter>
      <AccountBalances
        accounts={[cash, card]}
        statements={statements}
        transactions={rows}
        month={month}
        currency="GBP"
      />
    </MemoryRouter>,
  );
}

it("separates verified card debt from missing cash, withholds the net and offers direct import", () => {
  const open = vi.fn();
  render(
    <MemoryRouter>
      <ImportPickerContext.Provider value={open}>
        <AccountBalances
          accounts={[cash, card]}
          statements={[document]}
          transactions={[row]}
          month="2026-09"
          currency="GBP"
        />
      </ImportPickerContext.Provider>
    </MemoryRouter>,
  );
  expect(screen.getByText("1 of 2 accounts · Incomplete")).toBeVisible();
  const debt = screen.getAllByText("Card debt")[0].parentElement!;
  expect(within(debt).getByText("£1,357.90")).toBeVisible();
  expect(screen.getByText("Net position").parentElement).toHaveTextContent(
    "Unavailable",
  );
  expect(screen.queryByText("-£1,357.90")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Import$/ }));
  expect(open).toHaveBeenCalledOnce();
});

it("hides ineffective range controls when stored rows no longer verify", () => {
  render(
    <MemoryRouter>
      <AccountBalances
        accounts={[card]}
        statements={[document]}
        transactions={[]}
        month="2026-09"
        currency="GBP"
      />
    </MemoryRouter>,
  );
  expect(
    screen.queryByRole("group", { name: "Balance comparison period" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(
      "Import another reconciled statement to compare balances.",
    ),
  ).toBeVisible();
  expect(screen.getByText("Net position").parentElement).toHaveTextContent(
    "Unavailable",
  );
  const cardRow = screen.getByRole("link", { name: /American Express/ });
  expect(cardRow).toHaveTextContent("£1,357.90");
  expect(cardRow).toHaveTextContent("Unverified reported balance");
  expect(cardRow).toHaveTextContent("Stored transactions do not match");
});

it("shows net position only when all accounts have verified stored balances", () => {
  render(
    <MemoryRouter>
      <AccountBalances
        accounts={[cash, card]}
        statements={[cashDocument, document]}
        transactions={[row]}
        month="2026-09"
        currency="GBP"
      />
    </MemoryRouter>,
  );
  expect(screen.getByText("2 of 2 accounts · Reconciled")).toBeVisible();
  expect(screen.getByText("Net position").parentElement).toHaveTextContent(
    "£3,642.10",
  );
  expect(
    screen.queryByRole("group", { name: "Balance comparison period" }),
  ).not.toBeInTheDocument();
});

it("shows a reconciled issue-date-only card balance without claiming a printed period", () => {
  show([
    cashDocument,
    {
      ...document,
      periodSource: "transaction-coverage",
      statementDate: "2026-09-05",
    },
  ]);
  expect(screen.getByText("2 of 2 accounts · Reconciled")).toBeVisible();
  expect(
    screen.getByRole("link", { name: /American Express/ }),
  ).toHaveTextContent("As of 5 Sep 2026");
  expect(screen.getByText("Net position").parentElement).toHaveTextContent(
    "£3,642.10",
  );
  expect(
    screen.queryByRole("group", { name: "Balance comparison period" }),
  ).not.toBeInTheDocument();
});

it("shows an Amex closing balance when purchase and booking dates cross the printed period start", () => {
  show(
    [cashDocument, document],
    [{ ...row, date: "2026-08-31", bookingDate: "2026-09-01" }],
  );
  expect(screen.getByText("2 of 2 accounts · Reconciled")).toBeVisible();
  expect(
    screen.getByRole("link", { name: /American Express/ }),
  ).toHaveTextContent("£1,357.90");
  expect(screen.getByText("Net position").parentElement).toHaveTextContent(
    "£3,642.10",
  );
});

it("keeps a known reported closing visible when there is no opening balance to verify", () => {
  show([cashDocument, { ...document, openingBalance: undefined }]);
  const cardRow = screen.getByRole("link", { name: /American Express/ });
  expect(cardRow).toHaveTextContent("£1,357.90");
  expect(cardRow).toHaveTextContent("Unverified reported balance");
  expect(cardRow).toHaveTextContent("No opening balance");
  expect(screen.getByText("Net position").parentElement).toHaveTextContent(
    "Unavailable",
  );
  expect(screen.getAllByText("Card debt")[0].parentElement).toHaveTextContent(
    "Unknown",
  );
});

it("shows dated older proven cash and debt without presenting a current net position", () => {
  show([cashDocument, document], [row], "2026-10");
  expect(screen.getByText("2 of 2 accounts · Older statements")).toBeVisible();
  expect(screen.getByText("Cash").parentElement).toHaveTextContent("£5,000.00");
  expect(screen.getByText("Cash").parentElement).toHaveTextContent(
    "5 Sep 2026",
  );
  expect(screen.getAllByText("Card debt")[0].parentElement).toHaveTextContent(
    "£1,357.90",
  );
  expect(screen.getByText("Net position").parentElement).toHaveTextContent(
    "Unavailable",
  );
  expect(
    screen.getByRole("link", { name: /American Express/ }),
  ).toHaveTextContent("Older statement");
});

it("only enables comparison controls after a second distinct reconciled statement closing", () => {
  const previous: Statement = {
    ...document,
    id: "previous-card",
    statementPeriodStart: "2026-08-01",
    statementPeriodEnd: "2026-08-05",
    openingBalance: 0,
    closingBalance: 0,
    transactionCount: 0,
  };
  show([cashDocument, previous, document]);
  expect(
    screen.getByRole("group", { name: "Balance comparison period" }),
  ).toBeVisible();
});

it("does not mistake duplicate source PDFs at the same closing date for balance history", () => {
  const duplicate: Statement = {
    ...document,
    id: "duplicate-card",
    openingBalance: -135790,
    transactionCount: 0,
  };
  show([cashDocument, document, duplicate]);
  expect(
    screen.queryByRole("group", { name: "Balance comparison period" }),
  ).not.toBeInTheDocument();
});

it("does not fall back to an older verified figure when the latest closing is unverified", () => {
  const latest: Statement = {
    ...document,
    id: "latest-warning",
    statementPeriodEnd: "2026-09-30",
    validationStatus: "warning",
    closingBalance: -155790,
  };
  show(
    [cashDocument, document, latest],
    [
      row,
      {
        ...row,
        id: "latest-row",
        statementId: latest.id,
        date: "2026-09-30",
        amount: -155790,
      },
    ],
  );
  const cardRow = screen.getByRole("link", { name: /American Express/ });
  expect(cardRow).toHaveTextContent("£1,557.90");
  expect(cardRow).not.toHaveTextContent("£1,357.90");
  expect(cardRow).toHaveTextContent("Unverified reported balance");
  expect(screen.getByText("Net position").parentElement).toHaveTextContent(
    "Unavailable",
  );
});

it("labels an overpaid card as credit and preserves an actual zero balance", () => {
  show(
    [
      cashDocument,
      {
        ...document,
        openingBalance: 135790,
        closingBalance: 135790,
        transactionCount: 0,
      },
    ],
    [],
  );
  expect(
    screen.getByRole("link", { name: /American Express/ }),
  ).toHaveTextContent("Card credit");
  expect(screen.getByText("Card debt").parentElement).toHaveTextContent(
    "£0.00",
  );
  expect(screen.getByText("Net position").parentElement).toHaveTextContent(
    "£6,357.90",
  );
});
