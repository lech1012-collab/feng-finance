import { CategoriesManager } from "../components/CategoriesManager";
import { ContextHelp } from "../components/ContextHelp";
import { StatusChip } from "../components/UIPrimitives";
import { AccountsContent } from "./Accounts";
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
import { BackupCentre } from "../components/BackupCentre";
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
import { SwitchRow } from "../components/UIPrimitives";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  SettingsNavigation,
  settingsSectionsForHash,
  settingsTitles,
} from "../components/SettingsNavigation";
import { Toast } from "../components/Toast";
import { undoChange } from "../storage/audit";
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
import { parseMoney, decimalMoney, money } from "../domain/money";
import { matches } from "../categorization/engine";
import { saveRule, deleteRule } from "../storage/rules";
import { formatDateRange } from "../domain/dates";
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
export default function Settings({
  beta,
  initialSection,
}: { beta?: BetaSettingsProps; initialSection?: string } = {}) {
  const currency = useGlobalCurrency();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const section =
    initialSection ??
    searchParams.get("section") ??
    (searchParams.has("rule")
      ? "rules"
      : settingsSectionsForHash[location.hash.slice(1)]);
  const activeSection =
    section && settingsTitles[section] ? section : undefined;
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
  const [noticeChangeId, setNoticeChangeId] = useState("");
  const [error, setError] = useState("");
  const [backupRequest, setBackupRequest] = useState(0);
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
      const result = await fn();
      setNoticeChangeId(
        result &&
          typeof result === "object" &&
          "changeId" in result &&
          typeof result.changeId === "string"
          ? result.changeId
          : "",
      );
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
  const exportBackup = () => {
    setSearchParams({ section: "backup", save: "1" });
    setBackupRequest((value) => value + 1);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          {activeSection && (
            <Link
              className="settings-back"
              to={initialSection ? "/" : "/settings"}
            >
              {initialSection ? "‹ Home" : "‹ Settings"}
            </Link>
          )}
          <h1>{activeSection ? settingsTitles[activeSection] : "Settings"}</h1>
        </div>
      </div>
      {!activeSection && <SettingsNavigation />}
      {activeSection === "about" && beta && (
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
      {activeSection === "backup" && <SafetyRecovery />}
      {activeSection === "imports" && <ImportLayoutsSettings />}
      {activeSection === "diagnostics" && <ImportDiagnosticsSettings />}
      {activeSection === "appearance" && <ThemeSetting />}
      {activeSection === "currency" && <CurrencySetting />}
      {activeSection === "period" && <PeriodSetting />}
      {activeSection === "transfers" && <TransferSettings />}
      {activeSection === "security" && <SecuritySettings />}
      {activeSection === "storage" && <StorageUsage />}
      {activeSection === "tags" && <TagManager />}

      {activeSection === "changes" && <RecentChanges />}
      {activeSection === "reports" && (
        <section className="card">
          <div className="context-help-heading">
            <h2>Reports</h2>
            <ContextHelp title="Property tax summary">
              <p>
                Adds rental income and selected allowable expenses to Analyse
                reports.
              </p>
            </ContextHelp>
          </div>
          <SwitchRow
            label="Enable property tax summary"
            checked={data?.taxEnabled ?? false}
            disabled={busy}
            onChange={(enabled) => {
              void run(
                () =>
                  auditedMutation(
                    "Change property tax reports",
                    ["settings"],
                    () =>
                      db.settings.put({
                        key: "property-tax-report",
                        value: String(enabled),
                      }),
                  ),
                "Report preference saved.",
              );
            }}
          />
        </section>
      )}
      {activeSection === "reminders" && (
        <Reminders currency={currency} settings />
      )}
      {notice && (
        <Toast
          message={notice}
          id={noticeChangeId}
          undo={
            noticeChangeId
              ? async () => {
                  await undoChange(noticeChangeId);
                  setNoticeChangeId("");
                  setNotice("Change undone.");
                }
              : undefined
          }
        />
      )}
      {error && (
        <div className="notice warning" role="alert">
          {error}
        </div>
      )}
      {activeSection === "backup" && (
        <BackupCentre
          requestSave={searchParams.get("save") === "1" ? 1 : backupRequest}
          onSaveOpened={() => {
            if (searchParams.has("save")) {
              const next = new URLSearchParams(searchParams);
              next.delete("save");
              setSearchParams(next, { replace: true });
            }
          }}
        />
      )}
      {activeSection === "export" && (
        <section className="card" id="data-export">
          <h2>Export</h2>
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
                "CSV export ready.",
              )
            }
          >
            Export transactions CSV
          </button>
        </section>
      )}
      {activeSection === "accounts" && <AccountsContent />}
      {activeSection === "categories" && <CategoriesManager />}
      {activeSection === "rules" && (
        <RulesManager initialRuleId={requestedRule ?? undefined} />
      )}
      {activeSection === "statements" && (
        <section className="card">
          <div className="context-help-heading">
            <h2>Statement history</h2>
            <ContextHelp title="Statement history">
              <p>Original PDFs are not stored.</p>
            </ContextHelp>
          </div>
          <div className="statement-history">
            {[
              ...new Set(
                data?.statements.map((s) => s.statementPeriodEnd.slice(0, 7)) ??
                  [],
              ),
            ].map((month) => (
              <details
                key={month}
                open={
                  month === data?.statements[0]?.statementPeriodEnd.slice(0, 7)
                }
              >
                <summary>
                  {new Date(`${month}-01T12:00:00Z`).toLocaleDateString(
                    "en-GB",
                    { month: "long", year: "numeric", timeZone: "UTC" },
                  )}
                </summary>
                {data?.statements
                  .filter((s) => s.statementPeriodEnd.startsWith(month))
                  .map((s) => (
                    <details key={s.id}>
                      <summary>
                        {s.institution} ·{" "}
                        {data.accounts.find((a) => a.id === s.accountId)
                          ?.displayName ?? s.institution}{" "}
                        · {s.transactionCount} transaction
                        {s.transactionCount === 1 ? "" : "s"} ·{" "}
                        <StatusChip
                          tone={
                            s.validationStatus === "reconciled"
                              ? "complete"
                              : "warning"
                          }
                        >
                          {s.validationStatus === "reconciled"
                            ? "Reconciled"
                            : "Unverified"}
                        </StatusChip>
                      </summary>
                      <dl className="totals">
                        <div>
                          <dt>Statement dates</dt>
                          <dd>
                            {formatDateRange(
                              s.statementPeriodStart,
                              s.statementPeriodEnd,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Closing balance</dt>
                          <dd>
                            {s.closingBalance === undefined
                              ? "Unavailable"
                              : money(s.closingBalance, s.currency)}
                          </dd>
                        </div>
                        <div>
                          <dt>Difference</dt>
                          <dd>
                            {s.validationDifference === undefined
                              ? "Unavailable"
                              : money(s.validationDifference, s.currency)}
                          </dd>
                        </div>
                      </dl>
                      {s.validationOverride && (
                        <p className="notice warning">
                          Imported with an explicit validation override.
                        </p>
                      )}
                      {s.warnings.map((w, i) => (
                        <p key={i}>{w}</p>
                      ))}
                      <details>
                        <summary>Technical details</summary>
                        <p>
                          {s.sourceFilename} · Parser {s.parserVersion} ·{" "}
                          {s.extractionMethod}
                        </p>
                      </details>
                    </details>
                  ))}
              </details>
            ))}
          </div>
        </section>
      )}
      {activeSection === "demo" && (
        <section className="card">
          <h2>Demo data</h2>
          <p className="muted">
            Explore with fictitious data; deleting it keeps your imported
            records.
          </p>
          <div className="actions demo-actions">
            <button
              disabled={busy}
              onClick={() => void run(loadDemo, "Fictitious demo data added.")}
            >
              Load demo data
            </button>
            <button
              disabled={busy}
              className="danger"
              onClick={() => {
                if (
                  window.confirm(
                    "Delete fictitious demo data? Imported records and your categories are kept. You can undo this change.",
                  )
                )
                  void run(deleteDemo, "Demo data deleted.");
              }}
            >
              Delete demo data
            </button>
          </div>
        </section>
      )}
      {activeSection === "about" && (
        <details className="card">
          <summary>Technical details</summary>
          <p>Database schema {SCHEMA_VERSION} · Backup format 1</p>
        </details>
      )}
      {activeSection === "danger" && (
        <section className="card danger-zone">
          <h2>Danger zone</h2>
          <button disabled={busy} onClick={exportBackup}>
            <Download size={20} aria-hidden="true" />
            Back up before deleting
          </button>
          <div className="danger-section">
            <h3>Delete transactions, keep accounts and rules</h3>
            <p className="muted">
              Removes statements, transactions and transfer links. Keeps
              accounts, categories, rules and settings for reimporting.
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
                }, "Imported records deleted. Accounts and saved categorisation rules kept.")
              }
            >
              Delete imported records
            </button>
          </div>
          <div className="danger-section">
            <h3>Erase everything</h3>
            <p className="muted">
              Removes all accounts, statements, transactions, personal
              categories, learned rules and settings. Default categories are
              restored.
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
      )}
    </>
  );
}
