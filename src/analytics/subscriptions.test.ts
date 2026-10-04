import { describe, it, expect } from "vitest";
import { detectSubscriptions, readReview, reviewPrefix } from "./subscriptions";
import { transaction } from "../tests/helpers";
const monthly = (merchant = "CLOUD SERVICE", amounts = [1000, 1000, 1500]) =>
  amounts.map((a, i) =>
    transaction({
      id: `t${i}`,
      merchant,
      date: `2026-0${i + 7}-05`,
      amount: -a,
    }),
  );
const detect = (items = monthly()) =>
  detectSubscriptions(items, [], "GBP", "2026-10-04");
describe("subscription evidence", () => {
  it("detects monthly cadence and substantial price rises in minor units", () => {
    const [s] = detect();
    expect(s.cadence).toBe("monthly");
    expect(s.annual).toBe(18000);
    expect(s.increase).toBe(500);
    expect(s.needsReview).toBe(true);
  });
  it("does not call a known provider a confirmed monthly plan after one charge", () => {
    const [s] = detect(monthly("NETFLIX").slice(0, 1));
    expect(s.cadence).toBeUndefined();
    expect(s.annual).toBeUndefined();
    expect(s.known).toBe(true);
  });
  it("rejects irregular purchases, repeated same-day spending and erratic baseline amounts", () => {
    expect(
      detect(monthly().map((t) => ({ ...t, date: "2026-09-05" }))),
    ).toEqual([]);
    expect(detect(monthly("SHOP", [1000, 9000, 500]))).toEqual([]);
  });
  it("isolates accounts and currencies; excludes refunds, transfers and future transactions", () => {
    expect(
      detect(monthly().map((t, i) => ({ ...t, accountId: `a${i}` }))),
    ).toEqual([]);
    expect(detect(monthly().map((t) => ({ ...t, currency: "USD" })))).toEqual(
      [],
    );
    for (const patch of [
      { amount: 1000 },
      { isTransfer: true },
      { type: "transfer" as const },
      { transferPairId: "pair" },
      { date: "2027-01-01" },
    ])
      expect(detect(monthly().map((t) => ({ ...t, ...patch })))).toEqual([]);
  });
  it("finds yearly, quarterly and weekly renewals from evidence", () => {
    for (const [dates, cadence, multiplier] of [
      [["2025-09-01", "2026-09-01"], "yearly", 1],
      [["2026-03-01", "2026-06-01", "2026-09-01"], "quarterly", 4],
      [["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22"], "weekly", 52],
    ] as const) {
      const [s] = detect(
        dates.map((date, i) =>
          transaction({ id: `t${i}`, merchant: "SERVICE", date }),
        ),
      );
      expect(s.cadence).toBe(cadence);
      expect(s.annual).toBe(1000 * multiplier);
    }
  });
  it("marks old observations stale without inferring cancellation", () => {
    const [s] = detectSubscriptions(monthly(), [], "GBP", "2027-09-01");
    expect(s.stale).toBe(true);
    expect(s.status).toBe("review");
  });
  it("flags same-merchant charges on other accounts without merging amounts", () => {
    const items = detect([
      ...monthly("NETFLIX"),
      ...monthly("NETFLIX").map((t) => ({
        ...t,
        id: `b${t.id}`,
        accountId: "a2",
      })),
    ]);
    expect(items).toHaveLength(2);
    expect(items.every((s) => s.overlap)).toBe(true);
  });
  it("reopens kept plans after a price increase and cancelled plans after a later charge", () => {
    const [base] = detect();
    const setting = (status: string, date: string, amount: number) => [
      {
        key: reviewPrefix + "hash",
        value: JSON.stringify({ groupKey: base.key, status, date, amount }),
      },
    ];
    expect(
      detectSubscriptions(
        monthly(),
        setting("keep", "2026-08-06", 1000),
        "GBP",
        "2026-10-04",
      )[0].needsReview,
    ).toBe(true);
    const [s] = detectSubscriptions(
      monthly(),
      setting("cancelled", "2026-08-06", 1000),
      "GBP",
      "2026-10-04",
    );
    expect(s.afterCancellation).toBe(true);
    expect(
      detectSubscriptions(
        monthly(),
        setting("cancelled", "2026-10-01", 1500),
        "GBP",
        "2026-10-04",
      )[0].afterCancellation,
    ).toBe(false);
    expect(
      detectSubscriptions(
        monthly(),
        setting("ignore", "2026-10-01", 1500),
        "GBP",
        "2026-10-04",
      )[0].needsReview,
    ).toBe(false);
  });
  it("keeps ordinary shopping and property costs out of subscription alerts", () => {
    expect(
      detect(monthly().map((t) => ({ ...t, categoryId: "groceries" }))),
    ).toEqual([]);
    expect(
      detect(monthly().map((t) => ({ ...t, categoryId: "property-mortgage" }))),
    ).toEqual([]);
    expect(
      detect(
        monthly("NETFLIX").map((t) => ({ ...t, categoryId: "entertainment" })),
      ),
    ).toHaveLength(1);
  });
  it("does not produce unsafe annual projections", () => {
    expect(
      detect(
        monthly("NETFLIX", [
          Number.MAX_SAFE_INTEGER,
          Number.MAX_SAFE_INTEGER,
          Number.MAX_SAFE_INTEGER,
        ]),
      )[0].annual,
    ).toBeUndefined();
  });
  it("ignores malformed review metadata", () => {
    expect(readReview("{")).toBeUndefined();
    expect(readReview(JSON.stringify({ status: "keep" }))).toBeUndefined();
  });
});
