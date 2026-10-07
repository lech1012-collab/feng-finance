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
export function DeeperInsights({
  transactions,
  accounts,
  statements,
  categories,
  month,
  currency,
  compact = false,
}: {
  transactions: Transaction[];
  accounts: Account[];
  statements: Statement[];
  categories: Category[];
  month: string;
  currency: string;
  compact?: boolean;
}) {
  const settings = useLiveQuery(() =>
    db.settings.where("key").startsWith("subscription:").toArray(),
  );
  if (!transactions.length) return null;
  const result = deeperInsights(
    transactions,
    accounts,
    statements,
    categories,
    settings ?? [],
    month,
    currency,
    localToday(),
  );
  if (compact && !result.items.length) return null;
  return (
    <section className="card deeper-insights">
      <div className="section-heading">
        <h2>What changed?</h2>
        {compact && <Link to="/analysis">Analyse</Link>}
      </div>
      {result.items.slice(0, compact ? 3 : 10).map((insight) => (
        <Link className="financial-insight" key={insight.id} to={insight.href}>
          <strong>{insight.title}</strong>
          <span>{insight.detail}</span>
        </Link>
      ))}
      {!result.items.length && (
        <p className="muted">
          {result.complete && result.baselineCount >= 3
            ? "No significant changes detected in the imported history."
            : "More verified history is needed for monthly comparisons."}
        </p>
      )}
      {(!result.complete || result.baselineCount < 3) && (
        <p className="coverage-note">
          Monthly change alerts need a complete selected month and at least
          three verified previous months. Individual payment and subscription
          checks can still appear.
        </p>
      )}
    </section>
  );
}
