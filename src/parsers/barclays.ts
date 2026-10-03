import type { TextRow } from "../domain/models";
import { BaseParser } from "./common";
import { identifyPeriod } from "./period";
export class BarclaysStatementParser extends BaseParser {
  institution = "Barclays" as const;
  identifyStatementPeriod(rows: TextRow[]) {
    return identifyPeriod(rows, true);
  }
  canParse(rows: TextRow[]) {
    return (
      rows.some((r) => /BARCLAYS/i.test(r.text)) &&
      rows.some((r) => /money out|paid out|debit/i.test(r.text))
    );
  }
}
