import { useState } from "react";
import { Link } from "react-router-dom";
import type { Account, Statement } from "../domain/models";
import { balanceOverview } from "../analytics/balances";
import { money } from "../domain/money";
export function AccountBalances({
  accounts,
  statements,
  month,
  currency,
  detailed = false,
}: {
  accounts: Account[];
  statements: Statement[];
  month: string;
  currency: string;
  detailed?: boolean;
}) {
  const [window, setWindow] = useState(1);
  const summary = balanceOverview(accounts, statements, month, currency);
  const change = summary.comparisons.find((c) => c.months === window)?.percent;
  const percent = (n: number | undefined) =>
    n === undefined
      ? "History unavailable"
      : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  return (
    <section className="card balance-summary">
      <div className="section-heading">
        <h2>{detailed ? "Your accounts" : "Total balance"}</h2>
        <Link to={detailed ? "/settings" : "/transactions"}>
          {detailed ? "Manage" : "Accounts"}
        </Link>
      </div>
      <strong className="balance-total">
        {summary.total === undefined
          ? "Unavailable"
          : money(summary.total, currency)}
      </strong>
      <div
        className="balance-periods"
        role="group"
        aria-label="Balance comparison period"
      >
        {[1, 3, 6, 12].map((n) => (
          <button
            key={n}
            aria-pressed={window === n}
            onClick={() => setWindow(n)}
          >
            {n}m
          </button>
        ))}
      </div>
      <p className="balance-change">
        {percent(change)}{" "}
        <span className="muted">
          vs {window === 1 ? "last month" : `${window} months ago`}
        </span>
      </p>
      {!summary.complete && (
        <p className="coverage-note">
          {summary.total === undefined
            ? "Import statements to see balances."
            : "Partial total: some accounts have missing, older or unverified statements."}
        </p>
      )}
      <div className="balance-accounts">
        {summary.items.map((item) => (
          <Link
            className="balance-account"
            key={item.account.id}
            to={`/transactions?account=${item.account.id}&month=${month}`}
          >
            <span>
              <strong>{item.account.displayName}</strong>
              <small>
                {item.account.institution}
                {detailed && ` · ${item.account.maskedAccountIdentifier}`}
              </small>
              {detailed && (
                <small>
                  {item.statement
                    ? `Statement to ${item.statement.statementPeriodEnd}`
                    : "No statement imported"}
                </small>
              )}
            </span>
            <span className="balance-account-value">
              <strong>
                {item.balance === undefined
                  ? "Unavailable"
                  : money(item.balance, currency)}
              </strong>
              <small>
                {percent(
                  item.changes.find((c) => c.months === window)?.percent,
                )}
              </small>
              {!detailed && item.statement && (
                <small>As of {item.statement.statementPeriodEnd}</small>
              )}
              {item.current && !item.reliable && (
                <small>Unverified balance</small>
              )}
              {item.account.accountType === "credit" && (
                <small>
                  {(item.balance ?? 0) < 0 ? "Card debt" : "Card credit"}
                </small>
              )}
            </span>
          </Link>
        ))}
      </div>
      {summary.items.some((i) => i.account.accountType === "credit") && (
        <p className="coverage-note">
          Total includes cash and card balances. Card debt reduces the total.
        </p>
      )}
    </section>
  );
}
