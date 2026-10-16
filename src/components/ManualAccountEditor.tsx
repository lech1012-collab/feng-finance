import { UKDateInput } from "./UKDateInput";
import { Sheet, SheetFooter } from "./Sheet";
import { ChevronRight } from "lucide-react";
import { Toast } from "./Toast";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Account } from "../domain/models";
import { db } from "../storage/database";
import { saveManualAccount, deleteManualAccount } from "../storage/planning-v2";
import { undoChange } from "../storage/audit";
import {
  latestValuation,
  liabilityTypes,
  manualAccountTypes,
  valuationStale,
  estimateMortgage,
} from "../analytics/net-worth";
import { decimalMoney, money, parseMoney } from "../domain/money";
import { formatUkDate } from "../domain/dates";
import { localToday } from "../analytics/reminders";
import "./planning-v2.css";

const labels: Record<string, string> = {
  property: "Property",
  vehicle: "Vehicle",
  pension: "Pension",
  investment: "Investment",
  mortgage: "Mortgage",
  loan: "Loan",
  other_asset: "Other asset",
  other_liability: "Other liability",
};
export function ManualAccountEditor({ currency }: { currency: string }) {
  const data = useLiveQuery(async () => {
    const accounts = (await db.accounts.toArray()).filter(
      (a) =>
        a.tracking === "manual" &&
        (manualAccountTypes as readonly Account["accountType"][]).includes(
          a.accountType,
        ),
    );
    return {
      accounts,
      valuations: await db.valuations.toArray(),
    };
  }, []);
  const [editing, setEditing] = useState(false),
    [id, setId] = useState<string | undefined>(),
    [name, setName] = useState("");
  const [type, setType] = useState<Account["accountType"]>("property"),
    [accountCurrency, setCurrency] = useState(currency),
    [date, setDate] = useState(localToday()),
    [value, setValue] = useState(""),
    [note, setNote] = useState(""),
    [include, setInclude] = useState(true),
    [apr, setApr] = useState(""),
    [minimum, setMinimum] = useState("");
  const [term, setTerm] = useState("300"),
    [elapsed, setElapsed] = useState("0"),
    [estimate, setEstimate] = useState(false);
  const [reminderDays, setReminderDays] = useState("180");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [change, setChange] = useState(""),
    [message, setMessage] = useState("");
  const edit = (account?: Account) => {
    const valuation =
      account &&
      data &&
      latestValuation(account, data.valuations, localToday());
    setId(account?.id);
    setName(account?.displayName ?? "");
    setType(account?.accountType ?? "property");
    setReminderDays(
      String(
        account?.valuationReminderDays ??
          (account?.accountType === "property" || !account ? 180 : 90),
      ),
    );
    setCurrency(account?.currency ?? currency);
    setDate(localToday());
    setValue(
      valuation
        ? decimalMoney(Math.abs(valuation.valueMinor), account!.currency)
        : "",
    );
    setNote("");
    setInclude(account?.includeInNetWorth !== false);
    setApr(account?.apr === undefined ? "" : String(account.apr));
    setMinimum(
      account?.minPaymentMinor === undefined
        ? ""
        : decimalMoney(account.minPaymentMinor, account.currency),
    );
    setEstimate(false);
    setError("");
    setEditing(true);
  };
  return (
    <section className="card manual-account-editor">
      <div className="section-heading">
        <h2>Assets and liabilities</h2>
        <button onClick={() => edit()}>Add account</button>
      </div>
      <p className="muted">
        Dated values contribute to net worth. They do not change cash flow.
      </p>
      {!data ? (
        <p role="status">Loading valuations…</p>
      ) : (
        <div className="planning-v2-list">
          {data.accounts.map((a) => {
            const v = latestValuation(a, data.valuations, localToday());
            return (
              <button
                className="planning-v2-object"
                key={a.id}
                onClick={() => edit(a)}
              >
                <span>
                  <strong>{a.displayName}</strong>
                  <small>
                    {v ? (
                      <>
                        {v.note?.startsWith("Estimated")
                          ? "Estimated"
                          : "Manual"}{" "}
                        · as of{" "}
                        <time className="date-value" dateTime={v.date}>
                          {formatUkDate(v.date)}
                        </time>
                      </>
                    ) : (
                      "No value entered"
                    )}
                    {v && valuationStale(a, v.date, localToday())
                      ? " · Update due"
                      : ""}
                    {a.includeInNetWorth === false
                      ? " · Excluded from net worth"
                      : ""}
                  </small>
                </span>
                <strong className="manual-account-value">
                  <span className="amount">
                    {v
                      ? money(
                          liabilityTypes.has(a.accountType)
                            ? -Math.abs(v.valueMinor)
                            : v.valueMinor,
                          a.currency,
                        )
                      : "Not entered"}
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </strong>
              </button>
            );
          })}
        </div>
      )}
      {editing && (
        <Sheet
          title={id ? "Update valuation" : "Add asset or liability"}
          onClose={() => {
            if (!busy) setEditing(false);
          }}
        >
          <form
            id="manual-account-form"
            className="planning-v2-form"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              void (async () => {
                try {
                  let amount = parseMoney(value, accountCurrency),
                    valuationNote = note;
                  if (estimate) {
                    const result = estimateMortgage(
                      amount,
                      Number(apr),
                      Number(term),
                      Number(elapsed),
                    );
                    amount = result.valueMinor;
                    valuationNote = `Estimated monthly amortisation · ${Number(elapsed)} payment${Number(elapsed) === 1 ? "" : "s"} · ${money(result.paymentMinor, accountCurrency)} per month${note ? ` · ${note}` : ""}`;
                  }
                  const result = await saveManualAccount({
                    id,
                    name,
                    type,
                    currency: accountCurrency,
                    date,
                    valueMinor: amount,
                    note: valuationNote,
                    includeInNetWorth: include,
                    apr: apr ? Number(apr) : undefined,
                    minPaymentMinor: minimum
                      ? parseMoney(minimum, accountCurrency)
                      : undefined,
                    valuationReminderDays: Number(reminderDays),
                  });
                  setChange(result.changeId);
                  setMessage("Account valuation saved.");
                  setEditing(false);
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Could not save this account.",
                  );
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <label>
              Name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Type
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value as Account["accountType"]);
                  setReminderDays(e.target.value === "property" ? "180" : "90");
                  setEstimate(false);
                }}
              >
                {manualAccountTypes.map((t) => (
                  <option key={t} value={t}>
                    {labels[t]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Currency
              <select
                disabled={!!id}
                value={accountCurrency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {[
                  ...new Set([
                    currency,
                    accountCurrency,
                    "GBP",
                    "EUR",
                    "USD",
                    "CHF",
                  ]),
                ].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              {id && (
                <small>
                  Valuation history keeps its original currency. Add another
                  account for a different currency.
                </small>
              )}
            </label>
            <label>
              Value as of
              <UKDateInput
                required
                value={date}
                max={localToday()}
                onChange={(e) => setDate(e)}
              />
            </label>
            <label>
              {estimate
                ? "Original principal"
                : liabilityTypes.has(type)
                  ? "Amount owed"
                  : "Account value"}
              <input
                required
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            {liabilityTypes.has(type) && (
              <>
                <label>
                  APR %
                  <input
                    inputMode="decimal"
                    value={apr}
                    onChange={(e) => setApr(e.target.value)}
                    placeholder="Optional"
                  />
                </label>
                <label>
                  Minimum monthly payment
                  <input
                    inputMode="decimal"
                    value={minimum}
                    onChange={(e) => setMinimum(e.target.value)}
                    placeholder={
                      type === "mortgage" || type === "loan"
                        ? "Enter the actual monthly payment"
                        : "Optional card estimate"
                    }
                  />
                </label>
              </>
            )}
            {type === "mortgage" && (
              <>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={estimate}
                    onChange={(e) => setEstimate(e.target.checked)}
                  />
                  Estimate from original principal
                </label>
                {estimate && (
                  <>
                    <label>
                      Original term in months
                      <input
                        type="number"
                        min={1}
                        max={600}
                        required
                        value={term}
                        onChange={(e) => setTerm(e.target.value)}
                      />
                    </label>
                    <label>
                      Payments already made
                      <input
                        type="number"
                        min={0}
                        required
                        value={elapsed}
                        onChange={(e) => setElapsed(e.target.value)}
                      />
                    </label>
                    <p className="muted">
                      Monthly interest with penny rounding. Marked Estimated
                      until you enter a statement value.
                    </p>
                  </>
                )}
              </>
            )}
            <label>
              Remind me to update after (days)
              <input
                type="number"
                required
                min={1}
                max={3650}
                value={reminderDays}
                onChange={(e) => setReminderDays(e.target.value)}
              />
            </label>
            <label>
              Note
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <label className="switch-row">
              <input
                role="switch"
                type="checkbox"
                checked={include}
                onChange={(e) => setInclude(e.target.checked)}
              />
              Include in net worth
            </label>
            <SheetFooter>
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy}
                  form="manual-account-form"
                  type="submit"
                >
                  Save valuation
                </button>
                <button
                  disabled={busy}
                  type="button"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
                {id && (
                  <button
                    disabled={busy}
                    type="button"
                    onClick={() => {
                      if (
                        !window.confirm(
                          "Delete this manual account and its valuation history? You can undo this change.",
                        )
                      )
                        return;
                      setBusy(true);
                      void deleteManualAccount(id)
                        .then((r) => {
                          setChange(r.changeId);
                          setMessage("Manual account deleted.");
                          setEditing(false);
                        })
                        .catch((e) =>
                          setError(
                            e instanceof Error
                              ? e.message
                              : "Could not delete this account.",
                          ),
                        )
                        .finally(() => setBusy(false));
                    }}
                  >
                    Delete account
                  </button>
                )}
              </div>
            </SheetFooter>
            {error && <p role="alert">{error}</p>}
          </form>
        </Sheet>
      )}
      {error && <p role="alert">{error}</p>}
      {message && (
        <Toast
          id={change || message}
          message={message}
          undo={
            change
              ? async () => {
                  await undoChange(change);
                  setChange("");
                  setMessage("");
                }
              : undefined
          }
        />
      )}
    </section>
  );
}
