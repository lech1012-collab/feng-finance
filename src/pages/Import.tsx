import { useState, useRef, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import type { ImportDraft, Institution } from "../domain/models";
import { db } from "../storage/database";
import {
  extractFile,
  prepareDraft,
  commitDraft,
  draftReconciliation,
  type ExtractedFile,
} from "../import/pipeline";
import { money, decimalMoney, parseMoney } from "../domain/money";
import { cashFlow } from "../analytics/calculations";
import { validatePeriod } from "../parsers/period";
export default function ImportPage({
  onImported,
  selectedFiles,
  onFilesStarted,
}: {
  selectedFiles?: File[];
  onFilesStarted?: () => void;
  onImported: (month: string, currency: string) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [index, setIndex] = useState(0);
  const [extracted, setExtracted] = useState<ExtractedFile>();
  const [draft, setDraft] = useState<ImportDraft>();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [bank, setBank] = useState<Institution | "">("");
  const [accountId, setAccountId] = useState("");
  const [override, setOverride] = useState(false);
  const [success, setSuccess] = useState("");
  const [manualPeriod, setManualPeriod] = useState(false);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const amountErrors = useRef(new Set<string>());
  const [showAll, setShowAll] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const latestImported = useRef("");
  const navigate = useNavigate();
  const accounts = useLiveQuery(
    () => db.accounts.filter((a) => !a.isDemo).toArray(),
    [],
  );
  const categories = useLiveQuery(
    () => db.categories.filter((c) => !c.archived && !c.parentId).toArray(),
    [],
  );
  const resetPeriod = () => {
    setManualPeriod(false);
    setPeriodStart("");
    setPeriodEnd("");
  };
  const process = async (
    file: File,
    ocr = false,
    existing?: ExtractedFile,
    useEnteredDates = true,
  ) => {
    setBusy(true);
    window.scrollTo({ top: 0 });
    setError("");
    setDraft(undefined);
    setOverride(false);
    amountErrors.current.clear();
    try {
      const period =
        useEnteredDates && manualPeriod
          ? validatePeriod({ start: periodStart, end: periodEnd })
          : undefined;
      const result = existing ?? (await extractFile(file, setStatus, ocr));
      setExtracted(result);
      const d = await prepareDraft(
        result,
        useEnteredDates ? bank || undefined : undefined,
        useEnteredDates ? accounts?.find((a) => a.id === accountId) : undefined,
        period,
      );
      setDraft(d);
      setShowAll(false);
      setStatus("Ready to review");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The statement could not be read. No financial data was saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  const selectFiles = async (selected: File[]) => {
    if (!selected.length) return;
    setFiles(selected);
    setBank("");
    setAccountId("");
    setImportedCount(0);
    latestImported.current = "";
    setIndex(0);
    setSuccess("");
    setExtracted(undefined);
    resetPeriod();
    await process(selected[0], false, undefined, false);
  };
  const startedFiles = useRef<File[] | undefined>(undefined);
  useEffect(() => {
    if (selectedFiles?.length && startedFiles.current !== selectedFiles) {
      startedFiles.current = selectedFiles;
      void selectFiles(selectedFiles);
      onFilesStarted?.();
    }
  }, [selectedFiles]);
  const updateRow = (
    tid: string,
    patch: Partial<ImportDraft["transactions"][number]>,
  ) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            transactions: d.transactions.map((t) =>
              t.id === tid ? { ...t, ...patch } : t,
            ),
          }
        : d,
    );
  const save = async () => {
    if (!draft) return;
    if (amountErrors.current.size) {
      setError("Correct the highlighted invalid amounts before importing.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const n = await commitDraft(draft, override);
      const latest = draft.transactions
        .filter((t) => t.include)
        .map((t) => t.date)
        .sort()
        .at(-1);
      if (latest) {
        latestImported.current =
          latest > latestImported.current ? latest : latestImported.current;
        onImported(latestImported.current.slice(0, 7), draft.account.currency);
      }
      setImportedCount((count) => count + n);
      setSuccess(
        `Imported ${n} new transactions from ${draft.statement.institution}.`,
      );
      setDraft(undefined);
      resetPeriod();
      if (index + 1 < files.length) {
        setIndex(index + 1);
        setExtracted(undefined);
        await process(files[index + 1], false, undefined, false);
      } else {
        setFiles([]);
        setStatus("Import complete");
        navigate("/", {
          replace: true,
          state: { importedCount: importedCount + n },
        });
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Import failed. Your existing data is safe.",
      );
    } finally {
      setBusy(false);
    }
  };
  const validation = draft && draftReconciliation(draft);
  const flow =
    draft &&
    cashFlow(
      draft.transactions.filter((t) => t.include),
      draft.statement.currency,
    );
  const issues =
    draft?.transactions.filter(
      (t) =>
        t.extractionConfidence < 0.8 ||
        (!t.categoryId && !t.isTransfer) ||
        t.duplicate !== "none",
    ) ?? [];
  const needsCheck = (t: ImportDraft["transactions"][number]) =>
    t.extractionConfidence < 0.8 ||
    t.duplicate !== "none" ||
    (draft &&
      (t.date < draft.statement.statementPeriodStart ||
        t.date > draft.statement.statementPeriodEnd));
  const checks = draft?.transactions.filter(needsCheck) ?? [];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ADD YOUR LATEST ACTIVITY</p>
          <h1>Import statements</h1>
        </div>
      </div>
      <section
        className={`card upload-card ${draft || busy || success ? "compact-upload" : ""}`}
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
          Select or drop monthly PDFs from Barclays, American Express or
          Revolut. We’ll check the numbers and highlight anything that needs
          you.
        </p>
        <label
          className={`button primary file-button ${busy ? "disabled" : ""}`}
        >
          <Upload size={18} />
          Select PDF statements
          <input
            aria-label="Select PDF statements"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            disabled={busy}
            onChange={(e) => {
              const selected = Array.from(e.target.files ?? []);
              e.target.value = "";
              void selectFiles(selected);
            }}
          />
        </label>
        <p className="muted">
          Digital PDFs work best. Scanned pages use local OCR. Up to 30 MB / 100
          pages per PDF.
        </p>
      </section>
      {files.length > 1 && (
        <p className="queue-progress">
          Statement {index + 1} of {files.length} · {importedCount} transactions
          saved
        </p>
      )}
      {busy && (
        <div className="notice" role="status">
          <span className="spinner" />
          {status}
          {files.length > 1 && ` · Statement ${index + 1} of ${files.length}`}
        </div>
      )}
      {error && (
        <div className="notice warning" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}
      {(error || draft || extracted) && files[index] && (
        <details className="card parse-options" open={!!error}>
          <summary>
            Bank, account and statement dates <ChevronDown size={16} />
          </summary>
          <div className="form-grid">
            <label>
              Bank
              <select
                aria-label="Bank"
                value={bank}
                onChange={(e) => setBank(e.target.value as Institution | "")}
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
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">Detect automatically</option>
                {accounts?.map((a) => (
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
              checked={manualPeriod}
              onChange={(e) => {
                setManualPeriod(e.target.checked);
                setDraft(undefined);
              }}
            />
            Enter statement dates from PDF
          </label>
          {manualPeriod && (
            <>
              <p className="muted">
                Copy both dates from the statement header. These dates apply
                only to this file; balance validation still runs.
              </p>
              <div className="form-grid">
                <label>
                  Statement start date
                  <input
                    type="date"
                    value={periodStart}
                    onChange={(e) => {
                      setPeriodStart(e.target.value);
                      setDraft(undefined);
                    }}
                  />
                </label>
                <label>
                  Statement end date
                  <input
                    type="date"
                    value={periodEnd}
                    onChange={(e) => {
                      setPeriodEnd(e.target.value);
                      setDraft(undefined);
                    }}
                  />
                </label>
              </div>
            </>
          )}
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => void process(files[index], false, extracted)}
            >
              Parse again
            </button>
            <button
              disabled={busy}
              onClick={() => void process(files[index], true)}
            >
              Try local OCR
            </button>
            <Link to="/settings">Create an account</Link>
          </div>
          {error && index + 1 < files.length && (
            <button
              disabled={busy}
              onClick={() => {
                setIndex(index + 1);
                setExtracted(undefined);
                resetPeriod();
                void process(files[index + 1], false, undefined, false);
              }}
            >
              Skip this file and review next
            </button>
          )}
        </details>
      )}
      {draft && flow && validation && (
        <>
          <section className="card review-summary">
            <div className="section-heading">
              <h2>
                <FileText size={20} />
                {draft.statement.institution} detected
              </h2>
              <span className="small-chip">
                {draft.statement.extractionMethod === "OCR"
                  ? "OCR"
                  : "Digital PDF"}
              </span>
            </div>
            <p>
              {draft.account.displayName} ·{" "}
              {draft.account.maskedAccountIdentifier} ·{" "}
              {draft.statement.currency}
            </p>
            <p>
              {draft.statement.periodSource === "transaction-coverage" &&
                "Transaction coverage: "}
              {draft.statement.statementPeriodStart} to{" "}
              {draft.statement.statementPeriodEnd}
            </p>
            {draft.statement.statementDate && (
              <p>Statement issued: {draft.statement.statementDate}</p>
            )}
            <div className="review-metrics">
              <div>
                <span>Transactions extracted</span>
                <strong>{draft.transactions.length}</strong>
              </div>
              <div>
                <span>Income to add</span>
                <strong>{money(flow.income, draft.statement.currency)}</strong>
              </div>
              <div>
                <span>Expenses to add</span>
                <strong>
                  {money(flow.expenses, draft.statement.currency)}
                </strong>
              </div>
            </div>
            <div
              className={`validation ${validation.status === "reconciled" ? "valid" : "warn"}`}
            >
              <strong>
                {validation.status === "reconciled"
                  ? "✓ Statement reconciled"
                  : validation.status === "warning"
                    ? "⚠ Statement validation failed"
                    : "Balance validation unavailable"}
              </strong>
              {draft.account.accountType === "credit" && (
                <p className="muted">
                  Credit card balances below use a minus sign for money owed.
                </p>
              )}
              <dl className="totals">
                <div>
                  <dt>Opening balance</dt>
                  <dd>
                    {draft.statement.openingBalance === undefined
                      ? "Not available"
                      : money(
                          draft.statement.openingBalance,
                          draft.statement.currency,
                        )}
                  </dd>
                </div>
                <div>
                  <dt>Reported closing balance</dt>
                  <dd>
                    {draft.statement.closingBalance === undefined
                      ? "Not available"
                      : money(
                          draft.statement.closingBalance,
                          draft.statement.currency,
                        )}
                  </dd>
                </div>
                {validation.calculated !== undefined && (
                  <>
                    <div>
                      <dt>Calculated closing balance</dt>
                      <dd>
                        {money(validation.calculated, draft.statement.currency)}
                      </dd>
                    </div>
                    <div>
                      <dt>Difference</dt>
                      <dd>
                        {money(
                          validation.difference ?? 0,
                          draft.statement.currency,
                        )}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              {validation.status === "warning" && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={override}
                    onChange={(e) => setOverride(e.target.checked)}
                  />
                  I reviewed the source PDF and explicitly accept this balance
                  difference.
                </label>
              )}
            </div>
            {draft.exactDuplicate && (
              <div className="notice warning">
                <div>
                  <strong>This statement has already been imported.</strong>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.duplicateOverride}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          duplicateOverride: e.target.checked,
                        })
                      }
                    />
                    Override the exact statement duplicate. Choose which
                    transactions to keep below.
                  </label>
                </div>
              </div>
            )}
            <p>
              {draft.regenerated
                ? "A statement for this account and period already exists. "
                : ""}
              {draft.transactions.filter((t) => t.duplicate !== "none").length}{" "}
              possible or confirmed duplicate transactions; excluded by default.
            </p>
            {draft.warnings.length > 0 && (
              <div className="notice warning">
                <div>
                  <strong>Extraction requires review</strong>
                  <ul>
                    {draft.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.reviewedWarnings}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          reviewedWarnings: e.target.checked,
                        })
                      }
                    />
                    I compared the extracted rows with the PDF, corrected errors
                    and accept any partial extraction.
                  </label>
                </div>
              </div>
            )}
            <p>
              <strong>{checks.length} transactions to check.</strong>{" "}
              {issues.filter((t) => !t.categoryId && !t.isTransfer).length} can
              be categorized later.
            </p>
          </section>
          <section className="card review-transactions">
            <h2>Review transactions</h2>
            <div
              className="review-tabs"
              role="group"
              aria-label="Transaction review"
            >
              <button aria-pressed={!showAll} onClick={() => setShowAll(false)}>
                To check ({checks.length})
              </button>
              <button aria-pressed={showAll} onClick={() => setShowAll(true)}>
                All transactions ({draft.transactions.length})
              </button>
            </div>
            {!showAll && !checks.length && (
              <div className="review-clear">
                <CheckCircle2 size={24} />
                <p>
                  Amounts and dates look good. Confirm the summary above, or
                  open all transactions to make changes.
                </p>
              </div>
            )}
            {(showAll ? [...draft.transactions] : [...checks])
              .sort(
                (a, b) =>
                  Number(a.extractionConfidence >= 0.8) -
                    Number(b.extractionConfidence >= 0.8) ||
                  Number(a.duplicate === "none") -
                    Number(b.duplicate === "none"),
              )
              .map((t) => (
                <details
                  open={!!needsCheck(t)}
                  className={`review-row ${t.extractionConfidence < 0.8 ? "uncertain" : ""}`}
                  key={t.id}
                >
                  <summary className="review-compact">
                    <span>
                      <strong>{t.merchant || t.description}</strong>
                      <small>
                        {t.date} ·{" "}
                        {t.isTransfer
                          ? "Transfer"
                          : (categories?.find((c) => c.id === t.categoryId)
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
                            amountErrors.current.delete(t.id);
                            e.target.setCustomValidity("");
                            updateRow(t.id, {
                              amount,
                              type: t.isTransfer
                                ? "transfer"
                                : amount >= 0
                                  ? "income"
                                  : "expense",
                              acknowledged: true,
                            });
                          } catch {
                            amountErrors.current.add(t.id);
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
                        disabled={t.isTransfer}
                        value={t.categoryId ?? ""}
                        onChange={(e) =>
                          updateRow(t.id, {
                            manualCategory: true,
                            categoryId: e.target.value || undefined,
                            subcategoryId: undefined,
                          })
                        }
                      >
                        <option value="">Uncategorized</option>
                        {categories?.map((c) => (
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
                        value={t.type}
                        onChange={(e) =>
                          updateRow(t.id, {
                            manualCategory: true,
                            type: e.target.value as typeof t.type,
                            isTransfer: e.target.value === "transfer",
                            categoryId:
                              e.target.value === "transfer"
                                ? undefined
                                : t.categoryId,
                          })
                        }
                      >
                        {["income", "expense", "transfer"].map((v) => (
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
                          checked={t.acknowledged}
                          onChange={(e) =>
                            updateRow(t.id, { acknowledged: e.target.checked })
                          }
                        />
                        I verified this transaction{" "}
                        {t.duplicate !== "none" ? "and want to keep it" : ""}.
                      </label>
                    )}
                </details>
              ))}
          </section>
          <div className="import-footer">
            <span>
              {draft.transactions.filter((t) => t.include).length} new
              transactions selected
              {files.length > 1 && ` · File ${index + 1}/${files.length}`}
            </span>
            <button
              className="primary"
              disabled={
                busy ||
                (draft.exactDuplicate && !draft.duplicateOverride) ||
                (validation.status === "warning" && !override) ||
                (draft.warnings.length > 0 && !draft.reviewedWarnings) ||
                draft.transactions.some(
                  (t) =>
                    t.include &&
                    (t.extractionConfidence < 0.8 || t.duplicate !== "none") &&
                    !t.acknowledged,
                )
              }
              onClick={() => void save()}
            >
              Confirm import
            </button>
          </div>
        </>
      )}
    </>
  );
}
