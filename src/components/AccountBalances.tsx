import { useState } from "react";
import { Link } from "react-router-dom";
import type { Account, Statement, Transaction } from "../domain/models";
import { balanceOverview, datedBalanceHistory } from "../analytics/balances";
import { verifiedStatements } from "../analytics/coverage";
import {
  reconciledStatementBalances,
  statementBalanceDate,
  statementBalanceEvidence,
} from "../analytics/statement-balances";
import { monthBounds, monthLabel } from "../domain/dates";
import { money, safeSum } from "../domain/money";
import { ImportButton } from "./ImportPicker";

const dateLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`)
    .toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })
    .replace(/\bSept\b/g, "Sep");

export function AccountBalances({
  accounts,
  statements,
  month,
  currency,
  detailed = false,
  period,
  onPeriodChange,
  transactions = [],
}: {
  accounts: Account[];
  statements: Statement[];
  month: string;
  currency: string;
  detailed?: boolean;
  period?: number;
  onPeriodChange?: (period: number) => void;
  transactions?: Transaction[];
}) {
  const [localPeriod, setLocalPeriod] = useState(1);
  const window = period ?? localPeriod;
  const setWindow = onPeriodChange ?? setLocalPeriod;
  const verified = verifiedStatements(statements, transactions);
  const summary = balanceOverview(accounts, statements, month, currency);
  const verifiedSummary = balanceOverview(
    accounts,
    verified,
    month,
    currency,
    transactions,
  );
  const items = summary.items.map((item) => {
    const evidence = item.statement
      ? statementBalanceEvidence(item.statement, transactions)
      : undefined;
    const proven = evidence?.status === "reconciled";
    return {
      ...item,
      balance: Number.isSafeInteger(item.balance) ? item.balance : undefined,
      evidence,
      proven,
      reliable: proven && item.current,
      changes:
        verifiedSummary.items.find(
          (verifiedItem) => verifiedItem.account.id === item.account.id,
        )?.changes ?? [],
    };
  });
  const covered = items.filter((item) => item.proven).length;
  const allProven = items.length > 0 && covered === items.length;
  const complete = allProven && items.every((item) => item.current);
  const cashItems = items.filter(
    (item) => item.account.accountType !== "credit",
  );
  const cardItems = items.filter(
    (item) => item.account.accountType === "credit",
  );
  const cash =
    cashItems.length && cashItems.every((item) => item.proven)
      ? safeSum(cashItems.map((item) => item.balance!))
      : undefined;
  const debt =
    cardItems.length && cardItems.every((item) => item.proven)
      ? safeSum(cardItems.map((item) => Math.max(0, -item.balance!)))
      : cardItems.length
        ? undefined
        : 0;
  const cardCredit = safeSum(
    cardItems
      .filter((item) => item.proven)
      .map((item) => Math.max(0, item.balance!)),
  );
  const total =
    complete && cash !== undefined
      ? safeSum(items.map((item) => item.balance!))
      : undefined;
  const provenHistory = reconciledStatementBalances(statements, transactions);
  const history = datedBalanceHistory(
    accounts,
    provenHistory,
    transactions,
    month,
    currency,
    12,
  );
  const meaningfulHistory = accounts
    .filter((account) => account.currency === currency)
    .some(
      (account) =>
        new Set(
          provenHistory
            .filter(
              (statement) =>
                statement.accountId === account.id &&
                statement.currency === currency &&
                statementBalanceDate(statement) >= history.start &&
                statementBalanceDate(statement) < monthBounds(month)[1],
            )
            .map(statementBalanceDate),
        ).size >= 2,
    );
  const latestDateNote = (subset: typeof items) => {
    const dates = Array.from(
      new Set(
        subset
          .filter((item) => item.proven)
          .map((item) => item.evidence!.asOfDate),
      ),
    ).sort();
    return !dates.length
      ? undefined
      : dates.length === 1
        ? `Statement balance · ${dateLabel(dates[0])}`
        : `Statement dates · ${dateLabel(dates[0])} – ${dateLabel(dates.at(-1)!)}`;
  };
  const change =
    total === undefined
      ? undefined
      : verifiedSummary.comparisons.find(
          (comparison) => comparison.months === window,
        )?.percent;
  const percent = (n: number | undefined) =>
    n === undefined ? undefined : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  return (
    <section className="card balance-summary">
      <div className="section-heading">
        <h2>{detailed ? "Your accounts" : "Where you stand"}</h2>
        <Link to={detailed ? "/settings" : "/transactions"}>
          {detailed ? "Manage" : "Accounts"}
        </Link>
      </div>
      <p
        className={`position-coverage coverage-chip ${complete ? "coverage-complete" : "coverage-partial"}`}
      >
        {covered} of {items.length} accounts ·{" "}
        {complete
          ? "Reconciled"
          : allProven
            ? "Older statements"
            : "Incomplete"}
      </p>
      <div className="position-metrics">
        <div>
          <span>Cash</span>
          <strong>
            {cash === undefined ? "Unknown" : money(cash, currency)}
          </strong>
          {cash !== undefined && (
            <small className="muted">{latestDateNote(cashItems)}</small>
          )}
        </div>
        <div>
          <span>Card debt</span>
          <strong>
            {debt === undefined ? "Unknown" : money(debt, currency)}
          </strong>
          {debt !== undefined && cardItems.length > 0 && (
            <small className="muted">{latestDateNote(cardItems)}</small>
          )}
        </div>
        <div>
          <span>Net position</span>
          <strong className="balance-total">
            {total === undefined ? "Unavailable" : money(total, currency)}
          </strong>
        </div>
      </div>
      {cardCredit > 0 && (
        <p className="coverage-note">
          {total === undefined
            ? "Latest statements include"
            : "Net position includes"}{" "}
          {money(cardCredit, currency)} card credit.
        </p>
      )}
      {!complete || cash === undefined ? (
        <p className="coverage-note">
          {cashItems.length
            ? "Net position appears once all accounts have reconciled balances for this month."
            : "Import a current or savings account statement to see your cash and net position."}
        </p>
      ) : null}
      {items.some((item) => item.proven && !item.current) && (
        <p className="coverage-note">
          Some balances come from statements before {monthLabel(month)}. Their
          dates are shown; a current net position is unavailable.
        </p>
      )}
      {meaningfulHistory ? (
        <>
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
            {change === undefined
              ? "No comparable balances for this range"
              : `${percent(change)} vs ${window === 1 ? "last month" : `${window} months ago`}`}
          </p>
        </>
      ) : (
        <p className="balance-range-note muted">
          Import another reconciled statement to compare balances.
        </p>
      )}
      <div className="balance-accounts">
        {items.map((item) => (
          <div
            className={`balance-account ${item.reliable ? "" : "balance-account-missing"}`}
            key={item.account.id}
          >
            <Link
              className="balance-account-main"
              to={`/transactions?account=${item.account.id}&month=${month}`}
            >
              <span>
                <strong>{item.account.displayName}</strong>
                <small>
                  {item.account.institution} ·{" "}
                  {item.account.maskedAccountIdentifier}
                </small>
                <small>
                  {item.balance !== undefined && item.statement
                    ? `As of ${dateLabel(item.evidence!.asOfDate)}`
                    : item.statement
                      ? "No readable closing balance"
                      : "No statement yet"}
                </small>
                {item.evidence?.status === "unverified" &&
                  item.balance !== undefined && (
                    <small className="coverage-note">
                      {item.evidence.reason}
                    </small>
                  )}
              </span>
              <span className="balance-account-value">
                <strong>
                  {item.balance !== undefined
                    ? money(
                        item.account.accountType === "credit" &&
                          item.balance! < 0
                          ? -item.balance!
                          : item.balance!,
                        currency,
                      )
                    : "Unknown"}
                </strong>
                {item.account.accountType === "credit" &&
                  item.balance !== undefined && (
                    <small>
                      {item.balance! < 0 ? "Card debt" : "Card credit"}
                    </small>
                  )}
                {item.evidence?.status === "unverified" &&
                  item.balance !== undefined && (
                    <small>Unverified reported balance</small>
                  )}
                {item.proven && !item.current && <small>Older statement</small>}
                {meaningfulHistory &&
                  item.reliable &&
                  percent(
                    item.changes.find(
                      (comparison) => comparison.months === window,
                    )?.percent,
                  ) && (
                    <small>
                      {percent(
                        item.changes.find(
                          (comparison) => comparison.months === window,
                        )?.percent,
                      )}
                    </small>
                  )}
              </span>
            </Link>
            {!item.reliable && (
              <ImportButton className="button small">Import</ImportButton>
            )}
          </div>
        ))}
      </div>
      {!items.length && (
        <ImportButton className="button">
          Import an account statement
        </ImportButton>
      )}
    </section>
  );
}
