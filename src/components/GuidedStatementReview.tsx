import { useState } from "react";
import type { Account, ImportDraft } from "../domain/models";
import { formatUkDate } from "../domain/dates";
import { money } from "../domain/money";
import { displayMerchant } from "../domain/presentation";
import { guidedReviewStep } from "../import/guided-review";
import {
  fieldCorrections,
  rowReviewDecision,
} from "../import/generic/review-decision";
import {
  importBlockers,
  invalidSourceRows,
  sourceReview,
  type FileReview,
} from "../import/review-model";
import { draftReconciliation } from "../import/pipeline";
import type { RowReviewAction } from "../import/generic/types";
import { selectedReading } from "./generic-review-view";
import { SourceCrop } from "./GenericReviewRow";
import { SourceRowCorrection } from "./SourceRowCorrection";
import { ImportReviewSheet } from "./ImportReviewSheet";
import { ImportAccountStep } from "./ImportAccountStep";
import { ImportRiskConfirmation } from "./ImportRiskConfirmation";

type DraftRow = ImportDraft["transactions"][number];
export function GuidedStatementReview({
  entry,
  accounts,
  busy,
  patch,
  onAccount,
  onOptions,
  onSourceAction,
  onPrepareSource,
  onCorrectTransaction,
  onDetails,
  onClose,
}: {
  entry: FileReview;
  accounts: Account[];
  busy: boolean;
  patch: (change: Partial<FileReview>) => void;
  onAccount: (account: Account) => void;
  onOptions: (change: Partial<FileReview>) => void;
  onSourceAction?: (rowId: string, action: RowReviewAction) => void;
  onPrepareSource?: () => void;
  onCorrectTransaction: (
    row: DraftRow,
    action: Extract<RowReviewAction, { kind: "correct" }>,
  ) => void;
  onDetails: () => void;
  onClose: () => void;
}) {
  const [completed, setCompleted] = useState(0);
  const [warningIndex, setWarningIndex] = useState(0);
  const [risk, setRisk] = useState(false);
  const [excludeRow, setExcludeRow] = useState(false);
  const [reviewLargeQueue, setReviewLargeQueue] = useState(false);
  const step = guidedReviewStep(entry, reviewLargeQueue);
  const result = sourceReview(entry);
  const d = entry.draft;
  const currency =
    d?.statement.currency ??
    entry.accountOverride?.currency ??
    result?.parsed?.currency;
  const validation = d && draftReconciliation(d);
  const updateRow = (row: DraftRow, change: Partial<DraftRow>) =>
    d &&
    patch({
      draft: {
        ...d,
        transactions: d.transactions.map((t) =>
          t.id === row.id ? { ...t, ...change } : t,
        ),
      },
    });
  const details = () => {
    onClose();
    onDetails();
  };
  const filename = <p className="import-guided-filename">{entry.file.name}</p>;
  if (busy)
    return (
      <ImportReviewSheet
        title="Checking your changes"
        onClose={onClose}
        closeLabel="Pause statement review"
      >
        <div className="import-guided-content">
          {filename}
          <p role="status">
            Rechecking this statement. Your other files stay in this review.
          </p>
        </div>
      </ImportReviewSheet>
    );
  if ((risk || step.kind === "account-confirmation") && d)
    return (
      <ImportRiskConfirmation
        result={d.parserFallback ? undefined : result}
        currency={currency}
        reconciliation={validation}
        busy={busy}
        warnings={d.warnings.map((warning) =>
          warning ===
            "The statement account, dates or currency require review." &&
          !d.bankSource?.parsed.accountIdentifier
            ? `The account number could not be read. You linked this statement to ${d.account.institution} ${d.account.displayName} ${d.account.maskedAccountIdentifier}. Check that it belongs to this account. Its figures will remain labelled unverified.`
            : warning,
        )}
        unreadPages={
          d.statement.unreadPages ?? entry.extracted?.extraction?.unreadPages
        }
        onCancel={() => {
          setRisk(false);
          if (step.kind === "account-confirmation") onClose();
        }}
        onConfirm={() => {
          setRisk(false);
          patch({ override: true, draft: { ...d, reviewedWarnings: true } });
        }}
      />
    );
  if (step.kind === "identity")
    return (
      <ImportAccountStep
        key={result?.errorCode}
        entry={entry}
        accounts={accounts}
        busy={busy}
        onAccount={onAccount}
        onOptions={onOptions}
        onClose={onClose}
      />
    );
  if (step.kind === "layout")
    return (
      <ImportReviewSheet
        title="Check statement layout"
        onClose={onClose}
        footer={
          <button type="button" className="primary" onClick={details}>
            Inspect statement layout
          </button>
        }
      >
        <div className="import-guided-content">
          {filename}
          <p>
            {step.count} rows have unread fields. This suggests a layout
            problem; you do not need to start retyping the whole statement.
          </p>
          <p>
            The source-row checks have already been attempted. Check the layout
            or leave this statement for later. Nothing has been imported.
          </p>
          <button type="button" onClick={() => setReviewLargeQueue(true)}>
            Review individual fields instead
          </button>
          <button type="button" onClick={onClose}>
            Finish reviewing later
          </button>
        </div>
      </ImportReviewSheet>
    );
  if (step.kind === "source-row" && !excludeRow)
    return (
      <SourceRowCorrection
        key={step.row.rowId}
        reading={selectedReading(step.row)}
        fields={rowReviewDecision(step.row).fields}
        reason={rowReviewDecision(step.row).reason}
        currency={currency}
        busy={busy}
        progress={`${d?.statement.institution ?? "Statement"} · ${d?.account.maskedAccountIdentifier ?? ""} · Transaction ${completed + 1} of ${completed + step.remaining} to check`}
        saveLabel="Save and continue"
        source={
          <>
            <SourceCrop
              session={entry.extracted?.pdfSession}
              rect={step.row.rect}
            />
          </>
        }
        otherOptions={
          <div className="import-guided-other">
            <p>
              Leaving out a source row changes the statement totals. Only do
              this for a heading, repeated row or other non-transaction.
            </p>
            <button type="button" onClick={() => setExcludeRow(true)}>
              Leave out this row…
            </button>
          </div>
        }
        onSave={(action) => {
          setCompleted((n) => n + 1);
          onSourceAction?.(step.row.rowId, action);
        }}
        onCancel={onClose}
      />
    );
  if (step.kind === "source-row" && excludeRow)
    return (
      <ImportReviewSheet
        title="Leave out this row?"
        onClose={() => setExcludeRow(false)}
        footer={
          <>
            <button type="button" onClick={() => setExcludeRow(false)}>
              Keep reviewing
            </button>
            <button
              type="button"
              onClick={() => {
                setExcludeRow(false);
                setCompleted((n) => n + 1);
                onSourceAction?.(step.row.rowId, { kind: "exclude" });
              }}
            >
              Leave out row
            </button>
          </>
        }
      >
        <div className="import-guided-content">
          <p>{selectedReading(step.row)?.description || "Unread row"}</p>
          <p>
            This row will not be imported. Feng will recheck the statement
            totals before you can continue.
          </p>
        </div>
      </ImportReviewSheet>
    );
  if (step.kind === "transaction" && d) {
    const row = step.row;
    if (row.manualReplacementId || row.duplicate !== "none")
      return (
        <ImportReviewSheet
          title={
            row.manualReplacementId
              ? "Matching manual entry"
              : "Check a possible duplicate"
          }
          onClose={onClose}
          closeLabel="Pause statement review"
        >
          <div className="import-guided-content">
            {filename}
            <p>
              <strong>{displayMerchant(row)}</strong>
            </p>
            <p>
              {formatUkDate(row.date)} · {money(row.amount, row.currency, true)}
            </p>
            {row.manualReplacementId ? (
              <>
                <p>
                  You have a similar manual entry. Replacing it avoids counting
                  it twice.
                </p>
                {(
                  row.manualReplacementCandidates ?? [
                    {
                      id: row.manualReplacementId,
                      date: row.date,
                      description: "manual entry",
                    },
                  ]
                ).map((candidate) => (
                  <button
                    type="button"
                    key={candidate.id}
                    onClick={() =>
                      updateRow(row, {
                        manualReplacementId: candidate.id,
                        replaceManual: true,
                        acknowledged: true,
                      })
                    }
                  >
                    Replace {candidate.description} ·{" "}
                    {formatUkDate(candidate.date)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    updateRow(row, { replaceManual: false, acknowledged: true })
                  }
                >
                  These are separate transactions — keep both
                </button>
              </>
            ) : (
              <>
                <p>
                  A similar transaction is already in your records. Keep both
                  only if this is a separate purchase.
                </p>
                <button
                  type="button"
                  className="primary"
                  onClick={() =>
                    updateRow(row, { include: false, acknowledged: true })
                  }
                >
                  Skip this duplicate
                </button>
                <button
                  type="button"
                  onClick={() => updateRow(row, { acknowledged: true })}
                >
                  Separate purchase — keep both
                </button>
              </>
            )}
          </div>
        </ImportReviewSheet>
      );
    if (d.bankSource && onPrepareSource)
      return (
        <ImportReviewSheet
          title="Check a transaction"
          onClose={onClose}
          footer={
            <button type="button" className="primary" onClick={onPrepareSource}>
              Open amount editor
            </button>
          }
        >
          <div className="import-guided-content">
            {filename}
            <p>{displayMerchant(row)}</p>
            <p>
              Feng will open the original PDF row so you can type the amount and
              recheck the figures.
            </p>
          </div>
        </ImportReviewSheet>
      );
    return (
      <SourceRowCorrection
        key={row.id}
        reading={{ ...row, parseSource: "text" }}
        currency={currency}
        busy={busy}
        progress="Check this transaction against the statement"
        saveLabel="Save and continue"
        source={<p>Original statement · page {row.sourcePage}</p>}
        onSave={(action) => onCorrectTransaction(row, action)}
        onCancel={onClose}
      />
    );
  }
  const warningCount = Math.max(1, d?.warnings.length ?? 0);
  const warning =
    d?.warnings[Math.min(warningIndex, Math.max(0, d.warnings.length - 1))] ??
    "A transaction date falls outside this statement's period. Check its date against the original PDF.";
  return (
    <ImportReviewSheet
      title={
        step.kind === "complete"
          ? "Statement checked"
          : step.kind === "warnings"
            ? "Check statement notice"
            : step.kind === "validation"
              ? "Check statement totals"
              : step.kind === "recheck"
                ? "Recheck statement"
                : step.kind === "mapping"
                  ? "Identify transaction columns"
                  : "Statement needs help"
      }
      onClose={onClose}
      closeLabel="Pause statement review"
      footer={
        step.kind === "complete" ? (
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        ) : step.kind === "warnings" && d ? (
          <button
            type="button"
            className="primary"
            onClick={() => {
              if (warningIndex + 1 < d.warnings.length)
                setWarningIndex((n) => n + 1);
              else patch({ draft: { ...d, reviewedWarnings: true } });
            }}
          >
            I checked this — continue
          </button>
        ) : step.kind === "recheck" ? (
          <button
            type="button"
            className="primary"
            onClick={() => onOptions({})}
          >
            Recheck statement
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={step.kind === "validation" ? onClose : details}
          >
            {step.kind === "mapping"
              ? "Set up columns"
              : step.kind === "validation"
                ? "Back to statements"
                : "Review statement details"}
          </button>
        )
      }
    >
      <div className="import-guided-content">
        {filename}
        {step.kind === "complete" && (
          <>
            <p>
              {entry.skip
                ? "This statement will be left out."
                : "All required checks are complete. Return to the batch to confirm your import."}
            </p>
            {entry.override && (
              <p className="warning-text">
                This statement remains unverified. Accepting it has not changed
                its figures.
              </p>
            )}
          </>
        )}
        {step.kind === "warnings" && (
          <>
            <p className="muted">
              Notice {Math.min(warningIndex + 1, warningCount)} of{" "}
              {warningCount}
            </p>
            <p>{warning}</p>
            <p>
              Compare this notice with your original statement. Continuing
              accepts this notice; it does not change any amounts.
            </p>
          </>
        )}
        {step.kind === "recheck" && (
          <p>
            Your changes need to be checked against the other selected
            statements before importing.
          </p>
        )}
        {step.kind === "mapping" && (
          <p>
            This layout needs its date, description and amount columns
            identified once. Known bank statements are checked automatically
            when their layout is recognised.
          </p>
        )}
        {step.kind === "validation" && (
          <>
            {result && fieldCorrections(result.rowChecks).length === 0 && (
              <p>
                {result.rowChecks.length} transactions read. No transaction
                fields need correction. The statement totals still need
                checking.
              </p>
            )}
            <p>
              These figures have not been independently verified. Check the
              original PDF before importing.
            </p>
            <dl className="totals">
              {[
                ["Reported closing balance", validation?.reported],
                ["Calculated closing balance", validation?.calculated],
                ["Difference", validation?.difference],
              ].map(
                ([label, value]) =>
                  typeof value === "number" && (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{money(value, currency ?? "GBP")}</dd>
                    </div>
                  ),
              )}
            </dl>
            <button type="button" onClick={details}>
              Inspect statement details
            </button>
            {result?.checks.unreadPages.length ? (
              <p>
                Pages {result.checks.unreadPages.join(", ")} have not been read.
                Their transactions will not be imported.
              </p>
            ) : null}
            <details className="import-guided-other">
              <summary>Accept unverified figures instead</summary>
              <p>
                Use this only after checking the original PDF. The statement
                will remain unverified.
              </p>
              <button
                type="button"
                disabled={
                  !d ||
                  (!!result && invalidSourceRows(result).length > 0) ||
                  entry.optionsChanged ||
                  !!entry.invalidAmounts.length
                }
                onClick={() => setRisk(true)}
              >
                Import anyway…
              </button>
            </details>
          </>
        )}
        {step.kind === "error" && (
          <p role="alert">{entry.error || importBlockers(entry)[0]}</p>
        )}
        <button type="button" className="import-guided-pause" onClick={onClose}>
          Finish reviewing later
        </button>
      </div>
    </ImportReviewSheet>
  );
}
