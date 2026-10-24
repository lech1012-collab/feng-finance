import { displayAccountName } from "../domain/presentation";
import { Toast } from "../components/Toast";
import { undoChange } from "../storage/audit";
import { useEffect, useRef, useState } from "react";
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
import { TransactionAccuracy } from "../components/TransactionAccuracy";
import { TransferReview } from "../components/TransferReview";
import { TagPicker } from "../components/TagManager";
import { createTagForTransaction } from "../storage/tags";
import { AttachmentManager } from "../components/AttachmentManager";
import { authorizeMonthEdit } from "../storage/month-review";
import {
  CategoryConflictDialog,
  type CategoryConflictDecision,
} from "../components/CategoryConflictDialog";
import { conflictingCategoryRule } from "../categorization/rule-conflict";
import { useGlobalCurrency } from "../components/CurrencySetting";
import { convertMinor } from "../analytics/fx";
import { KeyValueRow } from "../components/UIPrimitives";
import { Sheet } from "../components/Sheet";
import {
  refundCountedMonths,
  refundMonthName,
} from "../analytics/refund-impact";
import "../components/transaction-polish.css";
export default function TransactionDetail() {
  const { id: tid } = useParams();
  const data = useLiveQuery(async () => {
    const t = await db.transactions.get(tid!);
    if (!t) return null;
    const refundMonths =
      t.kind === "refund" && t.refundAllocations?.length
        ? refundCountedMonths(
            t,
            (
              await db.transactions.bulkGet(
                t.refundAllocations.map((line) => line.transactionId),
              )
            ).filter((row): row is Transaction => !!row),
            await db.settings.toArray(),
            await db.transactions
              .where("categoryId")
              .equals("salary")
              .toArray(),
          )
        : [];
    return {
      t,
      refundMonths,
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
        <Link className="back-link" to="/transactions">
          ‹ Transactions
        </Link>
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
    refundMonths: string[];
  };
}) {
  const { t, account, statement, categories, possible, rule, refundMonths } =
    data;
  const reportingCurrency = useGlobalCurrency();
  const rates = useLiveQuery(() => db.fxRates.toArray(), [], []);
  const conversion =
    t.currency === reportingCurrency
      ? undefined
      : convertMinor(t.amount, t.currency, reportingCurrency, t.date, rates);
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo =
    typeof location.state?.returnTo === "string" &&
    /^\/transactions(?:\?|$)/.test(location.state.returnTo)
      ? location.state.returnTo
      : "/transactions";
  const [merchant, setMerchant] = useState(displayMerchant(t));
  const [category, setCategory] = useState(t.categoryId ?? "");
  const [subcategory, setSubcategory] = useState(t.subcategoryId ?? "");
  const [type, setType] = useState(financialType(t));
  const [tags, setTags] = useState(t.tags ?? []);
  const [pair, setPair] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<Rule>();
  const [receipt, setReceipt] = useState<string>();
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  type Patch = Pick<
    Transaction,
    "merchant" | "categoryId" | "subcategoryId" | "type" | "tags"
  >;
  const [pendingPatch, setPendingPatch] = useState<Patch>();
  const displayedVersion = useRef(t.updatedAt);
  useEffect(() => {
    if (displayedVersion.current === t.updatedAt) return;
    displayedVersion.current = t.updatedAt;
    setMerchant(displayMerchant(t));
    setCategory(t.categoryId ?? "");
    setSubcategory(t.subcategoryId ?? "");
    setType(financialType(t));
    setTags(t.tags ?? []);
  }, [t.updatedAt]);
  const save = async (
    decision?: CategoryConflictDecision,
    override: Partial<Patch> = {},
  ) => {
    const patch: Patch =
      decision && pendingPatch
        ? pendingPatch
        : {
            merchant: merchant.trim(),
            categoryId: category || undefined,
            subcategoryId: subcategory || undefined,
            type,
            tags,
            ...override,
          };
    setBusy(true);
    setError("");
    try {
      if (!decision) {
        const conflicting = conflictingCategoryRule(
          t,
          {
            categoryId: patch.categoryId,
            isTransfer: patch.type === "transfer",
          },
          await db.rules.toArray(),
        );
        if (conflicting) {
          setPendingPatch(patch);
          setConflict(conflicting);
          return;
        }
      }
      const affected = t.transferPairId
        ? await db.transactions
            .filter((row) => row.transferPairId === t.transferPairId)
            .toArray()
        : [t];
      if (!(await authorizeMonthEdit(affected))) {
        setMerchant(displayMerchant(t));
        setCategory(t.categoryId ?? "");
        setSubcategory(t.subcategoryId ?? "");
        setType(financialType(t));
        setTags(t.tags ?? []);
        setError("Changes were not saved because the month remains closed.");
        return;
      }
      const result = await editTransaction(t.id, patch, undefined, {
        learn: decision !== "once",
      });
      setReceipt(result.changeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Changes could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Link className="back-link" to={returnTo}>
        ‹ Transactions
      </Link>
      <section className="card detail-card">
        <p className="eyebrow">
          <span className="date-value">{displayDate(t.date)}</span> ·{" "}
          {account ? displayAccountName(account) : "Account"}
        </p>
        <h1 className="detail-amount">{money(t.amount, t.currency, true)}</h1>
        {t.kind === "refund" && !!t.refundAllocations?.length && (
          <p className="detail-refund-month">
            {refundMonths.length
              ? `Refund · counted in ${refundMonths.map((month) => refundMonthName(month, true)).join(", ")}`
              : "Refund · original purchase unavailable"}
          </p>
        )}
        <h2>{displayMerchant(t)}</h2>
        <div className="detail-action-row">
          <TransactionAccuracy
            transaction={t}
            categories={categories}
            showRefundSummary={false}
          />
          {t.kind !== "split_parent" &&
            !(t.kind === "refund" && t.refundAllocations?.length) && (
              <button type="button" onClick={() => setTagSheetOpen(true)}>
                Add tag
              </button>
            )}
        </div>
        {t.currency !== reportingCurrency && (
          <p className="coverage-note">
            {conversion ? (
              <>
                Reporting amount{" "}
                <span className="amount">
                  {money(conversion.amount, reportingCurrency, true, true)}
                </span>{" "}
                · 1 {t.currency} = {conversion.rate} {reportingCurrency} ·{" "}
                <span className="date-value">
                  {displayDate(conversion.date)}
                </span>{" "}
                · {conversion.source === "manual" ? "Manual rate" : "ECB rate"}
              </>
            ) : (
              <>
                Reporting amount unavailable · no cached {t.currency} →{" "}
                {reportingCurrency} rate for this date.{" "}
                <Link to="/settings#currency">Review exchange rates</Link>
              </>
            )}
          </p>
        )}
        <p className="detail-description">{t.description}</p>
        {(rule || t.categorySource) && (
          <p className="category-origin-note">
            {t.categorySource === "manual"
              ? "Categorised by you"
              : "Categorised by rule"}
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
        <details className="detail-source">
          <summary>Source</summary>
          <div className="detail-source-rows">
            <KeyValueRow
              label="Account"
              value={
                <>
                  {account ? displayAccountName(account) : "Account"} ·{" "}
                  {account?.maskedAccountIdentifier}
                </>
              }
            />
            <KeyValueRow
              label="Statement"
              value={
                t.source === "manual"
                  ? "Manual entry"
                  : (statement?.sourceFilename ??
                    "Source statement unavailable")
              }
            />
            {t.parentId && (
              <KeyValueRow
                label="Original transaction"
                value={
                  <Link to={`/transactions/${t.parentId}`}>
                    View split parent
                  </Link>
                }
              />
            )}
            <KeyValueRow label="Source page" value={t.sourcePage} />
            <KeyValueRow
              label="Source check"
              value={
                t.checkLevel === "balance"
                  ? "Checked against running balance"
                  : t.checkLevel === "total"
                    ? "Checked against statement total"
                    : t.checkLevel === "ocr"
                      ? "Read from an image"
                      : t.checkLevel === "manual_override"
                        ? "Imported as unverified"
                        : t.checkLevel === "review"
                          ? t.isReviewed
                            ? "Source checked manually"
                            : "Needs review"
                          : "Original import check"
              }
            />
            <KeyValueRow
              label="Transfer status"
              value={
                t.transferPairId
                  ? "Linked to another account"
                  : t.isTransfer
                    ? `${t.kind === "card_repayment" ? "Card repayment" : "Transfer"} · other side not in Feng`
                    : "Not a transfer"
              }
            />
          </div>
        </details>
        {t.kind !== "split_parent" &&
          !(t.kind === "refund" && t.refundAllocations?.length) && (
            <>
              <div className="form-grid">
                <label>
                  Display name
                  <input
                    disabled={busy}
                    value={merchant}
                    onChange={(e) => setMerchant(e.target.value)}
                    onBlur={(event) => {
                      const nextName = event.currentTarget.value.trim();
                      if (nextName && nextName !== displayMerchant(t))
                        void save(undefined, { merchant: nextName });
                    }}
                    maxLength={500}
                  />
                </label>
                <label>
                  Transaction type
                  <select
                    aria-label="Transaction type"
                    disabled={busy}
                    value={type}
                    onChange={(e) => {
                      const next = e.target.value as Transaction["type"];
                      setType(next);
                      void save(undefined, {
                        type: next,
                        categoryId:
                          next === "transfer"
                            ? undefined
                            : category || undefined,
                        subcategoryId:
                          next === "transfer"
                            ? undefined
                            : subcategory || undefined,
                      });
                      if (e.target.value === "transfer") {
                        setCategory("");
                        setSubcategory("");
                      }
                    }}
                  >
                    {["income", "expense", "transfer"].map((v) => (
                      <option
                        value={v}
                        key={v}
                        disabled={
                          v !== "transfer" && v !== amountType(t.amount)
                        }
                      >
                        {v[0].toUpperCase() + v.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Category
                  <select
                    aria-label="Category"
                    disabled={busy || type === "transfer"}
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      setSubcategory("");
                      setType(amountType(t.amount));
                      void save(undefined, {
                        categoryId: e.target.value || undefined,
                        subcategoryId: undefined,
                        type: amountType(t.amount),
                      });
                    }}
                  >
                    <option value="">Uncategorised</option>
                    {categories
                      .filter(
                        (c) =>
                          !c.parentId &&
                          (!c.archived || c.id === category) &&
                          (t.amount >= 0 ||
                            c.kind !== "income" ||
                            c.id === category),
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
                {category !== "property" &&
                  categories.some((c) => c.parentId === category) && (
                    <label>
                      Subcategory
                      <select
                        aria-label="Subcategory"
                        disabled={busy || !category || type === "transfer"}
                        value={subcategory}
                        onChange={(e) => {
                          setSubcategory(e.target.value);
                          void save(undefined, {
                            subcategoryId: e.target.value || undefined,
                          });
                        }}
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
                  )}
              </div>
              <p className="coverage-note">Changes save automatically.</p>
              <details>
                <summary>How this counts</summary>
                <p>
                  Money in counts as income; money out counts as spending.
                  Transfers move account balances and are excluded from cash
                  flow. A refund reduces the original spending.
                </p>
              </details>
              {error && !tagSheetOpen && (
                <p role="alert" className="warning-text">
                  {error}
                </p>
              )}
            </>
          )}
      </section>
      <TransferReview transactionIds={[t.id]} />
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
              <option value="">Choose</option>
              {possible.map((p) => (
                <option key={p.id} value={p.id}>
                  <time className="date-value" dateTime={p.date}>
                    {displayDate(p.date)}
                  </time>{" "}
                  · {displayMerchant(p)} · {money(p.amount, p.currency, true)}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!pair || busy}
            onClick={async () => {
              try {
                const other = await db.transactions.get(pair);
                if (!(await authorizeMonthEdit(other ? [t, other] : [t])))
                  return;
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
      <AttachmentManager transactionId={t.id} />
      {tagSheetOpen && (
        <Sheet
          title="Add tag"
          onClose={() => setTagSheetOpen(false)}
          footer={
            <button
              type="button"
              className="primary"
              onClick={() => setTagSheetOpen(false)}
            >
              Done
            </button>
          }
        >
          <TagPicker
            value={tags}
            onCreate={async (name) => {
              if (!(await authorizeMonthEdit([t]))) return;
              const result = await createTagForTransaction(t.id, name);
              setTags(result.result.tags);
              setReceipt(result.changeId);
            }}
            onChange={(value) => {
              setTags(value);
              void save(undefined, { tags: value });
            }}
          />
          {error && (
            <p role="alert" className="warning-text">
              {error}
            </p>
          )}
        </Sheet>
      )}
      {receipt && (
        <Toast
          id={receipt}
          message="Transaction updated."
          undo={async () => {
            await undoChange(receipt);
            setReceipt(undefined);
          }}
        />
      )}
      {conflict && (
        <CategoryConflictDialog
          oldCategory={
            conflict.type === "transfer"
              ? "Transfer"
              : (categories.find(
                  (item) =>
                    item.id ===
                    (conflict.actions?.find(
                      (action) => action.type === "category",
                    )?.categoryId ?? conflict.categoryId),
                )?.name ?? "another category")
          }
          newCategory={
            type === "transfer"
              ? "Transfer"
              : (categories.find((item) => item.id === category)?.name ??
                "Uncategorised")
          }
          onCancel={() => {
            setConflict(undefined);
            setPendingPatch(undefined);
            setCategory(t.categoryId ?? "");
            setType(financialType(t));
          }}
          onDecision={(decision) => {
            setConflict(undefined);
            void save(decision);
          }}
        />
      )}
    </>
  );
}
