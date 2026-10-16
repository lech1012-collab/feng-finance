import type { Account, Category, Rule, RuleCondition } from "./models";
import { formatUkDate } from "./dates";
import { money, currencyPrecision } from "./money";
import { displayCategory } from "./presentation";

/** A read-only explanation of saved conditions. It never evaluates or modifies a rule. */
export function displayRuleMatch(
  rule: Rule,
  accounts: Account[],
  categories: Category[],
) {
  const conditions: RuleCondition[] = rule.conditions ?? [
    {
      field: rule.match === "exact" ? "merchant" : "description",
      operator: rule.match === "exact" ? "equals" : rule.match,
      value: rule.pattern,
    },
  ];
  const accountId =
    rule.accountId ??
    conditions.find((c) => c.field === "accountId" && c.operator === "equals")
      ?.value;
  const explicitCurrency = conditions.find(
    (c) => c.field === "currency" && c.operator === "equals",
  )?.value;
  let currency =
    accounts.find((a) => a.id === accountId)?.currency ??
    (typeof explicitCurrency === "string" ? explicitCurrency : undefined);
  if (currency) {
    try {
      currencyPrecision(currency);
    } catch {
      currency = undefined;
    }
  }
  const names: Partial<Record<RuleCondition["field"], string>> = {
    accountId: "Account",
    categoryId: "Category",
    displayMerchant: "Display name",
    direction: "Money direction",
    day: "Day of month",
  };
  const operators: Record<RuleCondition["operator"], string> = {
    contains: "contains",
    "starts-with": "starts with",
    equals: "is",
    regex: "matches pattern",
    gt: "above",
    gte: "at least",
    lt: "below",
    lte: "at most",
    between: "between",
    in: "is one of",
  };
  return conditions
    .map((c) => {
      const field =
        names[c.field] ?? c.field[0].toUpperCase() + c.field.slice(1);
      if (c.field === "amount" && !currency)
        return `${field} ${c.operator === "between" ? "within the saved bounds" : `${operators[c.operator]} the saved amount`}`;
      const format = (v: RuleCondition["value"]) => {
        if (c.field === "amount") return money(Number(v), currency!);
        if (c.field === "accountId")
          return (
            accounts.find((a) => a.id === v)?.displayName ?? "Selected account"
          );
        if (c.field === "categoryId") {
          const category = categories.find((x) => x.id === v);
          return category
            ? displayCategory(category, categories)
            : "Selected category";
        }
        if (c.field === "date" && typeof v === "string") return formatUkDate(v);
        if (c.field === "direction")
          return v === "positive" ? "Money in" : "Money out";
        if (c.field === "tag") return "a selected tag";
        if (typeof v === "boolean") return v ? "Yes" : "No";
        return Array.isArray(v) ? v.join(", ") : String(v);
      };
      return `${field} ${operators[c.operator]} ${format(c.value)}${c.valueTo === undefined ? "" : ` and ${format(c.valueTo)}`}`;
    })
    .join(rule.conditionMatch === "any" ? " or " : " and ");
}
