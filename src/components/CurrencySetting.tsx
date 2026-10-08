import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/database";
import { currencyPrecision } from "../domain/money";
import { Link } from "react-router-dom";

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
      <h2>Account currency</h2>
      <label htmlFor="global-currency">Show accounts in</label>
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
        Totals use only accounts in this currency. Amounts aren’t converted.
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

/** Keep the scope visible whenever the global currency hides other accounts. */
export function CurrencyViewNotice({ currency }: { currency: string }) {
  const accounts = useLiveQuery(() => db.accounts.toArray(), []);
  const hidden = (accounts ?? []).filter(
    (account) => account.currency !== currency,
  );
  if (!hidden.length) return null;
  const groups = new Map<string, number>();
  for (const account of hidden)
    groups.set(account.currency, (groups.get(account.currency) ?? 0) + 1);
  return (
    <aside className="currency-view-notice" aria-label="Account currency scope">
      <span>
        {currency} view ·{" "}
        {[...groups]
          .map(
            ([code, count]) =>
              `${count} ${code} ${count === 1 ? "account" : "accounts"} hidden`,
          )
          .join(" · ")}
      </span>
      <Link to="/settings#global-currency">Change</Link>
    </aside>
  );
}
