import { displayAccountName, displayAccountType } from "../domain/presentation";
import { ChevronRight } from "lucide-react";
import { manualCashBalance } from "../analytics/manual-cash";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import type { Account, Institution } from "../domain/models";
import { db } from "../storage/database";
import { auditedMutation, undoChange } from "../storage/audit";
import { id } from "../domain/normalize";
import { decimalMoney, money, parseMoney } from "../domain/money";
import { formatUkDate } from "../domain/dates";
import { localToday } from "../analytics/reminders";
import { accountSnapshot } from "../analytics/balances";
import { statementBalanceEvidence } from "../analytics/statement-balances";
import { useGlobalCurrency } from "../components/CurrencySetting";
import { ManualAccountEditor } from "../components/ManualAccountEditor";
import { Sheet, SheetFooter } from "../components/Sheet";
import { Toast } from "../components/Toast";
import { ContextHelp } from "../components/ContextHelp";

export default function Accounts() {
  return (
    <>
      <Link className="back-link" to="/">
        ‹ Home
      </Link>
      <h1>Accounts</h1>
      <AccountsContent />
    </>
  );
}

export function AccountsContent() {
  const currency = useGlobalCurrency();
  const today = localToday();
  const data = useLiveQuery(async () => ({
    accounts: (await db.accounts.toArray()).filter(
      (a) =>
        a.tracking !== "manual" ||
        ["current", "savings"].includes(a.accountType),
    ),
    statements: await db.statements.toArray(),
    rows: await db.transactions.toArray(),
    valuations: await db.valuations.toArray(),
  }));
  const [editing, setEditing] = useState<Account | "new">();
  const [name, setName] = useState("");
  const [bank, setBank] = useState<Institution>("Other");
  const [mask, setMask] = useState("");
  const [nativeCurrency, setNativeCurrency] = useState(currency);
  const [type, setType] = useState<Account["accountType"]>("current");
  const [include, setInclude] = useState(true);
  const [apr, setApr] = useState("");
  const [minimum, setMinimum] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{
    changeId: string;
    message: string;
  }>();
  const editingSnapshot =
    editing && editing !== "new" && editing.tracking !== "manual" && data
      ? accountSnapshot(editing, data.statements, today.slice(0, 7), today)
      : undefined;
  const editingEvidence =
    editingSnapshot?.statement && data
      ? statementBalanceEvidence(editingSnapshot.statement, data.rows, today)
      : undefined;
  const open = (account?: Account) => {
    setEditing(account ?? "new");
    setName(account?.displayName ?? "");
    setBank(account?.institution ?? "Other");
    setMask(
      account?.maskedAccountIdentifier.replace(/[^a-z\d]/gi, "").slice(-4) ??
        "",
    );
    setNativeCurrency(account?.currency ?? currency);
    setType(account?.accountType ?? "current");
    setInclude(account?.includeInNetWorth !== false);
    setApr(account?.apr?.toString() ?? "");
    setMinimum(
      account?.minPaymentMinor === undefined
        ? ""
        : decimalMoney(account.minPaymentMinor, account.currency),
    );
    setError("");
  };
  const save = async () => {
    if (!editing || busy) return;
    setBusy(true);
    setError("");
    try {
      if (!name.trim()) throw new Error("Enter an account nickname.");
      if (editing === "new" && mask.length !== 4)
        throw new Error("Enter the last four account characters.");
      const aprValue = apr.trim() ? Number(apr) : undefined;
      if (
        aprValue !== undefined &&
        (!Number.isFinite(aprValue) || aprValue < 0 || aprValue > 100)
      )
        throw new Error("APR must be between 0% and 100%.");
      const minimumValue = minimum.trim()
        ? parseMoney(minimum, nativeCurrency)
        : undefined;
      if (minimumValue !== undefined && minimumValue < 0)
        throw new Error("Minimum payment cannot be negative.");
      const now = new Date().toISOString();
      const result = await auditedMutation(
        "Save account",
        ["accounts"],
        async () => {
          if (editing === "new")
            await db.accounts.add({
              id: id(),
              institution: bank,
              displayName: name.trim(),
              maskedAccountIdentifier: `•••• ${mask}`,
              currency: nativeCurrency,
              accountType: type,
              includeInNetWorth: include,
              apr: aprValue,
              minPaymentMinor: minimumValue,
              createdAt: now,
              updatedAt: now,
            });
          else {
            if (!(await db.accounts.get(editing.id)))
              throw new Error("Account no longer exists.");
            await db.accounts.update(editing.id, {
              displayName: name.trim(),
              includeInNetWorth: include,
              apr: aprValue,
              minPaymentMinor: minimumValue,
              updatedAt: now,
            });
          }
        },
      );
      setReceipt({ changeId: result.changeId, message: "Account saved." });
      setEditing(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Account could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section className="card">
        <div className="section-heading">
          <div className="context-help-heading">
            <h2>Bank and card accounts</h2>
            <ContextHelp title="Bank and card accounts">
              <p>Import a statement to create its account automatically.</p>
            </ContextHelp>
          </div>
          <button onClick={() => open()}>Add bank account</button>
        </div>
        {!data ? (
          <p role="status">Loading accounts…</p>
        ) : data.accounts.length === 0 ? (
          <p className="muted">
            Import a statement to create its account automatically.
          </p>
        ) : (
          <div className="account-overview-list">
            {data.accounts.map((account) => {
              const snapshot = accountSnapshot(
                account,
                data.statements,
                today.slice(0, 7),
                today,
              );
              const wallet =
                account.tracking === "manual" &&
                ["current", "savings"].includes(account.accountType)
                  ? manualCashBalance(
                      account,
                      data.valuations,
                      data.rows,
                      today,
                    )
                  : undefined;
              const displayedBalance = wallet
                ? wallet.valueMinor
                : snapshot.balance;
              const displayedDate = wallet ? wallet.date : snapshot.asOfDate;
              const evidence =
                snapshot.statement &&
                statementBalanceEvidence(snapshot.statement, data.rows, today);
              const card = ["credit", "credit_card"].includes(
                account.accountType,
              );
              return (
                <button
                  className="account-overview-row"
                  key={account.id}
                  onClick={() => open(account)}
                >
                  <span>
                    <strong>{displayAccountName(account)}</strong>
                    <small>
                      {account.tracking === "manual"
                        ? "Manual"
                        : account.institution}{" "}
                      · {account.maskedAccountIdentifier}
                    </small>
                    <small>
                      {displayAccountType(account.accountType)} ·{" "}
                      {account.currency}
                    </small>
                    <small>
                      {displayedDate ? (
                        <>
                          As of{" "}
                          <time className="date-value" dateTime={displayedDate}>
                            {formatUkDate(displayedDate)}
                          </time>{" "}
                          ·{" "}
                          {wallet
                            ? "Manual cash balance"
                            : evidence?.status === "reconciled"
                              ? "Verified"
                              : "Unverified"}
                        </>
                      ) : (
                        "No statement balance"
                      )}
                    </small>
                  </span>
                  <span className="account-balance">
                    <strong>
                      {displayedBalance === undefined
                        ? "Unavailable"
                        : money(
                            card
                              ? Math.abs(displayedBalance)
                              : displayedBalance,
                            account.currency,
                          )}
                    </strong>
                    {card && snapshot.balance !== undefined && (
                      <small>
                        {snapshot.balance < 0
                          ? "Debt owed"
                          : snapshot.balance > 0
                            ? "Card credit"
                            : "No debt"}
                      </small>
                    )}
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        )}
      </section>
      <ManualAccountEditor currency={currency} />
      {editing && (
        <Sheet
          title={editing === "new" ? "Add bank account" : "Edit account"}
          onClose={() => {
            if (!busy) setEditing(undefined);
          }}
        >
          {editingEvidence?.reason && (
            <section>
              <div className="context-help-heading">
                <h3>
                  {editingEvidence.status === "unavailable"
                    ? "Statement balance unavailable"
                    : "Unverified statement balance"}
                </h3>
                <ContextHelp
                  title="Statement balance evidence"
                  label={`Why this account balance is ${editingEvidence.status}`}
                  tone="warning"
                >
                  <p>{editingEvidence.reason}</p>
                </ContextHelp>
              </div>
            </section>
          )}
          <form
            id="account-form"
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label>
              Nickname
              <input
                autoFocus
                required
                value={name}
                maxLength={100}
                placeholder="e.g. Everyday account"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {editing === "new" ? (
              <>
                <label>
                  Institution
                  <select
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
                  Account type
                  <select
                    value={type}
                    onChange={(e) =>
                      setType(e.target.value as Account["accountType"])
                    }
                  >
                    <option value="current">Current account</option>
                    <option value="savings">Savings</option>
                    <option value="credit">Credit card</option>
                  </select>
                </label>
                <label>
                  Last four characters
                  <input
                    required
                    value={mask}
                    maxLength={4}
                    onChange={(e) =>
                      setMask(
                        e.target.value.replace(/[^a-z\d]/gi, "").slice(0, 4),
                      )
                    }
                  />
                </label>
                <label>
                  Currency
                  <select
                    value={nativeCurrency}
                    onChange={(e) => setNativeCurrency(e.target.value)}
                  >
                    {[
                      ...new Set([
                        currency,
                        "GBP",
                        "EUR",
                        "USD",
                        "CHF",
                        "AUD",
                        "CAD",
                        "JPY",
                        "KWD",
                      ]),
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <p className="muted">
                {editing.institution} · {editing.maskedAccountIdentifier} ·{" "}
                {editing.currency}
              </p>
            )}
            {["credit", "credit_card", "loan", "mortgage"].includes(type) && (
              <>
                <label>
                  APR (%)
                  <input
                    inputMode="decimal"
                    value={apr}
                    onChange={(e) => setApr(e.target.value)}
                  />
                </label>
                <label>
                  Actual minimum monthly payment
                  <input
                    inputMode="decimal"
                    value={minimum}
                    onChange={(e) => setMinimum(e.target.value)}
                    placeholder={
                      type === "credit" || type === "credit_card"
                        ? "Optional card estimate"
                        : "Required for a debt plan"
                    }
                  />
                </label>
              </>
            )}
            <label className="switch-row">
              <span>Include in net worth</span>
              <input
                role="switch"
                type="checkbox"
                checked={include}
                onChange={(e) => setInclude(e.target.checked)}
              />
            </label>
            {error && (
              <p role="alert" className="notice warning">
                {error}
              </p>
            )}
            <SheetFooter>
              <button
                className="primary"
                form="account-form"
                type="submit"
                disabled={
                  busy ||
                  !name.trim() ||
                  (editing === "new" && mask.length !== 4)
                }
              >
                {busy ? "Saving…" : "Save account"}
              </button>
            </SheetFooter>
          </form>
        </Sheet>
      )}
      {receipt && (
        <Toast
          id={receipt.changeId}
          message={receipt.message}
          undo={async () => {
            await undoChange(receipt.changeId);
            setReceipt(undefined);
          }}
        />
      )}
    </>
  );
}
