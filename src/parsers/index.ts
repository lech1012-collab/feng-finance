import type { Institution } from "../domain/models";
import { BarclaysStatementParser } from "./barclays";
import { AmexStatementParser } from "./amex";
import { RevolutStatementParser } from "./revolut";
export const parsers = [
  new BarclaysStatementParser(),
  new AmexStatementParser(),
  new RevolutStatementParser(),
];
export function getParser(bank: Institution) {
  const parser = parsers.find((p) => p.institution === bank);
  if (!parser)
    throw new Error(
      "Unsupported bank. Select Barclays, American Express or Revolut.",
    );
  return parser;
}
