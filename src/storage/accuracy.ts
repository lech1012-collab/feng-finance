import type {
  Transaction,
  TransferLink,
  TransferProposal,
} from "../domain/models";
import { amountType, financialType } from "../domain/transaction-type";
import { id } from "../domain/normalize";
import { safeSum, currencyPrecision } from "../domain/money";
import { db } from "./database";
import { auditedMutation } from "./audit";
import {
  findTransferProposals,
  eligibleAutomaticProposals,
  type TransferProposalOptions,
} from "../transfers/engine";
import { markRefundCandidates } from "../analytics/effective-transactions";
import { ensureMonthsOpen, updateClosedMonthSnapshots } from "./month-review";
import { convertMinor } from "../analytics/fx";
import { parseDate } from "../domain/dates";
import { fingerprint } from "../domain/normalize";
import { rememberCategory } from "./category-memory";

export interface SplitLine {
  amount: number;
  categoryId: string;
  tags?: string[];
  note?: string;
}

/** Call within the mutation's transactions table scope before changing a kind.
 * A linked refund and its original purchase form one financial relationship. */
export async function ensureRefundIntegrity(
  current: Transaction,
  next: Transaction,
): Promise<void> {
  if (
    current.refundAllocations?.length &&
    (next.kind !== "refund" ||
      financialType(next) === "transfer" ||
      next.categoryId !== current.categoryId ||
      next.amount !== current.amount ||
      next.currency !== current.currency ||
      next.date !== current.date ||
      JSON.stringify(next.refundAllocations) !==
        JSON.stringify(current.refundAllocations) ||
      !!next.ruleSplit?.length)
  )
    throw new Error(
      "Unlink or restore this linked refund before changing its financial classification.",
    );
  if (
    current.amount >= 0 ||
    (financialType(next) !== "transfer" &&
      next.kind !== "refund" &&
      next.categoryId !== "refund" &&
      next.amount === current.amount &&
      next.currency === current.currency &&
      next.date === current.date)
  )
    return;
  const referenced = await db.transactions
    .where("kind")
    .equals("refund")
    .filter(
      (refund) =>
        !!refund.refundAllocations?.some(
          (allocation) => allocation.transactionId === current.id,
        ),
    )
    .first();
  if (referenced)
    throw new Error(
      "Unlink the refunds for this purchase before marking it as a transfer or changing its original amount or date.",
    );
}

export function transactionSplitRows(
  parent: Transaction,
  lines: SplitLine[],
): Transaction[] {
  if (
    parent.parentId ||
    parent.isTransfer ||
    parent.type === "transfer" ||
    parent.transferPairId ||
    (parent.amount > 0 && parent.categoryId === "refund") ||
    ["refund", "transfer", "card_repayment"].includes(parent.kind ?? "")
  )
    throw new Error(
      "Refunds, transfers and existing child lines cannot be split.",
    );
  if (lines.length < 2 || lines.length > 20)
    throw new Error("A split needs between 2 and 20 lines.");
  if (
    lines.some(
      (line) =>
        !Number.isSafeInteger(line.amount) ||
        line.amount === 0 ||
        Math.sign(line.amount) !== Math.sign(parent.amount),
    )
  )
    throw new Error(
      "Split lines must be nonzero amounts with the same direction as the purchase.",
    );
  if (safeSum(lines.map((line) => line.amount)) !== parent.amount)
    throw new Error(
      "Split amounts must add up exactly to the original transaction.",
    );
  const now = new Date().toISOString();
  return lines.map((line, index) => ({
    ...parent,
    id: id(),
    parentId: parent.id,
    kind: "normal",
    type: amountType(parent.amount),
    source: "split",
    amount: line.amount,
    categoryId: line.categoryId,
    subcategoryId: undefined,
    categorySource: parent.ruleSplit?.length ? "rule" : "manual",
    categoryRuleId: parent.ruleSplit?.length
      ? parent.categoryRuleId
      : undefined,
    appliedRuleIds: parent.ruleSplit?.length
      ? parent.appliedRuleIds
      : undefined,
    tags: line.tags ?? [...parent.tags],
    note: line.note,
    balanceAfterTransaction: undefined,
    transactionFingerprint: `${parent.transactionFingerprint}:split:${index}`,
    occurrence: index,
    isReviewed: true,
    isTransfer: false,
    transferPairId: undefined,
    linkId: undefined,
    refundAllocations: undefined,
    attachmentIds: undefined,
    createdAt: now,
    updatedAt: now,
  }));
}

export async function splitTransaction(parentId: string, lines: SplitLine[]) {
  return auditedMutation(
    "Split transaction",
    [
      "transactions",
      "categories",
      "monthCloses",
      "settings",
      "transferProposals",
    ],
    async () => {
      const parent = await db.transactions.get(parentId);
      if (!parent) throw new Error("Transaction no longer exists.");
      await ensureMonthsOpen([parent]);
      if (
        parent.parentId ||
        parent.isTransfer ||
        parent.transferPairId ||
        parent.kind === "refund"
      )
        throw new Error(
          "Refunds, transfers and existing child lines cannot be split.",
        );
      const previous = await db.transactions
        .where("parentId")
        .equals(parent.id)
        .toArray();
      if (previous.length)
        throw new Error("Unsplit this transaction before replacing its split.");
      const children = transactionSplitRows(parent, lines);
      for (const child of children) {
        const category = await db.categories.get(child.categoryId!);
        if (
          !category ||
          category.archived ||
          category.id === "refund" ||
          (child.amount < 0 && category.kind === "income")
        )
          throw new Error(
            "Choose an available category with the correct money direction for every line.",
          );
      }
      await db.transactions.bulkAdd(children);
      await db.transactions.update(parent.id, {
        kind: "split_parent",
        categoryId: undefined,
        subcategoryId: undefined,
        isReviewed: true,
        updatedAt: new Date().toISOString(),
      });
      await db.transferProposals
        .where("status")
        .equals("pending")
        .filter(
          (proposal) =>
            proposal.debitTxId === parent.id ||
            proposal.creditTxId === parent.id,
        )
        .modify({ status: "rejected" });
      return children;
    },
  );
}

export async function unsplitTransaction(
  parentId: string,
  categoryId?: string,
) {
  return auditedMutation(
    "Unsplit transaction",
    ["transactions", "categories", "monthCloses", "settings", "rules"],
    async () => {
      const parent = await db.transactions.get(parentId);
      if (!parent || parent.kind !== "split_parent")
        throw new Error("This transaction is not split.");
      await ensureMonthsOpen([parent]);
      if (categoryId) {
        const category = await db.categories.get(categoryId);
        if (
          !category ||
          category.archived ||
          (parent.amount < 0 && category.kind === "income")
        )
          throw new Error("Choose an available category.");
      }
      const children = await db.transactions
        .where("parentId")
        .equals(parent.id)
        .toArray();
      const childIds = new Set(children.map((child) => child.id));
      for (const refund of await db.transactions
        .where("kind")
        .equals("refund")
        .toArray()) {
        if (
          !refund.refundAllocations?.some((allocation) =>
            childIds.has(allocation.transactionId),
          )
        )
          continue;
        const merged = new Map<string, number>();
        for (const allocation of refund.refundAllocations) {
          const target = childIds.has(allocation.transactionId)
            ? parent.id
            : allocation.transactionId;
          merged.set(target, (merged.get(target) ?? 0) + allocation.amount);
        }
        await db.transactions.update(refund.id, {
          refundAllocations: [...merged].map(([transactionId, amount]) => ({
            transactionId,
            amount,
          })),
        });
      }
      await db.transactions.bulkDelete(children.map((child) => child.id));
      await db.transactions.update(parent.id, {
        kind: "normal",
        categoryId,
        subcategoryId: undefined,
        categorySource: categoryId ? "manual" : undefined,
        categoryRuleId: undefined,
        ruleSplit: undefined,
        isReviewed: !!categoryId,
        updatedAt: new Date().toISOString(),
      });
      const saved = (await db.transactions.get(parent.id))!;
      const learned = await rememberCategory(saved, parent);
      if (learned) {
        saved.categoryRuleId = learned.id;
        saved.categorySource = "manual";
        await db.transactions.put(saved);
      }
      return saved;
    },
  );
}

export async function linkRefund(
  refundId: string,
  allocations: { transactionId: string; amount: number }[],
) {
  return auditedMutation(
    "Link refund to original purchases",
    [
      "transactions",
      "monthCloses",
      "settings",
      "accounts",
      "statements",
      "fxRates",
      "categories",
      "transferProposals",
    ],
    async () => {
      const refund = await db.transactions.get(refundId);
      if (
        !refund ||
        refund.amount <= 0 ||
        refund.parentId ||
        refund.kind === "split_parent" ||
        refund.transferPairId ||
        refund.isTransfer
      )
        throw new Error(
          "Choose a money-in transaction that is not a transfer or a split child.",
        );
      if (
        !allocations.length ||
        allocations.length > 20 ||
        new Set(allocations.map((line) => line.transactionId)).size !==
          allocations.length ||
        allocations.some(
          (line) => !Number.isSafeInteger(line.amount) || line.amount <= 0,
        ) ||
        safeSum(allocations.map((line) => line.amount)) !== refund.amount
      )
        throw new Error(
          "Allocate the entire refund in positive, exact amounts to one or more purchases.",
        );
      const others = await db.transactions
        .where("kind")
        .equals("refund")
        .filter((transaction) => transaction.id !== refund.id)
        .toArray();
      for (const allocation of allocations) {
        const purchase = await db.transactions.get(allocation.transactionId);
        if (
          !purchase ||
          purchase.parentId ||
          purchase.amount >= 0 ||
          purchase.currency !== refund.currency ||
          purchase.isTransfer ||
          purchase.transferPairId ||
          purchase.date > refund.date
        )
          throw new Error(
            "Refunds must link to earlier expenses in the same currency.",
          );
        const refunded = safeSum(
          others.flatMap((other) =>
            (other.refundAllocations ?? [])
              .filter((line) => line.transactionId === purchase.id)
              .map((line) => line.amount),
          ),
        );
        if (refunded + allocation.amount > -purchase.amount)
          throw new Error(
            "This refund would exceed the amount of the original purchase.",
          );
      }
      await db.transactions.update(refund.id, {
        kind: "refund",
        type: "income",
        isTransfer: false,
        categoryId: undefined,
        subcategoryId: undefined,
        refundAllocations: allocations,
        isReviewed: true,
        updatedAt: new Date().toISOString(),
      });
      const noLongerTransfers = new Set([
        refund.id,
        ...allocations.map((allocation) => allocation.transactionId),
      ]);
      await db.transferProposals
        .where("status")
        .equals("pending")
        .filter(
          (proposal) =>
            noLongerTransfers.has(proposal.debitTxId) ||
            noLongerTransfers.has(proposal.creditTxId),
        )
        .modify({ status: "rejected" });
      await updateClosedMonthSnapshots();
      return (await db.transactions.get(refund.id))!;
    },
  );
}

export async function revertRefund(refundId: string) {
  return auditedMutation(
    "Restore refund as normal income",
    [
      "transactions",
      "monthCloses",
      "settings",
      "accounts",
      "statements",
      "fxRates",
      "categories",
    ],
    async () => {
      const refund = await db.transactions.get(refundId);
      if (!refund || refund.kind !== "refund")
        throw new Error("This transaction is not a refund.");
      const purchases = (
        await db.transactions.bulkGet(
          (refund.refundAllocations ?? []).map(
            (allocation) => allocation.transactionId,
          ),
        )
      ).filter((row): row is Transaction => !!row);
      await ensureMonthsOpen([refund, ...purchases]);
      await db.transactions.update(refund.id, {
        kind: "normal",
        refundAllocations: undefined,
        isReviewed: false,
        updatedAt: new Date().toISOString(),
      });
      await updateClosedMonthSnapshots();
      return (await db.transactions.get(refund.id))!;
    },
  );
}

export async function markTransactionsReviewed(transactionIds: string[]) {
  const unique = [...new Set(transactionIds)];
  return auditedMutation(
    "Mark transactions reviewed",
    ["transactions", "monthCloses", "settings"],
    async () => {
      const rows = (await db.transactions.bulkGet(unique)).filter(
        (row): row is Transaction => !!row,
      );
      if (rows.length !== unique.length)
        throw new Error("A transaction changed. Refresh the list first.");
      await ensureMonthsOpen(rows);
      const now = new Date().toISOString();
      await db.transactions.bulkPut(
        rows.map((row) => ({ ...row, isReviewed: true, updatedAt: now })),
      );
      return rows.length;
    },
  );
}

/** Called inside the caller's transaction, including transactions, accounts,
 * settings, monthCloses, fxRates, transferLinks and transferProposals tables. */
export async function applyTransferProposal(
  proposal: TransferProposal,
  manual: boolean,
): Promise<TransferLink> {
  const debit = await db.transactions.get(proposal.debitTxId),
    credit = await db.transactions.get(proposal.creditTxId);
  if (
    !debit ||
    !credit ||
    debit.accountId === credit.accountId ||
    debit.amount >= 0 ||
    credit.amount <= 0 ||
    debit.transferPairId ||
    credit.transferPairId ||
    debit.parentId ||
    credit.parentId ||
    debit.kind === "refund" ||
    credit.kind === "refund" ||
    debit.kind === "split_parent" ||
    credit.kind === "split_parent" ||
    (!proposal.crossCurrency &&
      (debit.currency !== credit.currency || debit.amount !== -credit.amount))
  )
    throw new Error(
      "These transactions no longer form an unlinked transfer pair. Review the list again.",
    );
  if (proposal.crossCurrency) {
    if (!manual)
      throw new Error(
        "Cross-currency transfer pairs always require manual confirmation.",
      );
    if (debit.currency === credit.currency)
      throw new Error("This pair does not require currency conversion.");
    const rates = await db.fxRates.toArray();
    const currency = (await db.settings.get("currency"))?.value ?? "GBP";
    const outgoing = convertMinor(
      debit.amount,
      debit.currency,
      currency,
      debit.date,
      rates,
    )?.amount;
    const incoming = convertMinor(
      credit.amount,
      credit.currency,
      currency,
      credit.date,
      rates,
    )?.amount;
    if (
      outgoing === undefined ||
      incoming === undefined ||
      outgoing === 0 ||
      BigInt(Math.abs(Math.abs(outgoing) - Math.abs(incoming))) * 100n >
        BigInt(Math.abs(outgoing)) * 2n
    )
      throw new Error(
        "These converted amounts differ by more than 2%, or a rate is missing. Check the exchange rate before linking.",
      );
  }
  for (const transaction of [debit, credit])
    await ensureRefundIntegrity(transaction, {
      ...transaction,
      type: "transfer",
      isTransfer: true,
      kind: proposal.pairKind ?? "transfer",
    });
  await ensureMonthsOpen([debit, credit]);
  const now = new Date().toISOString();
  const link: TransferLink = {
    id: id(),
    transactionIds: [debit.id, credit.id],
    createdAt: now,
    manual,
    crossCurrency: proposal.crossCurrency || undefined,
  };
  await db.transferLinks.add(link);
  for (const transaction of [debit, credit])
    await db.transactions.update(transaction.id, {
      kind: proposal.pairKind ?? "transfer",
      type: "transfer",
      isTransfer: true,
      transferPairId: link.id,
      linkId: link.id,
      categoryId: undefined,
      subcategoryId: undefined,
      isReviewed: manual || transaction.isReviewed,
      updatedAt: now,
    });
  await db.transferProposals.update(proposal.id, { status: "confirmed" });
  await db.transferProposals
    .where("status")
    .equals("pending")
    .filter(
      (other) =>
        other.id !== proposal.id &&
        [other.debitTxId, other.creditTxId].some(
          (transactionId) =>
            transactionId === debit.id || transactionId === credit.id,
        ),
    )
    .modify({ status: "rejected" });
  return link;
}

export async function confirmTransferProposals(proposalIds: string[]) {
  return auditedMutation(
    "Confirm transfer pairs",
    [
      "transactions",
      "transferLinks",
      "transferProposals",
      "monthCloses",
      "settings",
      "fxRates",
    ],
    async () => {
      const proposals = await db.transferProposals.bulkGet([
        ...new Set(proposalIds),
      ]);
      if (
        proposals.some((proposal) => !proposal || proposal.status !== "pending")
      )
        throw new Error("A transfer proposal changed. Refresh the list first.");
      const used = new Set<string>();
      for (const proposal of proposals as TransferProposal[]) {
        if (used.has(proposal.debitTxId) || used.has(proposal.creditTxId))
          throw new Error("Choose only one match for each transaction.");
        used.add(proposal.debitTxId);
        used.add(proposal.creditTxId);
      }
      const links: TransferLink[] = [];
      for (const proposal of proposals as TransferProposal[])
        links.push(await applyTransferProposal(proposal, true));
      return links;
    },
  );
}

export async function rejectTransferProposal(proposalId: string) {
  return auditedMutation(
    "Reject transfer suggestion",
    ["transferProposals"],
    async () => {
      const proposal = await db.transferProposals.get(proposalId);
      if (!proposal || proposal.status !== "pending")
        throw new Error("This proposal is no longer pending.");
      await db.transferProposals.update(proposalId, { status: "rejected" });
    },
  );
}

export async function unlinkTransfer(transactionId: string) {
  return auditedMutation(
    "Unlink transfer pair",
    [
      "transactions",
      "transferLinks",
      "transferProposals",
      "monthCloses",
      "settings",
    ],
    async () => {
      const transaction = await db.transactions.get(transactionId);
      if (!transaction || !transaction.transferPairId)
        throw new Error("This transaction has no linked pair.");
      const link = await db.transferLinks.get(transaction.transferPairId);
      if (!link)
        throw new Error("Transfer link is missing. Restore a verified backup.");
      const rows = (await db.transactions.bulkGet(link.transactionIds)).filter(
        (row): row is Transaction => !!row,
      );
      await ensureMonthsOpen(rows);
      for (const row of rows)
        await db.transactions.update(row.id, {
          type: amountType(row.amount),
          kind: "normal",
          isTransfer: false,
          transferPairId: undefined,
          linkId: undefined,
          isReviewed: false,
          updatedAt: new Date().toISOString(),
        });
      await db.transferLinks.delete(link.id);
      await db.transferProposals
        .where("status")
        .equals("confirmed")
        .filter(
          (proposal) =>
            link.transactionIds.includes(proposal.debitTxId) &&
            link.transactionIds.includes(proposal.creditTxId),
        )
        .modify({ status: "rejected" });
    },
  );
}

export async function refreshTransferProposals(
  importedIds?: string[],
  options: TransferProposalOptions & {
    mode?: "manual" | "automatic";
    automaticProposalIds?: ReadonlySet<string>;
  } = {},
) {
  const [modeSetting, windowSetting, legacyWindowSetting] = await Promise.all([
    db.settings.get("transferMatching"),
    db.settings.get("transferDateWindowDays"),
    db.settings.get("transferDateWindow"),
  ]);
  const mode =
    options.mode ??
    (modeSetting?.value === "automatic" ? "automatic" : "manual");
  const requestedWindow = Number(
    windowSetting?.value ?? legacyWindowSetting?.value ?? 4,
  );
  const dateWindow =
    options.dateWindow ??
    (Number.isInteger(requestedWindow) &&
    requestedWindow >= 0 &&
    requestedWindow <= 7
      ? requestedWindow
      : 4);
  const incoming = importedIds
    ? (await db.transactions.bulkGet(importedIds)).filter(
        (row): row is Transaction => !!row,
      )
    : [];
  let rows: Transaction[];
  if (incoming.length) {
    const dates = incoming.map((row) => row.date).sort();
    const shift = (date: string, days: number) =>
      new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
    rows = await db.transactions
      .where("date")
      .between(
        shift(dates[0], -dateWindow),
        shift(dates.at(-1)!, dateWindow),
        true,
        true,
      )
      .toArray();
  } else rows = await db.transactions.toArray();
  const accounts = await db.accounts.toArray();
  const rates = options.crossCurrencyValue ? [] : await db.fxRates.toArray();
  const currency = (await db.settings.get("currency"))?.value ?? "GBP";
  const crossCurrencyValue =
    options.crossCurrencyValue ??
    ((transaction: Transaction) =>
      convertMinor(
        transaction.amount,
        transaction.currency,
        currency,
        transaction.date,
        rates,
      )?.amount);
  const refundedPurchases = new Set(
    (await db.transactions.where("kind").equals("refund").toArray()).flatMap(
      (refund) =>
        (refund.refundAllocations ?? []).map(
          (allocation) => allocation.transactionId,
        ),
    ),
  );
  const candidates = findTransferProposals(
    rows.filter((row) => !refundedPurchases.has(row.id)),
    accounts,
    {
      dateWindow,
      crossCurrencyValue,
    },
  );
  const previous = new Map(
    (await db.transferProposals.toArray()).map((proposal) => [
      proposal.id,
      proposal,
    ]),
  );
  const fresh = candidates.filter((candidate) => !previous.has(candidate.id));
  await db.transferProposals.bulkAdd(fresh);
  const considered = new Set(rows.map((row) => row.id));
  const available = new Set(candidates.map((candidate) => candidate.id));
  await db.transferProposals
    .where("status")
    .equals("pending")
    .filter(
      (proposal) =>
        considered.has(proposal.debitTxId) &&
        considered.has(proposal.creditTxId) &&
        !available.has(proposal.id),
    )
    .delete();
  const pending = candidates
    .map((candidate) => previous.get(candidate.id) ?? candidate)
    .filter((proposal) => proposal.status === "pending");
  const importedSet = importedIds ? new Set(importedIds) : undefined;
  const possibleAutomatic =
    mode === "automatic"
      ? eligibleAutomaticProposals(pending, rows).filter(
          (proposal) =>
            (!options.automaticProposalIds ||
              options.automaticProposalIds.has(proposal.id)) &&
            (!importedSet ||
              importedSet.has(proposal.debitTxId) ||
              importedSet.has(proposal.creditTxId)),
        )
      : [];
  const automatic: TransferProposal[] = [];
  for (const proposal of possibleAutomatic) {
    const pair = rows.filter(
      (row) => row.id === proposal.debitTxId || row.id === proposal.creditTxId,
    );
    try {
      await ensureMonthsOpen(pair);
      automatic.push(proposal);
    } catch (error) {
      if (!(
        error instanceof Error &&
        error.message === "This changes a closed month. Reopen?"
      ))
        throw error;
    }
  }
  const linked: TransferLink[] = [];
  if (automatic.length) {
    const receipt = await auditedMutation(
      "Link eligible transfers automatically",
      [
        "transactions",
        "transferLinks",
        "transferProposals",
        "monthCloses",
        "settings",
        "fxRates",
      ],
      async () => {
        for (const proposal of automatic)
          linked.push(await applyTransferProposal(proposal, false));
      },
    );
    void receipt;
  }
  return {
    pending: pending.filter(
      (proposal) => !automatic.some((item) => item.id === proposal.id),
    ),
    linked,
  };
}

export async function classifyRefundCandidates(importedIds: string[]) {
  const incoming = (await db.transactions.bulkGet(importedIds)).filter(
    (row): row is Transaction => !!row,
  );
  if (!incoming.length) return { result: 0, changeId: "" };
  const earliest = incoming.map((row) => row.date).sort()[0];
  const start = new Date(Date.parse(earliest) - 90 * 86400000)
    .toISOString()
    .slice(0, 10);
  const latestDate = incoming
    .map((row) => row.date)
    .sort()
    .at(-1)!;
  const end = new Date(Date.parse(latestDate) + 90 * 86400000)
    .toISOString()
    .slice(0, 10);
  return auditedMutation(
    "Identify refunds after statement import",
    ["transactions", "monthCloses", "settings", "fxRates", "categories"],
    async () => {
      const existing = await db.transactions
        .where("date")
        .between(start, end, true, true)
        .toArray();
      const originals = new Map(existing.map((row) => [row.id, row]));
      const classified = markRefundCandidates(existing);
      const changed = classified
        .filter(
          (row) =>
            JSON.stringify(row) !== JSON.stringify(originals.get(row.id)),
        )
        .map((row) => ({ ...row, updatedAt: new Date().toISOString() }));
      if (changed.length) {
        await db.transactions.bulkPut(changed);
        await updateClosedMonthSnapshots();
      }
      return changed.length;
    },
  );
}

export interface ManualTransactionInput {
  accountId?: string;
  date: string;
  description: string;
  merchant?: string;
  amount: number;
  currency?: string;
  categoryId?: string;
  tags?: string[];
  note?: string;
  cashOpeningBalance?: number;
}
export async function createManualTransaction(input: ManualTransactionInput) {
  if (!Number.isSafeInteger(input.amount) || input.amount === 0)
    throw new Error("Enter a nonzero amount in integer minor units.");
  const date = parseDate(input.date);
  const description = input.description.trim();
  if (!description || description.length > 1000)
    throw new Error("Enter a description between 1 and 1,000 characters.");
  const now = new Date().toISOString();
  const accountId = input.accountId ?? id();
  const account = input.accountId
    ? await db.accounts.get(input.accountId)
    : undefined;
  if (input.accountId && !account)
    throw new Error("Choose an existing account.");
  const currency = account?.currency ?? input.currency ?? "GBP";
  currencyPrecision(currency);
  const transaction: Transaction = {
    id: id(),
    accountId,
    statementId: "",
    date,
    description,
    merchant: input.merchant?.trim() || description,
    amount: input.amount,
    currency,
    type: amountType(input.amount),
    kind: "normal",
    source: "manual",
    categoryId: input.categoryId,
    tags: input.tags ?? [],
    note: input.note?.trim() || undefined,
    sourcePage: 0,
    extractionConfidence: 1,
    transactionFingerprint: "",
    occurrence: 0,
    isTransfer: false,
    isReviewed: !!input.categoryId,
    createdAt: now,
    updatedAt: now,
  };
  transaction.transactionFingerprint = await fingerprint(transaction);
  return auditedMutation(
    "Add manual transaction",
    [
      "transactions",
      "accounts",
      "categories",
      "rules",
      "settings",
      "monthCloses",
      "valuations",
    ],
    async () => {
      await ensureMonthsOpen([transaction]);
      if (input.categoryId) {
        const category = await db.categories.get(input.categoryId);
        if (
          !category ||
          category.archived ||
          (input.amount < 0 && category.kind === "income")
        )
          throw new Error(
            "Choose an available category with the correct money direction.",
          );
      }
      if (!input.accountId) {
        await db.accounts.add({
          id: accountId,
          institution: "Other",
          displayName: "Cash wallet",
          accountType: "current",
          tracking: "manual",
          includeInNetWorth: true,
          currency,
          maskedAccountIdentifier: "Cash",
          createdAt: now,
          updatedAt: now,
        });
        if (input.cashOpeningBalance !== undefined) {
          if (!Number.isSafeInteger(input.cashOpeningBalance))
            throw new Error("Opening balance must be integer minor units.");
          await db.valuations.add({
            id: id(),
            accountId,
            date,
            valueMinor: input.cashOpeningBalance,
            note: "Cash opening balance",
          });
        }
      }
      await db.transactions.add(transaction);
      const learned = await rememberCategory(transaction);
      if (learned) {
        transaction.categoryRuleId = learned.id;
        transaction.categorySource = "manual";
        await db.transactions.put(transaction);
      }
      return transaction;
    },
  );
}
