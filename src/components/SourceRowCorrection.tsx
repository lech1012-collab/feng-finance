import { useId, useState, type ReactNode } from "react";
import type { RowReading, RowReviewAction } from "../import/generic/types";
import { decimalMoney, parseMoney } from "../domain/money";
import { parseDate } from "../domain/dates";
import { Sheet } from "./Sheet";
import { UKDateInput } from "./UKDateInput";

/** Editing is isolated from the statement list; only a valid Save emits a source action. */
export function SourceRowCorrection({
  reading,
  currency,
  busy,
  source,
  onSave,
  onCancel,
}: {
  reading?: RowReading;
  currency?: string;
  busy: boolean;
  source: ReactNode;
  onSave: (action: Extract<RowReviewAction, { kind: "correct" }>) => void;
  onCancel: () => void;
}) {
  const formId = useId();
  const [amount, setAmount] = useState(() =>
    reading?.amount !== undefined && currency
      ? decimalMoney(Math.abs(reading.amount), currency)
      : "",
  );
  const [direction, setDirection] = useState<"in" | "out" | undefined>(() =>
    reading?.amount === undefined
      ? undefined
      : reading.amount < 0
        ? "out"
        : "in",
  );
  const [date, setDate] = useState(reading?.date ?? "");
  const [description, setDescription] = useState(reading?.description ?? "");
  const [balance, setBalance] = useState(() =>
    reading?.balanceAfterTransaction !== undefined && currency
      ? decimalMoney(reading.balanceAfterTransaction, currency)
      : "",
  );
  const [error, setError] = useState("");
  function chooseDirection(next: "in" | "out") {
    setError("");
    setDirection(next);
    if (currency) {
      try {
        setAmount(
          decimalMoney(Math.abs(parseMoney(amount, currency)), currency),
        );
      } catch {
        /* Keep incomplete input editable. */
      }
    }
  }
  let detailsInvalid = !description.trim();
  try {
    detailsInvalid ||= !date || parseDate(date) !== date;
  } catch {
    detailsInvalid = true;
  }
  return (
    <Sheet
      title="Correct transaction amount"
      onClose={onCancel}
      footer={
        <>
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel correction
          </button>
          <button
            type="submit"
            className="primary"
            form={formId}
            disabled={busy || !currency}
          >
            Save row
          </button>
        </>
      }
    >
      <div className="import-correction">
        <p>{reading?.description || "Unread transaction"}</p>
        {source}
        <form
          id={formId}
          className="generic-correction"
          onSubmit={(event) => {
            event.preventDefault();
            if (!currency) {
              setError(
                "Choose the statement currency before correcting an amount.",
              );
              return;
            }
            if (!direction) {
              setError(
                "Choose Money in or Money out from the original statement.",
              );
              return;
            }
            try {
              const validDate = parseDate(date);
              if (validDate !== date || !description.trim())
                throw new Error("Invalid row");
              const entered = Math.abs(parseMoney(amount, currency));
              const signed =
                entered === 0 ? 0 : direction === "out" ? -entered : entered;
              const running = balance.trim()
                ? parseMoney(balance, currency)
                : undefined;
              onSave({
                kind: "correct",
                date: validDate,
                ...(reading?.bookingDate
                  ? { bookingDate: reading.bookingDate }
                  : {}),
                description: description.trim(),
                amount: signed,
                ...(running === undefined
                  ? {}
                  : { balanceAfterTransaction: running }),
              });
            } catch {
              setError(
                "Enter a valid date, description and amount with the currency's correct decimal places.",
              );
            }
          }}
        >
          <label>
            Amount{currency ? ` (${currency})` : ""}
            <input
              autoFocus
              type="text"
              inputMode="decimal"
              autoComplete="off"
              required
              disabled={busy || !currency}
              value={amount}
              onChange={(event) => {
                setError("");
                const value = event.target.value;
                setAmount(value);
                if (/\+|\bCR\s*$/i.test(value)) setDirection("in");
                else if (/[-−(]|\bDR\s*$/i.test(value)) setDirection("out");
              }}
            />
          </label>
          <div
            className="import-money-direction"
            role="group"
            aria-label="Money direction"
          >
            <button
              type="button"
              disabled={busy}
              aria-pressed={direction === "out"}
              onClick={() => chooseDirection("out")}
            >
              Money out
            </button>
            <button
              type="button"
              disabled={busy}
              aria-pressed={direction === "in"}
              onClick={() => chooseDirection("in")}
            >
              Money in
            </button>
          </div>
          <p className="muted">
            Enter the amount shown in the PDF. Money out is saved as a negative
            amount; no minus key is needed. Saving rechecks the statement.
          </p>
          {!currency && (
            <p role="alert">
              Choose the statement currency before correcting an amount.
            </p>
          )}
          <details
            className="import-correction-details"
            open={detailsInvalid || undefined}
          >
            <summary>Other transaction details</summary>
            <label>
              Date
              <UKDateInput
                required
                disabled={busy}
                value={date}
                onChange={(value) => {
                  setError("");
                  setDate(value);
                }}
              />
            </label>
            <label>
              Description
              <textarea
                required
                disabled={busy}
                value={description}
                onChange={(event) => {
                  setError("");
                  setDescription(event.target.value);
                }}
              />
            </label>
            <label>
              Running balance (optional)
              <input
                type="text"
                inputMode="text"
                disabled={busy || !currency}
                value={balance}
                onChange={(event) => {
                  setError("");
                  setBalance(event.target.value);
                }}
              />
            </label>
          </details>
          {error && <p role="alert">{error}</p>}
        </form>
      </div>
    </Sheet>
  );
}
