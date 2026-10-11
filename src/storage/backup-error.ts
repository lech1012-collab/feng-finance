import { ZodError } from "zod";
import { BackupFileTooLargeError } from "./backup-limits";

const unsupportedBackup =
  "This is not a supported Feng Finance backup. Choose a JSON file exported using Export Feng Finance Backup. Your existing data has not been changed.";

export class UnsupportedBackupVersionError extends Error {
  constructor() {
    super(
      "This backup version is not supported. Update Feng Finance before restoring it.",
    );
    this.name = "UnsupportedBackupVersionError";
  }
}

const integrityErrors = new Set([
  "Backup contains duplicate identifiers.",
  "Invalid category hierarchy.",
  "Invalid statement account or period.",
  "Backup contains inconsistent transaction references.",
  "Backup statement transaction count does not match.",
  "Invalid categorization rule.",
  "Invalid transfer link.",
  "Backup contains an invalid split transaction.",
  "Backup contains an invalid attachment reference.",
  "Backup contains an invalid recurring-series reference.",
  "Refunds must be positive money-in transactions.",
  "Backup contains an invalid refund allocation.",
  "Backup contains an invalid refund purchase.",
  "Refunds exceed the original purchase amount.",
  "Split amounts do not equal their original transaction.",
  "Invalid valuation account.",
  "Invalid pot reference or duplicate contribution month.",
  "Invalid budget category.",
  "Invalid recurring-series account.",
  "Invalid attachment data or owner.",
  "Invalid transfer proposal.",
  "Invalid audit history.",
  "Audit history contains an invalid record identifier.",
]);

/** Never expose schema dumps, imported values or browser storage diagnostics. */
export function backupErrorMessage(
  error: unknown,
  operation: "validate" | "restore" = "validate",
): string {
  if (error instanceof UnsupportedBackupVersionError)
    return "This backup version is not supported by this app. Update Feng Finance, then try again, or choose a compatible backup. Your existing data has not been changed.";
  if (error instanceof BackupFileTooLargeError)
    return "This backup exceeds the 100 MB restore limit. Choose a smaller Feng Finance backup exported without attachments. Your existing data has not been changed.";
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
