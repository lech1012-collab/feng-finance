import type { ParsedTransaction, TextRow } from "../domain/models";
import { parseDate } from "../domain/dates";
import { parseMoney } from "../domain/money";
import { normalizeDescription, normalizeMerchant } from "../domain/normalize";
import { BaseParser } from "./common";
import { identifyPeriod } from "./period";

const moneyRE = /^(?:£\s*)?[+-]?\d[\d,]*\.\d{2}(?:\s*(?:CR|DR))?$/i;
const cardDateRE = /^[A-Za-z]{3,9}\s+\d{1,2}(?:\s+\d{2,4})?$/;
export class AmexStatementParser extends BaseParser {
  institution = "American Express" as const;
  protected credit = true;
  canParse(rows: TextRow[]) {
    return (
      rows.some((r) =>
        /AMERICAN EXPRESS|AMEX|americanexpress\.co\.uk/i.test(r.text),
      ) &&
      rows.some((r) =>
        /previous (?:closing )?balance|new balance|card ending|membership number/i.test(
          r.text,
        ),
      )
    );
  }
  identifyStatementPeriod(rows: TextRow[]) {
    // Amex places its explicitly labelled period below the account summary.
    return identifyPeriod(rows, false, Number.MAX_SAFE_INTEGER);
  }
  identifyAccount(rows: TextRow[]) {
    const label = rows.find((r) =>
      r.items.some((i) => /^Membership Number$/i.test(i.text.trim())),
    );
    if (!label) return super.identifyAccount(rows);
    const x = label.items.find((i) =>
      /^Membership Number$/i.test(i.text.trim()),
    )!.x;
    const values = rows
      .filter(
        (r) => r.page === label.page && r.y > label.y && r.y < label.y + 30,
      )
      .flatMap((r) => r.items)
      .filter(
        (i) =>
          Math.abs(i.x - x) < 15 && /^[xX*•\d-]{8,25}$/.test(i.text.trim()),
      );
    if (values.length !== 1)
      throw new Error(
        "Amex membership identifier could not be read safely. Select the matching account.",
      );
    return {
      identifier: `•••• ${values[0].text.replace(/-/g, "").slice(-4)}`,
      accountType: "credit" as const,
    };
  }
  private summary(rows: TextRow[], currency: string) {
    const heading = rows.find(
      (r) =>
        /Previous Closing Balance/i.test(r.text) &&
        /New Credits/i.test(r.text) &&
        /New Debits/i.test(r.text),
    );
    if (!heading) return undefined;
    const row = rows.find(
      (r) =>
        r.page === heading.page &&
        r.y > heading.y &&
        r.y < heading.y + 30 &&
        r.items.filter((i) => moneyRE.test(i.text.trim())).length === 4,
    );
    if (!row)
      throw new Error(
        "Amex account summary amounts could not be read safely. No transactions have been saved.",
      );
    const values = row.items
      .filter((i) => moneyRE.test(i.text.trim()))
      .map((i) => parseMoney(i.text, currency));
    return {
      opening: -values[0],
      credits: values[1],
      debits: values[2],
      closing: -values[3],
    };
  }
  extractBalances(rows: TextRow[], currency: string) {
    return (
      this.summary(rows, currency) ?? super.extractBalances(rows, currency)
    );
  }
  extractTransactions(rows: TextRow[], periodEnd: string, currency: string) {
    const headers = rows.filter(
      (r) =>
        /Transaction Details/i.test(r.text) &&
        /Foreign Spend/i.test(r.text) &&
        /Amount/i.test(r.text),
    );
    if (!headers.length) {
      const result = super.extractTransactions(rows, periodEnd, currency);
      for (const t of result.transactions)
        if (
          t.amount > 0 &&
          /PAYMENT RECEIVED|PAYMENT THANK YOU|DIRECT DEBIT PAYMENT/i.test(
            t.description,
          )
        )
          t.type = "transfer";
      return result;
    }
    if (
      currency !== "GBP" ||
      headers.some(
        (header) =>
          !header.items.some(
            (i) => i.x >= 470 && /^Amount\s*£$/i.test(i.text.trim()),
          ) ||
          header.items.filter((i) => i.x < 95 && /^Date$/i.test(i.text.trim()))
            .length !== 2 ||
          !header.items.some(
            (i) =>
              i.x >= 95 &&
              i.x < 370 &&
              /^Transaction Details$/i.test(i.text.trim()),
          ),
      )
    )
      throw new Error(
        "This UK Amex transaction layout or currency is unsupported. No transactions have been saved.",
      );
    const transactions: ParsedTransaction[] = [];
    const warnings: string[] = [];
    let pending:
      | {
          rows: TextRow[];
          date: string;
          bookingDate: string;
          sourcePage: number;
        }
      | undefined;
    const finish = () => {
      if (!pending) return;
      const all = pending.rows.flatMap((r) => r.items);
      const amounts = all.filter(
        (i) => i.x >= 470 && moneyRE.test(i.text.trim()),
      );
      if (amounts.length !== 1) {
        warnings.push(
          `Page ${pending.sourcePage}: an Amex transaction has a missing or ambiguous statement-currency amount.`,
        );
        pending = undefined;
        return;
      }
      const raw = parseMoney(amounts[0].text, currency);
      const credit =
        !all.some((i) => i.x >= 470 && /\bDR\b/i.test(i.text)) &&
        (raw < 0 || all.some((i) => i.x >= 470 && /\bCR\b/i.test(i.text)));
      const description = normalizeDescription(
        all
          .filter((i) => i.x >= 95 && i.x < 470)
          .map((i) => i.text)
          .join(" "),
      );
      const primary = normalizeDescription(
        pending.rows[0].items
          .filter((i) => i.x >= 95 && i.x < 370)
          .map((i) => i.text)
          .join(" "),
      );
      const amount = credit ? Math.abs(raw) : -Math.abs(raw);
      const payment =
        amount > 0 &&
        /PAYMENT RECEIVED|PAYMENT THANK YOU|DIRECT DEBIT PAYMENT|PAYMENT RECEIVED.*THANK/i.test(
          description,
        );
      if (!description)
        warnings.push(
          `Page ${pending.sourcePage}: an Amex transaction description is missing.`,
        );
      transactions.push({
        date: pending.date,
        bookingDate: pending.bookingDate,
        description,
        merchant: normalizeMerchant(primary || description),
        amount,
        currency,
        type: payment ? "transfer" : amount > 0 ? "income" : "expense",
        sourcePage: pending.sourcePage,
        extractionConfidence: Math.min(
          description ? 1 : 0.65,
          ...all.map((i) => i.confidence ?? 1),
        ),
      });
      pending = undefined;
    };
    for (const header of headers) {
      const pageRows = rows.filter(
        (r) => r.page === header.page && r.y > header.y,
      );
      for (const row of pageRows) {
        if (
          /^Total new spend|^How you can pay|^Your Cashback|^American Express Services|^Page\b/i.test(
            row.text,
          )
        ) {
          finish();
          break;
        }
        const first = row.items[0];
        if (first && first.x < 45 && cardDateRE.test(first.text.trim())) {
          finish();
          const booked = row.items.find((i) => i.x >= 45 && i.x < 95);
          try {
            pending = {
              rows: [row],
              date: parseDate(first.text, periodEnd),
              bookingDate: parseDate(booked?.text ?? first.text, periodEnd),
              sourcePage: row.page,
            };
          } catch {
            warnings.push(
              `Page ${row.page}: an unsupported Amex transaction date requires source review.`,
            );
          }
        } else if (
          pending &&
          row.items.every((i) => i.x >= 95) &&
          row.y - pending.rows.at(-1)!.y <= 30
        )
          pending.rows.push(row);
        else if (
          first &&
          first.x < 95 &&
          (/^[A-Za-z]{3,9}\s+\d/.test(first.text) ||
            row.items.some((i) => i.x >= 470 && moneyRE.test(i.text.trim())))
        ) {
          finish();
          warnings.push(
            `Page ${row.page}: an unrecognized Amex transaction row requires source review.`,
          );
        } else finish();
      }
      finish();
    }
    if (!transactions.length)
      throw new Error(
        "No Amex transactions could be parsed. No transactions have been saved.",
      );
    const summary = this.summary(rows, currency);
    if (summary) {
      const credits = transactions
        .filter((t) => t.amount > 0)
        .reduce((s, t) => s + t.amount, 0);
      const debits = transactions
        .filter((t) => t.amount < 0)
        .reduce((s, t) => s - t.amount, 0);
      if (
        Math.abs(credits - summary.credits) > 1 ||
        Math.abs(debits - summary.debits) > 1
      )
        warnings.push(
          "Amex extracted credits or debits differ from the printed account summary. Review for missing or incorrectly signed transactions before importing.",
        );
    }
    transactions.sort((a, b) => a.date.localeCompare(b.date));
    return { transactions, warnings };
  }
}
