import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import type {
  Account,
  Category,
  Statement,
  Transaction,
  FxRate,
  Setting,
  TransferProposal,
} from "../domain/models";
import { db } from "../storage/database";
import { deeperInsights } from "../analytics/deeper";
import { localToday } from "../analytics/reminders";
import { monthCoverage, verifiedStatements } from "../analytics/coverage";
import { monthLabel } from "../domain/dates";
import { reportingCoverage } from "../analytics/reporting";
import { ContextHelp } from "./ContextHelp";
export function DeeperInsights({
  transactions,
  accounts,
  statements,
  categories,
  month,
  currency,
  compact = false,
  months,
  rawTransactions,
  reportingSettings,
  rates = [],
  proposals = [],
}: {
  transactions: Transaction[];
  accounts: Account[];
  statements: Statement[];
  categories: Category[];
  month: string;
  currency: string;
  compact?: boolean;
  months?: string[];
  rawTransactions?: Transaction[];
  reportingSettings?: Setting[];
  rates?: FxRate[];
  proposals?: TransferProposal[];
}) {
  const settings = useLiveQuery(() => db.settings.toArray());
  if (!transactions.length || months?.length === 0) return null;
  const today = localToday();
  const ledger = rawTransactions ?? transactions;
  const preferences = reportingSettings ?? settings ?? [];
  const documents = verifiedStatements(statements, ledger, today);
  const selected = months ?? [month];
  const results = selected.map((selectedMonth) => ({
    month: selectedMonth,
    ...deeperInsights(
      transactions,
      accounts,
      documents,
      categories,
      preferences,
      selectedMonth,
      currency,
      today,
      (m) =>
        rawTransactions
          ? reportingCoverage(
              accounts,
              statements,
              ledger,
              m,
              currency,
              rates,
              preferences,
              proposals,
              today,
            ).complete
          : monthCoverage(accounts, statements, ledger, m, currency, today)
              .complete,
    ),
  }));
  const result = results.at(-1)!;
  const seen = new Set<string>();
  const items = results
    .flatMap((monthly) =>
      monthly.items.map((insight) => ({ ...insight, month: monthly.month })),
    )
    .filter((insight) => {
      const key = [
        "spending-drivers",
        "income-fall",
        "unusual-spending",
      ].includes(insight.id)
        ? `${insight.month}:${insight.id}`
        : insight.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.priority - a.priority || b.month.localeCompare(a.month));
  if (!items.length) {
    if (compact) return null;
    if (result.complete && result.baselineCount >= 3)
      return (
        <p className="insight-empty muted">
          No significant changes in the selected period.
        </p>
      );
    return (
      <div className="insight-empty muted context-help-heading">
        <span>
          Comparisons pending · {Math.min(result.baselineCount, 3)} of 3
          verified months
          {!result.complete ? " · selected month incomplete" : ""}
        </span>
        <ContextHelp
          title="Insight comparisons explained"
          label="Insight comparisons explained"
        >
          <p>
            {`Comparisons start after 3 verified previous months · ${Math.min(result.baselineCount, 3)} of 3${!result.complete ? " · selected month incomplete" : ""}`}
          </p>
        </ContextHelp>
      </div>
    );
  }
  return (
    <section className="card deeper-insights">
      <div className="section-heading">
        <div className="context-help-heading">
          <h2>What changed?</h2>
          <ContextHelp
            title="Insight comparisons explained"
            label="Insight comparisons explained"
          >
            <p>
              Monthly comparisons need complete coverage and 3 verified previous
              months. Payment checks can appear before that history is complete.
            </p>
            {(!result.complete || result.baselineCount < 3) && (
              <p>
                Payment checks shown; monthly comparisons need complete coverage
                and 3 verified previous months (
                {Math.min(result.baselineCount, 3)} of 3).
              </p>
            )}
          </ContextHelp>
        </div>
        {compact && <Link to="/analysis">Analyse</Link>}
      </div>
      {items.slice(0, compact ? 3 : 10).map((insight) => (
        <Link
          className="financial-insight"
          key={`${insight.month}:${insight.id}`}
          to={insight.href}
        >
          <strong>
            {selected.length > 1 ? `${monthLabel(insight.month)} · ` : ""}
            {insight.title}
          </strong>
          <span>{insight.detail}</span>
        </Link>
      ))}
      {(!result.complete || result.baselineCount < 3) && (
        <p className="coverage-note">
          {Math.min(result.baselineCount, 3)} of 3 verified previous months
          {!result.complete ? " · selected month incomplete" : ""}
        </p>
      )}
    </section>
  );
}
