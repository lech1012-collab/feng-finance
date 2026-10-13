import type { ParsedStatement, TextRow } from "../domain/models";
import { parseDate } from "../domain/dates";
import { currencyPrecision, parseMoney } from "../domain/money";
import { reconcileWithPolicy } from "../domain/reconcile";
import { outsideStatementPeriod } from "./statement-period";
import { statementMovements } from "./movements";
import { BANK_ADAPTER_PAYMENT_NOTICE } from "./generic/legacy-comparison";

/** Local, transient source facts. Neither the PDF nor this snapshot is persisted. */
export interface BankAdapterSource {
  parsed: ParsedStatement;
  printedMoneyIn?: number;
  printedMoneyOut?: number;
  reconciledExactly: boolean;
  sourceCoverageIssues: string[];
}

const sourceMoney = /^(?:[£€$¥]\s*)?[+\-]?\d[\d,]*\.\d{1,3}(?:\s*(?:CR|DR))?$/i;
const monthName =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const dateStart = new RegExp(
  `^(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.]\\d{1,2}[/.]\\d{2,4}|\\d{1,2}\\s+${monthName}(?:\\s+\\d{2,4})?|${monthName}\\s+\\d{1,2}(?:\\s+\\d{2,4})?)(?:\\s|$)`,
  "i",
);
const possibleDate =
  /^(?:\d{1,4}[/.]\d|\d{1,2}\s+[A-Za-z]{3}|[A-Za-z]{3,9}\s+\d)/;
const undatedBarclays =
  /^(?:Received from|Bill Payment to|Direct Debit to|Standing Order to|Payment to|Card Payment to|Debit Card Purchase|Cash Withdrawal|Transfer to|Transfer from|Refund from)\b/i;

/** Read only labelled bank summary evidence, without locating generic columns or candidates. */
function printedMovements(rows: TextRow[], currency: string) {
  const incoming = new Set<number>();
  const outgoing = new Set<number>();
  const value = (text: string) => {
    if (!sourceMoney.test(text.trim())) return undefined;
    try {
      return Math.abs(parseMoney(text, currency));
    } catch {
      return undefined;
    }
  };
  const direction = (text: string) =>
    /^(?:total )?(?:money in|paid in|credits|new credits)\b/i.test(text.trim())
      ? incoming
      : /^(?:total )?(?:money out|paid out|debits|new debits)\b/i.test(
            text.trim(),
          )
        ? outgoing
        : undefined;
  for (const row of rows) {
    const money = row.items.flatMap((item) => {
      const amount = value(item.text);
      return amount === undefined ? [] : [amount];
    });
    const singleDirection = direction(row.text);
    if (singleDirection && money.length === 1) singleDirection.add(money[0]);
    // Amex and Revolut print four independently labelled summary columns.
    // Their header may wrap the closing-balance label onto a second line.
    const headings = row.items.filter((item) =>
      /previous closing balance|opening balance|new credits|money in|new debits|money out|closing balance/i.test(
        item.text,
      ),
    );
    if (headings.length < 3) continue;
    const data = rows.find(
      (candidate) =>
        candidate.page === row.page &&
        candidate.y > row.y &&
        candidate.y < row.y + 65 &&
        !/^Total\b/i.test(candidate.text) &&
        candidate.items.filter((item) => value(item.text) !== undefined)
          .length === 4,
    );
    if (!data) continue;
    const values = data.items
      .filter((item) => value(item.text) !== undefined)
      .sort((a, b) => a.x - b.x)
      .map((item) => value(item.text)!);
    [...headings]
      .sort((a, b) => a.x - b.x)
      .forEach((heading, index) => direction(heading.text)?.add(values[index]));
  }
  return {
    printedMoneyIn: incoming.size === 1 ? [...incoming][0] : undefined,
    printedMoneyOut: outgoing.size === 1 ? [...outgoing][0] : undefined,
    ambiguous: incoming.size > 1 || outgoing.size > 1,
  };
}

/**
 * Count original ledger starts rather than a competing parser's output. This
 * catches omitted offsetting purchases/credits and malformed dated rows even
 * when the closing balance happens to reconcile. It does not reinterpret any
 * financial amount or require a generic layout/profile match.
 */
function sourceCoverage(rows: TextRow[], statement: ParsedStatement) {
  let occurrenceCount = 0;
  let runningAnchorCount = 0;
  let sawLedger = false;
  const card =
    statement.institution === "Barclays" &&
    (statement.accountType === "credit" ||
      statement.accountType === "credit_card");
  for (const page of [...new Set(rows.map((row) => row.page))]) {
    const pageRows = rows
      .filter((row) => row.page === page)
      .sort((a, b) => a.y - b.y);
    let inLedger = false;
    let datePositions: number[] = [];
    let balanceX: number | undefined;
    let moneyColumns: number[] = [];
    for (const row of pageRows) {
      if (
        (card && /^Your transactions\b/i.test(row.text)) ||
        (/\bDate\b/i.test(row.text) &&
          /Description|Details|Transaction|Merchant/i.test(row.text) &&
          /Amount|Money out|Paid out|Debit/i.test(row.text))
      ) {
        inLedger = true;
        sawLedger = true;
        datePositions = row.items
          .filter((item) => /^Date$/i.test(item.text.trim()))
          .map((item) => item.x);
        balanceX = row.items.find((item) =>
          /^Balance$/i.test(item.text.trim()),
        )?.x;
        moneyColumns = row.items
          .filter((item) =>
            /^(?:Balance|Money in|Money out|Paid in|Paid out|Debit|Credit|Amount)$/i.test(
              item.text.trim(),
            ),
          )
          .map((item) => item.x);
        if (!card) continue;
      }
      if (!inLedger) continue;
      const cardStarts = card
        ? row.items.filter((item) => dateStart.test(item.text.trim()))
        : [];
      if (
        !cardStarts.length &&
        /^(?:Ways to pay|How you can pay|Total new spend|Your Cashback|Report lost|Get help|Scan the QR|©|Page\s+\d)\b/i.test(
          row.text,
        )
      ) {
        // Credit-card reading panels end independently; a footer in one
        // panel cannot discard genuine dates still present in the other.
        if (!card) inLedger = false;
        continue;
      }
      if (
        !cardStarts.length &&
        /opening balance|closing balance|end balance|start balance|new balance|previous balance|balance (?:brought|carried) forward|^total(?:s)?\b/i.test(
          row.text,
        )
      )
        continue;
      const starts = card
        ? cardStarts
        : row.items.filter(
            (item) =>
              Math.abs(
                item.x - (datePositions[0] ?? pageRows[0]?.items[0]?.x ?? 0),
              ) < 20 && possibleDate.test(item.text.trim()),
          );
      const undated =
        !starts.length &&
        statement.institution === "Barclays" &&
        !card &&
        undatedBarclays.test(row.text);
      occurrenceCount += starts.length || (undated ? 1 : 0);
      if (balanceX !== undefined && (starts.length || undated))
        runningAnchorCount += row.items.filter(
          (item) =>
            sourceMoney.test(item.text.trim()) &&
            [...moneyColumns].sort(
              (a, b) => Math.abs(a - item.x) - Math.abs(b - item.x),
            )[0] === balanceX,
        ).length;
    }
  }
  const issues: string[] = [];
  if (sawLedger && occurrenceCount !== statement.transactions.length)
    issues.push(
      "Some printed transaction rows were not fully matched by the bank reader. Check the source PDF before importing.",
    );
  if (
    runningAnchorCount >
    statement.transactions.filter(
      (transaction) => transaction.balanceAfterTransaction !== undefined,
    ).length
  )
    issues.push(
      "Some printed running balances were not read. Check the source PDF before importing.",
    );
  return issues;
}

function validDate(value: string) {
  try {
    return parseDate(value) === value;
  } catch {
    return false;
  }
}

/** A recognised reader remains selected even if its independent proof requires review. */
export function prepareBankAdapterReading(
  source: ParsedStatement,
  rows: TextRow[],
  options: { unreadPages?: number[]; warnings?: string[] } = {},
): { parsed: ParsedStatement; bankSource: BankAdapterSource } {
  const profileId =
    source.institution === "American Express"
      ? "amex"
      : source.institution === "Revolut"
        ? "revolut"
        : source.accountType === "credit" ||
            source.accountType === "credit_card"
          ? "barclaycard"
          : "barclays-current";
  const gross = printedMovements(rows, source.currency);
  const sourceCoverageIssues = sourceCoverage(rows, source);
  const warnings = source.warnings.filter(
    (warning) => warning !== BANK_ADAPTER_PAYMENT_NOTICE,
  );
  const transactions = source.transactions.map((transaction, index) => ({
    ...transaction,
    parseRowId: `bank:${profileId}:${index + 1}`,
    parseSource: "text" as const,
    checkLevel: "review" as "review" | "balance" | "total",
  }));
  let currencyValid = true;
  try {
    currencyPrecision(source.currency);
  } catch {
    currencyValid = false;
  }
  const identityValid =
    source.institution !== "Other" &&
    !!source.accountIdentifier &&
    currencyValid &&
    validDate(source.periodStart) &&
    validDate(source.periodEnd) &&
    source.periodStart <= source.periodEnd;
  if (!identityValid)
    sourceCoverageIssues.push(
      "The statement account, dates or currency require review.",
    );
  const amountsValid = transactions.every(
    (transaction) =>
      Number.isSafeInteger(transaction.amount) &&
      (transaction.balanceAfterTransaction === undefined ||
        Number.isSafeInteger(transaction.balanceAfterTransaction)),
  );
  const reconciliation = amountsValid
    ? reconcileWithPolicy(
        source.openingBalance,
        source.closingBalance,
        transactions.map((transaction) => transaction.amount),
        "exact-v2.2",
      )
    : { status: "warning" as const };
  const movements =
    amountsValid && currencyValid
      ? statementMovements(transactions, source.currency)
      : undefined;
  const grossPass =
    !gross.ambiguous &&
    (gross.printedMoneyIn === undefined ||
      gross.printedMoneyIn === movements?.moneyIn) &&
    (gross.printedMoneyOut === undefined ||
      gross.printedMoneyOut === movements?.moneyOut);
  if (!grossPass)
    sourceCoverageIssues.push(
      "Extracted money in or money out differs from the printed summary. Check for missing or incorrectly signed transactions.",
    );
  let balance = source.openingBalance;
  let runningPass = true;
  let factsPass = transactions.length > 0;
  for (const transaction of transactions) {
    const facts =
      validDate(transaction.date) &&
      (transaction.bookingDate === undefined ||
        validDate(transaction.bookingDate)) &&
      transaction.currency === source.currency &&
      Number.isSafeInteger(transaction.amount) &&
      !!transaction.description.trim() &&
      transaction.extractionConfidence >= 0.8 &&
      !outsideStatementPeriod(
        transaction,
        source.periodStart,
        source.periodEnd,
      );
    factsPass &&= facts;
    if (balance !== undefined) balance += transaction.amount;
    const anchored = transaction.balanceAfterTransaction !== undefined;
    const rowPass =
      !anchored ||
      (Number.isSafeInteger(balance) &&
        balance === transaction.balanceAfterTransaction);
    runningPass &&= rowPass;
    if (facts && rowPass && reconciliation.status === "reconciled" && grossPass)
      transaction.checkLevel = anchored ? "balance" : "total";
  }
  if (!runningPass)
    sourceCoverageIssues.push(
      "A printed running balance differs from the extracted transaction amounts. Check the source PDF before importing.",
    );
  const reconciledExactly =
    identityValid &&
    factsPass &&
    amountsValid &&
    reconciliation.status === "reconciled" &&
    grossPass &&
    runningPass &&
    !sourceCoverageIssues.length &&
    !options.unreadPages?.length &&
    !options.warnings?.length &&
    !warnings.some(
      (warning) =>
        !/issue date but no period start/i.test(warning) &&
        warning !==
          "Statement dates were entered manually. Check both dates against the source PDF before importing.",
    );
  if (!reconciledExactly)
    for (const transaction of transactions)
      if (!factsPass || !grossPass || sourceCoverageIssues.length)
        transaction.checkLevel = "review";
  const parsed: ParsedStatement = {
    ...source,
    transactions,
    warnings: [...new Set([...warnings, ...sourceCoverageIssues])],
    validationPolicy: "exact-v2.2",
    parserMethod: "text",
    bankProfileId: profileId,
    rowsBalanceChecked: transactions.filter(
      (transaction) => transaction.checkLevel === "balance",
    ).length,
    rowsTotalChecked: transactions.filter(
      (transaction) => transaction.checkLevel === "total",
    ).length,
    rowsNeedingReview: transactions.filter(
      (transaction) => transaction.checkLevel === "review",
    ).length,
    unreadPages: options.unreadPages ?? [],
  };
  return {
    parsed,
    bankSource: {
      parsed: {
        ...parsed,
        transactions: transactions.map((transaction) => ({ ...transaction })),
        warnings: [...parsed.warnings],
        unreadPages: [...(parsed.unreadPages ?? [])],
      },
      printedMoneyIn: gross.printedMoneyIn,
      printedMoneyOut: gross.printedMoneyOut,
      reconciledExactly,
      sourceCoverageIssues: [...sourceCoverageIssues],
    },
  };
}
