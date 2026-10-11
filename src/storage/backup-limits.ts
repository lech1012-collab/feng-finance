/** Shared upload/export ceiling; every downloaded backup must fit its restore picker. */
export const MAX_BACKUP_FILE_BYTES = 100_000_000;
export class BackupFileTooLargeError extends Error {
  constructor() {
    super(
      "This backup exceeds the 100 MB restore limit. Turn off Include attachments in JSON backup in Settings and export again. You can save attached files separately; your data and last-backup status have not changed.",
    );
    this.name = "BackupFileTooLargeError";
  }
}
