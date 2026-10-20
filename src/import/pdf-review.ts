import type {
  Account,
  Institution,
  ParsedStatement,
  TextRow,
} from "../domain/models";
import { id } from "../domain/normalize";
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
import { recoverNativeAmounts } from "./generic/native-recovery";
import {
  prepareBankAdapterReading,
  type BankAdapterSource,
} from "./bank-adapter-proof";

export interface PdfReviewOptions extends GenericParseOptions {
  signal?: AbortSignal;
  progress?: (progress: ImportProgress) => void;
  skipCellOcr?: boolean;
  /** Explicitly choose source-row correction for an otherwise supported bank. */
  preferGeneric?: boolean;
}

interface PdfReading {
  parsed: ParsedStatement;
  fallback: boolean;
  generic?: GenericParseResult;
  bankSource?: BankAdapterSource;
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

/** Select supported digital bank readers before attempting generic column inference. */
export async function preparePdfReading(
  extracted: ExtractedFile,
  bank: Institution,
  account: Account | undefined,
  review: PdfReviewOptions = {},
): Promise<PdfReading> {
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
  const legacy = legacyParsed(extracted.rows, bank, review);
  const explicitGenericReview =
    !!review.preferGeneric ||
    !!review.mapping ||
    !!review.template ||
    !!Object.keys(review.actions ?? {}).length;
  const completeDigitalSource =
    extracted.extraction.method === "text" &&
    !extracted.extraction.cancelled &&
    !extracted.extraction.unreadPages.length &&
    extracted.extraction.items.every((item) => item.parseSource === "text");
  if (
    legacy &&
    bank !== "Other" &&
    !explicitGenericReview &&
    completeDigitalSource &&
    getParser(bank, extracted.rows).canParse(extracted.rows)
  ) {
    // The original adapters own recognition, source coverage, signs and bank
    // summary arithmetic. Generic profile hints and competing candidate rows
    // must not turn a supported statement into a manual mapping workflow.
    extracted.generic = undefined;
    return {
      ...prepareBankAdapterReading(legacy, extracted.rows, {
        unreadPages: extracted.extraction.unreadPages,
        warnings: extracted.warnings,
      }),
      fallback: true,
    };
  }
  const profile = detectProfile(extracted.extraction.items);
  const options: PdfReviewOptions = {
    ...review,
    institution: bank,
    // Correcting source rows must retain identity already read by the bank
    // adapter. Its card number can distinguish the customer's card from the
    // separate bank account printed in the issuer's payment instructions.
    account:
      account ??
      review.account ??
      (legacy?.accountIdentifier
        ? {
            maskedAccountIdentifier: legacy.accountIdentifier,
            accountType: legacy.accountType,
            currency: legacy.currency,
          }
        : undefined),
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
    // Source corroboration is rebuilt from this PDF, never trusted from UI options.
    bankAmounts: undefined,
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
  const bankAmounts = recoverNativeAmounts(generic, legacy);
  if (Object.keys(bankAmounts).length) {
    options.bankAmounts = bankAmounts;
    generic = parseGenericStatement(
      extracted.extraction.items,
      extracted.extraction.pages,
      options,
    );
  }
  // Changed, scanned and unknown layouts retain the complete generic review.
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
