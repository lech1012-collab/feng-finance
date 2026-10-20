import type {
  Account,
  Institution,
  PageTextItem,
  ParsedStatement,
  ParsedTransaction,
  Reconciliation,
} from "../../domain/models";
import type { StatementPeriod } from "../../parsers/period";
export type ISODate = string;
export type ISOInstant = string;
export type ParserMethod =
  "text" | "text+ocr" | "ocr" | "template" | "user_mapping";
export type ParseSource = "text" | "ocr" | "user";
export type CheckLevel =
  "balance" | "total" | "ocr" | "review" | "manual_override";
export type ColumnRole =
  "date" | "description" | "in" | "out" | "amount" | "balance" | "ignore";
export type SignConvention =
  "in_out_columns" | "signed_positive_in" | "signed_positive_out";

/** Optional on historical transaction entities, mandatory in new PDF evidence. */
export interface TransactionParserMetadata {
  checkLevel?: CheckLevel;
  parseSource?: ParseSource;
  layoutTemplateId?: string;
  /** Stable source-row identity, not a new duplicate/fingerprint input. */
  parseRowId?: string;
}
export interface StatementParserMetadata {
  parserMethod?: ParserMethod;
  rowsBalanceChecked?: number;
  rowsTotalChecked?: number;
  rowsNeedingReview?: number;
  bankProfileId?: string;
  /** Old statements keep their originally stored status; never relabel history. */
  validationPolicy?: "exact-v2.2";
  rowsExcludedByReview?: number;
  unreadPages?: number[];
  layoutTemplateId?: string;
}

/** All source rectangles use PDF.js scale-1 viewport coordinates, top-left origin. */
export interface SourceRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface SourcePage {
  page: number;
  width: number;
  height: number;
  rotation: number;
}
/** Add fontSize and parseSource optionally to the existing PageTextItem shape. */
export interface ExtractedTextItem extends PageTextItem {
  fontSize: number;
  parseSource: "text" | "ocr";
}
export interface PageQuality {
  page: number;
  usable: boolean;
  transactionTokenCount: number;
  recognisedTokenCount: number;
  usableFraction: number;
  reason?: "empty" | "garbled" | "low-transaction-token-quality";
}

export interface ColumnBand {
  id: string;
  x0: number;
  x1: number;
  alignment: "left" | "right";
  headerText: string;
  inferredRole?: ColumnRole;
}
export interface TableCell {
  columnId: string;
  text: string;
  rect: SourceRect;
  parseSource: "text" | "ocr";
}
export type TableRowKind =
  | "transaction"
  | "header"
  | "continuation"
  | "carry"
  | "subtotal"
  | "section"
  | "footer"
  | "unknown";
export interface ReconstructedRow {
  id: string;
  kind: TableRowKind;
  rect: SourceRect;
  cells: TableCell[];
  /** Continuations attach only after checking they contain no amount or date. */
  continuesRowId?: string;
  section?: string;
}
export interface ReconstructedTable {
  /** Columns may change per page; every cell refers to a column in this list. */
  columns: ColumnBand[];
  rows: ReconstructedRow[];
  pages: SourcePage[];
}

export interface LayoutTemplate {
  id: string;
  name: string;
  fingerprint: string;
  /** Optional display hint; never determines financial signs without checking. */
  institution?: Institution;
  bankProfileId?: string;
  columnRoles: { x0: number; x1: number; role: ColumnRole }[];
  /** x0/x1 are fractions of page width (0..1), not device CSS coordinates. */
  coordinateSpace: "page-width-fraction";
  signConvention: SignConvention;
  balanceSign?: 1 | -1;
  dateFormat: string;
  createdAt: ISOInstant;
  lastUsedAt: ISOInstant;
  status: "active" | "check_needed";
}
export interface LayoutMapping {
  columnRoles: { columnId: string; role: ColumnRole }[];
  signConvention: SignConvention;
  balanceSign?: 1 | -1;
  dateFormat: "day-first" | "month-first" | "iso" | "named-month" | "auto";
}
export interface BankProfile {
  id: "barclays-current" | "barclaycard" | "amex" | "revolut";
  institution: Institution;
  accountTypeHint: Account["accountType"];
  issuerPatterns: RegExp[];
  headerHints: Partial<Record<ColumnRole, string[]>>;
  signConventionHint: SignConvention;
  /** A section rule is a competing sign hint, never an arithmetic override. */
  sectionSignHints?: { pattern: RegExp; direction: "in" | "out" }[];
}

/**
 * Invalid readings have optional values, so malformed rows remain visible.
 * Do not invent 0 amounts/current dates to satisfy ParsedTransaction's contract.
 */
export interface RowReading {
  id: string;
  date?: ISODate;
  bookingDate?: ISODate;
  description: string;
  merchant?: string;
  amount?: number;
  balanceAfterTransaction?: number;
  parseSource: ParseSource;
  rawDate?: string;
  rawAmount?: string;
  rawBalance?: string;
}
export type RowReviewAction =
  | { kind: "accept"; readingId: string }
  | {
      kind: "correct";
      date: ISODate;
      bookingDate?: ISODate;
      description: string;
      amount: number;
      balanceAfterTransaction?: number;
    }
  | { kind: "exclude"; reason?: string };
export interface RowCheck {
  rowId: string;
  transactionId?: string;
  checkLevel: CheckLevel;
  parseSource: ParseSource;
  readings: RowReading[];
  selectedReadingId?: string;
  rect: SourceRect;
  amountRects: SourceRect[];
  balanceRects: SourceRect[];
  previousBalance?: number;
  calculatedBalance?: number;
  reportedBalance?: number;
  difference?: number;
  issues: (
    | "invalid-date"
    | "outside-period"
    | "invalid-amount"
    | "missing-description"
    | "missing-balance"
    | "balance-difference"
    | "ambiguous-reading"
    | "unread-page"
  )[];
  reviewAction?: RowReviewAction;
  /** accept/correct can resolve a row but cannot make unequal totals verified. */
  resolved: boolean;
}
export interface StatementChecks {
  policy: "exact-v2.2";
  reconciliation: Reconciliation;
  printedMoneyIn?: number;
  printedMoneyOut?: number;
  calculatedMoneyIn: number;
  calculatedMoneyOut: number;
  moneyInDifference?: number;
  moneyOutDifference?: number;
  balanceRowsPassed: number;
  balanceRowsFailed: number;
  totalCheckedRows: number;
  needsReviewRows: number;
  unreadPages: number[];
  evidence: (
    "running-balances" | "opening-closing" | "printed-movement-totals"
  )[];
  /** True only when independent source evidence is present and differs by 0. */
  reconciledExactly: boolean;
}
export interface CandidateReading {
  id: string;
  mapping: LayoutMapping;
  rows: RowCheck[];
  checks: StatementChecks;
  headerMatchScore: number;
  profileHintScore: number;
}
export interface ParserComparison {
  profileId: BankProfile["id"];
  legacyStatus: "matched" | "different" | "legacy-failed" | "not-applicable";
  differingRows: number[];
  /** Local-only details; never log to a server or automatically export. */
  legacyTransactions?: ParsedTransaction[];
}
export interface GenericParseResult {
  status: "parsed" | "mapping-required" | "identity-required";
  parsed?: ParsedStatement;
  table: ReconstructedTable;
  rowChecks: RowCheck[];
  candidates: CandidateReading[];
  checks: StatementChecks;
  selectedCandidateId?: string;
  mapping?: LayoutMapping;
  templateId?: string;
  layoutFingerprint: string;
  profileId?: BankProfile["id"];
  comparison?: ParserComparison;
  /** Never include account numbers or raw statement values in thrown errors. */
  errorCode?:
    | "missing-period"
    | "missing-currency"
    | "missing-account"
    | "mapping-needed"
    | "template-changed"
    | "rows-need-review";
}
export interface GenericParseOptions {
  institution?: Institution;
  account?: Pick<
    Account,
    "accountType" | "currency" | "maskedAccountIdentifier"
  >;
  period?: StatementPeriod;
  profile?: BankProfile;
  template?: LayoutTemplate;
  mapping?: LayoutMapping;
  /** Caller passes accumulated review actions on a live recheck. */
  actions?: Record<string, RowReviewAction>;
  /** Additional local cell-OCR readings; never persisted as transaction facts. */
  alternatives?: Record<string, RowReading[]>;
  /** Transient one-to-one native source corroboration, not a user override. */
  bankAmounts?: Record<string, number>;
  evidence?: {
    openingBalance?: number;
    closingBalance?: number;
    printedMoneyIn?: number;
    printedMoneyOut?: number;
  };
  unreadPages?: number[];
}
/** Pure, synchronous, bounded candidate enumeration; no DB, network or canvas. */
export interface GenericParserApi {
  parse(
    items: ExtractedTextItem[],
    pages: SourcePage[],
    options: GenericParseOptions,
  ): GenericParseResult;
  recheck(
    result: GenericParseResult,
    options: GenericParseOptions,
  ): GenericParseResult;
}
