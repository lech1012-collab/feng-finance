import type {
  ParsedStatement,
  ParsedTransaction,
  TextRow,
} from "../domain/models";
import { parseDate } from "../domain/dates";
import { parseMoney } from "../domain/money";
import { normalizeDescription, normalizeMerchant } from "../domain/normalize";
import { reconstructRows } from "../import/layout";
import { BaseParser } from "./common";
import {
  identifyPeriod,
  PERIOD_ERROR,
  validatePeriod,
  type StatementPeriod,
} from "./period";

const dateRE =
  /^\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s+\d{2,4})?$/i;
const moneyRE = /^(?:[+-]?£|£[+-]?)\s*\d[\d,]*\.\d{2}(?:\s*(?:CR|DR))?$/i;
const datePrefixRE = new RegExp(
  `^(${dateRE.source.slice(1, -1)})\\s+(.+)$`,
  "i",
);

export class BarclaycardStatementParser extends BaseParser {
  institution = "Barclays" as const;
  protected credit = true;

  canParse(rows: TextRow[]) {
    const firstPage = Math.min(...rows.map((r) => r.page));
    const text = rows
      .filter((r) => r.page === firstPage)
      .map((r) => r.text)
      .join("\n");
    return (
      /barclaycard(?:\.co\.uk)?/i.test(text) &&
      /your (?:previous|new) balance/i.test(text)
    );
  }

  identifyAccount(rows: TextRow[]) {
    const firstPage = Math.min(...rows.map((r) => r.page));
    const cards = rows
      .filter((r) => r.page === firstPage)
      .flatMap((r) => {
        const match = r.text.match(
          /^Number\s+([\d•*xX][\d•*xX\s-]{7,30})(?:$|\s+[A-Za-z])/i,
        );
        return match ? [match[1].replace(/[\s-]/g, "").slice(-4)] : [];
      });
    const unique = [...new Set(cards)];
    if (unique.length > 1)
      throw new Error(
        "This PDF contains multiple cards. Import a separate statement for each card.",
      );
    return unique[0]
      ? { identifier: `•••• ${unique[0]}`, accountType: "credit" as const }
      : super.identifyAccount(rows);
  }

  identifyStatementPeriod(rows: TextRow[]) {
    return identifyPeriod(rows, true);
  }

  private issueDate(rows: TextRow[]) {
    const firstPage = Math.min(...rows.map((r) => r.page));
    const dates = new Set(
      rows
        .filter((r) => r.page === firstPage)
        .flatMap((r) => {
          const match = r.text.match(
            /\bissued on\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/i,
          );
          return match ? [parseDate(match[1])] : [];
        }),
    );
    if (dates.size !== 1) throw new Error(PERIOD_ERROR);
    return [...dates][0];
  }

  extractTransactions(rows: TextRow[], periodEnd: string, currency: string) {
    if (currency !== "GBP")
      throw new Error(
        "This Barclaycard layout currently supports GBP statements only.",
      );
    const transactions: ParsedTransaction[] = [];
    const warnings: string[] = [];
    const pages = [
      ...new Set(
        rows
          .filter((r) => /^Your transactions\b/i.test(r.text))
          .map((r) => r.page),
      ),
    ].sort((a, b) => a - b);
    if (!pages.length)
      throw new Error(
        "The Barclaycard transaction section could not be located. No transactions have been saved.",
      );
    for (const page of pages) {
      // Split the two reading columns BEFORE row reconstruction. Otherwise an
      // amount or description from the other column can contaminate a row.
      const items = rows
        .filter((r) => r.page === page)
        .flatMap((r) => r.items)
        .flatMap((item) => {
          // PDF.js may combine a date and merchant drawn in the same text run.
          // Splitting that text does not estimate or alter the amount column.
          const match = item.text.trim().match(datePrefixRE);
          if (!match) return [item];
          const dateWidth =
            (item.width * match[1].length) / item.text.trim().length;
          const confidence = Math.min(item.confidence ?? 1, 0.85);
          return [
            { ...item, text: match[1], width: dateWidth, confidence },
            {
              ...item,
              text: match[2],
              x: item.x + dateWidth,
              width: item.width - dateWidth,
              confidence,
            },
          ];
        });
      const anchors: number[] = [];
      for (const item of items
        .filter((i) => dateRE.test(i.text.trim()))
        .sort((a, b) => a.x - b.x)) {
        if (!anchors.some((x) => Math.abs(x - item.x) < 15))
          anchors.push(item.x);
      }
      if (!anchors.length || anchors.length > 2)
        throw new Error(
          "Barclaycard transaction columns could not be identified safely.",
        );
      for (let column = 0; column < anchors.length; column++) {
        const left = anchors[column] - 15;
        const right =
          anchors[column + 1] === undefined
            ? Infinity
            : anchors[column + 1] - 15;
        const columnRows = reconstructRows(
          items.filter((i) => i.x >= left && i.x < right),
        );
        let paymentSection = false;
        let previous: ParsedTransaction | undefined;
        let previousY = 0;
        for (const row of columnRows) {
          if (/^Payments towards your account\b/i.test(row.text)) {
            paymentSection = true;
            previous = undefined;
            continue;
          }
          if (
            /^Transactions, interest and charges\b|^How you've used your card\b/i.test(
              row.text,
            )
          ) {
            paymentSection = false;
            previous = undefined;
            continue;
          }
          if (
            /^(?:Your (?:transactions|previous balance|new balance)|Promotional transactions|Interest and charges|Ways to pay|Page \d)\b/i.test(
              row.text,
            )
          ) {
            previous = undefined;
            continue;
          }
          const first = row.items[0];
          if (!first) continue;
          const dated =
            Math.abs(first.x - anchors[column]) < 15 &&
            dateRE.test(first.text.trim());
          if (dated) {
            previous = undefined;
            const monetary = row.items
              .filter((i) => moneyRE.test(i.text.trim()))
              .sort((a, b) => a.x - b.x);
            const amountItem = monetary.at(-1);
            if (!amountItem) {
              warnings.push(
                `Page ${page}: a dated Barclaycard transaction has no readable GBP amount.`,
              );
              continue;
            }
            const description = normalizeDescription(
              row.items
                .filter(
                  (i) =>
                    i !== first &&
                    i.x < amountItem.x &&
                    !(
                      i.x > amountItem.x - 30 &&
                      /^(?:e|c|m|CR|DR)$/i.test(i.text.trim())
                    ),
                )
                .map((i) => i.text)
                .join(" "),
            );
            try {
              const date = parseDate(first.text, periodEnd);
              const raw = parseMoney(amountItem.text, currency);
              const payment =
                paymentSection ||
                /PAYMENT RECEIVED|DIRECT DEBIT\s*[-–]?\s*PAYMENT/.test(
                  description,
                );
              const credit =
                !/\bDR\b/.test(row.text) &&
                (raw < 0 ||
                  /\bCR\b/.test(row.text) ||
                  /REFUND|CHARGEBACK|MERCHANT CREDIT/.test(description));
              const amount = payment || credit ? Math.abs(raw) : -Math.abs(raw);
              const ambiguous = monetary.length !== 1 || !description;
              if (ambiguous)
                warnings.push(
                  `Page ${page}: a Barclaycard transaction has an ambiguous amount or description.`,
                );
              previous = {
                date,
                description,
                merchant: normalizeMerchant(description),
                amount,
                currency,
                type: payment ? "transfer" : amount >= 0 ? "income" : "expense",
                sourcePage: page,
                extractionConfidence: Math.min(
                  ambiguous ? 0.65 : 1,
                  ...row.items.map((i) => i.confidence ?? 1),
                ),
              };
              transactions.push(previous);
              previousY = row.y;
            } catch {
              warnings.push(
                `Page ${page}: a Barclaycard transaction date or amount could not be read. Review the source PDF.`,
              );
            }
          } else if (
            Math.abs(first.x - anchors[column]) < 15 &&
            /^\d{1,2}\s+[A-Za-z]{3}/.test(first.text)
          ) {
            previous = undefined;
            warnings.push(
              `Page ${page}: an unsupported Barclaycard transaction date requires review.`,
            );
          } else if (
            previous &&
            row.y - previousY <= 25 &&
            row.items.every((i) => i.x >= anchors[column] + 20)
          ) {
            previous.description = normalizeDescription(
              previous.description + " " + row.text,
            );
            previous.extractionConfidence = Math.min(
              previous.extractionConfidence,
              ...row.items.map((i) => i.confidence ?? 1),
            );
            previousY = row.y;
          } else previous = undefined;
        }
      }
    }
    for (const row of rows.filter(
      (r) => r.page >= pages[0] && !pages.includes(r.page),
    )) {
      if (
        row.items.some((i) => dateRE.test(i.text.trim())) &&
        row.items.some((i) => moneyRE.test(i.text.trim()))
      )
        warnings.push(
          `Page ${row.page}: possible transactions outside a recognized Barclaycard table require review.`,
        );
    }
    if (!transactions.length)
      throw new Error(
        "No Barclaycard transactions could be parsed. No transactions have been saved.",
      );
    transactions.sort((a, b) => a.date.localeCompare(b.date));
    return { transactions, warnings };
  }

  parse(rows: TextRow[], periodOverride?: StatementPeriod): ParsedStatement {
    let printed: StatementPeriod | undefined;
    if (periodOverride) printed = validatePeriod(periodOverride);
    else {
      try {
        printed = this.identifyStatementPeriod(rows);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== PERIOD_ERROR)
          throw error;
      }
    }
    const statementDate = printed ? undefined : this.issueDate(rows);
    const end = printed?.end ?? statementDate!;
    const currency = this.identifyCurrency(rows);
    const account = this.identifyAccount(rows);
    const balances = this.extractBalances(rows, currency);
    const extraction = this.extractTransactions(rows, end, currency);
    const start =
      printed?.start ??
      extraction.transactions.reduce(
        (start, t) => (t.date < start ? t.date : start),
        end,
      );
    const outside = extraction.transactions.some(
      (t) => t.date < start || t.date > end,
    );
    return {
      institution: this.institution,
      accountIdentifier: account.identifier,
      accountType: account.accountType,
      periodStart: start,
      periodEnd: end,
      statementDate,
      periodSource: periodOverride
        ? "manual"
        : printed
          ? "printed"
          : "transaction-coverage",
      currency,
      openingBalance: balances.opening,
      closingBalance: balances.closing,
      transactions: extraction.transactions,
      warnings: [
        ...extraction.warnings,
        ...(periodOverride
          ? [
              "Statement dates were entered manually. Check both dates against the source PDF before importing.",
            ]
          : []),
        ...(!printed
          ? [
              "This Barclaycard statement prints an issue date but no period start. The displayed dates show coverage from the earliest extracted transaction to the issue date. Check this coverage against the PDF before importing.",
            ]
          : []),
        ...(outside
          ? [
              "Transaction dates fall outside the statement dates. Review the source PDF before importing.",
            ]
          : []),
      ],
    };
  }
}
