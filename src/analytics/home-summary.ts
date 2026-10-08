import type { Account, Setting, Transaction } from "../domain/models";
import { monthOffset } from "../domain/dates";
import { safeSum } from "../domain/money";
import { financialType } from "../domain/transaction-type";
import { readReminderConfig, REMINDER_KEY } from "./reminders";

/** Transfer labels use account identity, not amount similarity. A card payment
 * can be recognized on either side of a stored transfer pair. */
export function transferKind(
  transaction: Transaction,
  accounts: Account[],
  transactions: Transaction[] = [],
): "card" | "internal" {
  const creditIds = new Set(
    accounts
      .filter((account) => account.accountType === "credit")
      .map((a) => a.id),
  );
  if (
    creditIds.has(transaction.accountId) ||
    (transaction.transferPairId &&
      transactions.some(
        (other) =>
          other.transferPairId === transaction.transferPairId &&
          creditIds.has(other.accountId),
      )) ||
    /\b(?:AMERICAN\s*EXP(?:RESS)?|AMEX|BARCLAYCARD|CREDIT\s*CARD)\b/i.test(
      `${transaction.description} ${transaction.merchant}`,
    )
  )
    return "card";
  return "internal";
}

/** Each explicitly linked movement is counted once, even when both accounts
 * were imported. Unlinked rows remain separate; equal amounts are not proof. */
export function excludedFlows(
  transactions: Transaction[],
  accounts: Account[],
  month: string,
  currency: string,
) {
  const groups = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    if (
      transaction.currency !== currency ||
      !transaction.date.startsWith(month) ||
      financialType(transaction) !== "transfer"
    )
      continue;
    const key = transaction.transferPairId
      ? `pair:${transaction.transferPairId}`
      : `transaction:${transaction.id}`;
    const rows = groups.get(key) ?? [];
    rows.push(transaction);
    groups.set(key, rows);
  }
  const internal: number[] = [];
  const card: number[] = [];
  for (const rows of groups.values()) {
    // An outgoing row is the payment; the receiving row is the same movement.
    const payment = rows.find((row) => row.amount < 0) ?? rows[0];
    const kind = transferKind(payment, accounts, transactions);
    (kind === "card" ? card : internal).push(Math.abs(payment.amount));
  }
  return { internal: safeSum(internal), card: safeSum(card) };
}

export function homeDataHealth(settings: Setting[], today: string) {
  const rawDate = settings.find((s) => s.key === "backup:lastExportAt")?.value;
  const timestamp = rawDate ? Date.parse(rawDate) : NaN;
  const lastExportAt = Number.isFinite(timestamp) ? rawDate : undefined;
  const rawCount = Number(
    settings.find((s) => s.key === "backup:lastExportCount")?.value,
  );
  const exportedCount =
    Number.isSafeInteger(rawCount) && rawCount >= 0 ? rawCount : undefined;
  const age = lastExportAt
    ? (Date.parse(`${today}T00:00:00Z`) -
        Date.parse(`${lastExportAt.slice(0, 10)}T00:00:00Z`)) /
      86400000
    : undefined;
  const config = readReminderConfig(
    settings.find((s) => s.key === REMINDER_KEY)?.value,
  );
  const date = `${today.slice(0, 7)}-${String(config.day).padStart(2, "0")}`;
  const reviewDate =
    date < today
      ? `${monthOffset(today.slice(0, 7), 1)}-${date.slice(8)}`
      : date;
  return {
    lastExportAt,
    exportedCount,
    warning: !lastExportAt || (age ?? 0) > 30,
    reviewDate: config.enabled ? reviewDate : undefined,
  };
}
