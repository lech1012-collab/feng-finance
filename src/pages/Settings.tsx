import {
  AboutLifecycle,
  type DesktopInstallControl,
} from "../beta/AboutLifecycle";
import type { RuntimeMode } from "../beta/policy";
import { FeedbackPanel } from "../components/FeedbackPanel";
import { RELEASE_CONFIGURATION as releaseConfiguration } from "../beta/configuration";
import { SafetyRecovery } from "../components/SafetyRecovery";
import { ImportLayoutsSettings } from "../components/ImportLayoutsSettings";
import { ImportDiagnosticsSettings } from "../components/ImportDiagnosticsSettings";
import { TransferSettings } from "../components/TransferReview";
import { auditedMutation } from "../storage/audit";
import { SecuritySettings } from "../components/SecuritySettings";
import { EncryptedBackup } from "../components/EncryptedBackup";
import { StorageUsage } from "../components/StorageUsage";
import { ManualAccountEditor } from "../components/ManualAccountEditor";
import { PeriodSetting } from "../components/PeriodSetting";
import { RecentChanges } from "../components/RecentChanges";
import { RulesManager } from "../components/RulesManager";
import { TagManager } from "../components/TagManager";
import { CurrencySetting } from "../components/CurrencySetting";
import { Reminders } from "../components/Reminders";
import { useGlobalCurrency } from "../components/CurrencySetting";
import { ThemeSetting } from "../components/Theme";
import { PersonalRules } from "../components/PersonalRules";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Download, Database, Plus, Upload, Trash2, Pencil } from "lucide-react";
import { db } from "../storage/database";
import {
  exportBackupFile,
  restoreBackup,
  validateBackup,
  download,
  exportCsv,
  clearLocalData,
  deleteImportedRecords,
} from "../storage/backup";
import { loadDemo, deleteDemo } from "../storage/demo";
import { id } from "../domain/normalize";
import {
  APP_VERSION,
  SCHEMA_VERSION,
  type Backup,
  type Institution,
  type Category,
  type Rule,
  type Account,
} from "../domain/models";
import { parseMoney, decimalMoney } from "../domain/money";
import { matches } from "../categorization/engine";
import { saveRule, deleteRule } from "../storage/rules";
import { formatUkDate } from "../domain/dates";
import { backupErrorMessage } from "../storage/backup-error";
import {
  BackupFileTooLargeError,
  MAX_BACKUP_FILE_BYTES,
} from "../storage/backup-limits";
export interface BetaSettingsProps {
  mode: RuntimeMode;
  storagePersisted: boolean;
  desktopInstall: DesktopInstallControl;
  onRequestStorage: () => Promise<void>;
}
export default function Settings({ beta }: { beta?: BetaSettingsProps } = {}) {
  const currency = useGlobalCurrency();
  const [searchParams] = useSearchParams();
  const requestedRule = searchParams.get("rule");
  const data = useLiveQuery(
    async () => ({
      accounts: await db.accounts.toArray(),
      taxEnabled:
        (await db.settings.get("property-tax-report"))?.value === "true",
      categories: await db.categories.toArray(),
      rules: await db.rules.orderBy("priority").reverse().toArray(),
      count: await db.transactions.count(),
      backupAt: (await db.settings.get("backup:lastExportAt"))?.value,
      backupCount: (await db.settings.get("backup:lastExportCount"))?.value,
      diagnostics: await db.importDiagnostics
        .orderBy("createdAt")
        .reverse()
        .limit(5)
        .toArray(),
      statements: await db.statements
        .orderBy("statementPeriodEnd")
        .reverse()
        .toArray(),
    }),
    [],
  );
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Backup>();
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [includeBackupAttachments, setIncludeBackupAttachments] =
    useState(true);
  const [erasePhrase, setErasePhrase] = useState("");
  const [showRules, setShowRules] = useState(!!requestedRule);
  useEffect(() => {
    if (requestedRule) {
      setShowRules(true);
      document.getElementById("rules")?.scrollIntoView?.({ block: "start" });
    }
  }, [requestedRule]);
  const [deleteImportsConfirmed, setDeleteImportsConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryKind, setCategoryKind] = useState<"income" | "expense">(
    "expense",
  );
  const [categoryParent, setCategoryParent] = useState("");
  const [bank, setBank] = useState<Institution>("Barclays");
  const [accountName, setAccountName] = useState("");
  const [accountCurrency, setAccountCurrency] = useState("GBP");
  const [accountMask, setAccountMask] = useState("");
  const run = async (
    fn: () => Promise<unknown>,
    message: string,
    errorMessage?: (error: unknown) => string,
  ) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(message);
    } catch (e) {
      setError(
        errorMessage
          ? errorMessage(e)
          : e instanceof Error
            ? e.message
            : "The operation failed. Your existing data is safe.",
      );
    } finally {
      setBusy(false);
    }
  };
  const backup = async () => {
    await exportBackupFile({ includeAttachments: includeBackupAttachments });
  };
  const backupTime = data?.backupAt ? Date.parse(data.backupAt) : NaN;
  const backupOverdue =
    (data?.count ?? 0) > 0 &&
    (!Number.isFinite(backupTime) || Date.now() - backupTime > 30 * 86400000);
  const exportBackup = () =>
    void run(
      backup,
      "Backup prepared for download. Save it in Files or iCloud Drive.",
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Settings</h1>
        </div>
        <span className="small-chip">v{APP_VERSION}</span>
      </div>
      {beta && (
        <AboutLifecycle
          mode={beta.mode}
          storagePersisted={beta.storagePersisted}
          buildDate={releaseConfiguration.buildDate}
          desktopInstall={beta.desktopInstall}
          onRequestStorage={beta.onRequestStorage}
          feedback={
            <FeedbackPanel
              configuration={releaseConfiguration}
              diagnostics={data?.diagnostics ?? []}
            />
          }
        />
      )}
      <SafetyRecovery />
      <ImportLayoutsSettings />
      <ImportDiagnosticsSettings />
      <ThemeSetting />
      <CurrencySetting />
      <PeriodSetting />
      <TransferSettings />
      <SecuritySettings />
      <StorageUsage />
      <div id="manual-accounts">
        <ManualAccountEditor currency={currency} />
      </div>
      <TagManager />

      <RecentChanges />
      <section className="card">
        <h2>Reports</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={data?.taxEnabled ?? false}
            onChange={(e) =>
              void auditedMutation(
                "Change property tax reports",
                ["settings"],
                () =>
                  db.settings.put({
                    key: "property-tax-report",
                    value: String(e.target.checked),
                  }),
              )
            }
          />
          Enable property tax summary
        </label>
        <p className="muted">
          Adds rental income and selected allowable expenses to Analyse reports.
        </p>
      </section>
      <Reminders currency={currency} settings />
      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="notice warning" role="alert">
          {error}
        </div>
      )}
      <EncryptedBackup
        onRestorePreview={(backup) => {
          setPending(backup);
          setReplaceConfirmed(false);
        }}
      />
      <section className="card" id="backup">
        <h2>
          <Database size={19} />
          Backup
        </h2>
        <p className="muted">
          Save your {data?.count ?? 0} transaction{data?.count === 1 ? "" : "s"}{" "}
          to Files or iCloud Drive.
        </p>
        <p
          className={`backup-status ${backupOverdue ? "backup-status--overdue" : ""}`}
        >
          {Number.isFinite(backupTime)
            ? `Last backup export: ${formatUkDate(data!.backupAt!.slice(0, 10))} · ${Number(data?.backupCount) || 0} transaction${Number(data?.backupCount) === 1 ? "" : "s"}`
            : "No backup exported yet."}
          {backupOverdue && (
            <strong>
              {" "}
              {Number.isFinite(backupTime)
                ? "Over 30 days ago. Save a fresh backup."
                : "Save your first backup."}
            </strong>
          )}
        </p>
        <div className="actions">
          <button className="primary" disabled={busy} onClick={exportBackup}>
            <Download size={17} />
            Export Feng Finance Backup
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(
                async () =>
                  download(
                    await exportCsv(),
                    "text/csv",
                    `feng-finance-transactions-${new Date().toISOString().slice(0, 10)}.csv`,
                  ),
                "CSV export downloaded.",
              )
            }
          >
            <Download size={17} />
            Export transactions CSV
          </button>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={includeBackupAttachments}
            disabled={busy}
            onChange={(event) =>
              setIncludeBackupAttachments(event.target.checked)
            }
          />
          Include attachments in JSON backup
        </label>
        {!includeBackupAttachments && (
          <p className="muted">
            Notes and financial records are included. Images and attached PDFs
            are omitted.
          </p>
        )}
        <details>
          <summary>Learn more about local storage</summary>
          <p>
            Browser data can be removed by the operating system or when you
            clear site data. Feng can record a backup download, but cannot
            verify that you saved the file.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (!navigator.storage?.persist)
                  throw new Error(
                    "Persistent storage requests are not supported by this browser. Keep backups in Files.",
                  );
                const granted = await navigator.storage.persist();
                await db.settings.put({
                  key: "storagePersisted",
                  value: String(granted),
                });
                if (!granted)
                  throw new Error(
                    "The browser did not grant persistent storage. Keep backups in Files.",
                  );
              }, "Persistent storage is enabled on this browser.")
            }
          >
            Request persistent storage
          </button>
        </details>
      </section>
      <section className="card">
        <h2>
          <Upload size={19} />
          Restore
        </h2>
        <p className="muted">
          Restoring a backup replaces the data on this device.
        </p>
        <label className="button file-button">
          <Upload size={17} />
          Restore Feng Finance Backup
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Restore Feng Finance Backup"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setPending(undefined);
              setReplaceConfirmed(false);
              await run(
                async () => {
                  if (file.size > MAX_BACKUP_FILE_BYTES)
                    throw new BackupFileTooLargeError();
                  setPending(validateBackup(JSON.parse(await file.text())));
                },
                "Backup validated. Review the replacement warning below.",
                backupErrorMessage,
              );
              e.target.value = "";
            }}
          />
        </label>
        {pending && (
          <div className="restore-warning">
            <h3>Replace all local financial data?</h3>
            <dl className="settings-preview" aria-label="Backup contents">
              {[
                { count: pending.accounts.length, label: "account" },
                { count: pending.transactions.length, label: "transaction" },
                { count: pending.statements.length, label: "statement" },
                {
                  count: pending.rules.filter((r) => !r.builtIn).length,
                  label: "personal rule",
                },
              ].map(({ count, label }) => (
                <div className="restore-count" key={label}>
                  <dt>{count === 1 ? label : `${label}s`}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
            <p className="muted">
              Exported {formatUkDate(pending.exportedAt.slice(0, 10))} · Backup
              version {pending.version} · Database version{" "}
              {pending.schemaVersion}
            </p>
            {pending.transactions.length > 0 && (
              <p className="muted">
                Transaction dates:{" "}
                {formatUkDate(
                  [...pending.transactions].map((t) => t.date).sort()[0],
                )}{" "}
                to{" "}
                {formatUkDate(
                  [...pending.transactions]
                    .map((t) => t.date)
                    .sort()
                    .at(-1)!,
                )}
              </p>
            )}
            <p>
              Current accounts, transactions, categories, rules and settings
              will be replaced. You need a backup to undo this.
            </p>
            <button disabled={busy} onClick={exportBackup}>
              Back up current data first
            </button>
            <label className="check">
              <input
                type="checkbox"
                checked={replaceConfirmed}
                onChange={(e) => setReplaceConfirmed(e.target.checked)}
              />
              I understand that this replaces all existing data on this device.
            </label>
            <div className="actions">
              <button
                disabled={!replaceConfirmed || busy}
                className="danger"
                onClick={() =>
                  void run(
                    async () => {
                      await restoreBackup(pending);
                      setPending(undefined);
                    },
                    "Backup restored successfully.",
                    (error) => backupErrorMessage(error, "restore"),
                  )
                }
              >
                Replace data with backup
              </button>
              <button onClick={() => setPending(undefined)}>
                Cancel restore
              </button>
            </div>
          </div>
        )}
      </section>
      <section className="card">
        <h2>Accounts</h2>
        {data?.accounts.map((a) => (
          <div className="settings-row" key={a.id}>
            <div>
              <strong>
                {a.institution} · {a.displayName}
              </strong>
              <p>
                {a.maskedAccountIdentifier} · {a.currency} · {a.accountType}
                {a.isDemo ? " · Demo" : ""}
              </p>
            </div>
            <label>
              <span className="sr-only">Rename {a.displayName}</span>
              <input
                defaultValue={a.displayName}
                maxLength={100}
                onBlur={(e) => {
                  if (e.target.value.trim())
                    void run(
                      () =>
                        auditedMutation("Rename account", ["accounts"], () =>
                          db.accounts.update(a.id, {
                            displayName: e.target.value.trim(),
                            updatedAt: new Date().toISOString(),
                          }),
                        ),
                      "Account renamed.",
                    );
                }}
              />
            </label>
          </div>
        ))}
        <details>
          <summary>Add an account manually</summary>
          <p className="muted">
            Use this when a PDF does not expose a readable account identifier.
          </p>
          <div className="form-grid">
            <label>
              Institution
              <select
                aria-label="Institution"
                value={bank}
                onChange={(e) => setBank(e.target.value as Institution)}
              >
                {["Barclays", "American Express", "Revolut", "Other"].map(
                  (b) => (
                    <option key={b}>{b}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              Display name
              <input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                maxLength={100}
              />
            </label>
            <label>
              Last 4 characters
              <input
                value={accountMask}
                onChange={(e) =>
                  setAccountMask(
                    e.target.value.replace(/[^a-z\d]/gi, "").slice(0, 4),
                  )
                }
                maxLength={4}
              />
            </label>
            <label>
              Currency
              <select
                aria-label="Currency"
                value={accountCurrency}
                onChange={(e) => setAccountCurrency(e.target.value)}
              >
                {[
                  "GBP",
                  "EUR",
                  "USD",
                  "CHF",
                  "AUD",
                  "CAD",
                  "NZD",
                  "HKD",
                  "SGD",
                  "JPY",
                  "KWD",
                ].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <button
            disabled={!accountName.trim() || accountMask.length !== 4 || busy}
            onClick={() =>
              void run(async () => {
                const now = new Date().toISOString();
                await auditedMutation(
                  "Add statement account",
                  ["accounts"],
                  () =>
                    db.accounts.add({
                      id: id(),
                      institution: bank,
                      displayName: accountName.trim(),
                      accountType:
                        bank === "American Express" ? "credit" : "current",
                      currency: accountCurrency,
                      maskedAccountIdentifier: `•••• ${accountMask}`,
                      createdAt: now,
                      updatedAt: now,
                    }),
                );
                setAccountName("");
                setAccountMask("");
              }, "Account created.")
            }
          >
            <Plus size={16} />
            Add account
          </button>
        </details>
      </section>
      <details className="card settings-disclosure">
        <summary>Categories</summary>
        <p className="muted">
          Archiving preserves historical transactions. Property and Property
          income retain their analysis roles when renamed.
        </p>
        <div className="category-settings">
          {data?.categories
            .filter((c) => !c.parentId)
            .map((c) => (
              <CategoryEditor
                key={c.id}
                category={c}
                childrenCategories={data.categories.filter(
                  (s) => s.parentId === c.id,
                )}
                run={run}
              />
            ))}
        </div>
        <div className="form-grid">
          <label>
            New category name
            <input
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              maxLength={100}
            />
          </label>
          <label>
            Parent
            <select
              aria-label="Parent"
              value={categoryParent}
              onChange={(e) => {
                setCategoryParent(e.target.value);
                const parent = data?.categories.find(
                  (c) => c.id === e.target.value,
                );
                if (parent) setCategoryKind(parent.kind);
              }}
            >
              <option value="">Top-level category</option>
              {data?.categories
                .filter((c) => !c.parentId && !c.archived)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Kind
            <select
              aria-label="Kind"
              disabled={!!categoryParent}
              value={categoryKind}
              onChange={(e) =>
                setCategoryKind(e.target.value as typeof categoryKind)
              }
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </label>
        </div>
        <button
          disabled={!categoryName.trim() || busy}
          onClick={() =>
            void run(async () => {
              await auditedMutation("Add category", ["categories"], () =>
                db.categories.add({
                  id: id(),
                  name: categoryName.trim(),
                  kind: categoryKind,
                  parentId: categoryParent || undefined,
                  archived: false,
                  color: "#48708b",
                }),
              );
              setCategoryName("");
            }, "Category added.")
          }
        >
          <Plus size={16} />
          Add {categoryParent ? "subcategory" : "category"}
        </button>
      </details>
      <details
        className="card settings-disclosure"
        id="rules"
        open={showRules}
        onToggle={(e) => setShowRules(e.currentTarget.open)}
      >
        <summary>Categorization & transfer rules</summary>
        <p className="muted">
          Your category choices are learned automatically. Changes here apply to
          future imports.
        </p>
        <RulesManager />
        <details>
          <summary>
            Built-in merchant mappings (
            {data?.rules.filter((r) => r.builtIn).length ?? 0})
          </summary>
          {data?.rules
            .filter((r) => r.builtIn)
            .map((r) => (
              <p key={r.id}>{r.name}</p>
            ))}
        </details>
      </details>
      <details className="card settings-disclosure">
        <summary>Statement history</summary>
        <p className="muted">
          Import checks are retained; original PDFs are not stored.
        </p>
        <div className="statement-history">
          {data?.statements.slice(0, 50).map((s) => (
            <details key={s.id}>
              <summary>
                {s.institution} · {formatUkDate(s.statementPeriodEnd)} ·{" "}
                {s.transactionCount} new transaction
                {s.transactionCount === 1 ? "" : "s"} · {s.validationStatus}
              </summary>
              <p>
                {s.sourceFilename} · parser {s.parserVersion} ·{" "}
                {s.extractionMethod}
              </p>
              <p>
                Difference (minor units):{" "}
                {s.validationDifference ?? "unavailable"}
                {s.validationOverride ? " · Explicit validation override" : ""}
              </p>
              {s.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </details>
          ))}
          {(data?.statements.length ?? 0) > 50 && (
            <p>
              Showing the latest 50 statements. All metadata is included in your
              backup.
            </p>
          )}
        </div>
      </details>
      <section className="card">
        <h2>Demo data</h2>
        <p className="muted">
          Explore with fictitious data; deleting it keeps your imported records.
        </p>
        <div className="actions">
          <button
            disabled={busy}
            onClick={() => void run(loadDemo, "Fictitious demo data added.")}
          >
            Load demo data
          </button>
          <button
            disabled={busy}
            onClick={() => void run(deleteDemo, "Demo data deleted.")}
          >
            Delete demo data
          </button>
        </div>
      </section>
      <p className="muted">
        IndexedDB schema {SCHEMA_VERSION} · Backup format 1
      </p>
      <section className="card danger-zone">
        <h2>Danger zone</h2>
        <button disabled={busy} onClick={exportBackup}>
          <Download size={17} />
          Back up before deleting
        </button>
        <div className="danger-section">
          <h3>Delete transactions, keep accounts and rules</h3>
          <p className="muted">
            Removes statements, transactions and transfer links. Keeps accounts,
            categories, rules and settings for reimporting.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={deleteImportsConfirmed}
              onChange={(e) => setDeleteImportsConfirmed(e.target.checked)}
            />
            I understand my imported transaction history will be deleted.
          </label>
          <button
            className="danger"
            disabled={busy || !deleteImportsConfirmed}
            onClick={() =>
              void run(async () => {
                await deleteImportedRecords();
                setDeleteImportsConfirmed(false);
              }, "Imported records deleted. Accounts and saved categorization rules kept.")
            }
          >
            Delete imported records
          </button>
        </div>
        <div className="danger-section">
          <h3>Erase everything</h3>
          <p className="muted">
            Removes all accounts, statements, transactions, personal categories,
            learned rules and settings. Default categories are restored.
          </p>
          <label className="erase-confirm">
            Type ERASE to confirm permanent deletion
            <input
              value={erasePhrase}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setErasePhrase(e.target.value)}
              aria-label="Type ERASE to confirm permanent deletion"
            />
          </label>
          <button
            className="danger"
            disabled={erasePhrase !== "ERASE" || busy}
            onClick={() =>
              void run(async () => {
                if (erasePhrase !== "ERASE")
                  throw new Error("Type ERASE before deleting all data.");
                await clearLocalData();
                setErasePhrase("");
              }, "All local financial data was cleared.")
            }
          >
            Erase everything
          </button>
        </div>
      </section>
    </>
  );
}
function CategoryEditor({
  category,
  childrenCategories,
  run,
}: {
  category: Category;
  childrenCategories: Category[];
  run: (fn: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const editor = (c: Category) => (
    <div
      className={`settings-row ${c.parentId ? "subcategory" : ""}`}
      key={c.id}
    >
      <label>
        <span className="sr-only">Rename category {c.name}</span>
        <input
          aria-label={`Rename category ${c.name}`}
          defaultValue={c.name}
          maxLength={100}
          onBlur={(e) => {
            if (e.target.value.trim() && e.target.value.trim() !== c.name)
              void run(
                () =>
                  auditedMutation("Rename category", ["categories"], () =>
                    db.categories.update(c.id, { name: e.target.value.trim() }),
                  ),
                "Category renamed.",
              );
          }}
        />
      </label>
      <span className="muted">{c.kind}</span>
      <button
        onClick={() =>
          void run(
            () =>
              auditedMutation("Archive category", ["categories"], () =>
                db.categories.update(c.id, { archived: !c.archived }),
              ),
            c.archived ? "Category restored." : "Category archived.",
          )
        }
      >
        {c.archived ? "Unarchive" : "Archive"}
      </button>
    </div>
  );
  return (
    <>
      {editor(category)}
      {childrenCategories.map(editor)}
    </>
  );
}
