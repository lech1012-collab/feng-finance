import { useId, useState, type ReactNode } from "react";
import type { RowReading, RowReviewAction } from "../import/generic/types";
import type { ReviewField } from "../import/generic/review-decision";
import { decimalMoney, money, parseMoney } from "../domain/money";
import { parseDate } from "../domain/dates";
import { ImportReviewSheet } from "./ImportReviewSheet";
import { UKDateInput } from "./UKDateInput";

/** The editor changes only the uncertain fields; valid source values stay intact. */
export function SourceRowCorrection({
  reading,
  currency,
  busy,
  source,
  onSave,
  onCancel,
  progress,
  saveLabel = "Save amount",
  otherOptions,
  fields,
  reason,
}: {
  reading?: RowReading;
  currency?: string;
  busy: boolean;
  source: ReactNode;
  onSave: (action: Extract<RowReviewAction, { kind: "correct" }>) => void;
  onCancel: () => void;
  progress?: string;
  saveLabel?: string;
  otherOptions?: ReactNode;
  fields?: ReviewField[];
  reason?: string;
}) {
  const formId = useId();
  const primary = new Set(fields?.length ? fields : ["amount"]);
  const editAmount = primary.has("amount") || primary.has("direction");
  const title =
    primary.size === 1 && primary.has("date")
      ? "Correct date"
      : primary.size === 1 && primary.has("bookingDate")
        ? "Correct booking date"
        : primary.size === 1 && primary.has("description")
          ? "Add description"
          : primary.size === 1 && primary.has("balance")
            ? "Correct balance"
            : primary.size > 1
              ? "Check transaction"
              : "Correct amount";
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
  const [bookingDate, setBookingDate] = useState(reading?.bookingDate ?? "");
  const [description, setDescription] = useState(reading?.description ?? "");
  const [balance, setBalance] = useState(() =>
    reading?.balanceAfterTransaction !== undefined && currency
      ? decimalMoney(reading.balanceAfterTransaction, currency)
      : "",
  );
  const [error, setError] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(() => {
    try {
      return (
        (!primary.has("description") && !description.trim()) ||
        (!primary.has("date") && (!date || parseDate(date) !== date))
      );
    } catch {
      return !primary.has("date");
    }
  });
  function chooseDirection(next: "in" | "out") {
    setError("");
    setDirection(next);
    if (currency)
      try {
        setAmount(
          decimalMoney(Math.abs(parseMoney(amount, currency)), currency),
        );
      } catch {
        /* Keep incomplete text editable. */
      }
  }
  const amountField = (focus: boolean) => (
    <>
      <label>
        Amount{currency ? ` (${currency})` : ""}
        <input
          autoFocus={focus}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          required
          disabled={busy}
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
    </>
  );
  const dateField = (booking: boolean, focus: boolean) => (
    <label>
      {booking ? "Booking date" : "Date"}
      <UKDateInput
        required
        disabled={busy}
        autoFocus={focus}
        value={booking ? bookingDate : date}
        onChange={(value) => {
          setError("");
          if (booking) setBookingDate(value);
          else setDate(value);
        }}
      />
    </label>
  );
  const descriptionField = (focus: boolean) => (
    <label>
      Description
      <textarea
        required
        autoFocus={focus}
        disabled={busy}
        value={description}
        onChange={(event) => {
          setError("");
          setDescription(event.target.value);
        }}
      />
    </label>
  );
  const balanceField = (focus: boolean) => (
    <label>
      {primary.has("balance")
        ? "Running balance"
        : "Running balance (optional)"}
      <input
        autoFocus={focus}
        type="text"
        inputMode="text"
        disabled={busy}
        required={primary.has("balance")}
        value={balance}
        onChange={(event) => {
          setError("");
          setBalance(event.target.value);
        }}
      />
    </label>
  );
  return (
    <ImportReviewSheet
      title={title}
      closeLabel="Cancel correction"
      onClose={onCancel}
      footer={
        <button type="submit" className="primary" form={formId} disabled={busy}>
          {saveLabel}
        </button>
      }
    >
      <div className="import-correction">
        {progress && (
          <p className="muted" role="status">
            {progress}
          </p>
        )}
        <p>{reading?.description || "Unread transaction"}</p>
        {reason && <p className="muted">{reason}</p>}
        {!editAmount && reading?.amount !== undefined && currency && (
          <p className="amount">
            Amount kept: {money(reading.amount, currency, true)}
          </p>
        )}
        {source}
        <form
          id={formId}
          className="generic-correction"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
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
              if (bookingDate && parseDate(bookingDate) !== bookingDate)
                throw new Error("Invalid booking date");
              const entered = Math.abs(parseMoney(amount, currency));
              const signed =
                entered === 0 ? 0 : direction === "out" ? -entered : entered;
              const running = balance.trim()
                ? parseMoney(balance, currency)
                : undefined;
              if (primary.has("balance") && running === undefined)
                throw new Error("Missing balance");
              onSave({
                kind: "correct",
                date: validDate,
                ...(bookingDate ? { bookingDate } : {}),
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
          {editAmount && amountField(true)}
          {primary.has("date") && dateField(false, !editAmount)}
          {primary.has("bookingDate") &&
            dateField(true, !editAmount && !primary.has("date"))}
          {primary.has("description") &&
            descriptionField(
              !editAmount &&
                !primary.has("date") &&
                !primary.has("bookingDate"),
            )}
          {primary.has("balance") && balanceField(primary.size === 1)}
          <p className="muted">
            {editAmount
              ? "Copy the amount from your statement. Feng will recheck the totals."
              : "Correct this field from your statement. The other values will be kept and the totals rechecked."}
          </p>
          {!currency && (
            <p role="alert">
              Choose the statement currency before correcting an amount.
            </p>
          )}
          <details
            className="import-correction-details"
            open={detailsOpen}
            onToggle={(event) => {
              if (detailsOpen !== event.currentTarget.open)
                setDetailsOpen(event.currentTarget.open);
            }}
          >
            <summary>
              {otherOptions ? "More options" : "Other transaction details"}
            </summary>
            {!editAmount && amountField(false)}
            {!primary.has("date") && dateField(false, false)}
            {!!bookingDate &&
              !primary.has("bookingDate") &&
              dateField(true, false)}
            {!primary.has("description") && descriptionField(false)}
            {!primary.has("balance") && balanceField(false)}
            {otherOptions}
          </details>
          {error && <p role="alert">{error}</p>}
        </form>
      </div>
    </ImportReviewSheet>
  );
}
