import { z } from "zod";
import { db, defaultCategories, defaultRules } from "./database";
import { SCHEMA_VERSION, type Backup } from "../domain/models";
import { currencyPrecision, decimalMoney } from "../domain/money";
const identifier = z.string().min(1).max(200);
const text = z.string().max(10000);
const timestamp = z.iso.datetime();
const date = z.iso.date();
const minor = z.number().int().refine(Number.isSafeInteger);
const currency = z.string().refine((s) => {
  try {
    currencyPrecision(s);
    return true;
  } catch {
    return false;
  }
});
const institution = z.enum([
  "Barclays",
  "American Express",
  "Revolut",
  "Other",
]);
const kind = z.enum(["income", "expense", "transfer"]);
const account = z.object({
  id: identifier,
  institution,
  displayName: text,
  accountType: z.enum(["current", "credit", "savings"]),
  currency,
  maskedAccountIdentifier: text,
  createdAt: timestamp,
  updatedAt: timestamp,
  isDemo: z.boolean().optional(),
});
const statement = z.object({
  id: identifier,
  institution,
  accountId: identifier,
  statementPeriodStart: date,
  statementPeriodEnd: date,
  openingBalance: minor.optional(),
  closingBalance: minor.optional(),
  currency,
  sourceFilename: text,
  sourceFileHash: identifier,
  importedAt: timestamp,
  parserVersion: identifier,
  extractionMethod: z.enum(["embedded-text", "OCR", "manual-review"]),
  validationStatus: z.enum([
    "reconciled",
    "warning",
    "cannot-reconcile",
    "unavailable",
  ]),
  validationDifference: minor.optional(),
  transactionCount: z.number().int().nonnegative(),
  validationOverride: z.boolean().optional(),
  warnings: z.array(text),
  isDemo: z.boolean().optional(),
});
const transaction = z.object({
  id: identifier,
  accountId: identifier,
  statementId: identifier,
  date,
  bookingDate: date.optional(),
  description: text,
  merchant: text,
  amount: minor,
  currency,
  balanceAfterTransaction: minor.optional(),
  type: kind,
  categoryId: identifier.optional(),
  subcategoryId: identifier.optional(),
  tags: z.array(text),
  sourcePage: z.number().int().positive(),
  extractionConfidence: z.number().min(0).max(1),
  transactionFingerprint: identifier,
  occurrence: z.number().int().nonnegative(),
  isTransfer: z.boolean(),
  transferPairId: identifier.optional(),
  isReviewed: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
  isDemo: z.boolean().optional(),
});
const category = z.object({
  id: identifier,
  name: z.string().min(1).max(200),
  kind: z.enum(["income", "expense"]),
  parentId: identifier.optional(),
  archived: z.boolean(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
const rule = z.object({
  id: identifier,
  name: text,
  match: z.enum(["contains", "starts-with", "exact"]),
  pattern: z.string().min(1).max(500),
  accountId: identifier.optional(),
  direction: z.enum(["any", "positive", "negative"]),
  minAmount: minor.nonnegative().optional(),
  maxAmount: minor.nonnegative().optional(),
  categoryId: identifier.optional(),
  subcategoryId: identifier.optional(),
  type: kind.optional(),
  priority: z.number().int(),
  builtIn: z.boolean(),
});
const link = z.object({
  id: identifier,
  transactionIds: z.tuple([identifier, identifier]),
  createdAt: timestamp,
  manual: z.boolean(),
});
const schema = z.object({
  format: z.literal("feng-finance"),
  version: z.literal(1),
  schemaVersion: z.number().int().min(1).max(SCHEMA_VERSION),
  moneyUnit: z.literal("minor"),
  exportedAt: timestamp,
  accounts: z.array(account),
  statements: z.array(statement),
  transactions: z.array(transaction),
  categories: z.array(category),
  rules: z.array(rule),
  transferLinks: z.array(link),
  settings: z.array(z.object({ key: identifier, value: text })),
});
export function validateBackup(input: unknown): Backup {
  const b = schema.parse(input);
  const unique = (items: { id: string }[]) =>
    new Set(items.map((x) => x.id)).size === items.length;
  if (
    ![
      b.accounts,
      b.statements,
      b.transactions,
      b.categories,
      b.rules,
      b.transferLinks,
    ].every(unique) ||
    new Set(b.settings.map((s) => s.key)).size !== b.settings.length
  )
    throw new Error("Backup contains duplicate identifiers.");
  const accounts = new Map(b.accounts.map((a) => [a.id, a]));
  const statements = new Map(b.statements.map((s) => [s.id, s]));
  const categories = new Map(b.categories.map((c) => [c.id, c]));
  const transactions = new Map(b.transactions.map((t) => [t.id, t]));
  const links = new Map(b.transferLinks.map((l) => [l.id, l]));
  const validCategory = (main?: string, sub?: string) =>
    (!main && !sub) ||
    (!!main &&
      categories.has(main) &&
      (!sub || categories.get(sub)?.parentId === main));
  for (const c of b.categories)
    if (
      c.parentId &&
      (!categories.has(c.parentId) ||
        categories.get(c.parentId)?.parentId ||
        categories.get(c.parentId)?.kind !== c.kind)
    )
      throw new Error("Invalid category hierarchy.");
  for (const s of b.statements)
    if (
      !accounts.has(s.accountId) ||
      accounts.get(s.accountId)?.currency !== s.currency ||
      s.statementPeriodStart > s.statementPeriodEnd
    )
      throw new Error("Invalid statement account or period.");
  const counts = new Map<string, number>();
  for (const t of b.transactions) {
    const s = statements.get(t.statementId);
    if (
      !s ||
      s.accountId !== t.accountId ||
      !accounts.has(t.accountId) ||
      s.currency !== t.currency ||
      !validCategory(t.categoryId, t.subcategoryId) ||
      t.isTransfer !== (t.type === "transfer") ||
      (t.transferPairId &&
        !links.get(t.transferPairId)?.transactionIds.includes(t.id))
    )
      throw new Error("Backup contains inconsistent transaction references.");
    counts.set(t.statementId, (counts.get(t.statementId) ?? 0) + 1);
  }
  for (const s of b.statements)
    if (s.transactionCount !== (counts.get(s.id) ?? 0))
      throw new Error("Backup statement transaction count does not match.");
  for (const r of b.rules)
    if (
      (r.accountId && !accounts.has(r.accountId)) ||
      !validCategory(r.categoryId, r.subcategoryId) ||
      (r.type !== "transfer" && !r.categoryId) ||
      (r.minAmount !== undefined &&
        r.maxAmount !== undefined &&
        r.minAmount > r.maxAmount)
    )
      throw new Error("Invalid categorization rule.");
  for (const l of b.transferLinks) {
    const [a, c] = l.transactionIds.map((id) => transactions.get(id));
    if (
      !a ||
      !c ||
      a.id === c.id ||
      a.accountId === c.accountId ||
      a.currency !== c.currency ||
      a.amount === 0 ||
      a.amount !== -c.amount ||
      a.transferPairId !== l.id ||
      c.transferPairId !== l.id ||
      !a.isTransfer ||
      !c.isTransfer
    )
      throw new Error("Invalid transfer link.");
  }
  return b;
}
export async function createBackup(): Promise<Backup> {
  return db.transaction("r", db.tables, async () => ({
    format: "feng-finance",
    version: 1,
    schemaVersion: SCHEMA_VERSION,
    moneyUnit: "minor",
    exportedAt: new Date().toISOString(),
    accounts: await db.accounts.toArray(),
    statements: await db.statements.toArray(),
    transactions: await db.transactions.toArray(),
    categories: await db.categories.toArray(),
    rules: await db.rules.toArray(),
    transferLinks: await db.transferLinks.toArray(),
    settings: await db.settings.toArray(),
  }));
}
export async function restoreBackup(input: unknown) {
  const b = validateBackup(input);
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
    await db.accounts.bulkAdd(b.accounts);
    await db.statements.bulkAdd(b.statements);
    await db.transactions.bulkAdd(b.transactions);
    await db.categories.bulkAdd(b.categories);
    await db.rules.bulkAdd(b.rules);
    await db.transferLinks.bulkAdd(b.transferLinks);
    await db.settings.bulkPut(b.settings);
    await db.settings.put({ key: "initialized", value: "true" });
  });
}
export async function clearLocalData() {
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
    await db.categories.bulkPut(defaultCategories);
    await db.rules.bulkPut(defaultRules);
    await db.settings.put({ key: "initialized", value: "true" });
  });
}
export function download(contents: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function exportCsv() {
  const transactions = await db.transactions.orderBy("date").toArray();
  const accounts = await db.accounts.toArray();
  const categories = await db.categories.toArray();
  const cell = (value: unknown, numeric = false) => {
    const str = String(value ?? "");
    return (
      '"' +
      (!numeric && /^[\s]*[=+\-@\t\r]/.test(str) ? "'" + str : str).replaceAll(
        '"',
        '""',
      ) +
      '"'
    );
  };
  const header = [
    "Date",
    "Description",
    "Merchant",
    "Amount",
    "Currency",
    "Account",
    "Institution",
    "Type",
    "Category",
    "Subcategory",
    "Tags",
    "Statement ID",
  ];
  const rows = transactions.map((t) => {
    const a = accounts.find((a) => a.id === t.accountId);
    return [
      t.date,
      t.description,
      t.merchant,
      decimalMoney(t.amount, t.currency),
      t.currency,
      a?.displayName,
      a?.institution,
      t.type,
      categories.find((c) => c.id === t.categoryId)?.name,
      categories.find((c) => c.id === t.subcategoryId)?.name,
      t.tags.join("; "),
      t.statementId,
    ]
      .map((value, index) => cell(value, index === 3))
      .join(",");
  });
  return (
    "\uFEFF" +
    header.map((value) => cell(value)).join(",") +
    "\r\n" +
    rows.join("\r\n")
  );
}
