import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import type { Category, Setting, Transaction } from "../domain/models";
import { decimalMoney, money, parseMoney, safeSum } from "../domain/money";
import { displayDate, displayMerchant } from "../domain/presentation";
import {
  allocateMinor,
  refundCandidates,
} from "../analytics/effective-transactions";
import { db } from "../storage/database";
import { authorizeMonthEdit } from "../storage/month-review";
import { undoChange } from "../storage/audit";
import { TagPicker } from "./TagManager";
import { SplitRuleOffer } from "./SplitRuleOffer";
import {
  refundAllocationImpact,
  refundCountedMonths,
  refundMonthName,
  type RefundImpact,
} from "../analytics/refund-impact";
import {
  splitTransaction,
  unsplitTransaction,
  linkRefund,
  revertRefund,
  unlinkTransfer,
  markTransactionsReviewed,
  type SplitLine,
} from "../storage/accuracy";
import "./accuracy.css";

export interface AccuracyChange {
  changeId: string;
  label: string;
  splitRuleOffer?: { transaction: Transaction; lines: Transaction[] };
}
export function TransactionAccuracy({
  transaction,
  categories: suppliedCategories,
  onChanged,
  initialMode,
  onClose,
  compact = false,
}: {
  transaction: Transaction;
  categories?: Category[];
  onChanged?: (change: AccuracyChange) => void | Promise<void>;
  initialMode?: "split" | "refund";
  onClose?: () => void;
  compact?: boolean;
}) {
  const [mode, setMode] = useState<"split" | "refund" | "unsplit" | undefined>(
    initialMode,
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<AccuracyChange>();
  const [busy, setBusy] = useState(false);
  const data = useLiveQuery(
    async () => ({
      categories: suppliedCategories ?? (await db.categories.toArray()),
      children: await db.transactions
        .where("parentId")
        .equals(transaction.id)
        .toArray(),
      purchases: await db.transactions
        .where("date")
        .belowOrEqual(transaction.date)
        .filter(
          (row) =>
            row.currency === transaction.currency &&
            row.amount < 0 &&
            !row.isTransfer &&
            !row.transferPairId,
        )
        .toArray(),
      refunds: await db.transactions.where("kind").equals("refund").toArray(),
      settings: await db.settings.toArray(),
      periodRows: await db.transactions
        .where("categoryId")
        .equals("salary")
        .toArray(),
      closedMonths: (await db.monthCloses.toArray()).map(
        (month) => month.month,
      ),
      linked: await db.transactions.bulkGet(
        (transaction.refundAllocations ?? []).map(
          (allocation) => allocation.transactionId,
        ),
      ),
    }),
    [transaction.id, transaction.updatedAt, suppliedCategories],
  );
  const close = () => {
    setMode(undefined);
    onClose?.();
  };
  const changed = async (
    receipt: { changeId: string },
    label: string,
    splitRuleOffer?: AccuracyChange["splitRuleOffer"],
  ) => {
    const change = { changeId: receipt.changeId, label, splitRuleOffer };
    setNotice(change);
    setMode(undefined);
    await onChanged?.(change);
    if (onClose) onClose();
  };
  const execute = async (
    operation: () => Promise<{ changeId: string }>,
    label: string,
    authorize = true,
  ) => {
    setBusy(true);
    setError("");
    try {
      const linked = transaction.transferPairId
        ? await db.transactions
            .filter((row) => row.transferPairId === transaction.transferPairId)
            .toArray()
        : [transaction];
      const affected =
        transaction.kind === "refund"
          ? [
              ...linked,
              ...(data?.linked.filter((row): row is Transaction => !!row) ??
                []),
            ]
          : linked;
      if (authorize && !(await authorizeMonthEdit(affected))) return;
      await changed(await operation(), label);
    } catch (exception) {
      setError(
        exception instanceof Error
          ? exception.message
          : "Changes could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {!initialMode && (
        <div
          className={compact ? "accuracy-actions compact" : "accuracy-actions"}
        >
          {!transaction.isTransfer &&
            transaction.kind !== "refund" &&
            !transaction.parentId && (
              <button
                onClick={() =>
                  setMode(
                    transaction.kind === "split_parent" ? "unsplit" : "split",
                  )
                }
                disabled={busy}
              >
                {transaction.kind === "split_parent" ? "Unsplit" : "Split"}
              </button>
            )}
          {transaction.amount > 0 &&
            !transaction.isTransfer &&
            transaction.kind !== "split_parent" &&
            !transaction.parentId && (
              <button onClick={() => setMode("refund")} disabled={busy}>
                Refund of…
              </button>
            )}
          {transaction.transferPairId && (
            <button
              onClick={() =>
                void execute(
                  () => unlinkTransfer(transaction.id),
                  "Transfer unlinked",
                )
              }
              disabled={busy}
            >
              Unlink transfer
            </button>
          )}
          {transaction.kind === "refund" && (
            <button
              onClick={() =>
                void execute(
                  () => revertRefund(transaction.id),
                  "Restored as income",
                )
              }
              disabled={busy}
            >
              Restore as normal income
            </button>
          )}
          {!transaction.isReviewed && (
            <button
              onClick={() =>
                void execute(
                  () => markTransactionsReviewed([transaction.id]),
                  "Reviewed",
                )
              }
              disabled={busy}
            >
              Mark reviewed
            </button>
          )}
        </div>
      )}
      {!!data?.children.length && !initialMode && (
        <div className="accuracy-split-summary">
          <strong>Split · {data.children.length} lines</strong>
          {data.children.map((child) => (
            <Link key={child.id} to={`/transactions/${child.id}`}>
              <span>
                {data.categories.find(
                  (category) => category.id === child.categoryId,
                )?.name ?? "Needs category"}
              </span>
              <strong>{money(child.amount, child.currency, true)}</strong>
            </Link>
          ))}
        </div>
      )}
      {transaction.kind === "refund" &&
        !!transaction.refundAllocations?.length && (
          <p className="coverage-note">
            Refund · counted in{" "}
            {refundCountedMonths(
              transaction,
              data?.linked.filter((row): row is Transaction => !!row) ?? [],
              data?.settings,
              data?.periodRows,
            )
              .map((month) => refundMonthName(month, true))
              .join(", ")}
          </p>
        )}
      {error && (
        <p role="alert" className="notice warning">
          {error}
        </p>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice.label}.{" "}
          {notice.changeId && (
            <button
              onClick={async () => {
                try {
                  await undoChange(notice.changeId);
                  setNotice(undefined);
                } catch (exception) {
                  setError(
                    exception instanceof Error
                      ? exception.message
                      : "Undo failed.",
                  );
                }
              }}
            >
              Undo
            </button>
          )}
          {notice.splitRuleOffer && (
            <SplitRuleOffer {...notice.splitRuleOffer} />
          )}
        </div>
      )}
      {mode && data && (
        <AccuracyDialog
          title={
            mode === "split"
              ? "Split transaction"
              : mode === "unsplit"
                ? "Unsplit transaction"
                : "Refund of…"
          }
          onClose={close}
        >
          <p>
            {displayMerchant(transaction)} ·{" "}
            {money(transaction.amount, transaction.currency, true)}
          </p>
          {mode === "split" ? (
            <SplitEditor
              transaction={transaction}
              categories={data.categories}
              onSaved={changed}
            />
          ) : mode === "unsplit" ? (
            <UnsplitEditor
              transaction={transaction}
              categories={data.categories}
              onSaved={changed}
            />
          ) : (
            <RefundEditor
              transaction={transaction}
              purchases={data.purchases}
              refunds={data.refunds}
              categories={data.categories}
              settings={data.settings}
              periodRows={data.periodRows}
              closedMonths={data.closedMonths}
              onSaved={changed}
            />
          )}
        </AccuracyDialog>
      )}
    </>
  );
}

function AccuracyDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="accuracy-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id="accuracy-dialog-title">{title}</h2>
        <button aria-label="Close editor" onClick={onClose}>
          ✕
        </button>
      </header>
      {children}
    </dialog>
  );
}

function SplitEditor({
  transaction,
  categories,
  onSaved,
}: {
  transaction: Transaction;
  categories: Category[];
  onSaved: (
    receipt: { changeId: string },
    label: string,
    splitRuleOffer?: AccuracyChange["splitRuleOffer"],
  ) => Promise<void>;
}) {
  const [lines, setLines] = useState<
    { amount: string; categoryId: string; note: string; tags: string[] }[]
  >([
    {
      amount: "",
      categoryId: transaction.categoryId ?? "",
      note: "",
      tags: [...transaction.tags],
    },
    { amount: "", categoryId: "", note: "", tags: [...transaction.tags] },
  ]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const amounts = lines.map((line) => {
    try {
      return line.amount
        ? Math.abs(parseMoney(line.amount, transaction.currency))
        : 0;
    } catch {
      return undefined;
    }
  });
  const remaining = amounts.every((amount) => amount !== undefined)
    ? Math.abs(transaction.amount) - safeSum(amounts as number[])
    : undefined;
  const update = (index: number, patch: Partial<(typeof lines)[number]>) =>
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
  const distribute = () => {
    if (remaining === undefined) return;
    const empty = lines
      .map((line, i) => (!line.amount ? i : -1))
      .filter((i) => i >= 0);
    if (empty.length) {
      const values = allocateMinor(
        remaining,
        empty.map(() => 1),
      );
      setLines((current) =>
        current.map((line, i) =>
          empty.includes(i)
            ? {
                ...line,
                amount: decimalMoney(
                  values[empty.indexOf(i)],
                  transaction.currency,
                ),
              }
            : line,
        ),
      );
    } else {
      const values = allocateMinor(
        Math.abs(transaction.amount),
        amounts as number[],
      );
      setLines((current) =>
        current.map((line, i) => ({
          ...line,
          amount: decimalMoney(values[i], transaction.currency),
        })),
      );
    }
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (!(await authorizeMonthEdit([transaction]))) return;
      const split: SplitLine[] = lines.map((line) => ({
        amount:
          Math.abs(parseMoney(line.amount, transaction.currency)) *
          Math.sign(transaction.amount),
        categoryId: line.categoryId,
        note: line.note.trim() || undefined,
        tags: line.tags,
      }));
      const receipt = await splitTransaction(transaction.id, split);
      await onSaved(receipt, "Transaction split", {
        transaction,
        lines: receipt.result,
      });
    } catch (exception) {
      setError(
        exception instanceof Error
          ? exception.message
          : "Split could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="accuracy-editor">
      <p className="coverage-note">
        Split spending between categories. The original amount and statement
        balance stay unchanged.
      </p>
      {lines.map((line, i) => (
        <fieldset key={i} className="split-line">
          <legend>Line {i + 1}</legend>
          <div className="form-grid">
            <label>
              Category
              <select
                value={line.categoryId}
                onChange={(event) =>
                  update(i, { categoryId: event.target.value })
                }
              >
                <option value="">Choose category</option>
                {categories
                  .filter(
                    (category) =>
                      !category.archived &&
                      !category.parentId &&
                      category.id !== "refund" &&
                      (transaction.amount > 0 || category.kind === "expense"),
                  )
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Amount ({transaction.currency})
              <input
                inputMode="decimal"
                value={line.amount}
                onChange={(event) => update(i, { amount: event.target.value })}
                aria-label={`Split amount ${i + 1}`}
              />
            </label>
            <label>
              Note
              <input
                value={line.note}
                maxLength={1000}
                onChange={(event) => update(i, { note: event.target.value })}
              />
            </label>
            <div className="split-line-tags">
              <TagPicker
                value={line.tags}
                onChange={(tags) => update(i, { tags })}
              />
            </div>
          </div>
          {lines.length > 2 && (
            <button
              onClick={() =>
                setLines((current) => current.filter((_, index) => index !== i))
              }
            >
              Remove line {i + 1}
            </button>
          )}
        </fieldset>
      ))}
      <div className="accuracy-actions">
        <button
          disabled={lines.length >= 20}
          onClick={() =>
            setLines((current) => [
              ...current,
              {
                amount: "",
                categoryId: "",
                note: "",
                tags: [...transaction.tags],
              },
            ])
          }
        >
          Add line
        </button>
        <button
          disabled={remaining === undefined || remaining === 0}
          onClick={distribute}
        >
          Distribute remainder
        </button>
      </div>
      <p role="status">
        <strong>
          {remaining === undefined
            ? "Check the amounts"
            : `${money(remaining, transaction.currency)} unallocated`}
        </strong>
      </p>
      {error && (
        <p role="alert" className="notice warning">
          {error}
        </p>
      )}
      <button
        className="primary"
        disabled={
          busy ||
          remaining !== 0 ||
          lines.some((line, i) => !line.categoryId || !amounts[i])
        }
        onClick={() => void save()}
      >
        Save split
      </button>
    </div>
  );
}

function UnsplitEditor({
  transaction,
  categories,
  onSaved,
}: {
  transaction: Transaction;
  categories: Category[];
  onSaved: (receipt: { changeId: string }, label: string) => Promise<void>;
}) {
  const [category, setCategory] = useState(transaction.categoryId ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="accuracy-editor">
      <p>
        Restore the original transaction and choose the category to keep.
        Split-line notes and tags are removed; Undo restores them.
      </p>
      <label>
        Category to keep
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="">Uncategorized</option>
          {categories
            .filter(
              (item) =>
                !item.archived &&
                !item.parentId &&
                (transaction.amount > 0 || item.kind === "expense"),
            )
            .map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="notice warning">
          {error}
        </p>
      )}
      <button
        className="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            if (await authorizeMonthEdit([transaction]))
              await onSaved(
                await unsplitTransaction(transaction.id, category || undefined),
                "Transaction unsplit",
              );
          } catch (exception) {
            setError(
              exception instanceof Error
                ? exception.message
                : "Unsplit failed.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        Restore single transaction
      </button>
    </div>
  );
}

function RefundEditor({
  transaction,
  purchases,
  refunds,
  categories,
  settings,
  periodRows,
  closedMonths,
  onSaved,
}: {
  transaction: Transaction;
  purchases: Transaction[];
  refunds: Transaction[];
  categories: Category[];
  settings: Setting[];
  periodRows: Transaction[];
  closedMonths: string[];
  onSaved: (receipt: { changeId: string }, label: string) => Promise<void>;
}) {
  const suggestions = refundCandidates(transaction, [...purchases, ...refunds]);
  const [search, setSearch] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>(
    Object.fromEntries(
      (transaction.refundAllocations ?? []).map((line) => [
        line.transactionId,
        decimalMoney(line.amount, transaction.currency),
      ]),
    ),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = Object.entries(allocations);
  let remaining: number | undefined;
  try {
    remaining =
      transaction.amount -
      safeSum(
        selected.map(([, value]) =>
          value ? parseMoney(value, transaction.currency) : 0,
        ),
      );
  } catch {
    remaining = undefined;
  }
  let impacts: RefundImpact[] = [];
  let previewError = "";
  let parsedAllocations: NonNullable<Transaction["refundAllocations"]> = [];
  try {
    parsedAllocations = selected.map(([transactionId, value]) => ({
      transactionId,
      amount: value ? parseMoney(value, transaction.currency) : 0,
    }));
    if (parsedAllocations.some((line) => line.amount < 0))
      throw new Error("Refund amounts must be positive.");
    impacts = refundAllocationImpact(
      transaction,
      purchases,
      refunds,
      parsedAllocations,
      settings,
      periodRows,
    );
  } catch (exception) {
    previewError =
      exception instanceof Error
        ? exception.message
        : "Check the refund amounts.";
  }
  const impactText = (impact: RefundImpact) =>
    `${refundMonthName(impact.month)} updated: ${categories.find((category) => category.id === impact.categoryId)?.name ?? "Uncategorized"} ${money(impact.amount, transaction.currency, true)} (refund)`;
  const shown = [
    ...suggestions,
    ...purchases.filter(
      (purchase) =>
        !purchase.parentId &&
        !suggestions.some((item) => item.id === purchase.id),
    ),
  ]
    .filter((purchase) =>
      `${purchase.description} ${purchase.merchant}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .slice(0, 80);
  const suggestedIds = new Set(suggestions.map((purchase) => purchase.id));
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await onSaved(
        await linkRefund(transaction.id, parsedAllocations),
        impacts.length
          ? impacts.map(impactText).join(" · ")
          : "Refund link confirmed; spending unchanged",
      );
    } catch (exception) {
      setError(
        exception instanceof Error
          ? exception.message
          : "Refund could not be linked.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="accuracy-editor">
      <p className="coverage-note">
        Refunds reduce the original purchase month and category, including
        closed months. They never count as income.
      </p>
      <label>
        Find original purchases
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="refund-purchases">
        {shown.map((purchase) => (
          <div key={purchase.id} className="refund-purchase">
            <label className="refund-choice">
              <input
                type="checkbox"
                checked={Object.hasOwn(allocations, purchase.id)}
                onChange={(event) =>
                  setAllocations((current) => {
                    const next = { ...current };
                    if (event.target.checked)
                      next[purchase.id] = decimalMoney(
                        Math.min(transaction.amount, Math.abs(purchase.amount)),
                        transaction.currency,
                      );
                    else delete next[purchase.id];
                    return next;
                  })
                }
              />
              <span>
                <strong>{displayMerchant(purchase)}</strong>
                <small>
                  {displayDate(purchase.date)} ·{" "}
                  {money(purchase.amount, purchase.currency)}
                  {suggestedIds.has(purchase.id) ? " · Suggested" : ""}
                </small>
              </span>
            </label>
            {Object.hasOwn(allocations, purchase.id) && (
              <label>
                Refund amount
                <input
                  inputMode="decimal"
                  aria-label={`Refund amount for ${displayMerchant(purchase)}`}
                  value={allocations[purchase.id]}
                  onChange={(event) =>
                    setAllocations((current) => ({
                      ...current,
                      [purchase.id]: event.target.value,
                    }))
                  }
                />
              </label>
            )}
          </div>
        ))}
      </div>
      {!!selected.length && (
        <div className="notice" role="status">
          <strong>Refund allocation preview</strong>
          {impacts.map((impact) => (
            <p key={`${impact.month}:${impact.categoryId}`}>
              {impactText(impact)}
              {closedMonths.includes(impact.month)
                ? " · closed snapshot updates automatically"
                : ""}
            </p>
          ))}
          <p>
            Refunds are excluded from income. The arrival date stays{" "}
            {displayDate(transaction.date)}.
          </p>
          {previewError && <p role="alert">{previewError}</p>}
        </div>
      )}
      {!shown.length && (
        <p>
          No earlier purchases found in this currency. Import the original
          purchase statement first.
        </p>
      )}
      <p role="status">
        <strong>
          {remaining === undefined
            ? "Check the refund amounts"
            : `${money(remaining, transaction.currency)} unallocated`}
        </strong>
      </p>
      {error && (
        <p role="alert" className="notice warning">
          {error}
        </p>
      )}
      <button
        className="primary"
        disabled={
          busy ||
          remaining !== 0 ||
          !selected.length ||
          !!previewError ||
          parsedAllocations.some((line) => line.amount <= 0)
        }
        onClick={() => void save()}
      >
        Link refund
      </button>
    </div>
  );
}
