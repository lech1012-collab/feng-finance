import type {
  Account,
  Institution,
  ParsedStatement,
  TextRow,
} from "../domain/models";
import { id } from "../domain/normalize";
import { reconcileWithPolicy } from "../domain/reconcile";
import { parseDate } from "../domain/dates";
import { getParser } from "../parsers";
import { PARSER_VERSION } from "../parsers/interface";
import { retainImportDiagnostics } from "../storage/import-diagnostics";
import { db } from "../storage/database";
import {
  saveLayoutTemplate,
  markLayoutTemplateChecked,
} from "../storage/layout-templates";
import {
  parseGenericStatement,
  compareLegacyTransactions,
  detectProfile,
} from "./generic";
import type {
  GenericParseOptions,
  GenericParseResult,
  LayoutMapping,
  LayoutTemplate,
  RowReading,
  SourceRect,
} from "./generic/types";
import type { ExtractedFile } from "./pipeline";
import type { ImportProgress } from "./pdf-session-types";
import { isImportAbort } from "./pdf-abort";
import { statementMovements } from "./movements";

export interface PdfReviewOptions extends GenericParseOptions {
  signal?: AbortSignal;
  progress?: (progress: ImportProgress) => void;
  skipCellOcr?: boolean;
}

/** Source readings and OCR alternatives live only until the import is closed. */
const cellReadings = new WeakMap<ExtractedFile, Record<string, RowReading[]>>();

function selected(check: GenericParseResult["rowChecks"][number]) {
  return (
    check.readings.find((r) => r.id === check.selectedReadingId) ??
    check.readings[0]
  );
}
function overlaps(
  item: { page: number; x: number; y: number; width: number; height: number },
  rect: SourceRect,
) {
  const cx = item.x + item.width / 2,
    cy = item.y + item.height / 2;
  return (
    item.page === rect.page &&
    cx >= rect.x - 1 &&
    cx <= rect.x + rect.width + 1 &&
    cy >= rect.y - 2 &&
    cy <= rect.y + rect.height + 2
  );
}

/** Try only numeric cells. A changed reading is accepted automatically only with exact row arithmetic. */
async function checkNumericCells(
  extracted: ExtractedFile,
  result: GenericParseResult,
  options: PdfReviewOptions,
) {
  if (
    !extracted.pdfSession ||
    !extracted.extraction ||
    options.skipCellOcr ||
    options.signal?.aborted
  )
    return result;
  const targets = result.rowChecks.filter(
    (row) =>
      row.reviewAction?.kind !== "exclude" &&
      row.issues.some((issue) =>
        ["invalid-amount", "balance-difference"].includes(issue),
      ) &&
      row.amountRects.length + row.balanceRects.length > 0,
  );
  if (!targets.length) return result;
  const rects = targets.flatMap((row) => [
    ...row.amountRects,
    ...row.balanceRects,
  ]);
  let cells;
  try {
    cells = await extracted.pdfSession.readCells(rects, {
      signal: options.signal,
      progress: options.progress,
    });
  } catch (error) {
    if (isImportAbort(error)) return result;
    // Numeric OCR is an optional second reading. Keep the original source review on failure.
    return result;
  }
  const alternatives = cellReadings.get(extracted) ?? {};
  const items = [...extracted.extraction.items];
  let current = result;
  for (const target of targets) {
    const targetRects = [...target.amountRects, ...target.balanceRects];
    const targetCells = cells.filter((cell) =>
      targetRects.some(
        (rect) =>
          rect.page === cell.rect.page &&
          rect.x === cell.rect.x &&
          rect.y === cell.rect.y,
      ),
    );
    if (!targetCells.some((cell) => cell.items.length)) continue;
    const trialItems = [
      ...items.filter(
        (item) => !targetRects.some((rect) => overlaps(item, rect)),
      ),
      ...targetCells.flatMap((cell) => cell.items),
    ];
    const trial = parseGenericStatement(
      trialItems,
      extracted.extraction.pages,
      { ...options, alternatives },
    );
    const checked = trial.rowChecks.find((row) => row.rowId === target.rowId);
    if (!checked) continue;
    const reading = selected(checked);
    if (!reading) continue;
    alternatives[target.rowId] = [
      ...(alternatives[target.rowId] ?? []),
      reading,
    ];
    const unaffected = current.rowChecks
      .filter((row) => row.rowId !== target.rowId)
      .every((row) => {
        const other = trial.rowChecks.find((next) => next.rowId === row.rowId);
        const before = selected(row),
          after = other && selected(other);
        return (
          before?.date === after?.date &&
          before?.amount === after?.amount &&
          before?.balanceAfterTransaction === after?.balanceAfterTransaction &&
          before?.description === after?.description
        );
      });
    if (checked.difference === 0 && checked.issues.length === 0 && unaffected) {
      items.splice(0, items.length, ...trialItems);
      current = trial;
    }
  }
  cellReadings.set(extracted, alternatives);
  // Update the in-memory extraction only for readings independently proved by a running balance.
  extracted.extraction.items.splice(
    0,
    extracted.extraction.items.length,
    ...items,
  );
  return parseGenericStatement(items, extracted.extraction.pages, {
    ...options,
    alternatives,
  });
}

function legacyParsed(
  rows: TextRow[],
  bank: Institution,
  options: PdfReviewOptions,
): ParsedStatement | undefined {
  if (bank === "Other") return undefined;
  try {
    return getParser(bank, rows).parse(rows, options.period);
  } catch {
    return undefined;
  }
}

/** Bank adapters remain a conservative comparison path while layout parsing broadens support. */
export async function preparePdfReading(
  extracted: ExtractedFile,
  bank: Institution,
  account: Account | undefined,
  review: PdfReviewOptions = {},
) {
  if (!extracted.extraction) {
    // In-memory callers and old synthetic fixtures keep the existing adapter API.
    const parsed = getParser(bank, extracted.rows).parse(
      extracted.rows,
      review.period,
    );
    return {
      parsed: { ...parsed, validationPolicy: "exact-v2.2" as const },
      fallback: false,
    };
  }
  const profile = detectProfile(extracted.extraction.items);
  const legacy = legacyParsed(extracted.rows, bank, review);
  const options: PdfReviewOptions = {
    ...review,
    institution: bank,
    account: account ?? review.account,
    profile:
      review.profile ?? (profile?.institution === bank ? profile : undefined),
    period:
      review.period ??
      (legacy
        ? { start: legacy.periodStart, end: legacy.periodEnd }
        : undefined),
    evidence: {
      ...(legacy
        ? {
            openingBalance: legacy.openingBalance,
            closingBalance: legacy.closingBalance,
          }
        : {}),
      ...review.evidence,
    },
    unreadPages: extracted.extraction.unreadPages,
    alternatives: cellReadings.get(extracted),
  };
  let generic = parseGenericStatement(
    extracted.extraction.items,
    extracted.extraction.pages,
    options,
  );
  if (!options.template && !options.mapping) {
    const matches = await db.layoutTemplates
      .where("fingerprint")
      .equals(generic.layoutFingerprint)
      .filter((template) => template.status === "active")
      .toArray();
    // Multiple saved layouts are never guessed between silently.
    if (matches.length === 1) {
      options.template = matches[0];
      generic = parseGenericStatement(
        extracted.extraction.items,
        extracted.extraction.pages,
        options,
      );
    }
  }
  generic = await checkNumericCells(extracted, generic, options);
  if (profile)
    generic.comparison = compareLegacyTransactions(
      generic,
      profile.id,
      legacy?.transactions,
    );
  if (generic.parsed && legacy && !review.period) {
    generic.parsed.periodSource = legacy.periodSource;
    generic.parsed.statementDate = legacy.statementDate;
  }
  if (generic.parsed && legacy) {
    // Geometry can prove every card amount without proving an absent printed
    // period start. Keep these identity/coverage notices from the established
    // reader; unrelated extraction warnings do not overrule stronger evidence.
    const periodNotices = legacy.warnings.filter((warning) =>
      /issue date but no period start|Statement dates were entered manually/i.test(
        warning,
      ),
    );
    generic.parsed.warnings = [
      ...new Set([...generic.parsed.warnings, ...periodNotices]),
    ];
  }
  extracted.generic = generic;
  await retainImportDiagnostics(
    {
      id: `pdf:${extracted.hash}`,
      createdAt: new Date().toISOString(),
      parserVersion: PARSER_VERSION,
      method: generic.parsed?.parserMethod ?? extracted.extraction.method,
      table: generic.table,
      rows: generic.rowChecks,
      checks: generic.checks,
    },
    db,
  );
  if (options.template)
    await markLayoutTemplateChecked(
      options.template.id,
      generic.checks.reconciledExactly,
    );
  const deliberateReading =
    !!review.mapping ||
    !!review.template ||
    !!Object.keys(review.actions ?? {}).length;
  const legacyMovements =
    legacy && statementMovements(legacy.transactions, legacy.currency);
  const legacyExact =
    legacy &&
    reconcileWithPolicy(
      legacy.openingBalance,
      legacy.closingBalance,
      legacy.transactions.map((row) => row.amount),
      "exact-v2.2",
    ).status === "reconciled" &&
    (generic.checks.printedMoneyIn === undefined ||
      legacyMovements!.moneyIn === generic.checks.printedMoneyIn) &&
    (generic.checks.printedMoneyOut === undefined ||
      legacyMovements!.moneyOut === generic.checks.printedMoneyOut);
  // Preserve proven adapters for layouts whose new candidate is incomplete. A mismatch is explicit review.
  const malformedSource = generic.rowChecks.some((row) => {
    if (row.reviewAction?.kind === "exclude") return false;
    if (
      row.issues.some((issue) =>
        ["invalid-amount", "missing-description"].includes(issue),
      )
    )
      return true;
    if (!row.issues.includes("invalid-date")) return false;
    try {
      parseDate(selected(row)?.date ?? "");
      return false;
    } catch {
      return true;
    }
  });
  // Never revert an OCR number already proved by its individual printed
  // running balance to a stale adapter reading whose net errors cancel.
  const legacyReadings = [...(legacy?.transactions ?? [])];
  const provedOcrMismatch = generic.rowChecks.some((row) => {
    if (row.parseSource !== "ocr" || row.difference !== 0 || row.issues.length)
      return false;
    const reading = selected(row);
    const match = legacyReadings.findIndex(
      (transaction) =>
        transaction.sourcePage === row.rect.page &&
        transaction.date === reading?.date &&
        transaction.bookingDate === reading?.bookingDate &&
        transaction.amount === reading?.amount &&
        transaction.balanceAfterTransaction ===
          reading?.balanceAfterTransaction,
    );
    if (match < 0) return true;
    legacyReadings.splice(match, 1);
    return false;
  });
  const fallback =
    !malformedSource &&
    !provedOcrMismatch &&
    !deliberateReading &&
    !!legacyExact &&
    !generic.checks.reconciledExactly &&
    !extracted.extraction.unreadPages.length &&
    (!generic.parsed || generic.comparison?.legacyStatus === "different") &&
    !options.template;
  if (fallback && legacy) {
    const sources = new Set(
      extracted.extraction.items.map((item) => item.parseSource),
    );
    const parserMethod = sources.has("ocr")
      ? sources.has("text")
        ? ("text+ocr" as const)
        : ("ocr" as const)
      : ("text" as const);
    return {
      parsed: {
        ...legacy,
        validationPolicy: "exact-v2.2" as const,
        parserMethod,
        bankProfileId: profile?.id,
        rowsTotalChecked: legacy.transactions.length,
        rowsNeedingReview: 0,
        transactions: legacy.transactions.map((row, index) => ({
          ...row,
          parseRowId: `legacy-${index}`,
          parseSource:
            extracted.extraction!.method === "text"
              ? ("text" as const)
              : ("ocr" as const),
          checkLevel:
            extracted.extraction!.method === "text"
              ? ("total" as const)
              : ("ocr" as const),
        })),
        warnings: [
          ...legacy.warnings,
          "The bank-specific reader was retained because the new layout reader produced a different result. Compare the extracted transactions with the PDF before importing; Map columns is available to review the layout.",
        ],
      },
      generic,
      fallback: true,
    };
  }
  if (!generic.parsed) {
    const message =
      generic.errorCode === "missing-period"
        ? "Statement period could not be identified. Enter the dates printed on the PDF, then check again."
        : generic.errorCode === "missing-currency"
          ? "Statement currency could not be identified safely. Choose the matching account; multi-currency PDFs need separate statements per currency."
          : "The transaction columns could not be identified. Map the date, description and money columns below.";
    throw new Error(message);
  }
  return { parsed: generic.parsed, generic, fallback: false };
}

/** Saved layouts contain allowlisted headings and relative coordinates, never statement values. */
export async function savePdfLayout(
  extracted: ExtractedFile,
  result: GenericParseResult,
  name: string,
  mapping: LayoutMapping = result.mapping!,
) {
  if (!mapping || !result.table.pages.length)
    throw new Error("Map the columns before saving a layout.");
  const now = new Date().toISOString();
  // Keep one representative page, including every horizontal reading panel.
  // Selecting one column-ID prefix would lose half of a two-panel card table.
  const representativeId = mapping.columnRoles.find(
    ({ columnId, role }) => role === "date",
  )?.columnId;
  const representativePage = representativeId
    ? result.table.pages.find((page) =>
        representativeId.startsWith(`p${page.page}-`),
      )
    : undefined;
  const representativeColumns = representativePage
    ? new Set(
        mapping.columnRoles
          .filter(({ columnId }) =>
            columnId.startsWith(`p${representativePage.page}-`),
          )
          .map(({ columnId }) => columnId),
      )
    : undefined;
  const representative = mapping.columnRoles.flatMap(({ columnId, role }) => {
    if (representativeColumns && !representativeColumns.has(columnId))
      return [];
    const column = result.table.columns.find((entry) => entry.id === columnId);
    const page =
      result.table.pages.find((entry) =>
        columnId.startsWith(`p${entry.page}-`),
      ) ?? result.table.pages[0];
    return column
      ? [
          {
            x0: Math.max(0, column.x0 / page.width),
            x1: Math.min(1, column.x1 / page.width),
            role,
          },
        ]
      : [];
  });
  const unique = [
    ...new Map(
      representative.map((band) => [JSON.stringify(band), band]),
    ).values(),
  ];
  const template: LayoutTemplate = {
    id: id(),
    name: name.trim(),
    fingerprint: result.layoutFingerprint,
    institution: result.parsed?.institution,
    bankProfileId: result.profileId,
    columnRoles: unique,
    coordinateSpace: "page-width-fraction",
    signConvention: mapping.signConvention,
    balanceSign: mapping.balanceSign,
    dateFormat: mapping.dateFormat,
    createdAt: now,
    lastUsedAt: now,
    status: result.checks.reconciledExactly ? "active" : "check_needed",
  };
  await saveLayoutTemplate(template);
  // The currently selected source is not retained by saving the layout.
  void extracted;
  return template;
}
