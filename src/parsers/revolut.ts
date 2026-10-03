import type { TextRow } from "../domain/models";
import { BaseParser } from "./common";
export class RevolutStatementParser extends BaseParser {
  institution = "Revolut" as const;
  canParse(rows: TextRow[]) {
    return (
      rows.some((r) => /REVOLUT/i.test(r.text)) &&
      rows.some((r) => /account statement|IBAN/i.test(r.text))
    );
  }
}
