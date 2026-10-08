import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { useId, useState } from "react";
import { money, currencyPrecision } from "../domain/money";
import type { MonthCoverage } from "../analytics/coverage";

export interface CashChartPoint {
  month?: string;
  label: string;
  income: number | null;
  expenses: number | null;
  net: number | null;
  property?: number | null;
  coverage?: MonthCoverage;
}

function CashBar({
  x,
  y,
  width,
  height,
  payload,
  series,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: { opacity?: number };
  series: "income" | "expenses";
}) {
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    ![x, y, width, height].every(Number.isFinite) ||
    width === 0 ||
    height === 0
  )
    return null;
  // Recharts starts a negative bar at its value and supplies a negative height
  // back to zero. SVG rects require positive dimensions, unlike its default path.
  return (
    <rect
      data-series={series}
      x={width < 0 ? x + width : x}
      y={height < 0 ? y + height : y}
      width={Math.abs(width)}
      height={Math.abs(height)}
      fill={
        series === "income" ? "var(--chart-income)" : "var(--chart-expense)"
      }
      rx={3}
      opacity={payload?.opacity ?? 1}
    />
  );
}

export function CashChart({
  data,
  currency,
  property = false,
  showValues = true,
}: {
  data: CashChartPoint[];
  currency: string;
  property?: boolean;
  showValues?: boolean;
}) {
  const hatchId = `missing-${useId().replaceAll(":", "")}`;
  const [selectedGap, setSelectedGap] = useState<string>();
  const factor = 10 ** currencyPrecision(currency);
  const missing = (point: CashChartPoint) =>
    point.coverage?.status === "No data" ||
    point.coverage?.status === "Unverified" ||
    (point.income === null && point.expenses === null && point.net === null);
  const displayed = data.map((point) => ({
    ...point,
    expenses: point.expenses === null ? null : -Math.abs(point.expenses),
    opacity: point.coverage && !point.coverage.complete ? 0.55 : 1,
  }));
  const value = (amount: number | null | undefined, point: CashChartPoint) =>
    amount == null
      ? point.coverage?.status === "Unverified"
        ? "Unverified statements"
        : missing(point)
          ? "No statements"
          : "Not imported"
      : money(amount, currency);
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
            data={displayed}
            margin={{ top: 12, right: 8, left: -16, bottom: 0 }}
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
            {data.filter(missing).map((point, index) => (
              <ReferenceArea
                key={`${point.month ?? point.label}-${index}`}
                x1={point.label}
                x2={point.label}
                fill={`url(#${hatchId})`}
                fillOpacity={0.25}
                stroke="none"
                shape={(props) => {
                  const supplied = Number(props.width) || 0;
                  const width =
                    supplied ||
                    Math.min(44, Math.max(12, 240 / Math.max(data.length, 1)));
                  return (
                    <rect
                      x={Number(props.x) - (supplied ? 0 : width / 2)}
                      y={props.y}
                      width={width}
                      height={props.height}
                      fill={`url(#${hatchId})`}
                      fillOpacity={0.25}
                    />
                  );
                }}
              />
            ))}
            <XAxis
              dataKey="label"
              interval="preserveStartEnd"
              minTickGap={12}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 13, fill: "var(--muted)" }}
              tickFormatter={(label) => {
                const point = data.find((item) => item.label === label);
                return `${String(label)}${point?.coverage?.status === "Partial" ? "*" : ""}`;
              }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 13, fill: "var(--muted)" }}
              tickFormatter={(v) => {
                const n = Number(v) / factor;
                return Math.abs(n) >= 1000
                  ? `${+(n / 1000).toFixed(1)}k`
                  : String(Math.round(n));
              }}
            />
            <Tooltip
              filterNull={false}
              content={({ active, label }) => {
                const point = displayed.find((item) => item.label === label);
                if (!active || !point) return null;
                return (
                  <div className="chart-tooltip">
                    <strong>
                      {point.label}
                      {point.coverage ? ` · ${point.coverage.status}` : ""}
                    </strong>
                    {missing(point) ? (
                      <p>
                        {point.coverage?.status === "Unverified"
                          ? "Unverified statements"
                          : "No statements"}
                      </p>
                    ) : property ? (
                      <p>Property net: {value(point.property, point)}</p>
                    ) : (
                      <>
                        <p>Income: {value(point.income, point)}</p>
                        <p>Spending: {value(point.expenses, point)}</p>
                        <p>Net: {value(point.net, point)}</p>
                      </>
                    )}
                    {point.coverage?.status === "Partial" && (
                      <small>
                        {point.coverage.hasUnverifiedStatements
                          ? "Includes statements with incomplete date or balance verification; comparisons are withheld."
                          : "From imported accounts only"}
                      </small>
                    )}
                  </div>
                );
              }}
            />
            <ReferenceLine
              y={0}
              stroke="var(--muted)"
              ifOverflow="extendDomain"
            />
            {property ? (
              <Line
                isAnimationActive={false}
                name="Property net"
                dataKey="property"
                stroke="var(--chart-income)"
                strokeWidth={2}
                dot={
                  data.filter((point) => point.property != null).length < 3
                    ? { r: 3 }
                    : false
                }
                connectNulls={false}
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
                  shape={(props) => <CashBar {...props} series="income" />}
                />
                <Bar
                  isAnimationActive={false}
                  name="Expenses"
                  dataKey="expenses"
                  fill="var(--chart-expense)"
                  radius={[0, 0, 3, 3]}
                  maxBarSize={16}
                  shape={(props) => <CashBar {...props} series="expenses" />}
                />
                <Line
                  isAnimationActive={false}
                  name="Net cash flow"
                  dataKey="net"
                  stroke="var(--chart-net)"
                  strokeWidth={2}
                  dot={
                    data.filter((point) => point.net !== null).length < 3
                      ? { r: 3 }
                      : false
                  }
                  connectNulls={false}
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
              Spending
            </span>
            <span>
              <i className="net-key" />
              Net cash flow
            </span>
          </>
        )}
      </div>
      {data.some((point) => point.coverage) && (
        <>
          <div
            className="chart-coverage"
            aria-label="Monthly statement coverage"
          >
            {data.map((point, index) =>
              missing(point) ? (
                <button
                  className="chart-month-gap"
                  key={index}
                  aria-label={`${point.label}: ${point.coverage?.status === "Unverified" ? "Unverified statements" : "No statements"}`}
                  onClick={() =>
                    setSelectedGap(
                      `${point.label}: ${point.coverage?.status === "Unverified" ? "Unverified statements" : "No statements"}`,
                    )
                  }
                >
                  {point.label}
                </button>
              ) : (
                <span
                  key={index}
                  className={
                    point.coverage?.status === "Partial"
                      ? "chart-month-partial"
                      : ""
                  }
                >
                  {point.label}
                  {point.coverage?.status === "Partial" ? "*" : ""}
                </span>
              ),
            )}
          </div>
          {selectedGap && (
            <p className="chart-coverage-note" role="status">
              {selectedGap}
            </p>
          )}
          {data.some((point) => point.coverage?.status === "Partial") && (
            <p className="chart-coverage-note">
              * Partial month · from imported accounts only.
            </p>
          )}
          {data.some((point) => point.coverage?.hasUnverifiedStatements) && (
            <p className="chart-coverage-note">
              Statements with incomplete date or balance verification are
              included in partial months. Comparisons need verified dates and
              balances.
            </p>
          )}
        </>
      )}
      {showValues && (
        <details className="chart-data">
          <summary>View chart values</summary>
          <table>
            <thead>
              <tr>
                <th>Month</th>
                {data.some((point) => point.coverage) && <th>Coverage</th>}
                <th>{property ? "Property net" : "Income"}</th>
                {!property && (
                  <>
                    <th>Spending</th>
                    <th>Net</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={i}>
                  <th>{d.label}</th>
                  {data.some((point) => point.coverage) && (
                    <td>
                      {d.coverage?.status ?? "—"}
                      {d.coverage?.hasUnverifiedStatements &&
                        d.coverage.status === "Partial" &&
                        " · verification incomplete"}
                    </td>
                  )}
                  <td>{value(property ? d.property : d.income, d)}</td>
                  {!property && (
                    <>
                      <td>
                        {value(
                          d.expenses === null ? null : -Math.abs(d.expenses),
                          d,
                        )}
                      </td>
                      <td>{value(d.net, d)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
