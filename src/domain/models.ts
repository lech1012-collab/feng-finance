export const APP_VERSION = "1.0.0";
export const SCHEMA_VERSION = 2;
export type Institution = "Barclays" | "American Express" | "Revolut" | "Other";
export type TransactionType = "income" | "expense" | "transfer";
export type ValidationStatus =
  "reconciled" | "warning" | "cannot-reconcile" | "unavailable";
// Monetary values are ALWAYS integer minor units. GBP 5000 means £50.00.
export interface Account {
  id: string;
  institution: Institution;
  displayName: string;
  accountType: "current" | "credit" | "savings";
  currency: string;
  maskedAccountIdentifier: string;
  createdAt: string;
  updatedAt: string;
  isDemo?: boolean;
}
export interface Statement {
  id: string;
  institution: Institution;
  accountId: string;
  statementPeriodStart: string;
  statementPeriodEnd: string;
  openingBalance?: number;
  closingBalance?: number;
  currency: string;
  sourceFilename: string;
  sourceFileHash: string;
  importedAt: string;
  parserVersion: string;
  extractionMethod: "embedded-text" | "OCR" | "manual-review";
  validationStatus: ValidationStatus;
  validationDifference?: number;
  transactionCount: number;
  validationOverride?: boolean;
  warnings: string[];
  isDemo?: boolean;
}
export interface Transaction {
  id: string;
  accountId: string;
  statementId: string;
  date: string;
  bookingDate?: string;
  description: string;
  merchant: string;
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
}
export interface TransferLink {
  id: string;
  transactionIds: [string, string];
  createdAt: string;
  manual: boolean;
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
}
export interface Reconciliation {
  status: ValidationStatus;
  calculated?: number;
  reported?: number;
  difference?: number;
}
export interface PageTextItem {
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
export interface ParsedStatement {
  institution: Institution;
  accountIdentifier?: string;
  accountType: Account["accountType"];
  periodStart: string;
  periodEnd: string;
  currency: string;
  openingBalance?: number;
  closingBalance?: number;
  transactions: ParsedTransaction[];
  warnings: string[];
}
export interface ParsedTransaction {
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
}
export interface ImportDraft {
  statement: Statement;
  account: Account;
  transactions: DraftTransaction[];
  exactDuplicate: boolean;
  regenerated: boolean;
  detectionConfidence: number;
  warnings: string[];
  reviewedWarnings: boolean;
  duplicateOverride: boolean;
}
