import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { Statement } from "../domain/models";
import { db, initializeDatabase } from "../storage/database";
import { accounts, transaction } from "../tests/helpers";
import { DebtPanel } from "../components/PlanningExtensions";
import Home from "./Home";
import Subscriptions from "./Subscriptions";

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
  await db.delete();
  await db.open();
  await initializeDatabase();
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await db.delete();
});

async function seedCardAndMortgage(minimum?: number) {
  const card = { ...accounts[2], apr: 24 };
  const mortgage = {
    ...accounts[0],
    id: "mortgage",
    displayName: "Home mortgage",
    tracking: "manual" as const,
    accountType: "mortgage" as const,
    apr: 4.5,
    minPaymentMinor: minimum,
  };
  await db.accounts.bulkPut([card, mortgage]);
  await db.valuations.put({
    id: "mortgage-value",
    accountId: mortgage.id,
    date: "2026-09-30",
    valueMinor: 28000000,
  });
  await db.statements.put({
    id: "card-statement",
    accountId: card.id,
    institution: card.institution,
    currency: card.currency,
    statementPeriodStart: "2026-09-01",
    statementPeriodEnd: "2026-09-30",
    openingBalance: 0,
    closingBalance: -200000,
    transactionCount: 1,
    sourceFilename: "fictitious.pdf",
    sourceFileHash: "synthetic",
    importedAt: "2026-10-01T12:00:00Z",
    parserVersion: "synthetic",
    extractionMethod: "embedded-text",
    validationStatus: "reconciled",
    warnings: [],
  });
  await db.transactions.put(
    transaction({
      id: "card-purchase",
      accountId: card.id,
      statementId: "card-statement",
      date: "2026-09-30",
      amount: -200000,
    }),
  );
  await db.settings.put({
    key: "debt-plan:GBP",
    value: JSON.stringify({
      payment: "300",
      strategy: "avalanche",
      custom: [],
    }),
  });
}

it("shows a valid card payoff plan while leaving a mortgage without an actual monthly payment out of the calculation", async () => {
  await seedCardAndMortgage();
  const before = await db.accounts.get("mortgage");
  render(
    <MemoryRouter>
      <DebtPanel currency="GBP" month="2026-09" />
    </MemoryRouter>,
  );
  await screen.findByText("Interest saved vs minimum only");
  expect(
    screen.queryByText(/below the required minimum/),
  ).not.toBeInTheDocument();
  const table = screen
    .getByRole("columnheader", { name: "Estimated payoff" })
    .closest("table")!;
  expect(within(table).getByText("Card")).toBeVisible();
  expect(within(table).queryByText("Home mortgage")).not.toBeInTheDocument();
  expect(await db.accounts.get("mortgage")).toEqual(before);
  expect((await db.valuations.get("mortgage-value"))?.valueMinor).toBe(
    28000000,
  );
});

it("includes an entered mortgage payment but hides interest and savings when the monthly amount cannot cover the required payments", async () => {
  await seedCardAndMortgage(125912);
  render(
    <MemoryRouter>
      <DebtPanel currency="GBP" month="2026-09" />
    </MemoryRouter>,
  );
  await screen.findByText(/£1,319.12/);
  await waitFor(() =>
    expect(screen.queryByText("Total interest")).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByText("Interest saved vs minimum only"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Estimated debt-free")).not.toBeInTheDocument();
  expect(screen.queryByText(/minor units/)).not.toBeInTheDocument();
  expect((await db.accounts.get("mortgage"))?.minPaymentMinor).toBe(125912);
});

async function seedForecastHistory() {
  await db.accounts.put(accounts[0]);
  let balance = 100000;
  for (const [month, lastDay] of [
    ["07", "31"],
    ["08", "31"],
    ["09", "30"],
  ]) {
    const id = `history-${month}`;
    const rows = [
      transaction({
        id: `${id}-salary`,
        statementId: id,
        date: `2026-${month}-25`,
        amount: 300000,
        merchant: "SALARY",
        description: "SALARY",
        categoryId: "salary",
        type: "income",
      }),
      transaction({
        id: `${id}-subscription`,
        statementId: id,
        date: `2026-${month}-04`,
        amount: -1299,
        merchant: "NETFLIX",
        description: "NETFLIX",
        categoryId: "subscriptions",
      }),
    ];
    const statement: Statement = {
      id,
      accountId: accounts[0].id,
      institution: "Barclays",
      currency: "GBP",
      statementPeriodStart: `2026-${month}-01`,
      statementPeriodEnd: `2026-${month}-${lastDay}`,
      openingBalance: balance,
      closingBalance: balance + 298701,
      transactionCount: 2,
      sourceFilename: "synthetic.pdf",
      sourceFileHash: id,
      importedAt: "2026-10-01T12:00:00Z",
      parserVersion: "synthetic",
      extractionMethod: "embedded-text",
      validationStatus: "reconciled",
      warnings: [],
    };
    await db.statements.put(statement);
    await db.transactions.bulkPut(rows);
    balance += 298701;
  }
}

it("keeps Home future payment conversions unknown and shows native amounts rather than zero when rates are missing", async () => {
  await seedForecastHistory();
  const originals = await db.transactions.toArray();
  const view = render(
    <MemoryRouter>
      <Home month="2026-09" setMonth={() => {}} currency="USD" />
    </MemoryRouter>,
  );
  const heading = await screen.findByRole("heading", { name: "Coming up" });
  const section = heading.closest("section")!;
  expect(within(section).getAllByText("Rate needed").length).toBeGreaterThan(0);
  expect(section).toHaveTextContent("+£3,000.00");
  expect(section).toHaveTextContent("−£12.99");
  expect(section).not.toHaveTextContent("US$0.00");
  expect(await db.transactions.toArray()).toEqual(originals);
  view.unmount();
});

it("withholds subscription yearly totals without exchange rates and retains the source-currency yearly cost", async () => {
  await seedForecastHistory();
  render(
    <MemoryRouter>
      <Subscriptions currency="USD" />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", {
    name: /^Subscriptions(?: and bills)?$/,
  });
  expect(await screen.findByText("Rates needed")).toBeVisible();
  expect(screen.getByText(/Original yearly amounts/)).toHaveTextContent(
    "£155.88",
  );
  expect(screen.queryByText(/US\$0\.00/)).not.toBeInTheDocument();
  expect(await db.fxRates.count()).toBe(0);
});
