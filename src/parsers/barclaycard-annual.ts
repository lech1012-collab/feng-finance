import type { TextRow } from "../domain/models";
import { parseMoney } from "../domain/money";
import { reconstructRows } from "../import/layout";
import { barclaycardIssueDate } from "./barclaycard-dates";
import { identifyPeriod, type StatementPeriod } from "./period";

/** A transient document preview, never an imported financial statement or balance. */
export interface AnnualStatementSummary {
  kind: "annual-summary";
  institution: "Barclays";
  period?: StatementPeriod;
  statementDate?: string;
  totals?: {
    currency: "GBP";
    transactions?: number;
    interest?: number;
    fees?: number;
    payments?: number;
  };
}

export const ANNUAL_SUMMARY_MESSAGE =
  "This Barclaycard annual summary contains totals, not individual transactions. Use the monthly statements to import purchases and payments.";

export class AnnualSummaryOnlyError extends Error {
  constructor(readonly summary: AnnualStatementSummary) {
    super(ANNUAL_SUMMARY_MESSAGE);
    this.name = "AnnualSummaryOnlyError";
  }
}

const money = /^£\s*\d[\d,]*\.\d{2}$/;
const postedMoney = /^(?:[£€$]\s*)?[+-]?\d[\d,]*\.\d{2}(?:\s*(?:CR|DR))?$/i;
const datedStart =
  /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*(?:\s+\d{2,4})?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+\d{1,2}(?:\s+\d{2,4})?)(?:\s|$)/i;

export function identifyBarclaycardAnnualSummary(
  rows: TextRow[],
): AnnualStatementSummary | undefined {
  if (!rows.length) return;
  const firstPage = Math.min(...rows.map((row) => row.page));
  const first = rows.filter((row) => row.page === firstPage);
  if (
    !first.some((row) =>
      /^Your\b.{0,80}\bannual statement\b/i.test(row.text),
    ) ||
    !rows.some((row) => /\bbarclaycard(?:\.co\.uk)?\b/i.test(row.text))
  )
    return;
  const heading = first
    .flatMap((row) => row.items)
    .find((item) => /^Annual summary\s*:?\s*$/i.test(item.text.trim()));
  if (
    !heading ||
    !rows.some((row) => /^Your annual overview\b/i.test(row.text))
  )
    return;
  // Annual reports from other layouts may contain a genuine detailed ledger.
  // Keep those on the transaction route. Rate dates in a right-hand information
  // panel cannot become transactions beside unrelated totals in the left panel.
  if (
    rows.some(
      (row) =>
        /^Your transactions\b/i.test(row.text) ||
        (/\bDate\b/i.test(row.text) &&
          /Description|Details|Merchant|Transactions?/i.test(row.text) &&
          /Amount|Money out|Paid out|Debit/i.test(row.text)) ||
        (datedStart.test(row.items[0]?.text.trim() ?? "") &&
          row.items.some((item) => postedMoney.test(item.text.trim()))),
    )
  )
    return;

  const summary: AnnualStatementSummary = {
    kind: "annual-summary",
    institution: "Barclays",
    statementDate: barclaycardIssueDate(rows),
  };
  try {
    // The period is beside the annual totals, not necessarily in logical text
    // order. Isolate that column before reconstructing the range or wrapping.
    const periodRows = reconstructRows(
      first
        .flatMap((row) => row.items)
        .filter(
          (item) =>
            item.x >= heading.x - 6 &&
            item.y >= heading.y - 3 &&
            item.y <= heading.y + 60,
        ),
    ).map((row) => ({
      ...row,
      text: row.text.replace(/^Annual summary\s*:?\s*/i, "Statement period: "),
    }));
    summary.period = identifyPeriod(periodRows, true, Number.MAX_SAFE_INTEGER);
  } catch {
    // Missing/conflicting printed evidence stays unavailable. An annual
    // interval is never guessed backwards from the issue date or today's date.
  }
  const labels: [RegExp, "transactions" | "interest" | "fees" | "payments"][] =
    [
      [/^Transactions\s*:/i, "transactions"],
      [/^Total interest\s*:/i, "interest"],
      [/^Fees\s*:/i, "fees"],
      [/^Payments\s*:/i, "payments"],
    ];
  const totals: NonNullable<AnnualStatementSummary["totals"]> = {
    currency: "GBP",
  };
  for (const [label, key] of labels) {
    const values = new Set<number>();
    let ambiguous = false;
    for (const row of first.filter((row) => label.test(row.text))) {
      const amounts = row.items.filter(
        (item) => item.x < heading.x - 6 && money.test(item.text.trim()),
      );
      if (amounts.length === 1) values.add(parseMoney(amounts[0].text, "GBP"));
      else if (amounts.length > 1) ambiguous = true;
    }
    if (!ambiguous && values.size === 1) totals[key] = [...values][0];
  }
  if (Object.keys(totals).length > 1) summary.totals = totals;
  return summary;
}
