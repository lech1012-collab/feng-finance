import { expect, it } from "vitest";
import { suggestedRules } from "./rule-suggestions";
import { transaction } from "../tests/helpers";
it("suggests a repeated manual display name after three choices and does not repeat an existing rule", () => {
  const rows = Array.from({ length: 3 }, (_, i) =>
    transaction({
      id: String(i),
      sourceMerchant: "AMZN DIGITAL",
      merchant: "Prime Video",
      categoryId: "entertainment",
      categorySource: "manual",
    }),
  );
  expect(suggestedRules(rows.slice(0, 2), [])).toEqual([]);
  const suggestions = suggestedRules(rows, []);
  expect(suggestions).toHaveLength(1);
  expect(suggestions[0]).toMatchObject({
    count: 3,
    rule: {
      accountId: "a1",
      direction: "negative",
      actions: [
        {
          type: "category",
          categoryId: "entertainment",
          subcategoryId: undefined,
        },
        { type: "rename", merchant: "Prime Video" },
      ],
    },
  });
  expect(suggestedRules(rows, [suggestions[0].rule])).toEqual([]);
});
