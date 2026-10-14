import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { db } from "../storage/database";
import { auditedMutation, undoChange } from "../storage/audit";
import { currencyPrecision } from "../domain/money";
import { downloadEcbRates, workingDayAge } from "../analytics/fx";
import { formatUkDate } from "../domain/dates";
import { localToday } from "../analytics/reminders";
import { convertMinor } from "../analytics/fx";
import { Toast } from "./Toast";
import { Sheet } from "./Sheet";
import { SwitchRow } from "./UIPrimitives";

export function useGlobalCurrency() {
  const setting = useLiveQuery(() => db.settings.get("currency"), []);
  try {
    currencyPrecision(setting?.value ?? "GBP");
    return setting?.value ?? "GBP";
  } catch {
    return "GBP";
  }
}
async function refreshRates() {
  const rates = await downloadEcbRates();
  return auditedMutation(
    "Update exchange rates",
    ["fxRates", "settings"],
    async () => {
      // A manual override remains authoritative and is not overwritten by an ECB table.
      await db.fxRates.bulkPut(rates);
      await db.settings.put({
        key: "fx:lastDownloaded",
        value: new Date().toISOString(),
      });
    },
  );
}
export function CurrencySetting() {
  const currency = useGlobalCurrency();
  const data = useLiveQuery(
    async () => ({
      accounts: await db.accounts.toArray(),
      rates: await db.fxRates.toArray(),
      enabled: (await db.settings.get("fx:download"))?.value !== "false",
    }),
    [],
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [changeId, setChangeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [manualRateOpen, setManualRateOpen] = useState(false);
  const [requestedEnabled, setRequestedEnabled] = useState<boolean>();
  useEffect(() => {
    if (data && requestedEnabled === data.enabled)
      setRequestedEnabled(undefined);
  }, [data?.enabled, requestedEnabled]);
  const [from, setFrom] = useState("EUR");
  const [to, setTo] = useState("GBP");
  const [rate, setRate] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const run = async (
    operation: () => Promise<{ changeId: string }>,
    message: string,
  ) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await operation();
      setChangeId(result.changeId);
      setNotice(message);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rates could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const currencies = [
    ...new Set([
      "GBP",
      "EUR",
      "USD",
      currency,
      ...(data?.accounts ?? []).map((a) => a.currency),
    ]),
  ];
  const last = data?.rates
    .filter((rate) => rate.date <= localToday())
    .map((r) => r.date)
    .sort()
    .at(-1);
  return (
    <section className="card" id="global-currency">
      <h2>Currency</h2>
      <label htmlFor="reporting-currency">Reporting currency</label>
      <select
        id="reporting-currency"
        value={currency}
        disabled={busy}
        onChange={(e) => {
          const nextCurrency = e.target.value;
          void run(
            () =>
              auditedMutation("Change reporting currency", ["settings"], () =>
                db.settings.put({ key: "currency", value: nextCurrency }),
              ),
            "Reporting currency saved.",
          );
        }}
      >
        {currencies.map((code) => (
          <option key={code}>{code}</option>
        ))}
      </select>
      <p className="muted">
        Totals convert all accounts. Statements and account details keep their
        original currency.
      </p>
      <SwitchRow
        label="Download daily rates (ECB)"
        checked={requestedEnabled ?? data?.enabled ?? true}
        disabled={busy}
        onChange={(enabled) => {
          setRequestedEnabled(enabled);
          void run(async () => {
            try {
              return await auditedMutation(
                enabled
                  ? "Turned on rate downloads"
                  : "Turned off rate downloads",
                ["settings"],
                () =>
                  db.settings.put({
                    key: "fx:download",
                    value: String(enabled),
                  }),
              );
            } catch (error) {
              setRequestedEnabled(undefined);
              throw error;
            }
          }, "Rate preference saved.");
        }}
      />
      <p className="muted">
        No personal data is sent.
        {last
          ? ` Cached rates: ${formatUkDate(last)}.`
          : " No rates downloaded yet."}
      </p>
      {(requestedEnabled ?? data?.enabled ?? true) && (
        <button
          disabled={busy || !navigator.onLine}
          onClick={() => void run(refreshRates, "Exchange rates updated.")}
        >
          {busy ? "Updating…" : "Update rates"}
        </button>
      )}
      <button
        onClick={() => {
          setError("");
          setManualRateOpen(true);
        }}
      >
        Enter a manual rate
      </button>
      {manualRateOpen && (
        <Sheet
          title="Enter a manual rate"
          onClose={() => setManualRateOpen(false)}
          footer={
            <>
              <button disabled={busy} onClick={() => setManualRateOpen(false)}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  const saved = await run(async () => {
                    currencyPrecision(from);
                    currencyPrecision(to);
                    if (
                      from === to ||
                      !/^\d+(?:\.\d{1,12})?$/.test(rate) ||
                      Number(rate) <= 0 ||
                      !/^\d{4}-\d{2}-\d{2}$/.test(date)
                    )
                      throw new Error(
                        "Enter two different currencies, a date and a positive rate.",
                      );
                    return auditedMutation(
                      "Save manual exchange rate",
                      ["fxRates"],
                      () =>
                        db.fxRates.put({
                          id: `manual:${date}:${from}:${to}`,
                          date,
                          base: from,
                          quote: to,
                          rate,
                          source: "manual",
                        }),
                    );
                  }, "Manual rate saved.");
                  if (saved) setManualRateOpen(false);
                }}
              >
                Save manual rate
              </button>
            </>
          }
        >
          <div className="form-grid">
            <label>
              From
              <input
                value={from}
                maxLength={3}
                onChange={(e) => setFrom(e.target.value.toUpperCase())}
              />
            </label>
            <label>
              To
              <input
                value={to}
                maxLength={3}
                onChange={(e) => setTo(e.target.value.toUpperCase())}
              />
            </label>
            <label>
              Date
              <input
                type="date"
                lang="en-GB"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              1 {from} equals
              <input
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </label>
          </div>
          {error && <p role="alert">{error}</p>}
        </Sheet>
      )}
      {error && !manualRateOpen && <p role="alert">{error}</p>}
      {notice && (
        <Toast
          id={changeId}
          message={notice}
          undo={
            changeId
              ? async () => {
                  await undoChange(changeId);
                  setChangeId("");
                  setNotice("");
                }
              : undefined
          }
        />
      )}
    </section>
  );
}
/** Only downloads the fixed public ECB table. Import never sends financial data. */
export function CurrencyViewNotice({
  currency,
  allowAutomaticDownload = true,
}: {
  currency: string;
  allowAutomaticDownload?: boolean;
}) {
  const data = useLiveQuery(
    async () => ({
      accounts: await db.accounts.toArray(),
      rates: await db.fxRates.toArray(),
      settings: await db.settings.toArray(),
    }),
    [],
  );
  const running = useRef(false);
  const [failed, setFailed] = useState(false);
  const foreign = (data?.accounts ?? []).filter((a) => a.currency !== currency);
  const last = data?.rates
    .filter((rate) => rate.date <= localToday())
    .map((r) => r.date)
    .sort()
    .at(-1);
  const enabled = !data?.settings.some(
    (s) => s.key === "fx:download" && s.value === "false",
  );
  const today = localToday();
  useEffect(() => {
    if (
      !data ||
      !allowAutomaticDownload ||
      !foreign.length ||
      !enabled ||
      !navigator.onLine ||
      running.current
    )
      return;
    const downloaded = data.settings
      .find((s) => s.key === "fx:lastDownloaded")
      ?.value.slice(0, 10);
    if (downloaded === today) return;
    running.current = true;
    void refreshRates().catch(() => setFailed(true));
  }, [!!data, foreign.length, enabled, today, allowAutomaticDownload]);
  if (!foreign.length) return null;
  const stale = last && workingDayAge(last, today) > 3;
  const missing = foreign.some(
    (account) =>
      !convertMinor(1, account.currency, currency, today, data?.rates ?? []),
  );
  if (!stale && !missing && !failed) return null;
  return (
    <Link
      className="header-status"
      to="/settings?section=currency#global-currency"
      aria-label="Exchange rates needed. Open currency settings."
      title="Exchange rates are needed. Enter manual rates in Settings."
    >
      ≈<span className="sr-only">Rates needed</span>
    </Link>
  );
}
