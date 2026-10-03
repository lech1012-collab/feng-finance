import type { Account, Transaction, TransferLink } from "../domain/models";
import { dayDistance } from "../domain/dates";
import { id, normalizeDescription } from "../domain/normalize";
function transferEvidence(t: Transaction, other: Account) {
  const text = normalizeDescription(t.description);
  const identifier = other.maskedAccountIdentifier.replace(/\D/g, "");
  return (
    /TRANSFER|PAYMENT|TOP[ -]?UP/.test(text) &&
    (text.includes(other.institution.toUpperCase()) ||
      (other.institution === "American Express" &&
        /AMEX|AMERICAN EXPRESS/.test(text)) ||
      (identifier.length >= 4 && text.includes(identifier)))
  );
}
export function matchTransfers(
  transactions: Transaction[],
  accounts: Account[],
): TransferLink[] {
  const links: TransferLink[] = [];
  const used = new Set(
    transactions.filter((t) => t.transferPairId).map((t) => t.id),
  );
  const byAmount = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const key = `${t.currency}|${t.amount}`;
    byAmount.set(key, [...(byAmount.get(key) ?? []), t]);
  }
  const candidates = (t: Transaction) =>
    (byAmount.get(`${t.currency}|${-t.amount}`) ?? []).filter(
      (p) =>
        p.id !== t.id &&
        !used.has(p.id) &&
        p.accountId !== t.accountId &&
        t.amount !== 0 &&
        dayDistance(t.date, p.date) <= 5 &&
        accounts.some((a) => a.id === p.accountId && transferEvidence(t, a)) &&
        accounts.some((a) => a.id === t.accountId && transferEvidence(p, a)),
    );
  for (const t of transactions) {
    if (used.has(t.id)) continue;
    const possible = candidates(t);
    if (possible.length !== 1 || candidates(possible[0]).length !== 1) continue;
    const p = possible[0];
    used.add(t.id);
    used.add(p.id);
    links.push({
      id: id(),
      transactionIds: [t.id, p.id],
      manual: false,
      createdAt: new Date().toISOString(),
    });
  }
  return links;
}
