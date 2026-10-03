import { ThemeSetting } from "../components/Theme";
import { PersonalRules } from "../components/PersonalRules";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Download,
  ShieldCheck,
  Database,
  Plus,
  Upload,
  Trash2,
} from "lucide-react";
import { db } from "../storage/database";
import {
  createBackup,
  restoreBackup,
  validateBackup,
  download,
  exportCsv,
  clearLocalData,
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
} from "../domain/models";
import { parseMoney } from "../domain/money";
export default function Settings() {
  const data = useLiveQuery(
    async () => ({
      accounts: await db.accounts.toArray(),
      categories: await db.categories.toArray(),
      rules: await db.rules.orderBy("priority").reverse().toArray(),
      count: await db.transactions.count(),
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
  const [clearConfirmed, setClearConfirmed] = useState(false);
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
    const b = await createBackup();
    download(
      JSON.stringify(b, null, 2),
      "application/json",
      `feng-finance-backup-${new Date().toISOString().slice(0, 10)}.json`,
    );
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR DATA, YOUR DEVICE</p>
          <h1>Settings</h1>
        </div>
        <span className="small-chip">v{APP_VERSION}</span>
      </div>
      <ThemeSetting />
      <PersonalRules />
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
      <section className="card">
        <h2>
          <Database size={19} />
          Backup & portability
        </h2>
        <p>
          {data?.count ?? 0} transactions stored on this device. Browser data
          can be removed by the operating system or when you clear site data.
          Save a backup regularly.
        </p>
        <div className="actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void run(
                backup,
                "Backup downloaded. Save it in Files or iCloud Drive.",
              )
            }
          >
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
              await run(async () => {
                if (file.size > 50 * 1024 * 1024)
                  throw new Error("Backup exceeds the 50 MB limit.");
                setPending(validateBackup(JSON.parse(await file.text())));
                setReplaceConfirmed(false);
              }, "Backup validated. Review the replacement warning below.");
              e.target.value = "";
            }}
          />
        </label>
        {pending && (
          <div className="restore-warning">
            <h3>Replace all local financial data?</h3>
            <p>
              This backup contains {pending.accounts.length} accounts,{" "}
              {pending.statements.length} statements and{" "}
              {pending.transactions.length} transactions. Export your current
              backup first. Replacing is atomic and cannot be undone without
              another backup.
            </p>
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
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (!navigator.storage?.persist)
                throw new Error(
                  "Persistent storage requests are not supported by this browser. Keep backups in Files.",
                );
              const granted = await navigator.storage.persist();
              if (!granted)
                throw new Error(
                  "The browser did not grant persistent storage. Keep backups in Files.",
                );
            }, "Persistent storage is enabled on this browser.")
          }
        >
          Request persistent storage
        </button>
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
      <details className="card settings-disclosure">
        <summary>Categorization & transfer rules</summary>
        <p className="muted">
          User exact rules run first, then user text rules, then built-in
          mappings. Changes apply to future imports.
        </p>
        {data?.rules
          .filter((r) => !r.builtIn)
          .map((r) => (
            <div className="settings-row" key={r.id}>
              <div>
                <strong>{r.name}</strong>
                <p>
                  {r.match} · {r.direction} · priority {r.priority}
                </p>
              </div>
              <button
                disabled={busy}
                aria-label={`Delete rule ${r.name}`}
                onClick={() =>
                  void run(() => db.rules.delete(r.id), "Rule deleted.")
                }
              >
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          ))}
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
      </details>
      <details className="card settings-disclosure">
        <summary>Statement history</summary>
        <p className="muted">
          Source PDFs are not stored. Filenames, parser version, review warnings
          and balance differences remain available for traceability.
        </p>
        <div className="statement-history">
          {data?.statements.slice(0, 50).map((s) => (
            <details key={s.id}>
              <summary>
                {s.institution} · {s.statementPeriodEnd} · {s.transactionCount}{" "}
                new transactions · {s.validationStatus}
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
        <p>
          Fictitious transactions help you explore the dashboard. Your imported
          data is preserved when demo data is deleted.
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
        <p>
          Statements are parsed in your browser with PDF.js and local OCR.
          Transactions, descriptions, accounts and categories stay in IndexedDB
          on this device. There are no analytics, external AI calls, API keys or
          cloud sync.
        </p>
        <p>
          The host serves only static app assets. On first installation it also
          downloads the PDF worker and OCR language files. After the offline
          cache is ready, imports require no network access.
        </p>
        <p>
          On iPhone: open the HTTPS address in Safari, tap Share, then Add to
          Home Screen, enable Open as Web App and tap Add.
        </p>
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
        <h2>Clear local data</h2>
        <p>
          This removes every account, statement, transaction, custom category
          and rule from this browser. Download a backup first.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={clearConfirmed}
            onChange={(e) => setClearConfirmed(e.target.checked)}
          />
          I understand this permanently deletes my local financial data.
        </label>
        <button
          className="danger"
          disabled={!clearConfirmed || busy}
          onClick={() =>
            void run(async () => {
              await clearLocalData();
              setClearConfirmed(false);
            }, "All local financial data was cleared.")
          }
        >
          Clear all local data
        </button>
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
function RuleForm({
  categories,
  accounts,
  run,
  busy,
}: {
  categories: Category[];
  accounts: { id: string; displayName: string; currency: string }[];
  run: (fn: () => Promise<unknown>, message: string) => Promise<void>;
  busy: boolean;
}) {
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState("");
  const [match, setMatch] = useState<Rule["match"]>("contains");
  const [direction, setDirection] = useState<Rule["direction"]>("any");
  const [transfer, setTransfer] = useState(false);
  const [account, setAccount] = useState("");
  const [priority, setPriority] = useState(100);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  return (
    <details>
      <summary>Create a categorization or transfer rule</summary>
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
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName} · {a.currency}
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
            onChange={(e) => setCategory(e.target.value)}
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
          void run(async () => {
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
            await db.rules.add({
              id: id(),
              name: `${pattern} → ${transfer ? "Transfer" : categories.find((c) => c.id === category)?.name}`,
              match,
              pattern: pattern.trim(),
              direction,
              accountId: account || undefined,
              priority,
              categoryId: transfer ? undefined : category,
              type: transfer ? "transfer" : undefined,
              minAmount,
              maxAmount,
              builtIn: false,
            });
            setPattern("");
          }, "Rule created.")
        }
      >
        Create rule
      </button>
    </details>
  );
}
