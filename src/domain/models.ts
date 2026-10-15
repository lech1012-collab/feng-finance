import type { BankAdapterSource } from "../import/bank-adapter-proof";
import type {
  TransactionParserMetadata,
  StatementParserMetadata,
  GenericParseResult,
  LayoutTemplate,
  ReconstructedTable,
  RowCheck,
  StatementChecks,
  ParserMethod,
} from "../import/generic/types";
export type {
  LayoutTemplate,
  CheckLevel,
  ColumnRole,
  ParserMethod,
  RowCheck,
  TableRowKind,
} from "../import/generic/types";
export const APP_VERSION = "2.2.7";
export const SCHEMA_VERSION = 4;
export type Institution = "Barclays" | "American Express" | "Revolut" | "Other";
export type TransactionType = "income" | "expense" | "transfer";
export type TransactionKind =
  "normal" | "transfer" | "card_repayment" | "refund" | "split_parent";
export type TransactionSource =
  "pdf" | "csv" | "ofx" | "qif" | "manual" | "split";
export type AccountType =
  | "current"
  | "credit"
  | "savings"
  | "credit_card"
  | "loan"
  | "mortgage"
  | "property"
  | "vehicle"
  | "pension"
  | "investment"
  | "other_asset"
  | "other_liability";
export type ValidationStatus =
  "reconciled" | "warning" | "cannot-reconcile" | "unavailable";
// Monetary values are ALWAYS integer minor units. GBP 5000 means £50.00.
export interface Account {
  id: string;
  institution: Institution;
  displayName: string;
  accountType: AccountType;
  tracking?: "statement" | "manual";
  includeInNetWorth?: boolean;
  apr?: number;
  minPaymentMinor?: number;
  valuationReminderDays?: number;
  currency: string;
  maskedAccountIdentifier: string;
  createdAt: string;
  updatedAt: string;
  isDemo?: boolean;
}
export interface Statement extends StatementParserMetadata {
  id: string;
  institution: Institution;
  accountId: string;
  statementPeriodStart: string;
  statementPeriodEnd: string;
  periodSource?: "printed" | "manual" | "transaction-coverage";
  statementDate?: string;
  openingBalance?: number;
  closingBalance?: number;
  currency: string;
  sourceFilename: string;
  sourceFileHash: string;
  importedAt: string;
  parserVersion: string;
  extractionMethod:
    "embedded-text" | "OCR" | "manual-review" | "CSV" | "OFX" | "QIF";
  validationStatus: ValidationStatus;
  validationDifference?: number;
  transactionCount: number;
  validationOverride?: boolean;
  warnings: string[];
  isDemo?: boolean;
}
export interface Transaction extends TransactionParserMetadata {
  id: string;
  accountId: string;
  statementId: string;
  date: string;
  bookingDate?: string;
  description: string;
  merchant: string;
  sourceMerchant?: string;
  categorySource?: "manual" | "rule";
  categoryRuleId?: string;
  amount: number;
  currency: string;
  balanceAfterTransaction?: number;
  type: TransactionType;
  categoryId?: string;
  subcategoryId?: string;
  tags: string[];
  sourcePage: number;
  extractionConfidence: number;
  transactionFingerprint: string;
  occurrence: number;
  isTransfer: boolean;
  transferPairId?: string;
  isReviewed: boolean;
  createdAt: string;
  updatedAt: string;
  isDemo?: boolean;
  kind?: TransactionKind;
  parentId?: string;
  linkId?: string;
  refundAllocations?: { transactionId: string; amount: number }[];
  note?: string;
  attachmentIds?: string[];
  source?: TransactionSource;
  recurringSeriesId?: string;
  sourceId?: string;
  appliedRuleIds?: string[];
  ruleSplit?: { categoryId: string; amount: number; tags?: string[] }[];
}
export interface Category {
  id: string;
  name: string;
  kind: "income" | "expense";
  parentId?: string;
  archived: boolean;
  color: string;
}
export interface Rule {
  id: string;
  name: string;
  match: "contains" | "starts-with" | "exact";
  pattern: string;
  accountId?: string;
  direction: "any" | "positive" | "negative";
  minAmount?: number;
  maxAmount?: number;
  categoryId?: string;
  subcategoryId?: string;
  type?: TransactionType;
  priority: number;
  builtIn: boolean;
  lastUsedAt?: string;
  enabled?: boolean;
  conditions?: RuleCondition[];
  conditionMatch?: "all" | "any";
  actions?: RuleAction[];
  stopProcessing?: boolean;
  singleUse?: boolean;
  auto?: boolean;
  createdFrom?: "auto" | "user";
  stats?: { hits: number; lastHit?: string };
}
export interface TransferLink {
  id: string;
  transactionIds: [string, string];
  createdAt: string;
  manual: boolean;
  crossCurrency?: boolean;
}
export interface Setting {
  key: string;
  value: string;
}
export interface Backup {
  format: "feng-finance";
  version: 1;
  schemaVersion: number;
  moneyUnit: "minor";
  exportedAt: string;
  accounts: Account[];
  statements: Statement[];
  transactions: Transaction[];
  categories: Category[];
  rules: Rule[];
  transferLinks: TransferLink[];
  settings: Setting[];
  valuations?: ManualValuation[];
  pots?: Pot[];
  budgets?: MonthlyBudget[];
  tags?: Tag[];
  recurringSeries?: RecurringSeries[];
  monthCloses?: MonthClose[];
  attachments?: SerializedAttachment[];
  fxRates?: FxRate[];
  transferProposals?: TransferProposal[];
  savedViews?: SavedView[];
  savedReports?: SavedReport[];
  scenarios?: Scenario[];
  changeLog?: ChangeLog[];
  layoutTemplates?: LayoutTemplate[];
}
export interface Reconciliation {
  status: ValidationStatus;
  calculated?: number;
  reported?: number;
  difference?: number;
}
export interface PageTextItem {
  fontSize?: number;
  parseSource?: "text" | "ocr";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
  confidence?: number;
}
export interface TextRow {
  page: number;
  y: number;
  items: PageTextItem[];
  text: string;
}
export interface ParsedStatement extends StatementParserMetadata {
  institution: Institution;
  accountIdentifier?: string;
  accountType: Account["accountType"];
  periodStart: string;
  periodEnd: string;
  periodSource?: "printed" | "manual" | "transaction-coverage";
  statementDate?: string;
  currency: string;
  openingBalance?: number;
  closingBalance?: number;
  transactions: ParsedTransaction[];
  warnings: string[];
}
export interface ParsedTransaction extends TransactionParserMetadata {
  sourceId?: string;
  date: string;
  bookingDate?: string;
  description: string;
  merchant: string;
  amount: number;
  currency: string;
  balanceAfterTransaction?: number;
  type: TransactionType;
  sourcePage: number;
  extractionConfidence: number;
}
export interface DraftTransaction extends Transaction {
  duplicate: "none" | "certain" | "possible";
  include: boolean;
  acknowledged: boolean;
  manualCategory?: boolean;
  manualReplacementId?: string;
  manualReplacementCandidates?: {
    id: string;
    date: string;
    description: string;
  }[];
  replaceManual?: boolean;
}
export interface ImportDraft {
  /** Source evidence exists only during this import, never in portable records. */
  parserReview?: GenericParseResult;
  /** Original supported-bank facts, detached from editable draft rows. */
  bankSource?: BankAdapterSource;
  parserFallback?: boolean;
  statement: Statement;
  account: Account;
  transactions: DraftTransaction[];
  exactDuplicate: boolean;
  regenerated: boolean;
  detectionConfidence: number;
  warnings: string[];
  reviewedWarnings: boolean;
  duplicateOverride: boolean;
  csvMapping?: import("../import/formats").CsvMapping;
  confirmedTransferProposalIds?: string[];
  /** Explicitly left unlinked during Automatic import review. */
  rejectedTransferProposalIds?: string[];
}

/** Amount conditions use absolute minor-unit amounts; direction handles the sign. A between comparison includes both ends. */
export interface RuleCondition {
  field:
    | "description"
    | "merchant"
    | "amount"
    | "direction"
    | "accountId"
    | "day"
    | "currency"
    | "tag"
    | "kind"
    | "reviewed"
    | "source"
    | "date"
    | "note"
    | "categoryId"
    | "search"
    | "displayMerchant";
  operator:
    | "contains"
    | "starts-with"
    | "equals"
    | "regex"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "between"
    | "in";
  value: string | number | boolean | string[];
  valueTo?: string | number;
}
export interface RuleAction {
  type:
    "category" | "rename" | "tag" | "kind" | "split" | "reviewed" | "recurring";
  categoryId?: string;
  subcategoryId?: string;
  merchant?: string;
  tagIds?: string[];
  kind?: TransactionKind;
  reviewed?: boolean;
  recurringSeriesId?: string;
  splits?: { categoryId: string; percentage: number; tagIds?: string[] }[];
}
export interface ManualValuation {
  id: string;
  accountId: string;
  date: string;
  valueMinor: number;
  note?: string;
  isDemo?: boolean;
}
export interface Tag {
  id: string;
  name: string;
  colour: string;
  archived: boolean;
  isDemo?: boolean;
}
export interface Pot {
  cadence?: "monthly" | "quarterly" | "annual";
  id: string;
  type: "goal" | "sinking";
  name: string;
  targetMinor: number;
  currency: string;
  targetDate?: string;
  linkedCategoryId?: string;
  linkedAccountId?: string;
  contributions: { month: string; amountMinor: number }[];
  createdAt: string;
  isDemo?: boolean;
}
export interface MonthlyBudget {
  id: string;
  categoryId: string;
  month: string;
  currency: string;
  amountMinor: number;
  rollover: "none" | "surplus" | "both";
}
export interface RecurringSeries {
  id: string;
  matchKey: string;
  accountId: string;
  name: string;
  currency: string;
  cadence: "weekly" | "monthly" | "quarterly" | "annual";
  expectedAmountMinor: number;
  amountHistory: { date: string; amountMinor: number }[];
  nextDue: string;
  status: "active" | "ignored" | "cancel-planned";
  endDate?: string;
  lastAcknowledgedAmount?: number;
  note?: string;
  isDemo?: boolean;
}
export interface MonthClose {
  month: string;
  closedAt: string;
  currency?: string;
  snapshot: {
    income: number;
    expenses: number;
    net: number;
    transactionCount: number;
    categoryTotals?: Record<string, number>;
  };
  updatedAt?: string;
}
export interface Attachment {
  id: string;
  transactionId: string;
  mime: string;
  sizeBytes: number;
  blob: Blob;
  name?: string;
  createdAt?: string;
}
export interface SerializedAttachment extends Omit<Attachment, "blob"> {
  dataBase64: string;
}
/** Decimal rate strings retain exact downloaded precision; money conversion uses integer arithmetic. */
export interface FxRate {
  id: string;
  date: string;
  base: string;
  quote: string;
  rate: string;
  source: "ecb" | "manual";
}
export interface TransferProposal {
  id: string;
  debitTxId: string;
  creditTxId: string;
  score: number;
  status: "pending" | "confirmed" | "rejected";
  pairKind?: "transfer" | "card_repayment";
  createdAt?: string;
  crossCurrency?: boolean;
}
export interface SavedView {
  id: string;
  name: string;
  conditions: RuleCondition[];
  match: "all" | "any";
  pinned: boolean;
  query?: string;
}
export interface SavedReport {
  id: string;
  name: string;
  groupBy: "category" | "tag" | "account" | "merchant" | "month";
  measure: "sum" | "count" | "average";
  chart: "table" | "bar" | "line";
  conditions: RuleCondition[];
  pinned: boolean;
}
export interface Scenario {
  currency?: string;
  id: string;
  name: string;
  createdAt: string;
  changes: {
    id: string;
    date: string;
    amountMinor: number;
    description: string;
    type: "one-off" | "recurring-change" | "pause" | "new-recurring";
    recurringSeriesId?: string;
    endDate?: string;
  }[];
}
export interface ChangeLog {
  id: string;
  label: string;
  createdAt: string;
  undoneAt?: string;
  changes: { table: string; key: string; before?: unknown; after?: unknown }[];
}

export interface ImportDiagnostics {
  id: string;
  statementId?: string;
  createdAt: string;
  parserVersion: string;
  method: ParserMethod;
  table: ReconstructedTable;
  rows: RowCheck[];
  checks: StatementChecks;
}
