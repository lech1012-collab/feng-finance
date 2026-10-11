import type {
  Account,
  Transaction,
  TransferLink,
  TransferProposal,
} from "../domain/models";
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
function cardRepayment(t: Transaction, p: Transaction, accounts: Account[]) {
  const debit = t.amount < 0 ? t : p;
  const credit = t.amount > 0 ? t : p;
  const source = accounts.find((a) => a.id === debit.accountId);
  const destination = accounts.find((a) => a.id === credit.accountId);
  return (
    source?.accountType !== "credit" &&
    source !== undefined &&
    destination?.accountType === "credit" &&
    destination.institution === "Barclays" &&
    /^(DIRECT DEBIT(?: TO)?|BILL PAYMENT(?: TO)?|PAYMENT(?: TO)?|TRANSFER TO|FASTER PAYMENT(?: TO)?)\s+BARCLAYCARD\b/.test(
      normalizeDescription(debit.description),
    ) &&
    /^(DIRECT DEBIT\s*[-–]?\s*PAYMENT|PAYMENT RECEIVED|PAYMENT THANK YOU)\b/.test(
      normalizeDescription(credit.description),
    )
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
        (cardRepayment(t, p, accounts) ||
          (accounts.some(
            (a) => a.id === p.accountId && transferEvidence(t, a),
          ) &&
            accounts.some(
              (a) => a.id === t.accountId && transferEvidence(p, a),
            ))),
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

export interface TransferProposalOptions {
  dateWindow?: number;
  /** A reporting-currency valuation in minor units. Missing rates do not
   * generate guesses. Cross-currency pairs always require confirmation. */
  crossCurrencyValue?: (transaction: Transaction) => number | undefined;
}

export function findTransferProposals(
  transactions: Transaction[],
  accounts: Account[],
  options: TransferProposalOptions = {},
): TransferProposal[] {
  const dateWindow = options.dateWindow ?? 4;
  if (!Number.isInteger(dateWindow) || dateWindow < 0 || dateWindow > 7)
    throw new Error("Transfer date window must be between 0 and 7 days.");
  const owned = new Map(accounts.map((account) => [account.id, account]));
  const refundedPurchases = new Set(
    transactions.flatMap((transaction) =>
      (transaction.refundAllocations ?? []).map(
        (allocation) => allocation.transactionId,
      ),
    ),
  );
  const eligible = transactions.filter(
    (transaction) =>
      owned.has(transaction.accountId) &&
      transaction.amount !== 0 &&
      !transaction.transferPairId &&
      !transaction.parentId &&
      transaction.kind !== "refund" &&
      !refundedPurchases.has(transaction.id) &&
      transaction.kind !== "split_parent",
  );
  const creditsByAmount = new Map<string, Transaction[]>();
  const creditsByDate = new Map<string, Transaction[]>();
  const convertedValues = new Map<string, number | undefined>();
  const valueFor = (transaction: Transaction) => {
    if (!convertedValues.has(transaction.id))
      convertedValues.set(
        transaction.id,
        options.crossCurrencyValue?.(transaction),
      );
    return convertedValues.get(transaction.id);
  };
  for (const credit of eligible.filter(
    (transaction) => transaction.amount > 0,
  )) {
    const key = `${credit.currency}|${credit.amount}|${credit.date}`;
    const sameAmount = creditsByAmount.get(key) ?? [];
    sameAmount.push(credit);
    creditsByAmount.set(key, sameAmount);
    const onDate = creditsByDate.get(credit.date) ?? [];
    onDate.push(credit);
    creditsByDate.set(credit.date, onDate);
  }
  const proposals: TransferProposal[] = [];
  for (const debit of eligible.filter(
    (transaction) => transaction.amount < 0,
  )) {
    const dates = Array.from({ length: dateWindow * 2 + 1 }, (_, i) =>
      new Date(Date.parse(debit.date) + (i - dateWindow) * 86400000)
        .toISOString()
        .slice(0, 10),
    );
    const same = dates.flatMap(
      (date) =>
        creditsByAmount.get(`${debit.currency}|${-debit.amount}|${date}`) ?? [],
    );
    const cross = options.crossCurrencyValue
      ? dates
          .flatMap((date) => creditsByDate.get(date) ?? [])
          .filter((credit) => {
            if (credit.currency === debit.currency) return false;
            const outgoing = valueFor(debit),
              incoming = valueFor(credit);
            return (
              outgoing !== undefined &&
              incoming !== undefined &&
              Number.isSafeInteger(outgoing) &&
              Number.isSafeInteger(incoming) &&
              outgoing !== 0 &&
              BigInt(Math.abs(Math.abs(outgoing) - Math.abs(incoming))) *
                100n <=
                BigInt(Math.abs(outgoing)) * 2n
            );
          })
      : [];
    for (const credit of [...same, ...cross]) {
      const difference = dayDistance(debit.date, credit.date);
      if (
        debit.accountId === credit.accountId ||
        difference > dateWindow ||
        !!debit.isDemo !== !!credit.isDemo
      )
        continue;
      const destination = owned.get(credit.accountId)!;
      const source = owned.get(debit.accountId)!;
      const repayment =
        ["credit", "credit_card"].includes(destination.accountType) &&
        !["credit", "credit_card"].includes(source.accountType);
      const evidence =
        transferEvidence(debit, destination) ||
        transferEvidence(credit, source);
      proposals.push({
        id: `transfer:${debit.id}:${credit.id}`,
        debitTxId: debit.id,
        creditTxId: credit.id,
        score: Math.max(
          0.1,
          Math.min(1, 0.7 + (evidence ? 0.2 : 0) - difference * 0.05),
        ),
        status: "pending",
        pairKind: repayment ? "card_repayment" : "transfer",
        crossCurrency: debit.currency !== credit.currency,
        createdAt: new Date().toISOString(),
      });
    }
  }
  return proposals.sort(
    (a, b) => b.score - a.score || a.id.localeCompare(b.id),
  );
}

export function eligibleAutomaticProposals(
  proposals: TransferProposal[],
  transactions: Transaction[],
): TransferProposal[] {
  const byId = new Map(
    transactions.map((transaction) => [transaction.id, transaction]),
  );
  const counts = new Map<string, number>();
  for (const proposal of proposals.filter(
    (item) => item.status === "pending",
  )) {
    counts.set(proposal.debitTxId, (counts.get(proposal.debitTxId) ?? 0) + 1);
    counts.set(proposal.creditTxId, (counts.get(proposal.creditTxId) ?? 0) + 1);
  }
  return proposals.filter((proposal) => {
    const debit = byId.get(proposal.debitTxId),
      credit = byId.get(proposal.creditTxId);
    return (
      proposal.status === "pending" &&
      !proposal.crossCurrency &&
      debit &&
      credit &&
      debit.currency === credit.currency &&
      counts.get(debit.id) === 1 &&
      counts.get(credit.id) === 1 &&
      dayDistance(debit.date, credit.date) <= 2
    );
  });
}
