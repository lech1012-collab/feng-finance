import { CurrencySetting } from "../components/CurrencySetting";
import { Reminders } from "../components/Reminders";
import { useGlobalCurrency } from "../components/CurrencySetting";
import { ThemeSetting } from "../components/Theme";
import { PersonalRules } from "../components/PersonalRules";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Download,
  ShieldCheck,
  Database,
  Plus,
  Upload,
  Trash2,
  Pencil,
} from "lucide-react";
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
export default function Settings() {
  const currency = useGlobalCurrency();
  const [searchParams] = useSearchParams();
  const requestedRule = searchParams.get("rule");
  const data = useLiveQuery(
    async () => ({
      accounts: await db.accounts.toArray(),
      categories: await db.categories.toArray(),
      rules: await db.rules.orderBy("priority").reverse().toArray(),
      count: await db.transactions.count(),
      backupAt: (await db.settings.get("backup:lastExportAt"))?.value,
      backupCount: (await db.settings.get("backup:lastExportCount"))?.value,
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
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(message);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The operation failed. Your existing data is safe.",
      );
    } finally {
      setBusy(false);
    }
  };
  const backup = async () => {
    await exportBackupFile();
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
      <ThemeSetting />
      <CurrencySetting />
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
      <section className="card" id="backup">
        <h2>
          <Database size={19} />
          Backup
        </h2>
        <p className="muted">
          Save your {data?.count ?? 0} transactions to Files or iCloud Drive.
        </p>
        <p
          className={`backup-status ${backupOverdue ? "backup-status--overdue" : ""}`}
        >
          {Number.isFinite(backupTime)
            ? `Last backup export: ${formatUkDate(data!.backupAt!.slice(0, 10))} · ${Number(data?.backupCount) || 0} transactions`
            : "No backup exported yet."}
          {backupOverdue && (
            <strong>
              {" "}
              {Number.isFinite(backupTime)
                ? "Over 30 days ago—save a fresh backup."
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
                if (!(await navigator.storage.persist()))
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
              await run(async () => {
                if (file.size > 50 * 1024 * 1024)
                  throw new Error("Backup exceeds the 50 MB limit.");
                setPending(validateBackup(JSON.parse(await file.text())));
              }, "Backup validated. Review the replacement warning below.");
              e.target.value = "";
            }}
          />
        </label>
        {pending && (
          <div className="restore-warning">
            <h3>Replace all local financial data?</h3>
            <div className="settings-preview" aria-label="Backup contents">
              <span>
                <strong>{pending.accounts.length}</strong> accounts
              </span>
              <span>
                <strong>{pending.transactions.length}</strong> transactions
              </span>
              <span>
                <strong>{pending.statements.length}</strong> statements
              </span>
              <span>
                <strong>
                  {pending.rules.filter((r) => !r.builtIn).length}
                </strong>{" "}
                personal rules
              </span>
            </div>
            <p className="muted">
              Exported {formatUkDate(pending.exportedAt.slice(0, 10))} · Backup
              version {pending.version} · Database version{" "}
              {pending.schemaVersion}
            </p>
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
                  void run(async () => {
                    await restoreBackup(pending);
                    setPending(undefined);
                  }, "Backup restored successfully.")
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
                        db.accounts.update(a.id, {
                          displayName: e.target.value.trim(),
                          updatedAt: new Date().toISOString(),
                        }),
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
                await db.accounts.add({
                  id: id(),
                  institution: bank,
                  displayName: accountName.trim(),
                  accountType:
                    bank === "American Express" ? "credit" : "current",
                  currency: accountCurrency,
                  maskedAccountIdentifier: `•••• ${accountMask}`,
                  createdAt: now,
                  updatedAt: now,
                });
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
              await db.categories.add({
                id: id(),
                name: categoryName.trim(),
                kind: categoryKind,
                parentId: categoryParent || undefined,
                archived: false,
                color: "#48708b",
              });
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
        {showRules && (
          <RuleList
            rules={data?.rules ?? []}
            categories={data?.categories ?? []}
            accounts={data?.accounts ?? []}
            run={run}
            busy={busy}
            requestedRule={requestedRule ?? undefined}
          />
        )}
        <RuleForm
          categories={data?.categories ?? []}
          accounts={data?.accounts ?? []}
          run={run}
          busy={busy}
        />
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
        <details>
          <summary>Advanced: import personal rules</summary>
          <PersonalRules />
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
                {s.transactionCount} new transactions · {s.validationStatus}
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
      <section className="card privacy-card">
        <h2>
          <ShieldCheck size={20} />
          Privacy & installation
        </h2>
        <p className="muted">
          Statements and financial data stay on this device.
        </p>
        <details>
          <summary>Learn more about privacy and installation</summary>
          <p>
            Statements are parsed locally using PDF.js and OCR. There are no
            analytics, external AI calls, API keys or cloud sync. The host
            serves static app assets; after the offline cache is ready, imports
            need no network access.
          </p>
          <p>
            On iPhone, open Feng in Safari → Share → Add to Home Screen → Open
            as Web App → Add.
          </p>
        </details>
        <p>
          This application does not encrypt its local database. Protect your
          device with a passcode; anyone using this browser profile can access
          its financial data.
        </p>
        <p>
          App {APP_VERSION} · IndexedDB schema {SCHEMA_VERSION} · Backup format
          1
        </p>
      </section>
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
                  db.categories.update(c.id, { name: e.target.value.trim() }),
                "Category renamed.",
              );
          }}
        />
      </label>
      <span className="muted">{c.kind}</span>
      <button
        onClick={() =>
          void run(
            () => db.categories.update(c.id, { archived: !c.archived }),
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
function RuleList({
  rules,
  categories,
  accounts,
  run,
  busy,
  requestedRule,
}: {
  rules: Rule[];
  categories: Category[];
  accounts: Account[];
  run: (fn: () => Promise<unknown>, message: string) => Promise<void>;
  busy: boolean;
  requestedRule?: string;
}) {
  const [editing, setEditing] = useState<Rule>();
  const openedRule = useRef<string | undefined>(undefined);
  useEffect(() => {
    const selected = rules.find(
      (rule) => rule.id === requestedRule && !rule.builtIn,
    );
    if (selected && openedRule.current !== selected.id) {
      openedRule.current = selected.id;
      setEditing(selected);
    }
  }, [requestedRule, rules]);
  const transactions = useLiveQuery(() => db.transactions.toArray(), []);
  const stats = useMemo(
    () =>
      new Map(
        rules
          .filter((r) => !r.builtIn)
          .map((rule) => {
            const matching = transactions?.filter((t) => matches(rule, t));
            const lastUsedAt = transactions
              ?.filter((t) => t.categoryRuleId === rule.id)
              .reduce<string | undefined>(
                (last, t) => (!last || t.updatedAt > last ? t.updatedAt : last),
                rule.lastUsedAt,
              );
            return [
              rule.id,
              {
                count: matching?.length,
                lastUsedAt: lastUsedAt ?? rule.lastUsedAt,
              },
            ];
          }),
      ),
    [rules, transactions],
  );
  const personal = rules.filter((r) => !r.builtIn);
  return (
    <div className="rule-list">
      {!personal.length && (
        <p className="muted">
          No personal rules yet. Categorize a transaction to create one
          automatically.
        </p>
      )}
      {personal.map((rule) => (
        <div className="rule-item" key={rule.id}>
          <div className="rule-details">
            <strong>
              {rule.pattern} →{" "}
              {rule.type === "transfer"
                ? "Transfer"
                : (categories.find(
                    (c) => c.id === (rule.subcategoryId ?? rule.categoryId),
                  )?.name ?? "Unavailable category")}
            </strong>
            <p>
              {rule.accountId
                ? accountLabel(accounts.find((a) => a.id === rule.accountId))
                : "All accounts"}{" "}
              ·{" "}
              {rule.match === "exact"
                ? "Exact merchant"
                : rule.match === "starts-with"
                  ? "Starts with"
                  : "Contains text"}{" "}
              ·{" "}
              {rule.direction === "positive"
                ? "Money in"
                : rule.direction === "negative"
                  ? "Money out"
                  : "Either direction"}
            </p>
            <p className="muted">
              {stats.get(rule.id)?.count === undefined
                ? "Checking matches…"
                : `${stats.get(rule.id)!.count} matching transactions`}{" "}
              · Last used:{" "}
              {stats.get(rule.id)?.lastUsedAt
                ? formatUkDate(stats.get(rule.id)!.lastUsedAt!.slice(0, 10))
                : "not recorded"}
            </p>
          </div>
          <div className="actions">
            <button
              disabled={busy}
              aria-label={`Edit rule ${rule.name}`}
              onClick={() => setEditing(rule)}
            >
              <Pencil size={16} />
              Edit
            </button>
            <button
              disabled={busy}
              aria-label={`Delete rule ${rule.name}`}
              onClick={() =>
                void run(async () => {
                  await deleteRule(rule);
                  if (editing?.id === rule.id) setEditing(undefined);
                }, "Rule deleted. Existing transactions kept.")
              }
            >
              <Trash2 size={16} />
              Delete
            </button>
          </div>
          {editing?.id === rule.id && (
            <RuleForm
              key={rule.id}
              rule={editing}
              categories={categories}
              accounts={accounts}
              run={run}
              busy={busy}
              onClose={() => setEditing(undefined)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
function RuleForm({
  categories,
  accounts,
  run,
  busy,
  rule,
  onClose,
}: {
  categories: Category[];
  accounts: Account[];
  run: (fn: () => Promise<unknown>, message: string) => Promise<void>;
  busy: boolean;
  rule?: Rule;
  onClose?: () => void;
}) {
  const [pattern, setPattern] = useState(rule?.pattern ?? "");
  const [category, setCategory] = useState(rule?.categoryId ?? "");
  const [subcategory, setSubcategory] = useState(rule?.subcategoryId ?? "");
  const [match, setMatch] = useState<Rule["match"]>(rule?.match ?? "contains");
  const [direction, setDirection] = useState<Rule["direction"]>(
    rule?.direction ?? "any",
  );
  const [transfer, setTransfer] = useState(rule?.type === "transfer");
  const [account, setAccount] = useState(rule?.accountId ?? "");
  const [priority, setPriority] = useState(rule?.priority ?? 100);
  const initialCurrency = accounts.find(
    (a) => a.id === rule?.accountId,
  )?.currency;
  const [min, setMin] = useState(
    rule?.minAmount === undefined
      ? ""
      : decimalMoney(rule.minAmount, initialCurrency),
  );
  const [max, setMax] = useState(
    rule?.maxAmount === undefined
      ? ""
      : decimalMoney(rule.maxAmount, initialCurrency),
  );
  return (
    <details className="rule-editor" open={rule ? true : undefined}>
      <summary>
        {rule
          ? "Edit categorization rule"
          : "Create a categorization or transfer rule"}
      </summary>
      <div className="form-grid">
        <label>
          Text pattern
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            maxLength={500}
          />
        </label>
        <label>
          Match
          <select
            aria-label="Match"
            value={match}
            onChange={(e) => setMatch(e.target.value as Rule["match"])}
          >
            <option value="contains">Contains text</option>
            <option value="starts-with">Starts with</option>
            <option value="exact">Exact merchant</option>
          </select>
        </label>
        <label>
          Direction
          <select
            aria-label="Direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value as Rule["direction"])}
          >
            <option value="any">Any direction</option>
            <option value="positive">Money in</option>
            <option value="negative">Money out</option>
          </select>
        </label>
        <label>
          Account
          <select
            aria-label="Account"
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              setMin("");
              setMax("");
            }}
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {accountLabel(a)} · {a.currency}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select
            aria-label="Category"
            disabled={transfer}
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setSubcategory("");
            }}
          >
            <option value="">Choose a category</option>
            {categories
              .filter((c) => !c.archived && !c.parentId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        {!!categories.filter((c) => c.parentId === category && !c.archived)
          .length &&
          !transfer && (
            <label>
              Subcategory
              <select
                aria-label="Rule subcategory"
                value={subcategory}
                onChange={(e) => setSubcategory(e.target.value)}
              >
                <option value="">No subcategory</option>
                {categories
                  .filter((c) => c.parentId === category && !c.archived)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
        <label>
          Priority
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          />
        </label>
        <label>
          Minimum absolute amount
          <input
            inputMode="decimal"
            value={min}
            onChange={(e) => setMin(e.target.value)}
            disabled={!account}
          />
        </label>
        <label>
          Maximum absolute amount
          <input
            inputMode="decimal"
            value={max}
            onChange={(e) => setMax(e.target.value)}
            disabled={!account}
          />
        </label>
      </div>
      <p className="muted">
        Amount ranges require an account so the currency is explicit.
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={transfer}
          onChange={(e) => setTransfer(e.target.checked)}
        />
        Mark matches as internal transfers
      </label>
      <button
        disabled={!pattern.trim() || (!transfer && !category) || busy}
        onClick={() =>
          void run(
            async () => {
              const currency = accounts.find((a) => a.id === account)?.currency;
              const minAmount =
                account && min ? parseMoney(min, currency) : undefined;
              const maxAmount =
                account && max ? parseMoney(max, currency) : undefined;
              if (
                (minAmount !== undefined && minAmount < 0) ||
                (maxAmount !== undefined && maxAmount < 0) ||
                (minAmount !== undefined &&
                  maxAmount !== undefined &&
                  minAmount > maxAmount) ||
                !Number.isSafeInteger(priority)
              )
                throw new Error(
                  "Enter a valid priority and positive amount range.",
                );
              await saveRule(
                {
                  ...rule,
                  id: rule?.id ?? id(),
                  name: `${pattern} → ${transfer ? "Transfer" : categories.find((c) => c.id === category)?.name}`,
                  match,
                  pattern: pattern.trim(),
                  direction,
                  accountId: account || undefined,
                  priority,
                  categoryId: transfer ? undefined : category,
                  subcategoryId: transfer
                    ? undefined
                    : subcategory || undefined,
                  type: transfer ? "transfer" : undefined,
                  minAmount,
                  maxAmount,
                  builtIn: false,
                },
                rule,
              );
              setPattern("");
              onClose?.();
            },
            rule
              ? "Rule updated. Changes apply to future imports."
              : "Rule created.",
          )
        }
      >
        {rule ? "Save rule" : "Create rule"}
      </button>
      {rule && (
        <button disabled={busy} onClick={onClose}>
          Cancel edit
        </button>
      )}
    </details>
  );
}
function accountLabel(account?: Account) {
  return account
    ? `${account.institution} · ${account.displayName} · ${account.maskedAccountIdentifier}`
    : "Unavailable account";
}
