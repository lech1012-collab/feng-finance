import { useState } from "react";
import { Link } from "react-router-dom";
import type { Category, Tag, Transaction } from "../domain/models";
import { tagSummary } from "../storage/tags";
import { money } from "../domain/money";
import { displayDateRange } from "../domain/presentation";

export function TagAnalysis({
  transactions,
  categories,
  tags,
  currency,
}: {
  transactions: Transaction[];
  categories: Category[];
  tags: Tag[];
  currency: string;
}) {
  const [tagId, setTagId] = useState("");
  const summary = tagSummary(transactions, tagId, currency);
  const sourcePath = (categoryId?: string) => {
    const conditions = [
      { field: "tag", operator: "equals", value: tagId },
      ...(categoryId
        ? [
            {
              field: "categoryId",
              operator: "equals",
              value: categoryId === "uncategorized" ? "" : categoryId,
            },
          ]
        : []),
    ];
    return `/transactions?allDates=1&advanced=1&reporting=1&conditions=${encodeURIComponent(JSON.stringify(conditions))}`;
  };
  return (
    <section className="card" aria-label="Analyse a tag">
      <h2>Trips and projects</h2>
      <label>
        Tag
        <select value={tagId} onChange={(e) => setTagId(e.target.value)}>
          <option value="">Choose a tag</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.archived ? " (archived)" : ""}
            </option>
          ))}
        </select>
      </label>
      {tagId && (
        <>
          <div className="metric">
            <span>Net tagged amount</span>
            <strong>
              <Link to={sourcePath()}>
                {summary.converted ? "≈" : ""}
                {money(summary.total, currency)}
              </Link>
            </strong>
          </div>
          <p className="muted">
            {summary.count}{" "}
            {summary.count === 1 ? "transaction" : "transactions"}
            {summary.from && summary.to
              ? ` · ${displayDateRange(summary.from, summary.to)}`
              : ""}
          </p>
          <table className="v2-report-table">
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(summary.categories)
                .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                .map(([id, amount]) => (
                  <tr key={id}>
                    <th scope="row">
                      {categories.find((c) => c.id === id)?.name ??
                        "Uncategorised"}
                    </th>
                    <td>
                      <Link to={sourcePath(id)}>{money(amount, currency)}</Link>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!summary.count && (
            <p className="muted">
              No transactions with this tag in the selected range.
            </p>
          )}
        </>
      )}
    </section>
  );
}
