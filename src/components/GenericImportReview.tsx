import { useRef, useState } from "react";
import {
  displayMoney,
  validReading,
  selectedReading,
  methodLabel,
  type GenericImportReviewProps,
} from "./generic-review-view";
import { GenericReviewRow } from "./GenericReviewRow";
import { GenericColumnMapping } from "./GenericColumnMapping";
import { Sheet } from "./Sheet";
import { ImportRiskConfirmation } from "./ImportRiskConfirmation";
import "./GenericImportReview.css";
export type { GenericImportReviewProps } from "./generic-review-view";
export function GenericImportReview({
  result,
  session,
  currency = result.parsed?.currency,
  method,
  busy,
  onAction,
  onMapping,
  onSaveTemplate,
  onImportAnyway,
  canImportAnyway = !!result.parsed,
  showImportAnyway = true,
}: GenericImportReviewProps) {
  const [showMapping, setShowMapping] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const overrideRef = useRef<HTMLButtonElement>(null);
  const [visibleRows, setVisibleRows] = useState(10);
  const reviewedRows = result.rowChecks.filter(
    (row) =>
      row.checkLevel === "review" ||
      row.checkLevel === "manual_override" ||
      row.issues.length > 0 ||
      !!row.reviewAction,
  );
  const hasInvalidRows = result.rowChecks.some(
    (row) =>
      row.reviewAction?.kind !== "exclude" &&
      !validReading(selectedReading(row)),
  );
  const needsOverride =
    !result.checks.reconciledExactly || result.checks.needsReviewRows > 0;
  const chips = result.checks.needsReviewRows
    ? "Needs review"
    : result.checks.totalCheckedRows
      ? "Checked against statement total"
      : result.rowChecks.some((row) => row.parseSource === "ocr")
        ? "Read from image"
        : result.checks.reconciledExactly
          ? "Balance-checked"
          : "Unverified";
  return (
    <section
      className="generic-import-review"
      aria-label="Statement reading and checks"
    >
      <div className="generic-method-heading">
        <p>
          {methodLabel(method, result)} · {result.checks.balanceRowsPassed}{" "}
          balance-checked · {result.checks.totalCheckedRows} total-checked ·{" "}
          {result.checks.needsReviewRows} need review
        </p>
        <span className="small-chip">{chips}</span>
      </div>
      <div
        className={`generic-statement-proof ${result.checks.reconciledExactly ? "" : "generic-needs-review"}`}
        role="status"
      >
        <strong>
          {result.checks.reconciledExactly
            ? "Statement figures match exactly"
            : "This statement is not verified yet"}
        </strong>
        {result.checks.reconciliation.difference !== undefined && (
          <p>
            Balance difference:{" "}
            <span className="amount">
              {displayMoney(
                result.checks.reconciliation.difference,
                currency,
                true,
              )}
            </span>
            . Every penny must match.
          </p>
        )}
        {result.checks.moneyInDifference !== undefined &&
          result.checks.moneyInDifference !== 0 && (
            <p>
              Money-in difference:{" "}
              <span className="amount">
                {displayMoney(result.checks.moneyInDifference, currency, true)}
              </span>
            </p>
          )}
        {result.checks.moneyOutDifference !== undefined &&
          result.checks.moneyOutDifference !== 0 && (
            <p>
              Money-out difference:{" "}
              <span className="amount">
                {displayMoney(result.checks.moneyOutDifference, currency, true)}
              </span>
            </p>
          )}
        {result.checks.evidence.length === 0 && (
          <p>
            No independent balance or movement total is available to verify
            these rows.
          </p>
        )}
        {!!result.checks.unreadPages.length && (
          <p className="generic-unread-pages">
            Not imported: unread pages {result.checks.unreadPages.join(", ")}.
            Read these pages before relying on a complete statement.
          </p>
        )}
      </div>
      {result.errorCode === "template-changed" && (
        <p className="generic-layout-warning" role="alert">
          This statement layout has changed. Your saved layout no longer adds
          up. Check the column mapping.
        </p>
      )}
      {result.status === "identity-required" && (
        <p className="generic-layout-warning">
          Choose the matching account, statement dates and currency. The
          reconstructed rows remain available below.
        </p>
      )}
      {!!reviewedRows.length && (
        <details
          className="generic-review-list"
          open={result.checks.needsReviewRows > 0}
        >
          <summary>Needs review ({result.checks.needsReviewRows})</summary>
          <p>
            Compare each row with the original. Corrections recheck the
            statement immediately.
          </p>
          {reviewedRows.slice(0, visibleRows).map((row) => (
            <GenericReviewRow
              key={row.rowId}
              row={row}
              session={session}
              currency={currency}
              busy={busy}
              onAction={onAction}
            />
          ))}
          {reviewedRows.length > visibleRows && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setVisibleRows((count) => count + 10)}
            >
              Show next {Math.min(10, reviewedRows.length - visibleRows)} rows (
              {reviewedRows.length - visibleRows} remaining)
            </button>
          )}
        </details>
      )}
      <details
        className="generic-parser-details"
        open={result.status !== "parsed"}
      >
        <summary>Reading details</summary>
        <p>
          {result.checks.totalCheckedRows
            ? "The statement totals match, but this statement has no running balance to prove each individual row."
            : "A balance check compares each amount with the previous and reported running balance."}
        </p>
        <p>
          Reading from an image stays labelled even when its figures match.
          Manually accepted differences remain unverified.
        </p>
        {result.candidates.length > 1 && (
          <label>
            Compare possible column readings
            <select
              disabled={busy}
              value={result.selectedCandidateId ?? ""}
              onChange={(event) => {
                const candidate = result.candidates.find(
                  (entry) => entry.id === event.target.value,
                );
                if (candidate) onMapping(candidate.mapping);
              }}
            >
              {result.candidates.map((candidate, index) => (
                <option value={candidate.id} key={candidate.id}>
                  Reading {index + 1}
                </option>
              ))}
            </select>
          </label>
        )}
        {result.candidates.length > 1 &&
          (() => {
            const selected = result.candidates.find(
              (candidate) => candidate.id === result.selectedCandidateId,
            );
            return (
              selected && (
                <p>
                  {selected.checks.balanceRowsPassed} running balance
                  {selected.checks.balanceRowsPassed === 1
                    ? " matches"
                    : "s match"}
                  .
                  {selected.checks.needsReviewRows > 0
                    ? ` ${selected.checks.needsReviewRows} row${selected.checks.needsReviewRows === 1 ? " needs" : "s need"} review.`
                    : ""}{" "}
                  {selected.checks.reconciledExactly
                    ? "Statement figures match exactly."
                    : "Statement figures still need checking."}
                </p>
              )
            );
          })()}
        <button
          type="button"
          disabled={busy}
          aria-expanded={showMapping}
          onClick={() => setShowMapping((show) => !show)}
        >
          {showMapping
            ? "Close column mapping"
            : result.errorCode === "template-changed"
              ? "Check mapping"
              : "Map columns"}
        </button>
        {showMapping && (
          <Sheet title="Map columns" onClose={() => setShowMapping(false)}>
            <GenericColumnMapping
              currency={currency}
              result={result}
              busy={busy}
              onMapping={onMapping}
              onSaveTemplate={onSaveTemplate}
            />
          </Sheet>
        )}
      </details>
      {needsOverride && showImportAnyway && (
        <div className="generic-override">
          <p>
            Resolve the rows and make the figures match, or explicitly import an
            unverified statement.
          </p>
          {hasInvalidRows && (
            <p>
              Correct or exclude unread dates, descriptions and amounts first.
              They cannot be imported.
            </p>
          )}
          <button
            type="button"
            disabled={busy || !canImportAnyway || hasInvalidRows}
            ref={overrideRef}
            onClick={() => {
              overrideRef.current?.focus();
              setShowOverride(true);
            }}
          >
            Import anyway…
          </button>
        </div>
      )}
      {showOverride && (
        <ImportRiskConfirmation
          currency={currency}
          result={result}
          busy={busy}
          onCancel={() => setShowOverride(false)}
          onConfirm={() => {
            setShowOverride(false);
            onImportAnyway();
          }}
        />
      )}
    </section>
  );
}
