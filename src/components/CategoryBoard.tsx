import { categoryColor } from "../domain/palette";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { X, Grip } from "lucide-react";
import type { Transaction, Category, Rule } from "../domain/models";
import { money } from "../domain/money";
import { db } from "../storage/database";
import { normalizeMerchant } from "../domain/normalize";
import {
  categorySuggestions,
  categorySuggestionReason,
} from "../categorization/suggestions";
import { displayDate, displayMerchant } from "../domain/presentation";
import {
  categorizeCards,
  matchingUncategorized,
  type CategoryReceipt,
  TRANSFER_TARGET,
  CARD_REPAYMENT_TARGET,
} from "../storage/categorize";
import { TransactionAccuracy } from "./TransactionAccuracy";
import { TagPicker } from "./TagManager";
import { authorizeMonthEdit } from "../storage/month-review";
import { conflictingCategoryRule } from "../categorization/rule-conflict";
export function CategoryBoard({
  transaction: t,
  returnTo,
  categories,
  onClose,
  onSaved,
  feedback,
  dragStart,
  selection,
  queue,
  onSkip,
  onMove,
  onUndo,
  navigationBusy = false,
}: {
  transaction: Transaction;
  returnTo?: string;
  categories: Category[];
  onClose: () => void;
  onSaved: (receipt: CategoryReceipt) => void | Promise<void>;
  feedback?: ReactNode;
  dragStart?: { x: number; y: number; pointerId: number };
  selection?: Transaction[];
  queue?: { position: number; total: number };
  onSkip?: () => void;
  onMove?: (direction: -1 | 1) => void;
  onUndo?: () => void;
  navigationBusy?: boolean;
}) {
  const location = useLocation();
  const dialog = useRef<HTMLDialogElement>(null);
  const optionsScroller = useRef<HTMLDivElement>(null);
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [target, setTarget] = useState("");
  const [search, setSearch] = useState("");
  const [accuracyMode, setAccuracyMode] = useState<"split" | "refund">();
  const [showTags, setShowTags] = useState(false);
  const [tags, setTags] = useState(t.tags);
  const [conflict, setConflict] = useState<{
    rule: Rule;
    categoryId: string;
  }>();
  useEffect(() => {
    setAccuracyMode(undefined);
    setShowTags(false);
    setTags(t.tags);
    setConflict(undefined);
    if (optionsScroller.current) optionsScroller.current.scrollTop = 0;
  }, [t.id]);
  const [savingBusy, setBusy] = useState(false);
  const busy = savingBusy || navigationBusy;
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [externalDragging, setExternalDragging] = useState(!!dragStart);
  const [cursor, setCursor] = useState({
    x: dragStart?.x ?? 0,
    y: dragStart?.y ?? 0,
  });
  const evidence = useLiveQuery(
    async () => ({
      rules: await db.rules.toArray(),
      account: await db.accounts.get(t.accountId),
      history: await db.transactions
        .where("accountId")
        .equals(t.accountId)
        .filter(
          (p) =>
            normalizeMerchant(p.sourceMerchant ?? p.merchant) ===
              normalizeMerchant(t.sourceMerchant ?? t.merchant) &&
            p.isReviewed &&
            !!p.categoryId,
        )
        .toArray(),
    }),
    [t.id, t.updatedAt],
  );
  const matches = useLiveQuery(
    () => matchingUncategorized(t),
    [t.id, t.updatedAt],
  );
  const others = matches?.filter((p) => p.id !== t.id) ?? [];
  const available = categories.filter(
    (c) =>
      !c.archived &&
      c.parentId !== "property" &&
      (!c.parentId ||
        categories.some((p) => p.id === c.parentId && !p.archived)) &&
      c.kind === (t.amount >= 0 ? "income" : "expense") &&
      c.id !== "refund" &&
      `${categories.find((p) => p.id === c.parentId)?.name ?? ""} ${c.name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  useEffect(() => {
    const el = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    el.showModal();
    return () => {
      el.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const choose = async (categoryId: string, decision?: "update" | "once") => {
    if (categoryId === "refund") {
      setAccuracyMode("refund");
      return;
    }
    if (categoryId === "__split") {
      setAccuracyMode("split");
      return;
    }
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      if (!decision) {
        const transfer =
          categoryId === TRANSFER_TARGET ||
          categoryId === CARD_REPAYMENT_TARGET;
        const existing = conflictingCategoryRule(
          t,
          { categoryId, isTransfer: transfer },
          await db.rules.toArray(),
        );
        if (existing) {
          setConflict({ rule: existing, categoryId });
          return;
        }
      }
      if (!(await authorizeMonthEdit(selection?.length ? selection : [t])))
        return;
      const receipt = await categorizeCards(
        selection?.length ? selection : [t],
        categoryId,
        {
          allowMultipleMerchants: true,
          backfill: decision !== "once",
          tags,
          learn: decision !== "once",
        },
      );
      await onSaved(receipt);
      setConflict(undefined);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Category could not be saved.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const hit = (x: number, y: number) => {
    const el = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-category-target]");
    return el && dialog.current?.contains(el)
      ? (el.dataset.categoryTarget ?? "")
      : "";
  };
  const dragging = !!(position.x || position.y);
  const suggested =
    search || t.kind === "split_parent"
      ? []
      : categorySuggestions(
          t,
          categories,
          evidence?.rules ?? [],
          evidence?.history ?? [],
        ).filter((category) => category.id !== "refund");
  const suggestionReason = (c: Category) =>
    categorySuggestionReason(
      t,
      c,
      evidence?.rules ?? [],
      evidence?.history ?? [],
    );
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (busy || accuracyMode) return;
      const editing =
        event.target instanceof HTMLElement &&
        !!event.target.closest("input,select,textarea");
      // Text inputs keep native Undo; a category receipt must only be undone
      // when focus is on the board itself.
      if (editing) return;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "z" &&
        onUndo
      ) {
        event.preventDefault();
        onUndo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^[123]$/.test(event.key)) {
        const category = suggested[Number(event.key) - 1];
        if (category) {
          event.preventDefault();
          void choose(category.id);
        }
      }
      if (event.key.toLowerCase() === "j" || event.key.toLowerCase() === "k") {
        event.preventDefault();
        onMove?.(event.key.toLowerCase() === "j" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });
  useEffect(() => {
    if (!externalDragging || !dragStart) return;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== dragStart.pointerId) return;
      setCursor({ x: e.clientX, y: e.clientY });
      setTarget(hit(e.clientX, e.clientY));
    };
    const release = (e: PointerEvent) => {
      if (e.pointerId !== dragStart.pointerId) return;
      const category = e.type === "pointerup" ? hit(e.clientX, e.clientY) : "";
      setExternalDragging(false);
      setTarget("");
      if (category) void choose(category);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
    };
  });
  const tile = (c: Category, index?: number) => (
    <button
      key={c.id}
      className={`category-tile ${target === c.id ? "drop-target" : ""}`}
      data-category-target={c.id}
      disabled={busy}
      onClick={() => void choose(c.id)}
      aria-label={`Categorize as ${c.parentId ? `${categories.find((p) => p.id === c.parentId)?.name}: ` : ""}${c.name}`}
    >
      <span
        className="category-tile-icon"
        style={{ borderColor: categoryColor(c.id) }}
      >
        {c.name.slice(0, 1)}
      </span>
      <span>
        {c.parentId && (
          <small>{categories.find((p) => p.id === c.parentId)?.name}</small>
        )}
        {c.name}
        {index !== undefined && (
          <small className="category-suggestion-reason">
            {suggestionReason(c)} <kbd>{index + 1}</kbd>
          </small>
        )}
      </span>
    </button>
  );
  const sortingCard = (
    <article
      className={`sorting-card ${dragging || externalDragging ? "is-dragging" : ""}`}
      aria-label={`Drag ${displayMerchant(t)} to a category`}
      aria-describedby="drag-help"
      style={{
        ...(externalDragging
          ? {
              position: "fixed",
              left: cursor.x + 12,
              top: cursor.y + 12,
              width: 330,
              maxWidth: "calc(100vw - 24px)",
              margin: 0,
            }
          : { transform: `translate(${position.x}px, ${position.y}px)` }),
        pointerEvents: dragging || externalDragging ? "none" : undefined,
      }}
      onPointerDown={(e) => {
        if (busy || !e.isPrimary || e.button !== 0) return;
        origin.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const p = origin.current;
        if (!p || p.id !== e.pointerId) return;
        const x = e.clientX - p.x;
        const y = e.clientY - p.y;
        if (Math.hypot(x, y) > 8) {
          setPosition({ x, y });
          setTarget(hit(e.clientX, e.clientY));
        }
      }}
      onPointerCancel={() => {
        origin.current = null;
        setPosition({ x: 0, y: 0 });
        setTarget("");
      }}
      onPointerUp={(e) => {
        const p = origin.current;
        origin.current = null;
        const category =
          p && p.id === e.pointerId && dragging
            ? hit(e.clientX, e.clientY)
            : "";
        setPosition({ x: 0, y: 0 });
        setTarget("");
        if (category) void choose(category);
      }}
    >
      <Grip size={20} />
      <div>
        <strong>{displayMerchant(t)}</strong>
        <small>
          {displayDate(t.date)}
          {evidence?.account ? ` · ${evidence.account.institution}` : ""}
        </small>
      </div>
      <strong>{money(t.amount, t.currency, true)}</strong>
    </article>
  );
  return (
    <dialog
      ref={dialog}
      className="category-dialog"
      aria-label="Where does this belong?"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="category-fixed-content">
        <header className="category-dialog-heading">
          <div>
            <p className="eyebrow">SORT YOUR TRANSACTIONS</p>
            <h2 id="category-title">Where does this belong?</h2>
          </div>
          <button
            autoFocus
            aria-label="Close categorization"
            disabled={busy}
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </header>
        {queue && (
          <div className="queue-progress">
            <span>
              {queue.position} of {queue.total} to sort
            </span>
            <button onClick={onSkip} disabled={busy}>
              Skip
            </button>
          </div>
        )}
        {sortingCard}
      </div>
      <div
        ref={optionsScroller}
        className="category-options-scroll"
        aria-label="Category choices"
      >
        {t.kind === "split_parent" && !t.isReviewed && (
          <div className="notice">
            <p>
              This payment already has split categories. Keep them and confirm
              the payment, or open its details to change the split.
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  if (!(await authorizeMonthEdit([t]))) return;
                  const { markTransactionsReviewed } =
                    await import("../storage/accuracy");
                  const receipt = await markTransactionsReviewed([t.id]);
                  const after = await db.transactions.get(t.id);
                  if (!after)
                    throw new Error(
                      "This transaction changed. Reopen the sorting queue.",
                    );
                  await onSaved({
                    before: [t],
                    after: [after],
                    selectedIds: [t.id],
                    categoryName: "Split reviewed",
                    changeId: receipt.changeId,
                  });
                } catch (exception) {
                  setError(
                    exception instanceof Error
                      ? exception.message
                      : "The split could not be reviewed.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Keep this split · Mark reviewed
            </button>
          </div>
        )}
        <p className="muted" id="drag-help">
          Choose a category. Matching payments in this account and future
          imports follow your choice.
          {selection && selection.length > 1
            ? ` ${selection.length} selected transactions.`
            : others.length
              ? ` Also applies to ${others.length} matching payment${others.length === 1 ? "" : "s"}.`
              : ""}
        </p>
        <p className="desktop-only keyboard-hints">
          Keyboard: <kbd>1</kbd>–<kbd>3</kbd> suggestions
          {onMove && (
            <>
              {" "}
              · <kbd>J</kbd>/<kbd>K</kbd> next/previous
            </>
          )}
          {onUndo && (
            <>
              {" "}
              · <kbd>⌘Z</kbd> Undo
            </>
          )}
        </p>
        {suggested.length > 0 && (
          <section
            className="suggested-categories"
            aria-label="Suggested categories"
          >
            <h3>Likely categories</h3>
            <div className="category-tile-grid">
              {suggested.map((c, index) => tile(c, index))}
            </div>
          </section>
        )}
        {feedback}
        {conflict && (
          <section className="notice warning" aria-label="Saved rule conflict">
            <p>
              A saved rule uses{" "}
              {conflict.rule.type === "transfer" ||
              conflict.rule.actions?.some(
                (action) =>
                  action.type === "kind" &&
                  (action.kind === "transfer" ||
                    action.kind === "card_repayment"),
              )
                ? "Transfer"
                : (categories.find(
                    (category) =>
                      category.id ===
                      (conflict.rule.actions?.find(
                        (action) => action.type === "category",
                      )?.categoryId ?? conflict.rule.categoryId),
                  )?.name ?? "another category")}{" "}
              for this merchant. Update future matching payments, or change only
              this payment?
            </p>
            <div className="accuracy-actions">
              <button
                disabled={busy}
                onClick={() => void choose(conflict.categoryId, "update")}
              >
                Update rule
              </button>
              <button
                disabled={busy}
                onClick={() => void choose(conflict.categoryId, "once")}
              >
                Just this payment
              </button>
              <button disabled={busy} onClick={() => setConflict(undefined)}>
                Cancel
              </button>
            </div>
          </section>
        )}
        <h3>Not spending</h3>
        <button
          className={`transfer-tile ${target === TRANSFER_TARGET ? "drop-target" : ""}`}
          data-category-target={TRANSFER_TARGET}
          aria-label="Categorize as Transfer"
          disabled={busy}
          onClick={() => void choose(TRANSFER_TARGET)}
        >
          <span aria-hidden="true">↔</span>
          <span>
            <strong>Transfer</strong>
            <small>Between your own accounts</small>
          </span>
        </button>
        <button
          className={`transfer-tile ${target === CARD_REPAYMENT_TARGET ? "drop-target" : ""}`}
          data-category-target={CARD_REPAYMENT_TARGET}
          disabled={busy}
          onClick={() => void choose(CARD_REPAYMENT_TARGET)}
          aria-label="Categorize as Card repayment"
        >
          <span>
            <strong>Card repayment</strong>
            <small>
              Payment to your own credit card; excluded from spending
            </small>
          </span>
        </button>
        {t.amount > 0 && (
          <button
            className={`transfer-tile ${target === "refund" ? "drop-target" : ""}`}
            data-category-target="refund"
            disabled={busy}
            onClick={() => void choose("refund")}
          >
            <span>
              <strong>Refund of…</strong>
              <small>Reduce the original purchase month, never income</small>
            </span>
          </button>
        )}
        <h3>More</h3>
        {!t.parentId && !t.isTransfer && (
          <button
            className="transfer-tile"
            data-category-target="__split"
            disabled={busy}
            onClick={() => setAccuracyMode("split")}
          >
            Split between categories
          </button>
        )}
        <button
          className="transfer-tile"
          disabled={busy}
          onClick={() => setShowTags((value) => !value)}
          aria-expanded={showTags}
        >
          Add tag
        </button>
        {showTags && <TagPicker value={tags} onChange={setTags} />}
        <h3>All categories</h3>
        <input
          aria-label="Find a category"
          type="search"
          placeholder="Find a category…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div
          className="category-tile-grid"
          aria-label="Categories"
          aria-busy={busy}
        >
          {available
            .filter((c) => !suggested.some((s) => s.id === c.id))
            .map((c) => tile(c))}
          {!available.length && <p>No matching categories.</p>}
        </div>
        {error && (
          <p className="notice warning" role="alert">
            {error}
          </p>
        )}
      </div>
      <Link
        className="sort-details"
        to={`/transactions/${t.id}`}
        state={{ returnTo: returnTo ?? location.pathname + location.search }}
        aria-disabled={busy || undefined}
        onClick={(event) => {
          if (busy) event.preventDefault();
          else onClose();
        }}
      >
        View transaction details
      </Link>
      {accuracyMode && (
        <TransactionAccuracy
          transaction={t}
          categories={categories}
          initialMode={accuracyMode}
          onClose={() => setAccuracyMode(undefined)}
          onChanged={async (change) => {
            const after = await db.transactions.get(t.id);
            if (!after) return;
            await onSaved({
              before: [t],
              after: [after],
              selectedIds: [t.id],
              changeId: change.changeId,
              categoryName: accuracyMode === "refund" ? "Refund" : "Split",
              splitRuleOffer: change.splitRuleOffer,
            });
          }}
        />
      )}
    </dialog>
  );
}
