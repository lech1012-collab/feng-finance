import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Bar,
  BarChart,
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
import { money, currencyPrecision } from "../domain/money";
import { saveReport } from "../storage/views";
import { auditedMutation, undoChange } from "../storage/audit";
import { ConditionEditor } from "./ConditionEditor";
import { filterTransactions } from "../domain/query";
import { displayDate } from "../domain/presentation";
import "./v2-rules.css";

const blank: Omit<SavedReport, "id"> = {
  name: "",
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
  const reports = useLiveQuery(() => db.savedReports.toArray(), [], []);
  const taxEnabled = useLiveQuery(
    async () =>
      (await db.settings.get("property-tax-report"))?.value === "true",
    [],
    false,
  );
  const [report, setReport] = useState<SavedReport>({ id: id(), ...blank });
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
      : `${row?.converted ? "≈" : ""}${money(value, currency)}`;
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
  return (
    <section className="card" id="report-builder">
      <h2>Reports</h2>
      <p className="muted">
        Explore your spending, income and projects. Transfers stay outside
        financial totals.
      </p>
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
            {["category", "tag", "account", "merchant", "month"].map((v) => (
              <option key={v} value={v}>
                {v[0].toUpperCase() + v.slice(1)}
              </option>
            ))}
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
        <label>
          Display
          <select
            value={report.chart}
            onChange={(e) =>
              setReport({
                ...report,
                chart: e.target.value as SavedReport["chart"],
              })
            }
          >
            <option value="table">Table</option>
            <option value="bar">Bar chart</option>
            <option value="line">Line chart</option>
          </select>
        </label>
      </div>
      <div className="v2-inline-form">
        <label>
          UK tax year
          <select
            defaultValue=""
            onChange={(e) =>
              e.target.value && selectPeriod(Number(e.target.value))
            }
          >
            <option value="">Choose tax year</option>
            {[taxYear - 2, taxYear - 1, taxYear, taxYear + 1].map((y) => (
              <option key={y} value={y}>
                {ukTaxYear(y).label}
              </option>
            ))}
          </select>
        </label>
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
      {report.chart !== "table" && rows.length > 0 && (
        <div
          className="v2-report-chart"
          role="img"
          aria-label={`${report.groupBy} ${report.measure} chart, with values listed in the table below`}
        >
          <ResponsiveContainer width="100%" height="100%">
            {report.chart === "bar" ? (
              <BarChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis
                  tickFormatter={(v) =>
                    report.measure === "count"
                      ? String(v)
                      : String(v / 10 ** currencyPrecision(currency))
                  }
                />
                <Tooltip
                  formatter={(v, _name, item) =>
                    format(Number(v), item.payload as ReportRow)
                  }
                />
                <Bar dataKey="value" name={report.measure} fill="#8FB0FF" />
              </BarChart>
            ) : (
              <LineChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis
                  tickFormatter={(v) =>
                    report.measure === "count"
                      ? String(v)
                      : String(v / 10 ** currencyPrecision(currency))
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
                  stroke="#E7C46A"
                  strokeWidth={2}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
      <table className="v2-report-table">
        <caption className="sr-only">{report.name || "Current report"}</caption>
        <thead>
          <tr>
            <th scope="col">
              {report.groupBy[0].toUpperCase() + report.groupBy.slice(1)}
            </th>
            <th scope="col">Count</th>
            <th scope="col">
              {report.measure === "count" ? "Count" : "Amount"}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">
                <Link to={sourcePath(row)}>{row.label}</Link>
              </th>
              <td>{row.count}</td>
              <td
                title={
                  row.converted
                    ? `Converted from ${row.originalCurrencies.join(", ")}. Rates dated ${row.conversionDates.map(displayDate).join(", ")}.`
                    : undefined
                }
              >
                <Link to={sourcePath(row)}>{format(row.value, row)}</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <p className="muted">No transactions match this report.</p>
      )}
      {report.groupBy === "tag" && (
        <p className="muted">
          A transaction with several tags appears in each tag. Tag totals
          overlap.
        </p>
      )}
      <div className="v2-inline-form">
        <label>
          Report name
          <input
            value={report.name}
            maxLength={100}
            onChange={(e) => setReport({ ...report, name: e.target.value })}
          />
        </label>
        <button
          disabled={!report.name.trim()}
          onClick={async () => {
            try {
              const saved = await saveReport(report);
              setChangeId(saved.changeId);
              setMessage("Report saved and pinned to Analyse.");
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Report could not be saved.",
              );
            }
          }}
        >
          Save report
        </button>
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
                  onClick={async () => {
                    const saved = await saveReport({ ...r, pinned: !r.pinned });
                    setChangeId(saved.changeId);
                    setMessage(
                      r.pinned ? "Report unpinned." : "Report pinned.",
                    );
                  }}
                >
                  {r.pinned ? "Unpin" : "Pin"}
                </button>
                <button
                  onClick={async () => {
                    const saved = await auditedMutation(
                      "Delete saved report",
                      ["savedReports"],
                      async () => db.savedReports.delete(r.id),
                    );
                    setChangeId(saved.changeId);
                    setMessage("Report deleted.");
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </details>
      )}
      {taxEnabled && (
        <section>
          <h3>Property income for Self Assessment</h3>
          <p className="muted">
            Not tax advice. Choose which expense categories are allowable for
            your situation.
          </p>
          <label>
            Tax year
            <select
              value={taxYear}
              onChange={(e) => setTaxYear(Number(e.target.value))}
            >
              {[
                new Date().getFullYear() - 3,
                new Date().getFullYear() - 2,
                new Date().getFullYear() - 1,
                new Date().getFullYear(),
              ].map((y) => (
                <option key={y} value={y}>
                  {ukTaxYear(y).label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="tag-picker">
            <legend>Allowable expense categories</legend>
            {categories
              .filter((c) => c.kind === "expense" && !c.archived && !c.parentId)
              .map((c) => (
                <label className="tag-option" key={c.id}>
                  <input
                    type="checkbox"
                    checked={allowable.includes(c.id)}
                    onChange={(e) =>
                      setAllowable(
                        e.target.checked
                          ? [...allowable, c.id]
                          : allowable.filter((id) => id !== c.id),
                      )
                    }
                  />
                  {c.name}
                </label>
              ))}
          </fieldset>
          <dl>
            <div>
              <dt>Rental income</dt>
              <dd>{money(tax.income, currency)}</dd>
            </div>
            <div>
              <dt>Selected expenses</dt>
              <dd>{money(tax.expenses, currency)}</dd>
            </div>
            <div>
              <dt>Net property income</dt>
              <dd>{money(tax.net, currency)}</dd>
            </div>
          </dl>
          <button
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
        </section>
      )}
      {message && (
        <p className="notice" role="status">
          {message}{" "}
          {changeId && (
            <button
              onClick={async () => {
                try {
                  await undoChange(changeId);
                  setMessage("Report change undone.");
                  setChangeId("");
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "Undo is unavailable.",
                  );
                }
              }}
            >
              Undo
            </button>
          )}
        </p>
      )}
      {error && (
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
