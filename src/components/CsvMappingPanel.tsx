import { useState } from "react";
import type { Account, Institution } from "../domain/models";
import { id } from "../domain/normalize";
import {
  csvBalanceConvention,
  type CsvMapping,
  type CsvTable,
} from "../import/formats";

export function CsvMappingPanel({
  table,
  initial,
  initialAccountId = "",
  accounts,
  savedMappings = {},
  busy,
  onCheck,
}: {
  table: CsvTable;
  initial?: CsvMapping;
  initialAccountId?: string;
  accounts: Account[];
  savedMappings?: Record<string, CsvMapping>;
  busy: boolean;
  onCheck: (mapping: CsvMapping, account: Account) => void;
}) {
  const guessed = (pattern: RegExp) =>
    table.headers.findIndex((header) => pattern.test(header));
  const [mapping, setMapping] = useState<CsvMapping>(
    () =>
      initial ?? {
        date: Math.max(0, guessed(/date/i)),
        description: Math.max(
          0,
          guessed(/description|merchant|payee|details/i),
        ),
        amount:
          guessed(/^amount(?:\s|$)/i) >= 0
            ? guessed(/^amount(?:\s|$)/i)
            : undefined,
        debit:
          guessed(/debit|money out|paid out/i) >= 0
            ? guessed(/debit|money out|paid out/i)
            : undefined,
        credit:
          guessed(/credit|money in|paid in/i) >= 0
            ? guessed(/credit|money in|paid in/i)
            : undefined,
        balance: guessed(/balance/i) >= 0 ? guessed(/balance/i) : undefined,
        dateOrder: "day-first",
        defaultCurrency: "GBP",
        institution: "Other",
        accountType: "current",
      },
  );
  const [accountId, setAccountId] = useState(initialAccountId);
  const [name, setName] = useState("Current account");
  const [identifier, setIdentifier] = useState("");
  const [error, setError] = useState("");
  const field = (
    label: string,
    key: "date" | "description" | "amount" | "debit" | "credit" | "balance",
    required = false,
  ) => (
    <label key={key}>
      {label}
      <select
        aria-label={`CSV ${label}`}
        disabled={busy}
        value={mapping[key] ?? ""}
        onChange={(e) =>
          setMapping({
            ...mapping,
            [key]: e.target.value === "" ? undefined : Number(e.target.value),
          })
        }
      >
        {!required && <option value="">Not in this file</option>}
        {table.headers.map((header, index) => (
          <option value={index} key={index}>
            {header || `Column ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <details className="card" open>
      <summary>
        <strong>Check export columns and account</strong>
      </summary>
      <p>
        Map the columns once. Feng remembers this layout for the selected
        account.
      </p>
      <div className="form-grid">
        <label>
          Account
          <select
            aria-label="CSV Account"
            value={accountId}
            disabled={busy}
            onChange={(e) => {
              setAccountId(e.target.value);
              const account = accounts.find((a) => a.id === e.target.value);
              if (account)
                setMapping({
                  ...(JSON.stringify(savedMappings[account.id]?.headers) ===
                  JSON.stringify(table.headers)
                    ? savedMappings[account.id]
                    : mapping),
                  institution: account.institution,
                  defaultCurrency: account.currency,
                  accountType:
                    account.accountType === "credit" ||
                    account.accountType === "credit_card"
                      ? "credit"
                      : account.accountType === "savings"
                        ? "savings"
                        : "current",
                });
            }}
          >
            <option value="">New account</option>
            {accounts
              .filter((a) => a.tracking !== "manual")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.institution} · {a.displayName} ·{" "}
                  {a.maskedAccountIdentifier} · {a.currency}
                </option>
              ))}
          </select>
        </label>
        {!accountId && (
          <>
            <label>
              Bank
              <select
                aria-label="CSV Bank"
                value={mapping.institution ?? "Other"}
                disabled={busy}
                onChange={(e) =>
                  setMapping({
                    ...mapping,
                    institution: e.target.value as Institution,
                  })
                }
              >
                {["Barclays", "American Express", "Revolut", "Other"].map(
                  (bank) => (
                    <option key={bank}>{bank}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              Account name
              <input
                aria-label="CSV Account name"
                value={name}
                maxLength={100}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Last four account or card digits
              <input
                aria-label="CSV Account digits"
                inputMode="numeric"
                pattern="[0-9]{4}"
                value={identifier}
                maxLength={4}
                disabled={busy}
                onChange={(e) =>
                  setIdentifier(e.target.value.replace(/\D/g, ""))
                }
              />
            </label>
            <label>
              Account type
              <select
                aria-label="CSV Account type"
                value={mapping.accountType ?? "current"}
                disabled={busy}
                onChange={(e) =>
                  setMapping({
                    ...mapping,
                    accountType: e.target.value as CsvMapping["accountType"],
                  })
                }
              >
                <option value="current">Current account</option>
                <option value="savings">Savings</option>
                <option value="credit">Credit card</option>
              </select>
            </label>
            <label>
              Export currency
              <select
                aria-label="CSV Currency"
                value={mapping.defaultCurrency ?? "GBP"}
                disabled={busy}
                onChange={(e) =>
                  setMapping({ ...mapping, defaultCurrency: e.target.value })
                }
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
          </>
        )}
        {field("Date", "date", true)}
        {field("Description", "description", true)}
        {field("Amount", "amount")}
        {field("Money out", "debit")}
        {field("Money in", "credit")}
        {field("Balance", "balance")}
        {mapping.balance !== undefined && (
          <label>
            Balance convention
            <select
              aria-label="CSV Balance convention"
              disabled={busy}
              value={csvBalanceConvention(mapping)}
              onChange={(e) =>
                setMapping({
                  ...mapping,
                  balanceDirection: e.target
                    .value as CsvMapping["balanceDirection"],
                })
              }
            >
              <option value="financial">Cash balance</option>
              <option value="debt-positive">Card debt</option>
            </select>
          </label>
        )}
        <label>
          Date format
          <select
            aria-label="CSV Date format"
            value={mapping.dateOrder ?? "day-first"}
            onChange={(e) =>
              setMapping({
                ...mapping,
                dateOrder: e.target.value as CsvMapping["dateOrder"],
              })
            }
          >
            <option value="day-first" aria-label="Day / month / year">
              DD/MM/YYYY
            </option>
            <option value="month-first" aria-label="Month / day / year">
              MM/DD/YYYY
            </option>
          </select>
        </label>
        <label>
          Amount convention
          <select
            aria-label="CSV Amount convention"
            value={mapping.amountDirection ?? "signed"}
            onChange={(e) =>
              setMapping({
                ...mapping,
                amountDirection: e.target
                  .value as CsvMapping["amountDirection"],
              })
            }
          >
            <option value="signed">Cash flow</option>
            <option value="purchases-positive">Card spending</option>
          </select>
        </label>
      </div>
      {mapping.balance !== undefined && (
        <p className="muted">
          Balance convention:{" "}
          {csvBalanceConvention(mapping) === "debt-positive"
            ? "Positive card debt, negative credit balance."
            : "Positive money held, negative money owed."}
        </p>
      )}
      <p className="muted">
        Amount convention:{" "}
        {mapping.amountDirection === "purchases-positive"
          ? "Positive purchases, negative credits."
          : "Positive in, negative out."}
      </p>
      <p className="muted" data-source-text>
        First row: {table.rows[0]?.join(" · ")}
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        className="primary"
        disabled={busy}
        onClick={() => {
          if (!accountId && (!name.trim() || identifier.length !== 4)) {
            setError(
              "Enter an account name and its last four digits, or choose an existing account.",
            );
            return;
          }
          if (
            mapping.amount === undefined &&
            mapping.debit === undefined &&
            mapping.credit === undefined
          ) {
            setError("Select Amount, or Money out and Money in.");
            return;
          }
          setError("");
          const now = new Date().toISOString();
          const account = accounts.find((a) => a.id === accountId) ?? {
            id: id(),
            institution: mapping.institution ?? "Other",
            displayName: name.trim(),
            accountType: mapping.accountType ?? "current",
            tracking: "statement",
            currency: mapping.defaultCurrency ?? "GBP",
            maskedAccountIdentifier: `•••• ${identifier}`,
            createdAt: now,
            updatedAt: now,
          };
          onCheck({ ...mapping, headers: table.headers }, account);
        }}
      >
        Check this export
      </button>
    </details>
  );
}
