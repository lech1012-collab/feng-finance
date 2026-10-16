import { expect, it } from "vitest";
import { displayRuleMatch } from "./rule-presentation";
import type { Rule } from "./models";
import { accounts } from "../tests/helpers";
const rule: Rule = {
  id: "example",
  name: "Example",
  match: "contains",
  pattern: "GROCER",
  direction: "any",
  priority: 1,
  builtIn: false,
};
it("shows the stored match without changing its pattern or conditions", () => {
  const original = structuredClone(rule);
  expect(displayRuleMatch(rule, accounts, [])).toBe(
    "Description contains GROCER",
  );
  expect(rule).toEqual(original);
});
it("does not invent a currency for an unscoped amount condition", () => {
  const input = {
    ...rule,
    conditions: [{ field: "amount", operator: "lt", value: 1000 }],
  } satisfies Rule;
  expect(displayRuleMatch(input, accounts, [])).toBe(
    "Amount below the saved amount",
  );
  expect(
    displayRuleMatch({ ...input, accountId: accounts[0].id }, accounts, []),
  ).toBe("Amount below £10.00");
});
it("retains any/all meaning and formats dates and category parents", () => {
  const categories = [
    {
      id: "property",
      name: "Property",
      kind: "expense",
      archived: false,
      color: "#6ea8ff",
    },
    {
      id: "insurance",
      name: "Insurance",
      kind: "expense",
      archived: false,
      color: "#6ea8ff",
      parentId: "property",
    },
  ] as const;
  const input = {
    ...rule,
    conditionMatch: "any",
    conditions: [
      { field: "date", operator: "equals", value: "2026-09-05" },
      { field: "categoryId", operator: "equals", value: "insurance" },
    ],
  } satisfies Rule;
  expect(displayRuleMatch(input, [], [...categories])).toBe(
    "Date is 5 Sep or Category is Property · Insurance",
  );
});
