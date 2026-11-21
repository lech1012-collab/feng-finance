import { expect, it } from "vitest";
import type { Setting } from "../domain/models";
import {
  resolveRecurringSeries,
  recurringDecisionKey,
} from "./recurring-identity";
import { recurringCalendar } from "./planning-v2";
import { confirmedPaymentEvents, recurringMatches } from "./recurring-events";
import { transaction } from "../tests/helpers";

import { savedBill, detectedBill } from "../tests/recurring-fixtures";
const decisionKey = await recurringDecisionKey(
  savedBill.id,
  detectedBill.matchKey,
);
const decision = (choice: "same" | "separate"): Setting => ({
  key: decisionKey,
  value: JSON.stringify({
    seriesId: savedBill.id,
    matchKey: detectedBill.matchKey,
    accountId: "a1",
    currency: "GBP",
    cadence: "monthly",
    direction: -1,
    choice,
  }),
});

it("keeps similar bills visible and asks for confirmation without changing either amount", () => {
  const result = resolveRecurringSeries([savedBill], [detectedBill], []);
  expect(result.series).toEqual([savedBill, detectedBill]);
  expect(result.proposals).toEqual([
    { confirmed: savedBill, detected: detectedBill },
  ]);
});
it("combines only an explicitly confirmed identity and keeps the saved amount and due date", () => {
  const result = resolveRecurringSeries(
    [savedBill],
    [detectedBill],
    [decision("same")],
  );
  expect(result.series).toEqual([savedBill]);
  expect(result.proposals).toEqual([]);
  expect(
    recurringCalendar(result.series, [], "2026-10", "GBP", [
      decision("same"),
    ])[0].amountMinor,
  ).toBe(-1099);
});
it("remembers separate bills without asking again or dropping an expected payment", () => {
  const result = resolveRecurringSeries(
    [savedBill],
    [detectedBill],
    [decision("separate")],
  );
  expect(result.series).toHaveLength(2);
  expect(result.proposals).toHaveLength(0);
});
it("does not offer unrelated accounts, currencies, directions or cadences as the same bill", () => {
  for (const patch of [
    { accountId: "a2" },
    { currency: "EUR" },
    { expectedAmountMinor: 1249 },
    { cadence: "annual" as const },
  ])
    expect(
      resolveRecurringSeries([savedBill], [{ ...detectedBill, ...patch }], [])
        .proposals,
    ).toHaveLength(0);
});
it("does not ask again for an already identical key and ignores malformed or stale decisions", () => {
  expect(
    resolveRecurringSeries(
      [savedBill],
      [{ ...detectedBill, matchKey: savedBill.matchKey }],
      [],
    ).series,
  ).toHaveLength(1);
  expect(
    resolveRecurringSeries(
      [savedBill],
      [detectedBill],
      [{ ...decision("same"), value: "{}" }],
    ).series,
  ).toHaveLength(2);
  expect(
    resolveRecurringSeries(
      [{ ...savedBill, accountId: "a2" }],
      [detectedBill],
      [decision("same")],
    ).series,
  ).toHaveLength(2);
});
it("uses the confirmed alias consistently in calendar and forecast while preserving every imported row", () => {
  const row = transaction({
    date: "2026-10-04",
    merchant: "NETFLIX.COM",
    amount: -1249,
  });
  const before = structuredClone(row);
  expect(recurringMatches(savedBill, row)).toBe(false);
  expect(recurringMatches(savedBill, row, [decision("same")])).toBe(true);
  expect(
    confirmedPaymentEvents(
      [savedBill],
      "2026-10-01",
      "2026-10-31",
      [row],
      [decision("same")],
    ),
  ).toEqual([]);
  const result = recurringCalendar([savedBill], [row], "2026-10", "GBP", [
    decision("same"),
  ]);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ expected: false, amountMinor: -1249 });
  expect(row).toEqual(before);
  expect(
    recurringMatches(savedBill, { ...row, accountId: "a2" }, [
      decision("same"),
    ]),
  ).toBe(false);
});

it("keeps an explicit identity when its saved due date, price or frequency changes", () => {
  const revised = {
    ...savedBill,
    cadence: "annual" as const,
    nextDue: "2027-01-04",
    expectedAmountMinor: -1299,
  };
  expect(
    resolveRecurringSeries([revised], [detectedBill], [decision("same")])
      .series,
  ).toEqual([revised]);
});
it("one imported payment fulfils only one explicitly separate bill, preferring its exact amount", async () => {
  const other = {
    ...detectedBill,
    id: "confirmed-second",
    matchKey: JSON.stringify(["a1", "GBP", "NETFLIX", false]),
  };
  const separation = {
    ...decision("separate"),
    key: await recurringDecisionKey(savedBill.id, other.matchKey),
    value: JSON.stringify({
      ...JSON.parse(decision("separate").value),
      matchKey: other.matchKey,
    }),
  };
  const row = transaction({
    id: "one-paid",
    date: "2026-10-04",
    merchant: "NETFLIX",
    amount: -1249,
  });
  const before = structuredClone(row);
  const events = confirmedPaymentEvents(
    [savedBill, other],
    "2026-10-01",
    "2026-10-31",
    [row],
    [separation],
  );
  expect(events).toHaveLength(1);
  expect(events[0].amount).toBe(-1099);
  expect(
    recurringCalendar([savedBill, other], [row], "2026-10", "GBP", [
      separation,
    ]).filter((e) => e.expected),
  ).toHaveLength(1);
  expect(
    confirmedPaymentEvents(
      [savedBill, other],
      "2026-10-01",
      "2026-10-31",
      [row, { ...row, id: "second-paid", amount: -1099 }],
      [separation],
    ),
  ).toEqual([]);
  expect(row).toEqual(before);
});

it("ends expected payments at the effective date for an approved alias and keeps actual later payments visible", () => {
  const review: Setting = {
    key: "subscription:hash",
    value: JSON.stringify({
      status: "cancelled",
      date: "2026-12-01",
      effectiveDate: "2026-10-04",
      groupKey: detectedBill.matchKey,
      amount: 1249,
    }),
  };
  const settings = [review, decision("same")];
  const dates = (s: typeof savedBill, settings: Setting[]) =>
    confirmedPaymentEvents([s], "2026-09-30", "2026-11-30", [], settings).map(
      (p) => p.date,
    );
  expect(dates(savedBill, settings)).toEqual(["2026-10-04"]);
  expect(dates({ ...savedBill, endDate: "2026-09-20" }, settings)).toEqual([]);
  expect(dates(savedBill, [review, decision("separate")])).toEqual([
    "2026-10-04",
    "2026-11-04",
  ]);
  const posted = transaction({
    id: "posted",
    merchant: "NETFLIX.COM",
    date: "2026-11-10",
    amount: -1249,
  });
  expect(
    recurringCalendar([savedBill], [posted], "2026-11", "GBP", settings),
  ).toMatchObject([
    { expected: false, transactionId: "posted", amountMinor: -1249 },
  ]);
  expect(savedBill.endDate).toBeUndefined();
});

it("limits manual calendar entries by explicit charge links within the same account and currency", () => {
  const groupKey = detectedBill.matchKey;
  const payload = {
    status: "cancelled",
    date: "2026-10-01",
    groupKey,
    amount: 1249,
  };
  const settings = [
    {
      key: "subscription:hash",
      value: JSON.stringify({ ...payload, linkedSeriesIds: [savedBill.id] }),
    },
  ];
  const due = (s: typeof savedBill) =>
    confirmedPaymentEvents([s], "2026-10-01", "2026-10-31", [], settings);
  expect(due(savedBill)).toEqual([]);
  expect(due({ ...savedBill, expectedAmountMinor: 1099 })).toHaveLength(1);
  expect(due({ ...savedBill, accountId: "a2" })).toHaveLength(1);
  expect(due({ ...savedBill, currency: "EUR" })).toHaveLength(1);
  expect(due({ ...savedBill, isDemo: true })).toHaveLength(1);
  expect(due({ ...savedBill, id: "separate" })).toHaveLength(1);
  const olderRow = transaction({
    merchant: "NETFLIX.COM",
    date: "2026-09-04",
    recurringSeriesId: savedBill.id,
  });
  expect(
    recurringCalendar([savedBill], [olderRow], "2026-10", "GBP", [
      { key: "subscription:hash", value: JSON.stringify(payload) },
    ]),
  ).toEqual([]);
});
