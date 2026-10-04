import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { X, Grip } from "lucide-react";
import type { Transaction, Category } from "../domain/models";
import { money } from "../domain/money";
import {
  categorizeCards,
  matchingUncategorized,
  type CategoryReceipt,
} from "../storage/categorize";
export function CategoryBoard({
  transaction: t,
  categories,
  onClose,
  onSaved,
  feedback,
}: {
  transaction: Transaction;
  categories: Category[];
  onClose: () => void;
  onSaved: (receipt: CategoryReceipt) => void;
  feedback?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [target, setTarget] = useState("");
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState(false);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const matches = useLiveQuery(
    () => matchingUncategorized(t),
    [t.id, t.updatedAt],
  );
  const others = matches?.filter((p) => p.id !== t.id) ?? [];
  const available = categories.filter(
    (c) =>
      !c.archived &&
      (!c.parentId ||
        categories.some((p) => p.id === c.parentId && !p.archived)) &&
      c.kind === (t.amount >= 0 ? "income" : "expense") &&
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
  const choose = async (categoryId: string) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const receipt = await categorizeCards(
        [t, ...(group ? others : [])],
        categoryId,
        remember,
      );
      onSaved(receipt);
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
  return (
    <dialog
      ref={dialog}
      className="category-dialog"
      aria-labelledby="category-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
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
      <p className="muted" id="drag-help">
        Drag the transaction onto a category, or tap a category tile. Changes
        save immediately.
      </p>
      <article
        className={`sorting-card ${dragging ? "is-dragging" : ""}`}
        aria-label={`Drag ${t.merchant} to a category`}
        aria-describedby="drag-help"
        style={{
          transform: `translate(${position.x}px, ${position.y}px)`,
          pointerEvents: dragging ? "none" : undefined,
        }}
        onPointerDown={(e) => {
          if (busy || !e.isPrimary || e.button !== 0) return;
          origin.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const p = origin.current;
          if (!p || p.id !== e.pointerId) return;
          const x = e.clientX - p.x,
            y = e.clientY - p.y;
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
          <strong>{t.merchant || t.description}</strong>
          <small>
            {t.date}
            {group ? ` · ${others.length + 1} transactions` : ""}
          </small>
        </div>
        <strong>{money(t.amount, t.currency, true)}</strong>
      </article>
      {feedback}
      <div className="sort-options">
        {others.length > 0 && (
          <label className="check">
            <input
              type="checkbox"
              checked={group}
              disabled={busy}
              onChange={(e) => setGroup(e.target.checked)}
            />
            Also sort {others.length} uncategorized transactions from this
            merchant in this account
          </label>
        )}
        {!t.isDemo && (
          <label className="check">
            <input
              type="checkbox"
              checked={remember}
              disabled={busy}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Remember this merchant for future imports in this account
          </label>
        )}
      </div>
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
        {available.map((c) => (
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
              style={{ borderColor: c.color }}
            >
              {c.name.slice(0, 1)}
            </span>
            <span>
              {c.parentId && (
                <small>
                  {categories.find((p) => p.id === c.parentId)?.name}
                </small>
              )}
              {c.name}
            </span>
          </button>
        ))}
        {!available.length && <p>No matching categories.</p>}
      </div>
      {error && (
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
      <Link
        className="sort-details"
        to={`/transactions/${t.id}`}
        onClick={onClose}
      >
        View transaction details
      </Link>
    </dialog>
  );
}
