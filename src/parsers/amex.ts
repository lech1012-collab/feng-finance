import type { TextRow } from "../domain/models";
import { BaseParser } from "./common";
export class AmexStatementParser extends BaseParser {
  institution = "American Express" as const;
  protected credit = true;
  canParse(rows: TextRow[]) {
    return (
      rows.some((r) => /AMERICAN EXPRESS|AMEX/i.test(r.text)) &&
      rows.some((r) => /previous balance|new balance|card ending/i.test(r.text))
    );
  }
}
