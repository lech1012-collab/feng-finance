import type { Transaction } from "./models";
export function normalizeDescription(raw: string) {
  return raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}
export function normalizeMerchant(raw: string) {
  return normalizeDescription(raw)
    .replace(
      /\b(?:POS|CARD PURCHASE|CONTACTLESS|DIRECT DEBIT|FASTER PAYMENT)\b/g,
      "",
    )
    .replace(/\s+\d{4,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
export async function sha256(data: BufferSource) {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
export function transactionKey(
  t: Pick<
    Transaction,
    "accountId" | "date" | "description" | "amount" | "currency"
  >,
) {
  return JSON.stringify([
    t.accountId,
    t.date,
    normalizeDescription(t.description),
    t.amount,
    t.currency,
  ]);
}
export async function fingerprint(
  t: Pick<
    Transaction,
    | "accountId"
    | "date"
    | "description"
    | "amount"
    | "currency"
    | "balanceAfterTransaction"
    | "occurrence"
  >,
) {
  return sha256(
    new TextEncoder().encode(
      JSON.stringify([
        transactionKey(t),
        t.balanceAfterTransaction ?? null,
        t.occurrence,
      ]),
    ),
  );
}
export function id() {
  return crypto.randomUUID();
}
