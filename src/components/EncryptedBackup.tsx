import { useRef, useState } from "react";
import type { Backup } from "../domain/models";
import {
  backupExportSettings,
  createBackup,
  download,
  markBackupExported,
  validateBackup,
} from "../storage/backup";
import {
  BackupPasswordRequired,
  decodeBackupUpload,
  encryptBackup,
  type EncryptedBackupHeader,
} from "../security/backup-encryption";
import { formatUkDate } from "../domain/dates";
import { backupErrorMessage } from "../storage/backup-error";
import "../security/security.css";
export function EncryptedBackup({
  onRestorePreview,
}: {
  onRestorePreview: (backup: Backup) => void;
}) {
  const [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [includeAttachments, setIncludeAttachments] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [pending, setPending] = useState<{
    file: File;
    header: EncryptedBackupHeader;
  }>();
  const [restorePassword, setRestorePassword] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const exportEncrypted = async () => {
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const backup = await createBackup({ includeAttachments });
      const metadata = backupExportSettings(backup);
      backup.settings = [
        ...backup.settings.filter(
          (setting) => !metadata.some((entry) => entry.key === setting.key),
        ),
        ...metadata,
      ];
      const file = await encryptBackup(backup, password);
      download(
        JSON.stringify(file),
        "application/vnd.feng.backup+json",
        `feng-finance-backup-${backup.exportedAt.slice(0, 10)}.feng`,
      );
      await markBackupExported(backup);
      setPassword("");
      setConfirmation("");
      setNotice(
        "Encrypted backup ready. Save it in Files or another safe location.",
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The backup could not be created.",
      );
    } finally {
      setBusy(false);
    }
  };
  const prepareRestore = async (file: File, secret?: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const decoded = await decodeBackupUpload(file, secret);
      let backup: Backup;
      try {
        backup = validateBackup(decoded);
      } catch (failure) {
        throw new Error(backupErrorMessage(failure));
      }
      onRestorePreview(backup);
      setPending(undefined);
      setRestorePassword("");
    } catch (failure) {
      if (failure instanceof BackupPasswordRequired)
        setPending({ file, header: failure.header });
      else
        setError(
          failure instanceof Error
            ? failure.message
            : "This backup could not be opened. No data has changed.",
        );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" id="encrypted-backup">
      <h2>Encrypted backup</h2>
      <p>
        Protect a portable .feng backup with a password. Encryption runs
        entirely on this device.
      </p>
      <form
        className="security-fields"
        onSubmit={(event) => {
          event.preventDefault();
          void exportEncrypted();
        }}
      >
        <label>
          Backup password
          <input
            type="password"
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Confirm backup password
          <input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={busy}
          />
        </label>
        <label className="security-checkbox">
          <input
            type="checkbox"
            checked={includeAttachments}
            onChange={(event) => setIncludeAttachments(event.target.checked)}
            disabled={busy}
          />
          Include images and PDFs attached to transactions
        </label>
        <p className="notice warning">
          Keep this password safe. A lost password means this backup cannot be
          recovered.
        </p>
        <button
          type="submit"
          className="primary"
          disabled={busy || password.length < 8 || !confirmation}
        >
          {busy ? "Working…" : "Export encrypted backup"}
        </button>
      </form>
      <hr />
      <input
        ref={picker}
        className="visually-hidden"
        type="file"
        accept=".feng,.json,application/json,application/vnd.feng.backup+json"
        aria-label="Choose Feng backup"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void prepareRestore(file);
          event.target.value = "";
        }}
      />
      <button disabled={busy} onClick={() => picker.current?.click()}>
        Open a .feng backup
      </button>
      {pending && (
        <form
          className="security-fields"
          onSubmit={(event) => {
            event.preventDefault();
            void prepareRestore(pending.file, restorePassword);
          }}
        >
          <p>
            Encrypted backup from{" "}
            {formatUkDate(pending.header.createdAt.slice(0, 10))}. Your data
            will stay unchanged until you review and confirm the restore.
          </p>
          <label>
            Backup password
            <input
              autoFocus
              type="password"
              value={restorePassword}
              autoComplete="off"
              onChange={(event) => setRestorePassword(event.target.value)}
              disabled={busy}
            />
          </label>
          <div className="security-actions">
            <button className="primary" disabled={busy || !restorePassword}>
              Unlock and preview
            </button>
            <button
              type="button"
              onClick={() => {
                setPending(undefined);
                setRestorePassword("");
                setError("");
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
