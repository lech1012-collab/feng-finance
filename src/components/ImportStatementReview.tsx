import { UKDateInput } from "./UKDateInput";
import { Link } from "react-router-dom";
import { useRef, useState, type ReactNode } from "react";
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
import { formatUkDate, parseDate } from "../domain/dates";
import { currencyPrecision, money } from "../domain/money";
import { id } from "../domain/normalize";
import { draftReconciliation } from "../import/pipeline";
import { outsideStatementPeriod } from "../import/statement-period";
import { statementMovements } from "../import/movements";
import { statementPeriodNotices } from "../import/batch";
import {
  importBlockers,
  needsRowCheck,
  invalidSourceRows,
  type FileReview,
} from "../import/review-model";
import type { RowReviewAction } from "../import/generic/types";
import { StatusChip } from "./UIPrimitives";
import { ImportTransactionReview } from "./ImportTransactionReview";
import { ImportPeriod } from "./ImportPeriod";
import { ImportAnnualSummary } from "./ImportAnnualSummary";
import { ImportRiskConfirmation } from "./ImportRiskConfirmation";
import { guidedReviewCopy, guidedReviewStep } from "../import/guided-review";
import { GuidedStatementReview } from "./GuidedStatementReview";
import {
  StatementReviewWorkspace,
  type ReviewSection,
} from "./StatementReviewWorkspace";

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
  onReviewSource,
  onGuidedOptions,
  onPrepareSource,
  onMapping,
  onSaveTemplate,
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
  onReviewSource?: (row: ImportDraft["transactions"][number]) => void;
  onGuidedOptions?: (options: Partial<FileReview>) => void;
  onPrepareSource?: () => void;
  onMapping?: (
    mapping: import("../import/generic/types").LayoutMapping,
  ) => void;
  onSaveTemplate?: (
    name: string,
    mapping: import("../import/generic/types").LayoutMapping,
  ) => void;
}) {
  const d = entry.draft;
  const [showRisk, setShowRisk] = useState(false);
  const [guided, setGuided] = useState(false);
  const [detailsVisited, setDetailsVisited] = useState(false);
  const [workspace, setWorkspace] = useState<ReviewSection>();
  const [diagnostics, setDiagnostics] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const validation = d && draftReconciliation(d);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [newAccountName, setNewAccountName] = useState("Current account");
  const [newAccountType, setNewAccountType] =
    useState<Account["accountType"]>("current");
  const [newAccountCurrency, setNewAccountCurrency] = useState("GBP");
  const [newAccountSuffix, setNewAccountSuffix] = useState("");
  const [accountError, setAccountError] = useState("");
  if (entry.extracted?.summary)
    return (
      <ImportAnnualSummary
        summary={entry.extracted.summary}
        filename={entry.file.name}
        open={entry.open}
        onToggle={(open) => patch({ open })}
      />
    );
  const flow = d && statementMovements(d.transactions, d.statement.currency);
  const exactSkipped =
    d?.exactDuplicate && !d.duplicateOverride && !entry.requiresBatchRecheck;
  const checks =
    d?.transactions.filter((t) =>
      d.parserReview && !d.parserFallback
        ? t.duplicate !== "none" || !!t.manualReplacementId
        : needsRowCheck(t, d),
    ) ?? [];
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
    correction: Partial<
      Pick<
        ImportDraft["transactions"][number],
        | "date"
        | "bookingDate"
        | "description"
        | "amount"
        | "balanceAfterTransaction"
      >
    >,
  ) => {
    if (d?.bankSource) return;
    if (row.parseRowId && d?.parserReview && onSourceAction) {
      onSourceAction(row.parseRowId, {
        kind: "correct",
        date: correction.date ?? row.date,
        ...((correction.bookingDate ?? row.bookingDate)
          ? { bookingDate: correction.bookingDate ?? row.bookingDate }
          : {}),
        description: correction.description ?? row.description,
        amount: correction.amount ?? row.amount,
        balanceAfterTransaction:
          correction.balanceAfterTransaction ?? row.balanceAfterTransaction,
      });
    } else {
      const amount = correction.amount ?? row.amount;
      updateRow(row.id, {
        ...correction,
        type: row.isTransfer ? "transfer" : amount >= 0 ? "income" : "expense",
        acknowledged: true,
      });
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
  const needsFinancialAcceptance =
    !!d &&
    (validation?.status === "warning" ||
      (!!d.parserReview &&
        !d.parserFallback &&
        (!d.parserReview.checks.reconciledExactly ||
          d.parserReview.checks.needsReviewRows > 0)));
  const invalidReading =
    !!d &&
    (entry.invalidAmounts.length > 0 ||
      entry.optionsChanged ||
      (!!d.parserReview &&
        !d.parserFallback &&
        invalidSourceRows(d.parserReview).length > 0) ||
      d.transactions.some((row) => {
        try {
          parseDate(row.date);
          return false;
        } catch {
          return true;
        }
      }));
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
          <h2>{d ? d.statement.institution : "Statement needs attention"}</h2>
          <span>
            {d ? (
              <>
                {d.account.accountType === "credit"
                  ? "Credit card"
                  : d.account.accountType === "savings"
                    ? "Savings account"
                    : "Current account"}{" "}
                · {d.account.maskedAccountIdentifier} ·{" "}
                <ImportPeriod
                  start={d.statement.statementPeriodStart}
                  end={d.statement.statementPeriodEnd}
                />{" "}
              </>
            ) : (
              <span
                className="import-raw-reference"
                role="region"
                aria-label="Source filename"
                tabIndex={0}
              >
                {entry.file.name}
              </span>
            )}
          </span>
        </span>
        <span className="import-heading-outcome">
          <StatusChip
            tone={
              blocking || (!!entry.error && !entry.skip)
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
          {d && (
            <span className="import-heading-balance">
              <small>Reported closing</small>
              <strong
                className={
                  d.statement.closingBalance === undefined
                    ? undefined
                    : "amount"
                }
              >
                {d.statement.closingBalance === undefined
                  ? "Balance unavailable"
                  : money(d.statement.closingBalance, d.statement.currency)}
              </strong>
            </span>
          )}
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="import-statement-content">
        {!entry.skip && !exactSkipped && entry.state !== "saved" && (
          <div className="import-guided-intro">
            <p
              role={
                guidedReviewStep(entry).kind === "error" ? "alert" : undefined
              }
            >
              {guidedReviewCopy(entry)}
            </p>
            {blocking && (
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={(event) => {
                  event.currentTarget.focus({ preventScroll: true });
                  setGuided(true);
                  // A recognized account is not a question for the user. When
                  // native figures fail their checks, open its source exceptions
                  // directly rather than sending the user through reading details.
                  if (
                    d?.bankSource?.parsed.accountIdentifier &&
                    d.bankSource.sourceCoverageIssues.some((issue) =>
                      /Some printed transaction rows were not fully matched|Some printed running balances were not read/.test(
                        issue,
                      ),
                    ) &&
                    !entry.optionsChanged &&
                    !entry.requiresBatchRecheck
                  )
                    onPrepareSource?.();
                }}
              >
                Review statement
              </button>
            )}
          </div>
        )}
        {exactSkipped && !diagnostics && (
          <p className="import-duplicate-note">
            {entry.duplicateInBatch
              ? "This PDF was selected more than once."
              : "This statement has already been imported."}
          </p>
        )}
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
        {guided && !entry.skip && (
          <GuidedStatementReview
            entry={entry}
            accounts={accounts}
            busy={busy}
            patch={patch}
            onClose={() => setGuided(false)}
            onAccount={(account) => onCreateAccount?.(account)}
            onOptions={(change) => {
              if (onGuidedOptions) onGuidedOptions(change);
              else {
                patch(change);
                reparse(false);
              }
            }}
            onSourceAction={onSourceAction}
            onPrepareSource={onPrepareSource}
            onCorrectTransaction={(row, { kind: _kind, ...values }) =>
              correctSource(row, values)
            }
            onDetails={(section = "overview") => {
              setGuided(false);
              setWorkspace(section);
            }}
          />
        )}
        <details
          className="import-statement-details"
          ref={detailsRef}
          onToggle={(event) => {
            if (event.currentTarget.open) setDetailsVisited(true);
          }}
        >
          <summary
            aria-haspopup="dialog"
            onClick={(event) => {
              event.preventDefault();
              setWorkspace("overview");
            }}
          >
            Statement details
          </summary>
          <p className="muted import-source-name import-raw-reference">
            {entry.file.name}
          </p>
          {diagnostics && (
            <div className="import-expert-tools">
              <button
                type="button"
                onClick={() => {
                  setDiagnostics(false);
                  if (detailsRef.current) detailsRef.current.open = false;
                }}
              >
                Close diagnostic tools
              </button>
              {!entry.skip && (
                <>
                  {blocking && d && (
                    <div className="notice import-blocking-warning">
                      <div>
                        <strong>Needs attention before import</strong>
                        <p>{blockers[0]}</p>
                        {blockers.length > 1 && (
                          <details className="import-all-checks">
                            <summary>All checks ({blockers.length})</summary>
                            <ul>
                              {blockers.map((reason) => (
                                <li key={reason}>{reason}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    </div>
                  )}
                  {entry.state === "checking" && (
                    <p role="status">{entry.progress}</p>
                  )}
                  {entry.error && (
                    <div
                      className="notice import-blocking-warning"
                      role="alert"
                    >
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
                        {d.account.displayName} ·{" "}
                        {d.account.maskedAccountIdentifier} ·{" "}
                        {d.statement.currency} ·{" "}
                        {d.statement.extractionMethod === "OCR"
                          ? "Read from images"
                          : d.statement.extractionMethod === "embedded-text"
                            ? "Read from text"
                            : `${d.statement.extractionMethod} export`}
                      </p>
                      <p>
                        <ImportPeriod
                          start={d.statement.statementPeriodStart}
                          end={d.statement.statementPeriodEnd}
                        />
                        {d.statement.periodSource === "transaction-coverage" &&
                          " · transaction coverage"}
                      </p>
                      {d.statement.statementDate && (
                        <p className="muted">
                          Statement issued{" "}
                          {formatUkDate(d.statement.statementDate)}
                        </p>
                      )}
                      <div className="review-metrics">
                        <div>
                          <span>Transactions extracted</span>
                          <strong>{d.transactions.length}</strong>
                        </div>
                      </div>
                      <p className="coverage-note">
                        Money in and Money out include transfers and card
                        repayments. Only selected rows are imported.
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
                              {money(
                                validation.calculated ?? 0,
                                d.statement.currency,
                              )}
                              , a difference of{" "}
                              {money(
                                Math.abs(validation.difference ?? 0),
                                d.statement.currency,
                              )}
                              . Check for a missing row, incorrect sign or
                              misread amount.
                            </p>
                          )}
                        {d.account.accountType === "credit" && (
                          <p className="muted">
                            Credit card balances use a minus sign for money
                            owed.
                          </p>
                        )}
                        <details className="import-statement-figures">
                          <summary>Statement figures</summary>
                          <dl className="totals">
                            <div>
                              <dt>Opening balance</dt>
                              <dd>
                                {d.statement.openingBalance === undefined
                                  ? "Not available"
                                  : money(
                                      d.statement.openingBalance,
                                      d.statement.currency,
                                    )}
                              </dd>
                            </div>
                            <div>
                              <dt>Money in (including transfers)</dt>
                              <dd>
                                +{money(flow.moneyIn, d.statement.currency)}
                              </dd>
                            </div>
                            <div>
                              <dt>Money out (including transfers)</dt>
                              <dd>
                                −{money(flow.moneyOut, d.statement.currency)}
                              </dd>
                            </div>
                            <div>
                              <dt>Reported closing balance</dt>
                              <dd>
                                {d.statement.closingBalance === undefined
                                  ? "Not available"
                                  : money(
                                      d.statement.closingBalance,
                                      d.statement.currency,
                                    )}
                              </dd>
                            </div>
                            {validation.calculated !== undefined && (
                              <>
                                <div>
                                  <dt>Calculated closing balance</dt>
                                  <dd>
                                    {money(
                                      validation.calculated,
                                      d.statement.currency,
                                    )}
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
                        </details>
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
                            <p className="muted">
                              Importing anyway leaves this statement unverified.
                            </p>
                          </>
                        )}
                      </div>
                      {needsFinancialAcceptance && (
                        <div className="import-financial-acceptance">
                          {entry.override ? (
                            <>
                              <p role="status">
                                Unverified statement accepted. Its validation
                                status stays unverified.
                              </p>
                              <button
                                disabled={busy}
                                onClick={() => patch({ override: false })}
                              >
                                Undo unverified acceptance
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                disabled={busy || invalidReading}
                                onClick={(event) => {
                                  event.currentTarget.focus();
                                  setShowRisk(true);
                                }}
                              >
                                Import anyway…
                              </button>
                              {invalidReading && (
                                <p>
                                  Correct or exclude invalid source values and
                                  recheck before accepting this statement.
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      )}
                      {detailsVisited && sourceReview}
                      {notices.map((notice, index) => (
                        <p
                          className="coverage-note"
                          key={`${notice.kind}-${index}`}
                        >
                          <strong>
                            {notice.kind === "gap" ? "Gap" : "Overlap"}:
                          </strong>{" "}
                          <ImportPeriod start={notice.start} end={notice.end} />{" "}
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
                              Another selected file was skipped or corrected.
                              Parse again so Feng can update duplicate checks
                              before importing.
                            </p>
                            <button
                              disabled={busy}
                              onClick={() => reparse(false)}
                            >
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
                          <details className="import-duplicate-advanced">
                            <summary>Review repeated statement</summary>
                            <p>
                              Restoring review keeps the duplicate checks. Only
                              transactions explicitly kept below can be
                              imported.
                            </p>
                            <button
                              disabled={busy}
                              onClick={() => {
                                updateDraft({
                                  duplicateOverride: !d.duplicateOverride,
                                });
                                if (!d.duplicateOverride)
                                  patch({ showAll: true });
                              }}
                            >
                              {d.duplicateOverride
                                ? "Skip repeated statement"
                                : "Restore review of duplicate statement"}
                            </button>
                          </details>
                        </div>
                      )}
                      {duplicateCount > 0 && (
                        <p>
                          {duplicateCount} possible or confirmed duplicate
                          transaction
                          {duplicateCount === 1 ? "" : "s"}; excluded by
                          default.
                        </p>
                      )}
                      {!exactSkipped &&
                        (d.warnings.length > 0 || outsideDates) && (
                          <div
                            className={`notice ${d.reviewedWarnings ? "warning" : "import-blocking-warning"}`}
                          >
                            <AlertTriangle size={18} />
                            <div>
                              <strong>Extraction requires review</strong>
                              <ul>
                                {outsideDates &&
                                  !d.warnings.some((w) =>
                                    w.includes("outside"),
                                  ) && (
                                    <li>
                                      A transaction date is outside the
                                      statement period. Compare it with the
                                      source PDF.
                                    </li>
                                  )}
                                {d.warnings.map((w, i) => (
                                  <li key={i}>{w}</li>
                                ))}
                              </ul>
                              {d.reviewedWarnings ? (
                                <>
                                  <p role="status">
                                    Statement warnings accepted
                                  </p>
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      updateDraft({ reviewedWarnings: false })
                                    }
                                  >
                                    Undo warning acceptance
                                  </button>
                                </>
                              ) : (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    updateDraft({ reviewedWarnings: true })
                                  }
                                >
                                  Accept these statement warnings
                                </button>
                              )}
                              {d.statement.extractionMethod === "OCR" && (
                                <p>
                                  Every uncertain amount must be verified before
                                  importing. Categorisation can wait.
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      {checks.some((t) => t.include) && (
                        <p>
                          <strong>
                            {checks.filter((t) => t.include).length} transaction
                            {checks.filter((t) => t.include).length === 1
                              ? ""
                              : "s"}{" "}
                            to check.
                          </strong>
                        </p>
                      )}
                      {d.transactions.some(
                        (t) => t.include && !t.categoryId && !t.isTransfer,
                      ) && (
                        <p className="coverage-note">
                          {
                            d.transactions.filter(
                              (t) =>
                                t.include && !t.categoryId && !t.isTransfer,
                            ).length
                          }{" "}
                          can be categorised later.
                        </p>
                      )}
                      {!exactSkipped && (
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
                              To check
                              {checks.length > 0 && ` (${checks.length})`}
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
                                Nothing to check. Open all transactions to make
                                changes.
                              </p>
                            </div>
                          )}
                          {entry.showAll && d.bankSource && (
                            <p className="hint">
                              Dates and amounts come from the bank reader. Tap
                              an amount to correct its source value.
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
                              <ImportTransactionReview
                                key={t.id}
                                t={t}
                                d={d}
                                categories={categories}
                                busy={busy}
                                updateRow={updateRow}
                                correctSource={correctSource}
                                onReviewSource={
                                  onReviewSource
                                    ? () => onReviewSource(t)
                                    : undefined
                                }
                                invalidAmounts={entry.invalidAmounts}
                                patch={patch}
                                isExport={!!entry.extracted?.format}
                              />
                            ))}
                        </section>
                      )}
                    </>
                  )}
                  {!d && detailsVisited && sourceReview}
                  <details
                    className="parse-options"
                    open={
                      !d &&
                      (entry.extracted?.format === "qif" ||
                        entry.extracted?.generic?.status ===
                          "identity-required")
                    }
                  >
                    <summary>
                      Bank, account and statement dates{" "}
                      <ChevronDown size={16} />
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
                            <option
                              value="day-first"
                              aria-label="Day / month / year"
                            >
                              DD/MM/YYYY
                            </option>
                            <option
                              value="month-first"
                              aria-label="Month / day / year"
                            >
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
                          {[
                            "Barclays",
                            "American Express",
                            "Revolut",
                            "Other",
                          ].map((b) => (
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
                              (account) =>
                                account.id === entry.accountOverride?.id,
                            ) && (
                              <option value={entry.accountOverride.id}>
                                {entry.accountOverride.displayName} ·{" "}
                                {entry.accountOverride.maskedAccountIdentifier}{" "}
                                · {entry.accountOverride.currency}
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
                    <button
                      disabled={busy}
                      onClick={() =>
                        patch({
                          manualPeriod: !entry.manualPeriod,
                          optionsChanged: true,
                        })
                      }
                    >
                      {entry.manualPeriod
                        ? "Use detected statement dates"
                        : "Enter statement dates from the source file"}
                    </button>
                    {entry.manualPeriod && (
                      <>
                        <p className="muted">
                          Copy both dates from this statement's header. Balance
                          validation still runs.
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
                            const currency = newAccountCurrency
                              .trim()
                              .toUpperCase();
                            if (!name)
                              throw new Error("Enter an account name.");
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
                          These details stay on your device and are saved only
                          when you confirm the import.
                        </p>
                        <div className="form-grid">
                          <label>
                            Account name
                            <input
                              disabled={busy}
                              value={newAccountName}
                              onChange={(event) =>
                                setNewAccountName(event.target.value)
                              }
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
                                setNewAccountSuffix(
                                  event.target.value.replace(/\D/g, ""),
                                )
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
                  </details>{" "}
                  {showRisk && d && (
                    <ImportRiskConfirmation
                      result={
                        d.parserReview && !d.parserFallback
                          ? d.parserReview
                          : undefined
                      }
                      currency={d.statement.currency}
                      reconciliation={validation}
                      warnings={d.warnings}
                      unreadPages={
                        d.statement.unreadPages ??
                        entry.extracted?.extraction?.unreadPages
                      }
                      busy={busy}
                      onCancel={() => setShowRisk(false)}
                      onConfirm={() => {
                        setShowRisk(false);
                        patch({
                          override: true,
                          draft: { ...d, reviewedWarnings: true },
                        });
                      }}
                    />
                  )}
                </>
              )}
            </div>
          )}
        </details>
        {workspace && (
          <StatementReviewWorkspace
            key={entry.id + workspace}
            entry={entry}
            accounts={accounts}
            busy={busy}
            initialSection={workspace}
            onClose={() => setWorkspace(undefined)}
            onContinue={() => {
              setWorkspace(undefined);
              setGuided(true);
            }}
            onDiagnostics={() => {
              setWorkspace(undefined);
              setDiagnostics(true);
              setDetailsVisited(true);
              if (detailsRef.current) detailsRef.current.open = true;
            }}
            onPrepareSource={onPrepareSource}
            onSourceAction={onSourceAction}
            onOptions={(change) => {
              if (onGuidedOptions) onGuidedOptions(change);
              else {
                patch(change);
                reparse(false);
              }
            }}
            onAccount={(account) => onCreateAccount?.(account)}
            onMapping={onMapping}
            onSaveTemplate={onSaveTemplate}
            reparse={reparse}
            correctSource={(row, { kind: _kind, ...values }) =>
              correctSource(row, values)
            }
          />
        )}
      </div>
    </details>
  );
}
