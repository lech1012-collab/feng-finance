import { useState } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/database";
import { money } from "../domain/money";
import type {
  Account,
  Statement,
  Category,
  Transaction,
} from "../domain/models";
import { editTransaction, linkTransfers } from "../storage/transactions";
import { financialType, amountType } from "../domain/transaction-type";
import { displayDate, displayMerchant } from "../domain/presentation";
import type { Rule } from "../domain/models";
export default function TransactionDetail() {
  const { id: tid } = useParams();
  const data = useLiveQuery(async () => {
    const t = await db.transactions.get(tid!);
    if (!t) return null;
    return {
      t,
      account: await db.accounts.get(t.accountId),
      statement: await db.statements.get(t.statementId),
      rule: t.categoryRuleId ? await db.rules.get(t.categoryRuleId) : undefined,
      categories: await db.categories.toArray(),
      possible: await db.transactions
        .where("[currency+date]")
        .between(
          [
            t.currency,
            new Date(Date.parse(t.date) - 10 * 86400000)
              .toISOString()
              .slice(0, 10),
          ],
          [
            t.currency,
            new Date(Date.parse(t.date) + 10 * 86400000)
              .toISOString()
              .slice(0, 10),
          ],
          true,
          true,
        )
        .filter(
          (p) =>
            p.accountId !== t.accountId &&
            p.amount === -t.amount &&
            !p.transferPairId,
        )
        .toArray(),
    };
  }, [tid]);
  if (data === undefined) return <p>Loading transaction…</p>;
  if (!data)
    return (
      <p>
        Transaction not found.{" "}
        <Link to="/transactions">Back to transactions</Link>
      </p>
    );
  return <Editor key={data.t.id} data={data} />;
}
function Editor({
  data,
}: {
  data: {
    t: Transaction;
    account?: Account;
    statement?: Statement;
    categories: Category[];
    possible: Transaction[];
    rule?: Rule;
  };
}) {
  const { t, account, statement, categories, possible, rule } = data;
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo =
    typeof location.state?.returnTo === "string" &&
    /^\/transactions(?:\?|$)/.test(location.state.returnTo)
      ? location.state.returnTo
      : "/transactions";
  const [merchant, setMerchant] = useState(t.merchant);
  const [category, setCategory] = useState(t.categoryId ?? "");
  const [subcategory, setSubcategory] = useState(t.subcategoryId ?? "");
  const [type, setType] = useState(financialType(t));
  const [tags, setTags] = useState(t.tags.join(", "));
  const [pair, setPair] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await editTransaction(t.id, {
        merchant: merchant.trim(),
        categoryId: category || undefined,
        subcategoryId: subcategory || undefined,
        type,
        tags: tags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      navigate(returnTo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Changes could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Link className="back-link" to={returnTo}>
        Back to transactions
      </Link>
      <section className="card detail-card">
        <p className="eyebrow">
          {displayDate(t.date)} · {account?.institution}
        </p>
        <h1 className="detail-amount">{money(t.amount, t.currency, true)}</h1>
        <h2>{displayMerchant(t)}</h2>
        <p className="detail-description">{t.description}</p>
        {(rule || t.categorySource) && (
          <p className="category-origin-note">
            {t.categorySource === "manual"
              ? "Categorized by you"
              : "Categorized by rule"}
            {rule
              ? `: ${rule.pattern} on ${account?.institution ?? "this account"} → ${rule.type === "transfer" ? "Transfer" : (categories.find((c) => c.id === rule.categoryId)?.name ?? "Category")}`
              : ""}
            {rule && (
              <>
                {" "}
                ·{" "}
                <Link to={`/settings?rule=${encodeURIComponent(rule.id)}`}>
                  Edit rule
                </Link>
              </>
            )}
          </p>
        )}
        <dl className="detail-meta">
          <div>
            <dt>Account</dt>
            <dd>
              {account?.displayName} · {account?.maskedAccountIdentifier}
            </dd>
          </div>
          <div>
            <dt>Statement</dt>
            <dd>{statement?.sourceFilename}</dd>
          </div>
          <div>
            <dt>Source page</dt>
            <dd>{t.sourcePage}</dd>
          </div>
          <div>
            <dt>Extraction confidence</dt>
            <dd>{Math.round(t.extractionConfidence * 100)}%</dd>
          </div>
          <div>
            <dt>Transfer status</dt>
            <dd>
              {t.transferPairId
                ? "Linked to another account"
                : t.isTransfer
                  ? "Marked as transfer"
                  : "Not a transfer"}
            </dd>
          </div>
        </dl>
        <div className="form-grid">
          <label>
            Merchant
            <input
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              maxLength={500}
            />
          </label>
          <label>
            Transaction type
            <select
              aria-label="Transaction type"
              value={type}
              onChange={(e) => {
                setType(e.target.value as Transaction["type"]);
                if (e.target.value === "transfer") {
                  setCategory("");
                  setSubcategory("");
                }
              }}
            >
              {["income", "expense", "transfer"].map((v) => (
                <option
                  key={v}
                  disabled={v !== "transfer" && v !== amountType(t.amount)}
                >
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select
              aria-label="Category"
              disabled={type === "transfer"}
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setSubcategory("");
                setType(amountType(t.amount));
              }}
            >
              <option value="">Uncategorized</option>
              {categories
                .filter(
                  (c) =>
                    !c.parentId &&
                    (!c.archived || c.id === category) &&
                    (t.amount >= 0 || c.kind !== "income" || c.id === category),
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Subcategory
            <select
              aria-label="Subcategory"
              disabled={!category || type === "transfer"}
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
            >
              <option value="">None</option>
              {categories
                .filter(
                  (c) =>
                    c.parentId === category &&
                    (!c.archived || c.id === subcategory),
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Tags (comma separated)
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              maxLength={1000}
            />
          </label>
        </div>
        <p className="coverage-note">
          Money in counts as income; money out counts as spending. Salary is
          income when its statement amount is positive. Categories never reverse
          amounts. Transfers are excluded from net cash flow but still move
          account balances.
        </p>
        {error && (
          <p role="alert" className="warning-text">
            {error}
          </p>
        )}
        <button className="primary" onClick={() => void save()} disabled={busy}>
          Save changes
        </button>
      </section>
      {!t.transferPairId && possible.length > 0 && (
        <section className="card">
          <h2>Link an internal transfer</h2>
          <p className="muted">
            Choose the opposite transaction in another account. Linked transfers
            are excluded from income and expenses.
          </p>
          <label>
            Matching transaction
            <select
              aria-label="Matching transaction"
              value={pair}
              onChange={(e) => setPair(e.target.value)}
            >
              <option value="">Select a transaction</option>
              {possible.map((p) => (
                <option key={p.id} value={p.id}>
                  {displayDate(p.date)} · {p.description} ·{" "}
                  {money(p.amount, p.currency, true)}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!pair || busy}
            onClick={async () => {
              try {
                await linkTransfers(t.id, pair);
                navigate(returnTo);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Transfer link failed.",
                );
              }
            }}
          >
            Link transactions
          </button>
        </section>
      )}
    </>
  );
}
