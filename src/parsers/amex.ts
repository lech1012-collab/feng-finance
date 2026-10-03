import type { TextRow } from "../domain/models";
import { BaseParser } from "./common";
export class AmexStatementParser extends BaseParser {
  institution = "American Express" as const;
  protected credit = true;
  extractTransactions(rows: TextRow[], periodEnd: string, currency: string) {
    const result = super.extractTransactions(rows, periodEnd, currency);
    for (const t of result.transactions) {
      if (
        t.amount > 0 &&
        /PAYMENT RECEIVED|PAYMENT THANK YOU|DIRECT DEBIT PAYMENT/i.test(
          t.description,
        )
      )
        t.type = "transfer";
    }
    return result;
  }
  canParse(rows: TextRow[]) {
    return (
      rows.some((r) => /AMERICAN EXPRESS|AMEX/i.test(r.text)) &&
      rows.some((r) => /previous balance|new balance|card ending/i.test(r.text))
    );
  }
}
