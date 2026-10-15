import { useEffect, useId, useState } from "react";
import { decimalMoney, parseMoney } from "../domain/money";
import { parseDate } from "../domain/dates";
import { displayDate } from "../domain/presentation";
import type { RowCheck, RowReading, SourceRect } from "../import/generic/types";
import {
  displayMoney,
  validReading,
  selectedReading,
  issueCopy,
  type CropSession,
  type GenericImportReviewProps,
} from "./generic-review-view";
function SourceCrop({
  session,
  rect,
}: {
  session?: CropSession;
  rect: SourceRect;
}) {
  const [preview, setPreview] = useState<{ url?: string; error?: boolean }>({});
  useEffect(() => {
    setPreview({});
    if (!session) return;
    const controller = new AbortController();
    let url: string | undefined;
    let disposed = false;
    void session
      .crop(rect, { signal: controller.signal })
      .then((blob) => {
        if (disposed) return;
        url = URL.createObjectURL(blob);
        setPreview({ url });
      })
      .catch(() => {
        if (!disposed && !controller.signal.aborted)
          setPreview({ error: true });
      });
    return () => {
      disposed = true;
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [session, rect.page, rect.x, rect.y, rect.width, rect.height]);
  if (!session)
    return (
      <p className="muted">
        Open the original PDF to compare this row on page {rect.page}.
      </p>
    );
  return (
    <figure className="generic-source-crop">
      {preview.url ? (
        <img
          src={preview.url}
          alt={`Original statement row on page ${rect.page}`}
        />
      ) : (
        <p className="muted">
          {preview.error
            ? "Preview unavailable. Compare this row with the original PDF."
            : "Preparing the original row…"}
        </p>
      )}
      <figcaption>Original PDF · page {rect.page}</figcaption>
    </figure>
  );
}

function ReadingValues({
  reading,
  currency,
}: {
  reading: RowReading;
  currency?: string;
}) {
  return (
    <dl className="generic-reading-values">
      <div>
        <dt>Date</dt>
        <dd>
          {reading.date ? (
            <time className="date-value" dateTime={reading.date}>
              {displayDate(reading.date)}
            </time>
          ) : (
            (reading.rawDate ?? "Not read")
          )}
        </dd>
      </div>
      <div>
        <dt>Description</dt>
        <dd>{reading.description || "Not read"}</dd>
      </div>
      <div>
        <dt>Amount</dt>
        <dd>
          {reading.amount === undefined
            ? reading.rawAmount || "Not read"
            : displayMoney(reading.amount, currency, true)}
        </dd>
      </div>
      {(reading.balanceAfterTransaction !== undefined ||
        reading.rawBalance) && (
        <div>
          <dt>Balance</dt>
          <dd>
            {reading.balanceAfterTransaction === undefined
              ? reading.rawBalance
              : displayMoney(reading.balanceAfterTransaction, currency)}
          </dd>
        </div>
      )}
    </dl>
  );
}

export function GenericReviewRow({
  row,
  session,
  currency,
  busy,
  onAction,
}: {
  row: RowCheck;
  session?: CropSession;
  currency?: string;
  busy: boolean;
  onAction: GenericImportReviewProps["onAction"];
}) {
  const reading = selectedReading(row);
  const [correcting, setCorrecting] = useState(false);
  const [open, setOpen] = useState(!row.resolved);
  useEffect(() => {
    setOpen(!row.resolved);
  }, [row.resolved]);
  const [date, setDate] = useState(reading?.date ?? "");
  const [description, setDescription] = useState(reading?.description ?? "");
  const [amount, setAmount] = useState(
    reading?.amount !== undefined && currency
      ? decimalMoney(reading.amount, currency)
      : "",
  );
  const [balance, setBalance] = useState(
    reading?.balanceAfterTransaction !== undefined && currency
      ? decimalMoney(reading.balanceAfterTransaction, currency)
      : "",
  );
  const [error, setError] = useState("");
  const amountId = useId();
  const excluded = row.reviewAction?.kind === "exclude";
  const state = excluded
    ? "Excluded from import"
    : row.reviewAction
      ? row.issues.length
        ? "Reviewed · not verified"
        : "Reviewed"
      : "Needs review";
  const startCorrection = () => {
    setDate(reading?.date ?? "");
    setDescription(reading?.description ?? "");
    setAmount(
      reading?.amount !== undefined && currency
        ? decimalMoney(reading.amount, currency)
        : "",
    );
    setBalance(
      reading?.balanceAfterTransaction !== undefined && currency
        ? decimalMoney(reading.balanceAfterTransaction, currency)
        : "",
    );
    setError("");
    setCorrecting(true);
  };
  return (
    <details
      className={`generic-review-row${excluded ? " generic-row-excluded" : ""}`}
      open={open}
      onToggle={(event) => {
        if (event.currentTarget.open !== open)
          setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        <span>
          <strong>{reading?.description || "Unread transaction"}</strong>
          <small>
            Page {row.rect.page} · {state}
          </small>
        </span>
        <strong>{displayMoney(reading?.amount, currency, true)}</strong>
      </summary>
      {open && (
        <div className="generic-row-content">
          <SourceCrop session={session} rect={row.rect} />
          {!!row.issues.length && (
            <ul className="generic-row-issues">
              {row.issues.map((issue) => (
                <li key={issue}>{issueCopy[issue]}</li>
              ))}
            </ul>
          )}
          {row.previousBalance !== undefined && (
            <dl className="generic-balance-check">
              <div>
                <dt>Previous balance</dt>
                <dd>{displayMoney(row.previousBalance, currency)}</dd>
              </div>
              <div>
                <dt>Calculated balance</dt>
                <dd>{displayMoney(row.calculatedBalance, currency)}</dd>
              </div>
              <div>
                <dt>Statement balance</dt>
                <dd>{displayMoney(row.reportedBalance, currency)}</dd>
              </div>
              {row.difference !== undefined && (
                <div>
                  <dt>Difference</dt>
                  <dd>{displayMoney(row.difference, currency, true)}</dd>
                </div>
              )}
            </dl>
          )}
          <div className="generic-readings">
            {row.readings.map((option, index) => (
              <section
                className="generic-reading"
                key={option.id}
                aria-label={`${index === 0 ? "Extracted" : "Alternative"} reading ${index + 1}`}
              >
                <h4>
                  {index === 0 ? "Extracted values" : `Alternative ${index}`}
                  {option.parseSource === "ocr" && (
                    <span className="small-chip">Read from image</span>
                  )}
                </h4>
                <ReadingValues reading={option} currency={currency} />
                <button
                  type="button"
                  disabled={busy || !validReading(option)}
                  onClick={() =>
                    onAction(row.rowId, {
                      kind: "accept",
                      readingId: option.id,
                    })
                  }
                >
                  {index === 0
                    ? "Accept extracted values"
                    : `Accept alternative ${index}`}
                </button>
                {!validReading(option) && (
                  <p className="muted">
                    Correct the missing or invalid date, description or amount
                    before accepting.
                  </p>
                )}
              </section>
            ))}
          </div>
          {correcting ? (
            <form
              className="generic-correction"
              onSubmit={(event) => {
                event.preventDefault();
                if (!currency) {
                  setError(
                    "Choose the statement currency before correcting an amount.",
                  );
                  return;
                }
                try {
                  const validDate = parseDate(date);
                  if (validDate !== date || !description.trim())
                    throw new Error("Invalid row");
                  const minorAmount = parseMoney(amount, currency);
                  const minorBalance = balance.trim()
                    ? parseMoney(balance, currency)
                    : undefined;
                  onAction(row.rowId, {
                    kind: "correct",
                    date: validDate,
                    description: description.trim(),
                    amount: minorAmount,
                    ...(minorBalance === undefined
                      ? {}
                      : { balanceAfterTransaction: minorBalance }),
                  });
                  setError("");
                  setCorrecting(false);
                } catch {
                  setError(
                    "Enter a valid date, description and amount. Use a minus sign for money out.",
                  );
                }
              }}
            >
              <label>
                Date
                <input
                  type="date"
                  required
                  disabled={busy}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
              <label>
                Description
                <textarea
                  required
                  disabled={busy}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <label htmlFor={amountId}>
                Amount{currency ? ` (${currency})` : ""}
                <input
                  id={amountId}
                  type="text"
                  inputMode="decimal"
                  required
                  disabled={busy || !currency}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
              <label>
                Running balance (optional)
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={busy || !currency}
                  value={balance}
                  onChange={(event) => setBalance(event.target.value)}
                />
              </label>
              <p className="muted">
                Positive means money in. Negative means money out. Saving checks
                the statement again.
              </p>
              {error && <p role="alert">{error}</p>}
              <div className="generic-action-row">
                <button type="submit" disabled={busy || !currency}>
                  Save correction
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setCorrecting(false)}
                >
                  Cancel correction
                </button>
              </div>
            </form>
          ) : (
            <div className="generic-action-row">
              <button type="button" disabled={busy} onClick={startCorrection}>
                Correct this row
              </button>
              <button
                type="button"
                disabled={busy || excluded}
                onClick={() => onAction(row.rowId, { kind: "exclude" })}
              >
                Exclude this row
              </button>
            </div>
          )}
          <p className="muted">
            Excluding a source row changes the statement check. Duplicate rows
            are handled separately.
          </p>
        </div>
      )}
    </details>
  );
}
