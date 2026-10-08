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
    screen.getByText("Import reconciled history to compare balances."),
  ).toBeVisible();
  expect(screen.getByText("Net position").parentElement).toHaveTextContent(
    "Unavailable",
  );
});

it("shows net position only when all accounts have verified stored balances", () => {
  const cashDocument = {
    ...document,
    id: "cash-statement",
    accountId: cash.id,
    institution: cash.institution,
    openingBalance: 500000,
    closingBalance: 500000,
    transactionCount: 0,
  };
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
    screen.getByRole("group", { name: "Balance comparison period" }),
  ).toBeVisible();
});
