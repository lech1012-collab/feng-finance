import type { Category, Rule, Transaction } from "../domain/models";
import { matches } from "./engine";
import { normalizeDescription, normalizeMerchant } from "../domain/normalize";

const clues: [RegExp, string[]][] = [
  [
    /\b(WATER|ENERGY|ELECTRIC|GAS|E\.?ON|CTAX|COUNCIL TAX|TV LICEN[CS]E)\b/,
    ["utilities"],
  ],
  [
    /\b(GYM|FITNESS|LEISUR\w*|DENTAL|PHARMACY)\b/,
    ["healthcare", "entertainment"],
  ],
  [/\b(RESTAURANT|CAFE|COFFEE)\b/, ["restaurants"]],
  [/\b(SUPERMARKET|GROCERY|GROCERIES|FOOD MARKET)\b/, ["groceries"]],
  [/\b(TRAIN|RAIL|BUS|TAXI|PARKING)\b/, ["transport"]],
  [/\b(SUBSCRIPTION|MEMBERSHIP|STREAMING)\b/, ["subscriptions"]],
  [/\b(MORTGAGE|PROPERTY REPAIR|SERVICE CHARGE)\b/, ["property"]],
  [/\b(SALARY|PAYROLL|WAGES)\b/, ["salary"]],
  [/\b(RENT RECEIVED|RENTAL INCOME)\b/, ["property-income"]],
];

/** Suggestions require evidence and never change a transaction automatically. */
export function categorySuggestions(
  t: Transaction,
  categories: Category[],
  rules: Rule[],
  history: Transaction[],
) {
  if (t.isTransfer || t.type === "transfer" || t.transferPairId) return [];
  const available = categories.filter(
    (c) =>
      !c.archived &&
      !c.parentId &&
      c.kind === (t.amount >= 0 ? "income" : "expense"),
  );
  const scores = new Map<string, number>();
  const add = (id: string | undefined, score: number) => {
    const category = categories.find((c) => c.id === id);
    if (category?.archived) return;
    const mainId = category?.parentId ?? id;
    if (mainId && available.some((c) => c.id === mainId))
      scores.set(mainId, Math.max(scores.get(mainId) ?? 0, score));
  };
  for (const r of rules)
    if (r.type !== "transfer" && matches(r, t))
      add(
        r.categoryId,
        (r.builtIn ? 70 : 100) +
          (r.match === "exact" ? 10 : 0) +
          Math.min(9, Math.max(0, r.priority / 100)),
      );
  const merchant = normalizeMerchant(t.merchant);
  for (const p of history)
    if (
      merchant &&
      p.id !== t.id &&
      p.isReviewed &&
      !p.isTransfer &&
      p.type !== "transfer" &&
      !p.transferPairId &&
      p.currency === t.currency &&
      p.accountId === t.accountId &&
      Math.sign(p.amount) === Math.sign(t.amount) &&
      normalizeMerchant(p.merchant) === merchant
    )
      add(p.categoryId, 85);
  const text = normalizeDescription(t.description);
  for (const [pattern, ids] of clues)
    if (pattern.test(text)) ids.forEach((id, i) => add(id, 50 - i * 5));
  for (const c of available)
    if (
      c.name.length > 3 &&
      ` ${text} `.includes(` ${normalizeDescription(c.name)} `)
    )
      add(c.id, 40);
  return available
    .filter((c) => scores.has(c.id))
    .sort(
      (a, b) =>
        scores.get(b.id)! - scores.get(a.id)! || a.name.localeCompare(b.name),
    )
    .slice(0, 3);
}
