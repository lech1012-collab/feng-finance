import { localToday } from "../analytics/reminders";
import type {
  ImportDraft,
  Institution,
  PageTextItem,
  TextRow,
  Transaction,
  Account,
  ParsedStatement,
} from "../domain/models";
import { db } from "../storage/database";
import { id, fingerprint, transactionKey } from "../domain/normalize";
import { parseDate } from "../domain/dates";
import { currencyPrecision } from "../domain/money";
import { dayDistance } from "../domain/dates";
import { reconstructRows } from "./layout";
import { detectBank } from "./detection";
import { getParser } from "../parsers";
import { PARSER_VERSION } from "../parsers/interface";
import type { StatementPeriod } from "../parsers/period";
import { duplicateStatus } from "./duplicates";
import { outsideStatementPeriod } from "./statement-period";
import { categorize } from "../categorization/engine";
import { reconcileWithPolicy } from "../domain/reconcile";
import { rememberCategory } from "../storage/category-memory";
import {
  csvPreset,
  parseCsv,
  parseOfx,
  parseQif,
  readCsv,
  type CsvMapping,
  type CsvTable,
  type TextImportFormat,
} from "./formats";
import { sha256 } from "../domain/normalize";
import { auditedMutation } from "../storage/audit";
import { consumeRuleApplications } from "../storage/rules";
import { transactionSplitRows } from "../storage/accuracy";
import { ensureMonthsOpen } from "../storage/month-review";
import { findTransferProposals } from "../transfers/engine";
import { applyTransferProposal } from "../storage/accuracy";
import { markRefundCandidates } from "../analytics/effective-transactions";
import { convertMinor } from "../analytics/fx";
import { importMonthGuardDates } from "./month-guards";
import { preparePdfReading, type PdfReviewOptions } from "./pdf-review";
export { savePdfLayout, type PdfReviewOptions } from "./pdf-review";
import type { GenericParseResult } from "./generic/types";
import type {
  PdfImportSession,
  ExtractionResult,
  ImportProgress,
} from "./pdf-session-types";
import { firstRealImportAt } from "../beta/policy";
import { statementMovements } from "./movements";
import {
  identifyBarclaycardAnnualSummary,
  type AnnualStatementSummary,
} from "../parsers/barclaycard-annual";
import { retainImportDiagnostics } from "../storage/import-diagnostics";
function applyCategory(
  transaction: Transaction,
  rules: import("../domain/models").Rule[],
  history: Transaction[],
  categories: import("../domain/models").Category[],
) {
  return {
    categorySource: undefined,
    categoryRuleId: undefined,
    ...categorize(transaction, rules, history, categories),
  };
}
export interface ExtractedFile {
  /** Read-only aggregate document metadata, retained only during this import. */
  summary?: AnnualStatementSummary;
  /** Transient recovery context; never a stored account or transaction fact. */
  accountSelection?: Pick<
    ParsedStatement,
    "institution" | "accountType" | "currency"
  >;
  pdfSession?: PdfImportSession;
  extraction?: ExtractionResult;
  generic?: GenericParseResult;
  rows: TextRow[];
  hash: string;
  filename: string;
  method: "embedded-text" | "OCR" | "CSV" | "OFX" | "QIF";
  warnings: string[];
  format?: TextImportFormat;
  csv?: CsvTable;
  preset?: CsvMapping;
  parsed?: ParsedStatement;
  text?: string;
}
export async function extractFile(
  file: File,
  progress: (s: string) => void,
  forceOcr = false,
  options: {
    signal?: AbortSignal;
    detailedProgress?: (progress: ImportProgress) => void;
  } = {},
): Promise<ExtractedFile> {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (extension && ["csv", "ofx", "qfx", "qif"].includes(extension)) {
    if (forceOcr) throw new Error("OCR is available for PDF statements only.");
    if (!file.size) throw new Error("This file is empty.");
    if (file.size > 30 * 1024 * 1024)
      throw new Error("Export exceeds 30 MB. Import a smaller period.");
    progress("Reading the export on your device…");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = await sha256(bytes);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\u0000"))
      throw new Error("This export is not a supported text file.");
    const format =
      extension === "qfx" ? "ofx" : (extension as TextImportFormat);
    const csv = format === "csv" ? readCsv(text) : undefined;
    return {
      rows: [],
      hash,
      filename: file.name,
      method: format === "csv" ? "CSV" : format === "ofx" ? "OFX" : "QIF",
      warnings: [],
      format,
      csv,
      preset: csv && csvPreset(csv, file.name)?.mapping,
      parsed: format === "ofx" ? parseOfx(text) : undefined,
      text: format === "qif" ? text : undefined,
    };
  }
  const { createPdfImportSession } = await import("./pdf-session");
  progress("Checking PDF and calculating fingerprint…");
  const session = await createPdfImportSession(file, {
    signal: options.signal,
  });
  try {
    const extraction = await session.extract({
      forceOcr,
      signal: options.signal,
      progress: (detail) => {
        progress(detail.message);
        options.detailedProgress?.(detail);
      },
    });
    const rows = reconstructRows(
      extraction.items.map((item) => ({ ...item, y: item.y + item.height })),
    );
    return {
      rows,
      summary:
        !extraction.cancelled &&
        !extraction.unreadPages.length &&
        extraction.completedPages.length === extraction.pageCount &&
        extraction.quality.every((page) => page.usable)
          ? identifyBarclaycardAnnualSummary(rows)
          : undefined,
      hash: session.hash,
      filename: file.name,
      method: extraction.method === "text" ? "embedded-text" : "OCR",
      warnings:
        extraction.cancelled || extraction.unreadPages.length
          ? [
              `Image reading stopped. ${extraction.completedPages.length} of ${extraction.pageCount} pages were read; unread pages require review and an explicit Unverified import.`,
            ]
          : [],
      pdfSession: session,
      extraction,
    };
  } catch (error) {
    await session.dispose();
    throw error;
  }
}

export async function prepareDraft(
  extracted: ExtractedFile,
  selectedBank?: Institution,
  selectedAccount?: Account,
  periodOverride?: StatementPeriod,
  pendingDrafts: ImportDraft[] = [],
  csvMapping?: CsvMapping,
  pdfReviewOptions: PdfReviewOptions = {},
): Promise<ImportDraft> {
  delete extracted.accountSelection;
  const detection = detectBank(extracted.rows);
  const bank =
    selectedBank ?? selectedAccount?.institution ?? detection.institution;
  const pdfReading = !extracted.format
    ? await preparePdfReading(extracted, bank, selectedAccount, {
        ...pdfReviewOptions,
        period: periodOverride ?? pdfReviewOptions.period,
      })
    : undefined;
  let savedMapping: CsvMapping | undefined;
  if (selectedAccount && extracted.csv && !csvMapping) {
    const saved = await db.settings.get(`csv-mapping:${selectedAccount.id}`);
    if (saved) {
      try {
        const value = JSON.parse(saved.value) as CsvMapping;
        if (
          JSON.stringify(value.headers) ===
          JSON.stringify(extracted.csv.headers)
        )
          savedMapping = value;
      } catch {
        /* A changed or invalid saved mapping requires a new review. */
      }
    }
  }
  const mapping = csvMapping ?? savedMapping ?? extracted.preset;
  if (extracted.format === "csv" && !mapping)
    throw new Error(
      "Choose the date, description and amount columns below, then check the file.",
    );
  const parsed = extracted.csv
    ? parseCsv(extracted.csv, {
        ...mapping!,
        institution:
          selectedBank ?? selectedAccount?.institution ?? mapping?.institution,
        defaultCurrency: selectedAccount?.currency ?? mapping?.defaultCurrency,
        accountType:
          selectedAccount?.accountType === "credit" ||
          selectedAccount?.accountType === "credit_card"
            ? "credit"
            : mapping?.accountType,
        accountIdentifier:
          selectedAccount?.maskedAccountIdentifier ??
          mapping?.accountIdentifier,
      })
    : extracted.format === "qif"
      ? parseQif(extracted.text!, {
          ...csvMapping,
          institution: selectedBank ?? selectedAccount?.institution,
          defaultCurrency: selectedAccount?.currency,
          accountIdentifier: selectedAccount?.maskedAccountIdentifier,
        })
      : extracted.parsed
        ? {
            ...extracted.parsed,
            institution:
              selectedBank ??
              (extracted.parsed.institution === "Other"
                ? (selectedAccount?.institution ?? "Other")
                : extracted.parsed.institution),
          }
        : pdfReading!.parsed;
  if (periodOverride && extracted.format)
    Object.assign(parsed, {
      periodStart: periodOverride.start,
      periodEnd: periodOverride.end,
      periodSource: "manual",
    });
  const now = new Date().toISOString();
  if (selectedAccount && pdfReading?.generic?.errorCode === "missing-account")
    throw new Error(
      "The selected account could not be matched to the identifiers on this PDF. Choose the account whose last four digits are printed on this statement.",
    );
  const accounts = await db.accounts.toArray();
  for (const pending of pendingDrafts)
    if (!accounts.some((a) => a.id === pending.account.id))
      accounts.push(pending.account);
  const existingAccounts = accounts.filter(
    (a) =>
      !a.isDemo &&
      a.institution === parsed.institution &&
      a.currency === parsed.currency &&
      (a.accountType === "credit" || a.accountType === "credit_card") ===
        (parsed.accountType === "credit" ||
          parsed.accountType === "credit_card") &&
      ((!parsed.accountIdentifier && !!extracted.format) ||
        a.maskedAccountIdentifier === parsed.accountIdentifier),
  );
  if (
    !selectedAccount &&
    !parsed.accountIdentifier &&
    existingAccounts.length !== 1
  ) {
    extracted.accountSelection = {
      institution: parsed.institution,
      accountType: parsed.accountType,
      currency: parsed.currency,
    };
    throw new Error(
      "Account identifier could not be read. Select an existing account, or create one in Settings, then parse again.",
    );
  }
  if (existingAccounts.length > 1 && !selectedAccount) {
    extracted.accountSelection = {
      institution: parsed.institution,
      accountType: parsed.accountType,
      currency: parsed.currency,
    };
    throw new Error(
      "More than one account has this masked identifier. Select the matching account.",
    );
  }
  const account = selectedAccount ??
    existingAccounts[0] ?? {
      id: id(),
      institution: parsed.institution,
      displayName:
        parsed.accountType === "credit" ? "Credit card" : "Current account",
      accountType: parsed.accountType,
      currency: parsed.currency,
      maskedAccountIdentifier: parsed.accountIdentifier!,
      createdAt: now,
      updatedAt: now,
    };
  if (
    account.institution !== parsed.institution ||
    account.currency !== parsed.currency ||
    (account.accountType === "credit" ||
      account.accountType === "credit_card") !==
      (parsed.accountType === "credit" ||
        parsed.accountType === "credit_card") ||
    account.isDemo ||
    account.tracking === "manual"
  )
    throw new Error(
      "Selected account does not match this statement bank, currency and account type.",
    );
  if (
    parsed.accountIdentifier &&
    account.maskedAccountIdentifier !== parsed.accountIdentifier
  )
    throw new Error(
      "Selected account does not match the account identifier printed on this statement. Choose the matching account.",
    );
  const sid = id();
  // A ledger-only OFX balance is useful evidence, but it must never manufacture
  // an opening balance by subtracting the very rows being checked.
  if (extracted.format === "ofx" && parsed.openingBalance === undefined) {
    const previousDay = new Date(
      Date.parse(`${parsed.periodStart}T12:00:00Z`) - 86400000,
    )
      .toISOString()
      .slice(0, 10);
    const previous = await db.statements
      .where("accountId")
      .equals(account.id)
      .filter(
        (s) =>
          s.validationStatus === "reconciled" &&
          !s.validationOverride &&
          s.statementPeriodEnd === previousDay &&
          s.closingBalance !== undefined,
      )
      .first();
    if (previous) parsed.openingBalance = previous.closingBalance;
  }
  const validation =
    pdfReading?.generic && !pdfReading.fallback
      ? pdfReading.generic.checks.reconciliation
      : reconcileWithPolicy(
          parsed.openingBalance,
          parsed.closingBalance,
          parsed.transactions.map((t) => t.amount),
          parsed.validationPolicy,
        );
  const statements = await db.statements
    .where("accountId")
    .equals(account.id)
    .toArray();
  const existing = await db.transactions
    .where("accountId")
    .equals(account.id)
    .toArray();
  for (const pending of pendingDrafts.filter(
    (d) => d.account.id === account.id,
  )) {
    statements.push(pending.statement);
    existing.push(...pending.transactions.filter((t) => t.include));
  }
  const rules = await db.rules.toArray();
  const pendingUsedRules = new Set(
    pendingDrafts.flatMap((draft) =>
      draft.transactions
        .filter((t) => t.include)
        .flatMap((t) => t.appliedRuleIds ?? []),
    ),
  );
  for (let index = rules.length - 1; index >= 0; index--)
    if (rules[index].singleUse && pendingUsedRules.has(rules[index].id))
      rules.splice(index, 1);
  const categories = await db.categories.toArray();
  const regenerated = statements.some(
    (s) =>
      s.statementPeriodStart === parsed.periodStart &&
      s.statementPeriodEnd === parsed.periodEnd,
  );
  const counts = new Map<string, number>();
  const transactions: ImportDraft["transactions"] = [];
  for (const p of parsed.transactions) {
    const t: Transaction = {
      ...p,
      id: id(),
      accountId: account.id,
      statementId: sid,
      tags: [],
      transactionFingerprint: "",
      occurrence: 0,
      // Parser payment hints propose a transfer; only confirmed links or user rules exclude cash flow.
      type: p.amount >= 0 ? "income" : "expense",
      isTransfer: false,
      isReviewed: false,
      createdAt: now,
      updatedAt: now,
      source: extracted.format ?? "pdf",
    };
    const key = transactionKey(t);
    t.occurrence = counts.get(key) ?? 0;
    counts.set(key, t.occurrence + 1);
    t.transactionFingerprint = await fingerprint(t);
    Object.assign(t, applyCategory(t, rules, existing, categories));
    for (let index = rules.length - 1; index >= 0; index--)
      if (rules[index].singleUse && t.appliedRuleIds?.includes(rules[index].id))
        rules.splice(index, 1);
    const duplicate = duplicateStatus(
      t,
      existing.filter((old) => old.source !== "manual" && !old.parentId),
      regenerated,
    );
    const manualMatches = existing.filter(
      (old) =>
        old.source === "manual" &&
        old.currency === t.currency &&
        old.amount === t.amount &&
        dayDistance(old.date, t.date) <= 1 &&
        !old.parentId,
    );
    transactions.push({
      ...t,
      duplicate,
      include: duplicate === "none",
      acknowledged: p.extractionConfidence >= 0.8,
      manualReplacementId: manualMatches[0]?.id,
      manualReplacementCandidates: manualMatches.map((manual) => ({
        id: manual.id,
        date: manual.date,
        description: manual.description,
      })),
    });
  }
  const warnings = [
    ...(parsed.periodEnd > localToday()
      ? [
          "The statement ends in the future. Check its dates against the PDF before importing; future balances cannot verify today's finances.",
        ]
      : []),
    ...extracted.warnings,
    ...parsed.warnings.map((warning) =>
      warning ===
      "A payment to Amex was marked as a transfer. Confirm it pays your own credit card; otherwise change its type before importing."
        ? "A payment to Amex may be an internal card repayment. Confirm it is a transfer after importing, or mark its type in this review."
        : warning,
    ),
  ];
  const classified = new Map(
    markRefundCandidates([...existing, ...transactions]).map((transaction) => [
      transaction.id,
      transaction,
    ]),
  );
  for (const transaction of transactions) {
    const candidate = classified.get(transaction.id);
    if (candidate?.kind === "refund") Object.assign(transaction, candidate);
  }
  return {
    account,
    parserReview: pdfReading?.generic,
    bankSource: pdfReading?.bankSource,
    parserFallback: pdfReading?.fallback,
    statement: {
      id: sid,
      institution: parsed.institution,
      accountId: account.id,
      statementPeriodStart: parsed.periodStart,
      statementPeriodEnd: parsed.periodEnd,
      periodSource: parsed.periodSource,
      statementDate: parsed.statementDate,
      openingBalance: parsed.openingBalance,
      closingBalance: parsed.closingBalance,
      currency: parsed.currency,
      sourceFilename: extracted.filename,
      sourceFileHash: extracted.hash,
      importedAt: now,
      parserVersion: PARSER_VERSION,
      extractionMethod: extracted.method,
      validationStatus: validation.status,
      validationDifference: validation.difference,
      transactionCount: transactions.length,
      warnings,
      parserMethod: parsed.parserMethod,
      validationPolicy: parsed.validationPolicy,
      rowsBalanceChecked: parsed.rowsBalanceChecked,
      rowsTotalChecked: parsed.rowsTotalChecked,
      rowsNeedingReview: parsed.rowsNeedingReview,
      bankProfileId: parsed.bankProfileId,
      rowsExcludedByReview: parsed.rowsExcludedByReview,
      unreadPages: parsed.unreadPages,
      layoutTemplateId: parsed.layoutTemplateId,
    },
    transactions,
    exactDuplicate:
      (await db.statements
        .where("sourceFileHash")
        .equals(extracted.hash)
        .count()) > 0 ||
      pendingDrafts.some((d) => d.statement.sourceFileHash === extracted.hash),
    regenerated,
    detectionConfidence: extracted.format ? 1 : detection.confidence,
    warnings,
    csvMapping:
      extracted.format === "csv" && mapping
        ? { ...mapping, headers: extracted.csv?.headers }
        : undefined,
    reviewedWarnings: false,
    duplicateOverride: false,
  };
}
/** Selected bank-reader facts are held only in the current PDF review session. */
function matchesBankSource(draft: ImportDraft) {
  const source = draft.bankSource?.parsed;
  if (!source) return true;
  if (
    !source.transactions.length ||
    source.transactions.length !== draft.transactions.length ||
    draft.statement.openingBalance !== source.openingBalance ||
    draft.statement.closingBalance !== source.closingBalance ||
    draft.statement.currency !== source.currency ||
    draft.statement.statementPeriodStart !== source.periodStart ||
    draft.statement.statementPeriodEnd !== source.periodEnd ||
    draft.statement.institution !== source.institution ||
    draft.account.institution !== source.institution ||
    (draft.account.accountType === "credit" ||
      draft.account.accountType === "credit_card") !==
      (source.accountType === "credit" ||
        source.accountType === "credit_card") ||
    draft.account.currency !== source.currency ||
    (source.accountIdentifier !== undefined &&
      draft.account.maskedAccountIdentifier !== source.accountIdentifier) ||
    source.transactions.some((row) => !row.parseRowId) ||
    draft.transactions.some((row) => !row.parseRowId)
  )
    return false;
  const normalized = new Map(
    draft.transactions.map((row) => [row.parseRowId, row]),
  );
  if (
    normalized.size !== draft.transactions.length ||
    new Set(source.transactions.map((row) => row.parseRowId)).size !==
      source.transactions.length
  )
    return false;
  return source.transactions.every((original) => {
    const row = normalized.get(original.parseRowId);
    return (
      row !== undefined &&
      row.amount === original.amount &&
      row.date === original.date &&
      row.bookingDate === original.bookingDate &&
      row.currency === original.currency &&
      row.balanceAfterTransaction === original.balanceAfterTransaction &&
      row.sourcePage === original.sourcePage
    );
  });
}
export function draftReconciliation(draft: ImportDraft) {
  const validation = reconcileWithPolicy(
    draft.statement.openingBalance,
    draft.statement.closingBalance,
    draft.transactions.map((t) => t.amount),
    draft.statement.validationPolicy,
  );
  // A printed, valid purchase date can precede a card's posting period. Retain
  // that date, but a new PDF cannot be called verified without matching dates.
  if (
    draft.statement.validationPolicy === "exact-v2.2" &&
    draft.transactions.some((row) =>
      outsideStatementPeriod(
        row,
        draft.statement.statementPeriodStart,
        draft.statement.statementPeriodEnd,
      ),
    )
  )
    validation.status = "warning";
  const bankSource = draft.bankSource;
  if (bankSource) {
    // Duplicates declined for addition still participate in source arithmetic,
    // just like transfers: the bank's Money in/out figures describe all rows.
    const movements = statementMovements(
      draft.transactions,
      draft.statement.currency,
    );
    const checks = bankSource;
    if (
      !matchesBankSource(draft) ||
      !bankSource.reconciledExactly ||
      (checks?.printedMoneyIn !== undefined &&
        movements.moneyIn !== checks.printedMoneyIn) ||
      (checks?.printedMoneyOut !== undefined &&
        movements.moneyOut !== checks.printedMoneyOut)
    )
      validation.status = "warning";
  }
  const evidence = !draft.parserFallback
    ? draft.parserReview?.checks
    : undefined;
  if (
    evidence &&
    (validation.status === "unavailable" || !evidence.reconciledExactly)
  ) {
    return {
      ...evidence.reconciliation,
      ...validation,
      status: evidence.reconciledExactly
        ? evidence.reconciliation.status
        : ("warning" as const),
    };
  }
  return validation;
}
/** Keep reviewed corrections while refreshing account identities and duplicate checks.
 * Each statement in a multi-file import must see the statements committed before it.
 */
export async function refreshReviewedDraft(
  reviewed: ImportDraft,
): Promise<ImportDraft> {
  const storedAccount = await db.accounts.get(reviewed.account.id);
  const matching = storedAccount
    ? [storedAccount]
    : await db.accounts
        .where("institution")
        .equals(reviewed.account.institution)
        .filter(
          (a) =>
            !a.isDemo &&
            a.currency === reviewed.account.currency &&
            a.accountType === reviewed.account.accountType &&
            a.maskedAccountIdentifier ===
              reviewed.account.maskedAccountIdentifier,
        )
        .toArray();
  if (matching.length > 1)
    throw new Error(
      "More than one matching account exists. Select the account and parse again.",
    );
  const account = matching[0] ?? reviewed.account;
  const [statements, existing, rules, categories] = await Promise.all([
    db.statements.where("accountId").equals(account.id).toArray(),
    db.transactions.where("accountId").equals(account.id).toArray(),
    db.rules.toArray(),
    db.categories.toArray(),
  ]);
  const regenerated = statements.some(
    (s) =>
      s.statementPeriodStart === reviewed.statement.statementPeriodStart &&
      s.statementPeriodEnd === reviewed.statement.statementPeriodEnd,
  );
  const transactions: ImportDraft["transactions"] = [];
  const occurrences = new Map<string, number>();
  for (const row of reviewed.transactions) {
    const next = { ...row, accountId: account.id };
    const key = transactionKey(next);
    next.occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, next.occurrence + 1);
    next.transactionFingerprint = await fingerprint(next);
    const duplicate = duplicateStatus(
      next,
      existing.filter((old) => old.source !== "manual" && !old.parentId),
      regenerated,
    );
    // Retain explicit duplicate decisions. Newly found duplicates are skipped safely.
    const newlyDuplicate = row.duplicate === "none" && duplicate !== "none";
    next.duplicate = duplicate;
    if (newlyDuplicate) {
      next.include = false;
      next.acknowledged = false;
    }
    if (!next.manualCategory) {
      if (next.categorySource === "rule") {
        next.isTransfer = false;
        next.type = next.amount >= 0 ? "income" : "expense";
      }
      Object.assign(next, applyCategory(next, rules, existing, categories));
      for (let index = rules.length - 1; index >= 0; index--)
        if (
          rules[index].singleUse &&
          next.appliedRuleIds?.includes(rules[index].id)
        )
          rules.splice(index, 1);
    }
    transactions.push(next);
  }
  return {
    ...reviewed,
    account,
    statement: { ...reviewed.statement, accountId: account.id },
    transactions,
    regenerated,
    exactDuplicate:
      (await db.statements
        .where("sourceFileHash")
        .equals(reviewed.statement.sourceFileHash)
        .count()) > 0,
  };
}
export function validateDraft(draft: ImportDraft, overrideValidation: boolean) {
  const validation = draftReconciliation(draft);
  const bankSource = draft.bankSource;
  if (bankSource && !matchesBankSource(draft))
    throw new Error(
      "Source readings changed during review. Recheck the corrected PDF rows before importing.",
    );
  if (draft.parserReview && !draft.parserFallback) {
    const sourceTransactions = draft.parserReview.parsed?.transactions ?? [];
    if (
      sourceTransactions.length !== draft.transactions.length ||
      sourceTransactions.some((source) => {
        const normalized = draft.transactions.find(
          (row) => row.parseRowId === source.parseRowId,
        );
        return (
          !normalized ||
          normalized.amount !== source.amount ||
          normalized.date !== source.date ||
          normalized.bookingDate !== source.bookingDate ||
          normalized.balanceAfterTransaction !== source.balanceAfterTransaction
        );
      })
    )
      throw new Error(
        "Source readings changed during review. Check the statement again before importing.",
      );
    if (
      draft.parserReview.rowChecks.some(
        (row) =>
          row.reviewAction?.kind !== "exclude" &&
          row.issues.some((issue) =>
            ["invalid-date", "invalid-amount", "missing-description"].includes(
              issue,
            ),
          ),
      )
    )
      throw new Error(
        "Correct or exclude every source row with an invalid date, amount or description before importing.",
      );
    if (
      draft.parserReview.rowChecks.some((row) => !row.resolved) &&
      !overrideValidation
    )
      throw new Error(
        "Review the source rows or explicitly import them as Unverified.",
      );
  }
  if (draft.exactDuplicate && !draft.duplicateOverride)
    throw new Error(
      "This statement has already been imported. An explicit duplicate override is required.",
    );
  if (validation.status === "warning" && !overrideValidation)
    throw new Error(
      "Statement reconciliation failed. Review the amounts or explicitly override validation.",
    );
  if (draft.warnings.length && !draft.reviewedWarnings)
    throw new Error("Acknowledge the extraction warnings before importing.");
  for (const t of draft.transactions) {
    parseDate(t.date);
    if (t.bookingDate !== undefined) parseDate(t.bookingDate);
    currencyPrecision(t.currency);
    if (
      !Number.isSafeInteger(t.amount) ||
      (t.balanceAfterTransaction !== undefined &&
        !Number.isSafeInteger(t.balanceAfterTransaction))
    )
      throw new Error("A transaction amount is invalid.");
    if (
      (!draft.parserReview || draft.parserFallback) &&
      t.include &&
      t.extractionConfidence < 0.8 &&
      !t.acknowledged
    )
      throw new Error("Verify every uncertain transaction before importing.");
    if (t.include && t.duplicate !== "none" && !t.acknowledged)
      throw new Error("Confirm potential duplicates before keeping them.");
    if (t.include && t.manualReplacementId && t.replaceManual === undefined)
      throw new Error(
        "Choose whether to replace the matching manual transaction or keep both.",
      );
    if (!t.description.trim())
      throw new Error("Transaction descriptions must not be empty.");
    if (
      outsideStatementPeriod(
        t,
        draft.statement.statementPeriodStart,
        draft.statement.statementPeriodEnd,
      )
    ) {
      if (
        draft.statement.validationPolicy === "exact-v2.2" &&
        !overrideValidation
      )
        throw new Error(
          "A printed transaction date is outside the statement period. Check the source or explicitly import the statement as Unverified.",
        );
      if (!draft.reviewedWarnings)
        throw new Error("Transaction date is outside the statement period.");
    }
  }
  return validation;
}
export async function commitDraft(
  draft: ImportDraft,
  overrideValidation = false,
  pendingTransactionIds: ReadonlySet<string> = new Set(),
  deferAutomaticTransfers = false,
) {
  const validation = validateDraft(draft, overrideValidation);
  const manuallyCategorized = new Set(
    draft.transactions.filter((t) => t.manualCategory).map((t) => t.id),
  );
  const incoming: Transaction[] = [];
  for (const row of draft.transactions.filter((t) => t.include)) {
    const {
      duplicate: _d,
      include: _i,
      acknowledged: _a,
      manualCategory: _m,
      manualReplacementId: _replacement,
      manualReplacementCandidates: _candidates,
      replaceManual: _replace,
      ...t
    } = row;
    t.isReviewed =
      manuallyCategorized.has(t.id) ||
      t.isReviewed ||
      !!draft.parserReview?.rowChecks.find(
        (check) => check.rowId === t.parseRowId,
      )?.reviewAction;
    if (overrideValidation && t.checkLevel === "review")
      t.checkLevel = "manual_override";
    t.updatedAt = new Date().toISOString();
    t.transactionFingerprint = await fingerprint(t);
    incoming.push(t);
  }
  await auditedMutation(
    `Import ${draft.statement.sourceFilename}`,
    [
      "accounts",
      "statements",
      "transactions",
      "transferLinks",
      "categories",
      "rules",
      "settings",
      "attachments",
      "monthCloses",
      "transferProposals",
      "fxRates",
      "importDiagnostics",
      "layoutTemplates",
    ],
    async () => {
      await ensureMonthsOpen(await importMonthGuardDates([draft]));
      const categories = await db.categories.toArray();
      for (const t of incoming) {
        if (
          (t.categoryId && !categories.some((c) => c.id === t.categoryId)) ||
          (t.subcategoryId &&
            !categories.some(
              (c) => c.id === t.subcategoryId && c.parentId === t.categoryId,
            ))
        )
          throw new Error(
            "Categories changed during review. Parse the statement again before importing.",
          );
      }
      const already = await db.statements
        .where("sourceFileHash")
        .equals(draft.statement.sourceFileHash)
        .count();
      if (already && !draft.duplicateOverride)
        throw new Error(
          "This statement was just imported. Nothing was saved twice.",
        );
      const concurrentAccounts = await db.accounts
        .where("institution")
        .equals(draft.account.institution)
        .filter(
          (a) =>
            !a.isDemo &&
            a.currency === draft.account.currency &&
            (a.accountType === "credit") ===
              (draft.account.accountType === "credit") &&
            a.maskedAccountIdentifier === draft.account.maskedAccountIdentifier,
        )
        .toArray();
      if (
        !(await db.accounts.get(draft.account.id)) &&
        concurrentAccounts.length
      )
        throw new Error(
          "Account history changed during review. Parse again to use the newly created account.",
        );
      const accountExisting = await db.transactions
        .where("accountId")
        .equals(draft.account.id)
        .toArray();
      for (const t of incoming) {
        const status = duplicateStatus(
          t,
          accountExisting.filter(
            (old) => old.source !== "manual" && !old.parentId,
          ),
          draft.regenerated,
        );
        const reviewed = draft.transactions.find((r) => r.id === t.id)!;
        if (status !== "none" && reviewed.duplicate === "none")
          throw new Error(
            "Transaction history changed during review. Parse the statement again to review new duplicates.",
          );
        if (
          !reviewed.manualReplacementId &&
          accountExisting.some(
            (manual) =>
              manual.source === "manual" &&
              manual.currency === t.currency &&
              manual.amount === t.amount &&
              dayDistance(manual.date, t.date) <= 1 &&
              !manual.parentId,
          )
        )
          throw new Error(
            "A matching manual transaction was added during review. Check the import again before saving it.",
          );
      }
      for (const t of incoming) {
        const reviewed = draft.transactions.find((row) => row.id === t.id)!;
        if (!reviewed.manualReplacementId || !reviewed.replaceManual) continue;
        const manual = await db.transactions.get(reviewed.manualReplacementId);
        if (
          !manual ||
          manual.source !== "manual" ||
          manual.accountId !== t.accountId ||
          manual.currency !== t.currency ||
          manual.amount !== t.amount ||
          dayDistance(manual.date, t.date) > 1 ||
          manual.parentId
        )
          throw new Error(
            "The matching manual transaction changed. Check this import again before replacing it.",
          );
        const referencedByRefund = await db.transactions
          .filter((record) =>
            Boolean(
              record.refundAllocations?.some(
                (allocation) => allocation.transactionId === manual.id,
              ),
            ),
          )
          .count();
        if (
          manual.transferPairId ||
          manual.kind === "split_parent" ||
          manual.refundAllocations?.length ||
          referencedByRefund
        )
          throw new Error(
            "This manual transaction has a transfer, split or refund link. Unlink or unsplit it before replacing it, or keep both records during review.",
          );
        await ensureMonthsOpen([manual]);
        t.tags = [...new Set([...(manual.tags ?? []), ...(t.tags ?? [])])];
        t.sourceMerchant = t.sourceMerchant ?? t.merchant;
        t.merchant = manual.merchant;
        t.note = manual.note;
        t.attachmentIds = manual.attachmentIds;
        for (const attachmentId of manual.attachmentIds ?? [])
          await db.attachments.update(attachmentId, { transactionId: t.id });
        if (manual.categoryId) {
          t.categoryId = manual.categoryId;
          t.subcategoryId = manual.subcategoryId;
          t.categorySource = manual.categorySource;
          t.categoryRuleId = manual.categoryRuleId;
          t.ruleSplit = undefined;
          t.kind = manual.kind ?? "normal";
          t.type = t.amount < 0 ? "expense" : "income";
          t.isTransfer = false;
        }
        t.isReviewed = manual.isReviewed;
        if (manual.isTransfer || manual.type === "transfer") {
          t.isTransfer = true;
          t.type = "transfer";
          t.kind =
            manual.kind === "card_repayment" ? "card_repayment" : "transfer";
          t.categoryId = undefined;
          t.subcategoryId = undefined;
          t.ruleSplit = undefined;
        } else if (manual.kind === "refund") {
          t.kind = "refund";
          t.refundAllocations = manual.refundAllocations;
          t.ruleSplit = undefined;
        }
        await db.transactions.delete(manual.id);
      }
      await db.accounts.put({
        ...draft.account,
        updatedAt: new Date().toISOString(),
      });
      const firstImport =
        firstRealImportAt(
          await db.statements.toArray(),
          (await db.settings.get("firstRealImportAt"))?.value,
        ) ?? draft.statement.importedAt;
      await db.settings.put({ key: "firstRealImportAt", value: firstImport });
      await db.statements.add({
        ...draft.statement,
        validationStatus: validation.status,
        validationDifference: validation.difference,
        transactionCount: incoming.length,
        validationOverride:
          validation.status === "warning" && overrideValidation,
      });
      const storedImportCount = Number(
        (await db.settings.get("backup:importsSinceExport"))?.value ?? 0,
      );
      const importCount =
        Number.isSafeInteger(storedImportCount) && storedImportCount >= 0
          ? storedImportCount
          : 0;
      if (importCount === Number.MAX_SAFE_INTEGER)
        throw new Error(
          "The backup reminder count is outside its supported range. Export a backup before importing.",
        );
      await db.settings.put({
        key: "backup:importsSinceExport",
        value: String(importCount + 1),
      });
      if (draft.parserReview)
        await retainImportDiagnostics(
          {
            id: `pdf:${draft.statement.sourceFileHash}`,
            statementId: draft.statement.id,
            createdAt: new Date().toISOString(),
            parserVersion: draft.statement.parserVersion,
            method: draft.statement.parserMethod ?? "text",
            table: draft.parserReview.table,
            rows: draft.parserReview.rowChecks,
            checks: draft.parserReview.checks,
          },
          db,
        );
      await db.transactions.bulkAdd(incoming);
      for (const t of incoming) {
        if (manuallyCategorized.has(t.id)) {
          const rule = await rememberCategory(t);
          await db.transactions.update(t.id, {
            categorySource: "manual",
            categoryRuleId: rule?.id,
          });
        } else if (t.categoryRuleId) {
          await db.rules.update(t.categoryRuleId, {
            lastUsedAt: new Date().toISOString(),
          });
        }
      }
      for (const t of incoming) {
        if (t.ruleSplit) {
          const children = transactionSplitRows(t, t.ruleSplit);
          await db.transactions.bulkAdd(children);
          await db.transactions.update(t.id, {
            kind: "split_parent",
            categoryId: undefined,
            subcategoryId: undefined,
            ruleSplit: undefined,
          });
        }
      }
      await consumeRuleApplications(incoming);
      if (draft.statement.extractionMethod === "CSV" && draft.csvMapping) {
        await db.settings.put({
          key: `csv-mapping:${draft.account.id}`,
          value: JSON.stringify(draft.csvMapping),
        });
      }
      if (
        draft.confirmedTransferProposalIds?.length ||
        draft.rejectedTransferProposalIds?.length
      ) {
        const dates = incoming.map((row) => row.date).sort();
        const shift = (date: string, offset: number) =>
          new Date(Date.parse(`${date}T12:00:00Z`) + offset * 86400000)
            .toISOString()
            .slice(0, 10);
        const nearby = await db.transactions
          .where("date")
          .between(
            shift(dates[0] ?? draft.statement.statementPeriodStart, -90),
            shift(dates.at(-1) ?? draft.statement.statementPeriodEnd, 7),
            true,
            true,
          )
          .toArray();
        const rates = await db.fxRates.toArray();
        const currency = (await db.settings.get("currency"))?.value ?? "GBP";
        const window = Number(
          (await db.settings.get("transferDateWindowDays"))?.value ??
            (await db.settings.get("transferDateWindow"))?.value ??
            4,
        );
        const proposals = findTransferProposals(
          markRefundCandidates(nearby),
          await db.accounts.toArray(),
          {
            dateWindow:
              Number.isInteger(window) && window >= 0 && window <= 7
                ? window
                : 4,
            crossCurrencyValue: (row) =>
              convertMinor(row.amount, row.currency, currency, row.date, rates)
                ?.amount,
          },
        );
        const selected = proposals.filter((proposal) =>
          draft.confirmedTransferProposalIds?.includes(proposal.id),
        );
        for (const proposalId of draft.confirmedTransferProposalIds ?? []) {
          if (selected.some((proposal) => proposal.id === proposalId)) continue;
          const storedProposal = await db.transferProposals.get(proposalId);
          if (storedProposal?.status === "confirmed") continue;
          const participants = proposalId.startsWith("transfer:")
            ? proposalId.slice("transfer:".length).split(":")
            : [];
          if (
            participants.length === 2 &&
            participants.some((transactionId) =>
              pendingTransactionIds.has(transactionId),
            )
          )
            continue;
          throw new Error(
            "A confirmed transfer no longer matches after the import corrections. Review the transfer before importing again.",
          );
        }
        const used = new Set<string>();
        for (const proposal of selected) {
          if (used.has(proposal.debitTxId) || used.has(proposal.creditTxId))
            throw new Error(
              "Choose only one transfer match for each transaction.",
            );
          used.add(proposal.debitTxId);
          used.add(proposal.creditTxId);
          await db.transferProposals.put(proposal);
          await applyTransferProposal(proposal, true);
        }
        // Persist a reviewer's decision only once both real ledger rows exist.
        // This happens in the same audited import transaction, before the
        // automatic matcher runs, including the last file of a multi-file pair.
        for (const proposal of proposals.filter((candidate) =>
          draft.rejectedTransferProposalIds?.includes(candidate.id),
        )) {
          if (draft.confirmedTransferProposalIds?.includes(proposal.id))
            throw new Error(
              "A transfer cannot be both confirmed and left unlinked.",
            );
          await db.transferProposals.put({ ...proposal, status: "rejected" });
        }
      }
    },
  );
  const { refreshTransferProposals, classifyRefundCandidates } =
    await import("../storage/accuracy");
  await classifyRefundCandidates(incoming.map((t) => t.id));
  await refreshTransferProposals(
    incoming.map((t) => t.id),
    deferAutomaticTransfers ? { mode: "manual" } : {},
  );
  return incoming.length;
}
