import { describe, expect, it } from "vitest";
import { categorySuggestions } from "./suggestions";
import { defaultCategories, defaultRules } from "../storage/database";
import { transaction } from "../tests/helpers";

describe("local category suggestions", () => {
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
