import type {
  Account,
  ImportDraft,
  Transaction,
  TransferProposal,
} from "../domain/models";
import { db } from "../storage/database";
import {
  eligibleAutomaticProposals,
  findTransferProposals,
} from "../transfers/engine";
import { markRefundCandidates } from "../analytics/effective-transactions";
import { convertMinor } from "../analytics/fx";
import { periodMonth } from "../domain/period";

export interface ImportTransferPreview {
  proposals: TransferProposal[];
  transactions: Transaction[];
  accounts: Account[];
  mode: "manual" | "automatic";
  automaticProposalIds: string[];
}
export async function previewImportTransfers(
  drafts: ImportDraft[],
): Promise<ImportTransferPreview> {
  const incoming = drafts.flatMap((draft) =>
    draft.exactDuplicate && !draft.duplicateOverride
      ? []
      : draft.transactions
          .filter((row) => row.include && !row.ruleSplit?.length)
          .map((row) => ({
            ...row,
            isReviewed: row.manualCategory || row.isReviewed,
          })),
  );
  const [
    accounts,
    modeWindow,
    legacyWindow,
    rates,
    currency,
    rejected,
    allocatedRefunds,
    settings,
    closes,
  ] = await Promise.all([
    db.accounts.filter((account) => !account.isDemo).toArray(),
    db.settings.get("transferDateWindowDays"),
    db.settings.get("transferDateWindow"),
    db.fxRates.toArray(),
    db.settings.get("currency"),
    db.transferProposals.where("status").equals("rejected").toArray(),
    db.transactions
      .filter((row) => Boolean(row.refundAllocations?.length))
      .toArray(),
    db.settings.toArray(),
    db.monthCloses.toArray(),
  ]);
  const mode =
    settings.find((setting) => setting.key === "transferMatching")?.value ===
    "automatic"
      ? "automatic"
      : "manual";
  for (const draft of drafts)
    if (!accounts.some((account) => account.id === draft.account.id))
      accounts.push(draft.account);
  if (!incoming.length)
    return {
      proposals: [],
      transactions: [],
      accounts,
      mode,
      automaticProposalIds: [],
    };
  const dates = incoming.map((transaction) => transaction.date).sort();
  const shift = (date: string, days: number) =>
    new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000)
      .toISOString()
      .slice(0, 10);
  const known = await db.transactions
    .where("date")
    .between(shift(dates[0], -90), shift(dates.at(-1)!, 7), true, true)
    .toArray();
  const transactions = markRefundCandidates([...known, ...incoming]);
  const window = Number(modeWindow?.value ?? legacyWindow?.value ?? 4);
  const ids = new Set(incoming.map((transaction) => transaction.id));
  const rejectedIds = new Set(rejected.map((proposal) => proposal.id));
  const refundPurchaseIds = new Set(
    allocatedRefunds.flatMap((refund) =>
      refund.refundAllocations!.map((allocation) => allocation.transactionId),
    ),
  );
  const candidates = findTransferProposals(
    transactions.filter((row) => !refundPurchaseIds.has(row.id)),
    accounts,
    {
      dateWindow:
        Number.isInteger(window) && window >= 0 && window <= 7 ? window : 4,
      crossCurrencyValue: (transaction) =>
        convertMinor(
          transaction.amount,
          transaction.currency,
          currency?.value ?? "GBP",
          transaction.date,
          rates,
        )?.amount,
    },
  ).filter((proposal) => !rejectedIds.has(proposal.id));
  const proposals = candidates.filter(
    (proposal) => ids.has(proposal.debitTxId) || ids.has(proposal.creditTxId),
  );
  const closedMonths = new Set(closes.map((close) => close.month));
  const transactionsById = new Map(transactions.map((row) => [row.id, row]));
  // Count ALL candidates before narrowing to this import. An existing payment
  // with another possible counterpart must never appear as a unique match.
  const automaticProposalIds =
    mode === "automatic"
      ? eligibleAutomaticProposals(candidates, transactions)
          .filter((proposal) =>
            proposals.some((visible) => visible.id === proposal.id),
          )
          .filter((proposal) =>
            [proposal.debitTxId, proposal.creditTxId].every(
              (id) =>
                !closedMonths.has(
                  periodMonth(
                    transactionsById.get(id)!.date,
                    settings,
                    transactions,
                  ),
                ),
            ),
          )
          .map((proposal) => proposal.id)
      : [];
  return { proposals, transactions, accounts, mode, automaticProposalIds };
}
export function unambiguousImportTransfers(proposals: TransferProposal[]) {
  const counts = new Map<string, number>();
  for (const proposal of proposals)
    for (const txId of [proposal.debitTxId, proposal.creditTxId])
      counts.set(txId, (counts.get(txId) ?? 0) + 1);
  return proposals.filter(
    (proposal) =>
      counts.get(proposal.debitTxId) === 1 &&
      counts.get(proposal.creditTxId) === 1,
  );
}
