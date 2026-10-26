import { chartTickFontSize, useRootFontSize } from "./useRootFontSize";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { useEffect, useId, useState, type ReactNode } from "react";
import { compactMoney, money } from "../domain/money";
import { monthLabel } from "../domain/dates";
import {
  ChartInspector,
  ChartSelectionMarker,
  type ChartReading,
} from "./ChartInspector";
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
  selectedLabel,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: { opacity?: number; label?: string };
  series: "income" | "expenses";
  selectedLabel?: string;
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
      data-selected={payload?.label === selectedLabel}
      x={width < 0 ? x + width : x}
      y={height < 0 ? y + height : y}
      width={Math.abs(width)}
      height={Math.abs(height)}
      fill={
        series === "income" ? "var(--chart-income)" : "var(--chart-expense)"
      }
      rx={3}
      opacity={payload?.opacity ?? 1}
      stroke={payload?.label === selectedLabel ? "var(--ink)" : "none"}
      strokeWidth={1.5}
    />
  );
}

export function CashChart({
  data,
  currency,
  property = false,
  showValues = true,
  helpContent,
}: {
  data: CashChartPoint[];
  currency: string;
  property?: boolean;
  showValues?: boolean;
  helpContent?: ReactNode;
}) {
  const chartRem = useRootFontSize();
  // Safari can retain an off-screen ResponsiveContainer's previous width after
  // rotation/resizing. Remount its measurement on viewport changes so an old
  // SVG width cannot widen Home before the chart is scrolled into view.
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const hatchId = `missing-${useId().replaceAll(":", "")}`;
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
  const readings: ChartReading[] = displayed.map((point) => ({
    key: point.month ?? point.label,
    x: point.label,
    label: point.month
      ? monthLabel(point.month)
      : point.label.replace("Sept", "Sep"),
    status: point.coverage?.status,
    values: property
      ? [
          {
            label: "Property net",
            text: value(point.property, point),
            raw: point.property,
            color: "var(--chart-income)",
          },
        ]
      : [
          {
            label: "Income",
            text: value(point.income, point),
            raw: point.income,
            mark: false,
            color: "var(--chart-income)",
          },
          {
            label: "Spending",
            text: value(point.expenses, point),
            raw: point.expenses,
            mark: false,
            color: "var(--chart-expense)",
          },
          {
            label: "Net",
            text: value(point.net, point),
            raw: point.net,
            color: "var(--chart-net)",
          },
        ],
  }));
  return (
    <div className="chart">
      <ChartInspector
        readings={readings}
        label={property ? "Property cash flow" : "Cash flow"}
        help={{
          title: property
            ? "Property cash flow chart explained"
            : "Cash flow chart explained",
          content: (reading) => (
            <>
              <p>
                {reading.label}: {reading.status ?? "Coverage unavailable"}.
              </p>
              <p>
                {property
                  ? "The line shows monthly net property cash flow."
                  : "Bars show income and spending; the line shows net cash flow."}{" "}
                Transfers are excluded. Gaps indicate missing or unverified
                statement coverage rather than zero amounts.
              </p>
              {data.some((point) => point.coverage?.status === "Partial") && (
                <p>* Partial month · from imported accounts only.</p>
              )}
              {data.some(
                (point) => point.coverage?.hasUnverifiedStatements,
              ) && (
                <p>
                  Statements with incomplete date or balance verification are
                  included in partial months. Comparisons need verified dates
                  and balances.
                </p>
              )}
              {helpContent}

              <p>
                Tap or drag horizontally to select a month. The values stay
                above the chart; the vertical line marks your selection. Swipe
                vertically to scroll.
              </p>
            </>
          ),
        }}
      >
        {(selectedIndex) => (
          <div
            role="img"
            aria-label={
              property
                ? "Monthly property net cash flow chart"
                : "Monthly income, expense and net cash flow chart"
            }
          >
            <ResponsiveContainer key={viewportWidth} width="100%" height={210}>
              <ComposedChart
                data={displayed}
                accessibilityLayer={false}
                margin={{ top: 12, right: 8, left: 0, bottom: 0 }}
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
                        Math.min(
                          44,
                          Math.max(12, 240 / Math.max(data.length, 1)),
                        );
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
                  tick={{
                    fontSize: chartTickFontSize(chartRem),
                    fill: "var(--muted)",
                  }}
                  tickFormatter={(label) => {
                    const point = data.find((item) => item.label === label);
                    const short = String(label)
                      .replace(/\bSept\b/g, "Sep")
                      .replace(/^([A-Za-z]{3})[a-z]+/, "$1");
                    return `${short}${point?.coverage?.status === "Partial" ? "*" : ""}`;
                  }}
                />
                <YAxis
                  width={Math.max(60, Math.round(chartRem * 3.75))}
                  tickLine={false}
                  axisLine={false}
                  tick={{
                    fontSize: chartTickFontSize(chartRem),
                    fill: "var(--muted)",
                  }}
                  tickFormatter={(v) => {
                    return compactMoney(Number(v), currency);
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
                      shape={(props) => (
                        <CashBar
                          {...props}
                          series="income"
                          selectedLabel={displayed[selectedIndex]?.label}
                        />
                      )}
                    />
                    <Bar
                      isAnimationActive={false}
                      name="Expenses"
                      dataKey="expenses"
                      fill="var(--chart-expense)"
                      radius={[0, 0, 3, 3]}
                      maxBarSize={16}
                      shape={(props) => (
                        <CashBar
                          {...props}
                          series="expenses"
                          selectedLabel={displayed[selectedIndex]?.label}
                        />
                      )}
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
                <ChartSelectionMarker
                  readings={readings}
                  index={selectedIndex}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartInspector>
      <div className="chart-legend">
        {property ? (
          <span>Property net cash flow</span>
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
      {showValues && (
        <details className="chart-data">
          <summary>View chart values</summary>
          <div
            className="table-scroll"
            role="region"
            aria-label="Cash flow values"
            tabIndex={0}
          >
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
                        {d.coverage?.status ?? "Unavailable"}
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
          </div>
        </details>
      )}
    </div>
  );
}
