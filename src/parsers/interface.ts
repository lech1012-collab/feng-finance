import type {
  Account,
  Institution,
  ParsedStatement,
  ParsedTransaction,
  Reconciliation,
  TextRow,
} from "../domain/models";
import type { StatementPeriod } from "./period";
export const PARSER_VERSION = "1.0.2";
export interface StatementParser {
  institution: Institution;
  canParse(rows: TextRow[]): boolean;
  identifyAccount(rows: TextRow[]): {
    identifier?: string;
    accountType: Account["accountType"];
  };
  identifyStatementPeriod(rows: TextRow[]): { start: string; end: string };
  identifyCurrency(rows: TextRow[]): string;
  extractBalances(
    rows: TextRow[],
    currency: string,
  ): { opening?: number; closing?: number };
  extractTransactions(
    rows: TextRow[],
    periodEnd: string,
    currency: string,
  ): { transactions: ParsedTransaction[]; warnings: string[] };
  validate(statement: ParsedStatement): Reconciliation;
  parse(rows: TextRow[], periodOverride?: StatementPeriod): ParsedStatement;
}
