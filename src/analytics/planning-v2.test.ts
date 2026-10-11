import { describe, expect, it } from "vitest";
import {
  debtPayoff,
  detectRecurringSeries,
  potProgress,
  potsOverview,
  recurringCalendar,
  rolloverBudget,
  scenarioForecast,
  paidInFullMonthly,
} from "./planning-v2";
import {
  estimateMortgage,
  netWorthHistory,
  netWorthOverview,
} from "./net-worth";
import { subscriptionPriceRise } from "./subscriptions";
import { accounts, transaction } from "../tests/helpers";
import type {
  Account,
  MonthlyBudget,
  Pot,
  RecurringSeries,
  Scenario,
} from "../domain/models";

const pot: Pot = {
  id: "insurance",
  type: "sinking",
  name: "Car insurance",
  targetMinor: 54000,
  currency: "GBP",
  targetDate: "2027-03-15",
  createdAt: "2026-10-01T00:00:00Z",
  contributions: [],
};
it("consumes a funded annual bill from earmarks and prepares the next cycle", () => {
  const p = {
    ...pot,
    cadence: "annual" as const,
    linkedCategoryId: "insurance",
    contributions: [{ month: "2026-10", amountMinor: 54000 }],
  };
  const result = potProgress(p, "2027-03-31", undefined, [
    transaction({
      date: "2027-03-15",
      categoryId: "insurance",
      amount: -54000,
    }),
  ]);
  expect(result).toMatchObject({
    covered: true,
    savedMinor: 0,
    consumedMinor: 54000,
    nextTargetDate: "2028-03-15",
    monthlyMinor: 4500,
    onTrack: true,
  });
});
it("does not consume unrelated small insurance charges or a matching amount far from the due date", () => {
  const p = {
    ...pot,
    linkedCategoryId: "insurance",
    contributions: [{ month: "2026-10", amountMinor: 54000 }],
  };
  const result = potProgress(p, "2027-03-31", undefined, [
    transaction({
      id: "small",
      date: "2027-03-15",
      categoryId: "insurance",
      amount: -1000,
    }),
    transaction({
      id: "early",
      date: "2026-10-15",
      categoryId: "insurance",
      amount: -54000,
    }),
  ]);
  expect(result).toMatchObject({
    savedMinor: 54000,
    consumedMinor: 0,
    covered: false,
  });
});
it("keeps future month contributions out of a past-period earmark total", () => {
  const p = {
    ...pot,
    contributions: [
      { month: "2026-10", amountMinor: 9000 },
      { month: "2026-11", amountMinor: 9000 },
    ],
  };
  expect(potsOverview([p], [], [], [], "GBP", "2026-10-31", [])).toMatchObject({
    setAsideMinor: 9000,
    partial: false,
  });
});
it("converts foreign earmarks, retains native amounts and marks missing rates unknown", () => {
  const p = {
    ...pot,
    currency: "EUR",
    contributions: [{ month: "2026-10", amountMinor: 9000 }],
  };
  const rates = [
    {
      id: "rate",
      date: "2026-10-07",
      base: "EUR",
      quote: "GBP",
      rate: "0.85",
      source: "ecb" as const,
    },
  ];
  expect(
    potsOverview([p], [], [], [], "GBP", "2026-10-08", rates),
  ).toMatchObject({ setAsideMinor: 7650, partial: false, converted: true });
  expect(potsOverview([p], [], [], [], "GBP", "2026-10-08", [])).toMatchObject({
    setAsideMinor: undefined,
    partial: true,
    missing: 1,
  });
  expect(p.contributions[0].amountMinor).toBe(9000);
});
it("uses a verified linked native savings balance and counts a shared account once", () => {
  const savings = { ...accounts[0], accountType: "savings" as const };
  const row = transaction({
    id: "salary",
    date: "2026-09-30",
    amount: 100000,
    type: "income",
  });
  const statement = {
    id: "s1",
    accountId: "a1",
    institution: "Barclays" as const,
    currency: "GBP",
    statementPeriodStart: "2026-09-01",
    statementPeriodEnd: "2026-09-30",
    openingBalance: 100000,
    closingBalance: 200000,
    importedAt: "2026-10-01",
    sourceFilename: "synthetic.pdf",
    sourceFileHash: "hash",
    parserVersion: "1",
    extractionMethod: "embedded-text" as const,
    validationStatus: "reconciled" as const,
    transactionCount: 1,
    warnings: [],
  };
  const p = { ...pot, linkedAccountId: savings.id };
  expect(
    potsOverview(
      [p, { ...p, id: "other" }],
      [savings],
      [statement],
      [row],
      "GBP",
      "2026-09-30",
      [],
    ),
  ).toMatchObject({ setAsideMinor: 200000, partial: false });
  expect(
    potsOverview([p], [savings], [statement], [], "GBP", "2026-09-30", []),
  ).toMatchObject({ setAsideMinor: undefined, partial: true });
});
it("includes manual wallet payments once in net worth", () => {
  const wallet = { ...accounts[0], tracking: "manual" as const };
  const valuations = [
    {
      id: "opening",
      accountId: wallet.id,
      date: "2026-09-01",
      valueMinor: 20000,
      note: "Cash opening balance",
    },
  ];
  const rows = [
    transaction({
      id: "manual",
      date: "2026-09-03",
      source: "manual",
      amount: -1200,
    }),
  ];
  expect(
    netWorthOverview([wallet], [], valuations, "2026-09-30", "GBP", rows),
  ).toMatchObject({ total: 18800, complete: true });
  expect(
    netWorthHistory(
      [wallet],
      [],
      valuations,
      "2026-09-01",
      "2026-09-30",
      "GBP",
      rows,
    ).some((p) => p.date === "2026-09-03" && p.total === 18800),
  ).toBe(true);
});
it("sets aside £90 per month for the six-month £540 annual-cost pot", () => {
  expect(potProgress(pot, "2026-10-01")).toMatchObject({
    monthlyMinor: 9000,
    behindMinor: 9000,
  });
  expect(
    potProgress(
      { ...pot, contributions: [{ month: "2026-10", amountMinor: 9000 }] },
      "2026-10-31",
    ),
  ).toMatchObject({ monthlyMinor: 9000, onTrack: true, savedMinor: 9000 });
});
it("uses linked savings balances without subtracting earmarks from real balances", () => {
  const p = { ...pot, linkedAccountId: "savings" };
  expect(potProgress(p, "2026-10-01", 10000).savedMinor).toBe(10000);
  expect(potProgress(p, "2026-10-01").savedMinor).toBe(0);
});
it("marks a matching irregular bill covered only when sufficient money is set aside", () => {
  const p = {
    ...pot,
    linkedCategoryId: "insurance",
    contributions: [{ month: "2026-10", amountMinor: 54000 }],
  };
  expect(
    potProgress(p, "2027-03-31", undefined, [
      transaction({
        categoryId: "insurance",
        date: "2027-03-15",
        amount: -54000,
      }),
    ]).covered,
  ).toBe(true);
  expect(
    potProgress({ ...p, contributions: [] }, "2027-03-31", undefined, [
      transaction({
        categoryId: "insurance",
        date: "2027-03-15",
        amount: -54000,
      }),
    ]).covered,
  ).toBe(false);
});
const budget: MonthlyBudget = {
  id: "aug",
  categoryId: "groceries",
  currency: "GBP",
  month: "2026-08",
  amountMinor: 30000,
  rollover: "surplus",
};
it("carries the £40 surplus into September and marks an unclosed carry provisional", () => {
  const rows = [
    transaction({
      date: "2026-08-05",
      categoryId: "groceries",
      amount: -26000,
    }),
  ];
  const result = rolloverBudget(
    { ...budget, id: "sept", month: "2026-09" },
    [budget],
    rows,
    [],
    "2026-09-10",
  );
  expect(result).toMatchObject({
    carryMinor: 4000,
    availableMinor: 34000,
    provisional: true,
    daysRemaining: 21,
  });
});
it("carries overspending only in both mode, never in surplus-only or none", () => {
  const rows = [
    transaction({
      date: "2026-08-05",
      categoryId: "groceries",
      amount: -35000,
    }),
  ];
  expect(
    rolloverBudget(
      { ...budget, month: "2026-09" },
      [budget],
      rows,
      [],
      "2026-09-10",
    ).carryMinor,
  ).toBe(0);
  expect(
    rolloverBudget(
      { ...budget, month: "2026-09", rollover: "both" },
      [{ ...budget, rollover: "both" }],
      rows,
      [],
      "2026-09-10",
    ).carryMinor,
  ).toBe(-5000);
  expect(
    rolloverBudget(
      { ...budget, month: "2026-09", rollover: "none" },
      [budget],
      rows,
      [],
      "2026-09-10",
    ).availableMinor,
  ).toBe(30000);
});
it("uses payday-aligned dates for monthly budget spending", () => {
  const result = rolloverBudget(
    { ...budget, month: "2026-10" },
    [],
    [
      transaction({
        date: "2026-09-26",
        categoryId: "groceries",
        amount: -5000,
      }),
    ],
    [],
    "2026-10-01",
    [
      {
        key: "period:start",
        value: JSON.stringify({ mode: "fixed", day: 25 }),
      },
    ],
  );
  expect(result.spentMinor).toBe(5000);
});
describe("monthly debt reference spreadsheet", () => {
  it("matches the independent Decimal spreadsheet within one penny for avalanche", () => {
    const plan = debtPayoff(
      [
        { id: "high", name: "High", balanceMinor: 200000, apr: 24 },
        { id: "low", name: "Low", balanceMinor: 50000, apr: 18 },
      ],
      30000,
      "avalanche",
      "2026-10",
    );
    expect(plan.reason).toBeUndefined();
    expect(plan.totalInterestMinor).toBe(24108);
    expect(plan.points).toHaveLength(10);
    expect(plan.payoff).toEqual({ high: "2027-05", low: "2027-07" });
    expect(plan.points[0]).toMatchObject({
      balanceMinor: 224750,
      interestMinor: 4750,
      paidMinor: 30000,
    });
  });
  it("preserves exact integer balances and does not pay more than the available monthly amount across generated loans", () => {
    for (let i = 1; i <= 40; i++) {
      const initial = i * 12345;
      const result = debtPayoff(
        [{ id: "a", name: "A", balanceMinor: initial, apr: (i % 8) * 3 }],
        Math.max(10000, Math.ceil(initial / 6)),
        "snowball",
        "2026-01",
      );
      expect(result.reason).toBeUndefined();
      expect(result.totalPaidMinor - result.totalInterestMinor).toBe(initial);
      expect(result.points.at(-1)?.balanceMinor).toBe(0);
      expect(
        result.points.every(
          (p) =>
            Number.isSafeInteger(p.balanceMinor) &&
            p.paidMinor <= Math.max(10000, Math.ceil(initial / 6)),
        ),
      ).toBe(true);
    }
  });
  it("warns when the monthly amount cannot cover minimum payments", () => {
    expect(
      debtPayoff(
        [{ id: "a", name: "A", balanceMinor: 100000, apr: 24 }],
        1000,
        "avalanche",
        "2026-10",
      ).reason,
    ).toContain("below the required minimum");
  });
  it("supports custom priority and compares snowball with avalanche", () => {
    const loans = [
      { id: "high", name: "High", balanceMinor: 200000, apr: 24 },
      { id: "low", name: "Low", balanceMinor: 50000, apr: 18 },
    ];
    const snow = debtPayoff(loans, 30000, "snowball", "2026-10");
    const custom = debtPayoff(loans, 30000, "custom", "2026-10", [
      "low",
      "high",
    ]);
    expect(custom.totalInterestMinor).toBe(snow.totalInterestMinor);
    expect(snow.payoff.low! < snow.payoff.high!).toBe(true);
  });
});
const monthly = ["2026-07-04", "2026-08-04", "2026-09-04"].map((date, i) =>
  transaction({
    id: `cloud${i}`,
    merchant: "NETFLIX",
    date,
    amount: -349,
    categoryId: "subscriptions",
  }),
);
it("detects the £3.49 October recurring payment and suppresses expected items when actual payment arrives", () => {
  const series = detectRecurringSeries(monthly, "GBP", "2026-10-01");
  expect(series[0]).toMatchObject({
    cadence: "monthly",
    nextDue: "2026-10-04",
    expectedAmountMinor: -349,
  });
  expect(recurringCalendar(series, monthly, "2026-10", "GBP")[0]).toMatchObject(
    { date: "2026-10-04", expected: true, amountMinor: -349 },
  );
  const actual = transaction({
    id: "oct",
    merchant: "NETFLIX",
    date: "2026-10-04",
    amount: -349,
  });
  const calendar = recurringCalendar(
    series,
    [...monthly, actual],
    "2026-10",
    "GBP",
  );
  expect(calendar).toHaveLength(1);
  expect(calendar[0].expected).toBe(false);
});
it("ignores ended and ignored recurring series", () => {
  const [series] = detectRecurringSeries(monthly, "GBP", "2026-10-01");
  expect(
    recurringCalendar(
      [{ ...series, status: "ignored" }],
      monthly,
      "2026-10",
      "GBP",
    ),
  ).toEqual([]);
  expect(
    recurringCalendar(
      [{ ...series, endDate: "2026-09-30" }],
      monthly,
      "2026-10",
      "GBP",
    ),
  ).toEqual([]);
});
it("compares a new price with the previous three-charge median and emits no second alert for the repeated new price", () => {
  const rows = [1099, 1099, 1099, 1249, 1249].map((amount, i) =>
    transaction({
      id: `n${i}`,
      date: `2026-${String(i + 5).padStart(2, "0")}-04`,
      amount: -amount,
      merchant: "NETFLIX",
    }),
  );
  expect(subscriptionPriceRise(rows.slice(0, 3), "GBP").increase).toBe(0);
  expect(subscriptionPriceRise(rows.slice(0, 4), "GBP")).toMatchObject({
    increase: 150,
    median: 1099,
  });
  expect(subscriptionPriceRise(rows, "GBP").increase).toBe(0);
});
it("a 5 percent rise under £1 and a £1 rise under 5 percent both qualify", () => {
  for (const [before, after] of [
    [349, 370],
    [5000, 5100],
  ]) {
    const rows = [before, before, before, after].map((amount, i) =>
      transaction({ id: `${i}`, date: `2026-0${i + 6}-04`, amount: -amount }),
    );
    expect(subscriptionPriceRise(rows, "GBP").increase).toBe(after - before);
  }
});
it("what-if expense changes only projected values from its date by exactly £1,200", () => {
  const points = ["2026-11-14", "2026-11-15", "2026-11-16"].map((date) => ({
    date,
    balance: 500000,
  }));
  const scenario: Scenario = {
    id: "s",
    name: "Holiday",
    createdAt: "2026-10-01",
    changes: [
      {
        id: "x",
        date: "2026-11-15",
        type: "one-off",
        description: "Holiday",
        amountMinor: -120000,
      },
    ],
  };
  expect(scenarioForecast(points, scenario).map((p) => p.scenario)).toEqual([
    500000, 380000, 380000,
  ]);
  expect(points.every((p) => p.balance === 500000)).toBe(true);
});
it("pausing a recurring outgoing payment increases only the scenario by that payment", () => {
  const series: RecurringSeries = {
    id: "netflix",
    matchKey: "netflix",
    accountId: "a1",
    name: "Netflix",
    currency: "GBP",
    cadence: "monthly",
    expectedAmountMinor: -1000,
    amountHistory: [],
    nextDue: "2026-11-04",
    status: "active",
  };
  const result = scenarioForecast(
    [
      { date: "2026-11-03", balance: 10000 },
      { date: "2026-11-04", balance: 9000 },
    ],
    {
      id: "s",
      name: "Pause",
      createdAt: "2026-10-01",
      changes: [
        {
          id: "p",
          type: "pause",
          date: "2026-11-04",
          amountMinor: 0,
          description: "Pause",
          recurringSeriesId: series.id,
        },
      ],
    },
    [series],
  );
  expect(result[1].scenario).toBe(10000);
});
it("manual house and mortgage contribute £170,000 to net worth as dated observations", () => {
  const manual: Account[] = [
    {
      ...accounts[0],
      id: "house",
      displayName: "House",
      accountType: "property",
      tracking: "manual",
    },
    {
      ...accounts[0],
      id: "mortgage",
      displayName: "Mortgage",
      accountType: "mortgage",
      tracking: "manual",
    },
  ];
  const values = [
    { id: "v1", accountId: "house", date: "2026-06-01", valueMinor: 45000000 },
    {
      id: "v2",
      accountId: "mortgage",
      date: "2026-06-01",
      valueMinor: 28000000,
    },
  ];
  expect(
    netWorthOverview(manual, [], values, "2026-06-01", "GBP"),
  ).toMatchObject({
    total: 17000000,
    complete: true,
    assets: 45000000,
    liabilities: 28000000,
  });
  expect(
    netWorthHistory(manual, [], values, "2026-06-01", "2026-06-15", "GBP").map(
      (p) => p.total,
    ),
  ).toEqual([17000000, 17000000]);
  expect(
    netWorthOverview([...manual, accounts[0]], [], values, "2026-06-01", "GBP")
      .partial,
  ).toBe(true);
});
it("does not use future manual valuations and warns on stale property values", () => {
  const account = {
    ...accounts[0],
    accountType: "property" as const,
    tracking: "manual" as const,
  };
  const values = [
    {
      id: "v",
      accountId: account.id,
      date: "2026-01-01",
      valueMinor: 45000000,
    },
  ];
  expect(
    netWorthOverview([account], [], values, "2025-12-31", "GBP").total,
  ).toBeUndefined();
  expect(
    netWorthOverview([account], [], values, "2026-10-01", "GBP").items[0].stale,
  ).toBe(true);
});
it("respects a configurable valuation reminder limit", () => {
  const account = {
    ...accounts[0],
    tracking: "manual" as const,
    accountType: "property" as const,
    valuationReminderDays: 30,
  };
  expect(
    netWorthOverview(
      [account],
      [],
      [
        {
          id: "v",
          accountId: account.id,
          date: "2026-09-01",
          valueMinor: 45000000,
        },
      ],
      "2026-10-08",
      "GBP",
    ).items[0].stale,
  ).toBe(true);
});
it("estimates zero-rate mortgages with integer monthly repayments and an explicit Estimated state", () => {
  expect(estimateMortgage(1200000, 0, 60, 6)).toEqual({
    paymentMinor: 20000,
    valueMinor: 1080000,
    estimated: true,
  });
  expect(estimateMortgage(1200000, 0, 60, 61).valueMinor).toBe(0);
});
