import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileText,
} from "lucide-react";
import type {
  Account,
  Category,
  ImportDraft,
  Institution,
  Statement,
} from "../domain/models";
import { formatDateRange, formatUkDate } from "../domain/dates";
import { decimalMoney, money, parseMoney } from "../domain/money";
import { draftReconciliation } from "../import/pipeline";
import { statementMovements } from "../import/movements";
import { statementPeriodNotices } from "../import/batch";
import { needsRowCheck, type FileReview } from "../import/review-model";

export function ImportStatementReview({
  entry,
  accounts,
  categories,
  history,
  busy,
  patch,
  reparse,
}: {
  entry: FileReview;
  accounts: Account[];
  categories: Category[];
  history: Statement[];
  busy: boolean;
  patch: (update: Partial<FileReview>) => void;
  reparse: (ocr: boolean) => void;
}) {
  const d = entry.draft;
  const validation = d && draftReconciliation(d);
  const flow = d && statementMovements(d.transactions, d.statement.currency);
  const exactSkipped = d?.exactDuplicate && !d.duplicateOverride;
  const checks = d?.transactions.filter((t) => needsRowCheck(t, d)) ?? [];
  const updateDraft = (update: Partial<ImportDraft>) =>
    d && patch({ draft: { ...d, ...update } });
  const updateRow = (
    id: string,
    update: Partial<ImportDraft["transactions"][number]>,
  ) =>
    d &&
    updateDraft({
      transactions: d.transactions.map((t) =>
        t.id === id ? { ...t, ...update } : t,
      ),
    });
  const warning = !!d?.warnings.length && !d.reviewedWarnings;
  const blocking =
    !entry.skip &&
    !exactSkipped &&
    (entry.error ||
      (validation?.status === "warning" && !entry.override) ||
      warning ||
      checks.some(
        (t) => t.include && t.extractionConfidence < 0.8 && !t.acknowledged,
      ));
  const notices = d ? statementPeriodNotices(d, history) : [];
  const outsideDates = d?.transactions.some(
    (t) =>
      t.date < d.statement.statementPeriodStart ||
      t.date > d.statement.statementPeriodEnd,
  );
  const status =
    entry.skip || exactSkipped
      ? "Will be skipped"
      : entry.state === "saved"
        ? `${entry.imported ?? 0} imported`
        : entry.error
          ? "Couldn't read this PDF"
          : validation?.status === "warning"
            ? entry.override
              ? "Unverified · accepted difference"
              : "Balances don't add up"
            : checks.some((t) => t.include && !t.acknowledged)
              ? "Amounts need checking"
              : warning
                ? "Review needed"
                : validation?.status === "reconciled"
                  ? "✓ Reconciled"
                  : "Balance unavailable";
  return (
    <details
      className={`card import-statement-card ${blocking ? "import-statement-blocking" : ""} ${entry.skip || exactSkipped ? "import-statement-skipped" : ""}`}
      open={entry.open}
      onToggle={(event) => {
        if (entry.open !== event.currentTarget.open)
          patch({ open: event.currentTarget.open });
      }}
    >
      <summary className="import-statement-heading">
        <FileText size={20} aria-hidden="true" />
        <span className="import-statement-heading-text">
          <h2>{d ? `${d.statement.institution} detected` : entry.file.name}</h2>
          <span>
            {d
              ? `${d.account.maskedAccountIdentifier} · ${formatDateRange(d.statement.statementPeriodStart, d.statement.statementPeriodEnd)} · ${d.transactions.length} transactions`
              : entry.progress || "Ready to check"}
          </span>
        </span>
        <span className={`small-chip ${blocking ? "blocking-chip" : ""}`}>
          {status}
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="import-statement-content">
        <p className="muted import-source-name">{entry.file.name}</p>
        {entry.error && (
          <div className="notice import-blocking-warning" role="alert">
            <AlertTriangle size={18} />
            <div>
              <strong>This statement couldn't be read</strong>
              <p>{entry.error}</p>
              <p>
                Use a PDF statement from Barclays, American Express or Revolut,
                or select the bank below.
              </p>
            </div>
          </div>
        )}
        {d && validation && flow && (
          <>
            <p>
              {d.account.displayName} · {d.account.maskedAccountIdentifier} ·{" "}
              {d.statement.currency} ·{" "}
              {d.statement.extractionMethod === "OCR"
                ? "Local OCR"
                : "Digital PDF"}
            </p>
            <p>
              {formatDateRange(
                d.statement.statementPeriodStart,
                d.statement.statementPeriodEnd,
              )}
              {d.statement.periodSource === "transaction-coverage" &&
                " · transaction coverage"}
            </p>
            {d.statement.statementDate && (
              <p className="muted">
                Statement issued {formatUkDate(d.statement.statementDate)}
              </p>
            )}
            <div className="review-metrics">
              <div>
                <span>Transactions extracted</span>
                <strong>{d.transactions.length}</strong>
              </div>
              <div>
                <span>Money in</span>
                <strong>{money(flow.moneyIn, d.statement.currency)}</strong>
              </div>
              <div>
                <span>Money out</span>
                <strong>{money(flow.moneyOut, d.statement.currency)}</strong>
              </div>
            </div>
            <p className="coverage-note">
              Money in and Money out include transfers and card repayments. Only
              selected rows are imported.
            </p>
            <div
              className={`validation ${validation.status === "reconciled" ? "valid" : validation.status === "warning" ? "import-blocking-warning" : ""}`}
            >
              <strong>
                {validation.status === "reconciled"
                  ? "✓ Statement reconciled"
                  : validation.status === "warning"
                    ? "Balances don't add up"
                    : "Balance validation unavailable"}
              </strong>
              {validation.status === "warning" && (
                <p>
                  Your statement closes at{" "}
                  {money(d.statement.closingBalance ?? 0, d.statement.currency)}
                  . Feng calculates{" "}
                  {money(validation.calculated ?? 0, d.statement.currency)}, a
                  difference of{" "}
                  {money(
                    Math.abs(validation.difference ?? 0),
                    d.statement.currency,
                  )}
                  . Check for a missing row, incorrect sign or misread amount.
                </p>
              )}
              {d.account.accountType === "credit" && (
                <p className="muted">
                  Credit card balances use a minus sign for money owed.
                </p>
              )}
              <dl className="totals">
                <div>
                  <dt>Opening balance</dt>
                  <dd>
                    {d.statement.openingBalance === undefined
                      ? "Not available"
                      : money(d.statement.openingBalance, d.statement.currency)}
                  </dd>
                </div>
                <div>
                  <dt>Money in (including transfers)</dt>
                  <dd>+{money(flow.moneyIn, d.statement.currency)}</dd>
                </div>
                <div>
                  <dt>Money out (including transfers)</dt>
                  <dd>−{money(flow.moneyOut, d.statement.currency)}</dd>
                </div>
                <div>
                  <dt>Reported closing balance</dt>
                  <dd>
                    {d.statement.closingBalance === undefined
                      ? "Not available"
                      : money(d.statement.closingBalance, d.statement.currency)}
                  </dd>
                </div>
                {validation.calculated !== undefined && (
                  <>
                    <div>
                      <dt>Calculated closing balance</dt>
                      <dd>
                        {money(validation.calculated, d.statement.currency)}
                      </dd>
                    </div>
                    <div>
                      <dt>Difference</dt>
                      <dd>
                        {money(
                          validation.difference ?? 0,
                          d.statement.currency,
                        )}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              {validation.status === "warning" && (
                <>
                  <button
                    disabled={busy}
                    onClick={() => patch({ showAll: true })}
                  >
                    Find the difference
                  </button>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={entry.override}
                      disabled={busy}
                      onChange={(e) => patch({ override: e.target.checked })}
                    />
                    I reviewed the source PDF and explicitly accept this balance
                    difference.
                  </label>
                  <p className="muted">
                    Importing anyway leaves this statement unverified.
                  </p>
                </>
              )}
            </div>
            {notices.map((notice, index) => (
              <p className="coverage-note" key={`${notice.kind}-${index}`}>
                <strong>{notice.kind === "gap" ? "Gap" : "Overlap"}:</strong>{" "}
                {formatDateRange(notice.start, notice.end)}{" "}
                {notice.kind === "gap"
                  ? "has no statement between these imports."
                  : "is also covered by another statement. Duplicate rows are skipped by default."}
              </p>
            ))}
            {entry.requiresBatchRecheck && (
              <div className="notice import-blocking-warning">
                <AlertTriangle size={18} />
                <div>
                  <strong>Recheck this statement</strong>
                  <p>
                    Another selected file was skipped or corrected. Parse again
                    so Feng can update duplicate checks before importing.
                  </p>
                  <button disabled={busy} onClick={() => reparse(false)}>
                    Recheck statement
                  </button>
                </div>
              </div>
            )}
            {d.exactDuplicate && (
              <div className="import-duplicate-note">
                <strong>
                  {entry.duplicateInBatch
                    ? "This PDF was selected more than once."
                    : "This statement has already been imported."}
                </strong>
                <p>
                  {entry.duplicateInBatch
                    ? "The repeated file will be skipped."
                    : "It will be skipped. Your existing records are unchanged."}
                </p>
                <label className="check">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={d.duplicateOverride}
                    onChange={(e) =>
                      updateDraft({ duplicateOverride: e.target.checked })
                    }
                  />
                  Override the exact statement duplicate. Choose which
                  transactions to keep below.
                </label>
              </div>
            )}
            <p>
              {d.transactions.filter((t) => t.duplicate !== "none").length}{" "}
              possible or confirmed duplicate transactions; excluded by default.
            </p>
            {!exactSkipped && (d.warnings.length > 0 || outsideDates) && (
              <div
                className={`notice ${d.reviewedWarnings ? "warning" : "import-blocking-warning"}`}
              >
                <AlertTriangle size={18} />
                <div>
                  <strong>Extraction requires review</strong>
                  <ul>
                    {outsideDates &&
                      !d.warnings.some((w) => w.includes("outside")) && (
                        <li>
                          A transaction date is outside the statement period.
                          Compare it with the source PDF.
                        </li>
                      )}
                    {d.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                  <label className="check">
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={d.reviewedWarnings}
                      onChange={(e) =>
                        updateDraft({ reviewedWarnings: e.target.checked })
                      }
                    />
                    I compared the extracted rows with the PDF, corrected errors
                    and accept any partial extraction.
                  </label>
                  {d.statement.extractionMethod === "OCR" && (
                    <p>
                      Every uncertain amount must be verified before importing.
                      Categorization can wait.
                    </p>
                  )}
                </div>
              </div>
            )}
            <p>
              <strong>
                {checks.filter((t) => t.include).length} transactions to check.
              </strong>{" "}
              {
                d.transactions.filter(
                  (t) => t.include && !t.categoryId && !t.isTransfer,
                ).length
              }{" "}
              can be categorized later.
            </p>
            <section className="review-transactions">
              <h3>Review transactions</h3>
              <div
                className="review-tabs"
                role="group"
                aria-label="Transaction review"
              >
                <button
                  disabled={busy}
                  aria-pressed={!entry.showAll}
                  onClick={() => patch({ showAll: false })}
                >
                  To check ({checks.length})
                </button>
                <button
                  disabled={busy}
                  aria-pressed={entry.showAll}
                  onClick={() => patch({ showAll: true })}
                >
                  All transactions ({d.transactions.length})
                </button>
              </div>
              {!entry.showAll && !checks.length && (
                <div className="review-clear">
                  <CheckCircle2 size={24} />
                  <p>
                    Amounts and dates look good. Open all transactions to make
                    changes.
                  </p>
                </div>
              )}
              {(entry.showAll ? [...d.transactions] : [...checks])
                .sort(
                  (a, b) =>
                    Number(a.extractionConfidence >= 0.8) -
                      Number(b.extractionConfidence >= 0.8) ||
                    Number(a.duplicate === "none") -
                      Number(b.duplicate === "none"),
                )
                .map((t) => (
                  <details
                    open={!!needsRowCheck(t, d)}
                    className={`review-row ${t.extractionConfidence < 0.8 ? "uncertain" : ""}`}
                    key={t.id}
                  >
                    <summary className="review-compact">
                      <span>
                        <strong>{t.merchant || t.description}</strong>
                        <small>
                          {formatUkDate(t.date, true)} ·{" "}
                          {t.isTransfer
                            ? "Transfer"
                            : (categories.find((c) => c.id === t.categoryId)
                                ?.name ?? "Uncategorized")}
                        </small>
                      </span>
                      <strong>{money(t.amount, t.currency, true)}</strong>
                      <ChevronDown size={16} />
                    </summary>
                    <div className="review-row-title">
                      <label className="check">
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={t.include}
                          onChange={(e) =>
                            updateRow(t.id, {
                              include: e.target.checked,
                              acknowledged:
                                t.duplicate === "none" ? t.acknowledged : false,
                            })
                          }
                        />
                        <strong>{t.description}</strong>
                      </label>
                      <span className="small-chip">
                        Page {t.sourcePage} ·{" "}
                        {Math.round(t.extractionConfidence * 100)}%
                      </span>
                    </div>
                    {t.duplicate !== "none" && (
                      <p className="warning-text">
                        {t.duplicate === "certain"
                          ? "Known duplicate"
                          : "Possible duplicate — identical purchases can be legitimate"}{" "}
                        · {t.include ? "will be imported" : "excluded"}
                      </p>
                    )}
                    <div className="form-grid">
                      <label>
                        Date
                        <input
                          disabled={busy}
                          type="date"
                          value={t.date}
                          onChange={(e) =>
                            updateRow(t.id, {
                              date: e.target.value,
                              acknowledged: true,
                            })
                          }
                        />
                      </label>
                      <label>
                        Amount ({t.currency})
                        <input
                          disabled={busy}
                          aria-label={`Amount for ${t.description}`}
                          type="text"
                          inputMode="decimal"
                          defaultValue={decimalMoney(t.amount, t.currency)}
                          onBlur={(e) => {
                            try {
                              const amount = parseMoney(
                                e.target.value,
                                t.currency,
                              );
                              e.target.setCustomValidity("");
                              const invalidAmounts =
                                entry.invalidAmounts.filter(
                                  (id) => id !== t.id,
                                );
                              patch({
                                invalidAmounts,
                                draft: {
                                  ...d,
                                  transactions: d.transactions.map((row) =>
                                    row.id === t.id
                                      ? {
                                          ...row,
                                          amount,
                                          type: row.isTransfer
                                            ? "transfer"
                                            : amount >= 0
                                              ? "income"
                                              : "expense",
                                          acknowledged: true,
                                        }
                                      : row,
                                  ),
                                },
                              });
                            } catch {
                              patch({
                                invalidAmounts: [
                                  ...new Set([...entry.invalidAmounts, t.id]),
                                ],
                              });
                              e.target.setCustomValidity(
                                "Enter a valid amount, such as -82.45.",
                              );
                              e.target.reportValidity();
                            }
                          }}
                        />
                      </label>
                      <label>
                        Category
                        <select
                          aria-label="Category"
                          disabled={busy || t.isTransfer}
                          value={t.categoryId ?? ""}
                          onChange={(e) =>
                            updateRow(t.id, {
                              manualCategory: true,
                              categorySource: "manual",
                              categoryRuleId: undefined,
                              categoryId: e.target.value || undefined,
                              subcategoryId: undefined,
                            })
                          }
                        >
                          <option value="">Uncategorized</option>
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
                              categorySource: "manual",
                              categoryRuleId: undefined,
                              type: e.target.value as typeof t.type,
                              isTransfer: e.target.value === "transfer",
                              categoryId:
                                e.target.value === "transfer"
                                  ? undefined
                                  : t.categoryId,
                              subcategoryId:
                                e.target.value === "transfer"
                                  ? undefined
                                  : t.subcategoryId,
                            })
                          }
                        >
                          {[
                            t.amount >= 0 ? "income" : "expense",
                            "transfer",
                          ].map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {t.include &&
                      (t.extractionConfidence < 0.8 ||
                        t.duplicate !== "none") && (
                        <label className="check">
                          <input
                            type="checkbox"
                            disabled={busy}
                            checked={t.acknowledged}
                            onChange={(e) =>
                              updateRow(t.id, {
                                acknowledged: e.target.checked,
                              })
                            }
                          />
                          I verified this transaction{" "}
                          {t.duplicate !== "none" ? "and want to keep it" : ""}.
                        </label>
                      )}
                  </details>
                ))}
            </section>
          </>
        )}
        <details className="parse-options" open={!d && !!entry.error}>
          <summary>
            Bank, account and statement dates <ChevronDown size={16} />
          </summary>
          <div className="form-grid">
            <label>
              Bank
              <select
                aria-label="Bank"
                disabled={busy}
                value={entry.bank}
                onChange={(e) =>
                  patch({
                    bank: e.target.value as Institution | "",
                    optionsChanged: true,
                  })
                }
              >
                <option value="">Detect automatically</option>
                {["Barclays", "American Express", "Revolut"].map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
            <label>
              Account
              <select
                aria-label="Account"
                disabled={busy}
                value={entry.accountId}
                onChange={(e) =>
                  patch({ accountId: e.target.value, optionsChanged: true })
                }
              >
                <option value="">Detect automatically</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.institution} · {a.displayName} ·{" "}
                    {a.maskedAccountIdentifier} · {a.currency}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="check">
            <input
              type="checkbox"
              disabled={busy}
              checked={entry.manualPeriod}
              onChange={(e) =>
                patch({ manualPeriod: e.target.checked, optionsChanged: true })
              }
            />
            Enter statement dates from PDF
          </label>
          {entry.manualPeriod && (
            <>
              <p className="muted">
                Copy both dates from this statement's header. Balance validation
                still runs.
              </p>
              <div className="form-grid">
                <label>
                  Statement start date
                  <input
                    disabled={busy}
                    type="date"
                    value={entry.periodStart}
                    onChange={(e) =>
                      patch({
                        periodStart: e.target.value,
                        optionsChanged: true,
                      })
                    }
                  />
                </label>
                <label>
                  Statement end date
                  <input
                    disabled={busy}
                    type="date"
                    value={entry.periodEnd}
                    onChange={(e) =>
                      patch({ periodEnd: e.target.value, optionsChanged: true })
                    }
                  />
                </label>
              </div>
            </>
          )}
          <div className="actions">
            <button disabled={busy} onClick={() => reparse(false)}>
              Parse again
            </button>
            <button disabled={busy} onClick={() => reparse(true)}>
              Try local OCR
            </button>
            <Link to="/settings">Create an account</Link>
          </div>
        </details>
        {entry.state !== "saved" && (
          <label className="check">
            <input
              type="checkbox"
              disabled={busy}
              checked={entry.skip}
              onChange={(e) => patch({ skip: e.target.checked })}
            />
            Skip this file. No records from this statement will be saved.
          </label>
        )}
      </div>
    </details>
  );
}
