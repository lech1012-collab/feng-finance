import {
  sourceCorrectionRow,
  type SourceCorrectionTarget,
} from "../import/source-correction-target";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, CheckCircle2, Upload, X } from "lucide-react";
import { db } from "../storage/database";
import {
  extractFile,
  prepareDraft,
  draftReconciliation,
  savePdfLayout,
  type PdfReviewOptions,
} from "../import/pipeline";
import { commitReviewedBatch, type BatchOutcome } from "../import/batch";
import {
  importBlockers,
  sourceReview,
  type FileReview,
} from "../import/review-model";
import { ImportStatementReview } from "../components/ImportStatementReview";
import { validatePeriod } from "../parsers/period";
import { id, transactionKey } from "../domain/normalize";
import type { ImportDraft } from "../domain/models";
import { statementBalanceDate } from "../analytics/statement-balances";
import { CsvMappingPanel } from "../components/CsvMappingPanel";
import { STATEMENT_FILE_ACCEPT, type CsvMapping } from "../import/formats";
import type { Account } from "../domain/models";
import { authorizeMonthEdit } from "../storage/month-review";
import { previewImportTransfers } from "../import/transfer-review";
import { ImportTransferReview } from "../components/ImportTransferReview";
import { importMonthGuardDates } from "../import/month-guards";
import { GenericImportReview } from "../components/GenericImportReview";
import { Stepper } from "../components/UIPrimitives";
import type { LayoutMapping, RowReviewAction } from "../import/generic/types";
import type { PdfImportSession } from "../import/pdf-session-types";
import { FeedbackLink } from "../components/FeedbackPanel";
import { RELEASE_CONFIGURATION } from "../beta/configuration";
import { Sheet, SheetVisibilityContext } from "../components/Sheet";
import { ContextHelp } from "../components/ContextHelp";
import "./Import.css";
import {
  appendBatchEntries,
  batchPresentation,
  expandBatchStatement,
  nextAttentionStatement,
  reviewedRowSelection,
  statementPresentation,
  statementVisibleInReview,
  type StatementReviewFilter,
} from "../import/batch-presentation";

export default function ImportPage({
  onImported,
  selectedFiles,
  onFilesStarted,
  active: visible = true,
  onPendingChange,
}: {
  active?: boolean;
  onPendingChange?: (count: number) => void;
  selectedFiles?: File[];
  onFilesStarted?: () => void;
  onImported: (month: string, currency: string) => void;
}) {
  const [entries, setEntries] = useState<FileReview[]>([]);
  const [reviewFilter, setReviewFilter] =
    useState<StatementReviewFilter>("attention");
  const [retainedAttentionId, setRetainedAttentionId] = useState<string>();
  const [discarding, setDiscarding] = useState(false);
  const scrollPosition = useRef(0);
  useLayoutEffect(() => {
    if (!visible) return;
    window.scrollTo?.({ top: scrollPosition.current, left: 0 });
    const remember = () => {
      scrollPosition.current = window.scrollY;
    };
    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, [visible]);
  useEffect(() => {
    onPendingChange?.(entries.length);
  }, [entries.length, onPendingChange]);
  const [busy, setBusy] = useState(false);
  const [sourceCorrection, setSourceCorrection] = useState<{
    id: string;
    entryId: string;
    target: SourceCorrectionTarget;
  }>();
  const [phase, setPhase] = useState<"pick" | "check" | "review" | "done">(
    "pick",
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [commitStatus, setCommitStatus] = useState("");
  const [selectedTransferIds, setSelectedTransferIds] = useState<string[]>([]);
  const [rejectedAutomaticIds, setRejectedAutomaticIds] = useState<string[]>(
    [],
  );
  const initialTransferLinkIds = useRef(new Set<string>());
  const navigate = useNavigate();
  const localPicker = useRef<HTMLInputElement>(null);
  const statementCards = useRef(new Map<string, HTMLDivElement>());
  const confirmation = useRef<HTMLElement>(null);
  const reviewFocus = useRef<{ entryId?: string } | undefined>(undefined);
  const reviewedInclusions = useRef(new Map<string, Set<string>>());
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
  const diagnostics = useLiveQuery(
    () =>
      db.importDiagnostics.orderBy("createdAt").reverse().limit(5).toArray(),
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
  const processing = useRef<AbortController | undefined>(undefined);
  const sessions = useRef(new Set<PdfImportSession>());
  const releaseSession = (session?: PdfImportSession) => {
    if (!session) return;
    sessions.current.delete(session);
    void session.dispose().catch(() => {
      /* Discarding a source never writes financial records. */
    });
  };
  const releaseAllSessions = () => {
    for (const session of sessions.current) releaseSession(session);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      operation.current++;
      processing.current?.abort();
      releaseAllSessions();
    };
  }, []);
  const discardReview = () => {
    if (commitStatus) return;
    operation.current++;
    processing.current?.abort();
    releaseAllSessions();
    reviewedInclusions.current.clear();
    initialTransferLinkIds.current.clear();
    setEntries([]);
    setReviewFilter("attention");
    setRetainedAttentionId(undefined);
    reviewFocus.current = undefined;
    setSourceCorrection(undefined);
    setSelectedTransferIds([]);
    setRejectedAutomaticIds([]);
    setError("");
    setNotice("");
    setBusy(false);
    setPhase("pick");
    setDiscarding(false);
    onPendingChange?.(0);
  };
  const patchEntry = (entryId: string, patch: Partial<FileReview>) => {
    if (alive.current)
      setEntries((current) => {
        const updated = current.map((entry) =>
          entry.id === entryId ? { ...entry, ...patch } : entry,
        );
        return patch.open === true
          ? expandBatchStatement(updated, entryId)
          : updated;
      });
  };
  const patchReviewEntry = (entryId: string, patch: Partial<FileReview>) => {
    setEntries((current) => {
      const previous = current.find((entry) => entry.id === entryId);
      if (!previous) return current;
      if (patch.draft && previous.draft) {
        const choices =
          reviewedInclusions.current.get(entryId) ?? new Set<string>();
        for (const row of patch.draft.transactions) {
          const prior = previous.draft.transactions.find(
            (item) => item.id === row.id,
          );
          if (prior && row.include !== prior.include)
            choices.add(row.transactionFingerprint);
        }
        reviewedInclusions.current.set(entryId, choices);
      }
      if (patch.skip === true && !previous.skip) {
        releaseSession(previous.extracted?.pdfSession);
        patch = {
          ...patch,
          extracted: undefined,
          optionsChanged: true,
          draft: previous.draft
            ? {
                ...previous.draft,
                parserReview: undefined,
                parserFallback: undefined,
              }
            : undefined,
        };
      }
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
      const updated = current.map((entry) => {
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
          ? { ...entry, requiresBatchRecheck: true }
          : entry;
      });
      return patch.open === true
        ? expandBatchStatement(updated, entryId)
        : updated;
    });
  };
  const processEntry = async (
    entry: FileReview,
    token: number,
    ocr = false,
    reuse = false,
    pendingDrafts: ImportDraft[] = [],
    pdfReviewOptions: PdfReviewOptions = entry.pdfReviewOptions ?? {},
  ) => {
    patchEntry(entry.id, {
      state: "checking",
      error: "",
      progress: "Checking this statement…",
    });
    let extracted = entry.extracted;
    try {
      extracted =
        reuse && extracted
          ? extracted
          : await extractFile(
              entry.file,
              (progress) => patchEntry(entry.id, { progress }),
              ocr,
              {
                signal: processing.current?.signal,
                detailedProgress: (progress) =>
                  patchEntry(entry.id, { detailedProgress: progress }),
              },
            );
      if (extracted.pdfSession) sessions.current.add(extracted.pdfSession);
      if (!alive.current || token !== operation.current) {
        releaseSession(extracted.pdfSession);
        return;
      }
      if (
        entry.extracted?.pdfSession &&
        entry.extracted.pdfSession !== extracted.pdfSession
      )
        releaseSession(entry.extracted.pdfSession);
      patchEntry(entry.id, { extracted });
      if (extracted.summary) {
        patchEntry(entry.id, {
          state: "review",
          extracted,
          draft: undefined,
          error: "",
          skip: true,
          progress: "Annual summary recognised · totals only",
          override: false,
          optionsChanged: false,
          requiresBatchRecheck: false,
          invalidAmounts: [],
          pdfReviewOptions: undefined,
        });
        return;
      }
      const period = entry.manualPeriod
        ? validatePeriod({ start: entry.periodStart, end: entry.periodEnd })
        : undefined;
      const draft = await prepareDraft(
        extracted,
        entry.bank || undefined,
        accounts?.find((a) => a.id === entry.accountId) ??
          entry.accountOverride ??
          // The source-review reader must keep the account already recognized
          // for this file, including one staged earlier in this import batch.
          (entry.draft &&
          (!entry.bank || entry.bank === entry.draft.account.institution)
            ? entry.draft.account
            : undefined),
        period,
        pendingDrafts,
        entry.csvMapping,
        {
          ...pdfReviewOptions,
          signal: processing.current?.signal.aborted
            ? undefined
            : processing.current?.signal,
          progress: (progress) =>
            patchEntry(entry.id, {
              progress: progress.message,
              detailedProgress: progress,
            }),
          skipCellOcr:
            pdfReviewOptions.skipCellOcr || !!extracted.extraction?.cancelled,
        },
      );
      if (!alive.current || token !== operation.current) return;
      // Source corrections keep deliberate category/type edits; duplicates are rechecked.
      if (entry.draft) {
        const prior = new Map(
          entry.draft.transactions.map((row) => [
            row.parseRowId ?? row.transactionFingerprint,
            row,
          ]),
        );
        // Native and generic readings have independent source-row IDs. Preserve
        // a manual choice only for the same uniquely identified occurrence,
        // including page, booking date and printed balance, when switching.
        const occurrenceKey = (row: ImportDraft["transactions"][number]) =>
          JSON.stringify([
            transactionKey({ ...row, accountId: "" }),
            row.bookingDate,
            row.balanceAfterTransaction,
            row.sourcePage,
            row.occurrence,
          ]);
        const sameAccount =
          entry.draft.account.institution === draft.account.institution &&
          entry.draft.account.accountType === draft.account.accountType &&
          entry.draft.account.currency === draft.account.currency &&
          entry.draft.account.maskedAccountIdentifier ===
            draft.account.maskedAccountIdentifier;
        const occurrences = new Map<string, ImportDraft["transactions"]>();
        if (sameAccount)
          for (const row of entry.draft.transactions) {
            const key = occurrenceKey(row);
            occurrences.set(key, [...(occurrences.get(key) ?? []), row]);
          }
        draft.transactions = draft.transactions.map((row) => {
          const matches = occurrences.get(occurrenceKey(row));
          const old =
            prior.get(row.parseRowId ?? row.transactionFingerprint) ??
            (matches?.length === 1 ? matches[0] : undefined);
          if (!old) return row;
          return {
            ...row,
            ...(old.manualCategory
              ? {
                  categoryId: old.categoryId,
                  subcategoryId: old.subcategoryId,
                  manualCategory: true,
                  categorySource: old.categorySource,
                  categoryRuleId: old.categoryRuleId,
                  appliedRuleIds: old.appliedRuleIds,
                  type: old.isTransfer
                    ? ("transfer" as const)
                    : row.amount >= 0
                      ? ("income" as const)
                      : ("expense" as const),
                  isTransfer: old.isTransfer,
                  kind: old.kind,
                  isReviewed: true,
                }
              : {}),
            ...reviewedRowSelection(
              old,
              row,
              reviewedInclusions.current
                .get(entry.id)
                ?.has(old.transactionFingerprint) ?? false,
            ),
          };
        });
      }
      patchEntry(entry.id, {
        draft,
        extracted,
        state: "review",
        progress: "Ready to review",
        open: entry.open,
        override: false,
        optionsChanged: false,
        invalidAmounts: [],
        showAll: entry.showAll,
        duplicateInBatch: pendingDrafts.some(
          (pending) =>
            pending.statement.sourceFileHash === draft.statement.sourceFileHash,
        ),
        requiresBatchRecheck: false,
        pdfReviewOptions,
        cancelled: !!extracted.extraction?.cancelled,
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
        open: entry.open,
        progress: "Couldn't read this statement",
        pdfReviewOptions,
        cancelled: !!extracted?.extraction?.cancelled,
      });
    }
  };
  const selectFiles = async (files: File[]) => {
    if (!files.length || busy) return;
    if (!entries.length) {
      setReviewFilter("attention");
      setRetainedAttentionId(undefined);
    }
    const token = ++operation.current;
    processing.current?.abort();
    processing.current = new AbortController();
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
    setEntries((current) => appendBatchEntries(current, selected));
    setError("");
    setBusy(true);
    setPhase("check");
    if (!entries.length)
      initialTransferLinkIds.current = new Set(
        (await db.transferLinks.toArray()).map((link) => link.id),
      );
    const pendingDrafts = entries
      .filter(
        (entry) =>
          !entry.skip &&
          entry.state !== "saved" &&
          entry.draft &&
          !entry.draft.exactDuplicate,
      )
      .map((entry) => entry.draft!);
    for (const entry of selected) {
      if (!alive.current || token !== operation.current) return;
      if (processing.current.signal.aborted) {
        patchEntry(entry.id, {
          state: "error",
          cancelled: true,
          progress: "Not read",
          error:
            "Processing was cancelled before this file was read. Parse again to check it.",
        });
        continue;
      }
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
      setEntries((current) => {
        const attention = batchPresentation(current).attention;
        const target =
          attention.find((item) => item.entry.open) ?? attention[0];
        return expandBatchStatement(current, target?.entry.id);
      });
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
  const reparse = async (
    entry: FileReview,
    ocr: boolean,
    keepReview = false,
  ) => {
    const token = ++operation.current;
    processing.current?.abort();
    processing.current = new AbortController();
    setBusy(true);
    setError("");
    setNotice("");
    if (!keepReview) setPhase("check");
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
  const includeAndRecheck = (entry: FileReview) => {
    const changed = { ...entry, skip: false, open: true };
    patchReviewEntry(entry.id, { skip: false, open: true });
    void reparse(changed, false, true);
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
  const reviewNativeSource = (
    entry: FileReview,
    target: SourceCorrectionTarget,
  ) => {
    setSourceCorrection({ id: id(), entryId: entry.id, target });
    patchEntry(entry.id, { showAll: false });
    if (
      !entry.draft?.bankSource &&
      sourceReview(entry) &&
      !entry.draft?.parserFallback
    )
      return;
    const changed = {
      ...entry,
      showAll: false,
      pdfReviewOptions: {
        ...entry.pdfReviewOptions,
        preferGeneric: true,
        // The user chose manual correction: do not delay the editor for OCR.
        skipCellOcr: true,
      },
    };
    patchEntry(entry.id, { pdfReviewOptions: changed.pdfReviewOptions });
    void reparse(changed, false, true);
  };
  const reviewSourceRow = (
    entry: FileReview,
    rowId: string,
    action: RowReviewAction,
  ) => {
    setSourceCorrection(undefined);
    const changed: FileReview = {
      ...entry,
      pdfReviewOptions: {
        ...entry.pdfReviewOptions,
        actions: { ...entry.pdfReviewOptions?.actions, [rowId]: action },
        skipCellOcr: true,
      },
    };
    patchEntry(entry.id, { pdfReviewOptions: changed.pdfReviewOptions });
    void reparse(changed, false, true);
  };
  const mapSourceColumns = (entry: FileReview, mapping: LayoutMapping) => {
    const changed: FileReview = {
      ...entry,
      pdfReviewOptions: {
        ...entry.pdfReviewOptions,
        mapping,
        // An explicitly remapped table must be checked with its new roles.
        actions: undefined,
        template: undefined,
        skipCellOcr: true,
      },
    };
    patchEntry(entry.id, { pdfReviewOptions: changed.pdfReviewOptions });
    void reparse(changed, false, true);
  };
  const saveSourceLayout = async (
    entry: FileReview,
    name: string,
    mapping: LayoutMapping,
  ) => {
    const result = sourceReview(entry);
    if (!entry.extracted || !result || busy) return;
    setBusy(true);
    setError("");
    try {
      const template = await savePdfLayout(
        entry.extracted,
        result,
        name,
        mapping,
      );
      setNotice(
        `Layout “${template.name}” saved. Every import is still checked.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The layout could not be saved. Your financial records are unchanged.",
      );
    } finally {
      if (alive.current) setBusy(false);
    }
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
  const batch = batchPresentation(entries);
  const visibleReviewIds = new Set(
    entries
      .filter((entry) =>
        statementVisibleInReview(entry, reviewFilter, retainedAttentionId),
      )
      .map((entry) => entry.id),
  );
  useEffect(() => {
    const opened =
      reviewFilter === "attention"
        ? batch.attention.find((item) => item.entry.open)?.entry
        : undefined;
    if (opened) setRetainedAttentionId(opened.id);
    else if (
      retainedAttentionId &&
      !entries.some((entry) => entry.id === retainedAttentionId && entry.open)
    )
      setRetainedAttentionId(undefined);
  }, [entries, reviewFilter, retainedAttentionId]);
  useLayoutEffect(() => {
    if (!visible || phase !== "review" || !reviewFocus.current) return;
    const target = reviewFocus.current.entryId
      ? statementCards.current
          .get(reviewFocus.current.entryId)
          ?.querySelector<HTMLElement>(".import-statement-heading")
      : confirmation.current;
    if (!target) return;
    reviewFocus.current = undefined;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: "start", behavior: "instant" });
  }, [entries, reviewFilter, phase, visible]);
  const reviewNextStatement = () => {
    const next = nextAttentionStatement(entries);
    reviewFocus.current = { entryId: next?.id };
    setRetainedAttentionId(next?.id);
    setEntries((current) => expandBatchStatement(current, next?.id));
  };
  const patchVisibleReview = (
    entry: FileReview,
    patch: Partial<FileReview>,
  ) => {
    patchReviewEntry(entry.id, patch);
    if (
      patch.open === false &&
      reviewFilter === "attention" &&
      retainedAttentionId === entry.id &&
      statementPresentation(entry).state !== "attention"
    )
      reviewNextStatement();
  };
  const finishNoChangeReview = () => {
    if (busy || blocking.length || hasChanges || phase !== "review") return;
    discardReview();
    navigate("/", { replace: true });
  };
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
    setBusy(true);
    setCommitStatus("Checking statements before saving…");
    setError("");
    let pendingId = "";
    const outcomes: BatchOutcome[] = [];
    try {
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
      await commitReviewedBatch(
        selected,
        (outcome) => {
          outcomes.push(outcome);
          const completed = entries.find((entry) => entry.id === outcome.id);
          releaseSession(completed?.extracted?.pdfSession);
          patchEntry(outcome.id, {
            state: "saved",
            imported: outcome.imported,
            skipped: outcome.skipped,
            duplicatesSkipped: outcome.duplicatesSkipped,
            excludedUnique: outcome.excludedUnique,
            statementSkipped: outcome.statementSkipped,
            error: "",
            open: false,
            extracted: undefined,
            draft: { ...outcome.draft, parserReview: undefined },
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
      releaseAllSessions();
      setEntries([]);
      setReviewFilter("attention");
      setRetainedAttentionId(undefined);
      reviewedInclusions.current.clear();
      setSelectedTransferIds([]);
      setRejectedAutomaticIds([]);
      setSourceCorrection(undefined);
      onPendingChange?.(0);
      setPhase("pick");
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
    <SheetVisibilityContext.Provider value={visible}>
      <div
        className="import-workspace"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = busy ? "none" : "copy";
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (!busy) void selectFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <div className="page-heading">
          <div>
            <div className="context-help-heading">
              <h1>
                {entries.length
                  ? `Review ${entries.length} statement${entries.length === 1 ? "" : "s"}`
                  : "Import statements"}
              </h1>
              {entries.length > 0 && (
                <ContextHelp title="Statement review">
                  <p>You can change tabs and return to this review.</p>
                </ContextHelp>
              )}
            </div>
            {entries.length > 0 && (
              <div className="import-change-files">
                <label
                  className={`button file-button ${busy ? "disabled" : ""}`}
                >
                  Add statements
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
                <button
                  type="button"
                  disabled={!!commitStatus}
                  onClick={() => setDiscarding(true)}
                >
                  Discard review
                </button>
                <span className="muted">
                  {batch.savedCount > 0
                    ? "Saved statements stay saved. Confirm the remaining statements when ready."
                    : "Nothing is saved until you confirm."}
                </span>
              </div>
            )}
          </div>
          {entries.length > 0 && (
            <Link className="icon-button" to="/" aria-label="Leave review">
              <X size={20} />
            </Link>
          )}
        </div>
        {discarding && (
          <Sheet
            title="Discard this review?"
            onClose={() => setDiscarding(false)}
            footer={
              <>
                <button
                  type="button"
                  autoFocus
                  onClick={() => setDiscarding(false)}
                >
                  Keep review
                </button>
                <button
                  type="button"
                  disabled={!!commitStatus}
                  onClick={discardReview}
                >
                  Discard review
                </button>
              </>
            }
          >
            <p>
              Your unsaved corrections and {entries.length} selected file
              {entries.length === 1 ? "" : "s"} will be removed. Imported
              transactions will stay.
            </p>
          </Sheet>
        )}
        <Stepper
          label="Import progress"
          steps={["Pick", "Check", "Review", "Done"]}
          current={["pick", "check", "review", "done"].indexOf(phase)}
        />
        {entries.length === 0 && (
          <section
            className="card upload-card"
            onClick={(event) => {
              const target = event.target;
              if (
                !busy &&
                target instanceof Element &&
                !target.closest("input, label, button, a, dialog")
              ) {
                localPicker.current?.click();
              }
            }}
          >
            <Upload size={28} />
            <div className="context-help-heading">
              <h2>Add your statements</h2>
              <ContextHelp title="Importing statements">
                <p>
                  Select multiple PDF statements, or CSV, OFX, QFX and QIF
                  exports, with the same file picker. We’ll check the numbers
                  and highlight anything that needs you.
                </p>
                <p>
                  Digital PDFs work best. Scanned pages are read on this device.
                  Up to 30 MB and 100 pages per PDF.
                </p>
              </ContextHelp>
            </div>
            <p>Select or drop your statement files.</p>
            <label
              className={`button primary file-button ${busy ? "disabled" : ""}`}
            >
              <Upload size={18} />
              Select statements
              <input
                ref={localPicker}
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
          </section>
        )}

        {phase === "check" && (
          <section
            className="card import-processing-list"
            aria-label="Checking statements"
          >
            <h2>Checking your statements</h2>
            <p role="status">
              {batch.completedCount} of {entries.length} statements checked
            </p>
            <button
              type="button"
              disabled={processing.current?.signal.aborted}
              onClick={() => {
                processing.current?.abort();
                setError(
                  "Processing stopped. Completed pages remain available to review; unread pages and files will not be imported.",
                );
              }}
            >
              Stop processing
            </button>
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
                  <span
                    className="source-filename"
                    role="region"
                    aria-label="Source filename"
                    tabIndex={0}
                  >
                    <strong>{entry.file.name}</strong>
                  </span>
                </span>
                <p role={entry.state === "checking" ? "status" : undefined}>
                  {entry.draft && entry.state !== "checking"
                    ? `${entry.draft.statement.institution} ${entry.draft.account.maskedAccountIdentifier} · ${statementPresentation(entry).state === "attention" ? "needs attention" : statementPresentation(entry).state === "skipped" ? "skipped" : entry.state === "saved" ? "saved" : "ready"}`
                    : entry.progress}
                </p>
                {entry.detailedProgress && (
                  <div>
                    {entry.detailedProgress.fraction !== undefined && (
                      <progress
                        aria-label={`Reading ${entry.file.name}`}
                        max={1}
                        value={entry.detailedProgress.fraction}
                      />
                    )}
                    {entry.detailedProgress.completed &&
                      entry.detailedProgress.page && (
                        <small>Page {entry.detailedProgress.page} read</small>
                      )}
                  </div>
                )}
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
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {phase !== "check" && entries.length > 0 && (
          <section
            className="card import-batch-summary"
            aria-label="Batch review"
          >
            <p role="status">
              <strong>
                {batch.readyCount} ready · {batch.attention.length} need
                {batch.attention.length === 1 ? "s" : ""} attention ·{" "}
                {batch.skippedCount} skipped
                {batch.savedCount > 0 && ` · ${batch.savedCount} saved`}
              </strong>
            </p>
            <div
              className="import-view-filter"
              role="group"
              aria-label="Statement view"
            >
              <button
                type="button"
                aria-pressed={reviewFilter === "attention"}
                disabled={busy}
                onClick={() => setReviewFilter("attention")}
              >
                Needs attention ({batch.attention.length})
              </button>
              <button
                type="button"
                aria-pressed={reviewFilter === "all"}
                disabled={busy}
                onClick={() => setReviewFilter("all")}
              >
                All statements ({entries.length})
              </button>
            </div>
            {batch.attention.length > 0 && (
              <>
                <p>
                  Resolve the statements needing attention, or leave them out.
                  Ready statements will be included when you confirm.
                </p>
                <button disabled={busy} onClick={reviewNextStatement}>
                  Review next statement
                </button>
              </>
            )}
            {reviewFilter === "attention" && !batch.attention.length && (
              <p className="import-review-clear" role="status">
                {hasChanges
                  ? "No statements need attention. Ready statements will be included when you confirm."
                  : "No statements need attention. There is nothing new to import."}
              </p>
            )}
          </section>
        )}
        {entries.length > 0 && (
          <div
            className="import-review-list"
            hidden={phase === "check" || visibleReviewIds.size === 0}
          >
            {entries
              .filter(
                (entry) =>
                  entry.state !== "queued" &&
                  (entry.state !== "checking" ||
                    !!entry.draft ||
                    !!entry.extracted ||
                    entry.open),
              )
              .map((entry) => (
                <div
                  key={entry.id}
                  className="import-review-entry"
                  hidden={!visibleReviewIds.has(entry.id)}
                  ref={(element) => {
                    if (element) statementCards.current.set(entry.id, element);
                    else statementCards.current.delete(entry.id);
                  }}
                >
                  <SheetVisibilityContext.Provider
                    value={visible && visibleReviewIds.has(entry.id)}
                  >
                    {entry.extracted?.csv &&
                      entry.open &&
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
                              (account) =>
                                account.id === entry.draft!.account.id,
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
                      patch={(patch) => patchVisibleReview(entry, patch)}
                      reparse={(ocr) => void reparse(entry, ocr)}
                      onInclude={() => includeAndRecheck(entry)}
                      onReviewSource={
                        entry.extracted?.pdfSession ||
                        sourceReview(entry) ||
                        entry.draft?.bankSource
                          ? (row) => reviewNativeSource(entry, row)
                          : undefined
                      }
                      onMapping={(mapping) => mapSourceColumns(entry, mapping)}
                      onSaveTemplate={(name, mapping) =>
                        void saveSourceLayout(entry, name, mapping)
                      }
                      onSourceAction={(rowId, action) =>
                        reviewSourceRow(entry, rowId, action)
                      }
                      onGuidedOptions={(options) => {
                        const changed = { ...entry, ...options };
                        patchReviewEntry(entry.id, options);
                        void reparse(changed, false, true);
                      }}
                      onPrepareSource={() => {
                        const pdfReviewOptions = {
                          ...entry.pdfReviewOptions,
                          preferGeneric: true,
                          skipCellOcr: true,
                        };
                        patchEntry(entry.id, { pdfReviewOptions });
                        void reparse(
                          { ...entry, pdfReviewOptions },
                          false,
                          true,
                        );
                      }}
                      onCreateAccount={(account) => {
                        const changed = {
                          ...entry,
                          accountOverride: account,
                          accountId: account.id,
                          bank: account.institution,
                        };
                        patchEntry(entry.id, {
                          accountOverride: account,
                          accountId: account.id,
                          bank: account.institution,
                        });
                        void reparse(changed, false, true);
                      }}
                      sourceReview={(() => {
                        if (entry.skip || entry.state === "saved")
                          return undefined;
                        if (entry.draft?.bankSource) {
                          return (
                            <section className="generic-parser-details">
                              <div className="context-help-heading">
                                <h3>Reading details</h3>
                                <ContextHelp title="Statement reading">
                                  <p>
                                    This statement uses its bank reader. If a
                                    date or amount looks wrong, review the PDF
                                    layout to correct the source reading and
                                    check the figures again.
                                  </p>
                                </ContextHelp>
                              </div>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  const changed: FileReview = {
                                    ...entry,
                                    pdfReviewOptions: {
                                      ...entry.pdfReviewOptions,
                                      preferGeneric: true,
                                    },
                                  };
                                  patchEntry(entry.id, {
                                    pdfReviewOptions: changed.pdfReviewOptions,
                                  });
                                  void reparse(changed, false, true);
                                }}
                              >
                                Review PDF layout
                              </button>
                            </section>
                          );
                        }
                        const result = sourceReview(entry);
                        if (!result) return undefined;
                        const review = (
                          <GenericImportReview
                            result={result}
                            correctionRequest={
                              sourceCorrection?.entryId === entry.id
                                ? {
                                    id: sourceCorrection.id,
                                    rowId: sourceCorrectionRow(
                                      result,
                                      sourceCorrection.target,
                                    ),
                                  }
                                : undefined
                            }
                            session={entry.extracted?.pdfSession}
                            currency={
                              entry.draft?.statement.currency ??
                              entry.accountOverride?.currency
                            }
                            method={
                              entry.draft?.statement.parserMethod ??
                              entry.extracted?.extraction?.method
                            }
                            busy={busy}
                            onAction={(rowId, action) =>
                              reviewSourceRow(entry, rowId, action)
                            }
                            onMapping={(mapping) =>
                              mapSourceColumns(entry, mapping)
                            }
                            onSaveTemplate={(name, mapping) =>
                              void saveSourceLayout(entry, name, mapping)
                            }
                            canImportAnyway={
                              !!entry.draft && !entry.optionsChanged
                            }
                            showImportAnyway={false}
                            onImportAnyway={() => {
                              if (!entry.draft) return;
                              patchReviewEntry(entry.id, {
                                override: true,
                                draft: entry.draft,
                              });
                            }}
                          />
                        );
                        return entry.draft?.parserFallback ? (
                          <details className="generic-parser-details">
                            <summary>Alternative column reading</summary>
                            <div className="context-help-heading">
                              <h3>Column reading</h3>
                              <ContextHelp title="Alternative column reading">
                                <p>
                                  The bank-specific reader checked this
                                  recognised statement automatically. Column
                                  mapping and source-row corrections are
                                  available here if you need them. Changing the
                                  mapping or rows selects that reading for this
                                  import.
                                </p>
                              </ContextHelp>
                            </div>
                            {review}
                          </details>
                        ) : (
                          review
                        );
                      })()}
                    />
                  </SheetVisibilityContext.Provider>
                  {reviewFilter === "attention" &&
                    retainedAttentionId === entry.id &&
                    entry.open &&
                    !busy &&
                    ["ready", "skipped"].includes(
                      statementPresentation(entry).state,
                    ) && (
                      <div className="import-resolved-statement" role="status">
                        <p>
                          {statementPresentation(entry).state === "skipped"
                            ? "This statement will be skipped."
                            : "This statement is ready."}
                        </p>
                        <button type="button" onClick={reviewNextStatement}>
                          Continue
                        </button>
                      </div>
                    )}
                </div>
              ))}
          </div>
        )}
        {phase === "review" &&
          entries.some(
            (entry) =>
              !entry.skip &&
              (entry.error ||
                (!entry.draft?.parserFallback &&
                  sourceReview(entry) &&
                  !sourceReview(entry)?.checks.reconciledExactly)),
          ) && (
            <section className="card" aria-label="Help with a failed import">
              <div className="context-help-heading">
                <h2>Help with an import</h2>
                <ContextHelp title="Reporting an import problem">
                  <p>
                    You can share technical details without sharing your figures
                    or PDF.
                  </p>
                </ContextHelp>
              </div>
              <FeedbackLink
                configuration={RELEASE_CONFIGURATION}
                diagnostics={diagnostics}
              >
                Report an import problem
              </FeedbackLink>
            </section>
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
        {entries.length > 0 && phase === "review" && (
          <section
            ref={confirmation}
            id="import-confirmation"
            aria-label="Import summary"
            tabIndex={-1}
            className="import-outcome-footer"
          >
            <div aria-live="polite">
              <strong>
                {newCount} new
                {duplicateCount > 0 &&
                  ` · ${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"} skipped`}
                {balanceStatements.length > 0 &&
                  ` · ${balanceStatements.length} balance update${balanceStatements.length === 1 ? "" : "s"}`}
                {excludedCount > 0 && ` · ${excludedCount} excluded`}
                {skippedFileCount > 0 &&
                  ` · ${skippedFileCount} file${skippedFileCount === 1 ? "" : "s"} skipped`}
              </strong>
              {!busy && !hasChanges && !blocking.length && (
                <span>No changes to save.</span>
              )}
              {(busy || blocking.length > 0) && (
                <span>
                  {busy && !commitStatus
                    ? "Rechecking source rows…"
                    : blocking.length
                      ? `${blocking.length} statement${blocking.length === 1 ? "" : "s"} need${blocking.length === 1 ? "s" : ""} attention`
                      : ""}
                </span>
              )}
              {commitStatus && <span role="status">{commitStatus}</span>}
            </div>
            {!hasChanges && !blocking.length && phase === "review" ? (
              <button disabled={busy} onClick={finishNoChangeReview}>
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
          </section>
        )}
      </div>
    </SheetVisibilityContext.Provider>
  );
}
