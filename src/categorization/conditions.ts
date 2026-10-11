import type { RuleCondition, Transaction } from "../domain/models";
import { normalizeDescription, normalizeMerchant } from "../domain/normalize";

/** Keep advanced patterns bounded and reject forms prone to excessive backtracking. */
export function safePattern(pattern: string): RegExp {
  if (
    !pattern ||
    pattern.length > 200 ||
    /\\[1-9]|\(\?[=!<]|\([^)]*\)[+*{]|\.\*[+*{]/.test(pattern) ||
    (pattern.match(/(?<!\\)[+*]/g)?.length ?? 0) > 2
  )
    throw new Error(
      "Use a short regular expression without backreferences, lookarounds or nested repetition.",
    );
  try {
    return new RegExp(pattern, "iu");
  } catch {
    throw new Error("This regular expression is not valid.");
  }
}

export function conditionValue(
  t: Transaction,
  field: RuleCondition["field"],
): string | number | boolean | string[] {
  switch (field) {
    case "search":
      return `${t.description} ${t.merchant} ${t.note ?? ""}`;
    case "amount":
      return Math.abs(t.amount);
    case "direction":
      return t.amount >= 0 ? "positive" : "negative";
    case "day":
      return Number(t.date.slice(8, 10));
    case "tag":
      return t.tags;
    case "reviewed":
      return t.isReviewed;
    case "kind":
      return (
        t.kind ??
        (t.isTransfer || t.type === "transfer" ? "transfer" : "normal")
      );
    case "source":
      return t.source ?? "pdf";
    case "merchant":
      return normalizeMerchant(t.sourceMerchant ?? t.merchant);
    case "displayMerchant":
      return normalizeMerchant(t.merchant);
    default:
      return t[field] ?? "";
  }
}

export function matchesCondition(t: Transaction, c: RuleCondition): boolean {
  const actual = conditionValue(t, c.field);
  if (Array.isArray(actual)) {
    if (c.field === "tag" && c.operator === "equals" && c.value === "")
      return actual.length === 0;
    const wanted = Array.isArray(c.value) ? c.value : [String(c.value)];
    return wanted.some((v) => actual.includes(v));
  }
  if (c.operator === "regex") {
    try {
      return safePattern(String(c.value)).test(String(actual).slice(0, 2000));
    } catch {
      return false;
    }
  }
  if (["between", "gt", "gte", "lt", "lte"].includes(c.operator)) {
    if (
      typeof actual === "boolean" ||
      Array.isArray(c.value) ||
      typeof c.value === "boolean"
    )
      return false;
    const lower =
      typeof actual === "number" ? Number(c.value) : String(c.value);
    const upper =
      typeof actual === "number"
        ? Number(c.valueTo ?? c.value)
        : String(c.valueTo ?? c.value);
    if (typeof actual === "number") {
      if (typeof lower !== "number" || typeof upper !== "number") return false;
      return c.operator === "between"
        ? actual >= lower && actual <= upper
        : c.operator === "gt"
          ? actual > lower
          : c.operator === "gte"
            ? actual >= lower
            : c.operator === "lt"
              ? actual < lower
              : actual <= lower;
    }
    return c.operator === "between"
      ? actual >= String(lower) && actual <= String(upper)
      : c.operator === "gt"
        ? actual > String(lower)
        : c.operator === "gte"
          ? actual >= String(lower)
          : c.operator === "lt"
            ? actual < String(lower)
            : actual <= String(lower);
  }
  if (c.operator === "in")
    return Array.isArray(c.value) && c.value.includes(String(actual));
  if (typeof actual === "number" || typeof actual === "boolean")
    return actual === c.value;
  const text = normalizeDescription(String(actual));
  const wanted = normalizeDescription(String(c.value));
  if (c.operator === "starts-with") return text.startsWith(wanted);
  if (c.operator === "contains") return text.includes(wanted);
  return text === wanted;
}

export function matchesConditions(
  t: Transaction,
  conditions: RuleCondition[],
  mode: "all" | "any" = "all",
) {
  return (
    !conditions.length ||
    (mode === "any"
      ? conditions.some((c) => matchesCondition(t, c))
      : conditions.every((c) => matchesCondition(t, c)))
  );
}
