import type { Account, Category } from "./models";
import type { Transaction } from "./models";
import { normalizeDescription } from "./normalize";
import { formatUkDate, formatDateRange } from "./dates";

/** Display-only cleanup: originals remain searchable and available in details. */
export function displayMerchant(
  t: Pick<Transaction, "merchant" | "description"> &
    Partial<Pick<Transaction, "sourceMerchant">>,
) {
  const raw = (t.merchant || t.description).trim();
  if (
    t.sourceMerchant &&
    t.merchant &&
    normalizeDescription(t.merchant) !== normalizeDescription(t.sourceMerchant)
  )
    return t.merchant.trim();
  const normalized = normalizeDescription(raw);
  const names: [RegExp, string][] = [
    [/\bPRIME VIDEO\b/, "Prime Video"],
    [/\bAMAZON\b|\bAMZN\b/, "Amazon"],
    [/\bWAITROSE\b/, "Waitrose"],
    [/\bSAINSBURY/, "Sainsbury’s"],
    [/\bTESCO\b/, "Tesco"],
    [/\bPRET\b/, "Pret A Manger"],
    [/\bTFL\b|TRANSPORT FOR LONDON/, "TfL Travel"],
    [/\bNETFLIX\b/, "Netflix"],
    [/\bSPOTIFY\b/, "Spotify"],
    [/\bJOHN LEWIS\b/, "John Lewis"],
    [/\bSIEMENS\b/, "Siemens"],
    [/\bAMERICAN EXP\b|\bAMEX\b/, "American Express"],
    [/\bTAX FREE CHILDCARE\b/, "Tax-Free Childcare"],
  ];
  const known = names.find(([pattern]) => pattern.test(normalized));
  if (known) return known[1];
  const cleaned = raw
    .replace(
      /^(?:(?:DIRECT DEBIT|BILL PAYMENT|PAYMENT|RECEIVED)\s+)?(?:TO|FROM)\s+/i,
      "",
    )
    .replace(/\s+(?:REF(?:ERENCE)?[:.]?|CARD[:.]?|IBAN[:.]?)\s*.*$/i, "")
    .trim();
  if (!cleaned) return raw;
  return cleaned === cleaned.toUpperCase()
    ? cleaned.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase())
    : cleaned;
}
export const displayDate = (iso: string) => formatUkDate(iso, true);
export const displayDateRange = formatDateRange;
export function displayCategory(category: Category, categories: Category[]) {
  const parent = categories.find((c) => c.id === category.parentId);
  return parent ? `${parent.name} · ${category.name}` : category.name;
}

export function displayAccountType(type: Account["accountType"]) {
  const names: Partial<Record<Account["accountType"], string>> = {
    current: "Current account",
    savings: "Savings account",
    credit: "Credit card",
    credit_card: "Credit card",
    mortgage: "Mortgage",
    loan: "Loan",
    property: "Property",
    vehicle: "Vehicle",
    pension: "Pension",
    investment: "Investment",
    other_asset: "Other asset",
    other_liability: "Other liability",
  };
  return names[type] ?? "Account";
}

/** Friendly fallback only for the generic names supplied by bank statements. */
export function displayAccountName(
  account: Pick<Account, "displayName" | "institution" | "accountType">,
) {
  if (
    !/^(current account|credit card|account|savings)$/i.test(
      account.displayName.trim(),
    ) ||
    account.institution === "Other"
  )
    return account.displayName;
  if (["credit", "credit_card"].includes(account.accountType))
    return account.institution === "Barclays"
      ? "Barclaycard"
      : account.institution === "American Express"
        ? "Amex"
        : `${account.institution} card`;
  return account.institution;
}
