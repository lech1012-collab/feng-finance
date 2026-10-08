import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { useId, useState } from "react";
import type { Account, Statement, Transaction } from "../domain/models";
import { datedBalanceHistory } from "../analytics/balances";
import { reconciledStatementBalances } from "../analytics/statement-balances";
import { currencyPrecision, money } from "../domain/money";
import { ImportButton } from "./ImportPicker";
const accountColors = [
  "#7ab8ff",
  "#ceabff",
  "#f59485",
  "#e6b66e",
  "#d987b0",
  "#9daec7",
];
export function BalanceChart({
  accounts,
  statements,
  month,
  currency,
  period,
  transactions,
  showValues = false,
}: {
  accounts: Account[];
  statements: Statement[];
  month: string;
  currency: string;
  period: number;
  transactions: Transaction[];
  showValues?: boolean;
}) {
  const hatchId = `balance-gap-${useId().replaceAll(":", "")}`;
  const [selectedGap, setSelectedGap] = useState<string>();
  const scoped = accounts.filter((a) => a.currency === currency);
  const accountIds = new Set(scoped.map((account) => account.id));
  const verified = reconciledStatementBalances(
    statements.filter(
      (statement) =>
        accountIds.has(statement.accountId) && statement.currency === currency,
    ),
    transactions,
  );
  const closingOnly = verified.some(
    (statement) =>
      statement.periodSource === "transaction-coverage" ||
      transactions.some(
        (row) =>
          row.statementId === statement.id &&
          (row.date < statement.statementPeriodStart ||
            row.date > statement.statementPeriodEnd),
      ),
  );
  const history = datedBalanceHistory(
    scoped,
    verified,
    transactions,
    month,
    currency,
    period,
  );
  const data = history.data;
  const hasCashAccount = scoped.some(
    (account) => account.accountType !== "credit",
  );
  const status = (point: (typeof data)[number]) =>
    point.total !== null
      ? "Complete"
      : Object.values(point.balances).some((balance) => balance !== null)
        ? "Partial"
        : "No verified balance";
  const segments: { start: number; end: number; status: string }[] = [];
  for (const point of data) {
    const previous = segments.at(-1);
    if (previous?.status === status(point)) previous.end = point.stamp;
    else
      segments.push({
        start: point.stamp,
        end: point.stamp,
        status: status(point),
      });
  }
  const formatDate = (stamp: number) =>
    new Date(stamp).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  const factor = 10 ** currencyPrecision(currency);
  return (
    <section className="card balance-chart">
      <div className="section-heading">
        <h2>Balance history</h2>
        <span className="muted">
          {period} {period === 1 ? "month" : "months"}
        </span>
      </div>
      <div
        role="img"
        aria-label={`${period} month total and individual account balance history`}
      >
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart
            data={data}
            margin={{ top: 12, right: 8, left: -10, bottom: 0 }}
          >
            <defs>
              <pattern
                id={hatchId}
                width="8"
                height="8"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="8"
                  stroke="var(--muted)"
                  strokeWidth="1"
                />
              </pattern>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            {segments
              .filter((segment) => segment.status === "No verified balance")
              .map((segment) => (
                <ReferenceArea
                  key={segment.start}
                  x1={segment.start}
                  x2={segment.end}
                  fill={`url(#${hatchId})`}
                  fillOpacity={0.25}
                  stroke="none"
                />
              ))}
            <XAxis
              dataKey="stamp"
              type="number"
              domain={[data[0]?.stamp ?? 0, data.at(-1)?.stamp ?? 0]}
              tickFormatter={formatDate}
              minTickGap={30}
              tickLine={false}
              tick={{ fontSize: 13, fill: "var(--muted)" }}
            />
            <YAxis
              tickLine={false}
              tick={{ fontSize: 13, fill: "var(--muted)" }}
              tickFormatter={(v) =>
                `${+(Number(v) / factor / 1000).toFixed(1)}k`
              }
            />
            <ReferenceLine y={0} stroke="var(--muted)" />
            <Tooltip
              filterNull={false}
              content={({ active, label }) => {
                const point = data.find((item) => item.stamp === Number(label));
                if (!active || !point) return null;
                return (
                  <div className="chart-tooltip">
                    <strong>
                      {formatDate(point.stamp)} · {status(point)}
                    </strong>
                    {status(point) === "No verified balance" ? (
                      <p>No verified balance</p>
                    ) : (
                      <>
                        {scoped.map((account, index) => (
                          <p key={account.id}>
                            {account.displayName}:{" "}
                            {point.balances[`account${index}`] === null
                              ? "Not imported"
                              : money(
                                  point.balances[`account${index}`]!,
                                  currency,
                                )}
                          </p>
                        ))}
                        <p>
                          Net position:{" "}
                          {hasCashAccount && point.total !== null
                            ? money(point.total, currency)
                            : "Unavailable"}
                        </p>
                      </>
                    )}
                  </div>
                );
              }}
            />
            {scoped.map((a, i) => (
              <Line
                key={a.id}
                name={a.displayName}
                dataKey={`balances.account${i}`}
                stroke={accountColors[i % accountColors.length]}
                strokeWidth={2}
                type="stepAfter"
                dot={
                  data.filter((d) => d.balances[`account${i}`] !== null)
                    .length < 3
                    ? { r: 3 }
                    : false
                }
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
            {hasCashAccount && (
              <Line
                name="Net position"
                dataKey="total"
                stroke="var(--ink)"
                strokeWidth={3}
                strokeDasharray="6 3"
                type="stepAfter"
                dot={
                  data.filter((d) => d.total !== null).length < 3
                    ? { r: 4 }
                    : false
                }
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="coverage-note">
        {formatDate(Date.parse(history.start))} –{" "}
        {formatDate(Date.parse(history.end))}
      </p>
      {data.filter((d) => Object.values(d.balances).some((v) => v !== null))
        .length < 2 && (
        <p className="coverage-note">
          Only one recorded balance or no verified history. Import earlier
          statements to see a trend.
        </p>
      )}
      <div className="chart-legend">
        {scoped.map((a, i) => (
          <span key={a.id}>
            <i
              style={{ background: accountColors[i % accountColors.length] }}
            />
            {a.displayName}
          </span>
        ))}
        {hasCashAccount && <span>┄ Net position</span>}
      </div>
      {closingOnly && (
        <p className="coverage-note">
          Some statements verify only their closing balance. Daily history
          remains unavailable where dates or the statement period cannot be
          verified.
        </p>
      )}
      {segments.some((segment) => segment.status === "No verified balance") && (
        <div className="chart-coverage" aria-label="Missing balance history">
          {segments
            .filter((segment) => segment.status === "No verified balance")
            .map((segment) => (
              <button
                className="chart-month-gap"
                key={segment.start}
                onClick={() =>
                  setSelectedGap(
                    `${formatDate(segment.start)} – ${formatDate(segment.end)}: No verified balance`,
                  )
                }
              >
                {formatDate(segment.start)} – {formatDate(segment.end)} · No
                verified balance
              </button>
            ))}
        </div>
      )}
      {selectedGap && (
        <p role="status" className="chart-coverage-note">
          {selectedGap}
        </p>
      )}
      <div className={showValues ? "chart-data" : "sr-only"}>
        <details open={!showValues}>
          <summary>View balance chart values</summary>
          <table>
            <caption>Statement-backed daily account balances</caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Coverage</th>
                {scoped.map((account) => (
                  <th key={account.id}>{account.displayName}</th>
                ))}
                {hasCashAccount && <th>Net position</th>}
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.stamp}>
                  <th>{formatDate(point.stamp)}</th>
                  <td>{status(point)}</td>
                  {scoped.map((account, index) => (
                    <td key={account.id}>
                      {point.balances[`account${index}`] === null
                        ? "No verified balance"
                        : money(point.balances[`account${index}`]!, currency)}
                    </td>
                  ))}
                  {hasCashAccount && (
                    <td>
                      {point.total === null
                        ? "Unavailable"
                        : money(point.total, currency)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
      {data.some((d) => d.total === null) && (
        <p className="coverage-note">
          Gaps indicate missing or unverified history. Daily movement includes
          transfers.
        </p>
      )}
      {!verified.length && (
        <ImportButton className="button">
          Import statements for a balance history
        </ImportButton>
      )}
    </section>
  );
}
