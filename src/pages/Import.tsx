import { useState, useRef } from "react";
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
export default function ImportPage() {
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
  const amountErrors = useRef(new Set<string>());
  const navigate = useNavigate();
  const accounts = useLiveQuery(
    () => db.accounts.filter((a) => !a.isDemo).toArray(),
    [],
  );
  const categories = useLiveQuery(
    () => db.categories.filter((c) => !c.archived && !c.parentId).toArray(),
    [],
  );
  const process = async (file: File, ocr = false, existing?: ExtractedFile) => {
    setBusy(true);
    setError("");
    setDraft(undefined);
    setOverride(false);
    amountErrors.current.clear();
    try {
      const result = existing ?? (await extractFile(file, setStatus, ocr));
      setExtracted(result);
      const d = await prepareDraft(
        result,
        bank || undefined,
        accounts?.find((a) => a.id === accountId),
      );
      setDraft(d);
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
    setIndex(0);
    setSuccess("");
    setExtracted(undefined);
    await process(selected[0]);
  };
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
      setSuccess(
        `Imported ${n} new transactions from ${draft.statement.institution}.`,
      );
      setDraft(undefined);
      if (index + 1 < files.length) {
        setIndex(index + 1);
        setExtracted(undefined);
        await process(files[index + 1]);
      } else {
        setFiles([]);
        setStatus("Import complete");
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
  const flow = draft && cashFlow(draft.transactions, draft.statement.currency);
  const issues =
    draft?.transactions.filter(
      (t) =>
        t.extractionConfidence < 0.8 ||
        (!t.categoryId && !t.isTransfer) ||
        t.duplicate !== "none",
    ) ?? [];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">LOCAL PDF PROCESSING</p>
          <h1>Import statements</h1>
        </div>
      </div>
      <section className="card upload-card">
        <Upload size={28} />
        <h2>A month of clarity starts here.</h2>
        <p>
          Select monthly PDFs from Barclays, American Express or Revolut.
          Original PDFs are not retained.
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
      {busy && (
        <div className="notice" role="status">
          <span className="spinner" />
          {status}
          {files.length > 1 && ` · Statement ${index + 1} of ${files.length}`}
        </div>
      )}
      {success && (
        <div className="notice success" role="status">
          <CheckCircle2 size={18} />
          {success}
          <button onClick={() => navigate("/")}>View dashboard</button>
        </div>
      )}
      {error && (
        <div className="notice warning" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}
      {(error || draft) && files[index] && (
        <details className="card parse-options" open={!!error}>
          <summary>
            Bank and account selection <ChevronDown size={16} />
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
                void process(files[index + 1]);
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
                {draft.statement.extractionMethod}
              </span>
            </div>
            <p>
              {draft.account.displayName} ·{" "}
              {draft.account.maskedAccountIdentifier} ·{" "}
              {draft.statement.currency}
            </p>
            <p>
              {draft.statement.statementPeriodStart} to{" "}
              {draft.statement.statementPeriodEnd}
            </p>
            <div className="review-metrics">
              <div>
                <span>Transactions extracted</span>
                <strong>{draft.transactions.length}</strong>
              </div>
              <div>
                <span>Income before transfer matching</span>
                <strong>{money(flow.income, draft.statement.currency)}</strong>
              </div>
              <div>
                <span>Expenses before transfer matching</span>
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
              <strong>{issues.length} transactions need review.</strong> Verify
              uncertain amounts; you can categorize other transactions later.
            </p>
          </section>
          <section className="card review-transactions">
            <h2>Review transactions</h2>
            <p className="muted">
              All extracted rows are shown. Duplicates are kept only when you
              select them. Amount corrections update reconciliation.
            </p>
            {[...draft.transactions]
              .sort(
                (a, b) =>
                  Number(a.extractionConfidence >= 0.8) -
                    Number(b.extractionConfidence >= 0.8) ||
                  Number(a.duplicate === "none") -
                    Number(b.duplicate === "none"),
              )
              .map((t) => (
                <div
                  className={`review-row ${t.extractionConfidence < 0.8 ? "uncertain" : ""}`}
                  key={t.id}
                >
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
                        value={t.categoryId ?? ""}
                        onChange={(e) =>
                          updateRow(t.id, {
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
                </div>
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
