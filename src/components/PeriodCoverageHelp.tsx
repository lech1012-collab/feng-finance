import { Link } from "react-router-dom";
import type { AccountCoverageIssue } from "../analytics/period-coverage-issues";
import { shiftDate } from "../analytics/analysis-period";
import { formatDateRange, formatUkDate } from "../domain/dates";
import { money } from "../domain/money";
import type { Statement } from "../domain/models";
import { displayAccountName } from "../domain/presentation";
import type { reportingCoverage } from "../analytics/reporting";
import { ImportButton } from "./ImportPicker";

function statementReason(
  statement: Statement,
  start: string,
  end: string,
  today: string,
) {
  if (statement.periodSource === "transaction-coverage")
    return `Statement dated ${formatUkDate(statement.statementDate ?? statement.statementPeriodEnd)}. The billing period was inferred from transactions.`;
  if (statement.statementPeriodEnd > today)
    return `The statement ends on a future date, ${formatUkDate(statement.statementPeriodEnd)}. Check the printed dates.`;
  const label = `Statement ending ${formatUkDate(statement.statementPeriodEnd)}.`;
  if (
    statement.statementPeriodEnd < start ||
    statement.statementPeriodStart >= end
  )
    return `${label} Payments in this reporting period fall outside its recorded dates.`;
  if (statement.validationDifference)
    return `${label} The balance check at import differed by ${money(Math.abs(statement.validationDifference), statement.currency)}.`;
  if (
    statement.openingBalance === undefined ||
    statement.closingBalance === undefined
  )
    return `${label} An opening or closing balance is missing.`;
  if (
    statement.validationOverride ||
    statement.validationStatus !== "reconciled"
  )
    return `${label} Its figures were unverified at import.`;
  return `${label} The stored payments do not verify the full statement period.`;
}

export function PeriodCoverageHelp({
  coverage,
  issues,
  start,
  end,
  today,
  month,
}: {
  coverage: ReturnType<typeof reportingCoverage>;
  issues: AccountCoverageIssue[];
  start: string;
  end: string;
  today: string;
  month: string;
}) {
  return (
    <>
      {today < start ? (
        <p>This reporting period starts on {formatUkDate(start)}.</p>
      ) : end > today ? (
        <p>
          This reporting period is still in progress. It ends on{" "}
          {formatUkDate(shiftDate(end, -1))}.
          {issues.length === 0 &&
            coverage.total > 0 &&
            !coverage.pendingTransfers &&
            !coverage.missingRates &&
            !coverage.staleRates &&
            " Check again after your next statement arrives."}
        </p>
      ) : null}
      {coverage.total === 0 && (
        <p>
          Monthly statement coverage uses bank and card accounts. Manual
          balances appear under Where you stand.
        </p>
      )}
      {issues.length > 0 && (
        <ul
          className="category-comparison-list"
          aria-label="Statement coverage by account"
        >
          {issues.map(({ account, gaps, checks, unsupportedRowCount }) => (
            <li key={account.id}>
              <strong>
                {displayAccountName(account)} {account.maskedAccountIdentifier}
              </strong>
              {gaps.map((gap) => (
                <span key={gap.start}>
                  No imported statement covers{" "}
                  {gap.start === gap.end
                    ? formatUkDate(gap.start)
                    : formatDateRange(gap.start, gap.end)}
                  .
                </span>
              ))}
              {checks.map((s) => (
                <span key={s.id}>
                  {statementReason(s, start, end, today)}{" "}
                  <Link
                    to={`/settings?section=statements&statement=${encodeURIComponent(s.id)}#statement-${encodeURIComponent(s.id)}`}
                    state={{ returnTo: "/" }}
                    aria-label={`View statement for ${displayAccountName(account)} ending ${formatUkDate(s.statementPeriodEnd)}`}
                  >
                    View statement
                  </Link>
                </span>
              ))}
              {unsupportedRowCount > 0 && (
                <span>
                  {unsupportedRowCount}{" "}
                  {unsupportedRowCount === 1 ? "payment has" : "payments have"}{" "}
                  no matching statement.{" "}
                  <Link
                    to={`/transactions?month=${month}&account=${encodeURIComponent(account.id)}&allDates=0`}
                  >
                    View account activity
                  </Link>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {issues.some((issue) => issue.gaps.length > 0) && (
        <ImportButton className="button">Select statements</ImportButton>
      )}
      {coverage.pendingTransfers > 0 && (
        <p>
          {coverage.pendingTransfers}{" "}
          {coverage.pendingTransfers === 1
            ? "transfer needs"
            : "transfers need"}{" "}
          confirmation.{" "}
          <Link to={`/transactions?transfers=1&month=${month}&allDates=0`}>
            Review transfers
          </Link>
        </p>
      )}
      {(coverage.missingRates > 0 || coverage.staleRates) && (
        <p>
          {coverage.missingRates > 0
            ? "Some payments have no exchange rate for their date."
            : "Some payments use an older exchange rate."}{" "}
          <Link to="/settings?section=currency" state={{ returnTo: "/" }}>
            Check exchange rates
          </Link>
        </p>
      )}
    </>
  );
}
