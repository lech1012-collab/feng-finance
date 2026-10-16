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
