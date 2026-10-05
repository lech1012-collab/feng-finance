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
import type { Account, Statement } from "../domain/models";
import { balanceHistory } from "../analytics/balances";
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
}: {
  accounts: Account[];
  statements: Statement[];
  month: string;
  currency: string;
}) {
  const scoped = accounts.filter((a) => a.currency === currency);
  const data = balanceHistory(scoped, statements, month, currency, 6);
  const factor = 10 ** currencyPrecision(currency);
  return (
    <section className="card balance-chart">
      <div className="section-heading">
        <h2>Balance history</h2>
        <span className="muted">6 months</span>
      </div>
      <div
        role="img"
        aria-label="Monthly total and individual account balances"
      >
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart
            data={data}
            margin={{ top: 12, right: 8, left: -10, bottom: 0 }}
          >
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis
              dataKey="label"
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
              labelFormatter={(_, payload) => payload[0]?.payload.month ?? ""}
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
                dot={{ r: 3 }}
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
              dot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
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
          Gaps indicate missing or unverified monthly statement balances.
        </p>
      )}
    </section>
  );
}
