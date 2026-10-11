import type {
  Account,
  RuleCondition,
  SavedView,
  Tag,
  Transaction,
} from "./models";
import { matchesConditions } from "../categorization/conditions";
import { parseMoney } from "./money";

const monthNames = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const fullMonths = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
/** Text parsing is deterministic and never changes records. Monetary searches use magnitude. */
export function parseTransactionQuery(
  query: string,
  accounts: Account[] = [],
  tags: Tag[] = [],
  defaultYear = new Date().getFullYear(),
  currency = "GBP",
): RuleCondition[] {
  const tokens =
    query.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((t) => t.replaceAll('"', "")) ??
    [];
  const conditions: RuleCondition[] = [];
  let year = defaultYear;
  let month: number | undefined;
  const yearToken = tokens.find((t) => /^20\d{2}$/.test(t));
  if (yearToken) year = Number(yearToken);
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const amount = lower.match(/^(<=|>=|<|>|=)(\d+(?:\.\d{1,3})?)$/);
    if (amount) {
      const value = parseMoney(amount[2], currency);
      conditions.push({
        field: "amount",
        operator: (
          {
            "<": "lt",
            ">": "gt",
            "<=": "lte",
            ">=": "gte",
            "=": "equals",
          } as const
        )[amount[1] as "<"],
        value,
      });
    } else if (/^20\d{2}$/.test(token)) continue;
    else if (
      monthNames.includes(lower) ||
      fullMonths.includes(lower) ||
      lower === "sept"
    )
      month = monthNames.indexOf(lower.slice(0, 3));
    else if (lower.startsWith("tag:")) {
      const name = lower.slice(4);
      conditions.push({
        field: "tag",
        operator: "in",
        value: tags
          .filter((t) => t.name.toLowerCase().includes(name) || t.id === name)
          .map((t) => t.id),
      });
    } else if (["uncategorised", "uncategorized"].includes(lower))
      conditions.push({ field: "categoryId", operator: "equals", value: "" });
    else if (["unreviewed", "reviewed"].includes(lower))
      conditions.push({
        field: "reviewed",
        operator: "equals",
        value: lower === "reviewed",
      });
    else if (["income", "in", "expense", "out"].includes(lower))
      conditions.push({
        field: "direction",
        operator: "equals",
        value: ["income", "in"].includes(lower) ? "positive" : "negative",
      });
    else if (lower.startsWith("source:"))
      conditions.push({
        field: "source",
        operator: "equals",
        value: lower.slice(7),
      });
    else if (lower.startsWith("kind:"))
      conditions.push({
        field: "kind",
        operator: "equals",
        value: lower.slice(5),
      });
    else {
      const accountMatches = accounts.filter(
        (a) =>
          a.displayName.toLowerCase() === lower ||
          a.institution.toLowerCase().includes(lower) ||
          (lower === "amex" && a.institution === "American Express"),
      );
      if (accountMatches.length)
        conditions.push({
          field: "accountId",
          operator: "in",
          value: accountMatches.map((a) => a.id),
        });
      else if (["amzn", "amazon"].includes(lower))
        conditions.push({
          field: "search",
          operator: "regex",
          value: "AMZN|AMAZON",
        });
      else
        conditions.push({
          field: "search",
          operator: "contains",
          value: token,
        });
    }
  }
  if (month !== undefined) {
    const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const end = new Date(Date.UTC(year, month + 1, 0))
      .toISOString()
      .slice(0, 10);
    conditions.push({
      field: "date",
      operator: "between",
      value: start,
      valueTo: end,
    });
  } else if (yearToken)
    conditions.push({
      field: "date",
      operator: "between",
      value: `${year}-01-01`,
      valueTo: `${year}-12-31`,
    });
  return conditions;
}

export function filterTransactions(
  transactions: Transaction[],
  conditions: RuleCondition[],
  match: "all" | "any" = "all",
) {
  return transactions.filter((t) => matchesConditions(t, conditions, match));
}
export function applySavedView(transactions: Transaction[], view: SavedView) {
  return filterTransactions(transactions, view.conditions, view.match);
}
