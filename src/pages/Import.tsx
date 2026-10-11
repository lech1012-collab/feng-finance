import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, CheckCircle2, Upload, X } from "lucide-react";
import { db } from "../storage/database";
import {
  extractFile,
  prepareDraft,
  draftReconciliation,
} from "../import/pipeline";
import { commitReviewedBatch, type BatchOutcome } from "../import/batch";
import { importBlockers, type FileReview } from "../import/review-model";
import { ImportStatementReview } from "../components/ImportStatementReview";
import { validatePeriod } from "../parsers/period";
import { id } from "../domain/normalize";
import type { ImportDraft } from "../domain/models";
import { statementBalanceDate } from "../analytics/statement-balances";
import { CsvMappingPanel } from "../components/CsvMappingPanel";
import { STATEMENT_FILE_ACCEPT, type CsvMapping } from "../import/formats";
import type { Account } from "../domain/models";
import { authorizeMonthEdit } from "../storage/month-review";
import { previewImportTransfers } from "../import/transfer-review";
import { ImportTransferReview } from "../components/ImportTransferReview";
import { importMonthGuardDates } from "../import/month-guards";

export default function ImportPage({
  onImported,
  selectedFiles,
  onFilesStarted,
}: {
  selectedFiles?: File[];
  onFilesStarted?: () => void;
  onImported: (month: string, currency: string) => void;
}) {
  const [entries, setEntries] = useState<FileReview[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"pick" | "check" | "review" | "done">(
    "pick",
  );
  const [error, setError] = useState("");
  const [commitStatus, setCommitStatus] = useState("");
  const [selectedTransferIds, setSelectedTransferIds] = useState<string[]>([]);
  const [rejectedAutomaticIds, setRejectedAutomaticIds] = useState<string[]>(
    [],
  );
  const initialTransferLinkIds = useRef(new Set<string>());
  const navigate = useNavigate();
  const accounts = useLiveQuery(
    () => db.accounts.filter((a) => !a.isDemo).toArray(),
    [],
  );
  const categories = useLiveQuery(
    () => db.categories.filter((c) => !c.archived && !c.parentId).toArray(),
    [],
  );
  const history = useLiveQuery(
    () => db.statements.filter((s) => !s.isDemo).toArray(),
    [],
  );
  const savedMappings = useLiveQuery(async () => {
    const result: Record<string, CsvMapping> = {};
    for (const setting of await db.settings
      .filter((row) => row.key.startsWith("csv-mapping:"))
      .toArray()) {
      try {
        result[setting.key.slice("csv-mapping:".length)] = JSON.parse(
          setting.value,
        ) as CsvMapping;
      } catch {
        /* Invalid saved mappings are reviewed again. */
      }
    }
    return result;
  }, []);
  const operation = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      operation.current++;
    };
  }, []);
  const patchEntry = (entryId: string, patch: Partial<FileReview>) => {
    if (alive.current)
      setEntries((current) =>
        current.map((entry) =>
          entry.id === entryId ? { ...entry, ...patch } : entry,
        ),
      );
  };
  const patchReviewEntry = (entryId: string, patch: Partial<FileReview>) => {
    setEntries((current) => {
      const previous = current.find((entry) => entry.id === entryId);
      if (!previous) return current;
      const rowIdentity = (draft: ImportDraft) =>
        JSON.stringify(
          draft.transactions.map((t) => [
            t.date,
            t.amount,
            t.include,
            t.balanceAfterTransaction,
          ]),
        );
      const changedSelection =
        (patch.skip !== undefined && patch.skip !== previous.skip) ||
        (patch.draft &&
          previous.draft &&
          rowIdentity(patch.draft) !== rowIdentity(previous.draft));
      return current.map((entry) => {
        if (entry.id === entryId) return { ...entry, ...patch };
        if (
          !changedSelection ||
          !previous.draft ||
          !entry.draft ||
          entry.state === "saved" ||
          entry.skip
        )
          return entry;
        const a = previous.draft.account;
        const b = entry.draft.account;
        const sameAccount =
          a.institution === b.institution &&
          a.currency === b.currency &&
          a.accountType === b.accountType &&
          a.maskedAccountIdentifier === b.maskedAccountIdentifier;
        const overlap =
          previous.draft.statement.statementPeriodStart <=
            entry.draft.statement.statementPeriodEnd &&
          previous.draft.statement.statementPeriodEnd >=
            entry.draft.statement.statementPeriodStart;
        return sameAccount && overlap
          ? { ...entry, requiresBatchRecheck: true, open: true }
          : entry;
      });
    });
  };
  const processEntry = async (
    entry: FileReview,
    token: number,
    ocr = false,
    reuse = false,
    pendingDrafts: ImportDraft[] = [],
  ) => {
    patchEntry(entry.id, {
      state: "checking",
      error: "",
      progress: "Checking this statement…",
    });
    let extracted = entry.extracted;
    try {
      const period = entry.manualPeriod
        ? validatePeriod({ start: entry.periodStart, end: entry.periodEnd })
        : undefined;
      extracted =
        reuse && extracted
          ? extracted
          : await extractFile(
              entry.file,
              (progress) => patchEntry(entry.id, { progress }),
              ocr,
            );
      if (!alive.current || token !== operation.current) return;
      patchEntry(entry.id, { extracted });
      const draft = await prepareDraft(
        extracted,
        entry.bank || undefined,
        accounts?.find((a) => a.id === entry.accountId) ??
          entry.accountOverride,
        period,
        pendingDrafts,
        entry.csvMapping,
      );
      if (!alive.current || token !== operation.current) return;
      const needsReview =
        !draft.exactDuplicate &&
        (draftReconciliation(draft).status === "warning" ||
          draft.warnings.length > 0 ||
          draft.transactions.some(
            (t) => t.include && t.extractionConfidence < 0.8,
          ));
      patchEntry(entry.id, {
        draft,
        extracted,
        state: "review",
        progress: "Ready to review",
        open: needsReview,
        override: false,
        optionsChanged: false,
        invalidAmounts: [],
        showAll: false,
        duplicateInBatch: pendingDrafts.some(
          (pending) =>
            pending.statement.sourceFileHash === draft.statement.sourceFileHash,
        ),
        requiresBatchRecheck: false,
      });
      return draft;
    } catch (e) {
      if (!alive.current || token !== operation.current) return;
      patchEntry(entry.id, {
        state: "error",
        draft: undefined,
        extracted,
        error:
          e instanceof Error
            ? e.message
            : "The statement could not be read. No financial data was saved.",
        open: true,
        progress: "Couldn't read this statement",
      });
    }
  };
  const selectFiles = async (files: File[]) => {
    if (!files.length || busy) return;
    const token = ++operation.current;
    const selected: FileReview[] = files.map((file) => ({
      id: id(),
      file,
      state: "queued",
      progress: "Waiting to check",
      error: "",
      bank: "",
      accountId: "",
      manualPeriod: false,
      periodStart: "",
      periodEnd: "",
      optionsChanged: false,
      override: false,
      skip: false,
      open: false,
      showAll: false,
      invalidAmounts: [],
    }));
    setEntries(selected);
    setSelectedTransferIds([]);
    setRejectedAutomaticIds([]);
    setError("");
    setBusy(true);
    setPhase("check");
    initialTransferLinkIds.current = new Set(
      (await db.transferLinks.toArray()).map((link) => link.id),
    );
    const pendingDrafts: ImportDraft[] = [];
    for (const entry of selected) {
      if (!alive.current || token !== operation.current) return;
      const draft = await processEntry(
        entry,
        token,
        false,
        false,
        pendingDrafts,
      );
      if (draft && !draft.exactDuplicate) pendingDrafts.push(draft);
    }
    if (alive.current && token === operation.current) {
      setBusy(false);
      setPhase("review");
    }
  };
  const startedFiles = useRef<File[] | undefined>(undefined);
  useEffect(() => {
    if (selectedFiles?.length && startedFiles.current !== selectedFiles) {
      startedFiles.current = selectedFiles;
      void selectFiles(selectedFiles);
      onFilesStarted?.();
    }
  }, [selectedFiles]);
  const reparse = async (entry: FileReview, ocr: boolean) => {
    const token = ++operation.current;
    setBusy(true);
    setError("");
    setPhase("check");
    const pendingDrafts = entries
      .filter(
        (other) =>
          other.id !== entry.id &&
          !other.skip &&
          other.state !== "saved" &&
          other.draft &&
          !other.draft.exactDuplicate,
      )
      .map((other) => other.draft!);
    await processEntry(entry, token, ocr, !ocr, pendingDrafts);
    if (alive.current && token === operation.current) {
      setBusy(false);
      setPhase("review");
    }
  };
  const checkMappedCsv = (
    entry: FileReview,
    csvMapping: CsvMapping,
    account: Account,
  ) => {
    const changed = {
      ...entry,
      csvMapping,
      accountId: account.id,
      accountOverride: account,
      bank: account.institution,
    };
    patchEntry(entry.id, changed);
    void reparse(changed, false);
  };
  const active = entries.filter(
    (entry) => !entry.skip && entry.state !== "saved",
  );
  const transferReviewKey = JSON.stringify(
    active.flatMap((entry) =>
      entry.draft
        ? [
            entry.draft.account.id,
            entry.draft.exactDuplicate,
            entry.draft.duplicateOverride,
            ...entry.draft.transactions
              .filter((row) => row.include)
              .map((row) => [
                row.id,
                row.amount,
                row.currency,
                row.date,
                row.type,
                row.kind,
                row.isReviewed,
              ]),
          ]
        : [],
    ),
  );
  const transferPreview = useLiveQuery(
    () =>
      previewImportTransfers(
        active.filter((entry) => entry.draft).map((entry) => entry.draft!),
      ),
    [transferReviewKey],
  );
  const blocking = active.filter((entry) => importBlockers(entry).length > 0);
  const newCount = active.reduce(
    (n, entry) =>
      n +
      (!entry.draft ||
      (entry.draft.exactDuplicate && !entry.draft.duplicateOverride)
        ? 0
        : entry.draft.transactions.filter((t) => t.include).length),
    0,
  );
  const duplicateCount = active.reduce(
    (n, entry) =>
      n +
      (!entry.draft
        ? 0
        : entry.draft.exactDuplicate && !entry.draft.duplicateOverride
          ? entry.draft.transactions.length
          : entry.draft.transactions.filter(
              (t) => !t.include && t.duplicate !== "none",
            ).length),
    0,
  );
  const excludedCount = active.reduce(
    (n, entry) =>
      n +
      (!entry.draft ||
      (entry.draft.exactDuplicate && !entry.draft.duplicateOverride)
        ? 0
        : entry.draft.transactions.filter(
            (t) => !t.include && t.duplicate === "none",
          ).length),
    0,
  );
  const skippedFileCount = entries.filter((entry) => entry.skip).length;
  const balanceStatements = active.filter(
    (entry) =>
      entry.draft &&
      entry.draft.transactions.length === 0 &&
      !(entry.draft.exactDuplicate && !entry.draft.duplicateOverride) &&
      draftReconciliation(entry.draft).status === "reconciled",
  );
  const hasChanges = newCount > 0 || balanceStatements.length > 0;
  const sorted = [...entries].sort(
    (a, b) =>
      Number(importBlockers(b).length > 0) -
      Number(importBlockers(a).length > 0),
  );
  const save = async () => {
    if (busy || blocking.length || !hasChanges || !transferPreview) return;
    const confirmedTransferProposalIds = selectedTransferIds.filter(
      (id) =>
        transferPreview.proposals.some((proposal) => proposal.id === id) &&
        !transferPreview.automaticProposalIds.includes(id),
    );
    const rejectedTransferProposalIds = rejectedAutomaticIds.filter(
      (id) =>
        transferPreview.proposals.some((proposal) => proposal.id === id) &&
        !confirmedTransferProposalIds.includes(id),
    );
    const selected = active
      .filter((entry) => entry.draft)
      .map((entry) => ({
        id: entry.id,
        draft: {
          ...entry.draft!,
          confirmedTransferProposalIds,
          rejectedTransferProposalIds,
        },
        overrideValidation: entry.override,
      }));
    const selectedRows = selected.flatMap((item) =>
      item.draft.transactions.filter((row) => row.include),
    );
    const manualRows = (
      await db.transactions.bulkGet(
        selectedRows
          .filter((row) => row.replaceManual && row.manualReplacementId)
          .map((row) => row.manualReplacementId!),
      )
    ).filter((row) => !!row);
    const pairedIds = new Set(
      transferPreview.proposals
        .filter((proposal) =>
          confirmedTransferProposalIds.includes(proposal.id),
        )
        .flatMap((proposal) => [proposal.debitTxId, proposal.creditTxId]),
    );
    const pairedRows = transferPreview.transactions.filter((transaction) =>
      pairedIds.has(transaction.id),
    );
    if (
      !(await authorizeMonthEdit([
        ...(await importMonthGuardDates(selected.map((item) => item.draft))),
        ...manualRows,
        ...pairedRows,
      ]))
    )
      return;
    setBusy(true);
    setError("");
    let pendingId = "";
    const outcomes: BatchOutcome[] = [];
    try {
      await commitReviewedBatch(
        selected,
        (outcome) => {
          outcomes.push(outcome);
          patchEntry(outcome.id, {
            state: "saved",
            draft: outcome.draft,
            imported: outcome.imported,
            skipped: outcome.skipped,
            duplicatesSkipped: outcome.duplicatesSkipped,
            excludedUnique: outcome.excludedUnique,
            statementSkipped: outcome.statementSkipped,
            error: "",
            open: false,
          });
        },
        (entryId) => {
          pendingId = entryId;
          const entry = entries.find((entry) => entry.id === entryId);
          setCommitStatus(`Saving ${entry?.file.name ?? "statement"}…`);
        },
      );
      const allOutcomes = [
        ...entries
          .filter((entry) => entry.state === "saved" && entry.draft)
          .map((entry) => ({
            id: entry.id,
            draft: entry.draft!,
            imported: entry.imported ?? 0,
            skipped: entry.skipped ?? 0,
            duplicatesSkipped: entry.duplicatesSkipped ?? 0,
            excludedUnique: entry.excludedUnique ?? 0,
            statementSkipped: entry.statementSkipped ?? false,
          })),
        ...outcomes,
      ];
      const imported = allOutcomes.reduce(
        (n, outcome) => n + outcome.imported,
        0,
      );
      const skipped = allOutcomes.reduce(
        (n, outcome) => n + outcome.duplicatesSkipped,
        0,
      );
      const excluded = allOutcomes.reduce(
        (n, outcome) => n + outcome.excludedUnique,
        0,
      );
      const importedRows = allOutcomes.flatMap((outcome) =>
        outcome.imported
          ? outcome.draft.transactions.filter((t) => t.include)
          : [],
      );
      const updatedStatements = allOutcomes.filter(
        (outcome) => !outcome.statementSkipped,
      );
      const latest = [
        ...importedRows.map((t) => t.date),
        ...updatedStatements.map((outcome) =>
          statementBalanceDate(outcome.draft.statement),
        ),
      ]
        .sort()
        .at(-1);
      if (latest) {
        const currency =
          importedRows.find((t) => t.date === latest)?.currency ??
          updatedStatements.find(
            (outcome) =>
              statementBalanceDate(outcome.draft.statement) === latest,
          )!.draft.statement.currency;
        onImported(latest.slice(0, 7), currency);
      }
      const toSort = await db.transactions
        .filter(
          (t) =>
            !t.isDemo &&
            !t.categoryId &&
            !t.isTransfer &&
            t.type !== "transfer",
        )
        .count();
      const importedIds = new Set(importedRows.map((row) => row.id));
      const automaticallyLinkedCount = await db.transferLinks
        .filter(
          (link) =>
            !link.manual &&
            !initialTransferLinkIds.current.has(link.id) &&
            link.transactionIds.some((id) => importedIds.has(id)),
        )
        .count();
      setPhase("done");
      navigate("/", {
        replace: true,
        state: {
          importedCount: imported,
          duplicateCount: skipped,
          excludedCount: excluded,
          skippedFileCount,
          updatedStatementCount: updatedStatements.length,
          sortCount: toSort,
          automaticallyLinkedCount,
        },
      });
    } catch (e) {
      const reason =
        e instanceof Error
          ? e.message
          : "Import failed. Your existing data is safe.";
      const saved = outcomes.reduce((n, outcome) => n + outcome.imported, 0);
      const priorSaved = entries.reduce(
        (n, entry) => n + (entry.imported ?? 0),
        0,
      );
      setError(
        `${saved + priorSaved ? `${saved + priorSaved} transaction${saved + priorSaved === 1 ? " was" : "s were"} safely saved. ` : "No transactions were saved. "}${reason} Review the remaining files and retry; saved statements will not be imported twice.`,
      );
      patchEntry(pendingId, { error: reason, open: true });
    } finally {
      if (alive.current) {
        setBusy(false);
        setCommitStatus("");
      }
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            {entries.length
              ? `Review ${entries.length} statement${entries.length === 1 ? "" : "s"}`
              : "Import statements"}
          </h1>
        </div>
        {entries.length > 0 && (
          <Link className="icon-button" to="/" aria-label="Close import review">
            <X size={20} />
          </Link>
        )}
      </div>
      <ol className="import-steps" aria-label="Import progress">
        {(["pick", "check", "review", "done"] as const).map((step, index) => (
          <li key={step} aria-current={phase === step ? "step" : undefined}>
            <span>{index + 1}</span>
            {step === "pick"
              ? "Pick"
              : step === "check"
                ? "Check"
                : step === "review"
                  ? "Review"
                  : "Done"}
          </li>
        ))}
      </ol>
      {entries.length === 0 && (
        <section
          className="card upload-card"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = busy ? "none" : "copy";
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy) void selectFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <Upload size={28} />
          <h2>Add your statements</h2>
          <p>
            Select or drop PDF statements or CSV, OFX, QFX and QIF exports.
            We’ll check the numbers and highlight anything that needs you.
          </p>
          <label
            className={`button primary file-button ${busy ? "disabled" : ""}`}
          >
            <Upload size={18} />
            Select statements
            <input
              aria-label="Select statements"
              type="file"
              accept={STATEMENT_FILE_ACCEPT}
              multiple
              disabled={busy}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                void selectFiles(files);
              }}
            />
          </label>
          <p className="muted">
            Digital PDFs work best. Scanned pages use local OCR. Up to 30 MB /
            100 pages per PDF.
          </p>
        </section>
      )}
      {entries.length > 0 && (
        <div className="import-change-files">
          <label className={`button file-button ${busy ? "disabled" : ""}`}>
            Choose different statements
            <input
              aria-label="Select statements"
              type="file"
              accept={STATEMENT_FILE_ACCEPT}
              multiple
              disabled={busy}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                void selectFiles(files);
              }}
            />
          </label>
          <span className="muted">Nothing is saved until you confirm.</span>
        </div>
      )}
      {phase === "check" && (
        <section
          className="card import-processing-list"
          aria-label="Checking statements"
        >
          <h2>Checking your statements</h2>
          {entries.map((entry) => (
            <div key={entry.id} className="import-processing-file">
              <span>
                {entry.state === "checking" ? (
                  <span className="spinner" />
                ) : entry.state === "review" ? (
                  <CheckCircle2 size={18} />
                ) : entry.state === "error" ? (
                  <AlertTriangle size={18} />
                ) : null}
                <strong>{entry.file.name}</strong>
              </span>
              <p role={entry.state === "checking" ? "status" : undefined}>
                {entry.draft
                  ? `Detected ${entry.draft.statement.institution} ${entry.draft.account.maskedAccountIdentifier} · ready`
                  : entry.progress}
              </p>
            </div>
          ))}
        </section>
      )}
      {error && (
        <div className="notice import-blocking-warning" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}
      {phase !== "check" && entries.length > 0 && (
        <div className="import-review-list">
          {sorted.map((entry) => (
            <div key={entry.id}>
              {entry.extracted?.csv &&
                (!entry.draft || entry.optionsChanged) && (
                  <CsvMappingPanel
                    table={entry.extracted.csv}
                    initial={
                      entry.csvMapping ??
                      entry.draft?.csvMapping ??
                      entry.extracted.preset
                    }
                    initialAccountId={entry.draft?.account.id}
                    accounts={[
                      ...(accounts ?? []),
                      ...(entry.draft &&
                      !accounts?.some(
                        (account) => account.id === entry.draft!.account.id,
                      )
                        ? [entry.draft.account]
                        : []),
                    ]}
                    savedMappings={savedMappings}
                    busy={busy}
                    onCheck={(mapping, account) =>
                      checkMappedCsv(entry, mapping, account)
                    }
                  />
                )}
              <ImportStatementReview
                key={entry.id}
                entry={entry}
                accounts={accounts ?? []}
                categories={categories ?? []}
                history={[
                  ...(history ?? []),
                  ...entries
                    .filter(
                      (other) =>
                        other.id !== entry.id &&
                        !other.skip &&
                        other.draft &&
                        !other.draft.exactDuplicate &&
                        other.state !== "saved",
                    )
                    .map((other) => other.draft!.statement),
                ]}
                busy={busy}
                patch={(patch) => patchReviewEntry(entry.id, patch)}
                reparse={(ocr) => void reparse(entry, ocr)}
              />
            </div>
          ))}
        </div>
      )}
      {phase === "review" && transferPreview && (
        <ImportTransferReview
          preview={transferPreview}
          selectedIds={selectedTransferIds}
          onChange={setSelectedTransferIds}
          rejectedAutomaticIds={rejectedAutomaticIds}
          onRejectedAutomaticChange={setRejectedAutomaticIds}
          busy={busy}
        />
      )}
      {entries.length > 0 && (
        <div className="import-footer import-outcome-footer">
          <div aria-live="polite">
            <strong>
              {newCount} new · {duplicateCount} duplicate
              {duplicateCount === 1 ? "" : "s"} skipped
              {balanceStatements.length > 0 &&
                ` · ${balanceStatements.length} balance update${balanceStatements.length === 1 ? "" : "s"}`}
              {excludedCount > 0 && ` · ${excludedCount} excluded`}
              {skippedFileCount > 0 &&
                ` · ${skippedFileCount} file${skippedFileCount === 1 ? "" : "s"} skipped`}
            </strong>
            <span>
              {phase === "check"
                ? "Checking every selected file before review"
                : blocking.length
                  ? `${blocking.length} statement${blocking.length === 1 ? "" : "s"} need${blocking.length === 1 ? "s" : ""} attention`
                  : "Ready to import selected rows"}
            </span>
            {commitStatus && <span role="status">{commitStatus}</span>}
          </div>
          {!hasChanges && !blocking.length && phase === "review" ? (
            <button
              disabled={busy}
              onClick={() => navigate("/", { replace: true })}
            >
              Back to Home
            </button>
          ) : (
            <button
              className="primary"
              disabled={
                busy || !!blocking.length || !hasChanges || !transferPreview
              }
              onClick={() => void save()}
            >
              Confirm import
            </button>
          )}
        </div>
      )}
    </>
  );
}
