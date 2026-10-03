import type { TextRow } from "../domain/models";
import { BaseParser } from "./common";
export class BarclaysStatementParser extends BaseParser {
  institution = "Barclays" as const;
  canParse(rows: TextRow[]) {
    return (
      rows.some((r) => /BARCLAYS/i.test(r.text)) &&
      rows.some((r) => /money out|paid out|debit/i.test(r.text))
    );
  }
}
