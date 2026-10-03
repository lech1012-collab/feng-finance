import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { money, currencyPrecision } from "../domain/money";
export function CashChart({
  data,
  currency,
  property = false,
}: {
  data: {
    label: string;
    income: number;
    expenses: number;
    net: number;
    property?: number;
  }[];
  currency: string;
  property?: boolean;
}) {
  const factor = 10 ** currencyPrecision(currency);
  return (
    <div className="chart">
      <div
        role="img"
        aria-label={
          property
            ? "Monthly property net cash flow chart"
            : "Monthly income, expense and net cash flow chart"
        }
      >
        <ResponsiveContainer width="100%" height={210}>
          <ComposedChart
            data={data}
            margin={{ top: 12, right: 8, left: -16, bottom: 0 }}
          >
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 13, fill: "var(--muted)" }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: "var(--muted)" }}
              tickFormatter={(v) => {
                const n = Number(v) / factor;
                return Math.abs(n) >= 1000
                  ? `${+(n / 1000).toFixed(1)}k`
                  : String(Math.round(n));
              }}
            />
            <Tooltip
              formatter={(value) => money(Number(value), currency)}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid var(--line)",
                background: "var(--surface)",
                color: "var(--ink)",
              }}
            />
            {property ? (
              <Line
                isAnimationActive={false}
                name="Property net"
                dataKey="property"
                stroke="var(--chart-income)"
                strokeWidth={2}
                dot={false}
              />
            ) : (
              <>
                <Bar
                  isAnimationActive={false}
                  name="Income"
                  dataKey="income"
                  fill="var(--chart-income)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={16}
                />
                <Bar
                  isAnimationActive={false}
                  name="Expenses"
                  dataKey="expenses"
                  fill="var(--chart-expense)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={16}
                />
                <Line
                  isAnimationActive={false}
                  name="Net cash flow"
                  dataKey="net"
                  stroke="var(--chart-net)"
                  strokeWidth={2}
                  dot={false}
                />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-legend">
        {property ? (
          <span>— Property net cash flow</span>
        ) : (
          <>
            <span>
              <i className="income-key" />
              Income
            </span>
            <span>
              <i className="expense-key" />
              Expenses
            </span>
            <span>
              <i className="net-key" />
              Net
            </span>
          </>
        )}
      </div>
      <details className="chart-data">
        <summary>View chart values</summary>
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>{property ? "Property net" : "Income"}</th>
              {!property && (
                <>
                  <th>Expenses</th>
                  <th>Net</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={i}>
                <th>{d.label}</th>
                <td>
                  {money(property ? (d.property ?? 0) : d.income, currency)}
                </td>
                {!property && (
                  <>
                    <td>{money(d.expenses, currency)}</td>
                    <td>{money(d.net, currency)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
