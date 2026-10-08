import { describe, expect, it } from "vitest";
import { accounts, transaction } from "../tests/helpers";
import { excludedFlows, homeDataHealth, transferKind } from "./home-summary";

const moved = (id: string, accountId: string, amount: number, pair?: string) =>
  transaction({
    id,
    accountId,
    amount,
    type: "transfer",
    isTransfer: true,
    transferPairId: pair,
  });

describe("Home excluded movements", () => {
  it("counts both imported sides of a linked internal transfer once", () => {
    expect(
      excludedFlows(
        [moved("out", "a1", -50000, "p1"), moved("in", "a2", 50000, "p1")],
        accounts,
        "2026-09",
        "GBP",
      ),
    ).toEqual({ internal: 50000, card: 0 });
  });

  it("recognizes card repayment from either side of the linked payment", () => {
    const rows = [
      moved("out", "a1", -123590, "p1"),
      moved("in", "a3", 123590, "p1"),
    ];
    expect(transferKind(rows[0], accounts, rows)).toBe("card");
    expect(excludedFlows(rows, accounts, "2026-09", "GBP")).toEqual({
      internal: 0,
      card: 123590,
    });
  });

  it("identifies an unpaired payment to a credit card using its description", () => {
    const row = moved("out", "a1", -95000);
    row.description = "TO AMERICAN EXP 1234";
    expect(excludedFlows([row], accounts, "2026-09", "GBP")).toEqual({
      internal: 0,
      card: 95000,
    });
  });

  it("never merges unlinked same-value transfers or unrelated expenses", () => {
    const rows = [
      moved("one", "a1", -10000),
      moved("two", "a1", -10000),
      transaction({ id: "purchase", amount: -10000 }),
    ];
    expect(excludedFlows(rows, accounts, "2026-09", "GBP")).toEqual({
      internal: 20000,
      card: 0,
    });
  });

  it("limits totals to the selected month and currency while using the pair identity", () => {
    const rows = [
      moved("out", "a1", -20000, "p1"),
      { ...moved("in", "a3", 20000, "p1"), date: "2026-10-01" },
      { ...moved("eur", "a1", -30000), currency: "EUR" },
    ];
    expect(excludedFlows(rows, accounts, "2026-09", "GBP")).toEqual({
      internal: 0,
      card: 20000,
    });
  });
});

describe("Home backup and statement review health", () => {
  it("shows a missing backup and computes the next monthly review", () => {
    expect(homeDataHealth([], "2026-10-07")).toMatchObject({
      warning: true,
      lastExportAt: undefined,
      exportedCount: undefined,
      reviewDate: "2026-11-05",
    });
  });

  it("uses saved backup metadata and warns after 30 calendar days", () => {
    const settings = [
      { key: "backup:lastExportAt", value: "2026-09-07T10:00:00.000Z" },
      { key: "backup:lastExportCount", value: "46" },
    ];
    expect(homeDataHealth(settings, "2026-10-07")).toMatchObject({
      warning: false,
      exportedCount: 46,
    });
    expect(homeDataHealth(settings, "2026-10-08").warning).toBe(true);
  });

  it("ignores invalid metadata and disabled statement reviews", () => {
    expect(
      homeDataHealth(
        [
          { key: "backup:lastExportAt", value: "not a date" },
          { key: "backup:lastExportCount", value: "forty six" },
          {
            key: "reminders",
            value: JSON.stringify({ enabled: false, day: 28 }),
          },
        ],
        "2026-10-07",
      ),
    ).toEqual({
      lastExportAt: undefined,
      exportedCount: undefined,
      warning: true,
      reviewDate: undefined,
    });
  });
});
