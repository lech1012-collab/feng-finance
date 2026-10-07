import { expect, it } from "vitest";
import {
  financeReminders,
  readReminderConfig,
  reminderCalendar,
} from "./reminders";
import { accounts, transaction } from "../tests/helpers";
import type { Statement } from "../domain/models";
const config = { enabled: true, day: 5 };
const bills = ["2026-07-10", "2026-08-10", "2026-09-10"].map((date, i) =>
  transaction({
    id: `b${i}`,
    date,
    merchant: "PRIVATE WATER COMPANY",
    categoryId: "utilities",
    amount: -4000,
  }),
);
it("uses safe settings defaults and accepts only valid monthly review days", () => {
  expect(readReminderConfig("bad")).toEqual(config);
  expect(readReminderConfig('{"enabled":true,"day":31}')).toEqual(config);
  expect(readReminderConfig('{"enabled":false,"day":28}')).toEqual({
    enabled: false,
    day: 28,
  });
});
it("reminds about missing statements only on or after the chosen day", () => {
  expect(
    financeReminders([accounts[0]], [], [], "GBP", "2026-10-04", config),
  ).toEqual([]);
  expect(
    financeReminders([accounts[0]], [], [], "GBP", "2026-10-05", config)[0]
      .kind,
  ).toBe("statement");
  const doc = {
    accountId: "a1",
    currency: "GBP",
    statementPeriodEnd: "2026-09-28",
  } as Statement;
  expect(
    financeReminders([accounts[0]], [doc], [], "GBP", "2026-10-05", config),
  ).toEqual([]);
  expect(
    financeReminders([accounts[0]], [], [], "GBP", "2026-10-05", {
      enabled: false,
      day: 5,
    }),
  ).toEqual([]);
});
it("predicts recurring bills conservatively and never implies that they are unpaid", () => {
  const reminders = financeReminders(
    [],
    [],
    bills,
    "GBP",
    "2026-10-07",
    config,
  );
  expect(reminders).toHaveLength(1);
  expect(reminders[0].date).toBe("2026-10-10");
  expect(reminders[0].detail).toContain("cannot confirm a current payment");
  expect(
    financeReminders([], [], bills.slice(1), "GBP", "2026-10-07", config),
  ).toEqual([]);
  expect(financeReminders([], [], bills, "GBP", "2027-01-07", config)).toEqual(
    [],
  );
});
it("excludes transfers, demo data, everyday purchases, future dates and other currencies", () => {
  for (const patch of [
    { type: "transfer" as const },
    { transferPairId: "pair" },
    { isTransfer: true },
    { isDemo: true },
    { categoryId: "groceries" },
    { currency: "EUR" },
    { date: "2027-01-01" },
  ])
    expect(
      financeReminders(
        [],
        [],
        bills.map((t) => ({ ...t, ...patch })),
        "GBP",
        "2026-10-07",
        config,
      ),
    ).toEqual([]);
});
it("clamps month-end predictions and exports generic calendar events without financial identifiers", () => {
  const rows = ["2026-10-31", "2026-11-30", "2026-12-31"].map((date, i) => ({
    ...bills[i],
    date,
  }));
  const reminders = financeReminders([], [], rows, "GBP", "2027-01-25", config);
  expect(reminders[0].date).toBe("2027-01-31");
  const calendar = reminderCalendar(config, "2027-01-25", reminders);
  expect(calendar).toContain("RRULE:FREQ=MONTHLY");
  expect(calendar).toContain("20270205");
  expect(calendar).toContain("BEGIN:VALARM");
  expect(calendar).not.toContain("PRIVATE WATER COMPANY");
  expect(calendar).not.toContain("4000");
  expect(calendar).not.toContain("a1");
});
