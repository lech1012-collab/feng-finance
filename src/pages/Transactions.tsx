import { useState, useMemo, useRef, useEffect, type MouseEvent } from "react";
import { financialType } from "../domain/transaction-type";
import { useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Search, SlidersHorizontal } from "lucide-react";
import { CategoryBoard } from "../components/CategoryBoard";
import { SwipeTransaction } from "../components/SwipeTransaction";
import type { Transaction } from "../domain/models";
import {
  undoCategory,
  categorizeCards,
  TRANSFER_TARGET,
  type CategoryReceipt,
} from "../storage/categorize";
import { db } from "../storage/database";
import { monthBounds } from "../domain/dates";
import { money, parseMoney } from "../domain/money";
import { accountSnapshot } from "../analytics/balances";
import { statementBalanceEvidence } from "../analytics/statement-balances";
import {
  displayDate,
  displayDateRange,
  displayMerchant,
} from "../domain/presentation";
import { categoryColor } from "../domain/palette";
import { transferKind } from "../analytics/home-summary";
import {
  categorySuggestions,
  categorySuggestionReason,
} from "../categorization/suggestions";
const needsCategory = (t: Transaction) =>
  !t.categoryId && !t.subcategoryId && financialType(t) !== "transfer";
export default function Transactions({
  month,
  currency,
}: {
  month: string;
  currency: string;
}) {
  const [params] = useSearchParams();
  const [sorting, setSorting] = useState<Transaction>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionAnchor = useRef<string | undefined>(undefined);
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const queueScope = useRef<string[]>([]);
  const skippedQueueIds = useRef(new Set<string>());
  const [queueBusy, setQueueBusy] = useState(false);
  const movingQueue = useRef(false);
  const queueKey = JSON.stringify(queueIds);
  const queueRecords = useLiveQuery(
    async () => ({
      key: queueKey,
      rows: (await db.transactions.bulkGet(queueIds)).filter(
        (row): row is Transaction => !!row && needsCategory(row),
      ),
    }),
    [queueKey],
  );
  const [railDrag, setRailDrag] = useState<{
    ids: string[];
    pointerId: number;
    x: number;
    y: number;
  }>();
  const [railTarget, setRailTarget] = useState("");
  const categoryRail = useRef<HTMLElement>(null);
  const railCursor = useRef({ x: 0, y: 0 });
  const activeRailDrag = useRef(false);
  const [railBusy, setRailBusy] = useState(false);
  const [railError, setRailError] = useState("");
  const railSaving = useRef(false);
  const autoQueueStarted = useRef(false);
  const [dragStart, setDragStart] = useState<{
    x: number;
    y: number;
    pointerId: number;
  }>();
  const [receipt, setReceipt] = useState<CategoryReceipt>();
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoError, setUndoError] = useState("");
  const selectedMonth = params.get("month") ?? month;
  const bounds = monthBounds(selectedMonth);
  const [allDates, setAllDates] = useState(
    params.get("allDates") === "1" ||
      (!params.has("allDates") &&
        (params.has("uncategorized") ||
          params.get("category") === "uncategorized")),
  );
  const [from, setFrom] = useState(
    /^\d{4}-\d{2}-\d{2}$/.test(params.get("from") ?? "")
      ? params.get("from")!
      : bounds[0],
  );
  const [to, setTo] = useState(
    /^\d{4}-\d{2}-\d{2}$/.test(params.get("to") ?? "")
      ? params.get("to")!
      : new Date(Date.parse(bounds[1]) - 86400000).toISOString().slice(0, 10),
  );
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [account, setAccount] = useState(params.get("account") ?? "");
  const [category, setCategory] = useState(params.get("category") ?? "");
  const [type, setType] = useState(params.get("type") ?? "");
  const [uncategorized, setUncategorized] = useState(
    params.has("uncategorized") || category === "uncategorized",
  );
  const [property, setProperty] = useState(params.get("property") === "1");
  const [min, setMin] = useState(params.get("min") ?? "");
  const [max, setMax] = useState(params.get("max") ?? "");
  const [page, setPage] = useState(0);
  const [advanced, setAdvanced] = useState(params.get("advanced") === "1");
  const data = useLiveQuery(async () => {
    const accounts = await db.accounts
      .where("currency")
      .equals(currency)
      .toArray();
    const statements = await db.statements.toArray();
    const candidateStatements = accounts
      .map((a) => accountSnapshot(a, statements, selectedMonth).statement)
      .filter((s) => !!s);
    const statementIds = Array.from(
      new Set(candidateStatements.map((s) => s.id)),
    );
    const balanceRows = (
      await Promise.all(
        statementIds.map((id) =>
          db.transactions.where("statementId").equals(id).toArray(),
        ),
      )
    ).flat();
    return {
      items:
        allDates || (from && to && from <= to)
          ? await db.transactions
              .where("[currency+date]")
              .between(
                [currency, allDates ? "0000" : from],
                [currency, allDates ? "9999" : to],
                true,
                true,
              )
              .reverse()
              .toArray()
          : [],
      accounts,
      categories: await db.categories.toArray(),
      rules: await db.rules.toArray(),
      statements,
      balanceEvidence: Object.fromEntries(
        candidateStatements.map((statement) => [
          statement.id,
          statementBalanceEvidence(statement, balanceRows),
        ]),
      ),
      uncategorizedCount: await db.transactions
        .where("[currency+date]")
        .between([currency, "0000"], [currency, "9999"], true, true)
        .filter(needsCategory)
        .count(),
    };
  }, [from, to, currency, allDates, selectedMonth]);
  const filtered = useMemo(() => {
    if (!data) return [];
    let minAmount: number | undefined, maxAmount: number | undefined;
    try {
      minAmount = min ? Math.abs(parseMoney(min, currency)) : undefined;
      maxAmount = max ? Math.abs(parseMoney(max, currency)) : undefined;
    } catch {
      return [];
    }
    return data.items.filter(
      (t) =>
        (!search ||
          `${t.description} ${t.merchant} ${t.tags.join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase())) &&
        (!account || t.accountId === account) &&
        (!category ||
          category === "uncategorized" ||
          t.categoryId === category ||
          t.subcategoryId === category) &&
        (!type || financialType(t) === type) &&
        (!params.get("transferKind") ||
          transferKind(t, data.accounts, data.items) ===
            (params.get("transferKind") === "card-payment"
              ? "card"
              : params.get("transferKind"))) &&
        (!uncategorized ||
          (!t.categoryId &&
            !t.subcategoryId &&
            !t.isTransfer &&
            t.type !== "transfer" &&
            !t.transferPairId)) &&
        (!property ||
          t.categoryId === "property" ||
          t.categoryId === "property-income") &&
        (minAmount === undefined || Math.abs(t.amount) >= minAmount) &&
        (maxAmount === undefined || Math.abs(t.amount) <= maxAmount),
    );
  }, [
    data,
    search,
    account,
    category,
    type,
    uncategorized,
    property,
    min,
    max,
    currency,
    params,
  ]);
  const reset = () => setPage(0);
  const beginSort = (
    t: Transaction,
    start?: { x: number; y: number; pointerId: number },
  ) => {
    setUndoError("");
    if (start && window.matchMedia("(min-width: 1100px)").matches) {
      queueScope.current = [];
      skippedQueueIds.current.clear();
      setQueueIds([]);
      railCursor.current = { x: start.x, y: start.y };
      activeRailDrag.current = true;
      setRailDrag({
        ...start,
        ids: selectedIds.includes(t.id) ? selectedIds : [t.id],
      });
      return;
    }
    setDragStart(start);
    const pool =
      !start && needsCategory(t) ? filtered.filter(needsCategory) : [];
    queueScope.current = pool.map((p) => p.id);
    skippedQueueIds.current.clear();
    setQueueIds(pool.map((p) => p.id));
    setQueueIndex(
      Math.max(
        0,
        pool.findIndex((p) => p.id === t.id),
      ),
    );
    setSorting(t);
  };
  const moveQueue = async (direction: -1 | 1, removedIds: string[] = []) => {
    if (movingQueue.current) return;
    movingQueue.current = true;
    setQueueBusy(true);
    try {
      // A completed save can precede Dexie's list refresh. Read committed
      // records so backfilled, deleted or externally categorized rows do not
      // remain in the progress denominator or reappear as the next card.
      const pending = (await db.transactions.bulkGet(queueIds)).filter(
        (p): p is Transaction =>
          !!p && needsCategory(p) && !removedIds.includes(p.id),
      );
      const current = Math.max(0, queueIds.indexOf(sorting?.id ?? ""));
      for (let step = 1; step <= queueIds.length; step++) {
        const id =
          queueIds[
            (current + direction * step + queueIds.length * 2) % queueIds.length
          ];
        const next = pending.find((p) => p.id === id);
        if (next) {
          setQueueIds(pending.map((p) => p.id));
          setQueueIndex(pending.findIndex((p) => p.id === id));
          setSorting(next);
          return;
        }
      }
      setSorting(undefined);
      setQueueIds([]);
    } catch (err) {
      setUndoError(
        err instanceof Error ? err.message : "Queue could not be refreshed.",
      );
    } finally {
      movingQueue.current = false;
      setQueueBusy(false);
    }
  };
  useEffect(() => {
    if (
      !sorting ||
      !queueIds.length ||
      queueBusy ||
      undoBusy ||
      queueRecords?.key !== queueKey
    )
      return;
    const pending = queueRecords.rows;
    const ids = pending.map((p) => p.id);
    if (JSON.stringify(ids) !== queueKey) setQueueIds(ids);
    if (!pending.length) {
      setSorting(undefined);
      return;
    }
    const index = pending.findIndex((p) => p.id === sorting.id);
    const nextIndex =
      index < 0 ? Math.min(queueIndex, pending.length - 1) : index;
    setQueueIndex(nextIndex);
    if (JSON.stringify(sorting) !== JSON.stringify(pending[nextIndex]))
      setSorting(pending[nextIndex]);
  }, [
    queueRecords,
    queueKey,
    sorting,
    queueIds.length,
    queueIndex,
    queueBusy,
    undoBusy,
  ]);
  const applyToSelection = async (ids: string[], categoryId: string) => {
    if (!data || railSaving.current) return;
    railSaving.current = true;
    setRailBusy(true);
    setRailError("");
    try {
      const chosen = ids.map((id) => data.items.find((t) => t.id === id));
      if (chosen.some((t) => !t))
        throw new Error(
          "A selected transaction is no longer shown. Select it again.",
        );
      const result = await categorizeCards(
        chosen as Transaction[],
        categoryId,
        { allowMultipleMerchants: true, backfill: true },
      );
      queueScope.current = [];
      skippedQueueIds.current.clear();
      setQueueIds([]);
      setReceipt(result);
      setSelectedIds([]);
      setSorting(undefined);
      setDragStart(undefined);
    } catch (err) {
      setRailError(
        err instanceof Error ? err.message : "Category could not be saved.",
      );
    } finally {
      railSaving.current = false;
      setRailBusy(false);
    }
  };
  const undo = async () => {
    if (!receipt || undoBusy) return;
    setUndoBusy(true);
    setUndoError("");
    try {
      await undoCategory(receipt);
      // Restore the queue from the same committed records as the atomic Undo,
      // including any matching payments removed by the previous backfill.
      // Skipped cards remain deferred for this sorting session.
      const scope = queueScope.current.length
        ? queueScope.current
        : receipt.before.filter(needsCategory).map((t) => t.id);
      const pending = (await db.transactions.bulkGet(scope)).filter(
        (t): t is Transaction =>
          !!t && needsCategory(t) && !skippedQueueIds.current.has(t.id),
      );
      const restored =
        pending.find((t) => t.id === receipt.before[0].id) ?? pending[0];
      setQueueIds(pending.map((t) => t.id));
      setQueueIndex(
        restored ? pending.findIndex((t) => t.id === restored.id) : 0,
      );
      setSorting(restored ?? receipt.before[0]);
      setReceipt(undefined);
    } catch (err) {
      setUndoError(err instanceof Error ? err.message : "Undo failed.");
    } finally {
      setUndoBusy(false);
    }
  };
  useEffect(() => {
    if (!data || autoQueueStarted.current || params.get("sort") !== "1") return;
    autoQueueStarted.current = true;
    const first = filtered.find(needsCategory);
    if (first) beginSort(first);
  });
  useEffect(() => {
    if (!railDrag) return;
    const hit = (x: number, y: number) => {
      const target = document
        .elementFromPoint(x, y)
        ?.closest<HTMLButtonElement>("[data-rail-category]");
      return target && !target.disabled
        ? (target.dataset.railCategory ?? "")
        : "";
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId === railDrag.pointerId) {
        railCursor.current = { x: e.clientX, y: e.clientY };
        setRailTarget(hit(e.clientX, e.clientY));
        setRailDrag((p) =>
          p ? { ...p, x: e.clientX, y: e.clientY } : undefined,
        );
      }
    };
    const release = (e: PointerEvent) => {
      if (e.pointerId !== railDrag.pointerId) return;
      activeRailDrag.current = false;
      const target = e.type === "pointerup" ? hit(e.clientX, e.clientY) : "";
      setRailDrag(undefined);
      setRailTarget("");
      if (target) void applyToSelection(railDrag.ids, target);
    };
    const cancel = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        activeRailDrag.current = false;
        setRailDrag(undefined);
        setRailTarget("");
      }
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("keydown", cancel);
    };
  });
  useEffect(() => {
    if (railDrag?.pointerId === undefined) return;
    let frame = 0;
    const scroll = () => {
      if (!activeRailDrag.current) return;
      const rail = categoryRail.current;
      if (rail) {
        const rect = rail.getBoundingClientRect();
        const { x, y } = railCursor.current;
        const top = Math.max(0, rect.top);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        const withinRail =
          x >= rect.left &&
          x <= rect.right &&
          bottom > top &&
          y >= top - 12 &&
          y <= bottom + 12;
        if (withinRail) {
          const edge = Math.min(64, (bottom - top) / 3);
          const distance =
            y < top + edge
              ? y - (top + edge)
              : y > bottom - edge
                ? y - (bottom - edge)
                : 0;
          const step = Math.max(-14, Math.min(14, distance / 4));
          const previous = rail.scrollTop;
          rail.scrollTop = Math.max(
            0,
            Math.min(rail.scrollHeight - rail.clientHeight, previous + step),
          );
          if (rail.scrollTop !== previous) {
            const target = document
              .elementFromPoint(x, y)
              ?.closest<HTMLButtonElement>("[data-rail-category]");
            setRailTarget(
              target && !target.disabled
                ? (target.dataset.railCategory ?? "")
                : "",
            );
          }
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [railDrag?.pointerId]);
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (
        sorting ||
        !(e.metaKey || e.ctrlKey) ||
        e.key.toLowerCase() !== "z" ||
        (e.target instanceof HTMLElement &&
          e.target.closest("input,textarea,select"))
      )
        return;
      e.preventDefault();
      void undo();
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });
  const selectRow = (t: Transaction, event: MouseEvent<HTMLElement>) => {
    if (event.shiftKey && selectionAnchor.current) {
      const start = filtered.findIndex((p) => p.id === selectionAnchor.current);
      const end = filtered.findIndex((p) => p.id === t.id);
      if (start >= 0) {
        setSelectedIds(
          Array.from(
            new Set([
              ...selectedIds,
              ...filtered
                .slice(Math.min(start, end), Math.max(start, end) + 1)
                .filter((p) => financialType(p) !== "transfer")
                .map((p) => p.id),
            ]),
          ),
        );
        return;
      }
    }
    selectionAnchor.current = t.id;
    setSelectedIds((ids) =>
      ids.includes(t.id) ? ids.filter((id) => id !== t.id) : [...ids, t.id],
    );
  };
  const totalPages = Math.max(1, Math.ceil(filtered.length / 60));
  const currentPage = Math.min(page, totalPages - 1);
  const items = filtered.slice(currentPage * 60, (currentPage + 1) * 60);
  const railSelection = (railDrag?.ids ?? selectedIds)
    .map((id) => data?.items.find((t) => t.id === id))
    .filter((t): t is Transaction => !!t);
  const railSubject = railSelection[0];
  const railSuggestions =
    railSubject && data
      ? categorySuggestions(
          railSubject,
          data.categories,
          data.rules,
          data.items,
        ).filter(
          (c) =>
            c.kind !== "income" || railSelection.every((t) => t.amount >= 0),
        )
      : [];
  const returnParams = new URLSearchParams({
    month: selectedMonth,
    allDates: allDates ? "1" : "0",
    from,
    to,
  });
  for (const [key, value] of Object.entries({
    category,
    account,
    search,
    type,
    min,
    max,
    uncategorized: uncategorized ? "1" : "",
    property: property ? "1" : "",
    advanced: advanced ? "1" : "",
    transferKind: params.get("transferKind") ?? "",
  }))
    if (value) returnParams.set(key, value);
  const returnTo = `/transactions?${returnParams}`;
  const quickFilterSelected = (filter: string) => {
    if (filter === "uncategorized") return uncategorized;
    if (uncategorized) return false;
    if (filter === "property") return property || category === "property";
    if (filter === "income") return type === "income" && !category && !property;
    return category === filter && !type && !property;
  };
  const feedback = (
    <>
      {receipt && (
        <div className="category-feedback" role="status">
          <span>
            {receipt.categoryName} ·{" "}
            {receipt.learning?.length === 1
              ? `${displayMerchant({ merchant: receipt.learning[0].merchant, description: receipt.learning[0].merchant })} on ${data?.accounts.find((a) => a.id === receipt.learning![0].accountId)?.institution ?? "this account"}`
              : `${receipt.learning?.length ?? 1} merchants`}
            {receipt.after.length > (receipt.selectedIds?.length ?? 1)
              ? ` · also applied to ${receipt.after.length - (receipt.selectedIds?.length ?? 1)} matching payment${receipt.after.length - (receipt.selectedIds?.length ?? 1) === 1 ? "" : "s"}`
              : ""}
            {receipt.rule
              ? ". Future matching payments will follow."
              : ". Saved on this device."}
          </span>
          <button disabled={undoBusy} onClick={() => void undo()}>
            Undo
          </button>
        </div>
      )}
      {undoError && (
        <p role="alert" className="notice warning">
          {undoError}
        </p>
      )}
    </>
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Transactions</h1>
        </div>
        <span className="count-chip">
          {data
            ? `${filtered.length} results · ${currency}`
            : "Loading transactions…"}
        </span>
      </div>
      {data && (
        <div
          className="account-filter-chips"
          role="group"
          aria-label="Filter by account"
        >
          <button
            className="account-filter-chip"
            aria-pressed={!account}
            onClick={() => {
              setAccount("");
              reset();
            }}
          >
            All accounts
          </button>
          {data.accounts.map((a) => {
            const snapshot = accountSnapshot(a, data.statements, selectedMonth);
            const evidence = snapshot.statement
              ? data.balanceEvidence[snapshot.statement.id]
              : undefined;
            const reported = Number.isSafeInteger(snapshot.balance);
            const card = a.accountType === "credit";
            const value = reported
              ? money(
                  card ? Math.abs(snapshot.balance!) : snapshot.balance!,
                  currency,
                )
              : "Unknown";
            const kind =
              card && reported
                ? snapshot.balance! < 0
                  ? " debt"
                  : snapshot.balance! > 0
                    ? " credit"
                    : " balance"
                : "";
            return (
              <button
                key={a.id}
                className="account-filter-chip"
                aria-pressed={account === a.id}
                onClick={() => {
                  setAccount(account === a.id ? "" : a.id);
                  reset();
                }}
              >
                <strong>
                  {a.institution} · {a.maskedAccountIdentifier}
                </strong>
                <span>
                  {`${value}${kind}${snapshot.asOfDate ? ` · ${displayDate(snapshot.asOfDate)}` : " · No statement"}${reported && evidence?.status !== "reconciled" ? " · Reported · Unverified" : reported && !snapshot.current ? " · Older statement" : ""}`}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <section className="card filters">
        <div className="search-line">
          <label className="search-input">
            <Search size={18} />
            <span className="sr-only">Search transactions</span>
            <input
              type="search"
              placeholder="Search merchant, description or tag"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                reset();
              }}
            />
          </label>
          <button
            aria-expanded={advanced}
            onClick={() => setAdvanced(!advanced)}
          >
            <SlidersHorizontal size={17} />
            Filters
          </button>
        </div>
        <div
          className="category-filter-buttons"
          role="group"
          aria-label="Transaction category filters"
        >
          {[
            { id: "uncategorized", name: "Uncategorized" },
            { id: "groceries", name: "Groceries" },
            { id: "income", name: "Income" },
            { id: "property", name: "Property" },
            { id: "salary", name: "Salary" },
          ].map((c) => (
            <button
              key={c.id}
              aria-pressed={quickFilterSelected(c.id)}
              className={
                c.id === "uncategorized" ? "uncategorized-primary" : undefined
              }
              onClick={() => {
                const clear = quickFilterSelected(c.id);
                setCategory(
                  !clear && ["groceries", "salary"].includes(c.id) ? c.id : "",
                );
                setUncategorized(!clear && c.id === "uncategorized");
                setType(!clear && c.id === "income" ? "income" : "");
                setProperty(!clear && c.id === "property");
                if (!clear && c.id === "uncategorized") {
                  setAllDates(true);
                  setAccount("");
                  setSearch("");
                  setMin("");
                  setMax("");
                }
                reset();
              }}
            >
              {c.name}
              {c.id === "uncategorized"
                ? ` ${data?.uncategorizedCount ?? "…"}`
                : ""}
            </button>
          ))}
        </div>
        <div
          className="date-scope"
          role="group"
          aria-label="Transaction date range"
        >
          <button
            aria-pressed={allDates}
            onClick={() => {
              setAllDates(true);
              reset();
            }}
          >
            All dates
          </button>
          <button
            aria-pressed={!allDates}
            onClick={() => {
              setAllDates(false);
              reset();
            }}
          >
            Date range
          </button>
        </div>
        <p className="filter-context">
          {allDates ? "All imported dates" : displayDateRange(from, to)}
          {category && category !== "uncategorized"
            ? ` · ${data?.categories.find((c) => c.id === category)?.name ?? ""}`
            : ""}
        </p>
        {advanced && (
          <div className="form-grid">
            <label>
              From
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setAllDates(false);
                  setFrom(e.target.value);
                  reset();
                }}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={to}
                onChange={(e) => {
                  setAllDates(false);
                  setTo(e.target.value);
                  reset();
                }}
              />
            </label>
            <label>
              Category
              <select
                aria-label="Filter category"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setUncategorized(e.target.value === "uncategorized");
                  if (e.target.value === "uncategorized") setAllDates(true);
                  reset();
                }}
              >
                <option value="">All categories</option>
                <option value="uncategorized">Uncategorized</option>
                {data?.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parentId ? "↳ " : ""}
                    {c.name}
                    {c.archived ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Account
              <select
                aria-label="Account"
                value={account}
                onChange={(e) => {
                  setAccount(e.target.value);
                  reset();
                }}
              >
                <option value="">All accounts</option>
                {data?.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.institution} · {a.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {advanced && (
          <>
            <div className="form-grid">
              <label>
                Type
                <select
                  aria-label="Type"
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value);
                    reset();
                  }}
                >
                  <option value="">All types</option>
                  {["income", "expense", "transfer"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Minimum absolute amount
                <input
                  inputMode="decimal"
                  value={min}
                  onChange={(e) => {
                    setMin(e.target.value);
                    reset();
                  }}
                  placeholder="0.00"
                />
              </label>
              <label>
                Maximum absolute amount
                <input
                  inputMode="decimal"
                  value={max}
                  onChange={(e) => {
                    setMax(e.target.value);
                    reset();
                  }}
                  placeholder="No maximum"
                />
              </label>
            </div>
            <div className="actions">
              <label className="check">
                <input
                  type="checkbox"
                  checked={uncategorized}
                  onChange={(e) => {
                    setUncategorized(e.target.checked);
                    setCategory(e.target.checked ? "uncategorized" : "");
                    if (e.target.checked) setAllDates(true);
                    reset();
                  }}
                />
                Uncategorized only
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={property}
                  onChange={(e) => {
                    setProperty(e.target.checked);
                    reset();
                  }}
                />
                Property only
              </label>
            </div>
          </>
        )}
      </section>
      {uncategorized && filtered.length > 0 && (
        <div className="sorting-queue">
          <span>{filtered.length} transactions to sort</span>
          <button className="primary" onClick={() => beginSort(filtered[0])}>
            Start sorting
          </button>
        </div>
      )}
      {selectedIds.length > 0 && (
        <div className="selection-summary">
          <span>{selectedIds.length} selected</span>
          <button onClick={() => setSelectedIds([])}>Clear selection</button>
          <button
            onClick={() => {
              const first = data?.items.find((t) => t.id === selectedIds[0]);
              if (first) {
                queueScope.current = [];
                skippedQueueIds.current.clear();
                setQueueIds([]);
                setSorting(first);
              }
            }}
          >
            Categorize selected
          </button>
        </div>
      )}
      {!sorting && feedback}
      {railError && (
        <p role="alert" className="notice warning">
          {railError}
        </p>
      )}
      {sorting && data && (
        <CategoryBoard
          key={sorting.id}
          transaction={sorting}
          dragStart={dragStart}
          returnTo={returnTo}
          categories={data.categories}
          feedback={feedback}
          navigationBusy={queueBusy || undoBusy}
          selection={
            selectedIds.includes(sorting.id)
              ? data.items.filter((t) => selectedIds.includes(t.id))
              : undefined
          }
          queue={
            queueIds.length
              ? { position: queueIndex + 1, total: queueIds.length }
              : undefined
          }
          onSkip={() => {
            skippedQueueIds.current.add(sorting.id);
            void moveQueue(1, [sorting.id]);
          }}
          onMove={
            queueIds.length
              ? (direction) => void moveQueue(direction)
              : undefined
          }
          onUndo={() => void undo()}
          onClose={() => {
            setSorting(undefined);
            setDragStart(undefined);
            setQueueIds([]);
            queueScope.current = [];
            skippedQueueIds.current.clear();
          }}
          onSaved={async (result) => {
            setDragStart(undefined);
            setReceipt(result);
            setUndoError("");
            setSelectedIds([]);
            if (queueIds.length)
              await moveQueue(
                1,
                result.after.map((t) => t.id),
              );
            else setSorting(undefined);
          }}
        />
      )}
      <div className="transactions-workspace">
        <section className="card transaction-list">
          {items.map((t) => (
            <SwipeTransaction
              key={t.id}
              transaction={t}
              accessibleLabel={`${displayMerchant(t)}, ${displayDate(t.date)}, ${financialType(t) === "transfer" ? "Transfer" : (data?.categories.find((c) => c.id === (t.categoryId ?? t.subcategoryId))?.name ?? "Needs category")}, ${data?.accounts.find((a) => a.id === t.accountId)?.institution ?? "Account"}, ${money(t.amount, t.currency, true)}`}
              returnTo={returnTo}
              selected={selectedIds.includes(t.id)}
              onSelect={(event) => selectRow(t, event)}
              suggestion={
                data
                  ? categorySuggestions(t, data.categories, data.rules, [])[0]
                  : undefined
              }
              onQuickCategorize={(categoryId) =>
                void applyToSelection([t.id], categoryId)
              }
              onCategorize={() => beginSort(t)}
              onDragCategorize={(start) => beginSort(t, start)}
            >
              <div className="transaction-description">
                <strong>{displayMerchant(t)}</strong>
                <span
                  className={`transaction-status ${t.isTransfer || t.type === "transfer" || t.transferPairId ? "transfer" : t.categoryId || t.subcategoryId ? "categorized" : "uncategorized"}`}
                >
                  <span
                    className="category-dot"
                    style={{
                      backgroundColor:
                        financialType(t) === "transfer"
                          ? "var(--chart-transfer)"
                          : t.categoryId
                            ? categoryColor(t.categoryId)
                            : "transparent",
                    }}
                    aria-hidden="true"
                  />
                  {t.isTransfer || t.type === "transfer" || t.transferPairId
                    ? "Transfer"
                    : t.categoryId || t.subcategoryId
                      ? (data?.categories.find(
                          (c) => c.id === (t.categoryId ?? t.subcategoryId),
                        )?.name ?? "Category unavailable")
                      : "Needs category"}
                </span>
                {t.categorySource && (
                  <small className="transaction-origin">
                    {t.categorySource === "manual" ? "you" : "rule"}
                  </small>
                )}
                <span>
                  {displayDate(t.date)} ·{" "}
                  {
                    data?.accounts.find((a) => a.id === t.accountId)
                      ?.institution
                  }
                </span>
              </div>
              <strong
                className={
                  t.amount > 0 && financialType(t) !== "transfer"
                    ? "positive"
                    : financialType(t) === "transfer"
                      ? "transfer-amount"
                      : "spending-amount"
                }
              >
                {money(t.amount, t.currency, true)}
              </strong>
            </SwipeTransaction>
          ))}
          {data && !items.length && (
            <div className="empty">
              <h2>No transactions found</h2>
              <p>Adjust the filters or import a statement for this period.</p>
            </div>
          )}
        </section>
        {data && (
          <aside
            ref={categoryRail}
            className="category-rail card"
            aria-label="Category drop targets"
          >
            <h2>Categories</h2>
            <p className="muted">
              Drag a transaction here. Select several with Shift or ⌘ click.
            </p>
            {selectedIds.length > 0 && <p>{selectedIds.length} selected</p>}
            <section
              className="rail-suggestions"
              aria-label="Suggested categories for selection"
            >
              <h3>Likely categories</h3>
              {railSubject ? (
                <p className="muted">
                  For {displayMerchant(railSubject)}
                  {railSelection.length > 1
                    ? " · first selected transaction"
                    : ""}
                </p>
              ) : (
                <p className="muted">
                  Select or drag a transaction to see suggestions.
                </p>
              )}
              {railSubject &&
                railSuggestions.map((c) => (
                  <button
                    key={c.id}
                    className={`rail-tile rail-suggestion ${railTarget === c.id ? "drop-target" : ""}`}
                    data-rail-category={c.id}
                    aria-label={`Suggested ${c.name}`}
                    disabled={railBusy}
                    onClick={() => void applyToSelection(selectedIds, c.id)}
                  >
                    <span
                      className="category-dot"
                      style={{ backgroundColor: categoryColor(c.id) }}
                      aria-hidden="true"
                    />
                    <span>
                      {c.name}
                      <small>
                        {categorySuggestionReason(
                          railSubject,
                          c,
                          data.rules,
                          data.items,
                        )}
                      </small>
                    </span>
                  </button>
                ))}
              {railSubject && !railSuggestions.length && (
                <p className="muted">
                  No strong match. Choose a category below.
                </p>
              )}
            </section>
            <h3>All categories</h3>
            <button
              className={`rail-tile ${railTarget === TRANSFER_TARGET ? "drop-target" : ""}`}
              data-rail-category={TRANSFER_TARGET}
              disabled={railBusy || (!railDrag && !selectedIds.length)}
              onClick={() =>
                void applyToSelection(selectedIds, TRANSFER_TARGET)
              }
            >
              Transfer / card repayment
            </button>
            {data.categories
              .filter((c) => !c.archived && !c.parentId)
              .map((c) => (
                <button
                  key={c.id}
                  className={`rail-tile ${railTarget === c.id ? "drop-target" : ""}`}
                  data-rail-category={c.id}
                  disabled={
                    railBusy ||
                    (!railDrag && !selectedIds.length) ||
                    (c.kind === "income" &&
                      railSelection.some((t) => t.amount < 0))
                  }
                  title={
                    c.kind === "income" &&
                    railSelection.some((t) => t.amount < 0)
                      ? "Income categories require money in. This selection includes money out."
                      : undefined
                  }
                  onClick={() => void applyToSelection(selectedIds, c.id)}
                >
                  <span
                    className="category-dot"
                    style={{ backgroundColor: categoryColor(c.id) }}
                    aria-hidden="true"
                  />
                  {c.name}
                </button>
              ))}
          </aside>
        )}
      </div>
      {railDrag && (
        <div
          className="sorting-card is-dragging rail-drag-preview"
          style={{
            position: "fixed",
            left: railDrag.x + 12,
            top: railDrag.y + 12,
            pointerEvents: "none",
            zIndex: 1000,
          }}
          aria-hidden="true"
        >
          {railDrag.ids.length > 1
            ? `${railDrag.ids.length} transactions`
            : displayMerchant(
                data?.items.find((t) => t.id === railDrag.ids[0]) ?? {
                  merchant: "Transaction",
                  description: "",
                },
              )}
        </div>
      )}
      <div className="pagination">
        <button
          disabled={currentPage === 0}
          onClick={() => setPage(currentPage - 1)}
        >
          Previous
        </button>
        <span>
          Page {currentPage + 1} of {totalPages}
        </span>
        <button
          disabled={currentPage + 1 >= totalPages}
          onClick={() => setPage(currentPage + 1)}
        >
          Next
        </button>
      </div>
    </>
  );
}
