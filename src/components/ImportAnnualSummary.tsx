import { ChevronDown, FileText } from "lucide-react";
import { money } from "../domain/money";
import type { AnnualStatementSummary } from "../parsers/barclaycard-annual";
import { ImportPeriod } from "./ImportPeriod";
import { StatusChip } from "./UIPrimitives";

/** Aggregate source figures are a read-only preview, never transaction rows. */
export function ImportAnnualSummary({
  summary,
  filename,
  open,
  onToggle,
}: {
  summary: AnnualStatementSummary;
  filename: string;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  return (
    <details
      className="card import-statement-card import-annual-summary"
      open={open}
      onToggle={(event) => {
        if (open !== event.currentTarget.open)
          onToggle(event.currentTarget.open);
      }}
    >
      <summary className="import-statement-heading">
        <FileText size={20} aria-hidden="true" />
        <span className="import-statement-heading-text">
          <h2>Barclaycard annual summary</h2>
          <span>
            {summary.period ? (
              <ImportPeriod
                start={summary.period.start}
                end={summary.period.end}
              />
            ) : (
              "Printed period unavailable"
            )}
          </span>
        </span>
        <span className="import-heading-outcome">
          <StatusChip tone="neutral">Summary only</StatusChip>
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="import-statement-content">
        <p>
          Use monthly Barclaycard statements to import individual purchases and
          payments.
        </p>
        {summary.statementDate && (
          <p>
            Issued{" "}
            <time dateTime={summary.statementDate}>
              {new Date(`${summary.statementDate}T12:00:00Z`)
                .toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  timeZone: "UTC",
                })
                .replace(/\bSept\b/g, "Sep")}
            </time>
          </p>
        )}
        {summary.totals && (
          <>
            <h3>Printed annual totals</h3>
            <dl className="import-annual-figures">
              {(
                [
                  ["Transactions", summary.totals.transactions],
                  ["Interest", summary.totals.interest],
                  ["Fees", summary.totals.fees],
                  ["Payments", summary.totals.payments],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd className="amount">
                    {value === undefined
                      ? "Not read"
                      : money(value, summary.totals!.currency)}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
        <p>
          These totals are shown for reference and are left out of cash flow.
          Nothing from this summary will be saved.
        </p>
        <p className="import-annual-filename">{filename}</p>
      </div>
    </details>
  );
}
