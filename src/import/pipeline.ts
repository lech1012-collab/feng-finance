import type {
  ImportDraft,
  Institution,
  PageTextItem,
  TextRow,
  Transaction,
  Account,
} from "../domain/models";
import { db } from "../storage/database";
import { id, fingerprint, transactionKey } from "../domain/normalize";
import { parseDate } from "../domain/dates";
import { currencyPrecision } from "../domain/money";
import { reconstructRows } from "./layout";
import { detectBank } from "./detection";
import { getParser } from "../parsers";
import { PARSER_VERSION } from "../parsers/interface";
import type { StatementPeriod } from "../parsers/period";
import { duplicateStatus } from "./duplicates";
import { categorize } from "../categorization/engine";
import { matchTransfers } from "../transfers/engine";
import { reconcile } from "../domain/reconcile";
import { rememberCategory } from "../storage/category-memory";
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
  rows: TextRow[];
  hash: string;
  filename: string;
  method: "embedded-text" | "OCR";
  warnings: string[];
}
export async function extractFile(
  file: File,
  progress: (s: string) => void,
  forceOcr = false,
): Promise<ExtractedFile> {
  const { validateFile, openPdf, extractEmbedded } = await import("./pdf");
  progress("Checking PDF and calculating fingerprint…");
  const { bytes, hash } = await validateFile(file);
  const doc = await openPdf(bytes);
  try {
    const embedded = await extractEmbedded(doc, progress);
    let items: PageTextItem[] = embedded.items;
    const ocrPages = forceOcr
      ? Array.from({ length: doc.numPages }, (_, i) => i + 1)
      : embedded.emptyPages;
    if (ocrPages.length) {
      progress("Preparing local OCR…");
      const { extractOcr } = await import("./ocr");
      const scanned = await extractOcr(doc, ocrPages, progress);
      items = [...items.filter((i) => !ocrPages.includes(i.page)), ...scanned];
    }
    return {
      rows: reconstructRows(items),
      hash,
      filename: file.name,
      method: ocrPages.length ? "OCR" : "embedded-text",
      warnings: ocrPages.length
        ? [
            "Scanned text was read with local OCR. Verify every transaction amount against the source PDF.",
          ]
        : [],
    };
  } finally {
    await doc.loadingTask.destroy();
  }
}
export async function prepareDraft(
  extracted: ExtractedFile,
  selectedBank?: Institution,
  selectedAccount?: Account,
  periodOverride?: StatementPeriod,
  pendingDrafts: ImportDraft[] = [],
): Promise<ImportDraft> {
  const detection = detectBank(extracted.rows);
  if (
    !selectedBank &&
    (detection.institution === "Other" ||
      detection.confidence < 0.7 ||
      detection.ambiguous)
  )
    throw new Error(
      "Bank detection is uncertain. Select the bank and parse again.",
    );
  const parser = getParser(
    selectedBank ?? detection.institution,
    extracted.rows,
  );
  const parsed = parser.parse(extracted.rows, periodOverride);
  const now = new Date().toISOString();
  const accounts = await db.accounts.toArray();
  for (const pending of pendingDrafts)
    if (!accounts.some((a) => a.id === pending.account.id))
      accounts.push(pending.account);
  const existingAccounts = accounts.filter(
    (a) =>
      !a.isDemo &&
      a.institution === parsed.institution &&
      a.currency === parsed.currency &&
      (a.accountType === "credit") === (parsed.accountType === "credit") &&
      a.maskedAccountIdentifier === parsed.accountIdentifier,
  );
  if (!selectedAccount && !parsed.accountIdentifier)
    throw new Error(
      "Account identifier could not be read. Select an existing account, or create one in Settings, then parse again.",
    );
  if (existingAccounts.length > 1 && !selectedAccount)
    throw new Error(
      "More than one account has this masked identifier. Select the matching account.",
    );
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
    (account.accountType === "credit") !== (parsed.accountType === "credit") ||
    account.isDemo
  )
    throw new Error(
      "Selected account does not match this statement bank, currency and account type.",
    );
  const sid = id();
  const validation = parser.validate(parsed);
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
      isTransfer: p.type === "transfer",
      isReviewed: false,
      createdAt: now,
      updatedAt: now,
    };
    const key = transactionKey(t);
    t.occurrence = counts.get(key) ?? 0;
    counts.set(key, t.occurrence + 1);
    t.transactionFingerprint = await fingerprint(t);
    Object.assign(t, applyCategory(t, rules, existing, categories));
    const duplicate = duplicateStatus(t, existing, regenerated);
    transactions.push({
      ...t,
      duplicate,
      include: duplicate === "none",
      acknowledged: p.extractionConfidence >= 0.8,
    });
  }
  const warnings = [...extracted.warnings, ...parsed.warnings];
  return {
    account,
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
    },
    transactions,
    exactDuplicate:
      (await db.statements
        .where("sourceFileHash")
        .equals(extracted.hash)
        .count()) > 0 ||
      pendingDrafts.some((d) => d.statement.sourceFileHash === extracted.hash),
    regenerated,
    detectionConfidence: detection.confidence,
    warnings,
    reviewedWarnings: false,
    duplicateOverride: false,
  };
}
export function draftReconciliation(draft: ImportDraft) {
  return reconcile(
    draft.statement.openingBalance,
    draft.statement.closingBalance,
    draft.transactions.map((t) => t.amount),
  );
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
    const duplicate = duplicateStatus(next, existing, regenerated);
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
    currencyPrecision(t.currency);
    if (
      !Number.isSafeInteger(t.amount) ||
      (t.balanceAfterTransaction !== undefined &&
        !Number.isSafeInteger(t.balanceAfterTransaction))
    )
      throw new Error("A transaction amount is invalid.");
    if (t.include && t.extractionConfidence < 0.8 && !t.acknowledged)
      throw new Error("Verify every uncertain transaction before importing.");
    if (t.include && t.duplicate !== "none" && !t.acknowledged)
      throw new Error("Confirm potential duplicates before keeping them.");
    if (!t.description.trim())
      throw new Error("Transaction descriptions must not be empty.");
    if (
      t.date < draft.statement.statementPeriodStart ||
      t.date > draft.statement.statementPeriodEnd
    )
      if (!draft.reviewedWarnings)
        throw new Error("Transaction date is outside the statement period.");
  }
  return validation;
}
export async function commitDraft(
  draft: ImportDraft,
  overrideValidation = false,
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
      ...t
    } = row;
    t.isReviewed = row.acknowledged;
    t.updatedAt = new Date().toISOString();
    t.transactionFingerprint = await fingerprint(t);
    incoming.push(t);
  }
  await db.transaction(
    "rw",
    [
      db.accounts,
      db.statements,
      db.transactions,
      db.transferLinks,
      db.categories,
      db.rules,
    ],
    async () => {
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
        const status = duplicateStatus(t, accountExisting, draft.regenerated);
        const reviewed = draft.transactions.find((r) => r.id === t.id)!;
        if (status !== "none" && reviewed.duplicate === "none")
          throw new Error(
            "Transaction history changed during review. Parse the statement again to review new duplicates.",
          );
      }
      const start = draft.transactions.reduce(
        (s, t) => (t.date < s ? t.date : s),
        draft.statement.statementPeriodStart,
      );
      const end = draft.transactions.reduce(
        (s, t) => (t.date > s ? t.date : s),
        draft.statement.statementPeriodEnd,
      );
      const shift = (date: string, days: number) =>
        new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
      const nearby = await db.transactions
        .where("[currency+date]")
        .between(
          [draft.account.currency, shift(start, -5)],
          [draft.account.currency, shift(end, 6)],
          true,
          false,
        )
        .toArray();
      const accounts = await db.accounts.toArray();
      if (!accounts.some((a) => a.id === draft.account.id))
        accounts.push(draft.account);
      const links = matchTransfers([...nearby, ...incoming], accounts);
      const changed = new Map<string, Transaction>();
      for (const link of links)
        for (const tid of link.transactionIds) {
          const t = [...nearby, ...incoming].find((t) => t.id === tid)!;
          Object.assign(t, {
            type: "transfer",
            isTransfer: true,
            categoryId: undefined,
            subcategoryId: undefined,
            transferPairId: link.id,
          });
          changed.set(t.id, t);
        }
      await db.accounts.put({
        ...draft.account,
        updatedAt: new Date().toISOString(),
      });
      await db.statements.add({
        ...draft.statement,
        validationStatus: validation.status,
        validationDifference: validation.difference,
        transactionCount: incoming.length,
        validationOverride:
          validation.status === "warning" && overrideValidation,
      });
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
      const updates = [...changed.values()].filter(
        (t) => !incoming.some((i) => i.id === t.id),
      );
      if (updates.length) await db.transactions.bulkPut(updates);
      if (links.length) await db.transferLinks.bulkAdd(links);
    },
  );
  return incoming.length;
}
