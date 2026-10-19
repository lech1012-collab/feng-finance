import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Category, ImportDraft } from "../domain/models";
import { displayMerchant } from "../domain/presentation";
import { formatUkDate } from "../domain/dates";
import { decimalMoney, money, parseMoney } from "../domain/money";
import { UKDateInput } from "./UKDateInput";
import type { FileReview } from "../import/review-model";

export function ImportTransactionReview({
  t,
  d,
  categories,
  busy,
  updateRow,
  correctSource,
  onReviewSource,
  invalidAmounts,
  patch,
  isExport,
}: {
  t: ImportDraft["transactions"][number];
  d: ImportDraft;
  categories: Category[];
  busy: boolean;
  isExport: boolean;
  updateRow: (
    id: string,
    update: Partial<ImportDraft["transactions"][number]>,
  ) => void;
  correctSource: (
    row: ImportDraft["transactions"][number],
    correction: { date?: string; amount?: number },
  ) => void;
  onReviewSource?: () => void;
  invalidAmounts: string[];
  patch: (update: Partial<FileReview>) => void;
}) {
  const merchant = displayMerchant(t);
  const rawName = /\S{30,}/.test(merchant);
  const [open, setOpen] = useState(
    !!t.include &&
      ((!!t.manualReplacementId && t.replaceManual === undefined) ||
        ((!d.parserReview || d.parserFallback) &&
          t.extractionConfidence < 0.8 &&
          !t.acknowledged) ||
        (t.duplicate !== "none" && !t.acknowledged)),
  );
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className={`review-row ${t.extractionConfidence < 0.8 ? "uncertain" : ""}`}
      key={t.id}
    >
      <summary
        className="review-compact"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
      >
        <span>
          <strong
            className={rawName ? "import-raw-reference" : undefined}
            role={rawName ? "region" : undefined}
            aria-label={rawName ? "Transaction name" : undefined}
            tabIndex={rawName ? 0 : undefined}
          >
            {merchant}
          </strong>
          <small>
            <time className="date-value" dateTime={t.date}>
              {formatUkDate(t.date, true)}
            </time>{" "}
            ·{" "}
            {t.isTransfer
              ? "Transfer"
              : (categories.find((c) => c.id === t.categoryId)?.name ??
                "Uncategorised")}
          </small>
        </span>
        <strong>{money(t.amount, t.currency, true)}</strong>
        <ChevronDown size={16} />
      </summary>
      {open && (
        <>
          <div className="review-row-title">
            <span className="muted">
              {t.include ? "Included" : "Excluded from import"}
            </span>

            <span className="small-chip">
              {isExport ? "Row" : "Page"} {t.sourcePage}
            </span>
          </div>
          <details>
            <summary>Original description</summary>
            <p
              className="import-raw-reference"
              role="region"
              aria-label="Original transaction description"
              tabIndex={0}
            >
              {t.description}
            </p>
          </details>
          {t.duplicate !== "none" && (
            <p className="warning-text">
              {t.duplicate === "certain"
                ? "Known duplicate"
                : "Possible duplicate. Identical purchases can be legitimate"}{" "}
              · {t.include ? "will be imported" : "excluded"}
            </p>
          )}
          {t.manualReplacementId && (
            <label>
              Matching manual transaction
              <select
                aria-label={`Manual replacement for ${t.description}`}
                disabled={busy}
                value={
                  t.replaceManual === undefined
                    ? ""
                    : t.replaceManual
                      ? t.manualReplacementId
                      : "keep"
                }
                onChange={(e) =>
                  updateRow(t.id, {
                    replaceManual:
                      e.target.value === ""
                        ? undefined
                        : e.target.value !== "keep",
                    manualReplacementId:
                      e.target.value && e.target.value !== "keep"
                        ? e.target.value
                        : t.manualReplacementId,
                    acknowledged: e.target.value !== "",
                  })
                }
              >
                <option value="">Choose what to do</option>
                {(
                  t.manualReplacementCandidates ?? [
                    {
                      id: t.manualReplacementId,
                      date: t.date,
                      description: "manual entry",
                    },
                  ]
                ).map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    Replace {candidate.description} ·{" "}
                    {formatUkDate(candidate.date)}
                  </option>
                ))}
                <option value="keep">Keep both</option>
              </select>
            </label>
          )}
          <div className="form-grid">
            <label>
              Date
              <UKDateInput
                disabled={busy}

                value={t.date}
                readOnly={!!d.bankSource}
                onChange={(e) => correctSource(t, { date: e })}
              />
            </label>
            <label>
              Amount ({t.currency})
              <input
                disabled={busy}
                aria-label={`Amount for ${t.description}`}
                type="text"
                key={`${t.id}:${t.amount}`}
                inputMode="decimal"
                readOnly={!!d.bankSource}
                defaultValue={decimalMoney(t.amount, t.currency)}
                onBlur={(e) => {
                  if (d.bankSource) return;
                  try {
                    const amount = parseMoney(e.target.value, t.currency);
                    e.target.setCustomValidity("");
                    const nextInvalidAmounts = invalidAmounts.filter(
                      (id) => id !== t.id,
                    );
                    patch({ invalidAmounts: nextInvalidAmounts });
                    if (d.parserFallback && amount === t.amount) return;
                    if (t.parseRowId && d.parserReview) {
                      correctSource(t, { amount });
                    } else {
                      updateRow(t.id, {
                        amount,
                        type: t.isTransfer
                          ? "transfer"
                          : amount >= 0
                            ? "income"
                            : "expense",
                        acknowledged: true,
                      });
                    }
                  } catch {
                    patch({
                      invalidAmounts: [...new Set([...invalidAmounts, t.id])],
                    });
                    e.target.setCustomValidity(
                      "Enter a valid amount, such as -82.45.",
                    );
                    e.target.reportValidity();
                  }
                }}
              />
            </label>
            {d.bankSource && onReviewSource && (
              <button type="button" disabled={busy} onClick={onReviewSource}>
                Correct amount
              </button>
            )}
            <label>
              Category
              <select
                aria-label="Category"
                disabled={busy || t.isTransfer}
                value={t.categoryId ?? ""}
                onChange={(e) =>
                  updateRow(t.id, {
                    manualCategory: true,
                    isReviewed: true,
                    categorySource: "manual",
                    categoryRuleId: undefined,
                    appliedRuleIds: [],
                    ruleSplit: undefined,
                    kind: e.target.value === "refund" ? "refund" : "normal",
                    categoryId: e.target.value || undefined,
                    subcategoryId: undefined,
                  })
                }
              >
                <option value="">Uncategorised</option>
                {categories
                  .filter((c) => c.kind !== "income" || t.amount >= 0)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Type
              <select
                aria-label="Type"
                disabled={busy}
                value={t.type}
                onChange={(e) =>
                  updateRow(t.id, {
                    manualCategory: true,
                    isReviewed: true,
                    categorySource: "manual",
                    categoryRuleId: undefined,
                    appliedRuleIds: [],
                    ruleSplit: undefined,
                    kind: e.target.value === "transfer" ? "transfer" : "normal",
                    type: e.target.value as typeof t.type,
                    isTransfer: e.target.value === "transfer",
                    categoryId:
                      e.target.value === "transfer" ? undefined : t.categoryId,
                    subcategoryId:
                      e.target.value === "transfer"
                        ? undefined
                        : t.subcategoryId,
                  })
                }
              >
                {[t.amount >= 0 ? "income" : "expense", "transfer"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="import-row-actions">
            {t.include ? (
              <button
                disabled={busy}
                onClick={() =>
                  updateRow(t.id, {
                    include: false,
                    acknowledged:
                      t.duplicate === "none" ? t.acknowledged : false,
                  })
                }
              >
                Exclude transaction
              </button>
            ) : t.duplicate !== "none" ? (
              <button
                disabled={busy}
                onClick={() =>
                  updateRow(t.id, {
                    include: true,
                    acknowledged: true,
                  })
                }
              >
                Keep this checked transaction
              </button>
            ) : (
              <button
                disabled={busy}
                onClick={() => updateRow(t.id, { include: true })}
              >
                Include transaction
              </button>
            )}
            {t.include && t.duplicate !== "none" && !t.acknowledged && (
              <button
                disabled={busy}
                onClick={() => updateRow(t.id, { acknowledged: true })}
              >
                Keep this checked transaction
              </button>
            )}
            {t.include &&
              t.duplicate === "none" &&
              (!d.parserReview || d.parserFallback) &&
              t.extractionConfidence < 0.8 &&
              (t.acknowledged ? (
                <>
                  <span role="status">Amount checked</span>
                  <button
                    disabled={busy}
                    onClick={() => updateRow(t.id, { acknowledged: false })}
                  >
                    Review amount again
                  </button>
                </>
              ) : (
                <button
                  disabled={busy}
                  onClick={() => updateRow(t.id, { acknowledged: true })}
                >
                  Amount is correct
                </button>
              ))}
          </div>
        </>
      )}
    </details>
  );
}
