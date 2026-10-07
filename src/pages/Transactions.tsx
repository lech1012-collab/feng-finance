import { AccountBalances } from "../components/AccountBalances";
import { useState, useMemo } from "react";
import { financialType } from "../domain/transaction-type";
import { useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Search, SlidersHorizontal } from "lucide-react";
import { CategoryBoard } from "../components/CategoryBoard";
import { SwipeTransaction } from "../components/SwipeTransaction";
import type { Transaction } from "../domain/models";
import { undoCategory, type CategoryReceipt } from "../storage/categorize";
import { db } from "../storage/database";
import { monthBounds } from "../domain/dates";
import { money, parseMoney } from "../domain/money";
export default function Transactions({
  month,
  currency,
}: {
  month: string;
  currency: string;
}) {
  const [params] = useSearchParams();
  const [sorting, setSorting] = useState<Transaction>();
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
  const data = useLiveQuery(
    async () => ({
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
      accounts: await db.accounts.where("currency").equals(currency).toArray(),
      categories: await db.categories.toArray(),
      statements: await db.statements.toArray(),
    }),
    [from, to, currency, allDates],
  );
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
  ]);
  const reset = () => setPage(0);
  const totalPages = Math.max(1, Math.ceil(filtered.length / 60));
  const currentPage = Math.min(page, totalPages - 1);
  const items = filtered.slice(currentPage * 60, (currentPage + 1) * 60);
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
            {receipt.after.length} transaction
            {receipt.after.length === 1 ? "" : "s"} → {receipt.categoryName}
            {receipt.rule ? " · merchant remembered" : ""}
          </span>
          <button
            disabled={undoBusy}
            onClick={async () => {
              setUndoBusy(true);
              setUndoError("");
              try {
                await undoCategory(receipt);
                setSorting(receipt.before[0]);
                setReceipt(undefined);
              } catch (err) {
                setUndoError(
                  err instanceof Error ? err.message : "Undo failed.",
                );
              } finally {
                setUndoBusy(false);
              }
            }}
          >
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
          {filtered.length} results · {currency}
        </span>
      </div>
      {data && (
        <AccountBalances
          accounts={data.accounts}
          statements={data.statements}
          month={selectedMonth}
          currency={currency}
          detailed
        />
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
          {allDates ? "All imported dates" : `${from} — ${to}`}
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
      <p className="gesture-hint">
        Drag a transaction onto a category on desktop. On mobile, tap to sort or
        swipe to change its category. Keyboard: press C.
      </p>
      {!sorting && feedback}
      {sorting && data && (
        <CategoryBoard
          key={sorting.id}
          transaction={sorting}
          dragStart={dragStart}
          returnTo={returnTo}
          categories={data.categories}
          feedback={feedback}
          onClose={() => {
            setSorting(undefined);
            setDragStart(undefined);
          }}
          onSaved={(result) => {
            setDragStart(undefined);
            setReceipt(result);
            setUndoError("");
            setSorting(undefined);
          }}
        />
      )}
      <section className="card transaction-list">
        {items.map((t) => (
          <SwipeTransaction
            key={t.id}
            transaction={t}
            returnTo={returnTo}
            onCategorize={() => {
              setDragStart(undefined);
              setSorting(t);
              setUndoError("");
            }}
            onDragCategorize={(start) => {
              setDragStart(start);
              setSorting(t);
              setUndoError("");
            }}
          >
            <div className="transaction-description">
              <strong>{t.merchant || t.description}</strong>
              <span
                className={`transaction-status ${t.isTransfer || t.type === "transfer" || t.transferPairId ? "transfer" : t.categoryId || t.subcategoryId ? "categorized" : "uncategorized"}`}
              >
                {t.isTransfer || t.type === "transfer" || t.transferPairId
                  ? "Transfer"
                  : t.categoryId || t.subcategoryId
                    ? (data?.categories.find(
                        (c) => c.id === (t.categoryId ?? t.subcategoryId),
                      )?.name ?? "Category unavailable")
                    : "Needs category"}
              </span>
              <span>
                {t.date} ·{" "}
                {data?.accounts.find((a) => a.id === t.accountId)?.institution}
              </span>
            </div>
            <strong className={t.amount > 0 && !t.isTransfer ? "positive" : ""}>
              {money(t.amount, t.currency, true)}
            </strong>
          </SwipeTransaction>
        ))}
        {!items.length && (
          <div className="empty">
            <h2>No transactions found</h2>
            <p>Adjust the filters or import a statement for this period.</p>
          </div>
        )}
      </section>
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
