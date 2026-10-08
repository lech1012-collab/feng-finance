import { describe, expect, it } from "vitest";
import { categorySuggestions, categorySuggestionReason } from "./suggestions";
import { defaultCategories, defaultRules } from "../storage/database";
import { transaction } from "../tests/helpers";

describe("local category suggestions", () => {
  it("keeps the latest exact choice first at high priority and explains its account scope", () => {
    const t = transaction({
      merchant: "RENAMED CLUB",
      sourceMerchant: "CITY CLUB",
      description: "CITY CLUB",
    });
    const rules = [
      {
        ...defaultRules[0],
        id: "old",
        builtIn: false,
        match: "exact" as const,
        pattern: "CITY CLUB",
        accountId: t.accountId,
        categoryId: "childcare",
        priority: 999,
      },
      {
        ...defaultRules[0],
        id: "new",
        builtIn: false,
        match: "exact" as const,
        pattern: "CITY CLUB",
        accountId: t.accountId,
        categoryId: "utilities",
        priority: 1000,
      },
    ];
    const suggestions = categorySuggestions(t, defaultCategories, rules, []);
    expect(suggestions[0].id).toBe("utilities");
    expect(categorySuggestionReason(t, suggestions[0], rules, [])).toBe(
      "Your saved rule for this merchant and account",
    );
    expect(
      categorySuggestions(
        { ...t, accountId: "different" },
        defaultCategories,
        rules,
        [],
      ),
    ).toEqual([]);
  });
  it("explains only reviewed history from the same original merchant, account and currency", () => {
    const t = transaction({
      merchant: "MY SHOP",
      sourceMerchant: "CORNER SHOP",
      description: "CORNER SHOP",
    });
    const history = [
      transaction({
        id: "old",
        merchant: "RENAMED SHOP",
        sourceMerchant: "CORNER SHOP",
        categoryId: "groceries",
      }),
      transaction({
        id: "other",
        merchant: "CORNER SHOP",
        accountId: "a2",
        categoryId: "groceries",
      }),
    ];
    const suggestions = categorySuggestions(t, defaultCategories, [], history);
    expect(suggestions.map((c) => c.id)).toEqual(["groceries"]);
    expect(categorySuggestionReason(t, suggestions[0], [], history)).toBe(
      "You chose this for 1 matching payment",
    );
  });
  const suggest = (description: string) =>
    categorySuggestions(
      transaction({ description, merchant: description }),
      defaultCategories,
      defaultRules,
      [],
    ).map((c) => c.id);
  it("suggests utilities for bill descriptions and alternatives for leisure", () => {
    expect(suggest("TO FICTIONAL WATER REF 123")).toEqual(["utilities"]);
    expect(suggest("DIRECT DEBIT COUNCIL TAX")).toEqual(["utilities"]);
    expect(suggest("CITY LEISURE MEMBERSHIP")).toEqual([
      "healthcare",
      "subscriptions",
      "entertainment",
    ]);
  });
  it("prioritizes remembered rules and reviewed same-account history", () => {
    const t = transaction({
      description: "WATER MEMBERSHIP",
      merchant: "WATER MEMBERSHIP",
    });
    const rule = {
      ...defaultRules[0],
      builtIn: false,
      match: "exact" as const,
      pattern: t.merchant,
      categoryId: "household",
      priority: 100,
    };
    const history = [
      transaction({ id: "old", merchant: t.merchant, categoryId: "shopping" }),
    ];
    expect(
      categorySuggestions(t, defaultCategories, [rule], history).map(
        (c) => c.id,
      ),
    ).toEqual(["household", "shopping", "subscriptions"]);
    expect(
      categorySuggestions(
        t,
        defaultCategories,
        [],
        [{ ...history[0], accountId: "another" }],
      ).some((c) => c.id === "shopping"),
    ).toBe(false);
  });
  it("excludes archived and wrong-direction categories and does not guess unknown merchants", () => {
    expect(suggest("ANOTHER UNKNOWN MERCHANT")).toEqual([]);
    expect(
      categorySuggestions(
        transaction({ description: "SALARY", amount: -100 }),
        defaultCategories,
        defaultRules,
        [],
      ),
    ).toEqual([]);
    expect(
      categorySuggestions(
        transaction({ description: "WAITROSE" }),
        defaultCategories.map((c) =>
          c.id === "groceries" ? { ...c, archived: true } : c,
        ),
        defaultRules,
        [],
      ),
    ).toEqual([]);
  });
  it("rolls property subcategory rules up to the main category and leaves transfers alone", () => {
    expect(suggest("MORTGAGE")).toEqual(["property"]);
    expect(
      categorySuggestions(
        transaction({ description: "WATER", isTransfer: true }),
        defaultCategories,
        defaultRules,
        [],
      ),
    ).toEqual([]);
  });
});
