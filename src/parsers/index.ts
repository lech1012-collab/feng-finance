import type { Institution, TextRow } from "../domain/models";
import { BarclaycardStatementParser } from "./barclaycard";
import { BarclaysStatementParser } from "./barclays";
import { AmexStatementParser } from "./amex";
import { RevolutStatementParser } from "./revolut";
export const parsers = [
  new BarclaysStatementParser(),
  new AmexStatementParser(),
  new RevolutStatementParser(),
];
export function getParser(bank: Institution, rows?: TextRow[]) {
  const card = new BarclaycardStatementParser();
  if (bank === "Barclays" && rows && card.canParse(rows)) return card;
  const parser = parsers.find((p) => p.institution === bank);
  if (!parser)
    throw new Error(
      "Unsupported bank. Select Barclays, American Express or Revolut.",
    );
  return parser;
}
