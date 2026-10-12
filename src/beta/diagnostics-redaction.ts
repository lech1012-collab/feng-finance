import type {
  CheckLevel,
  ColumnRole,
  ImportDiagnostics,
  RowCheck,
  TableRowKind,
} from "../domain/models";
import type { RedactedImportDiagnostics } from "./types";

const roles: readonly ColumnRole[] = [
  "date",
  "description",
  "in",
  "out",
  "amount",
  "balance",
  "ignore",
];
const kinds: readonly TableRowKind[] = [
  "transaction",
  "header",
  "continuation",
  "carry",
  "subtotal",
  "section",
  "footer",
  "unknown",
];
const levels: readonly CheckLevel[] = [
  "balance",
  "total",
  "ocr",
  "review",
  "manual_override",
];
const issues: readonly RowCheck["issues"][number][] = [
  "invalid-date",
  "outside-period",
  "invalid-amount",
  "missing-description",
  "missing-balance",
  "balance-difference",
  "ambiguous-reading",
  "unread-page",
];
const methods = [
  "text",
  "text+ocr",
  "ocr",
  "template",
  "user_mapping",
] as const;
const safeVersion = (value: string) =>
  /^\d+(?:\.\d+){1,3}(?:-[a-zA-Z0-9.-]+)?$/.test(value) ? value : "unknown";
const geometry = (value: number) =>
  Number.isFinite(value) ? Math.round(Math.max(0, Math.min(10000, value))) : 0;
const count = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
const role = (value: ColumnRole | undefined): ColumnRole =>
  roles.includes(value ?? "ignore") ? (value ?? "ignore") : "ignore";

/**
 * Rebuild an explicit structural allowlist, rather than deleting known sensitive keys.
 * ALL cell text is replaced, including dates, headers and numeric balance cells.
 * Unknown fields, IDs, filenames, raw differences, crops and reading values vanish.
 */
export function redactImportDiagnostics(
  diagnostics: ImportDiagnostics,
  appVersion: string,
): RedactedImportDiagnostics {
  const columnRoles = new Map(
    diagnostics.table.columns.map((column) => [
      column.id,
      role(column.inferredRole),
    ]),
  );
  const rowChecks = new Map(
    diagnostics.rows.map((check) => [check.rowId, check]),
  );
  return {
    format: "feng-redacted-import-diagnostics",
    version: 1,
    appVersion: safeVersion(appVersion),
    parserVersion: safeVersion(diagnostics.parserVersion),
    method: methods.includes(diagnostics.method) ? diagnostics.method : "text",
    columns: diagnostics.table.columns.map((column) => ({
      role: role(column.inferredRole),
      x0: geometry(column.x0),
      x1: geometry(column.x1),
    })),
    pages: diagnostics.table.pages.map((page) => ({
      width: geometry(page.width),
      height: geometry(page.height),
    })),
    rows: diagnostics.table.rows.map((row) => {
      const check = rowChecks.get(row.id);
      return {
        page: count(row.rect.page),
        kind: kinds.includes(row.kind) ? row.kind : "unknown",
        cells: row.cells.map((cell) => {
          const cellRole = columnRoles.get(cell.columnId) ?? "ignore";
          const placeholder = !cell.text.trim()
            ? "[blank]"
            : cellRole === "date"
              ? "[date]"
              : ["in", "out", "amount", "balance"].includes(cellRole)
                ? "[amount]"
                : "[text]";
          return {
            role: cellRole,
            text: placeholder as "[date]" | "[amount]" | "[text]" | "[blank]",
            x: geometry(cell.rect.x),
            y: geometry(cell.rect.y),
            width: geometry(cell.rect.width),
            height: geometry(cell.rect.height),
          };
        }),
        ...(check && levels.includes(check.checkLevel)
          ? {
              checkLevel: check.checkLevel,
              reconciles:
                check.difference === 0 && check.checkLevel !== "review",
            }
          : {}),
        issueCodes:
          check?.issues.filter((issue) => issues.includes(issue)) ?? [],
      };
    }),
    checks: {
      exact: diagnostics.checks.reconciledExactly === true,
      balancePassed: count(diagnostics.checks.balanceRowsPassed),
      balanceFailed: count(diagnostics.checks.balanceRowsFailed),
      totalChecked: count(diagnostics.checks.totalCheckedRows),
      needsReview: count(diagnostics.checks.needsReviewRows),
      unreadPageCount: diagnostics.checks.unreadPages.length,
    },
  };
}

export function redactedDiagnosticsText(
  diagnostics: ImportDiagnostics[],
  appVersion: string,
): string {
  return JSON.stringify(
    {
      format: "feng-redacted-import-diagnostics-bundle",
      version: 1,
      imports: diagnostics
        .slice(-5)
        .map((entry) => redactImportDiagnostics(entry, appVersion)),
    },
    null,
    2,
  );
}
