import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import type { Account, Statement, Transaction } from "../domain/models";
import { datedBalanceHistory } from "../analytics/balances";
import { currencyPrecision, money } from "../domain/money";
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
}: {
  accounts: Account[];
  statements: Statement[];
  month: string;
  currency: string;
  period: number;
  transactions: Transaction[];
}) {
  const scoped = accounts.filter((a) => a.currency === currency);
  const history = datedBalanceHistory(
    scoped,
    statements,
    transactions,
    month,
    currency,
    period,
  );
  const data = history.data;
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
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis
              dataKey="stamp"
              type="number"
              domain={[data[0]?.stamp ?? 0, data.at(-1)?.stamp ?? 0]}
              tickFormatter={formatDate}
              minTickGap={30}
              tickLine={false}
              tick={{ fontSize: 12, fill: "var(--muted)" }}
            />
            <YAxis
              tickLine={false}
              tick={{ fontSize: 12, fill: "var(--muted)" }}
              tickFormatter={(v) =>
                `${+(Number(v) / factor / 1000).toFixed(1)}k`
              }
            />
            <ReferenceLine y={0} stroke="var(--muted)" />
            <Tooltip
              labelFormatter={(value) => formatDate(Number(value))}
              formatter={(value) => money(Number(value), currency)}
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--line)",
                color: "var(--ink)",
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
            <Line
              name="Total balance"
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
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="coverage-note">
        {history.start} – {history.end}
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
        <span>┄ Total balance</span>
      </div>
      {data.some((d) => d.total === null) && (
        <p className="coverage-note">
          Gaps indicate missing or unverified history. Daily movement includes
          transfers.
        </p>
      )}
    </section>
  );
}
