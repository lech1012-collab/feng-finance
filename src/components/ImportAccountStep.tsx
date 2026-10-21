import { useId, useState } from "react";
import type { Account, Institution } from "../domain/models";
import type { FileReview } from "../import/review-model";
import { sourceReview } from "../import/review-model";
import { currencyPrecision } from "../domain/money";
import { id } from "../domain/normalize";
import { validatePeriod } from "../parsers/period";
import { UKDateInput } from "./UKDateInput";
import { ImportReviewSheet } from "./ImportReviewSheet";

export function ImportAccountStep({
  entry,
  accounts,
  busy,
  onAccount,
  onOptions,
  onClose,
  mode,
}: {
  entry: FileReview;
  accounts: Account[];
  busy: boolean;
  onAccount: (account: Account) => void;
  onOptions: (options: Partial<FileReview>) => void;
  onClose: () => void;
  mode?: "account" | "period";
}) {
  const result = sourceReview(entry);
  const parsed = result?.parsed;
  const hint =
    entry.extracted?.accountSelection ?? parsed ?? entry.draft?.account;
  const periodOnly =
    mode === "period" || (!mode && result?.errorCode === "missing-period");
  const formId = useId();
  const [selected, setSelected] = useState(entry.accountId);
  const [creating, setCreating] = useState(!accounts.length);
  const [bank, setBank] = useState<Institution>(
    entry.bank || hint?.institution || "Other",
  );
  const [type, setType] = useState<Account["accountType"]>(
    (hint?.accountType === "credit_card" ? "credit" : hint?.accountType) ??
      (result?.profileId === "barclaycard" || result?.profileId === "amex"
        ? "credit"
        : "current"),
  );
  const [currency, setCurrency] = useState(hint?.currency ?? "GBP");
  const [suffix, setSuffix] = useState("");
  const [start, setStart] = useState(entry.periodStart);
  const [end, setEnd] = useState(entry.periodEnd);
  const [dateOrder, setDateOrder] = useState<"day-first" | "month-first" | "">(
    entry.csvMapping?.dateOrder ?? "",
  );
  const [error, setError] = useState("");
  return (
    <ImportReviewSheet
      title={
        periodOnly
          ? "Confirm statement dates"
          : mode === "account"
            ? "Statement account"
            : "Identify account"
      }
      onClose={onClose}
      closeLabel="Pause statement review"
      footer={
        <button type="submit" form={formId} className="primary" disabled={busy}>
          Continue
        </button>
      }
    >
      <div className="import-guided-content">
        <p className="import-guided-filename">{entry.file.name}</p>
        <p>
          {periodOnly
            ? "Copy the dates printed on this statement."
            : mode === "account"
              ? "Choose the account this statement belongs to. The source figures will be checked again."
              : "We couldn't read the account identifier. Choose your account or enter its last four digits. Transactions are checked after this step."}
        </p>
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            setError("");
            try {
              if (periodOnly) {
                validatePeriod({ start, end });
                onOptions({
                  manualPeriod: true,
                  periodStart: start,
                  periodEnd: end,
                });
                return;
              }
              if (entry.extracted?.format === "qif" && !dateOrder)
                throw new Error(
                  "Choose the date format printed in this export.",
                );
              if (!creating) {
                const account = accounts.find((a) => a.id === selected);
                if (!account)
                  throw new Error(
                    "Choose the account this statement belongs to.",
                  );
                if (entry.extracted?.format === "qif")
                  onOptions({
                    accountOverride: account,
                    accountId: account.id,
                    bank: account.institution,
                    csvMapping: {
                      date: 0,
                      description: 0,
                      ...entry.csvMapping,
                      dateOrder: dateOrder as "day-first" | "month-first",
                    },
                  });
                else onAccount(account);
              } else {
                if (!/^\d{4}$/.test(suffix))
                  throw new Error(
                    "Enter the last four digits printed on the statement.",
                  );
                const code = currency.trim().toUpperCase();
                currencyPrecision(code);
                const now = new Date().toISOString();
                const account: Account = {
                  id: id(),
                  institution: bank,
                  accountType: type,
                  currency: code,
                  displayName:
                    type === "credit"
                      ? "Credit card"
                      : type === "savings"
                        ? "Savings account"
                        : "Current account",
                  maskedAccountIdentifier: `•••• ${suffix}`,
                  tracking: "statement",
                  createdAt: now,
                  updatedAt: now,
                };
                if (entry.extracted?.format === "qif")
                  onOptions({
                    accountOverride: account,
                    accountId: account.id,
                    bank: account.institution,
                    csvMapping: {
                      date: 0,
                      description: 0,
                      ...entry.csvMapping,
                      dateOrder: dateOrder as "day-first" | "month-first",
                    },
                  });
                else onAccount(account);
              }
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Check these account details.",
              );
            }
          }}
        >
          {periodOnly ? (
            <>
              <label>
                Statement start date
                <UKDateInput
                  required
                  value={start}
                  disabled={busy}
                  onChange={setStart}
                />
              </label>
              <label>
                Statement end date
                <UKDateInput
                  required
                  value={end}
                  disabled={busy}
                  onChange={setEnd}
                />
              </label>
            </>
          ) : (
            <>
              {!creating ? (
                <>
                  <label>
                    Account
                    <select
                      autoFocus
                      value={selected}
                      disabled={busy}
                      onChange={(e) => setSelected(e.target.value)}
                    >
                      <option value="">Choose your account</option>
                      {accounts.map((account) => (
                        <option value={account.id} key={account.id}>
                          {account.institution} · {account.displayName} ·{" "}
                          {account.maskedAccountIdentifier} · {account.currency}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setCreating(true)}
                  >
                    Use a different account
                  </button>
                </>
              ) : (
                <>
                  <label>
                    Last four account or card digits
                    <input
                      autoFocus
                      value={suffix}
                      disabled={busy}
                      onChange={(e) =>
                        setSuffix(e.target.value.replace(/\D/g, ""))
                      }
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={4}
                      required
                    />
                  </label>
                  <label>
                    Bank
                    <select
                      value={bank}
                      disabled={busy}
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
                      disabled={busy}
                      onChange={(e) =>
                        setType(e.target.value as Account["accountType"])
                      }
                    >
                      <option value="current">Current account</option>
                      <option value="credit">Credit card</option>
                      <option value="savings">Savings account</option>
                    </select>
                  </label>
                  <label>
                    Statement currency
                    <input
                      value={currency}
                      disabled={busy}
                      onChange={(e) =>
                        setCurrency(e.target.value.toUpperCase())
                      }
                      minLength={3}
                      maxLength={3}
                      required
                    />
                  </label>
                  {!!accounts.length && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setCreating(false)}
                    >
                      Choose an existing account
                    </button>
                  )}
                  <p className="muted">
                    Account details stay on this device and are saved only when
                    you confirm the import.
                  </p>
                </>
              )}
              {entry.extracted?.format === "qif" && (
                <label>
                  QIF date format
                  <select
                    value={dateOrder}
                    disabled={busy}
                    onChange={(e) =>
                      setDateOrder(e.target.value as typeof dateOrder)
                    }
                  >
                    <option value="">Choose date format</option>
                    <option value="day-first">DD/MM/YYYY</option>
                    <option value="month-first">MM/DD/YYYY</option>
                  </select>
                </label>
              )}
            </>
          )}
          {error && <p role="alert">{error}</p>}
          {!error && entry.accountId && entry.error && (
            <p role="alert">{entry.error}</p>
          )}
        </form>
      </div>
    </ImportReviewSheet>
  );
}
