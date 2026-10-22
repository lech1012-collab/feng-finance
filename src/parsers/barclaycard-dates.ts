import type { TextRow } from "../domain/models";
import { parseDate } from "../domain/dates";

export const BARCLAYCARD_COVERAGE_NOTICE =
  "This Barclaycard statement prints an issue date but no period start. The displayed dates show coverage from the earliest extracted transaction to the issue date. Check this coverage against the PDF before importing.";

const dateText =
  "(?:\\d{1,2}\\s+[A-Za-z]{3,9}\\s+\\d{4}|\\d{1,2}[/.]\\d{1,2}[/.]\\d{4}|\\d{4}-\\d{2}-\\d{2})";
const issueLabel = "(?:issued\\s+on|statement(?:\\s+issue)?\\s+date)";
const printedIssue = new RegExp(
  `\\b${issueLabel}\\s*:?\\s*(${dateText})\\b`,
  "gi",
);
const splitLabel = new RegExp(`\\b${issueLabel}\\s*:?\\s*$`, "i");
const wholeDate = new RegExp(`^${dateText}$`, "i");

/** An explicitly labelled issue date, never a due date or an unlabelled header date. */
export function barclaycardIssueDate(rows: TextRow[]): string | undefined {
  const firstPage = Math.min(...rows.map((row) => row.page));
  const ordered = [...rows].sort((a, b) => a.page - b.page || a.y - b.y);
  const dates = new Set<string>();
  let invalid = false;
  const add = (raw: string) => {
    try {
      dates.add(parseDate(raw));
    } catch {
      invalid = true;
    }
  };
  for (let index = 0; index < ordered.length; index++) {
    const row = ordered[index];
    const text = row.text.normalize("NFKC").replace(/\s+/g, " ").trim();
    // Other pages may repeat the same issued-on footer. Transaction and legal
    // text elsewhere on those pages cannot supply a statement issue date.
    if (row.page !== firstPage && !/^Page\s+\d+\s+of\s+\d+\b/i.test(text))
      continue;
    for (const match of text.matchAll(printedIssue)) add(match[1]);
    const next = ordered[index + 1];
    if (
      splitLabel.test(text) &&
      next?.page === row.page &&
      next.y - row.y <= 24 &&
      wholeDate.test(next.text.trim())
    )
      add(next.text.trim());
  }
  return !invalid && dates.size === 1 ? [...dates][0] : undefined;
}
