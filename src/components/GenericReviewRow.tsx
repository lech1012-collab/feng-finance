import { SourceRowCorrection } from "./SourceRowCorrection";
import { useEffect, useRef, useState } from "react";
import { displayDate, displayMerchant } from "../domain/presentation";
import type { RowCheck, RowReading, SourceRect } from "../import/generic/types";
import {
  displayMoney,
  validReading,
  selectedReading,
  issueCopy,
  type CropSession,
  type GenericImportReviewProps,
} from "./generic-review-view";
export function SourceCrop({
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
          draggable={false}
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
  const raw = (label: string, value?: string) => (
    <span
      className="import-raw-reference"
      role="region"
      aria-label={`Original ${label}`}
      tabIndex={0}
    >
      {value || "Not read"}
    </span>
  );
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
            raw("date", reading.rawDate)
          )}
        </dd>
      </div>
      <div>
        <dt>Description</dt>
        <dd>
          <div
            className="generic-original-description"
            data-source-text
            tabIndex={0}
            role="region"
            aria-label="Original transaction description"
          >
            <span>{reading.description || "Not read"}</span>
          </div>
        </dd>
      </div>
      <div>
        <dt>Amount</dt>
        <dd>
          {reading.amount === undefined
            ? raw("amount", reading.rawAmount)
            : displayMoney(reading.amount, currency, true)}
        </dd>
      </div>
      {(reading.balanceAfterTransaction !== undefined ||
        reading.rawBalance) && (
        <div>
          <dt>Balance</dt>
          <dd>
            {reading.balanceAfterTransaction === undefined
              ? raw("balance", reading.rawBalance)
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
  correctionRequest,
}: {
  row: RowCheck;
  session?: CropSession;
  currency?: string;
  busy: boolean;
  onAction: GenericImportReviewProps["onAction"];
  correctionRequest?: string;
}) {
  const reading = selectedReading(row);
  const merchant = displayMerchant({
    merchant: "",
    description: reading?.description || "Unread transaction",
  });
  const rawName = /\S{30,}/.test(merchant);
  const amountButton = useRef<HTMLButtonElement>(null);
  const [correcting, setCorrecting] = useState(false);
  const [open, setOpen] = useState(!row.resolved);
  useEffect(() => {
    setOpen(!row.resolved);
  }, [row.resolved]);
  useEffect(() => {
    if (correctionRequest) {
      const button = amountButton.current;
      if (button && !button.closest("[hidden], [inert]"))
        button.focus({ preventScroll: true });
      setOpen(true);
      setCorrecting(true);
    }
  }, [correctionRequest]);
  const excluded = row.reviewAction?.kind === "exclude";
  const state = excluded
    ? "Excluded from import"
    : row.reviewAction
      ? row.issues.length
        ? "Reviewed · not verified"
        : "Reviewed"
      : "Needs review";
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
          <strong
            className={rawName ? "import-raw-reference" : undefined}
            role={rawName ? "region" : undefined}
            aria-label={rawName ? "Transaction name" : undefined}
            tabIndex={rawName ? 0 : undefined}
          >
            {merchant}
          </strong>
          <small>
            Page {row.rect.page} · {state}
          </small>
        </span>
        <button
          type="button"
          className="import-amount-action"
          ref={amountButton}
          aria-label={`Correct amount for ${merchant}`}
          disabled={busy}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.focus({ preventScroll: true });
            setOpen(true);
            setCorrecting(true);
          }}
        >
          {reading?.amount === undefined
            ? "Amount unread"
            : displayMoney(reading.amount, currency, true)}
        </button>
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
          <div className="generic-action-row">
            <button
              type="button"
              disabled={busy || excluded}
              onClick={() => onAction(row.rowId, { kind: "exclude" })}
            >
              Exclude row
            </button>
          </div>
          {correcting && (
            <SourceRowCorrection
              reading={reading}
              currency={currency}
              busy={busy}
              source={<SourceCrop session={session} rect={row.rect} />}
              onSave={(action) => {
                onAction(row.rowId, action);
                setCorrecting(false);
              }}
              onCancel={() => setCorrecting(false)}
            />
          )}
          <details className="generic-reading-comparison">
            <summary>
              Compare extracted readings ({row.readings.length})
            </summary>
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
                    Use reading {index + 1}
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
          </details>
          <p className="muted">
            Excluding a source row changes the statement check. Duplicate rows
            are handled separately.
          </p>
        </div>
      )}
    </details>
  );
}
