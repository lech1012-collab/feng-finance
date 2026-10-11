import { describe, expect, it } from "vitest";
import type { Rule } from "../domain/models";
import { transaction, accounts } from "../tests/helpers";
import { categorize, matches } from "./engine";
import { matchesConditions, safePattern } from "./conditions";
import { parseTransactionQuery, filterTransactions } from "../domain/query";

const rule = (patch: Partial<Rule> = {}): Rule => ({
  id: "r",
  name: "Prime Video",
  match: "contains",
  pattern: "",
  direction: "any",
  priority: 1000,
  builtIn: false,
  conditions: [
    { field: "description", operator: "contains", value: "AMZN" },
    { field: "amount", operator: "lt", value: 1000 },
  ],
  conditionMatch: "all",
  actions: [
    { type: "category", categoryId: "entertainment" },
    { type: "rename", merchant: "Prime Video" },
  ],
  stopProcessing: true,
  ...patch,
});

describe("explicit conditions and actions", () => {
  it("uses priority before an auto merchant rule and magnitude for an expense", () => {
    const auto = rule({
      id: "auto",
      match: "exact",
      pattern: "AMZN",
      conditions: undefined,
      actions: undefined,
      priority: 100,
      categoryId: "shopping",
    });
    const little = transaction({
      description: "AMZN DIGITAL",
      merchant: "AMZN",
      amount: -349,
      isReviewed: false,
    });
    expect(categorize(little, [auto, rule()])).toMatchObject({
      categoryId: "entertainment",
      merchant: "Prime Video",
      type: "expense",
      appliedRuleIds: ["r"],
    });
    expect(
      categorize({ ...little, amount: -2499 }, [auto, rule()]),
    ).toMatchObject({ categoryId: "shopping", type: "expense" });
  });
  it("supports all/any and never changes the amount sign", () => {
    const t = transaction({ description: "AMZN", amount: -2000 });
    expect(matches(rule(), t)).toBe(false);
    expect(matches(rule({ conditionMatch: "any" }), t)).toBe(true);
    expect(
      categorize(t, [
        rule({
          conditionMatch: "any",
          actions: [{ type: "category", categoryId: "salary" }],
        }),
      ]).type,
    ).toBe("expense");
    expect(
      categorize(transaction({ amount: 300000 }), [
        rule({
          conditions: [
            { field: "direction", operator: "equals", value: "positive" },
          ],
          actions: [{ type: "category", categoryId: "salary" }],
        }),
      ]).type,
    ).toBe("income");
  });
  it("composes actions until stop and keeps higher-priority category", () => {
    const t = transaction({
      description: "AMZN",
      amount: -349,
      isReviewed: false,
      tags: ["old"],
    });
    const first = rule({
      stopProcessing: false,
      actions: [
        { type: "category", categoryId: "entertainment" },
        { type: "tag", tagIds: ["trip"] },
      ],
    });
    const second = rule({
      id: "r2",
      priority: 10,
      actions: [
        { type: "category", categoryId: "shopping" },
        { type: "rename", merchant: "Prime" },
        { type: "reviewed", reviewed: true },
        { type: "tag", tagIds: ["trip", "work"] },
      ],
    });
    expect(categorize(t, [second, first])).toMatchObject({
      categoryId: "entertainment",
      categoryRuleId: "r",
      merchant: "Prime",
      isReviewed: true,
      tags: ["old", "trip", "work"],
      appliedRuleIds: ["r", "r2"],
    });
  });
  it("ignores paused rules and inactive categories", () => {
    expect(
      matches(rule({ enabled: false }), transaction({ description: "AMZN" })),
    ).toBe(false);
    const result = categorize(
      transaction({ description: "AMZN", amount: -349 }),
      [rule()],
      [],
      [
        {
          id: "entertainment",
          name: "Entertainment",
          kind: "expense",
          archived: true,
          color: "#000000",
        },
      ],
    );
    expect(result.categoryId).toBeUndefined();
  });
  it("allocates percentage splits exactly across every penny amount", () => {
    for (let amount = 2; amount < 5000; amount += 17) {
      const result = categorize(transaction({ amount: -amount }), [
        rule({
          conditions: [
            { field: "direction", operator: "equals", value: "negative" },
          ],
          actions: [
            {
              type: "split",
              splits: [
                { categoryId: "groceries", percentage: 75 },
                { categoryId: "household", percentage: 25 },
              ],
            },
          ],
        }),
      ]);
      expect(
        result.ruleSplit?.reduce((sum, line) => sum + line.amount, 0),
      ).toBe(-amount);
    }
  });
  it("does not produce split children for a transfer or refund across matching rules", () => {
    const split = rule({
      priority: 1000,
      stopProcessing: false,
      conditions: [
        { field: "description", operator: "contains", value: "AMZN" },
      ],
      actions: [
        {
          type: "split",
          splits: [
            { categoryId: "groceries", percentage: 75 },
            { categoryId: "household", percentage: 25 },
          ],
        },
      ],
    });
    const transfer = rule({
      id: "transfer",
      priority: 10,
      conditions: split.conditions,
      actions: [{ type: "kind", kind: "transfer" }],
    });
    expect(
      categorize(transaction({ description: "AMZN", amount: -6000 }), [
        split,
        transfer,
      ]),
    ).toMatchObject({
      type: "transfer",
      isTransfer: true,
      kind: "transfer",
      ruleSplit: undefined,
    });
    const refund = {
      ...transfer,
      actions: [{ type: "kind" as const, kind: "refund" as const }],
    };
    expect(
      categorize(transaction({ description: "AMZN", amount: 6000 }), [
        split,
        refund,
      ]),
    ).toMatchObject({ kind: "refund", ruleSplit: undefined });
    expect(
      categorize(transaction({ description: "AMZN", amount: -6000 }), [refund]),
    ).not.toMatchObject({ kind: "refund" });
  });
  it("supports day, currency, reviewed, source, kind, tags and note", () => {
    const t = transaction({
      date: "2026-09-25",
      currency: "EUR",
      source: "csv",
      kind: "refund",
      isReviewed: false,
      tags: ["trip"],
      note: "Lisbon hotel",
    });
    expect(
      matchesConditions(t, [
        { field: "day", operator: "between", value: 20, valueTo: 28 },
        { field: "currency", operator: "equals", value: "EUR" },
        { field: "reviewed", operator: "equals", value: false },
        { field: "source", operator: "equals", value: "csv" },
        { field: "kind", operator: "equals", value: "refund" },
        { field: "tag", operator: "in", value: ["trip"] },
        { field: "note", operator: "contains", value: "Lisbon" },
      ]),
    ).toBe(true);
  });
  it("accepts bounded regex and rejects unsafe or invalid patterns", () => {
    expect(safePattern("^AMZN.*").test("AMZN DIGITAL")).toBe(true);
    expect(() => safePattern("(a+)+$")).toThrow("short regular expression");
    expect(() => safePattern("[")).toThrow("not valid");
  });
});

describe("transaction queries", () => {
  it("amzn <10 2026 finds Amazon under ten only in 2026", () => {
    const rows = [
      transaction({ id: "a", description: "AMZN DIGITAL", amount: -349 }),
      transaction({ id: "b", description: "AMAZON MARKETPLACE", amount: -500 }),
      transaction({ id: "c", description: "AMZN", amount: -2499 }),
      transaction({
        id: "d",
        description: "AMZN",
        amount: -349,
        date: "2025-09-01",
      }),
    ];
    expect(
      filterTransactions(rows, parseTransactionQuery("amzn <10 2026")).map(
        (t) => t.id,
      ),
    ).toEqual(["a", "b"]);
  });
  it("resolves account, uncategorized, notes and named tags", () => {
    const t = transaction({
      accountId: "a3",
      note: "Lisbon trip",
      tags: ["lisbon"],
      categoryId: undefined,
    });
    const tags = [
      { id: "lisbon", name: "Lisbon trip", archived: false, colour: "#000000" },
    ];
    expect(
      filterTransactions(
        [t],
        parseTransactionQuery("amex uncategorised tag:lisbon", accounts, tags),
      ),
    ).toEqual([t]);
    expect(filterTransactions([t], parseTransactionQuery("lisbon"))).toEqual([
      t,
    ]);
    expect(
      filterTransactions(
        [t],
        parseTransactionQuery("tag:missing", accounts, tags),
      ),
    ).toEqual([]);
    expect(
      filterTransactions(
        [t],
        parseTransactionQuery('tag:"Lisbon trip"', accounts, tags),
      ),
    ).toEqual([t]);
  });
  it("resolves September and currency precision without floating point", () => {
    const c = parseTransactionQuery("tesco >20 sep", [], [], 2026);
    expect(c).toContainEqual({ field: "amount", operator: "gt", value: 2000 });
    expect(c).toContainEqual({
      field: "date",
      operator: "between",
      value: "2026-09-01",
      valueTo: "2026-09-30",
    });
    expect(parseTransactionQuery("<10", [], [], 2026, "JPY")[0].value).toBe(10);
    expect(parseTransactionQuery("<10.125", [], [], 2026, "KWD")[0].value).toBe(
      10125,
    );
  });
});
