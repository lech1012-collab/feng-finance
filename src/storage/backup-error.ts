import { ZodError } from "zod";

const unsupportedBackup =
  "This is not a supported Feng Finance backup. Choose a JSON file exported using Export Feng Finance Backup. Your existing data has not been changed.";

const integrityErrors = new Set([
  "Backup contains duplicate identifiers.",
  "Invalid category hierarchy.",
  "Invalid statement account or period.",
  "Backup contains inconsistent transaction references.",
  "Backup statement transaction count does not match.",
  "Invalid categorization rule.",
  "Invalid transfer link.",
]);

/** Never expose schema dumps, imported values or browser storage diagnostics. */
export function backupErrorMessage(
  error: unknown,
  operation: "validate" | "restore" = "validate",
): string {
  if (error instanceof SyntaxError)
    return "This file is not valid JSON. Choose an original Feng Finance backup exported from Settings. Your existing data has not been changed.";

  if (error instanceof ZodError) {
    if (
      error.issues.length > 0 &&
      error.issues.every(
        (issue) =>
          issue.path.length === 1 &&
          ["version", "schemaVersion"].includes(String(issue.path[0])),
      )
    )
      return "This backup version is not supported by this app. Update Feng Finance, then try again, or choose a compatible backup. Your existing data has not been changed.";
    if (
      error.issues.length > 0 &&
      error.issues.every(
        (issue) => issue.path.length === 1 && issue.path[0] === "moneyUnit",
      )
    )
      return "This backup uses an unsupported amount format. Choose an original Feng Finance backup; do not change or convert its amounts. Your existing data has not been changed.";
    return unsupportedBackup;
  }

  if (error instanceof Error) {
    if (operation === "validate" && error.name === "NotReadableError")
      return "The backup file could not be read. Save or download it locally in Files, then choose it again. Your existing data has not been changed.";
    if (error.message === "Backup exceeds the 50 MB limit.")
      return "This backup exceeds the 50 MB file limit. Choose a smaller Feng Finance backup. Your existing data has not been changed.";
    if (integrityErrors.has(error.message))
      return "This backup contains inconsistent or missing financial records and cannot be restored safely. Choose another original backup. Your existing data has not been changed.";
    if (operation === "restore" && error.name === "QuotaExceededError")
      return "There is not enough device storage to restore this backup. Free space without clearing Feng's site data, then try again. Your existing data has not been changed.";
  }

  return operation === "restore"
    ? "The backup could not be restored. Your existing data has not been changed. Close other Feng Finance tabs and try again. Keep your backup file safe."
    : unsupportedBackup;
}
