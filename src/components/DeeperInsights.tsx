import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import type {
  Account,
  Category,
  Statement,
  Transaction,
} from "../domain/models";
import { db } from "../storage/database";
import { deeperInsights } from "../analytics/deeper";
import { localToday } from "../analytics/reminders";
import { monthCoverage, verifiedStatements } from "../analytics/coverage";
import { monthLabel } from "../domain/dates";
export function DeeperInsights({
  transactions,
  accounts,
  statements,
  categories,
  month,
  currency,
  compact = false,
  months,
}: {
  transactions: Transaction[];
  accounts: Account[];
  statements: Statement[];
  categories: Category[];
  month: string;
  currency: string;
  compact?: boolean;
  months?: string[];
}) {
  const settings = useLiveQuery(() =>
    db.settings.where("key").startsWith("subscription:").toArray(),
  );
  if (!transactions.length || months?.length === 0) return null;
  const today = localToday();
  const documents = verifiedStatements(statements, transactions, today);
  const selected = months ?? [month];
  const results = selected.map((selectedMonth) => ({
    month: selectedMonth,
    ...deeperInsights(
      transactions,
      accounts,
      documents,
      categories,
      settings ?? [],
      selectedMonth,
      currency,
      today,
      (m) =>
        monthCoverage(accounts, statements, transactions, m, currency, today)
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
    return (
      <p className="insight-empty muted">
        {result.complete && result.baselineCount >= 3
          ? "No significant changes in the selected period."
          : `Comparisons start after 3 verified previous months · ${Math.min(result.baselineCount, 3)} of 3${!result.complete ? " · selected month incomplete" : ""}`}
      </p>
    );
  }
  return (
    <section className="card deeper-insights">
      <div className="section-heading">
        <h2>What changed?</h2>
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
          Payment checks shown; monthly comparisons need complete coverage and 3
          verified previous months ({Math.min(result.baselineCount, 3)} of 3).
        </p>
      )}
    </section>
  );
}
