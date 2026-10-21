import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Account, ImportDraft } from "../domain/models";
import { formatUkDate } from "../domain/dates";
import { displayMoney } from "./generic-review-view";
import { validatePeriod } from "../parsers/period";
import {
  importBlockers,
  sourceReview,
  type FileReview,
} from "../import/review-model";
import { draftReconciliation } from "../import/pipeline";
import { statementMovements } from "../import/movements";
import {
  manualReviewRows,
  type ManualReviewRow,
} from "../import/manual-review";
import {
  sourceCorrectionRow,
  type SourceCorrectionTarget,
} from "../import/source-correction-target";
import {
  rowReviewDecision,
  selectedSourceReading,
} from "../import/generic/review-decision";
import type { LayoutMapping, RowReviewAction } from "../import/generic/types";
import { ImportReviewSheet } from "./ImportReviewSheet";
import { SourceRowCorrection } from "./SourceRowCorrection";
import { SourceCrop } from "./GenericReviewRow";
import { GenericColumnMapping } from "./GenericColumnMapping";
import { ImportAccountStep } from "./ImportAccountStep";
import { UKDateInput } from "./UKDateInput";
import "./StatementReviewWorkspace.css";

export type ReviewSection =
  "overview" | "transactions" | "totals" | "reading" | "mapping";
type DraftRow = ImportDraft["transactions"][number];
export function StatementReviewWorkspace({
  entry,
  accounts,
  busy,
  initialSection = "overview",
  onClose,
  onContinue,
  onDiagnostics,
  onPrepareSource,
  onSourceAction,
  onOptions,
  onAccount,
  onMapping,
  onSaveTemplate,
  reparse,
  correctSource,
}: {
  entry: FileReview;
  accounts: Account[];
  busy: boolean;
  initialSection?: ReviewSection;
  onClose: () => void;
  onContinue: () => void;
  onDiagnostics: () => void;
  onPrepareSource?: () => void;
  onSourceAction?: (rowId: string, action: RowReviewAction) => void;
  onOptions: (change: Partial<FileReview>) => void;
  onAccount: (account: Account) => void;
  onMapping?: (mapping: LayoutMapping) => void;
  onSaveTemplate?: (name: string, mapping: LayoutMapping) => void;
  reparse: (ocr: boolean) => void;
  correctSource: (
    row: DraftRow,
    action: Extract<RowReviewAction, { kind: "correct" }>,
  ) => void;
}) {
  const [section, setSection] = useState<ReviewSection>(initialSection);
  const [identity, setIdentity] = useState(false),
    [dates, setDates] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [target, setTarget] = useState<SourceCorrectionTarget>();
  const [all, setAll] = useState(false),
    [limit, setLimit] = useState(20);
  const draft = entry.draft,
    result = sourceReview(entry);
  const rows = manualReviewRows(entry),
    pending = rows.filter((row) => row.needsAttention);
  const currency =
    draft?.statement.currency ??
    entry.accountOverride?.currency ??
    result?.parsed?.currency;
  const sourceId =
    target && result && !draft?.parserFallback
      ? sourceCorrectionRow(result, target)
      : selected;
  const active = rows.find((row) => row.id === sourceId);
  const back = () => {
    setSelected(undefined);
    setTarget(undefined);
  };
  const choose = (row: ManualReviewRow) => {
    if (
      row.transaction &&
      (row.transaction.duplicate !== "none" ||
        row.transaction.manualReplacementId)
    ) {
      onContinue();
      return;
    }
    if (draft?.bankSource && row.transaction && onPrepareSource) {
      setTarget(row.transaction);
      onPrepareSource();
    } else {
      setTarget(undefined);
      setSelected(row.id);
    }
  };
  const changeSection = (next: ReviewSection) => {
    setSection(next);
    if (
      draft?.bankSource &&
      (next === "mapping" ||
        (next === "transactions" &&
          draft.bankSource.sourceCoverageIssues.some((issue) =>
            /Some printed transaction rows were not fully matched|Some printed running balances were not read/.test(
              issue,
            ),
          )))
    )
      onPrepareSource?.();
  };
  if (identity)
    return (
      <ImportAccountStep
        entry={{
          ...entry,
          accountId: entry.accountId || draft?.account.id || "",
        }}
        accounts={
          draft && !accounts.some((a) => a.id === draft.account.id)
            ? [...accounts, draft.account]
            : accounts
        }
        busy={busy}
        mode="account"
        onAccount={(account) => {
          setIdentity(false);
          onAccount(account);
        }}
        onOptions={(change) => {
          setIdentity(false);
          onOptions(change);
        }}
        onClose={() => setIdentity(false)}
      />
    );
  if (dates)
    return (
      <StatementDates
        entry={entry}
        busy={busy}
        onClose={() => setDates(false)}
        onSave={(change) => {
          setDates(false);
          onOptions(change);
        }}
      />
    );
  if (!busy && active) {
    const reading = active.source
      ? selectedSourceReading(active.source)
      : active.transaction;
    return (
      <SourceRowCorrection
        key={active.id}
        reading={reading && { ...reading, parseSource: "text" }}
        fields={
          active.source ? rowReviewDecision(active.source).fields : undefined
        }
        reason={
          active.source
            ? rowReviewDecision(active.source).reason
            : "Check this amount against your original PDF."
        }
        currency={currency}
        busy={busy}
        progress={
          draft
            ? `${draft.statement.institution} · ${draft.account.maskedAccountIdentifier}`
            : undefined
        }
        saveLabel="Save correction"
        source={
          active.source ? (
            <SourceCrop
              session={entry.extracted?.pdfSession}
              rect={active.source.rect}
            />
          ) : null
        }
        onCancel={back}
        onSave={(action) => {
          if (active.source) onSourceAction?.(active.id, action);
          else if (active.transaction)
            correctSource(active.transaction, action);
          back();
        }}
      />
    );
  }
  const checking =
    busy && (!!selected || !!target || (section === "mapping" && !result));
  const titles: Record<ReviewSection, string> = {
    overview: "Statement overview",
    transactions: "Check transactions",
    totals: "Statement totals",
    reading: "Reading options",
    mapping: "Identify columns",
  };
  const action = (label: string, detail: string, click: () => void) => (
    <button
      type="button"
      className="statement-task"
      disabled={busy}
      onClick={click}
    >
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <ChevronRight size={18} aria-hidden="true" />
    </button>
  );
  const visible = all || !pending.length ? rows : pending;
  const validation = draft && draftReconciliation(draft);
  const movements =
    draft && statementMovements(draft.transactions, draft.statement.currency);
  return (
    <ImportReviewSheet
      title={checking ? "Checking your changes" : titles[section]}
      onClose={onClose}
      closeLabel="Close statement review"
      footer={
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={importBlockers(entry).length ? onContinue : onClose}
        >
          {importBlockers(entry).length ? "Continue review" : "Done"}
        </button>
      }
    >
      <div className="statement-review-workspace">
        {checking ? (
          <p role="status">
            Checking this statement. Your other PDFs stay in this batch.
          </p>
        ) : (
          <>
            {section !== "overview" && (
              <button
                className="statement-back"
                type="button"
                onClick={() => setSection("overview")}
              >
                Back to overview
              </button>
            )}
            <p className="statement-account">
              {draft
                ? `${draft.statement.institution} · ${draft.account.maskedAccountIdentifier}`
                : "Statement review"}
            </p>
            {busy && <p role="status">Rechecking this statement…</p>}
            {section === "overview" && (
              <>
                <p>
                  {pending.length
                    ? `${pending.length} transaction${pending.length === 1 ? " needs" : "s need"} checking.`
                    : `${rows.length} transactions read.`}{" "}
                  {validation?.status === "warning"
                    ? "The statement totals still need checking."
                    : ""}
                </p>
                <div className="statement-task-list">
                  {action(
                    "Check transactions",
                    "Tap a row to correct its amount or date",
                    () => changeSection("transactions"),
                  )}
                  {action(
                    "Statement totals",
                    "Compare the reported and calculated figures",
                    () => setSection("totals"),
                  )}
                  {action(
                    "Reading options",
                    "Account, dates or an unfamiliar layout",
                    () => setSection("reading"),
                  )}
                </div>
                <details className="statement-more">
                  <summary>Source and technical tools</summary>
                  <p className="statement-filename">{entry.file.name}</p>
                  <p>
                    Diagnostic information for investigating a reading problem.
                  </p>
                  <button type="button" onClick={onDiagnostics}>
                    Open diagnostic tools
                  </button>
                </details>
              </>
            )}
            {section === "transactions" && (
              <>
                {target && !active && !busy && (
                  <p role="status">
                    Choose the matching original row below. The source could not
                    be matched uniquely.
                  </p>
                )}
                <p>
                  Tap the transaction itself. Only its correction editor opens;
                  categories can wait until after import.
                </p>
                <div
                  className="statement-row-filters"
                  role="group"
                  aria-label="Review rows"
                >
                  <button
                    type="button"
                    aria-pressed={!all}
                    onClick={() => {
                      setAll(false);
                      setLimit(20);
                    }}
                  >
                    To check ({pending.length})
                  </button>
                  <button
                    type="button"
                    aria-pressed={all}
                    onClick={() => {
                      setAll(true);
                      setLimit(20);
                    }}
                  >
                    All ({rows.length})
                  </button>
                </div>
                {!pending.length && !all && (
                  <p role="status">
                    No unread fields. You can still inspect any transaction
                    below.
                  </p>
                )}
                <div className="statement-row-list">
                  {visible.slice(0, limit).map((row) => (
                    <button
                      className="statement-row"
                      type="button"
                      key={row.id}
                      disabled={busy}
                      onClick={() => choose(row)}
                    >
                      <span>
                        <strong>{row.description}</strong>
                        <small>
                          {row.date ? formatUkDate(row.date) : "Date not read"}{" "}
                          · {row.label}
                        </small>
                      </span>
                      <span className="amount">
                        {row.amount === undefined
                          ? "Not read"
                          : displayMoney(row.amount, currency, true)}
                      </span>
                    </button>
                  ))}
                </div>
                {visible.length > limit && (
                  <button
                    type="button"
                    onClick={() => setLimit((count) => count + 20)}
                  >
                    Show next transactions
                  </button>
                )}
              </>
            )}
            {section === "totals" && (
              <>
                <p>
                  {validation?.status === "reconciled"
                    ? "The statement reconciles."
                    : "Compare these figures with the original statement. Correcting a row rechecks the totals."}
                </p>
                <dl className="statement-figures">
                  {[
                    ["Opening balance", draft?.statement.openingBalance],
                    ["Money in", movements?.moneyIn],
                    ["Money out", movements ? -movements.moneyOut : undefined],
                    [
                      "Reported closing balance",
                      validation?.reported ?? draft?.statement.closingBalance,
                    ],
                    ["Calculated closing balance", validation?.calculated],
                    ["Difference", validation?.difference],
                    ["Money-in difference", result?.checks.moneyInDifference],
                    ["Money-out difference", result?.checks.moneyOutDifference],
                  ].map(
                    ([label, value]) =>
                      typeof value === "number" && (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd className="amount">
                            {displayMoney(value, currency)}
                          </dd>
                        </div>
                      ),
                  )}
                </dl>
                {action(
                  "Correct a transaction",
                  "Open a row and copy the amount from the PDF",
                  () => {
                    setAll(true);
                    changeSection("transactions");
                  },
                )}
                <p>
                  Transfers are included in statement totals. They remain
                  excluded from income and spending analysis.
                </p>
              </>
            )}
            {section === "reading" && (
              <div className="statement-task-list">
                {action(
                  "Account",
                  draft
                    ? `${draft.account.institution} ${draft.account.maskedAccountIdentifier}`
                    : "Identify this statement's account",
                  () => setIdentity(true),
                )}
                {action(
                  "Statement dates",
                  "Copy the dates printed on the PDF",
                  () => setDates(true),
                )}
                {action(
                  "Transaction columns",
                  "For a new or changed statement layout",
                  () => changeSection("mapping"),
                )}
                {action(
                  "Read statement again",
                  "Retry with the current settings",
                  () => reparse(false),
                )}
                {!entry.extracted?.format &&
                  action(
                    "Read a scanned PDF",
                    "Use local image recognition if the PDF has no usable text",
                    () => reparse(true),
                  )}
              </div>
            )}
            {section === "mapping" &&
              (result && currency && onMapping && onSaveTemplate ? (
                <>
                  <GenericColumnMapping
                    result={result}
                    currency={currency}
                    busy={busy}
                    guided
                    onMapping={onMapping}
                    onSaveTemplate={onSaveTemplate}
                  />
                </>
              ) : (
                <p>
                  Identify the statement account and currency in Reading options
                  before adjusting its columns.
                </p>
              ))}
          </>
        )}
      </div>
    </ImportReviewSheet>
  );
}

function StatementDates({
  entry,
  busy,
  onClose,
  onSave,
}: {
  entry: FileReview;
  busy: boolean;
  onClose: () => void;
  onSave: (change: Partial<FileReview>) => void;
}) {
  const [start, setStart] = useState(
    entry.periodStart || entry.draft?.statement.statementPeriodStart || "",
  );
  const [end, setEnd] = useState(
    entry.periodEnd || entry.draft?.statement.statementPeriodEnd || "",
  );
  const [error, setError] = useState("");
  return (
    <ImportReviewSheet title="Statement dates" onClose={onClose}>
      <div className="statement-review-workspace">
        <p>
          Use the dates printed on the statement. The figures will be checked
          again.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            try {
              validatePeriod({ start, end });
              onSave({
                manualPeriod: true,
                periodStart: start,
                periodEnd: end,
              });
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Check the statement dates.",
              );
            }
          }}
        >
          <label>
            Start date
            <UKDateInput
              value={start}
              onChange={setStart}
              required
              disabled={busy}
            />
          </label>
          <label>
            End date
            <UKDateInput
              value={end}
              onChange={setEnd}
              required
              disabled={busy}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button type="submit" className="primary" disabled={busy}>
            Save dates and recheck
          </button>
        </form>
      </div>
    </ImportReviewSheet>
  );
}
