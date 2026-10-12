import { isoDate, parseDate } from "../../domain/dates";
import { parseMoney } from "../../domain/money";
import type { StatementPeriod } from "../../parsers/period";
import type { ColumnRole, LayoutMapping } from "./types";
export const DATE_PATTERN =
  /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{2,4})?|[A-Za-z]{3,9}\s+\d{1,2}(?:\s+\d{2,4})?)$/;
export const DATE_LIKE =
  /^(?:\d{1,2}[/.]\d|\d{4}-\d|\d{1,2}\s+[A-Za-z]{3}|[A-Za-z]{3,9}\s+\d)/;
export const MONEY_PATTERN =
  /^(?:(?:GBP|EUR|USD|CHF|AUD|CAD|NZD|HKD|SGD|JPY|KWD)\s*)?(?:[£€$¥]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,3})?-?(?:\s*(?:CR|DR))?$|^\((?:[£€$¥]\s*)?\d[\d,.]*\)(?:\s*(?:CR|DR))?$/i;
export function readMoney(raw: string, currency = "GBP"): number | undefined {
  const text = raw.normalize("NFKC").replace(/[−–]/g, "-").trim();
  if (!MONEY_PATTERN.test(text)) return;
  try {
    return parseMoney(
      /-\s*(?:CR|DR)?$/i.test(text)
        ? "-" + text.replace(/-\s*(CR|DR)?$/i, "$1")
        : text,
      currency,
    );
  } catch {
    return;
  }
}
export function readDate(
  raw: string,
  period: StatementPeriod,
  format: LayoutMapping["dateFormat"] = "auto",
): string | undefined {
  const text = raw.trim();
  if (!DATE_PATTERN.test(text)) return;
  try {
    if (format === "month-first") {
      const numeric = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
      if (numeric)
        return isoDate(
          +numeric[3] < 100 ? 2000 + +numeric[3] : +numeric[3],
          +numeric[1],
          +numeric[2],
        );
    }
    return parseDate(text, period.end);
  } catch {
    return;
  }
}
export function headerRole(text: string): ColumnRole | undefined {
  const t = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[£€$¥]/g, "")
    .replace(/[():]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(?:transaction |posting |process |booking )?date$/.test(t))
    return "date";
  if (
    /^(?:transaction )?(?:description|details|merchant|reference|narrative)$/.test(
      t,
    )
  )
    return "description";
  if (
    /^(?:paid in|money in|credit|credits|received|receipts|deposit|deposits)$/.test(
      t,
    )
  )
    return "in";
  if (
    /^(?:paid out|money out|debit|debits|withdrawal|withdrawals|spent|payments out)$/.test(
      t,
    )
  )
    return "out";
  if (/^(?:running |account |closing )?balance$/.test(t)) return "balance";
  if (/^(?:signed )?amount(?: gbp| eur| usd)?$/.test(t)) return "amount";
  if (/^(?:foreign spend|foreign amount|currency|rate|exchange rate)$/.test(t))
    return "ignore";
}
export function isWord(token: string) {
  return /^[\p{L}][\p{L}\p{M}'’\-]*[,.!:;]?$/u.test(token);
}
