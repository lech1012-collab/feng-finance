import type { TextRow } from "../domain/models";
import { parseMoney, safeSum } from "../domain/money";
import { BaseParser } from "./common";
import { identifyPeriod } from "./period";
export class BarclaysStatementParser extends BaseParser {
  protected inheritBlankDates = true;
  protected isUndatedTransactionStart(text: string) {
    return /^(?:Direct Debit to|Received From|Bill Payment to|Card Payment to|Payment to|Standing Order to|Cash Withdrawal|Bank Giro|Transfer to)\b/i.test(
      text,
    );
  }
  institution = "Barclays" as const;
  identifyStatementPeriod(rows: TextRow[]) {
    return identifyPeriod(rows, true);
  }
  extractTransactions(rows: TextRow[], periodEnd: string, currency: string) {
    // Stop at the actual page footer, not a wrapped merchant/reference line.
    const footers = new Map<number, number>();
    for (const row of rows)
      if (
        /^(?:Continued$|Barclays Bank UK PLC\.|Registered in England\.)/i.test(
          row.text,
        ) &&
        !footers.has(row.page)
      )
        footers.set(row.page, row.y);
    const scoped = rows.filter(
      (row) =>
        row.y < (footers.get(row.page) ?? Infinity) &&
        !/^(?:Sort code\b|Your transactions$)/i.test(row.text),
    );
    const result = super.extractTransactions(scoped, periodEnd, currency);
    for (const direction of ["in", "out"] as const) {
      const summary = rows.find((row) =>
        new RegExp(`^Money ${direction}\\s+[£€$]?\\s*[\\d,.]+$`, "i").test(
          row.text,
        ),
      );
      if (!summary) continue;
      const value = summary.text.replace(
        new RegExp(`^Money ${direction}\\s+`, "i"),
        "",
      );
      const reported = parseMoney(value, currency);
      const actual = safeSum(
        result.transactions
          .filter((t) => (direction === "in" ? t.amount > 0 : t.amount < 0))
          .map((t) => Math.abs(t.amount)),
      );
      if (Math.abs(actual - reported) > 1)
        result.warnings.push(
          `Barclays extracted money ${direction} differs from the printed summary. Review for missing transactions before importing.`,
        );
    }
    return result;
  }
  canParse(rows: TextRow[]) {
    return (
      rows.some((r) => /BARCLAYS/i.test(r.text)) &&
      rows.some((r) => /money out|paid out|debit/i.test(r.text))
    );
  }
}
