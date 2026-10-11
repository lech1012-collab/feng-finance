import { beforeEach, describe, expect, it } from "vitest";
import { db, initializeDatabase } from "./database";
import { clearLocalData, createBackup, validateBackup } from "./backup";
import { transaction, accounts } from "../tests/helpers";
import {
  splitTransaction,
  unsplitTransaction,
  linkRefund,
  markTransactionsReviewed,
  refreshTransferProposals,
  confirmTransferProposals,
  unlinkTransfer,
  createManualTransaction,
} from "./accuracy";
import { undoChange } from "./audit";
import { cashFlow } from "../analytics/calculations";
import { needsReview } from "../analytics/effective-transactions";

beforeEach(async () => {
  await clearLocalData();
  await initializeDatabase();
  await db.accounts.bulkPut(accounts);
});

describe("persistent accuracy operations and Undo", () => {
  it("persists exact splits atomically and can Undo or unsplit", async () => {
    const parent = transaction({ id: "parent", amount: -6000 });
    await db.transactions.add(parent);
    const receipt = await splitTransaction(parent.id, [
      { amount: -4500, categoryId: "groceries" },
      { amount: -1500, categoryId: "household" },
    ]);
    expect(await db.transactions.count()).toBe(3);
    expect(cashFlow(await db.transactions.toArray(), "GBP").expenses).toBe(
      6000,
    );
    await undoChange(receipt.changeId);
    expect(await db.transactions.toArray()).toEqual([parent]);
    await splitTransaction(parent.id, [
      { amount: -4500, categoryId: "groceries" },
      { amount: -1500, categoryId: "household" },
    ]);
    const restored = await unsplitTransaction(parent.id, "groceries");
    expect(restored.result).toMatchObject({
      kind: "normal",
      categoryId: "groceries",
      amount: -6000,
    });
    expect(await db.transactions.count()).toBe(1);
    expect(
      await db.rules.filter((rule) => !!rule.auto).toArray(),
    ).toMatchObject([{ categoryId: "groceries", accountId: parent.accountId }]);
    await undoChange(restored.changeId);
    expect((await db.transactions.get(parent.id))?.kind).toBe("split_parent");
    expect(await db.transactions.count()).toBe(3);
    expect(await db.rules.filter((rule) => !!rule.auto).count()).toBe(0);
  });
  it("rejects a one-penny gap without changing the original", async () => {
    const parent = transaction({ amount: -6000 });
    await db.transactions.add(parent);
    await expect(
      splitTransaction(parent.id, [
        { amount: -4499, categoryId: "groceries" },
        { amount: -1500, categoryId: "household" },
      ]),
    ).rejects.toThrow("exactly");
    expect(await db.transactions.toArray()).toEqual([parent]);
  });
  it("updates a closed original month for a refund without a reopen and Undo restores its snapshot", async () => {
    const purchase = transaction({
      id: "purchase",
      date: "2026-08-20",
      amount: -4000,
      categoryId: "shopping",
    });
    const refund = transaction({
      id: "refund",
      date: "2026-09-03",
      amount: 4000,
      kind: "refund",
      isReviewed: false,
    });
    await db.transactions.bulkAdd([purchase, refund]);
    const close = {
      month: "2026-08",
      currency: "GBP",
      closedAt: "2026-09-01T00:00:00Z",
      snapshot: { income: 0, expenses: 4000, net: -4000, transactionCount: 1 },
    };
    await db.monthCloses.add(close);
    const result = await linkRefund(refund.id, [
      { transactionId: purchase.id, amount: 4000 },
    ]);
    expect((await db.monthCloses.get("2026-08"))?.snapshot.expenses).toBe(0);
    expect((await db.transactions.get(refund.id))?.date).toBe("2026-09-03");
    expect(cashFlow(await db.transactions.toArray(), "GBP").income).toBe(0);
    await undoChange(result.changeId);
    expect(await db.monthCloses.get("2026-08")).toEqual(close);
    expect(await db.transactions.get(refund.id)).toEqual(refund);
  });
  it("blocks over-refunds and preserves prior allocations", async () => {
    const purchase = transaction({ id: "purchase", amount: -4000 });
    const first = transaction({ id: "first", amount: 2500 });
    const second = transaction({ id: "second", amount: 2000 });
    await db.transactions.bulkAdd([purchase, first, second]);
    await linkRefund(first.id, [{ transactionId: purchase.id, amount: 2500 }]);
    await expect(
      linkRefund(second.id, [{ transactionId: purchase.id, amount: 2000 }]),
    ).rejects.toThrow("exceed");
    expect((await db.transactions.get(second.id))?.kind).toBeUndefined();
  });
  it("rejects a pending transfer proposal when its debit is split and Undo restores the proposal", async () => {
    const debit = transaction({ id: "split-debit", amount: -6000 });
    const credit = transaction({
      id: "split-credit",
      amount: 6000,
      accountId: "a3",
    });
    await db.transactions.bulkAdd([debit, credit]);
    const proposals = await refreshTransferProposals([debit.id, credit.id]);
    const result = await splitTransaction(debit.id, [
      { amount: -4500, categoryId: "groceries" },
      { amount: -1500, categoryId: "household" },
    ]);
    expect(
      (await db.transferProposals.get(proposals.pending[0].id))?.status,
    ).toBe("rejected");
    await undoChange(result.changeId);
    expect(
      (await db.transferProposals.get(proposals.pending[0].id))?.status,
    ).toBe("pending");
  });
  it("blocks financial-kind conversions that would hide split lines or lose a linked refund", async () => {
    const { editTransaction, linkTransfers } = await import("./transactions");
    const { categorizeCards, TRANSFER_TARGET } = await import("./categorize");
    const debit = transaction({ id: "protected-purchase", amount: -4000 });
    const credit = transaction({
      id: "protected-credit",
      amount: 4000,
      accountId: "a3",
    });
    const income = transaction({
      id: "positive-parent",
      amount: 4000,
      categoryId: "salary",
    });
    await db.transactions.bulkAdd([debit, credit, income]);
    const split = await splitTransaction(income.id, [
      { amount: 2000, categoryId: "salary" },
      { amount: 2000, categoryId: "other-income" },
    ]);
    const child = split.result[0];
    await expect(
      editTransaction(child.id, {
        merchant: child.merchant,
        categoryId: child.categoryId,
        subcategoryId: undefined,
        type: "transfer",
        tags: [],
      }),
    ).rejects.toThrow("split line");
    await expect(categorizeCards([child], TRANSFER_TARGET)).rejects.toThrow(
      "split line",
    );
    await expect(
      linkRefund(income.id, [{ transactionId: debit.id, amount: 4000 }]),
    ).rejects.toThrow("split");
    await expect(linkTransfers(income.id, debit.id)).rejects.toThrow("Unsplit");
    await linkRefund(credit.id, [{ transactionId: debit.id, amount: 4000 }]);
    await expect(linkTransfers(debit.id, credit.id)).rejects.toThrow("refund");
    expect(cashFlow(await db.transactions.toArray(), "GBP")).toEqual({
      income: 4000,
      expenses: 0,
      net: 4000,
    });
    expect((await db.transactions.get(credit.id))?.refundAllocations).toEqual([
      { transactionId: debit.id, amount: 4000 },
    ]);
  });
  it("manual transfer setting proposes, confirms and Undoes both sides", async () => {
    const debit = transaction({
      id: "debit",
      amount: -95000,
      date: "2026-09-01",
    });
    const credit = transaction({
      id: "credit",
      accountId: "a3",
      amount: 95000,
      date: "2026-09-03",
      type: "income",
    });
    await db.transactions.bulkAdd([debit, credit]);
    const refresh = await refreshTransferProposals([debit.id, credit.id]);
    expect(refresh.linked).toHaveLength(0);
    expect(refresh.pending).toHaveLength(1);
    expect((await db.transactions.get(debit.id))?.isTransfer).toBe(false);
    const receipt = await confirmTransferProposals([refresh.pending[0].id]);
    expect((await db.transactions.get(debit.id))?.kind).toBe("card_repayment");
    expect(cashFlow(await db.transactions.toArray(), "GBP")).toEqual({
      income: 0,
      expenses: 0,
      net: 0,
    });
    await undoChange(receipt.changeId);
    expect(await db.transactions.get(debit.id)).toEqual(debit);
    expect(await db.transactions.get(credit.id)).toEqual(credit);
    expect(
      (await db.transferProposals.get(refresh.pending[0].id))?.status,
    ).toBe("pending");
  });
  it("prevents all transfer entry points from hiding a purchase referenced by a linked refund", async () => {
    const { editTransaction, linkTransfers } = await import("./transactions");
    const { categorizeCards, TRANSFER_TARGET } = await import("./categorize");
    const debit = transaction({ id: "refunded-debit", amount: -4000 });
    const otherCredit = transaction({
      id: "other-credit",
      accountId: "a3",
      amount: 4000,
    });
    const refund = transaction({ id: "allocated-refund", amount: 1000 });
    await db.transactions.bulkAdd([debit, otherCredit, refund]);
    const proposals = await refreshTransferProposals([
      debit.id,
      otherCredit.id,
    ]);
    await linkRefund(refund.id, [{ transactionId: debit.id, amount: 1000 }]);
    await expect(categorizeCards([debit], TRANSFER_TARGET)).rejects.toThrow(
      "Unlink the refunds",
    );
    await expect(
      editTransaction(debit.id, {
        merchant: debit.merchant,
        categoryId: undefined,
        subcategoryId: undefined,
        type: "transfer",
        tags: [],
      }),
    ).rejects.toThrow("Unlink the refunds");
    await expect(linkTransfers(debit.id, otherCredit.id)).rejects.toThrow(
      "Unlink the refunds",
    );
    expect(
      (await db.transferProposals.get(proposals.pending[0].id))?.status,
    ).toBe("rejected");
    // A stale proposal supplied by another tab must also be checked at commit.
    await db.transferProposals.update(proposals.pending[0].id, {
      status: "pending",
    });
    await expect(
      confirmTransferProposals([proposals.pending[0].id]),
    ).rejects.toThrow("Unlink the refunds");
    expect(await db.transactions.get(debit.id)).toEqual(debit);
    expect(await db.transferLinks.count()).toBe(0);
    expect(cashFlow(await db.transactions.toArray(), "GBP")).toEqual({
      income: 4000,
      expenses: 3000,
      net: 1000,
    });
  });
  it("confirming an ambiguous pair dismisses competing proposals in the same Undo", async () => {
    const debit = transaction({ id: "ambiguous-debit", amount: -4000 });
    const credits = [
      transaction({ id: "ambiguous-one", accountId: "a2", amount: 4000 }),
      transaction({ id: "ambiguous-two", accountId: "a3", amount: 4000 }),
    ];
    await db.transactions.bulkAdd([debit, ...credits]);
    const proposals = await refreshTransferProposals([
      debit.id,
      ...credits.map((row) => row.id),
    ]);
    expect(proposals.pending).toHaveLength(2);
    const result = await confirmTransferProposals([proposals.pending[0].id]);
    expect(
      await db.transferProposals.where("status").equals("pending").count(),
    ).toBe(0);
    expect(
      await db.transferProposals.where("status").equals("rejected").count(),
    ).toBe(1);
    await undoChange(result.changeId);
    expect(
      await db.transferProposals.where("status").equals("pending").count(),
    ).toBe(2);
  });
  it("confirmed cross-currency pairs preserve the metadata required for a restorable backup", async () => {
    await db.accounts.update("a2", { currency: "EUR" });
    await db.fxRates.put({
      id: "manual-eur-gbp",
      base: "EUR",
      quote: "GBP",
      date: "2026-09-01",
      rate: "1",
      source: "manual",
    });
    const debit = transaction({
      id: "cross-debit",
      amount: -4000,
      source: "manual",
      sourcePage: 0,
      statementId: "",
    });
    const credit = transaction({
      id: "cross-credit",
      amount: 4000,
      type: "income",
      currency: "EUR",
      accountId: "a2",
      source: "manual",
      sourcePage: 0,
      statementId: "",
    });
    await db.transactions.bulkAdd([debit, credit]);
    const proposals = await refreshTransferProposals([debit.id, credit.id], {
      mode: "automatic",
    });
    expect(proposals.linked).toHaveLength(0);
    expect(proposals.pending).toHaveLength(1);
    const result = await confirmTransferProposals([proposals.pending[0].id]);
    expect(result.result[0]).toMatchObject({
      manual: true,
      crossCurrency: true,
    });
    expect(validateBackup(await createBackup()).transferLinks).toEqual(
      result.result,
    );
  });
  it("several penny refunds against a split purchase remain valid in a closed snapshot", async () => {
    const parent = transaction({ id: "split-pennies", amount: -2 });
    const first = transaction({
      id: "refund-penny-one",
      date: "2026-10-01",
      amount: 1,
    });
    const second = transaction({
      id: "refund-penny-two",
      date: "2026-10-02",
      amount: 1,
    });
    await db.transactions.bulkAdd([parent, first, second]);
    await splitTransaction(parent.id, [
      { amount: -1, categoryId: "groceries" },
      { amount: -1, categoryId: "household" },
    ]);
    await db.monthCloses.put({
      month: "2026-09",
      currency: "GBP",
      closedAt: "2026-10-01T00:00:00Z",
      snapshot: { income: 0, expenses: 2, net: -2, transactionCount: 1 },
    });
    await linkRefund(first.id, [{ transactionId: parent.id, amount: 1 }]);
    await linkRefund(second.id, [{ transactionId: parent.id, amount: 1 }]);
    expect((await db.monthCloses.get("2026-09"))?.snapshot.expenses).toBe(0);
    expect(cashFlow(await db.transactions.toArray(), "GBP").expenses).toBe(0);
  });
  it("automatic mode links only eligible pairs and unlink restores their directions", async () => {
    const debit = transaction({ id: "debit", amount: -20000 });
    const credit = transaction({
      id: "credit",
      accountId: "a2",
      amount: 20000,
    });
    await db.transactions.bulkAdd([debit, credit]);
    const refresh = await refreshTransferProposals([debit.id, credit.id], {
      mode: "automatic",
    });
    expect(refresh.linked).toHaveLength(1);
    const result = await unlinkTransfer(debit.id);
    expect((await db.transactions.get(debit.id))?.type).toBe("expense");
    expect((await db.transactions.get(credit.id))?.type).toBe("income");
    await undoChange(result.changeId);
    expect((await db.transactions.get(debit.id))?.isTransfer).toBe(true);
  });
  it("leaves automatic pairs in closed months pending instead of failing a durable import", async () => {
    const debit = transaction({ id: "debit", amount: -20000 });
    const credit = transaction({
      id: "credit",
      accountId: "a2",
      amount: 20000,
    });
    await db.transactions.bulkAdd([debit, credit]);
    await db.monthCloses.add({
      month: "2026-09",
      closedAt: "2026-10-01T00:00:00Z",
      snapshot: { income: 20000, expenses: 20000, net: 0, transactionCount: 2 },
    });
    const result = await refreshTransferProposals([debit.id, credit.id], {
      mode: "automatic",
    });
    expect(result.linked).toHaveLength(0);
    expect(result.pending).toHaveLength(1);
  });
  it("bulk reviewing is one Undo, and uncategorized still needs a category", async () => {
    const categorized = transaction({
      id: "known",
      categoryId: "groceries",
      isReviewed: false,
    });
    const unknown = transaction({ id: "unknown", isReviewed: false });
    await db.transactions.bulkAdd([categorized, unknown]);
    const result = await markTransactionsReviewed([categorized.id, unknown.id]);
    expect(result.result).toBe(2);
    expect(needsReview((await db.transactions.get(categorized.id))!)).toBe(
      false,
    );
    expect(needsReview((await db.transactions.get(unknown.id))!)).toBe(true);
    await undoChange(result.changeId);
    expect((await db.transactions.get(categorized.id))?.isReviewed).toBe(false);
  });
  it("confirms a rule-created split without changing its lines and Undo returns it to review", async () => {
    const parent = transaction({ id: "rule-split", amount: -6000 });
    await db.transactions.add(parent);
    await splitTransaction(parent.id, [
      { amount: -4500, categoryId: "groceries" },
      { amount: -1500, categoryId: "household" },
    ]);
    await db.transactions.update(parent.id, {
      isReviewed: false,
      categorySource: "rule",
    });
    const before = await db.transactions.toArray();
    expect(needsReview((await db.transactions.get(parent.id))!)).toBe(true);
    const result = await markTransactionsReviewed([parent.id]);
    expect(needsReview((await db.transactions.get(parent.id))!)).toBe(false);
    expect(cashFlow(await db.transactions.toArray(), "GBP").expenses).toBe(
      6000,
    );
    expect(
      await db.transactions.where("parentId").equals(parent.id).toArray(),
    ).toEqual(before.filter((row) => !!row.parentId));
    await undoChange(result.changeId);
    expect(await db.transactions.toArray()).toEqual(before);
  });
  it("just this payment leaves the learned default and other matching purchases unchanged", async () => {
    const { categorizeCards } = await import("./categorize");
    const first = transaction({ id: "first", merchant: "SAME SHOP" });
    const next = transaction({ id: "next", merchant: "SAME SHOP" });
    await db.transactions.bulkPut([first, next]);
    await categorizeCards([first], "groceries");
    const rules = await db.rules.filter((rule) => !!rule.auto).toArray();
    const receipt = await categorizeCards([next], "shopping", {
      learn: false,
      backfill: false,
    });
    expect(receipt.rule).toBeUndefined();
    expect(await db.rules.filter((rule) => !!rule.auto).toArray()).toEqual(
      rules,
    );
    expect((await db.transactions.get(first.id))?.categoryId).toBe("groceries");
    expect((await db.transactions.get(next.id))?.categoryId).toBe("shopping");
    await undoChange(receipt.changeId!);
    expect(await db.transactions.get(next.id)).toEqual(next);
  });
  it("manual entries have no source statement and can create a cash wallet atomically", async () => {
    const result = await createManualTransaction({
      date: "2026-09-01",
      description: "Cash groceries",
      amount: -1500,
      categoryId: "groceries",
      cashOpeningBalance: 5000,
    });
    expect(result.result).toMatchObject({
      source: "manual",
      amount: -1500,
      statementId: "",
      isReviewed: true,
    });
    expect((await db.accounts.get(result.result.accountId))?.tracking).toBe(
      "manual",
    );
    expect(
      (
        await db.valuations
          .where("accountId")
          .equals(result.result.accountId)
          .first()
      )?.valueMinor,
    ).toBe(5000);
    const { manualCashBalance } = await import("../analytics/manual-cash");
    expect(
      manualCashBalance(
        (await db.accounts.get(result.result.accountId))!,
        await db.valuations.toArray(),
        await db.transactions.toArray(),
        "2026-09-01",
      ).valueMinor,
    ).toBe(3500);
    await undoChange(result.changeId);
    expect(await db.transactions.get(result.result.id)).toBeUndefined();
    expect(await db.accounts.get(result.result.accountId)).toBeUndefined();
  });
  it("recognizes an older unreviewed refund when the purchase statement arrives later", async () => {
    const { classifyRefundCandidates } = await import("./accuracy");
    const refund = transaction({
      id: "old-credit",
      date: "2026-09-20",
      merchant: "SAME SHOP",
      amount: 4000,
      isReviewed: false,
    });
    await db.transactions.put(refund);
    const purchase = transaction({
      id: "later-imported-purchase",
      date: "2026-08-20",
      merchant: "SAME SHOP",
      amount: -4000,
    });
    await db.transactions.put(purchase);
    const result = await classifyRefundCandidates([purchase.id]);
    expect(result.result).toBe(1);
    expect((await db.transactions.get(refund.id))?.kind).toBe("refund");
    expect(cashFlow(await db.transactions.toArray(), "GBP").income).toBe(0);
    await undoChange(result.changeId);
    expect(await db.transactions.get(refund.id)).toEqual(refund);
  });
});
