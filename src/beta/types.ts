import type {
  CheckLevel,
  ColumnRole,
  ParserMethod,
  RowCheck,
  TableRowKind,
} from "../domain/models";

/** Public build configuration. Contains no runtime or financial identifiers. */
export interface ReleaseConfiguration {
  appVersion: string;
  buildDate: string;
  feedbackUrl?: string;
  feedbackEmail?: string;
  feedbackContextParameter?: string;
}

/** Explicit allowlist: do not add raw user agents, URLs, account IDs or finance. */
export interface FeedbackTechnicalContext {
  appVersion: string;
  buildDate: string;
  deviceType: "iphone" | "ipad" | "mobile" | "desktop";
  operatingSystem: string;
  browser: string;
  displayMode: "installed" | "tab";
  screenWidth: number;
}

export interface RedactedImportDiagnostics {
  format: "feng-redacted-import-diagnostics";
  version: 1;
  appVersion: string;
  parserVersion: string;
  method: ParserMethod;
  columns: { role: ColumnRole; x0: number; x1: number }[];
  pages: { width: number; height: number }[];
  rows: {
    page: number;
    kind: TableRowKind;
    cells: {
      role: ColumnRole;
      text: "[date]" | "[amount]" | "[text]" | "[blank]";
      x: number;
      y: number;
      width: number;
      height: number;
    }[];
    checkLevel?: CheckLevel;
    reconciles?: boolean;
    issueCodes: RowCheck["issues"];
  }[];
  checks: {
    exact: boolean;
    balancePassed: number;
    balanceFailed: number;
    totalChecked: number;
    needsReview: number;
    unreadPageCount: number;
  };
}
