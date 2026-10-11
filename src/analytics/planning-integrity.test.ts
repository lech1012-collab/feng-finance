import { expect, it } from "vitest";
import type { Statement, RecurringSeries } from "../domain/models";
import { accounts, transaction } from "../tests/helpers";
import {
  debtBalances,
  paidInFullMonthly,
  scenarioForecast,
  debtPayoff,
} from "./planning-v2";
import { convertMinor } from "./fx";

const card = accounts[2];
const row = transaction({
  id: "card-purchase",
  accountId: card.id,
  statementId: "card",
  date: "2026-09-20",
  amount: -10000,
});
const statement: Statement = {
  id: "card",
  accountId: card.id,
  institution: card.institution,
  currency: "GBP",
  statementPeriodStart: "2026-09-01",
  statementPeriodEnd: "2026-09-30",
  openingBalance: 0,
  closingBalance: -10000,
  importedAt: "2026-10-01",
  sourceFilename: "synthetic.pdf",
  sourceFileHash: "hash",
  parserVersion: "2",
  extractionMethod: "embedded-text",
  validationStatus: "reconciled",
  transactionCount: 1,
  warnings: [],
};
it("corrupted or missing original card rows cannot supply a debt payoff balance", () => {
  expect(
    debtBalances([card], [statement], [], [row], "2026-09", "2026-10-08")[0]
      .balance,
  ).toBe(10000);
  expect(
    debtBalances([card], [statement], [], [], "2026-09", "2026-10-08")[0],
  ).toMatchObject({
    balance: undefined,
    full: false,
    reason: "Stored transactions do not match the statement row count.",
  });
  expect(
    debtBalances(
      [card],
      [statement],
      [],
      [{ ...row, amount: -11000 }],
      "2026-09",
      "2026-10-08",
    )[0].balance,
  ).toBeUndefined();
});
it("paid-in-full detection requires three proved ledgers and does not fall back past a damaged latest statement", () => {
  const docs = ["07", "08", "09"].map((month) => ({
    ...statement,
    id: month,
    statementPeriodStart: `2026-${month}-01`,
    statementPeriodEnd: `2026-${month}-${month === "09" ? "30" : "31"}`,
    openingBalance: -10000,
    closingBalance: -10000,
    transactionCount: 2,
  }));
  const rows = docs.flatMap((doc) => [
    transaction({
      id: `${doc.id}-paid`,
      accountId: card.id,
      statementId: doc.id,
      date: `2026-${doc.id}-15`,
      amount: 10000,
      kind: "card_repayment",
      type: "transfer",
      description: "PAYMENT THANK YOU",
    }),
    transaction({
      id: `${doc.id}-purchase`,
      accountId: card.id,
      statementId: doc.id,
      date: `2026-${doc.id}-20`,
      amount: -10000,
    }),
  ]);
  expect(paidInFullMonthly(card, docs, rows, "2026-10-08")).toBe(true);
  expect(
    paidInFullMonthly(
      card,
      docs,
      rows.filter((t) => t.id !== "09-purchase"),
      "2026-10-08",
    ),
  ).toBe(false);
});
const series: RecurringSeries = {
  id: "netflix",
  matchKey: "netflix",
  accountId: "a1",
  name: "Netflix",
  currency: "GBP",
  cadence: "monthly",
  expectedAmountMinor: -1000,
  amountHistory: [],
  nextDue: "2026-10-15",
  status: "active",
};
it("the 25-unit default debt floor stays in the original currency before reporting conversion", () => {
  const floor = convertMinor(2500, "EUR", "GBP", "2026-10-08", [
    {
      id: "rate",
      date: "2026-10-08",
      base: "EUR",
      quote: "GBP",
      rate: "0.5",
      source: "manual",
    },
  ])!.amount;
  const result = debtPayoff(
    [
      {
        id: "eur",
        name: "Euro card",
        balanceMinor: 5000,
        apr: 0,
        currency: "GBP",
        floorMinor: floor,
      },
    ],
    undefined,
    "avalanche",
    "2026-10",
  );
  expect(result.points[0].paidMinor).toBe(1250);
  expect(result.points).toHaveLength(4);
  const percentage = debtPayoff(
    [
      {
        id: "eur",
        name: "Euro card",
        balanceMinor: 50000,
        apr: 24,
        currency: "GBP",
        floorMinor: floor,
      },
    ],
    undefined,
    "avalanche",
    "2026-10",
  );
  expect(percentage.points[0].paidMinor).toBe(1500);
});
it("pausing between billing dates changes the scenario only on the original bill cadence", () => {
  const baseline = ["2026-10-08", "2026-10-14", "2026-10-15", "2026-11-15"].map(
    (date) => ({ date, balance: 50000 }),
  );
  const forecast = scenarioForecast(
    baseline,
    {
      id: "pause",
      name: "Pause",
      createdAt: "2026-10-08",
      changes: [
        {
          id: "x",
          type: "pause",
          date: "2026-10-08",
          amountMinor: 0,
          description: "Pause Netflix",
          recurringSeriesId: series.id,
        },
      ],
    },
    [series],
  );
  expect(forecast.map((p) => p.scenario)).toEqual([50000, 50000, 51000, 52000]);
  expect(baseline.every((p) => p.balance === 50000)).toBe(true);
});
it("price changes respect cadence and pause end dates, and ignored or ended bills create no fictitious savings", () => {
  const points = ["2026-10-08", "2026-10-15", "2026-11-15"].map((date) => ({
    date,
    balance: 50000,
  }));
  const scenario = {
    id: "s",
    name: "Cheaper",
    createdAt: "2026-10-08",
    changes: [
      {
        id: "x",
        type: "recurring-change" as const,
        date: "2026-10-08",
        amountMinor: -500,
        description: "Cheaper",
        recurringSeriesId: series.id,
        endDate: "2026-10-31",
      },
    ],
  };
  expect(
    scenarioForecast(points, scenario, [series]).map((p) => p.scenario),
  ).toEqual([50000, 50500, 50500]);
  expect(
    scenarioForecast(points, scenario, [{ ...series, status: "ignored" }]).map(
      (p) => p.scenario,
    ),
  ).toEqual([50000, 50000, 50000]);
  expect(
    scenarioForecast(points, scenario, [
      { ...series, endDate: "2026-10-01" },
    ]).map((p) => p.scenario),
  ).toEqual([50000, 50000, 50000]);
});
it("reopening a scenario never refunds settled historical bills or shifts the actual anchor", () => {
  const points = [
    { date: "2026-10-31", balance: 50000 },
    { date: "2026-11-08", balance: 50000 },
    { date: "2026-11-15", balance: 49000 },
  ];
  const scenario = {
    id: "s",
    name: "Old pause",
    createdAt: "2026-10-08",
    changes: [
      {
        id: "pause",
        type: "pause" as const,
        date: "2026-10-08",
        amountMinor: 0,
        description: "Pause",
        recurringSeriesId: series.id,
      },
      {
        id: "past",
        type: "one-off" as const,
        date: "2026-10-10",
        amountMinor: -20000,
        description: "Old hypothetical expense",
      },
    ],
  };
  expect(
    scenarioForecast(points, scenario, [series], "2026-11-08").map(
      (p) => p.scenario,
    ),
  ).toEqual([50000, 50000, 50000]);
});
