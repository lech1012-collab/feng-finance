import type { TextRow } from "../domain/models";
import { BaseParser } from "./common";
import { identifyPeriod } from "./period";
import { parseMoney } from "../domain/money";
const moneyRE = /^(?:[£€$]\s*)?[+-]?\d[\d,]*\.\d{2}$/;
export class RevolutStatementParser extends BaseParser {
  institution = "Revolut" as const;
  canParse(rows: TextRow[]) {
    return (
      rows.some((r) => /REVOLUT/i.test(r.text)) &&
      rows.some((r) =>
        /account statement|IBAN|account transactions from/i.test(r.text),
      )
    );
  }
  private statementRows(rows: TextRow[]) {
    const start = rows.find((r) =>
      /^(?:GBP|EUR|USD|CHF|AUD|CAD|NZD|HKD|SGD|JPY|KWD) Statement$/i.test(
        r.text.trim(),
      ),
    );
    return start ? rows.filter((r) => r.page >= start.page) : rows;
  }
  identifyStatementPeriod(rows: TextRow[]) {
    return identifyPeriod(
      this.statementRows(rows).map((r) => ({
        ...r,
        text: r.text.replace(
          /^Account transactions from\s+/i,
          "Statement period: ",
        ),
      })),
      true,
      Number.MAX_SAFE_INTEGER,
    );
  }
  identifyCurrency(rows: TextRow[]) {
    const scoped = this.statementRows(rows);
    const codes = [
      ...new Set(
        scoped
          .flatMap((r) => r.text.match(/^([A-Z]{3}) Statement$/)?.[1] ?? [])
          .filter(Boolean),
      ),
    ];
    if (codes.length > 1)
      throw new Error(
        "This statement contains multiple currencies. Import a separate statement per currency.",
      );
    return codes[0]
      ? super.identifyCurrency([
          { ...scoped[0], text: `Currency: ${codes[0]}` },
        ])
      : super.identifyCurrency(rows);
  }
  identifyAccount(rows: TextRow[]) {
    const scoped = this.statementRows(rows);
    const accountRows = scoped.filter((r) =>
      r.items.some((i) => /^Account Number:?$/i.test(i.text.trim())),
    );
    const identifiers = [
      ...new Set(
        accountRows.flatMap((r) =>
          r.items
            .filter((i) => /^\d{8}$/.test(i.text.trim()))
            .map((i) => i.text.slice(-4)),
        ),
      ),
    ];
    if (identifiers.length > 1)
      throw new Error(
        "This PDF contains multiple accounts. Export a separate statement for each account.",
      );
    return identifiers.length
      ? {
          identifier: `•••• ${identifiers[0]}`,
          accountType: "current" as const,
        }
      : super.identifyAccount(scoped);
  }
  private summary(rows: TextRow[], currency: string) {
    const scoped = this.statementRows(rows);
    const heading = scoped.find(
      (r) =>
        /Product/i.test(r.text) &&
        /Opening balance/i.test(r.text) &&
        /Money out/i.test(r.text),
    );
    if (!heading) return undefined;
    const data = scoped.filter(
      (r) =>
        r.page === heading.page &&
        r.y > heading.y &&
        r.y < heading.y + 65 &&
        r.items.filter((i) => moneyRE.test(i.text.trim())).length === 4,
    );
    const products = data.filter((r) => !/^Total\b/i.test(r.text));
    if (products.length !== 1)
      throw new Error(
        "Revolut balance summary contains multiple or unreadable products. Export a separate statement for each account.",
      );
    const values = products[0].items
      .filter((i) => moneyRE.test(i.text.trim()))
      .map((i) => parseMoney(i.text, currency));
    return {
      opening: values[0],
      out: values[1],
      in: values[2],
      closing: values[3],
    };
  }
  extractBalances(rows: TextRow[], currency: string) {
    return (
      this.summary(rows, currency) ?? super.extractBalances(rows, currency)
    );
  }
  extractTransactions(rows: TextRow[], periodEnd: string, currency: string) {
    const scoped = this.statementRows(rows);
    const summary = this.summary(rows, currency);
    const headers = scoped.filter(
      (r) =>
        /\bDate\b/i.test(r.text) &&
        /Description/i.test(r.text) &&
        /Money out/i.test(r.text),
    );
    const tableRows = summary
      ? headers.flatMap((header) => {
          const footer = scoped.find(
            (r) =>
              r.page === header.page &&
              r.y > header.y &&
              /^(?:Report lost|Get help|Scan the QR|©)/i.test(r.text),
          );
          return scoped.filter(
            (r) =>
              r.page === header.page &&
              r.y >= header.y &&
              r.y < (footer?.y ?? Infinity) &&
              !/^(?:Report lost|Get help|Scan the QR|©)/i.test(r.text),
          );
        })
      : scoped;
    const result = super.extractTransactions(tableRows, periodEnd, currency);
    for (const t of result.transactions) {
      if (
        t.amount < 0 &&
        /^TO (?:AMERICAN EXP(?:RESS)?|AMEX)(?:\s+\d{1,4})?(?:\s+REFERENCE:|$)/i.test(
          t.description,
        )
      ) {
        t.type = "transfer";
        result.warnings.push(
          "A payment to Amex was marked as a transfer. Confirm it pays your own credit card; otherwise change its type before importing.",
        );
      }
    }
    if (summary) {
      const incoming = result.transactions
        .filter((t) => t.amount > 0)
        .reduce((s, t) => s + t.amount, 0);
      const outgoing = result.transactions
        .filter((t) => t.amount < 0)
        .reduce((s, t) => s - t.amount, 0);
      if (
        Math.abs(incoming - summary.in) > 1 ||
        Math.abs(outgoing - summary.out) > 1
      )
        result.warnings.push(
          "Revolut extracted money in or money out differs from the printed summary. Review for missing transactions before importing.",
        );
    }
    return result;
  }
}
