import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/database";
import { createManualTransaction } from "../storage/accuracy";
import { money, parseMoney } from "../domain/money";
import { undoChange } from "../storage/audit";
import "./accuracy.css";

export function ManualTransactionEditor({
  onSaved,
}: {
  onSaved?: () => void | Promise<void>;
}) {
  const data = useLiveQuery(async () => ({
    accounts: await db.accounts.toArray(),
    categories: await db.categories.toArray(),
    currency: (await db.settings.get("currency"))?.value ?? "GBP",
  }));
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [opening, setOpening] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{
    changeId: string;
    amount: number;
    currency: string;
  }>();
  const [busy, setBusy] = useState(false);
  const currency =
    data?.accounts.find((item) => item.id === account)?.currency ??
    data?.currency ??
    "GBP";
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const value =
        Math.abs(parseMoney(amount, currency)) * (direction === "out" ? -1 : 1);
      // Authorization uses only the date; the storage helper rechecks within its
      // atomic write against the full reporting-period settings.
      const { ClosedMonthError, reopenMonths } =
        await import("../storage/month-review");
      const input = {
        accountId: account || undefined,
        date,
        description,
        amount: value,
        currency,
        categoryId: category || undefined,
        note,
        cashOpeningBalance: opening ? parseMoney(opening, currency) : undefined,
      };
      let result;
      try {
        result = await createManualTransaction(input);
      } catch (exception) {
        if (
          !(exception instanceof ClosedMonthError) ||
          !window.confirm("This changes a closed month. Reopen?")
        )
          throw exception;
        await reopenMonths(exception.months);
        result = await createManualTransaction(input);
      }
      setReceipt({ changeId: result.changeId, amount: value, currency });
      setAccount(result.result.accountId);
      setDescription("");
      setAmount("");
      setOpening("");
      setNote("");
      setOpen(false);
      await onSaved?.();
    } catch (exception) {
      setError(
        exception instanceof Error
          ? exception.message
          : "Manual transaction could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="manual-entry">
      <button
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        Add manual transaction
      </button>
      {open && (
        <section
          className="card accuracy-editor"
          aria-label="Manual transaction"
        >
          <h2>Manual transaction</h2>
          <p className="coverage-note">
            Record cash or a payment before its statement arrives. Matching
            statement rows can replace it without counting it twice.
          </p>
          <div className="form-grid">
            <label>
              Account
              <select
                value={account}
                onChange={(event) => setAccount(event.target.value)}
              >
                <option value="">New cash wallet</option>
                {data?.accounts
                  .filter((item) =>
                    ["current", "savings", "credit", "credit_card"].includes(
                      item.accountType,
                    ),
                  )
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.displayName} · {item.currency}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Date
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label>
              Description
              <input
                value={description}
                maxLength={1000}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label>
              Money direction
              <select
                value={direction}
                onChange={(event) => {
                  setDirection(event.target.value as "out" | "in");
                  setCategory("");
                }}
              >
                <option value="out">Money out</option>
                <option value="in">Money in</option>
              </select>
            </label>
            <label>
              Amount ({currency})
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <label>
              Category
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">Uncategorized</option>
                {data?.categories
                  .filter(
                    (item) =>
                      !item.archived &&
                      !item.parentId &&
                      item.kind === (direction === "in" ? "income" : "expense"),
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            {!account && (
              <label>
                Opening cash balance (optional)
                <input
                  inputMode="decimal"
                  value={opening}
                  onChange={(event) => setOpening(event.target.value)}
                />
              </label>
            )}
            <label>
              Note
              <input
                value={note}
                maxLength={1000}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          </div>
          {error && (
            <p role="alert" className="notice warning">
              {error}
            </p>
          )}
          <button
            className="primary"
            disabled={busy || !date || !description.trim() || !amount}
            onClick={() => void save()}
          >
            Save manual transaction
          </button>
        </section>
      )}
      {receipt && (
        <div role="status" className="notice">
          Manual transaction saved ·{" "}
          {money(receipt.amount, receipt.currency, true)}.{" "}
          <button
            onClick={async () => {
              try {
                await undoChange(receipt.changeId);
                setReceipt(undefined);
                await onSaved?.();
              } catch (exception) {
                setError(
                  exception instanceof Error
                    ? exception.message
                    : "Undo failed.",
                );
              }
            }}
          >
            Undo
          </button>
        </div>
      )}
      {!open && error && (
        <p role="alert" className="notice warning">
          {error}
        </p>
      )}
    </div>
  );
}
