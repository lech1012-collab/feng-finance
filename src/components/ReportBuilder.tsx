import { chartTickFontSize, useRootFontSize } from "./useRootFontSize";
import { Sheet } from "./Sheet";
import { Toast } from "./Toast";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronRight } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  Account,
  Category,
  RuleCondition,
  SavedReport,
  Setting,
  Tag,
  Transaction,
} from "../domain/models";
import { db } from "../storage/database";
import {
  propertyTaxSummary,
  reportRows,
  transactionsCsv,
  ukTaxYear,
  reportGroupCondition,
  type ReportRow,
} from "../analytics/reports";
import { id } from "../domain/normalize";
import { compactMoney, money } from "../domain/money";
import { saveReport } from "../storage/views";
import { auditedMutation, undoChange } from "../storage/audit";
import { ConditionEditor } from "./ConditionEditor";
import { filterTransactions } from "../domain/query";
import { displayDate } from "../domain/presentation";
import { formatDateRange } from "../domain/dates";
import {
  CheckboxRow,
  EmptyState,
  KeyValueRow,
  SectionCard,
  SegmentedControl,
  WarningBox,
} from "./UIPrimitives";
import "./v2-rules.css";
import "./report-builder.css";

const blank: Omit<SavedReport, "id"> = {
  name: "Cash flow by category",
  groupBy: "category",
  measure: "sum",
  chart: "table",
  conditions: [],
  pinned: true,
};
export function ReportBuilder({
  transactions,
  rawTransactions = transactions,
  accounts,
  categories,
  tags = [],
  currency,
  settings = [],
}: {
  transactions: Transaction[];
  rawTransactions?: Transaction[];
  accounts: Account[];
  categories: Category[];
  tags?: Tag[];
  currency: string;
  settings?: Setting[];
}) {
  const chartRem = useRootFontSize();
  const reports = useLiveQuery(() => db.savedReports.toArray(), [], []);
  const taxEnabled = useLiveQuery(
    async () =>
      (await db.settings.get("property-tax-report"))?.value === "true",
    [],
    false,
  );
  const [report, setReport] = useState<SavedReport>({ id: id(), ...blank });
  const [editing, setEditing] = useState(false);
  const [allowableEditing, setAllowableEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showConditions, setShowConditions] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [changeId, setChangeId] = useState("");
  const [taxYear, setTaxYear] = useState(new Date().getFullYear() - 1);
  const [allowable, setAllowable] = useState<string[]>(["property"]);
  const rows = useMemo(
    () =>
      reportRows(transactions, report, currency, categories, accounts, tags, {
        settings,
        periodRows: rawTransactions,
      }),
    [
      transactions,
      JSON.stringify(report),
      currency,
      categories,
      accounts,
      tags,
      settings,
      rawTransactions,
    ],
  );
  const tax = useMemo(
    () => propertyTaxSummary(transactions, taxYear, allowable, currency),
    [transactions, taxYear, allowable, currency],
  );
  const selectPeriod = (year: number) => {
    const period = ukTaxYear(year);
    const condition: RuleCondition = {
      field: "date",
      operator: "between",
      value: period.from,
      valueTo: period.to,
    };
    setReport({
      ...report,
      conditions: [
        ...report.conditions.filter((c) => c.field !== "date"),
        condition,
      ],
    });
  };
  const format = (value: number, row?: ReportRow) =>
    report.measure === "count"
      ? String(value)
      : money(value, currency, false, !!row?.converted);
  const sourcePath = (row: ReportRow) => {
    const group = reportGroupCondition(
      row,
      report.groupBy,
      settings,
      rawTransactions,
    );
    const conditions = [...report.conditions, group];
    return `/transactions?allDates=1&advanced=1&reporting=1&conditions=${encodeURIComponent(JSON.stringify(conditions))}`;
  };
  const download = (csv: string, name: string) => {
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const nativeRows = (ids: Set<string>) =>
    rawTransactions.filter((t) => ids.has(t.id));
  const visibleRows = rows.filter(
    (row) => report.measure === "count" || row.value !== 0,
  );
  const reportTaxYears = [taxYear - 2, taxYear - 1, taxYear, taxYear + 1];
  const selectedReportYear =
    reportTaxYears.find((year) => {
      const period = ukTaxYear(year);
      return report.conditions.some(
        (condition) =>
          condition.field === "date" &&
          condition.operator === "between" &&
          condition.value === period.from &&
          condition.valueTo === period.to,
      );
    }) ?? "";
  const change = async (
    operation: () => Promise<{ changeId: string }>,
    notice: string,
  ) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await operation();
      setChangeId(result.changeId);
      setMessage(notice);
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The report could not be changed. Your transactions are unchanged.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SectionCard
        id="report-builder"
        title="Reports"
        description="Transfers excluded."
      >
        {!!reports.length && (
          <div className="v2-row-actions" aria-label="Saved analysis reports">
            {reports
              .filter((r) => r.pinned)
              .map((r) => (
                <button key={r.id} onClick={() => setReport(r)}>
                  {r.name}
                </button>
              ))}
          </div>
        )}
        {editing && (
          <Sheet
            title="Edit report"
            onClose={() => setEditing(false)}
            footer={
              <>
                <button disabled={busy} onClick={() => setEditing(false)}>
                  View report
                </button>
                <button
                  className="primary"
                  disabled={busy || !report.name.trim()}
                  onClick={async () => {
                    if (
                      await change(
                        () => saveReport(report),
                        "Report saved and pinned to Analyse.",
                      )
                    )
                      setEditing(false);
                  }}
                >
                  Save report
                </button>
              </>
            }
          >
            <label>
              Report name
              <input
                value={report.name}
                maxLength={100}
                onChange={(e) => setReport({ ...report, name: e.target.value })}
              />
            </label>
            {!report.name.trim() && (
              <p className="muted">Give this report a name before saving.</p>
            )}
            <div className="v2-inline-form">
              <label>
                Group by
                <select
                  value={report.groupBy}
                  onChange={(e) =>
                    setReport({
                      ...report,
                      groupBy: e.target.value as SavedReport["groupBy"],
                    })
                  }
                >
                  {["category", "tag", "account", "merchant", "month"].map(
                    (v) => (
                      <option key={v} value={v}>
                        {v[0].toUpperCase() + v.slice(1)}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Measure
                <select
                  value={report.measure}
                  onChange={(e) =>
                    setReport({
                      ...report,
                      measure: e.target.value as SavedReport["measure"],
                    })
                  }
                >
                  <option value="sum">Net amount</option>
                  <option value="count">Transaction count</option>
                  <option value="average">Average amount</option>
                </select>
              </label>
            </div>
            <div className="v2-inline-form">
              <div className="report-tax-years">
                <p>UK tax year</p>
                <SegmentedControl
                  label="UK tax year"
                  value={selectedReportYear}
                  options={reportTaxYears.map((year) => ({
                    value: year,
                    label: ukTaxYear(year).label,
                  }))}
                  onChange={(year) => selectPeriod(Number(year))}
                />
              </div>
              <button
                aria-expanded={showConditions}
                onClick={() => setShowConditions(!showConditions)}
              >
                {showConditions ? "Hide filters" : "Filter report"}
              </button>
            </div>
            {showConditions && (
              <ConditionEditor
                conditions={report.conditions}
                onChange={(conditions) => setReport({ ...report, conditions })}
                categories={categories}
                accounts={accounts}
                tags={tags}
                currency={currency}
                maxConditions={19}
              />
            )}
            {error && (
              <div role="alert">
                <WarningBox
                  title="Report could not be saved"
                  severity="warning"
                >
                  {error}
                </WarningBox>
              </div>
            )}
          </Sheet>
        )}
        {report.chart === "bar" && visibleRows.length > 0 && (
          <div
            className="report-horizontal-bars"
            role="group"
            aria-label={`${report.groupBy} ${report.measure} horizontal bar chart; full values below`}
          >
            {visibleRows.map((row) => (
              <Link
                className="report-bar-object"
                to={sourcePath(row)}
                key={row.key}
              >
                <span>
                  {row.label === "Uncategorized" ? "Uncategorised" : row.label}
                </span>{" "}
                <strong>{format(row.value, row)}</strong>
                <span className="report-bar-track" aria-hidden="true">
                  <span
                    style={{
                      width: `${(Math.abs(row.value) / Math.max(1, ...rows.map((value) => Math.abs(value.value)))) * 100}%`,
                      background:
                        row.value < 0
                          ? "var(--chart-expense)"
                          : "var(--chart-income)",
                    }}
                  />
                </span>
              </Link>
            ))}
          </div>
        )}
        {report.chart === "line" && visibleRows.length > 0 && (
          <div
            className="v2-report-chart"
            role="img"
            aria-label={`${report.groupBy} ${report.measure} chart, full values below`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: chartTickFontSize(chartRem) }}
                  tickFormatter={(label: string) =>
                    report.groupBy === "month" ? label.slice(0, 3) : label
                  }
                />
                <YAxis
                  width={Math.max(60, Math.round(chartRem * 3.75))}
                  tick={{ fontSize: chartTickFontSize(chartRem) }}
                  tickFormatter={(v) =>
                    report.measure === "count"
                      ? String(v)
                      : compactMoney(Number(v), currency)
                  }
                />
                <Tooltip
                  formatter={(v, _name, item) =>
                    format(Number(v), item.payload as ReportRow)
                  }
                />
                <Line
                  dataKey="value"
                  name={report.measure}
                  stroke="var(--chart-net)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {!!visibleRows.length && (
          <div
            className="chart-table-wrap table-scroll"
            role="region"
            aria-label="Report values"
            tabIndex={0}
          >
            <table className="v2-report-table">
              <caption className="sr-only">
                {report.name || "Current report"}
              </caption>
              <thead>
                <tr>
                  <th scope="col">
                    {report.groupBy[0].toUpperCase() + report.groupBy.slice(1)}
                  </th>
                  {report.measure !== "count" && <th scope="col">Count</th>}
                  <th scope="col">
                    {report.measure === "count" ? "Count" : "Amount"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">
                      <Link to={sourcePath(row)}>
                        {row.label === "Uncategorized"
                          ? "Uncategorised"
                          : row.label}
                        <ChevronRight size={16} aria-hidden="true" />
                      </Link>
                    </th>
                    {report.measure !== "count" && <td>{row.count}</td>}
                    <td
                      title={
                        row.converted
                          ? `Converted from ${row.originalCurrencies.join(", ")}. Rates dated ${row.conversionDates.map(displayDate).join(", ")}.`
                          : undefined
                      }
                    >
                      <span className="amount">{format(row.value, row)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!visibleRows.length && (
          <EmptyState
            title={
              rows.length
                ? "No non-zero amounts match this report."
                : "No transactions match this report."
            }
          />
        )}
        {report.groupBy === "tag" && (
          <p className="muted">
            A transaction with several tags appears in each tag. Tag totals
            overlap.
          </p>
        )}
        <div className="report-controls">
          <button
            onClick={() => {
              setError("");
              setEditing(true);
            }}
          >
            Edit report
          </button>
          <SegmentedControl
            label="Report display"
            value={report.chart}
            options={(["table", "bar", "line"] as const).map((value) => ({
              value,
              label: value[0].toUpperCase() + value.slice(1),
            }))}
            onChange={(chart) => setReport({ ...report, chart })}
          />
        </div>
        <div className="v2-row-actions">
          <button
            onClick={() =>
              download(
                transactionsCsv(
                  nativeRows(
                    new Set(
                      filterTransactions(transactions, report.conditions).map(
                        (t) => t.id,
                      ),
                    ),
                  ),
                  accounts,
                  categories,
                  tags,
                ),
                "feng-finance-report-transactions.csv",
              )
            }
          >
            Export matching transactions
          </button>
        </div>
        {!!reports.length && (
          <details>
            <summary>Manage saved reports</summary>
            {reports.map((r) => (
              <div className="settings-row" key={r.id}>
                <span>{r.name}</span>
                <div className="v2-row-actions">
                  <button onClick={() => setReport(r)}>Open</button>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      await change(
                        () => saveReport({ ...r, pinned: !r.pinned }),
                        r.pinned ? "Report unpinned." : "Report pinned.",
                      );
                    }}
                  >
                    {r.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          "Delete this saved report? Your transactions stay unchanged. You can undo this change.",
                        )
                      )
                        return;
                      await change(
                        () =>
                          auditedMutation(
                            "Delete saved report",
                            ["savedReports"],
                            async () => db.savedReports.delete(r.id),
                          ),
                        "Report deleted.",
                      );
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </details>
        )}
      </SectionCard>
      {taxEnabled && (
        <SectionCard
          title="Property income for Self Assessment"
          className="property-tax-card"
          description="Not tax advice."
        >
          <p
            className="muted report-tax-period"
            title={formatDateRange(tax.from, tax.to)}
          >
            {tax.label} UK tax year
          </p>
          {tax.transactions.length ? (
            <div
              className="property-tax-summary"
              aria-label="Property tax summary"
            >
              <KeyValueRow
                label="Rental income"
                value={
                  <span className="amount">{money(tax.income, currency)}</span>
                }
              />
              <KeyValueRow
                label="Selected expenses"
                value={
                  <span className="amount">
                    {money(tax.expenses, currency)}
                  </span>
                }
              />
              <KeyValueRow
                className="report-net"
                label="Net property income"
                value={
                  <span className="amount">{money(tax.net, currency)}</span>
                }
              />
            </div>
          ) : (
            <EmptyState title="No transactions match this tax year." />
          )}
          <div className="report-tax-years">
            <SegmentedControl
              label="Tax year"
              value={taxYear}
              options={[
                new Date().getFullYear() - 3,
                new Date().getFullYear() - 2,
                new Date().getFullYear() - 1,
                new Date().getFullYear(),
              ].map((year) => ({ value: year, label: ukTaxYear(year).label }))}
              onChange={setTaxYear}
            />
          </div>
          <button onClick={() => setAllowableEditing(true)}>
            Choose allowable expenses
          </button>
          {allowableEditing && (
            <Sheet
              title="Allowable expense categories"
              onClose={() => setAllowableEditing(false)}
              footer={
                <button
                  className="primary"
                  onClick={() => setAllowableEditing(false)}
                >
                  View tax summary
                </button>
              }
            >
              <p className="muted">
                Choose allowable expenses for your situation.
              </p>
              <fieldset className="report-allowable-list">
                <legend>Allowable expense categories</legend>
                {categories
                  .filter(
                    (c) => c.kind === "expense" && !c.archived && !c.parentId,
                  )
                  .sort((a, b) =>
                    a.id === "property" ? -1 : b.id === "property" ? 1 : 0,
                  )
                  .map((c) => (
                    <CheckboxRow
                      key={c.id}
                      label={c.name}
                      checked={allowable.includes(c.id)}
                      onChange={(checked) =>
                        setAllowable(
                          checked
                            ? [...allowable, c.id]
                            : allowable.filter((id) => id !== c.id),
                        )
                      }
                    />
                  ))}
              </fieldset>
            </Sheet>
          )}
          <button
            disabled={!tax.transactions.length}
            onClick={() =>
              download(
                transactionsCsv(
                  nativeRows(new Set(tax.transactions.map((t) => t.id))),
                  accounts,
                  categories,
                  tags,
                ),
                `feng-property-tax-${tax.label.replace("/", "-")}.csv`,
              )
            }
          >
            Export property tax transactions
          </button>
        </SectionCard>
      )}
      {message && (
        <Toast
          id={changeId}
          message={message}
          undo={
            changeId
              ? async () => {
                  await undoChange(changeId);
                  setMessage("");
                  setChangeId("");
                }
              : undefined
          }
        />
      )}
      {error && !editing && (
        <div role="alert">
          <WarningBox title="Report could not be changed" severity="warning">
            {error}
          </WarningBox>
        </div>
      )}
    </>
  );
}
