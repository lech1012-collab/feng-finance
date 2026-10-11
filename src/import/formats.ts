import type {
  Institution,
  ParsedStatement,
  ParsedTransaction,
} from "../domain/models";
import { isoDate, parseDate } from "../domain/dates";
import { currencyPrecision, parseMoney, safeSum } from "../domain/money";
import { normalizeDescription, normalizeMerchant } from "../domain/normalize";

export const STATEMENT_FILE_ACCEPT =
  "application/pdf,.pdf,text/csv,.csv,.ofx,.qfx,.qif";
export type TextImportFormat = "csv" | "ofx" | "qif";
export interface CsvTable {
  headers: string[];
  rows: string[][];
  separator: string;
}
export interface CsvMapping {
  headers?: string[];
  date: number;
  description: number;
  amount?: number;
  debit?: number;
  credit?: number;
  balance?: number;
  currency?: number;
  fee?: number;
  state?: number;
  amountDirection?: "signed" | "purchases-positive";
  balanceDirection?: "financial" | "debt-positive";
  dateOrder?: "day-first" | "month-first";
  institution?: Institution;
  accountType?: "current" | "credit" | "savings";
  defaultCurrency?: string;
  accountIdentifier?: string;
}
export interface CsvPreset {
  name: string;
  mapping: CsvMapping;
}
export function csvBalanceConvention(
  mapping: CsvMapping,
): NonNullable<CsvMapping["balanceDirection"]> {
  return (
    mapping.balanceDirection ??
    (mapping.accountType === "credit" &&
    mapping.amountDirection === "purchases-positive"
      ? "debt-positive"
      : "financial")
  );
}

/** A bounded RFC-4180 reader, including quoted line breaks and escaped quotes. */
export function readCsv(text: string): CsvTable {
  const source = text.replace(/^\uFEFF/, "");
  const lines = source.split(/\r?\n/, 20);
  const first = lines.find((line) => /\bdate\b/i.test(line)) ?? lines[0];
  const separator = [",", ";", "\t"].sort(
    (a, b) => countOutsideQuotes(first, b) - countOutsideQuotes(first, a),
  )[0];
  const records: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    afterQuote = false;
  const append = () => {
    row.push(field);
    field = "";
    afterQuote = false;
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else field += ch;
    } else if (ch === '"' && !field) quoted = true;
    else if (ch === separator) append();
    else if (ch === "\n" || ch === "\r") {
      append();
      if (row.some((value) => value.trim())) records.push(row);
      row = [];
      if (ch === "\r" && source[i + 1] === "\n") i++;
    } else if (afterQuote && ch.trim())
      throw new Error(
        "CSV contains text after a closing quote. Export the file again.",
      );
    else if (!afterQuote) field += ch;
    if (records.length > 100000 || field.length > 100000)
      throw new Error("CSV is too large. Import a smaller period.");
  }
  if (quoted)
    throw new Error(
      "CSV contains an unfinished quoted field. No rows were discarded.",
    );
  append();
  if (row.some((value) => value.trim())) records.push(row);
  if (records.length < 2) throw new Error("CSV has no transaction rows.");
  // Bank exports may prepend a short account/title block before their header.
  const headerIndex = records
    .slice(0, 20)
    .findIndex(
      (record) =>
        record.some((value) =>
          /^(?:date|transaction date|completed date|started date|posting date)$/i.test(
            value.trim(),
          ),
        ) && record.length >= 3,
    );
  const index = headerIndex >= 0 ? headerIndex : 0;
  const headers = records[index].map((value) => value.trim());
  const rows = records.slice(index + 1);
  for (let i = 0; i < rows.length; i++)
    if (rows[i].length !== headers.length)
      throw new Error(
        `CSV row ${i + index + 2} has ${rows[i].length} columns; the header has ${headers.length}. No rows were discarded.`,
      );
  return { headers, rows, separator };
}
function countOutsideQuotes(text: string, delimiter: string) {
  let quoted = false,
    count = 0;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === delimiter) count++;
  }
  return count;
}
const headerKey = (raw: string) =>
  raw.trim().toLowerCase().replace(/[()]/g, "").replace(/\s+/g, " ");
export function csvPreset(
  table: CsvTable,
  filename = "",
): CsvPreset | undefined {
  const h = table.headers.map(headerKey);
  const find = (...names: string[]) => {
    const i = h.findIndex((value) => names.includes(value));
    return i >= 0 ? i : undefined;
  };
  const description = find(
    "description",
    "merchant",
    "merchant name",
    "payee",
    "transaction",
    "transaction description",
    "details",
    "memo",
  );
  const date = find(
    "completed date",
    "date",
    "transaction date",
    "posting date",
    "started date",
  );
  if (date === undefined || description === undefined) return undefined;
  const base: CsvMapping = {
    date,
    description,
    amount: find("amount", "amount gbp", "amount £"),
    debit: find("money out", "debit", "debit amount", "paid out"),
    credit: find("money in", "credit", "credit amount", "paid in"),
    balance: find("balance", "running balance"),
    currency: find("currency"),
    defaultCurrency: "GBP",
    dateOrder: "day-first",
  };
  if (base.currency !== undefined) {
    const codes = [
      ...new Set(
        table.rows
          .map((row) => row[base.currency!].trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    if (codes.length > 1)
      throw new Error(
        "This CSV contains multiple currencies. Export each currency separately.",
      );
    if (codes[0]) {
      currencyPrecision(codes[0]);
      base.defaultCurrency = codes[0];
    }
  }
  if (
    h.includes("product") &&
    h.includes("type") &&
    h.includes("completed date") &&
    h.includes("currency")
  )
    return {
      name: "Revolut",
      mapping: {
        ...base,
        institution: "Revolut",
        accountType: "current",
        fee: find("fee"),
        state: find("state"),
      },
    };
  if (
    /barclaycard/i.test(filename) ||
    (h.includes("transaction type") && h.includes("cardholder"))
  )
    return {
      name: "Barclaycard",
      mapping: {
        ...base,
        institution: "Barclays",
        accountType: "credit",
        amountDirection: "purchases-positive",
        balanceDirection: "debt-positive",
      },
    };
  if (
    /amex|american.?express/i.test(filename) ||
    h.includes("appears on your statement as") ||
    h.includes("card member")
  )
    return {
      name: "Amex UK",
      mapping: {
        ...base,
        institution: "American Express",
        accountType: "credit",
        amountDirection: "purchases-positive",
        balanceDirection: "debt-positive",
      },
    };
  if (
    (base.debit !== undefined && base.credit !== undefined) ||
    /barclays/i.test(filename) ||
    (h.includes("number") && h.includes("account") && h.includes("subcategory"))
  ) {
    const accountColumn = find("account");
    const identifiers =
      accountColumn !== undefined
        ? [
            ...new Set(
              table.rows
                .map((row) => row[accountColumn].replace(/\D/g, "").slice(-4))
                .filter(Boolean),
            ),
          ]
        : [];
    if (identifiers.length > 1)
      throw new Error(
        "CSV contains multiple accounts. Export one account per file.",
      );
    const identified =
      /barclays/i.test(filename) ||
      (h.includes("number") &&
        h.includes("account") &&
        h.includes("subcategory"));
    return {
      name: identified ? "Barclays" : "Debit and credit columns",
      mapping: {
        ...base,
        institution: identified ? "Barclays" : "Other",
        accountType: "current",
        accountIdentifier:
          identifiers.length === 1 ? `•••• ${identifiers[0]}` : undefined,
      },
    };
  }
  return undefined;
}
export function parseImportDate(
  raw: string,
  order: CsvMapping["dateOrder"] = "day-first",
) {
  const value = raw.trim();
  const iso = value.match(
    /^(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/,
  );
  if (iso) return parseDate(iso[1]);
  const numeric = value.match(/^(\d{1,2})[/.](\d{1,2})[/' .-](\d{2,4})$/);
  if (numeric && order === "month-first")
    return isoDate(
      +numeric[3] < 100 ? 2000 + +numeric[3] : +numeric[3],
      +numeric[1],
      +numeric[2],
    );
  if (numeric)
    return isoDate(
      +numeric[3] < 100 ? 2000 + +numeric[3] : +numeric[3],
      +numeric[2],
      +numeric[1],
    );
  return parseDate(value);
}
function parsedTransaction(
  date: string,
  description: string,
  amount: number,
  currency: string,
  sourceId?: string,
): ParsedTransaction {
  return {
    date,
    description: normalizeDescription(description),
    merchant: normalizeMerchant(description),
    amount,
    currency,
    type: amount >= 0 ? "income" : "expense",
    sourcePage: 1,
    extractionConfidence: 1,
    sourceId,
  };
}
function period(transactions: ParsedTransaction[]) {
  if (!transactions.length)
    throw new Error("The export contains no completed transactions.");
  const dates = transactions.map((t) => t.date).sort();
  return {
    periodStart: dates[0],
    periodEnd: dates.at(-1)!,
    periodSource: "transaction-coverage" as const,
  };
}
export function parseCsv(
  table: CsvTable,
  mapping: CsvMapping,
): ParsedStatement {
  const indices = [
    mapping.date,
    mapping.description,
    mapping.amount,
    mapping.debit,
    mapping.credit,
    mapping.balance,
    mapping.currency,
    mapping.fee,
    mapping.state,
  ].filter((i): i is number => i !== undefined);
  if (
    indices.some(
      (i) => !Number.isInteger(i) || i < 0 || i >= table.headers.length,
    )
  )
    throw new Error("Select a valid column for each mapped field.");
  if (
    mapping.amount === undefined &&
    mapping.debit === undefined &&
    mapping.credit === undefined
  )
    throw new Error("Map Amount, or Money out and Money in.");
  const currency = (mapping.defaultCurrency ?? "GBP").toUpperCase();
  currencyPrecision(currency);
  const transactions: ParsedTransaction[] = [],
    warnings: string[] = [];
  for (let index = 0; index < table.rows.length; index++) {
    const row = table.rows[index];
    if (
      mapping.state !== undefined &&
      /^(?:pending|reverted|declined|failed|cancelled)$/i.test(
        row[mapping.state].trim(),
      )
    )
      continue;
    try {
      if (
        mapping.currency !== undefined &&
        row[mapping.currency].trim().toUpperCase() !== currency
      )
        throw new Error(
          "This file contains multiple currencies. Export each currency separately.",
        );
      const date = parseImportDate(row[mapping.date], mapping.dateOrder);
      const description = row[mapping.description].trim();
      if (!description) throw new Error("The description is empty.");
      let amount: number;
      if (mapping.amount !== undefined) {
        amount = parseMoney(row[mapping.amount], currency);
        if (mapping.amountDirection === "purchases-positive") amount = -amount;
      } else {
        const debit =
          mapping.debit !== undefined && row[mapping.debit].trim()
            ? Math.abs(parseMoney(row[mapping.debit], currency))
            : 0;
        const credit =
          mapping.credit !== undefined && row[mapping.credit].trim()
            ? Math.abs(parseMoney(row[mapping.credit], currency))
            : 0;
        if (debit && credit)
          throw new Error("Both debit and credit contain amounts.");
        amount = credit - debit;
      }
      const t = parsedTransaction(date, description, amount, currency);
      t.sourcePage = index + 2;
      if (mapping.balance !== undefined && row[mapping.balance].trim()) {
        const reportedBalance = parseMoney(row[mapping.balance], currency);
        t.balanceAfterTransaction =
          csvBalanceConvention(mapping) === "debt-positive"
            ? -reportedBalance
            : reportedBalance;
      }
      const fee =
        mapping.fee !== undefined && row[mapping.fee].trim()
          ? Math.abs(parseMoney(row[mapping.fee], currency))
          : 0;
      if (fee) {
        const feeTransaction = parsedTransaction(
          date,
          `Transaction fee ${description}`,
          -fee,
          currency,
        );
        feeTransaction.sourcePage = index + 2;
        feeTransaction.balanceAfterTransaction = t.balanceAfterTransaction;
        delete t.balanceAfterTransaction;
        transactions.push(t, feeTransaction);
      } else transactions.push(t);
    } catch (error) {
      throw new Error(
        `CSV row ${index + 2}: ${error instanceof Error ? error.message : "The row could not be read."} No rows were discarded.`,
      );
    }
  }
  // Reorder source rows, preserving a fee after its own transaction.
  const newestFirst =
    transactions.length > 1 && transactions[0].date > transactions.at(-1)!.date;
  transactions.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (newestFirst ? b.sourcePage - a.sourcePage : a.sourcePage - b.sourcePage),
  );
  let openingBalance: number | undefined, closingBalance: number | undefined;
  if (
    transactions.length &&
    transactions.every((t) => t.balanceAfterTransaction !== undefined)
  ) {
    openingBalance =
      transactions[0].balanceAfterTransaction! - transactions[0].amount;
    closingBalance = transactions.at(-1)!.balanceAfterTransaction;
    let balance = openingBalance;
    for (const t of transactions) {
      balance = safeSum([balance, t.amount]);
      if (balance !== t.balanceAfterTransaction)
        warnings.push(
          `Running balance differs on ${t.date}. Review the source row before importing.`,
        );
    }
  } else {
    // Sparse balances can still validate independently after each printed anchor.
    let anchor: number | undefined,
      since = 0;
    for (const t of transactions) {
      since = safeSum([since, t.amount]);
      if (t.balanceAfterTransaction !== undefined) {
        if (openingBalance === undefined)
          openingBalance = t.balanceAfterTransaction - since;
        if (
          anchor !== undefined &&
          safeSum([anchor, since]) !== t.balanceAfterTransaction
        )
          warnings.push(
            `Running balance differs on ${t.date}. Review the source row before importing.`,
          );
        anchor = t.balanceAfterTransaction;
        since = 0;
      }
    }
    if (transactions.at(-1)?.balanceAfterTransaction !== undefined)
      closingBalance = transactions.at(-1)!.balanceAfterTransaction;
  }
  return {
    institution: mapping.institution ?? "Other",
    accountIdentifier: mapping.accountIdentifier,
    accountType: mapping.accountType ?? "current",
    currency,
    ...period(transactions),
    openingBalance,
    closingBalance,
    transactions,
    warnings: [...new Set(warnings)],
  };
}
function tag(text: string, name: string) {
  const match = text.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"));
  return match?.[1]
    ?.trim()
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}
function ofxDate(raw: string | undefined) {
  const match = raw?.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) throw new Error("OFX date is missing or unsupported.");
  return isoDate(+match[1], +match[2], +match[3]);
}
export function parseOfx(text: string): ParsedStatement {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error(
      "OFX document types and external entities are not supported.",
    );
  if (!/<OFX[>\s]/i.test(text))
    throw new Error("This file is not a valid OFX or QFX export.");
  const bankStatements = [...text.matchAll(/<(?:STMTTRS|CCSTMTRS)>/gi)];
  if (bankStatements.length > 1)
    throw new Error(
      "OFX contains multiple accounts. Export one account per file.",
    );
  const currency = (tag(text, "CURDEF") ?? "GBP").toUpperCase();
  currencyPrecision(currency);
  const transactions: ParsedTransaction[] = [];
  const sourceIds = new Set<string>();
  const blocks = [
    ...text.matchAll(
      /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST>))/gi,
    ),
  ];
  if (!blocks.length) throw new Error("OFX contains no transaction records.");
  for (let i = 0; i < blocks.length; i++) {
    try {
      const block = blocks[i][1];
      const date = ofxDate(tag(block, "DTPOSTED"));
      const name = tag(block, "NAME"),
        memo = tag(block, "MEMO");
      const description = [name, memo && memo !== name ? memo : undefined]
        .filter(Boolean)
        .join(" ");
      if (!description) throw new Error("The payee and memo are empty.");
      const amount = tag(block, "TRNAMT");
      if (amount === undefined) throw new Error("The amount is missing.");
      const t = parsedTransaction(
        date,
        description,
        parseMoney(amount, currency),
        currency,
        tag(block, "FITID"),
      );
      if (t.sourceId && sourceIds.has(t.sourceId))
        throw new Error(
          "Two records have the same FITID. Export the account again before importing.",
        );
      if (t.sourceId) sourceIds.add(t.sourceId);
      t.sourcePage = i + 1;
      if (name) t.merchant = normalizeMerchant(name);
      transactions.push(t);
    } catch (error) {
      throw new Error(
        `OFX transaction ${i + 1}: ${error instanceof Error ? error.message : "Could not read record."} No rows were discarded.`,
      );
    }
  }
  transactions.sort((a, b) => a.date.localeCompare(b.date));
  const org = `${tag(text, "ORG") ?? ""} ${tag(text, "FI") ?? ""}`;
  const institution: Institution = /barclay/i.test(org)
    ? "Barclays"
    : /amex|american.*express/i.test(org)
      ? "American Express"
      : /revolut/i.test(org)
        ? "Revolut"
        : "Other";
  const ledger = text.match(
    /<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|(?=<AVAILBAL>|<\/STMTTRS>|<\/CCSTMTRS>))/i,
  )?.[1];
  const balance = ledger && tag(ledger, "BALAMT");
  const start = tag(text, "DTSTART"),
    end = tag(text, "DTEND");
  const accountIdentifier = tag(text, "ACCTID")?.replace(/\D/g, "").slice(-4);
  return {
    institution,
    currency,
    accountType:
      /<CCSTMTRS>/i.test(text) || /CREDIT/i.test(tag(text, "ACCTTYPE") ?? "")
        ? "credit"
        : /SAVINGS/i.test(tag(text, "ACCTTYPE") ?? "")
          ? "savings"
          : "current",
    accountIdentifier: accountIdentifier
      ? `•••• ${accountIdentifier}`
      : undefined,
    ...period(transactions),
    ...(start && end
      ? {
          periodStart: ofxDate(start),
          periodEnd: ofxDate(end),
          periodSource: "printed" as const,
        }
      : {}),
    closingBalance:
      balance !== undefined ? parseMoney(balance, currency) : undefined,
    statementDate:
      ledger && tag(ledger, "DTASOF")
        ? ofxDate(tag(ledger, "DTASOF"))
        : undefined,
    transactions,
    warnings: [],
  };
}
export function parseQif(
  text: string,
  options: Partial<CsvMapping> = {},
): ParsedStatement {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!/^!Type:(?:Bank|CCard|Cash|Oth A|Oth L)/im.test(normalized))
    throw new Error(
      "Unsupported QIF export. Use a bank or credit-card transaction export.",
    );
  if (/^!Type:Invst/im.test(normalized))
    throw new Error("Investment QIF records are not supported.");
  if (
    (normalized.match(/^!Type:(?:Bank|CCard|Cash|Oth A|Oth L)/gim) ?? [])
      .length > 1
  )
    throw new Error(
      "QIF contains multiple account sections. Export one account per file.",
    );
  const numericDates = [
    ...normalized.matchAll(/^D(\d{1,2})[/.](\d{1,2})[/' .-]\d{2,4}$/gm),
  ];
  const dayFirst = numericDates.some((match) => +match[1] > 12);
  const monthFirst = numericDates.some((match) => +match[2] > 12);
  if (dayFirst && monthFirst)
    throw new Error(
      "QIF has inconsistent date formats. Export it again before importing.",
    );
  const dateOrder =
    options.dateOrder ??
    (dayFirst ? "day-first" : monthFirst ? "month-first" : undefined);
  if (!dateOrder && numericDates.length)
    throw new Error(
      "QIF date order is unclear. Choose day/month/year or month/day/year in the options below.",
    );
  const currency = (options.defaultCurrency ?? "GBP").toUpperCase();
  currencyPrecision(currency);
  const transactions: ParsedTransaction[] = [];
  let current: Record<string, string> = {},
    reading = false;
  for (const line of normalized.split("\n")) {
    if (line.startsWith("!Type:")) {
      reading = true;
      continue;
    }
    if (line.startsWith("!")) {
      reading = false;
      continue;
    }
    if (!reading || !line) continue;
    if (line === "^") {
      if (!current.D || !current.T || !(current.P || current.M))
        throw new Error(
          `QIF transaction ${transactions.length + 1} is missing a date, amount or payee. No rows were discarded.`,
        );
      const date = parseImportDate(
        current.D.replace("'", "/"),
        dateOrder ?? "day-first",
      );
      const transaction = parsedTransaction(
        date,
        [current.P, current.M].filter(Boolean).join(" "),
        parseMoney(current.T, currency),
        currency,
      );
      transaction.sourcePage = transactions.length + 1;
      transactions.push(transaction);
      current = {};
    } else if (/^[DTMP]/.test(line)) {
      const code = line[0];
      if (current[code] !== undefined)
        throw new Error(
          "QIF has repeated fields in one transaction. No rows were discarded.",
        );
      current[code] = line.slice(1).trim();
    }
  }
  if (Object.keys(current).length)
    throw new Error(
      "QIF ends with an unfinished transaction. No rows were discarded.",
    );
  return {
    institution: options.institution ?? "Other",
    currency,
    accountIdentifier: options.accountIdentifier,
    accountType: /!Type:CCard/i.test(normalized) ? "credit" : "current",
    ...period(transactions),
    transactions,
    warnings: [],
  };
}
