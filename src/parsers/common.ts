import type {
  Account,
  Institution,
  ParsedStatement,
  ParsedTransaction,
  TextRow,
} from "../domain/models";
import { parseDate } from "../domain/dates";
import { parseMoney, currencyPrecision } from "../domain/money";
import { normalizeDescription, normalizeMerchant } from "../domain/normalize";
import { reconcile } from "../domain/reconcile";
import type { StatementParser } from "./interface";
import { identifyPeriod, validatePeriod, type StatementPeriod } from "./period";
const dateSource =
  "(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.]\\d{1,2}[/.]\\d{2,4}|\\d{1,2}\\s+[A-Za-z]{3,9}(?:\\s+\\d{2,4})?)";
const amountRE =
  /^(?:[£€$¥]\s*)?[+\-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,3})?(?:\s*(?:CR|DR))?$|^\((?:[£€$¥]\s*)?\d[\d,.]*\)$/i;
export abstract class BaseParser implements StatementParser {
  abstract institution: Institution;
  abstract canParse(rows: TextRow[]): boolean;
  protected credit = false;
  protected inheritBlankDates = false;
  protected isUndatedTransactionStart(_text: string) {
    return false;
  }
  identifyAccount(rows: TextRow[]): {
    identifier?: string;
    accountType: Account["accountType"];
  } {
    const text = rows.map((r) => r.text).join("\n");
    const matches = [
      ...text.matchAll(
        /(?:account\s*(?:number|no\.?|ending)|card\s*(?:number|ending)|IBAN)\s*[:#]?\s*([A-Z]{2}\d{2}[A-Z\d ]{10,30}|[•*xX\d][•*xX\d \-]{3,24})/gi,
      ),
    ];
    const suffixes = [
      ...new Set(matches.map((m) => m[1].replace(/\s|-/g, "").slice(-4))),
    ];
    if (suffixes.length > 1)
      throw new Error(
        "This PDF contains multiple accounts. Export a separate statement for each account.",
      );
    return {
      identifier: suffixes[0] ? `•••• ${suffixes[0]}` : undefined,
      accountType: this.credit ? "credit" : "current",
    };
  }
  identifyStatementPeriod(rows: TextRow[]) {
    return identifyPeriod(rows);
  }
  identifyCurrency(rows: TextRow[]) {
    const header = rows
      .filter((r) =>
        /currency|account statement|statement of account/i.test(r.text),
      )
      .map((r) => r.text)
      .join(" ");
    const codes = [
      ...new Set(
        header.match(/\b(?:GBP|EUR|USD|CHF|AUD|CAD|NZD|HKD|SGD|JPY|KWD)\b/g) ??
          [],
      ),
    ];
    if (codes.length > 1)
      throw new Error(
        "This statement contains multiple currencies. Import a separate statement per currency.",
      );
    let currency: string | undefined = codes[0];
    if (!currency) {
      const text = rows.map((r) => r.text).join(" ");
      currency = text.includes("£")
        ? "GBP"
        : text.includes("€")
          ? "EUR"
          : undefined;
    }
    if (!currency)
      throw new Error(
        "Statement currency could not be identified. A currency label is required.",
      );
    currencyPrecision(currency);
    return currency;
  }
  extractBalances(rows: TextRow[], currency: string) {
    const find = (re: RegExp) => {
      const row = rows.find((r) => re.test(r.text));
      if (!row) return undefined;
      const numbers = row.items
        .filter((i) => amountRE.test(i.text.trim()))
        .map((i) => i.text.trim());
      const raw =
        numbers.at(-1) ??
        row.text.match(
          /([£€$¥]?\s*[-+]?\d[\d,]*\.\d{2,3}(?:\s*(?:CR|DR))?)\s*$/i,
        )?.[1];
      if (!raw) return undefined;
      const value = parseMoney(raw, currency);
      return this.credit ? -value : value;
    };
    return {
      opening: find(
        this.credit
          ? /previous balance|opening balance|balance brought forward/i
          : /opening balance|start balance|balance brought forward/i,
      ),
      closing: find(
        this.credit
          ? /new balance|closing balance|balance carried forward/i
          : /closing balance|end balance|balance carried forward/i,
      ),
    };
  }
  validate(statement: ParsedStatement) {
    return reconcile(
      statement.openingBalance,
      statement.closingBalance,
      statement.transactions.map((t) => t.amount),
    );
  }
  extractTransactions(rows: TextRow[], periodEnd: string, currency: string) {
    type Column = { x: number; kind: "out" | "in" | "balance" | "amount" };
    let columns: Column[] = [];
    let inTable = false;
    let lastDate: string | undefined;
    let descriptionX = 0;
    let pending:
      | {
          date: string;
          bookingDate?: string;
          description: string;
          sourcePage: number;
          confidence: number;
        }
      | undefined;
    const transactions: ParsedTransaction[] = [];
    const warnings: string[] = [];
    const finish = (row: TextRow) => {
      if (!pending) return;
      const moneyItems = row.items.filter(
        (i) =>
          amountRE.test(i.text.trim()) &&
          columns.some((c) => Math.abs(c.x - i.x) < 100) &&
          i.x > Math.min(...columns.map((c) => c.x)) - 45,
      );
      const values = new Map<Column["kind"], number>();
      let ambiguous = false;
      for (const item of moneyItems) {
        const col = [...columns].sort(
          (a, b) => Math.abs(a.x - item.x) - Math.abs(b.x - item.x),
        )[0];
        if (values.has(col.kind)) ambiguous = true;
        try {
          values.set(col.kind, parseMoney(item.text, currency));
        } catch {
          warnings.push(
            `Page ${row.page}: a transaction amount could not be read.`,
          );
        }
      }
      if (!values.has("out") && !values.has("in") && !values.has("amount"))
        return false;
      let amount = 0;
      if (values.has("amount")) {
        const raw = values.get("amount")!;
        const credit =
          /PAYMENT RECEIVED|PAYMENT THANK YOU|DIRECT DEBIT PAYMENT|REFUND|CREDIT|\bCR\b/i.test(
            pending.description + " " + moneyItems.map((i) => i.text).join(" "),
          );
        amount = this.credit
          ? raw < 0 || credit
            ? Math.abs(raw)
            : -Math.abs(raw)
          : raw;
      } else {
        if (
          values.has("out") &&
          values.has("in") &&
          values.get("out") !== 0 &&
          values.get("in") !== 0
        ) {
          ambiguous = true;
          warnings.push(
            `Page ${row.page}: both debit and credit columns contain values.`,
          );
        }
        amount = (values.get("in") ?? 0) - Math.abs(values.get("out") ?? 0);
      }
      const description = normalizeDescription(pending.description);
      if (!description) {
        warnings.push(
          `Page ${row.page}: a transaction description is missing.`,
        );
        ambiguous = true;
      }
      transactions.push({
        date: pending.date,
        bookingDate: pending.bookingDate,
        description,
        merchant: normalizeMerchant(description),
        amount,
        currency,
        balanceAfterTransaction: values.get("balance"),
        type: amount >= 0 ? "income" : "expense",
        sourcePage: pending.sourcePage,
        extractionConfidence: ambiguous
          ? Math.min(0.65, pending.confidence)
          : pending.confidence,
      });
      pending = undefined;
      return true;
    };
    for (const row of rows) {
      if (
        /\bDate\b/i.test(row.text) &&
        /Description|Details|Transaction|Merchant/i.test(row.text) &&
        /Amount|Money out|Paid out|Debit/i.test(row.text)
      ) {
        columns = row.items.flatMap((item) => {
          const text = item.text.trim();
          const kind = /money out|paid out|debit/i.test(text)
            ? "out"
            : /money in|paid in|credit/i.test(text)
              ? "in"
              : /^balance$/i.test(text)
                ? "balance"
                : /^amount(?:\s*\(.+\))?$/i.test(text)
                  ? "amount"
                  : undefined;
          return kind ? [{ x: item.x, kind: kind as Column["kind"] }] : [];
        });
        if (!columns.length)
          throw new Error("Transaction columns could not be located.");
        descriptionX =
          row.items.find((i) =>
            /^(?:Description|Details|Transaction|Merchant)$/i.test(
              i.text.trim(),
            ),
          )?.x ?? 0;
        inTable = true;
        continue;
      }
      if (
        /opening balance|closing balance|new balance|previous balance|end balance|start balance|balance (?:brought|carried) forward|^total(?:s)?\b/i.test(
          row.text,
        )
      ) {
        lastDate = undefined;
        if (pending) {
          warnings.push(
            `Page ${pending.sourcePage}: a dated transaction has no readable amount.`,
          );
          pending = undefined;
        }
        if (
          /closing balance|new balance|end balance|balance carried forward/i.test(
            row.text,
          )
        )
          inTable = false;
        continue;
      }
      if (!inTable) continue;
      if (
        /^(?:page\s+\d|continued|Barclays|American Express|Revolut|statement period|account number|card ending|currency|www\.|customer service|important information|please keep)/i.test(
          row.text,
        )
      )
        continue;
      const first = row.items[0];
      const dateMatch = first?.text
        .trim()
        .match(new RegExp(`^(${dateSource})$`, "i"));
      const minX = Math.min(...columns.map((c) => c.x));
      const descriptionItems = row.items.filter(
        (i) => i.x < minX - 45 && i !== first,
      );
      if (dateMatch) {
        if (pending) {
          warnings.push(
            `Page ${pending.sourcePage}: a dated transaction has no readable amount. Review the source statement.`,
          );
          pending = undefined;
        }
        try {
          const date = parseDate(dateMatch[1], periodEnd);
          lastDate = date;
          const second = row.items[1];
          const bookingDate =
            second &&
            new RegExp(`^${dateSource}$`, "i").test(second.text.trim())
              ? parseDate(second.text, periodEnd)
              : undefined;
          pending = {
            date,
            bookingDate,
            description: descriptionItems
              .filter((i) => !bookingDate || i !== second)
              .map((i) => i.text)
              .join(" "),
            sourcePage: row.page,
            confidence: Math.min(1, ...row.items.map((i) => i.confidence ?? 1)),
          };
          finish(row);
        } catch {
          lastDate = undefined;
          warnings.push(
            `Page ${row.page}: unsupported transaction date. No import without review.`,
          );
        }
      } else if (pending) {
        if (
          this.inheritBlankDates &&
          pending.description.trim() &&
          first.x >= descriptionX - 3 &&
          this.isUndatedTransactionStart(row.text)
        ) {
          warnings.push(
            `Page ${pending.sourcePage}: a transaction has no readable amount. Review the source statement.`,
          );
          pending.description = "";
          pending.sourcePage = row.page;
        }
        pending.description +=
          " " +
          row.items
            .filter((i) => i.x < minX - 45)
            .map((i) => i.text)
            .join(" ");
        pending.confidence = Math.min(
          pending.confidence,
          ...row.items.map((i) => i.confidence ?? 1),
        );
        finish(row);
      } else if (
        this.inheritBlankDates &&
        lastDate &&
        first &&
        first.x >= descriptionX - 3 &&
        (this.isUndatedTransactionStart(row.text) ||
          row.items.some(
            (i) =>
              amountRE.test(i.text.trim()) &&
              i.x >= minX - 45 &&
              [...columns].sort(
                (a, b) => Math.abs(a.x - i.x) - Math.abs(b.x - i.x),
              )[0]?.kind !== "balance",
          ))
      ) {
        pending = {
          date: lastDate,
          description: row.items
            .filter((i) => i.x < minX - 45)
            .map((i) => i.text)
            .join(" "),
          sourcePage: row.page,
          confidence: Math.min(1, ...row.items.map((i) => i.confidence ?? 1)),
        };
        finish(row);
      } else if (
        first &&
        (/^\d{1,4}[/.]\d|^\d{1,2}\s+[A-Za-z]{3}/.test(first.text) ||
          row.items.some(
            (i) => amountRE.test(i.text.trim()) && i.x >= minX - 45,
          ))
      )
        warnings.push(
          `Page ${row.page}: an unrecognized transaction row requires source review.`,
        );
      else if (transactions.length && row.items.every((i) => i.x < minX - 45)) {
        const previous = transactions.at(-1)!;
        previous.description = normalizeDescription(
          previous.description + " " + row.text,
        );
        previous.merchant = normalizeMerchant(previous.description);
        previous.extractionConfidence = Math.min(
          previous.extractionConfidence,
          0.85,
        );
      }
    }
    if (pending)
      warnings.push(
        `Page ${pending.sourcePage}: a transaction was not fully extracted.`,
      );
    if (!transactions.length)
      throw new Error(
        "No transactions could be parsed. The statement layout may be unsupported.",
      );
    return { transactions, warnings };
  }
  parse(rows: TextRow[], periodOverride?: StatementPeriod): ParsedStatement {
    const period = periodOverride
      ? validatePeriod(periodOverride)
      : this.identifyStatementPeriod(rows);
    const currency = this.identifyCurrency(rows);
    const account = this.identifyAccount(rows);
    const balances = this.extractBalances(rows, currency);
    const extraction = this.extractTransactions(rows, period.end, currency);
    const outside = extraction.transactions.filter(
      (t) => t.date < period.start || t.date > period.end,
    );
    return {
      institution: this.institution,
      accountIdentifier: account.identifier,
      accountType: account.accountType,
      periodStart: period.start,
      periodEnd: period.end,
      periodSource: periodOverride ? "manual" : "printed",
      currency,
      openingBalance: balances.opening,
      closingBalance: balances.closing,
      transactions: extraction.transactions,
      warnings: [
        ...(periodOverride
          ? [
              "Statement dates were entered manually. Check both dates against the source PDF before importing.",
            ]
          : []),
        ...extraction.warnings,
        ...(outside.length
          ? [
              `${outside.length} transaction dates fall outside the statement period. Review them before import.`,
            ]
          : []),
      ],
    };
  }
}
