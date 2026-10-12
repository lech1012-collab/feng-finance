import type {
  ParsedStatement,
  ParsedTransaction,
  Reconciliation,
} from "../../domain/models";
import { safeSum } from "../../domain/money";
import { parseDate } from "../../domain/dates";
import { outsideStatementPeriod } from "../statement-period";
import {
  normalizeDescription,
  normalizeMerchant,
} from "../../domain/normalize";
import type {
  BankProfile,
  CandidateReading,
  ColumnRole,
  ExtractedTextItem,
  GenericParseOptions,
  GenericParseResult,
  LayoutMapping,
  ReconstructedRow,
  ReconstructedTable,
  RowCheck,
  RowReading,
  SignConvention,
  SourcePage,
  StatementChecks,
  StatementParserMetadata,
  TableCell,
  TransactionParserMetadata,
} from "./types";
import { reconstructTable, textQuality } from "./table";
import { reconstructCardRegions } from "./card-regions";
import { readDate, readMoney } from "./tokens";
import { detectProfile } from "./profiles";
import { identifyMetadata, type StatementMetadata } from "./metadata";

function pageFor(table: ReconstructedTable, columnId: string) {
  return (
    table.pages.find((p) => columnId.startsWith(`p${p.page}-`)) ??
    table.pages[0]
  );
}
function mappings(
  table: ReconstructedTable,
  options: GenericParseOptions,
  profile?: BankProfile,
): LayoutMapping[] {
  if (options.mapping) return [options.mapping];
  if (options.template) {
    return [
      {
        columnRoles: table.columns.map((column) => {
          const width = pageFor(table, column.id).width;
          const x0 = column.x0 / width,
            x1 = column.x1 / width;
          const match = options
            .template!.columnRoles.map((band) => ({
              band,
              overlap: Math.max(
                0,
                Math.min(x1, band.x1) - Math.max(x0, band.x0),
              ),
            }))
            .sort((a, b) => b.overlap - a.overlap)[0];
          return {
            columnId: column.id,
            role: match?.overlap > 0 ? match.band.role : "ignore",
          };
        }),
        signConvention: options.template.signConvention,
        balanceSign: options.template.balanceSign,
        dateFormat: validDateFormat(options.template.dateFormat),
      },
    ];
  }
  const base = table.columns.map((c) => ({
    columnId: c.id,
    role: c.inferredRole ?? "ignore",
  }));
  const result: LayoutMapping[] = [];
  const hasSeparate = base.some((c) => c.role === "in" || c.role === "out");
  const conventions: SignConvention[] = hasSeparate
    ? ["in_out_columns"]
    : ["signed_positive_in", "signed_positive_out"];
  for (const signConvention of conventions) {
    result.push({ columnRoles: base, signConvention, dateFormat: "auto" });
    if (hasSeparate)
      result.push({
        columnRoles: base.map((c) => ({
          ...c,
          role: c.role === "in" ? "out" : c.role === "out" ? "in" : c.role,
        })),
        signConvention,
        dateFormat: "auto",
      });
  }
  // Column positions are normalized so the same assignment applies on repeated pages.
  const numericPositions = [
    ...new Set(
      table.columns
        .filter((c) => numericRole(c.inferredRole))
        .map((c) => Math.round((c.x0 / pageFor(table, c.id).width) * 100)),
    ),
  ].sort((a, b) => a - b);
  const independentPanels = table.pages.some((page) => {
    const dates = table.columns
      .filter(
        (column) =>
          column.id.startsWith(`p${page.page}-`) &&
          column.inferredRole === "date",
      )
      .map((column) => column.x0);
    return (
      dates.length > 1 &&
      Math.max(...dates) - Math.min(...dates) > page.width * 0.25
    );
  });
  // Two horizontal reading panels each have their own amount column. They
  // must not be tried as a single Amount/Balance pair across the page.
  if (!hasSeparate && numericPositions.length === 2 && !independentPanels)
    for (const balancePosition of numericPositions)
      for (const signConvention of [
        "signed_positive_in",
        "signed_positive_out",
      ] as const) {
        result.push({
          columnRoles: base.map((c) => {
            const column = table.columns.find((k) => k.id === c.columnId)!;
            return numericRole(c.role)
              ? {
                  ...c,
                  role:
                    Math.round(
                      (column.x0 / pageFor(table, c.columnId).width) * 100,
                    ) === balancePosition
                      ? "balance"
                      : "amount",
                }
              : c;
          }),
          signConvention,
          dateFormat: "auto",
        });
      }
  if (hasSeparate && numericPositions.length === 3) {
    // A balance can occupy any numeric column; headers are a tie-breaker after proof.
    for (const balancePosition of numericPositions)
      for (const reverse of [false, true]) {
        const other = numericPositions.filter((p) => p !== balancePosition);
        result.push({
          columnRoles: base.map((c) => {
            if (!numericRole(c.role)) return c;
            const column = table.columns.find((k) => k.id === c.columnId)!;
            const position = Math.round(
              (column.x0 / pageFor(table, c.columnId).width) * 100,
            );
            return {
              ...c,
              role:
                position === balancePosition
                  ? "balance"
                  : position === other[0]
                    ? reverse
                      ? "in"
                      : "out"
                    : reverse
                      ? "out"
                      : "in",
            };
          }),
          signConvention: "in_out_columns",
          dateFormat: "auto",
        });
      }
  }
  const seen = new Set<string>();
  return result
    .filter((m) => {
      const key = JSON.stringify(m);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 32)
    .sort(
      (a, b) =>
        Number(b.signConvention === profile?.signConventionHint) -
        Number(a.signConvention === profile?.signConventionHint),
    );
}
function validDateFormat(value: string): LayoutMapping["dateFormat"] {
  return ["day-first", "month-first", "iso", "named-month", "auto"].includes(
    value,
  )
    ? (value as LayoutMapping["dateFormat"])
    : "auto";
}
function numericRole(role: ColumnRole | undefined) {
  return (
    role !== undefined && ["amount", "balance", "in", "out"].includes(role)
  );
}
interface InterpretationContext {
  roles: Map<string, ColumnRole>;
  continuations: Map<string, ReconstructedRow[]>;
}
function contextFor(
  table: ReconstructedTable,
  mapping: LayoutMapping,
): InterpretationContext {
  const continuations = new Map<string, ReconstructedRow[]>();
  for (const row of table.rows)
    if (row.continuesRowId) {
      const previous = continuations.get(row.continuesRowId) ?? [];
      previous.push(row);
      continuations.set(row.continuesRowId, previous);
    }
  return {
    roles: new Map(mapping.columnRoles.map((c) => [c.columnId, c.role])),
    continuations,
  };
}
function roleCells(
  context: InterpretationContext,
  row: ReconstructedRow,
  role: ColumnRole,
): TableCell[] {
  return [row, ...(context.continuations.get(row.id) ?? [])]
    .flatMap((r) => r.cells)
    .filter((cell) => context.roles.get(cell.columnId) === role);
}
function readingIdentity(
  rowId: string,
  reading: Pick<
    RowReading,
    "date" | "amount" | "balanceAfterTransaction" | "description"
  >,
): string {
  // Ephemeral UI identity only. Financial duplicate fingerprints use SHA-256 elsewhere.
  const value = JSON.stringify([
    reading.date,
    reading.amount,
    reading.balanceAfterTransaction,
    reading.description,
  ]);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${rowId}-reading-${(hash >>> 0).toString(16)}`;
}
function interpretRow(
  context: InterpretationContext,
  row: ReconstructedRow,
  mapping: LayoutMapping,
  metadata: StatementMetadata,
  previousDate?: string,
): RowReading {
  const dates = roleCells(context, row, "date");
  const descriptions = roleCells(context, row, "description");
  const primaryDate = dates.find((c) => c.text.trim());
  const date = primaryDate
    ? readDate(primaryDate.text, metadata.period!, mapping.dateFormat)
    : dates.length
      ? undefined
      : previousDate;
  const booking = dates.find(
    (c) =>
      c !== primaryDate &&
      readDate(c.text, metadata.period!, mapping.dateFormat),
  );
  const description = normalizeDescription(
    descriptions.map((c) => c.text).join(" "),
  );
  const first = (role: ColumnRole) =>
    roleCells(context, row, role).filter((c) => c.text.trim());
  const rawAmount = first("amount")
      .map((c) => c.text)
      .join(" "),
    rawIn = first("in")
      .map((c) => c.text)
      .join(" "),
    rawOut = first("out")
      .map((c) => c.text)
      .join(" ");
  const rawBalance = first("balance")
    .map((c) => c.text)
    .join(" ");
  let amount: number | undefined;
  if (mapping.signConvention === "in_out_columns") {
    const incoming = rawIn ? readMoney(rawIn, metadata.currency) : 0,
      outgoing = rawOut ? readMoney(rawOut, metadata.currency) : 0;
    if ((rawIn || rawOut) && incoming !== undefined && outgoing !== undefined)
      amount = Math.abs(incoming) - Math.abs(outgoing);
  } else {
    const raw = readMoney(rawAmount, metadata.currency);
    if (raw !== undefined) {
      if (mapping.signConvention === "signed_positive_in") amount = raw;
      else {
        const credit = /\bCR\b/i.test(rawAmount),
          debit = /\bDR\b/i.test(rawAmount);
        const sectionPayment = metadata.profile?.sectionSignHints?.some(
          (hint) =>
            hint.direction === "in" && hint.pattern.test(row.section ?? ""),
        );
        const payment =
          /payment received|payment thank you|direct debit\s*[-–]?\s*payment/i.test(
            description,
          ) || sectionPayment;
        amount = debit
          ? -Math.abs(raw)
          : credit || raw < 0 || payment
            ? Math.abs(raw)
            : -Math.abs(raw);
      }
    }
  }
  const cells = [
    ...dates,
    ...descriptions,
    ...first("amount"),
    ...first("in"),
    ...first("out"),
    ...first("balance"),
  ];
  const reading: RowReading = {
    id: "",
    date,
    bookingDate: booking
      ? readDate(booking.text, metadata.period!, mapping.dateFormat)
      : undefined,
    description,
    merchant: normalizeMerchant(description),
    amount,
    balanceAfterTransaction: rawBalance
      ? readMoney(rawBalance, metadata.currency)
      : undefined,
    parseSource: cells.some((c) => c.parseSource === "ocr") ? "ocr" : "text",
    rawDate: dates.map((c) => c.text).join(" "),
    rawAmount:
      rawAmount ||
      (rawIn ? `in ${rawIn}` : "") + (rawOut ? ` out ${rawOut}` : ""),
    rawBalance,
  };
  reading.id = readingIdentity(row.id, reading);
  return reading;
}
function evaluate(
  table: ReconstructedTable,
  mapping: LayoutMapping,
  metadata: StatementMetadata,
  options: GenericParseOptions,
  id: string,
  balanceSign: 1 | -1,
  accepted?: Map<string, RowReading>,
): CandidateReading {
  const context = contextFor(table, mapping);
  const checks: RowCheck[] = [];
  let previousBalance = metadata.openingBalance,
    previousDate: string | undefined;
  const amounts: number[] = [];
  const hasBalance = mapping.columnRoles.some((c) => c.role === "balance");
  for (const row of table.rows.filter((r) => r.kind === "transaction")) {
    let reading = interpretRow(context, row, mapping, metadata, previousDate);
    if (reading.balanceAfterTransaction !== undefined)
      reading.balanceAfterTransaction *= balanceSign;
    reading.id = readingIdentity(row.id, reading);
    const action = options.actions?.[row.id];
    if (action?.kind === "accept" && accepted?.has(row.id))
      reading = { ...accepted.get(row.id)! };
    if (action?.kind === "correct") {
      reading = {
        ...reading,
        date: action.date,
        description: normalizeDescription(action.description),
        merchant: normalizeMerchant(action.description),
        amount: action.amount,
        balanceAfterTransaction:
          action.balanceAfterTransaction ?? reading.balanceAfterTransaction,
        parseSource: "user",
      };
      reading.id = readingIdentity(row.id, reading);
    }
    if (reading.date) previousDate = reading.date;
    else if (reading.rawDate) previousDate = undefined;
    const excluded = action?.kind === "exclude";
    const issues: RowCheck["issues"] = [];
    if (
      !reading.date ||
      !isValidDate(reading.date) ||
      (reading.bookingDate !== undefined && !isValidDate(reading.bookingDate))
    )
      issues.push("invalid-date");
    else if (
      outsideStatementPeriod(
        { date: reading.date, bookingDate: reading.bookingDate },
        metadata.period!.start,
        metadata.period!.end,
      )
    )
      issues.push("outside-period");
    if (reading.amount === undefined || !Number.isSafeInteger(reading.amount))
      issues.push("invalid-amount");
    if (!reading.description) issues.push("missing-description");
    const balanceCells = roleCells(context, row, "balance");
    let calculatedBalance: number | undefined, difference: number | undefined;
    if (hasBalance && !excluded) {
      if (
        reading.balanceAfterTransaction === undefined ||
        previousBalance === undefined
      )
        issues.push("missing-balance");
      if (
        previousBalance !== undefined &&
        reading.amount !== undefined &&
        Number.isSafeInteger(reading.amount)
      ) {
        calculatedBalance = safeSum([previousBalance, reading.amount]);
        if (reading.balanceAfterTransaction !== undefined) {
          difference = calculatedBalance - reading.balanceAfterTransaction;
          if (difference !== 0) issues.push("balance-difference");
        }
      }
    }
    const resolved = excluded || !issues.length;
    const check: RowCheck = {
      rowId: row.id,
      checkLevel:
        resolved && hasBalance && !excluded
          ? reading.parseSource === "ocr"
            ? "ocr"
            : "balance"
          : "review",
      parseSource: reading.parseSource,
      readings: [reading],
      selectedReadingId: reading.id,
      rect: row.rect,
      amountRects: [
        ...roleCells(context, row, "amount"),
        ...roleCells(context, row, "in"),
        ...roleCells(context, row, "out"),
      ].map((c) => c.rect),
      balanceRects: balanceCells.map((c) => c.rect),
      previousBalance,
      calculatedBalance,
      reportedBalance: reading.balanceAfterTransaction,
      difference,
      issues,
      resolved,
      ...(action ? { reviewAction: action } : {}),
    };
    // Acknowledging a valid alternative can resolve the row; unequal arithmetic still needs a statement override.
    if (
      action?.kind === "accept" &&
      accepted?.has(row.id) &&
      !issues.some((issue) =>
        ["invalid-date", "invalid-amount", "missing-description"].includes(
          issue,
        ),
      )
    ) {
      check.resolved = true;
      check.checkLevel = issues.length ? "manual_override" : check.checkLevel;
    }
    if (excluded) {
      check.issues = [];
      check.checkLevel = "manual_override";
    }
    checks.push(check);
    if (excluded) continue;
    if (reading.amount !== undefined && Number.isSafeInteger(reading.amount))
      amounts.push(reading.amount);
    if (reading.balanceAfterTransaction !== undefined)
      previousBalance = reading.balanceAfterTransaction;
    else if (calculatedBalance !== undefined)
      previousBalance = calculatedBalance;
  }
  const included = checks.filter((c) => c.reviewAction?.kind !== "exclude");
  const income = safeSum(amounts.filter((a) => a > 0)),
    out = safeSum(amounts.filter((a) => a < 0).map((a) => -a));
  const firstBalances = included.filter((c) => c.reportedBalance !== undefined);
  const allRowsBalances =
    firstBalances.length === included.length && included.length > 0;
  const lastBalance = allRowsBalances
    ? firstBalances.at(-1)?.reportedBalance
    : undefined;
  const reported = metadata.closingBalance ?? lastBalance;
  let reconciliation: Reconciliation = { status: "unavailable" };
  if (metadata.openingBalance !== undefined && reported !== undefined) {
    const calculated = safeSum([metadata.openingBalance, ...amounts]);
    const difference = calculated - reported;
    reconciliation = {
      status: difference === 0 ? "reconciled" : "warning",
      calculated,
      reported,
      difference,
    };
  }
  const inDifference =
      metadata.printedMoneyIn === undefined
        ? undefined
        : income - metadata.printedMoneyIn,
    outDifference =
      metadata.printedMoneyOut === undefined
        ? undefined
        : out - metadata.printedMoneyOut;
  const movementEvidence =
    inDifference !== undefined && outDifference !== undefined;
  if (reconciliation.status === "unavailable" && movementEvidence)
    reconciliation = {
      status:
        inDifference === 0 && outDifference === 0 ? "reconciled" : "warning",
      difference: inDifference !== 0 ? inDifference : outDifference,
    };
  // Printed statement totals also validate rows lacking individual balance anchors.
  // Keep the distinction: these rows are total-checked, never individually balance-checked.
  const totalsExact =
    reconciliation.status === "reconciled" &&
    (inDifference === undefined || inDifference === 0) &&
    (outDifference === undefined || outDifference === 0);
  if (
    totalsExact &&
    included.every(
      (row) =>
        !row.issues.some((issue) =>
          [
            "invalid-date",
            "invalid-amount",
            "missing-description",
            "balance-difference",
          ].includes(issue),
        ),
    )
  )
    for (const check of included) {
      if (check.issues.length === 1 && check.issues[0] === "missing-balance") {
        check.issues = [];
        check.resolved = true;
        check.checkLevel = check.parseSource === "ocr" ? "ocr" : "total";
      }
    }
  const failed = included.filter(
      (c) =>
        c.issues.includes("balance-difference") ||
        c.issues.includes("missing-balance"),
    ).length,
    passed = included.filter(
      (c) => c.difference === 0 && c.issues.length === 0,
    ).length;
  const evidence: StatementChecks["evidence"] = [];
  if (allRowsBalances && metadata.openingBalance !== undefined)
    evidence.push("running-balances");
  if (
    metadata.openingBalance !== undefined &&
    metadata.closingBalance !== undefined
  )
    evidence.push("opening-closing");
  if (movementEvidence) evidence.push("printed-movement-totals");
  const usableReadings = included.every(
    (c) =>
      !c.issues.some((i) =>
        [
          "invalid-date",
          "outside-period",
          "invalid-amount",
          "missing-description",
        ].includes(i),
      ),
  );
  const exact =
    included.length > 0 &&
    evidence.length > 0 &&
    reconciliation.status === "reconciled" &&
    failed === 0 &&
    (inDifference === undefined || inDifference === 0) &&
    (outDifference === undefined || outDifference === 0) &&
    usableReadings;
  if (!hasBalance && exact)
    for (const check of included)
      if (!check.issues.length) {
        check.checkLevel = check.parseSource === "ocr" ? "ocr" : "total";
        check.resolved = true;
      }
  if (!hasBalance && !exact)
    for (const check of included)
      if (!check.reviewAction) {
        check.checkLevel = "review";
        check.resolved = false;
      }
  if (!exact && reconciliation.status === "reconciled")
    reconciliation = { ...reconciliation, status: "warning" };
  const summary: StatementChecks = {
    policy: "exact-v2.2",
    reconciliation,
    printedMoneyIn: metadata.printedMoneyIn,
    printedMoneyOut: metadata.printedMoneyOut,
    calculatedMoneyIn: income,
    calculatedMoneyOut: out,
    moneyInDifference: inDifference,
    moneyOutDifference: outDifference,
    balanceRowsPassed: passed,
    balanceRowsFailed: failed,
    totalCheckedRows: included.filter((c) => c.checkLevel === "total").length,
    needsReviewRows: included.filter((c) => !c.resolved).length,
    unreadPages: options.unreadPages ?? [],
    evidence,
    reconciledExactly: exact && !options.unreadPages?.length,
  };
  if (options.unreadPages?.length) {
    summary.reconciliation = { ...summary.reconciliation, status: "warning" };
    summary.needsReviewRows += options.unreadPages.length;
  }
  const inferredRoles = new Map(
    table.columns.map((c) => [c.id, c.inferredRole]),
  );
  const headerMatchScore = mapping.columnRoles.reduce(
    (score, column) =>
      score + Number(inferredRoles.get(column.columnId) === column.role),
    0,
  );
  return {
    id,
    mapping: { ...mapping, balanceSign },
    rows: checks,
    checks: summary,
    headerMatchScore,
    profileHintScore:
      Number(mapping.signConvention === options.profile?.signConventionHint) +
      Number(
        hasBalance &&
          table.columns.some((column) => column.inferredRole === "balance") &&
          balanceSign ===
            (metadata.accountType === "credit" ||
            metadata.accountType === "credit_card"
              ? -1
              : 1),
      ),
  };
}
function isValidDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  try {
    return parseDate(date) === date;
  } catch {
    return false;
  }
}
function transactions(
  candidate: CandidateReading,
  currency: string,
  templateId?: string,
): (ParsedTransaction & TransactionParserMetadata)[] {
  return candidate.rows.flatMap((check) => {
    if (check.reviewAction?.kind === "exclude") return [];
    const reading =
      check.readings.find((r) => r.id === check.selectedReadingId) ??
      check.readings[0];
    if (
      !reading.date ||
      !isValidDate(reading.date) ||
      (reading.bookingDate !== undefined &&
        !isValidDate(reading.bookingDate)) ||
      reading.amount === undefined ||
      !Number.isSafeInteger(reading.amount) ||
      !reading.description
    )
      return [];
    const isPayment =
      reading.amount > 0 &&
      /payment received|payment thank you|direct debit\s*[-–]?\s*payment/i.test(
        reading.description,
      );
    return [
      {
        date: reading.date,
        bookingDate: reading.bookingDate,
        description: reading.description,
        merchant: reading.merchant ?? normalizeMerchant(reading.description),
        amount: reading.amount,
        currency,
        balanceAfterTransaction: reading.balanceAfterTransaction,
        type: isPayment
          ? ("transfer" as const)
          : reading.amount >= 0
            ? ("income" as const)
            : ("expense" as const),
        sourcePage: check.rect.page,
        extractionConfidence:
          check.checkLevel === "review"
            ? 0.5
            : check.parseSource === "ocr"
              ? 0.6
              : 1,
        checkLevel: check.checkLevel,
        parseSource: check.parseSource,
        parseRowId: check.rowId,
        layoutTemplateId: templateId,
      },
    ];
  });
}
function selectedReading(row: RowCheck) {
  return (
    row.readings.find((reading) => reading.id === row.selectedReadingId) ??
    row.readings[0]
  );
}
function candidateSignature(candidate: CandidateReading) {
  return JSON.stringify(
    candidate.rows.map((row) => {
      const r = selectedReading(row);
      return [
        r.date,
        r.amount,
        r.balanceAfterTransaction,
        r.description,
        row.reviewAction?.kind === "exclude",
      ];
    }),
  );
}
export function layoutFingerprintMaterial(
  table: ReconstructedTable,
  metadata: Pick<StatementMetadata, "institution">,
): string {
  const headers = table.columns.map((c) => ({
    role: c.inferredRole ?? "ignore",
    header: headerRoleForFingerprint(c.headerText),
    x0: Math.round((c.x0 / pageFor(table, c.id).width) * 1000),
    x1: Math.round((c.x1 / pageFor(table, c.id).width) * 1000),
  }));
  // Only allowlisted header roles and known issuer identity: no file, merchant, account, date or amount text.
  const issuer =
    metadata.institution !== "Other" ? metadata.institution : "unprofiled";
  return JSON.stringify({
    issuer,
    headers: [...new Map(headers.map((h) => [JSON.stringify(h), h])).values()],
  });
}
function headerRoleForFingerprint(text: string) {
  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\d|[£€$]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Headers reconstructed from an unknown name must not become a fingerprint field.
  return /^(?:transaction |posting |process |booking )?date$|^(?:transaction )?(?:description|details|merchant|reference|narrative)$|^(?:paid in|money in|credit|credits|received|receipts|deposit|deposits|paid out|money out|debit|debits|withdrawal|withdrawals|spent|payments out|signed amount|amount|balance|running balance|account balance|closing balance|foreign spend|foreign amount|currency|rate|exchange rate)$/.test(
    normalized,
  )
    ? normalized
    : "unlabelled";
}
const sessions = new WeakMap<
  GenericParseResult,
  {
    items: ExtractedTextItem[];
    pages: SourcePage[];
    options: GenericParseOptions;
  }
>();
/** Recheck a live import only. Raw source is held weakly in memory, never persisted here. */
export function recheckGenericStatement(
  result: GenericParseResult,
  options: GenericParseOptions = {},
): GenericParseResult {
  const source = sessions.get(result);
  if (!source)
    throw new Error(
      "The import session has ended. Select the statement again.",
    );
  return parseGenericStatement(source.items, source.pages, {
    ...source.options,
    ...options,
  });
}
export function parseGenericStatement(
  items: ExtractedTextItem[],
  pages: SourcePage[],
  options: GenericParseOptions = {},
): GenericParseResult {
  const profile = options.profile ?? detectProfile(items);
  const effective = { ...options, profile };
  const table =
    (profile?.id === "barclaycard"
      ? reconstructCardRegions(items, pages)
      : undefined) ?? reconstructTable(items, pages);
  const metadata = identifyMetadata(items, table, effective);
  const quality = textQuality(items, pages);
  const emptyChecks: StatementChecks = {
    policy: "exact-v2.2",
    reconciliation: { status: "unavailable" },
    calculatedMoneyIn: 0,
    calculatedMoneyOut: 0,
    balanceRowsPassed: 0,
    balanceRowsFailed: 0,
    totalCheckedRows: 0,
    needsReviewRows: 0,
    unreadPages: options.unreadPages ?? [],
    evidence: [],
    reconciledExactly: false,
  };
  const initial: GenericParseResult = {
    status: "mapping-required",
    table,
    rowChecks: [],
    candidates: [],
    checks: emptyChecks,
    layoutFingerprint: layoutFingerprintMaterial(table, metadata),
    profileId: profile?.id,
  };
  const finish = (result: GenericParseResult) => {
    sessions.set(result, { items, pages, options: effective });
    return result;
  };
  if (!pages.length) return finish({ ...initial, errorCode: "mapping-needed" });
  if (!metadata.period)
    return finish({
      ...initial,
      status: "identity-required",
      errorCode: "missing-period",
    });
  if (!metadata.currency)
    return finish({
      ...initial,
      status: "identity-required",
      errorCode: "missing-currency",
    });
  const hypotheses = mappings(table, effective, profile).flatMap(
    (mapping, index) => {
      const hasBalance = mapping.columnRoles.some((c) => c.role === "balance");
      return (
        mapping.balanceSign
          ? [mapping.balanceSign]
          : hasBalance
            ? ([1, -1] as const)
            : ([1] as const)
      ).map((balanceSign) => ({
        mapping,
        balanceSign,
        id: `reading-${index}-${balanceSign}`,
      }));
    },
  );
  const baseline = hypotheses.map((h) =>
    evaluate(
      table,
      h.mapping,
      metadata,
      { ...effective, actions: undefined },
      h.id,
      h.balanceSign,
    ),
  );
  const accepted = new Map<string, RowReading>();
  for (const [rowId, action] of Object.entries(options.actions ?? {}))
    if (action.kind === "accept") {
      const reading = baseline
        .flatMap(
          (candidate) =>
            candidate.rows.find((row) => row.rowId === rowId)?.readings ?? [],
        )
        .concat(options.alternatives?.[rowId] ?? [])
        .find((reading) => reading.id === action.readingId);
      if (reading) accepted.set(rowId, reading);
    }
  const candidates = (
    options.actions
      ? hypotheses.map((h) =>
          evaluate(
            table,
            h.mapping,
            metadata,
            effective,
            h.id,
            h.balanceSign,
            accepted,
          ),
        )
      : baseline
  ).sort(
    (a, b) =>
      b.checks.balanceRowsPassed - a.checks.balanceRowsPassed ||
      Number(b.checks.reconciledExactly) - Number(a.checks.reconciledExactly) ||
      a.checks.needsReviewRows - b.checks.needsReviewRows ||
      b.profileHintScore - a.profileHintScore ||
      b.headerMatchScore - a.headerMatchScore,
  );
  const selected = candidates[0];
  if (!selected || !selected.rows.length)
    return finish({ ...initial, errorCode: "mapping-needed" });
  const tie = candidates.find(
    (c) =>
      c !== selected &&
      c.checks.balanceRowsPassed === selected.checks.balanceRowsPassed &&
      c.checks.reconciledExactly === selected.checks.reconciledExactly &&
      c.checks.needsReviewRows === selected.checks.needsReviewRows &&
      c.profileHintScore === selected.profileHintScore &&
      c.headerMatchScore === selected.headerMatchScore &&
      candidateSignature(c) !== candidateSignature(selected),
  );
  const alternativesByRow = new Map<string, RowReading[]>();
  for (const candidate of candidates)
    for (const row of candidate.rows) {
      const readings = alternativesByRow.get(row.rowId) ?? [];
      readings.push(...row.readings);
      alternativesByRow.set(row.rowId, readings);
    }
  const tiedRows = new Map(tie?.rows.map((row) => [row.rowId, row]) ?? []);
  for (const check of selected.rows) {
    const original = selectedReading(check);
    const alternates = [
      ...(alternativesByRow.get(check.rowId) ?? []),
      ...(options.alternatives?.[check.rowId] ?? []),
    ];
    const seen = new Set<string>([
      JSON.stringify([
        original.date,
        original.amount,
        original.balanceAfterTransaction,
        original.description,
      ]),
    ]);
    check.readings.push(
      ...alternates
        .filter((reading) => {
          const key = JSON.stringify([
            reading.date,
            reading.amount,
            reading.balanceAfterTransaction,
            reading.description,
          ]);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((reading) => ({ ...reading })),
    );
    if (
      tie &&
      check.reviewAction?.kind !== "exclude" &&
      check.reviewAction?.kind !== "accept"
    ) {
      const tiedRow = tiedRows.get(check.rowId);
      if (
        tiedRow &&
        JSON.stringify(selectedReading(tiedRow)) !== JSON.stringify(original)
      ) {
        check.issues.push("ambiguous-reading");
        check.resolved = false;
        check.checkLevel = "review";
      }
    }
  }
  if (tie) {
    selected.checks.reconciledExactly = false;
    selected.checks.needsReviewRows = selected.rows.filter(
      (row) => !row.resolved,
    ).length;
    selected.checks.reconciliation = {
      ...selected.checks.reconciliation,
      status: "warning",
    };
  }
  if (quality.some((page) => !page.usable)) {
    selected.checks.reconciledExactly = false;
    selected.checks.reconciliation = {
      ...selected.checks.reconciliation,
      status: "warning",
    };
  }
  const sources = new Set(items.map((item) => item.parseSource));
  const parsed: ParsedStatement & StatementParserMetadata = {
    institution: metadata.institution,
    accountIdentifier: metadata.accountIdentifier,
    accountType: metadata.accountType,
    periodStart: metadata.period.start,
    periodEnd: metadata.period.end,
    periodSource: options.period ? "manual" : "printed",
    currency: metadata.currency,
    openingBalance: metadata.openingBalance,
    closingBalance: metadata.closingBalance,
    transactions: transactions(
      selected,
      metadata.currency,
      options.template?.id,
    ),
    warnings: [],
    parserMethod: options.mapping
      ? "user_mapping"
      : options.template
        ? "template"
        : sources.size > 1
          ? "text+ocr"
          : sources.has("ocr")
            ? "ocr"
            : "text",
    validationPolicy: "exact-v2.2",
    rowsBalanceChecked: selected.checks.balanceRowsPassed,
    rowsTotalChecked: selected.checks.totalCheckedRows,
    rowsNeedingReview: selected.checks.needsReviewRows,
    bankProfileId: profile?.id,
    rowsExcludedByReview: selected.rows.filter(
      (row) => row.reviewAction?.kind === "exclude",
    ).length,
    unreadPages: options.unreadPages,
    layoutTemplateId: options.template?.id,
  };
  if (selected.checks.needsReviewRows)
    parsed.warnings.push(
      `${selected.checks.needsReviewRows} source rows need checking against this statement.`,
    );
  if (!selected.checks.reconciledExactly)
    parsed.warnings.push(
      "The extracted rows do not reconcile exactly to independent statement figures. Check the rows or map the columns before importing.",
    );
  if (!metadata.accountIdentifier)
    parsed.warnings.push(
      "Choose or identify the matching account before importing.",
    );
  if (quality.some((p) => !p.usable))
    parsed.warnings.push(
      "Some pages need to be read from their images on this device.",
    );
  return finish({
    ...initial,
    status: !metadata.accountIdentifier
      ? "identity-required"
      : selected.checks.reconciledExactly && !tie
        ? "parsed"
        : "mapping-required",
    parsed,
    rowChecks: selected.rows,
    candidates,
    checks: selected.checks,
    selectedCandidateId: selected.id,
    mapping: selected.mapping,
    errorCode: !metadata.accountIdentifier
      ? "missing-account"
      : effective.template && !selected.checks.reconciledExactly
        ? "template-changed"
        : selected.checks.needsReviewRows
          ? "rows-need-review"
          : !selected.checks.reconciledExactly
            ? "mapping-needed"
            : undefined,
  });
}
