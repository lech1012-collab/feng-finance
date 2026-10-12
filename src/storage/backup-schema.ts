import { z } from "zod";
import { layoutTemplateSchema } from "./layout-template-schema";
import { SCHEMA_VERSION } from "../domain/models";
import { currencyPrecision } from "../domain/money";
export const identifier = z.string().min(1).max(200);
const text = z.string().max(10000);
const validBase64 = (value: string) =>
  value.length % 4 === 0 &&
  !/[^A-Za-z0-9+/]/.test(value.replace(/={1,2}$/, ""));
const timestamp = z.iso.datetime();
const date = z.iso.date();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const minor = z.number().int().refine(Number.isSafeInteger);
const currency = z.string().refine((s) => {
  try {
    currencyPrecision(s);
    return true;
  } catch {
    return false;
  }
});
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const institution = z.enum([
  "Barclays",
  "American Express",
  "Revolut",
  "Other",
]);
const type = z.enum(["income", "expense", "transfer"]);
const kind = z.enum([
  "normal",
  "transfer",
  "card_repayment",
  "refund",
  "split_parent",
]);
const condition = z.object({
  field: z.enum([
    "description",
    "merchant",
    "amount",
    "direction",
    "accountId",
    "day",
    "currency",
    "tag",
    "kind",
    "reviewed",
    "source",
    "date",
    "note",
    "categoryId",
    "search",
    "displayMerchant",
  ]),
  operator: z.enum([
    "contains",
    "starts-with",
    "equals",
    "regex",
    "gt",
    "gte",
    "lt",
    "lte",
    "between",
    "in",
  ]),
  value: z.union([text, minor, z.boolean(), z.array(text)]),
  valueTo: z.union([text, minor]).optional(),
});
const action = z.object({
  type: z.enum([
    "category",
    "rename",
    "tag",
    "kind",
    "split",
    "reviewed",
    "recurring",
  ]),
  categoryId: identifier.optional(),
  subcategoryId: identifier.optional(),
  merchant: text.optional(),
  tagIds: z.array(identifier).optional(),
  kind: kind.optional(),
  reviewed: z.boolean().optional(),
  recurringSeriesId: identifier.optional(),
  splits: z
    .array(
      z.object({
        categoryId: identifier,
        percentage: z.number().min(0).max(100),
        tagIds: z.array(identifier).optional(),
      }),
    )
    .min(2)
    .max(20)
    .optional(),
});
export const accountSchema = z.object({
  id: identifier,
  institution,
  displayName: text,
  accountType: z.enum([
    "current",
    "credit",
    "savings",
    "credit_card",
    "loan",
    "mortgage",
    "property",
    "vehicle",
    "pension",
    "investment",
    "other_asset",
    "other_liability",
  ]),
  currency,
  maskedAccountIdentifier: text,
  createdAt: timestamp,
  updatedAt: timestamp,
  isDemo: z.boolean().optional(),
  tracking: z.enum(["statement", "manual"]).optional(),
  includeInNetWorth: z.boolean().optional(),
  apr: z.number().min(0).max(1000).optional(),
  minPaymentMinor: minor.nonnegative().optional(),
  valuationReminderDays: z.number().int().min(1).max(3650).optional(),
});
export const statementSchema = z.object({
  id: identifier,
  institution,
  accountId: identifier,
  statementPeriodStart: date,
  statementPeriodEnd: date,
  periodSource: z
    .enum(["printed", "manual", "transaction-coverage"])
    .optional(),
  statementDate: date.optional(),
  openingBalance: minor.optional(),
  closingBalance: minor.optional(),
  currency,
  sourceFilename: text,
  sourceFileHash: identifier,
  importedAt: timestamp,
  parserVersion: identifier,
  extractionMethod: z.enum([
    "embedded-text",
    "OCR",
    "manual-review",
    "CSV",
    "OFX",
    "QIF",
  ]),
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
  parserMethod: z
    .enum(["text", "text+ocr", "ocr", "template", "user_mapping"])
    .optional(),
  rowsBalanceChecked: z.number().int().nonnegative().optional(),
  rowsTotalChecked: z.number().int().nonnegative().optional(),
  rowsNeedingReview: z.number().int().nonnegative().optional(),
  bankProfileId: identifier.optional(),
  validationPolicy: z.literal("exact-v2.2").optional(),
  rowsExcludedByReview: z.number().int().nonnegative().optional(),
  unreadPages: z.array(z.number().int().positive()).optional(),
  layoutTemplateId: identifier.optional(),
});
export const transactionSchema = z.object({
  id: identifier,
  accountId: identifier,
  statementId: z.string().max(200),
  date,
  bookingDate: date.optional(),
  description: text,
  merchant: text,
  sourceMerchant: text.optional(),
  categorySource: z.enum(["manual", "rule"]).optional(),
  categoryRuleId: identifier.optional(),
  amount: minor,
  currency,
  balanceAfterTransaction: minor.optional(),
  type,
  categoryId: identifier.optional(),
  subcategoryId: identifier.optional(),
  tags: z.array(text),
  sourcePage: z.number().int().nonnegative(),
  extractionConfidence: z.number().min(0).max(1),
  transactionFingerprint: identifier,
  occurrence: z.number().int().nonnegative(),
  isTransfer: z.boolean(),
  transferPairId: identifier.optional(),
  isReviewed: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
  isDemo: z.boolean().optional(),
  kind: kind.optional(),
  parentId: identifier.optional(),
  linkId: identifier.optional(),
  refundAllocations: z
    .array(z.object({ transactionId: identifier, amount: minor.positive() }))
    .optional(),
  note: text.optional(),
  attachmentIds: z.array(identifier).max(5).optional(),
  source: z.enum(["pdf", "csv", "ofx", "qif", "manual", "split"]).optional(),
  recurringSeriesId: identifier.optional(),
  sourceId: identifier.optional(),
  appliedRuleIds: z.array(identifier).optional(),
  checkLevel: z
    .enum(["balance", "total", "ocr", "review", "manual_override"])
    .optional(),
  parseSource: z.enum(["text", "ocr", "user"]).optional(),
  layoutTemplateId: identifier.optional(),
  parseRowId: identifier.optional(),
  ruleSplit: z
    .array(
      z.object({
        categoryId: identifier,
        amount: minor,
        tags: z.array(text).optional(),
      }),
    )
    .optional(),
});
export const categorySchema = z.object({
  id: identifier,
  name: z.string().min(1).max(200),
  kind: z.enum(["income", "expense"]),
  parentId: identifier.optional(),
  archived: z.boolean(),
  color: colour,
});
export const ruleSchema = z.object({
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
  type: type.optional(),
  priority: z.number().int(),
  builtIn: z.boolean(),
  lastUsedAt: timestamp.optional(),
  enabled: z.boolean().optional(),
  conditions: z.array(condition).max(50).optional(),
  conditionMatch: z.enum(["all", "any"]).optional(),
  actions: z.array(action).max(50).optional(),
  stopProcessing: z.boolean().optional(),
  singleUse: z.boolean().optional(),
  auto: z.boolean().optional(),
  createdFrom: z.enum(["auto", "user"]).optional(),
  stats: z
    .object({
      hits: z.number().int().nonnegative(),
      lastHit: timestamp.optional(),
    })
    .optional(),
});
export const linkSchema = z.object({
  id: identifier,
  transactionIds: z.tuple([identifier, identifier]),
  createdAt: timestamp,
  manual: z.boolean(),
  crossCurrency: z.boolean().optional(),
});
export const valuationSchema = z.object({
  id: identifier,
  accountId: identifier,
  date,
  valueMinor: minor,
  note: text.optional(),
  isDemo: z.boolean().optional(),
});
export const tagSchema = z.object({
  id: identifier,
  name: z.string().min(1).max(200),
  colour,
  archived: z.boolean(),
  isDemo: z.boolean().optional(),
});
export const potSchema = z.object({
  cadence: z.enum(["monthly", "quarterly", "annual"]).optional(),
  id: identifier,
  type: z.enum(["goal", "sinking"]),
  name: text,
  targetMinor: minor.nonnegative(),
  currency,
  targetDate: date.optional(),
  linkedCategoryId: identifier.optional(),
  linkedAccountId: identifier.optional(),
  contributions: z.array(z.object({ month, amountMinor: minor.nonnegative() })),
  createdAt: timestamp,
  isDemo: z.boolean().optional(),
});
export const budgetSchema = z.object({
  id: identifier,
  categoryId: identifier,
  month,
  currency,
  amountMinor: minor.nonnegative(),
  rollover: z.enum(["none", "surplus", "both"]),
});
export const recurringSchema = z.object({
  id: identifier,
  matchKey: text,
  accountId: identifier,
  name: text,
  currency,
  cadence: z.enum(["weekly", "monthly", "quarterly", "annual"]),
  expectedAmountMinor: minor,
  amountHistory: z.array(z.object({ date, amountMinor: minor })),
  nextDue: date,
  status: z.enum(["active", "ignored", "cancel-planned"]),
  endDate: date.optional(),
  lastAcknowledgedAmount: minor.optional(),
  note: text.optional(),
  isDemo: z.boolean().optional(),
});
export const monthCloseSchema = z.object({
  month,
  closedAt: timestamp,
  currency: currency.optional(),
  snapshot: z.object({
    income: minor,
    expenses: minor,
    net: minor,
    transactionCount: z.number().int().nonnegative(),
    categoryTotals: z.record(z.string(), minor).optional(),
  }),
  updatedAt: timestamp.optional(),
});
export const attachmentSchema = z.object({
  id: identifier,
  transactionId: identifier,
  mime: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z
    .number()
    .int()
    .min(0)
    .max(30 * 1024 * 1024),
  name: text.optional(),
  createdAt: timestamp.optional(),
  dataBase64: z
    .string()
    .max(42 * 1024 * 1024)
    .refine(validBase64),
});
export const fxSchema = z.object({
  id: identifier,
  date,
  base: currency,
  quote: currency,
  rate: z
    .string()
    .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/)
    .refine((value) => Number(value) > 0 && Number.isFinite(Number(value))),
  source: z.enum(["ecb", "manual"]),
});
export const proposalSchema = z.object({
  id: identifier,
  debitTxId: identifier,
  creditTxId: identifier,
  score: z.number().min(0).max(1),
  status: z.enum(["pending", "confirmed", "rejected"]),
  pairKind: z.enum(["transfer", "card_repayment"]).optional(),
  createdAt: timestamp.optional(),
  crossCurrency: z.boolean().optional(),
});
export const viewSchema = z.object({
  id: identifier,
  name: text,
  conditions: z.array(condition),
  match: z.enum(["all", "any"]),
  pinned: z.boolean(),
  query: text.optional(),
});
export const reportSchema = z.object({
  id: identifier,
  name: text,
  groupBy: z.enum(["category", "tag", "account", "merchant", "month"]),
  measure: z.enum(["sum", "count", "average"]),
  chart: z.enum(["table", "bar", "line"]),
  conditions: z.array(condition),
  pinned: z.boolean(),
});
export const scenarioSchema = z.object({
  currency: currency.optional(),
  id: identifier,
  name: text,
  createdAt: timestamp,
  changes: z.array(
    z.object({
      id: identifier,
      date,
      amountMinor: minor,
      description: text,
      type: z.enum(["one-off", "recurring-change", "pause", "new-recurring"]),
      recurringSeriesId: identifier.optional(),
      endDate: date.optional(),
    }),
  ),
});
export const changeLogSchema = z.object({
  id: identifier,
  label: text,
  createdAt: timestamp,
  undoneAt: timestamp.optional(),
  changes: z.array(
    z.object({
      table: identifier,
      key: identifier,
      before: z.unknown().optional(),
      after: z.unknown().optional(),
    }),
  ),
});
export const settingSchema = z.object({ key: identifier, value: text });
export const backupSchema = z.object({
  format: z.literal("feng-finance"),
  version: z.literal(1),
  schemaVersion: z.number().int().min(1).max(SCHEMA_VERSION),
  moneyUnit: z.literal("minor"),
  exportedAt: timestamp,
  accounts: z.array(accountSchema),
  statements: z.array(statementSchema),
  transactions: z.array(transactionSchema),
  categories: z.array(categorySchema),
  rules: z.array(ruleSchema),
  transferLinks: z.array(linkSchema),
  settings: z.array(settingSchema),
  valuations: z.array(valuationSchema).optional(),
  pots: z.array(potSchema).optional(),
  budgets: z.array(budgetSchema).optional(),
  tags: z.array(tagSchema).optional(),
  recurringSeries: z.array(recurringSchema).optional(),
  monthCloses: z.array(monthCloseSchema).optional(),
  attachments: z.array(attachmentSchema).optional(),
  fxRates: z.array(fxSchema).optional(),
  transferProposals: z.array(proposalSchema).optional(),
  savedViews: z.array(viewSchema).optional(),
  savedReports: z.array(reportSchema).optional(),
  scenarios: z.array(scenarioSchema).optional(),
  changeLog: z.array(changeLogSchema).optional(),
  layoutTemplates: z.array(layoutTemplateSchema).optional(),
});
export const auditAttachmentSchema = attachmentSchema
  .omit({ dataBase64: true })
  .extend({
    blob: z.object({
      __fengBlob: z.object({
        mime: z.string().max(200),
        dataBase64: z
          .string()
          .max(42 * 1024 * 1024)
          .refine(validBase64),
      }),
    }),
  });
export const auditRecordSchemas: Record<
  string,
  { parse: (input: unknown) => unknown }
> = {
  accounts: accountSchema,
  statements: statementSchema,
  transactions: transactionSchema,
  categories: categorySchema,
  rules: ruleSchema,
  transferLinks: linkSchema,
  settings: settingSchema,
  valuations: valuationSchema,
  pots: potSchema,
  budgets: budgetSchema,
  tags: tagSchema,
  recurringSeries: recurringSchema,
  monthCloses: monthCloseSchema,
  attachments: auditAttachmentSchema,
  fxRates: fxSchema,
  transferProposals: proposalSchema,
  savedViews: viewSchema,
  savedReports: reportSchema,
  scenarios: scenarioSchema,
  layoutTemplates: layoutTemplateSchema,
};
