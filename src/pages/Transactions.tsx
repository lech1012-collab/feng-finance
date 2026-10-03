import { useState, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Search,
  SlidersHorizontal,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
} from "lucide-react";
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
  const selectedMonth = params.get("month") ?? month;
  const bounds = monthBounds(selectedMonth);
  const [from, setFrom] = useState(bounds[0]);
  const [to, setTo] = useState(
    new Date(Date.parse(bounds[1]) - 86400000).toISOString().slice(0, 10),
  );
  const [search, setSearch] = useState("");
  const [account, setAccount] = useState("");
  const [category, setCategory] = useState(params.get("category") ?? "");
  const [type, setType] = useState("");
  const [uncategorized, setUncategorized] = useState(
    params.has("uncategorized") || category === "uncategorized",
  );
  const [property, setProperty] = useState(false);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [page, setPage] = useState(0);
  const [advanced, setAdvanced] = useState(false);
  const data = useLiveQuery(
    async () => ({
      items:
        from && to && from <= to
          ? await db.transactions
              .where("[currency+date]")
              .between([currency, from], [currency, to], true, true)
              .reverse()
              .toArray()
          : [],
      accounts: await db.accounts.where("currency").equals(currency).toArray(),
      categories: await db.categories.toArray(),
    }),
    [from, to, currency],
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
        (!type || t.type === type) &&
        (!uncategorized || (!t.categoryId && !t.isTransfer)) &&
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
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">EVERY TRANSACTION, TRACEABLE</p>
          <h1>Transactions</h1>
        </div>
        <span className="count-chip">
          {filtered.length} results · {currency}
        </span>
      </div>
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
        <div className="form-grid">
          <label>
            From
            <input
              type="date"
              value={from}
              onChange={(e) => {
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
                setTo(e.target.value);
                reset();
              }}
            />
          </label>
          <label>
            Category
            <select
              aria-label="Category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setUncategorized(e.target.value === "uncategorized");
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
      <section className="card transaction-list">
        {items.map((t) => (
          <Link
            className="transaction-row"
            key={t.id}
            to={`/transactions/${t.id}`}
          >
            <span className={`transaction-icon ${t.type}`}>
              {t.isTransfer ? (
                <ArrowLeftRight size={18} />
              ) : t.amount >= 0 ? (
                <ArrowDownLeft size={18} />
              ) : (
                <ArrowUpRight size={18} />
              )}
            </span>
            <div className="transaction-description">
              <strong>{t.merchant || t.description}</strong>
              <span>
                {t.date} ·{" "}
                {t.isTransfer
                  ? "Transfer"
                  : (data?.categories.find((c) => c.id === t.categoryId)
                      ?.name ?? "Uncategorized")}{" "}
                ·{" "}
                {data?.accounts.find((a) => a.id === t.accountId)?.institution}
              </span>
            </div>
            <strong className={t.amount > 0 && !t.isTransfer ? "positive" : ""}>
              {money(t.amount, t.currency, true)}
            </strong>
          </Link>
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
