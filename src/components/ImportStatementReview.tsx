import { UKDateInput } from "./UKDateInput";
import { displayMerchant } from "../domain/presentation";
import { Link } from "react-router-dom";
import { useState, type ReactNode } from "react";
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
import {
  currencyPrecision,
  decimalMoney,
  money,
  parseMoney,
} from "../domain/money";
import { id } from "../domain/normalize";
import { draftReconciliation } from "../import/pipeline";
import { outsideStatementPeriod } from "../import/statement-period";
import { statementMovements } from "../import/movements";
import { statementPeriodNotices } from "../import/batch";
import {
  importBlockers,
  needsRowCheck,
  type FileReview,
} from "../import/review-model";
import type { RowReviewAction } from "../import/generic/types";
import { StatusChip } from "./UIPrimitives";

export function ImportStatementReview({
  entry,
  accounts,
  categories,
  history,
  busy,
  patch,
  reparse,
  sourceReview,
  onSourceAction,
  onCreateAccount,
  onInclude,
}: {
  entry: FileReview;
  accounts: Account[];
  categories: Category[];
  history: Statement[];
  busy: boolean;
  patch: (update: Partial<FileReview>) => void;
  reparse: (ocr: boolean) => void;
  sourceReview?: ReactNode;
  onSourceAction?: (rowId: string, action: RowReviewAction) => void;
  onCreateAccount?: (account: Account) => void;
  onInclude?: () => void;
}) {
  const d = entry.draft;
  const validation = d && draftReconciliation(d);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [newAccountName, setNewAccountName] = useState("Current account");
  const [newAccountType, setNewAccountType] =
    useState<Account["accountType"]>("current");
  const [newAccountCurrency, setNewAccountCurrency] = useState("GBP");
  const [newAccountSuffix, setNewAccountSuffix] = useState("");
  const [accountError, setAccountError] = useState("");
  const flow = d && statementMovements(d.transactions, d.statement.currency);
  const exactSkipped =
    d?.exactDuplicate && !d.duplicateOverride && !entry.requiresBatchRecheck;
  const checks = d?.transactions.filter((t) => needsRowCheck(t, d)) ?? [];
  const duplicateCount =
    d?.transactions.filter((transaction) => transaction.duplicate !== "none")
      .length ?? 0;
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
  const correctSource = (
    row: ImportDraft["transactions"][number],
    correction: { date?: string; amount?: number },
  ) => {
    if (d?.bankSource) return;
    if (row.parseRowId && d?.parserReview && onSourceAction) {
      onSourceAction(row.parseRowId, {
        kind: "correct",
        date: correction.date ?? row.date,
        ...(row.bookingDate ? { bookingDate: row.bookingDate } : {}),
        description: row.description,
        amount: correction.amount ?? row.amount,
        balanceAfterTransaction: row.balanceAfterTransaction,
      });
    } else {
      updateRow(row.id, { ...correction, acknowledged: true });
    }
  };
  const blockers = importBlockers(entry);
  const blocking =
    (entry.state === "review" || entry.state === "error") &&
    blockers.length > 0;
  const notices = d ? statementPeriodNotices(d, history) : [];
  const outsideDates = d?.transactions.some((t) =>
    outsideStatementPeriod(
      t,
      d.statement.statementPeriodStart,
      d.statement.statementPeriodEnd,
    ),
  );
  const status =
    entry.skip || exactSkipped
      ? "Will be skipped"
      : entry.state === "saved"
        ? `${entry.imported ?? 0} imported`
        : entry.error
          ? d
            ? "Couldn't save statement"
            : "Couldn't read statement"
          : blocking
            ? entry.requiresBatchRecheck
              ? "Recheck statement"
              : entry.optionsChanged
                ? "Parse again"
                : entry.invalidAmounts.length
                  ? "Correct invalid amounts"
                  : validation?.status === "warning" && !entry.override
                    ? validation.difference
                      ? "Balances don't add up"
                      : "Statement needs review"
                    : checks.some(
                          (t) =>
                            t.include &&
                            !t.acknowledged &&
                            (t.extractionConfidence < 0.8 ||
                              t.duplicate !== "none"),
                        )
                      ? "Verify highlighted rows"
                      : "Review needed"
            : validation?.status === "warning"
              ? "Unverified · accepted"
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
            {d ? (
              <>
                {d.account.maskedAccountIdentifier} ·{" "}
                <span className="date-value">
                  {formatDateRange(
                    d.statement.statementPeriodStart,
                    d.statement.statementPeriodEnd,
                  )}
                </span>{" "}
                · {d.transactions.length} transaction
                {d.transactions.length === 1 ? "" : "s"}
              </>
            ) : (
              entry.progress || "Ready to check"
            )}
          </span>
        </span>
        <StatusChip
          tone={
            blocking
              ? "error"
              : entry.skip || exactSkipped
                ? "neutral"
                : validation?.status === "warning"
                  ? "warning"
                  : validation?.status === "reconciled"
                    ? "complete"
                    : "neutral"
          }
        >
          {status}
        </StatusChip>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="import-statement-content">
        <p className="muted import-source-name">{entry.file.name}</p>
        {entry.state !== "saved" && (
          <div className="import-file-actions">
            {entry.skip ? (
              <>
                <p>Left out. No records from this statement will be saved.</p>
                <button
                  disabled={busy}
                  onClick={() =>
                    onInclude ? onInclude() : patch({ skip: false, open: true })
                  }
                >
                  Include and recheck statement
                </button>
              </>
            ) : (
              <button disabled={busy} onClick={() => patch({ skip: true })}>
                Leave out this statement
              </button>
            )}
          </div>
        )}
        {blocking && d && (
          <div className="notice import-blocking-warning">
            <div>
              <strong>Needs attention before import</strong>
              <ul>
                {blockers.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {entry.state === "checking" && <p role="status">{entry.progress}</p>}
        {entry.error && (
          <div className="notice import-blocking-warning" role="alert">
            <AlertTriangle size={18} />
            <div>
              <strong>
                {d
                  ? "This statement couldn't be saved"
                  : "This statement couldn't be read"}
              </strong>
              <p>{entry.error}</p>
              <p>
                {d
                  ? "Review this statement and confirm again. Previously saved statements will not be imported twice."
                  : "Use a PDF, CSV, OFX, QFX or QIF statement, or select the bank and account below."}
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
                ? "Read from images"
                : d.statement.extractionMethod === "embedded-text"
                  ? "Read from text"
                  : `${d.statement.extractionMethod} export`}
            </p>
            <p>
              <span className="date-value">
                {formatDateRange(
                  d.statement.statementPeriodStart,
                  d.statement.statementPeriodEnd,
                )}
              </span>
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
                    ? validation.difference
                      ? "Balances don't add up"
                      : "Statement needs review"
                    : "Balance validation unavailable"}
              </strong>
              {validation.status === "unavailable" &&
                ["CSV", "OFX", "QIF"].includes(
                  d.statement.extractionMethod,
                ) && (
                  <p>
                    {d.statement.openingBalance === undefined &&
                    d.statement.closingBalance === undefined
                      ? "File has no balances"
                      : "File has no complete opening and closing balances. This period remains unverified."}
                  </p>
                )}
              {validation.status === "warning" &&
                !!validation.difference &&
                !d.parserReview && (
                  <p>
                    Your statement closes at{" "}
                    {money(
                      d.statement.closingBalance ?? 0,
                      d.statement.currency,
                    )}
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
                    {validation.difference
                      ? "Find the difference"
                      : "Review transactions"}
                  </button>
                  {(!d.parserReview || d.parserFallback) && (
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={entry.override}
                        disabled={busy}
                        onChange={(e) => patch({ override: e.target.checked })}
                      />
                      {validation.difference
                        ? "I reviewed the source PDF and explicitly accept this balance difference."
                        : "I reviewed the source PDF and explicitly accept this unverified statement."}
                    </label>
                  )}
                  <p className="muted">
                    Importing anyway leaves this statement unverified.
                  </p>
                </>
              )}
            </div>
            {sourceReview}
            {notices.map((notice, index) => (
              <p className="coverage-note" key={`${notice.kind}-${index}`}>
                <strong>{notice.kind === "gap" ? "Gap" : "Overlap"}:</strong>{" "}
                <span className="date-value">
                  {formatDateRange(notice.start, notice.end)}
                </span>{" "}
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
            {duplicateCount > 0 && (
              <p>
                {duplicateCount} possible or confirmed duplicate transaction
                {duplicateCount === 1 ? "" : "s"}; excluded by default.
              </p>
            )}
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
                    I compared the extracted rows with the source file,
                    corrected errors and accept any partial extraction.
                  </label>
                  {d.statement.extractionMethod === "OCR" && (
                    <p>
                      Every uncertain amount must be verified before importing.
                      Categorisation can wait.
                    </p>
                  )}
                </div>
              </div>
            )}
            {checks.some((t) => t.include) && (
              <p>
                <strong>
                  {checks.filter((t) => t.include).length} transaction
                  {checks.filter((t) => t.include).length === 1 ? "" : "s"} to
                  check.
                </strong>
              </p>
            )}
            {d.transactions.some(
              (t) => t.include && !t.categoryId && !t.isTransfer,
            ) && (
              <p className="coverage-note">
                {
                  d.transactions.filter(
                    (t) => t.include && !t.categoryId && !t.isTransfer,
                  ).length
                }{" "}
                can be categorised later.
              </p>
            )}
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
                  To check{checks.length > 0 && ` (${checks.length})`}
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
                    Nothing to check. Open all transactions to make changes.
                  </p>
                </div>
              )}
              {entry.showAll && d.bankSource && (
                <p className="hint">
                  Dates and amounts come from the bank reader. To correct them,
                  open Reading details and choose Review PDF layout.
                </p>
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
                        <strong>{displayMerchant(t)}</strong>
                        <small>
                          <time className="date-value" dateTime={t.date}>
                            {formatUkDate(t.date, true)}
                          </time>{" "}
                          ·{" "}
                          {t.isTransfer
                            ? "Transfer"
                            : (categories.find((c) => c.id === t.categoryId)
                                ?.name ?? "Uncategorised")}
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
                        <strong>{displayMerchant(t)}</strong>
                      </label>
                      <span className="small-chip">
                        {entry.extracted?.format ? "Row" : "Page"}{" "}
                        {t.sourcePage}
                      </span>
                    </div>
                    <details>
                      <summary>Original description</summary>
                      <p>{t.description}</p>
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
                              const amount = parseMoney(
                                e.target.value,
                                t.currency,
                              );
                              e.target.setCustomValidity("");
                              const invalidAmounts =
                                entry.invalidAmounts.filter(
                                  (id) => id !== t.id,
                                );
                              patch({ invalidAmounts });
                              if (d.parserFallback && amount === t.amount)
                                return;
                              if (
                                t.parseRowId &&
                                d.parserReview &&
                                onSourceAction
                              ) {
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
                              isReviewed: true,
                              categorySource: "manual",
                              categoryRuleId: undefined,
                              appliedRuleIds: [],
                              ruleSplit: undefined,
                              kind:
                                e.target.value === "refund"
                                  ? "refund"
                                  : "normal",
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
                              kind:
                                e.target.value === "transfer"
                                  ? "transfer"
                                  : "normal",
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
                      (((!d.parserReview || d.parserFallback) &&
                        t.extractionConfidence < 0.8) ||
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
        {!d && sourceReview}
        <details className="parse-options" open={!d && !!entry.error}>
          <summary>
            Bank, account and statement dates <ChevronDown size={16} />
          </summary>
          <div className="form-grid">
            {entry.extracted?.format === "qif" && (
              <label>
                QIF date format
                <select
                  aria-label="QIF date format"
                  disabled={busy}
                  value={entry.csvMapping?.dateOrder ?? ""}
                  onChange={(e) =>
                    patch({
                      csvMapping: {
                        date: 0,
                        description: 0,
                        ...entry.csvMapping,
                        dateOrder: e.target.value as
                          "day-first" | "month-first",
                      },
                      optionsChanged: true,
                    })
                  }
                >
                  <option value="">Choose</option>
                  <option value="day-first" aria-label="Day / month / year">
                    DD/MM/YYYY
                  </option>
                  <option value="month-first" aria-label="Month / day / year">
                    MM/DD/YYYY
                  </option>
                </select>
              </label>
            )}
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
                <option value="">Automatic</option>
                {["Barclays", "American Express", "Revolut", "Other"].map(
                  (b) => (
                    <option key={b}>{b}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              Account
              <select
                aria-label="Account"
                disabled={busy}
                value={entry.accountId}
                onChange={(e) =>
                  patch({
                    accountId: e.target.value,
                    accountOverride: undefined,
                    optionsChanged: true,
                  })
                }
              >
                <option value="">Automatic</option>
                {entry.accountOverride &&
                  !accounts.some(
                    (account) => account.id === entry.accountOverride?.id,
                  ) && (
                    <option value={entry.accountOverride.id}>
                      {entry.accountOverride.displayName} ·{" "}
                      {entry.accountOverride.maskedAccountIdentifier} ·{" "}
                      {entry.accountOverride.currency}
                    </option>
                  )}
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
            Enter statement dates from the source file
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
                  <UKDateInput
                    disabled={busy}

                    value={entry.periodStart}
                    onChange={(e) =>
                      patch({
                        periodStart: e,
                        optionsChanged: true,
                      })
                    }
                  />
                </label>
                <label>
                  Statement end date
                  <UKDateInput
                    disabled={busy}

                    value={entry.periodEnd}
                    onChange={(e) =>
                      patch({ periodEnd: e, optionsChanged: true })
                    }
                  />
                </label>
              </div>
            </>
          )}
          <div className="actions">
            {entry.extracted?.csv && (
              <button
                disabled={busy}
                onClick={() => patch({ optionsChanged: true })}
              >
                Change export columns
              </button>
            )}
            <button disabled={busy} onClick={() => reparse(false)}>
              Parse again
            </button>
            {!entry.extracted?.format && (
              <button disabled={busy} onClick={() => reparse(true)}>
                Try local OCR
              </button>
            )}
            {onCreateAccount ? (
              <button
                disabled={busy}
                onClick={() => {
                  const parsed = entry.extracted?.generic?.parsed;
                  if (parsed) {
                    setNewAccountCurrency(parsed.currency);
                    setNewAccountType(parsed.accountType);
                    setNewAccountName(
                      parsed.accountType === "credit"
                        ? "Credit card"
                        : "Current account",
                    );
                  }
                  setCreatingAccount((value) => !value);
                }}
              >
                Create an account
              </button>
            ) : (
              <Link to="/settings">Create an account</Link>
            )}
          </div>
          {creatingAccount && onCreateAccount && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (busy) return;
                try {
                  const name = newAccountName.trim();
                  const currency = newAccountCurrency.trim().toUpperCase();
                  if (!name) throw new Error("Enter an account name.");
                  if (!/^\d{4}$/.test(newAccountSuffix))
                    throw new Error(
                      "Copy the last four account or card digits from this statement.",
                    );
                  currencyPrecision(currency);
                  const now = new Date().toISOString();
                  onCreateAccount({
                    id: id(),
                    institution:
                      entry.bank ||
                      entry.extracted?.generic?.parsed?.institution ||
                      "Other",
                    displayName: name,
                    accountType: newAccountType,
                    currency,
                    maskedAccountIdentifier: `•••• ${newAccountSuffix}`,
                    tracking: "statement",
                    createdAt: now,
                    updatedAt: now,
                  });
                  setAccountError("");
                  setCreatingAccount(false);
                } catch (cause) {
                  setAccountError(
                    cause instanceof Error
                      ? cause.message
                      : "Check the account details.",
                  );
                }
              }}
            >
              <h3>Identify this account</h3>
              <p>
                These details stay on your device and are saved only when you
                confirm the import.
              </p>
              <div className="form-grid">
                <label>
                  Account name
                  <input
                    disabled={busy}
                    value={newAccountName}
                    onChange={(event) => setNewAccountName(event.target.value)}
                    maxLength={200}
                    required
                  />
                </label>
                <label>
                  Account type
                  <select
                    disabled={busy}
                    value={newAccountType}
                    onChange={(event) =>
                      setNewAccountType(
                        event.target.value as Account["accountType"],
                      )
                    }
                  >
                    <option value="current">Current account</option>
                    <option value="credit">Credit card</option>
                    <option value="savings">Savings</option>
                  </select>
                </label>
                <label>
                  Currency
                  <input
                    disabled={busy}
                    value={newAccountCurrency}
                    onChange={(event) =>
                      setNewAccountCurrency(event.target.value)
                    }
                    minLength={3}
                    maxLength={3}
                    required
                  />
                </label>
                <label>
                  Last four account or card digits
                  <input
                    disabled={busy}
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    maxLength={4}
                    value={newAccountSuffix}
                    onChange={(event) =>
                      setNewAccountSuffix(event.target.value.replace(/\D/g, ""))
                    }
                    required
                  />
                </label>
              </div>
              {accountError && <p role="alert">{accountError}</p>}
              <button disabled={busy} type="submit">
                Use this account
              </button>
            </form>
          )}
        </details>
      </div>
    </details>
  );
}
