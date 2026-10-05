import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/database";
import { currencyPrecision } from "../domain/money";

export function useGlobalCurrency() {
  const setting = useLiveQuery(() => db.settings.get("currency"), []);
  try {
    currencyPrecision(setting?.value ?? "GBP");
    return setting?.value ?? "GBP";
  } catch {
    return "GBP";
  }
}

export function CurrencySetting() {
  const currency = useGlobalCurrency();
  const accounts = useLiveQuery(() => db.accounts.toArray(), []);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const currencies = [
    ...new Set([
      "GBP",
      "EUR",
      currency,
      ...(accounts ?? []).map((a) => a.currency),
    ]),
  ];
  return (
    <section className="card">
      <h2>Currency</h2>
      <label htmlFor="global-currency">Global currency</label>
      <select
        id="global-currency"
        aria-describedby="currency-help"
        value={currency}
        disabled={saving}
        onChange={async (e) => {
          const value = e.target.value;
          setSaving(true);
          setError("");
          try {
            await db.settings.put({ key: "currency", value });
          } catch {
            setError("Currency could not be saved. Please try again.");
          } finally {
            setSaving(false);
          }
        }}
      >
        {currencies.map((value) => (
          <option key={value} value={value}>
            {value === "GBP"
              ? "GBP — British pound"
              : value === "EUR"
                ? "EUR — Euro"
                : value}
          </option>
        ))}
      </select>
      <p className="muted" id="currency-help">
        Applies across Home, Transactions and Analyse. Shows transactions in the
        selected currency; amounts are not converted. Saved on this device and
        included in backups.
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
