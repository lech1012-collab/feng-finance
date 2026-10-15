import { displayAccountName } from "../domain/presentation";
import { Sheet } from "../components/Sheet";
import { StatusChip } from "../components/UIPrimitives";
import { Link } from "react-router-dom";
import { Toast } from "../components/Toast";
import { ManualTransactionEditor } from "../components/ManualTransactionEditor";
import { AdvancedSearch, queryFromParams } from "../components/AdvancedSearch";
import { BulkTagPicker } from "../components/TagManager";
import { SplitRuleOffer } from "../components/SplitRuleOffer";
import { TransferReview } from "../components/TransferReview";
import {
  needsReview,
  effectiveTransactions,
} from "../analytics/effective-transactions";
import { liabilityTypes } from "../analytics/net-worth";
import { projectedReportingTransactions } from "../analytics/fx";
import {
  refundCountedMonths,
  refundMonthName,
} from "../analytics/refund-impact";
import { markTransactionsReviewed } from "../storage/accuracy";
import { undoChange } from "../storage/audit";
import { useState, useMemo, useRef, useEffect, type MouseEvent } from "react";
import { financialType } from "../domain/transaction-type";
import {
  matchesTransactionCategory,
  matchesTransactionIncome,
  matchesQuickTransactionFilter,
  quickTransactionFilterCounts,
  transactionCategoryIndex,
  type QuickTransactionFilter,
} from "../domain/transaction-filters";
import { useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Search, SlidersHorizontal } from "lucide-react";
import { CategoryBoard } from "../components/CategoryBoard";
import { SwipeTransaction } from "../components/SwipeTransaction";
import type { Transaction, Rule } from "../domain/models";
import {
  CategoryConflictDialog,
  type CategoryConflictDecision,
} from "../components/CategoryConflictDialog";
import { conflictingCategoryRule } from "../categorization/rule-conflict";
import { authorizeMonthEdit } from "../storage/month-review";
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
const needsCategory = needsReview;
export default function Transactions({
  month,
  currency,
}: {
  month: string;
  currency: string;
}) {
  const [params] = useSearchParams();
  const [toReview, setToReview] = useState(params.get("review") === "1");
  const [queryIds, setQueryIds] = useState<Set<string>>();
  const [activeQuery, setActiveQuery] = useState<{
    query: string;
    conditions: import("../domain/models").RuleCondition[];
    match: "all" | "any";
  }>();
  const [reviewChangeId, setReviewChangeId] = useState("");
  const [reviewError, setReviewError] = useState("");
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
  const railAnimationFrame = useRef<number | undefined>(undefined);
  const [railBusy, setRailBusy] = useState(false);
  const [railError, setRailError] = useState("");
  const [railConflict, setRailConflict] = useState<{
    ids: string[];
    categoryId: string;
    rule: Rule;
  }>();
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
        (params.has("review") ||
          params.has("uncategorized") ||
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
  const [uncategorized, setUncategorised] = useState(
    params.has("uncategorized") || category === "uncategorized",
  );
  const [property, setProperty] = useState(params.get("property") === "1");
  const [min, setMin] = useState(params.get("min") ?? "");
  const [max, setMax] = useState(params.get("max") ?? "");
  const [page, setPage] = useState(0);
  const [advanced, setAdvanced] = useState(params.get("advanced") === "1");
  const [viewsTarget, setViewsTarget] = useState<HTMLElement | null>(null);
  const [actionsTarget, setActionsTarget] = useState<HTMLElement | null>(null);
  const data = useLiveQuery(async () => {
    const accounts = await db.accounts.toArray();
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
    const items = params.get("flow")
      ? await db.transactions.toArray()
      : allDates || (from && to && from <= to)
        ? await db.transactions
            .where("date")
            .between(
              allDates ? "0000" : from,
              allDates ? "9999" : to,
              true,
              true,
            )
            .reverse()
            .toArray()
        : [];
    const refundIds = [
      ...new Set(
        items.flatMap((row) =>
          (row.refundAllocations ?? []).map(
            (allocation) => allocation.transactionId,
          ),
        ),
      ),
    ];
    const refundOriginals = (await db.transactions.bulkGet(refundIds)).filter(
      (row): row is Transaction => !!row,
    );
    return {
      items,
      refundOriginals,
      periodRows: await db.transactions
        .where("categoryId")
        .equals("salary")
        .toArray(),
      settings: await db.settings.toArray(),
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
        .filter(
          (t) =>
            !t.parentId &&
            !t.categoryId &&
            !t.isTransfer &&
            t.kind !== "refund" &&
            t.kind !== "split_parent",
        )
        .count(),
      reviewCount: await db.transactions.filter(needsReview).count(),
      tags: await db.tags.toArray(),
      rates: await db.fxRates.toArray(),
    };
  }, [from, to, currency, allDates, selectedMonth, params.get("flow")]);
  const queueRecords = useLiveQuery(
    () =>
      db.transaction("r", db.transactions, async () => ({
        key: queueKey,
        rows: (await db.transactions.bulkGet(queueIds)).filter(
          (row): row is Transaction => !!row && needsCategory(row),
        ),
      })),
    [queueKey, data],
  );
  const searchItems = useMemo(
    () =>
      data && params.get("reporting") === "1"
        ? projectedReportingTransactions(
            effectiveTransactions(data.items),
            currency,
            data.rates ?? [],
          ).transactions
        : (data?.items ?? []),
    [data?.items, data?.rates, currency, params.get("reporting")],
  );
  const categoryIndex = useMemo(
    () => transactionCategoryIndex(data?.items ?? []),
    [data?.items],
  );
  // Counts and visible rows share the same account/search/amount/flow scope.
  // A quick category changes only the second stage of this filtering pipeline.
  const baseFiltered = useMemo(() => {
    if (!data) return [];
    let minAmount: number | undefined, maxAmount: number | undefined;
    try {
      minAmount = min ? Math.abs(parseMoney(min, currency)) : undefined;
      maxAmount = max ? Math.abs(parseMoney(max, currency)) : undefined;
    } catch {
      return [];
    }
    const flow = params.get("flow");
    const sourceIds = flow
      ? new Set(
          effectiveTransactions(data.items)
            .filter(
              (t) =>
                (allDates || (t.date >= from && t.date <= to)) &&
                financialType(t) !== "transfer" &&
                (flow === "income"
                  ? t.amount > 0
                  : flow === "spending"
                    ? t.amount < 0
                    : true),
            )
            .map((t) => t.parentId ?? t.id),
        )
      : undefined;
    return data.items.filter(
      (t) =>
        !t.parentId &&
        (!sourceIds || sourceIds.has(t.id)) &&
        (!params.get("accountScope") ||
          data.accounts.some(
            (a) =>
              a.id === t.accountId &&
              (params.get("accountScope") === "debt"
                ? liabilityTypes.has(a.accountType)
                : !liabilityTypes.has(a.accountType)),
          )) &&
        (!queryIds || queryIds.has(t.id)) &&
        (!search ||
          `${t.description} ${t.merchant} ${t.note ?? ""} ${(t.tags ?? []).join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase())) &&
        (!account || t.accountId === account) &&
        (!params.get("transferKind") ||
          transferKind(t, data.accounts, data.items) ===
            (params.get("transferKind") === "card-payment"
              ? "card"
              : params.get("transferKind"))) &&
        (minAmount === undefined || Math.abs(t.amount) >= minAmount) &&
        (maxAmount === undefined || Math.abs(t.amount) <= maxAmount),
    );
  }, [
    data,
    search,
    account,
    queryIds,
    min,
    max,
    currency,
    params,
    allDates,
    from,
    to,
  ]);
  const quickCounts = useMemo(
    () => quickTransactionFilterCounts(baseFiltered, categoryIndex),
    [baseFiltered, categoryIndex],
  );
  const filtered = useMemo(
    () =>
      baseFiltered.filter(
        (t) =>
          (!toReview || needsReview(t)) &&
          (!category ||
            category === "uncategorized" ||
            matchesTransactionCategory(t, category, categoryIndex)) &&
          (!type ||
            (type === "income"
              ? matchesTransactionIncome(t)
              : financialType(t) === type)) &&
          (!uncategorized ||
            (!t.categoryId &&
              !t.subcategoryId &&
              financialType(t) !== "transfer" &&
              t.kind !== "refund" &&
              t.kind !== "split_parent")) &&
          (!property ||
            matchesQuickTransactionFilter(t, "property", categoryIndex)),
      ),
    [
      baseFiltered,
      categoryIndex,
      toReview,
      category,
      type,
      uncategorized,
      property,
    ],
  );
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
  const applyToSelection = async (
    ids: string[],
    categoryId: string,
    decision?: CategoryConflictDecision,
  ) => {
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
      if (!decision) {
        const rules = await db.rules.toArray();
        const conflict = (chosen as Transaction[])
          .map((transaction) =>
            conflictingCategoryRule(
              transaction,
              { categoryId, isTransfer: categoryId === TRANSFER_TARGET },
              rules,
            ),
          )
          .find((rule) => !!rule);
        if (conflict) {
          setRailConflict({ ids, categoryId, rule: conflict });
          return;
        }
      }
      if (!(await authorizeMonthEdit(chosen as Transaction[]))) return;
      const result = await categorizeCards(
        chosen as Transaction[],
        categoryId,
        {
          allowMultipleMerchants: true,
          backfill: decision !== "once",
          learn: decision !== "once",
        },
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
      if (activeRailDrag.current && e.pointerId === railDrag.pointerId) {
        railCursor.current = { x: e.clientX, y: e.clientY };
        setRailTarget(hit(e.clientX, e.clientY));
        setRailDrag((p) =>
          p ? { ...p, x: e.clientX, y: e.clientY } : undefined,
        );
      }
    };
    const release = (e: PointerEvent) => {
      if (e.pointerId !== railDrag.pointerId) return;
      const wasDragging = activeRailDrag.current;
      activeRailDrag.current = false;
      if (railAnimationFrame.current !== undefined)
        cancelAnimationFrame(railAnimationFrame.current);
      railAnimationFrame.current = undefined;
      const target =
        wasDragging && e.type === "pointerup" ? hit(e.clientX, e.clientY) : "";
      setRailDrag(undefined);
      setRailTarget("");
      if (target) void applyToSelection(railDrag.ids, target);
    };
    const cancel = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        activeRailDrag.current = false;
        if (railAnimationFrame.current !== undefined)
          cancelAnimationFrame(railAnimationFrame.current);
        railAnimationFrame.current = undefined;
        e.preventDefault();
        setRailDrag(undefined);
        setRailTarget("");
      }
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("keydown", cancel, true);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("keydown", cancel, true);
    };
  });
  useEffect(() => {
    if (railDrag?.pointerId === undefined) return;
    let frame = 0;
    const scroll = () => {
      if (!activeRailDrag.current) {
        railAnimationFrame.current = undefined;
        return;
      }
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
      railAnimationFrame.current = frame;
    };
    frame = requestAnimationFrame(scroll);
    railAnimationFrame.current = frame;
    return () => {
      cancelAnimationFrame(frame);
      railAnimationFrame.current = undefined;
    };
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
  const items = filtered.slice(0, (currentPage + 1) * 60);
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
    query: activeQuery?.query ?? params.get("query") ?? "",
    conditions: activeQuery
      ? JSON.stringify(activeQuery.conditions)
      : (params.get("conditions") ?? ""),
    queryMatch: activeQuery?.match ?? params.get("queryMatch") ?? "",
    transferKind: params.get("transferKind") ?? "",
    flow: params.get("flow") ?? "",
    accountScope: params.get("accountScope") ?? "",
    reporting: params.get("reporting") ?? "",
    review: toReview ? "1" : "",
  }))
    if (value) returnParams.set(key, value);
  const returnTo = `/transactions?${returnParams}`;
  const quickFilterSelected = (filter: string) => {
    if (filter === "review") return toReview;
    if (filter === "uncategorized") return uncategorized;
    if (uncategorized) return false;
    if (filter === "property") return property || category === "property";
    if (filter === "income") return type === "income" && !category && !property;
    return category === filter && !type && !property;
  };
  const feedback = (
    <>
      {receipt && (
        <Toast
          id={receipt.changeId ?? receipt.after[0]?.updatedAt}
          message={`${receipt.categoryName} · ${receipt.learning?.length === 1 ? displayMerchant({ merchant: receipt.learning[0].merchant, description: receipt.learning[0].merchant }) : `${receipt.selectedIds?.length ?? 1} payments`}. Future matching payments will follow.`}
          undo={() => undo()}
        />
      )}
      {receipt?.splitRuleOffer && (
        <SplitRuleOffer
          key={receipt.splitRuleOffer.transaction.id}
          {...receipt.splitRuleOffer}
        />
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
            ? `${filtered.length} result${filtered.length === 1 ? "" : "s"}`
            : "Loading transactions…"}
        </span>
      </div>
      {(toReview || uncategorized) && filtered.length > 0 && (
        <div className="sorting-queue">
          <span>
            {filtered.length} transaction{filtered.length === 1 ? "" : "s"} to
            sort
          </span>
          <button className="primary" onClick={() => beginSort(filtered[0])}>
            Start sorting
          </button>
        </div>
      )}
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
            <span className="account-chip-visual">All accounts</span>
          </button>
          {data.accounts.map((a) => {
            const snapshot = accountSnapshot(a, data.statements, selectedMonth);
            const evidence = snapshot.statement
              ? data.balanceEvidence[snapshot.statement.id]
              : undefined;
            const reported = Number.isSafeInteger(snapshot.balance);
            const card = ["credit", "credit_card"].includes(a.accountType);
            const value = reported
              ? money(
                  card ? Math.abs(snapshot.balance!) : snapshot.balance!,
                  a.currency,
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
                <span className="account-chip-visual">
                  <strong>
                    {displayAccountName(a) || `${a.institution} account`}
                  </strong>
                  <small>
                    {`${value}${kind}${snapshot.asOfDate ? ` · ${displayDate(snapshot.asOfDate)}` : " · No statement"}${reported && evidence?.status !== "reconciled" ? " · Reported · Unverified" : reported && !snapshot.current ? " · Older statement" : ""}`}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="transaction-tools">
        <ManualTransactionEditor />
        <Link className="button" to="/accounts">
          Accounts
        </Link>
        <Link className="button" to="/settings?section=tags">
          Tags
        </Link>
      </div>
      <section className="card filters">
        <div className="search-line">
          <div className="search-input">
            <Search size={18} aria-hidden="true" />
            <label className="sr-only" htmlFor="transaction-search">
              Search transactions
            </label>
            <input
              id="transaction-search"
              type="search"
              placeholder="Search merchant, description, note or tag"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                reset();
              }}
            />
            {search && (
              <button
                className="icon-button"
                aria-label="Clear search"
                onClick={() => {
                  setSearch("");
                  reset();
                  document.getElementById("transaction-search")?.focus();
                }}
              >
                ×
              </button>
            )}
          </div>
          <button
            aria-expanded={advanced}
            onClick={() => {
              setAdvanced(!advanced);
            }}
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
            { id: "uncategorized", name: "Uncategorised" },
            { id: "groceries", name: "Groceries" },
            { id: "income", name: "Income" },
            { id: "property", name: "Property" },
            { id: "salary", name: "Salary" },
          ].map((c) => (
            <button
              key={c.id}
              aria-label={
                c.id === "review" || c.id === "uncategorized"
                  ? undefined
                  : c.name
              }
              aria-describedby={
                c.id === "review" || c.id === "uncategorized"
                  ? undefined
                  : `transaction-filter-count-${c.id}`
              }
              aria-pressed={quickFilterSelected(c.id)}
              className={
                c.id === "uncategorized" ? "uncategorized-primary" : undefined
              }
              onClick={() => {
                const clear = quickFilterSelected(c.id);
                setCategory(
                  !clear && ["groceries", "salary"].includes(c.id) ? c.id : "",
                );
                setUncategorised(!clear && c.id === "uncategorized");
                setToReview(!clear && c.id === "review");
                setType(!clear && c.id === "income" ? "income" : "");
                setProperty(!clear && c.id === "property");
                if (!clear && ["uncategorized", "review"].includes(c.id)) {
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
              {c.id === "review" ? (
                ` ${data?.reviewCount ?? "…"}`
              ) : c.id === "uncategorized" ? (
                ` ${data?.uncategorizedCount ?? "…"}`
              ) : (
                <>
                  <span aria-hidden="true">
                    {` ${data ? quickCounts[c.id as QuickTransactionFilter] : "…"}`}
                  </span>
                  <span
                    className="sr-only"
                    id={`transaction-filter-count-${c.id}`}
                  >
                    {data
                      ? `${quickCounts[c.id as QuickTransactionFilter]} matching transaction${quickCounts[c.id as QuickTransactionFilter] === 1 ? "" : "s"}`
                      : "Calculating matching transactions"}
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
        <p className="filter-context">
          {allDates ? "All imported dates" : displayDateRange(from, to)}
        </p>
        <div ref={setViewsTarget} className="saved-view-chips" />
      </section>
      <Sheet
        open={advanced}
        title="Filters"
        onClose={() => setAdvanced(false)}
        footer={
          <button className="primary" onClick={() => setAdvanced(false)}>
            Show {filtered.length} transactions
          </button>
        }
      >
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
        {true && (
          <div className="form-grid">
            {!allDates && (
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
            )}
            {!allDates && (
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
            )}
            <label>
              Category
              <select
                aria-label="Filter category"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setUncategorised(e.target.value === "uncategorized");
                  if (e.target.value === "uncategorized") setAllDates(true);
                  reset();
                }}
              >
                <option value="">All categories</option>
                <option value="uncategorized">Uncategorised</option>
                {data?.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parentId
                      ? `${data?.categories.find((parent) => parent.id === c.parentId)?.name ?? "Category"} · `
                      : ""}
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
        {true && (
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
                    <option key={v} value={v}>
                      {v[0].toUpperCase() + v.slice(1)}
                    </option>
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
            <label className="switch-row">
              <span>Needs review</span>
              <input
                type="checkbox"
                role="switch"
                checked={toReview}
                onChange={(e) => {
                  setToReview(e.target.checked);
                  reset();
                }}
              />
            </label>
          </>
        )}
        {data && (
          <AdvancedSearch
            onQueryStateChange={setActiveQuery}
            viewsTarget={viewsTarget}
            actionsTarget={actionsTarget}
            onOpen={() => setAdvanced(true)}
            onViewSaved={() => setAdvanced(false)}
            exportTransactions={filtered}
            transactions={searchItems}
            sourceTransactions={data.items}
            accounts={data.accounts}
            categories={data.categories}
            tags={data.tags}
            currency={currency}
            {...queryFromParams(params)}
            onChange={(rows) => setQueryIds(new Set(rows.map((t) => t.id)))}
          />
        )}
      </Sheet>
      <TransferReview />
      <details className="transaction-menu">
        <summary>More transaction actions</summary>
        <div className="actions" ref={setActionsTarget}>
          <button
            disabled={!filtered.length}
            onClick={async () => {
              try {
                if (!(await authorizeMonthEdit(filtered))) return;
                const result = await markTransactionsReviewed(
                  filtered.map((t) => t.id),
                );
                setReviewChangeId(result.changeId);
                setReviewError("");
              } catch (e) {
                setReviewError(
                  e instanceof Error ? e.message : "Review could not be saved.",
                );
              }
            }}
          >
            Mark filtered transactions reviewed
          </button>
        </div>
      </details>
      {reviewChangeId && (
        <Toast
          id={reviewChangeId}
          message="Transactions marked reviewed."
          undo={async () => {
            await undoChange(reviewChangeId);
            setReviewChangeId("");
          }}
        />
      )}
      {reviewError && <p role="alert">{reviewError}</p>}
      {selectedIds.length > 0 && <BulkTagPicker transactionIds={selectedIds} />}
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
            Categorise selected
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
              accessibleLabel={`${displayMerchant(t)}, ${displayDate(t.date)}, ${financialType(t) === "transfer" ? "Transfer" : (data?.categories.find((c) => c.id === (t.categoryId ?? t.subcategoryId))?.name ?? "Needs category")}, ${data?.accounts.find((a) => a.id === t.accountId) ? displayAccountName(data.accounts.find((a) => a.id === t.accountId)!) : "Account"}, ${money(t.amount, t.currency, true)}`}
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
                {!t.isReviewed &&
                  (t.categoryId ||
                    t.isTransfer ||
                    t.kind === "refund" ||
                    t.kind === "split_parent") && (
                    <StatusChip className="review-status" tone="warning">
                      To review
                    </StatusChip>
                  )}
                {t.kind === "split_parent" && (
                  <StatusChip className="transaction-status">
                    Split ·{" "}
                    {data?.items.filter((child) => child.parentId === t.id)
                      .length ?? 0}{" "}
                    lines
                  </StatusChip>
                )}
                {t.kind === "refund" && (
                  <StatusChip className="transaction-status">
                    Refund
                    {t.refundAllocations?.length
                      ? ` · counted in ${
                          refundCountedMonths(
                            t,
                            data?.refundOriginals ?? [],
                            data?.settings ?? [],
                            data?.periodRows ?? [],
                          )
                            .map((month) => refundMonthName(month, true))
                            .join(", ") || "original purchase month"
                        }`
                      : " · link a purchase"}
                  </StatusChip>
                )}
                {t.kind !== "split_parent" && t.kind !== "refund" && (
                  <StatusChip
                    tone={
                      !(
                        t.categoryId ||
                        t.subcategoryId ||
                        financialType(t) === "transfer"
                      )
                        ? "warning"
                        : "neutral"
                    }
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
                  </StatusChip>
                )}
                {t.categorySource && (
                  <small className="transaction-origin">
                    {t.categorySource === "manual" ? "Set by you" : "Rule"}
                  </small>
                )}
                <span>
                  {displayDate(t.date)} ·{" "}
                  {data?.accounts.find((a) => a.id === t.accountId)
                    ? displayAccountName(
                        data.accounts.find((a) => a.id === t.accountId)!,
                      )
                    : "Account"}
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
              <h2>
                {search
                  ? `No transactions match “${search}”`
                  : "No transactions found"}
              </h2>
              {search && (
                <button
                  onClick={() => {
                    setSearch("");
                    reset();
                  }}
                >
                  Clear search
                </button>
              )}
              <p>Adjust the filters or import a statement for this period.</p>
            </div>
          )}
        </section>
        {data && (
          <aside
            ref={categoryRail}
            className="category-rail card"
            tabIndex={0}
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
      {items.length > 0 && items.length < filtered.length && (
        <div className="pagination">
          <button
            onClick={() => {
              const firstNew = items.length;
              setPage(currentPage + 1);
              requestAnimationFrame(() =>
                document
                  .querySelectorAll<HTMLElement>(
                    ".transaction-list .transaction-row",
                  )
                  [firstNew]?.focus(),
              );
            }}
          >
            Show more
          </button>
          <span>
            Showing {items.length} of {filtered.length}
          </span>
        </div>
      )}
      {railConflict && (
        <CategoryConflictDialog
          oldCategory={
            railConflict.rule.type === "transfer"
              ? "Transfer"
              : (data?.categories.find(
                  (category) =>
                    category.id ===
                    (railConflict.rule.actions?.find(
                      (action) => action.type === "category",
                    )?.categoryId ?? railConflict.rule.categoryId),
                )?.name ?? "another category")
          }
          newCategory={
            railConflict.categoryId === TRANSFER_TARGET
              ? "Transfer"
              : (data?.categories.find(
                  (category) => category.id === railConflict.categoryId,
                )?.name ?? "Category")
          }
          onCancel={() => setRailConflict(undefined)}
          onDecision={(decision) => {
            const conflict = railConflict;
            setRailConflict(undefined);
            void applyToSelection(conflict.ids, conflict.categoryId, decision);
          }}
        />
      )}
    </>
  );
}
