import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import type { Backup } from "../domain/models";
import { db } from "../storage/database";
import {
  backupExportSettings,
  createBackup,
  download,
  markBackupExported,
  restoreBackup,
  validateBackup,
} from "../storage/backup";
import {
  BackupPasswordRequired,
  decodeBackupUpload,
  encryptBackup,
  type EncryptedBackupHeader,
} from "../security/backup-encryption";
import { backupErrorMessage } from "../storage/backup-error";
import { formatDateRange, formatUkDate } from "../domain/dates";
import { localToday } from "../analytics/reminders";
import { Sheet } from "./Sheet";
import { Toast } from "./Toast";
import { Eye, EyeOff, Archive } from "lucide-react";

function Password({
  label,
  value,
  onChange,
  disabled,
  confirm = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  confirm?: boolean;
}) {
  const [visible, setVisible] = useState(false),
    inputId = useId();
  return (
    <div>
      <label htmlFor={inputId}>{label}</label>
      <div className="password-field">
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          autoComplete={confirm ? "new-password" : "off"}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={20} /> : <Eye size={20} />}
        </button>
      </div>
    </div>
  );
}

/** One encrypted-by-default export and one backwards-compatible restore path. */
export function BackupCentre({
  requestSave = 0,
  onSaveOpened,
}: {
  requestSave?: number;
  onSaveOpened?: () => void;
}) {
  const navigate = useNavigate();
  const data = useLiveQuery(
    async () => ({
      count: await db.transactions.count(),
      last: (await db.settings.get("backup:lastExportAt"))?.value,
      exported: (await db.settings.get("backup:lastExportCount"))?.value,
    }),
    [],
  );
  const [saving, setSaving] = useState(false),
    [protect, setProtect] = useState(true),
    [includeAttachments, setIncludeAttachments] = useState(true);
  const [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [passwordFile, setPasswordFile] = useState<{
    file: File;
    header: EncryptedBackupHeader;
  }>();
  const [restorePassword, setRestorePassword] = useState("");
  const [pending, setPending] = useState<Backup>(),
    [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const picker = useRef<HTMLInputElement>(null),
    saveForm = useId(),
    passwordForm = useId();
  useEffect(() => {
    if (requestSave) {
      onSaveOpened?.();
      setSaving(true);
      setError("");
    }
  }, [requestSave]);
  const openSave = () => {
    setSaving(true);
    setProtect(true);
    setError("");
    setNotice("");
  };
  const closeSave = () => {
    if (!busy) {
      setSaving(false);
      setPassword("");
      setConfirmation("");
      setError("");
    }
  };
  const save = async () => {
    if (protect && password.length < 12) {
      setError("Use a password with at least 12 characters.");
      return;
    }
    if (protect && password !== confirmation) {
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
          (setting) => !metadata.some((item) => item.key === setting.key),
        ),
        ...metadata,
      ];
      const payload = protect ? await encryptBackup(backup, password) : backup;
      // Keep the actual download name recognisable in its receipt without
      // exposing an ISO timestamp in routine UI copy.
      const date = new Date(backup.exportedAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
      const name = `Feng ${date.replace(/\bSept\b/g, "Sep").replace(/\s+/g, "-")}.${protect ? "feng" : "json"}`;
      download(
        JSON.stringify(payload),
        protect ? "application/vnd.feng.backup+json" : "application/json",
        name,
      );
      await markBackupExported(backup);
      setSaving(false);
      setPassword("");
      setConfirmation("");
      setNotice(`Backup ready. ${name}. Save it in Files.`);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The backup could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  const read = async (file: File, secret?: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const backup = validateBackup(await decodeBackupUpload(file, secret));
      setPasswordFile(undefined);
      setRestorePassword("");
      setPending(backup);
      setAcknowledged(false);
    } catch (failure) {
      if (failure instanceof BackupPasswordRequired)
        setPasswordFile({ file, header: failure.header });
      else setError(backupErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  const cancelRestore = () => {
    if (!busy) {
      setPending(undefined);
      setPasswordFile(undefined);
      setRestorePassword("");
      setAcknowledged(false);
      setError("");
    }
  };
  const replace = async () => {
    if (!pending || !acknowledged || busy) return;
    setBusy(true);
    setError("");
    try {
      await restoreBackup(pending);
      setPending(undefined);
      setAcknowledged(false);
      navigate("/", { state: { backupRestored: true } });
    } catch (failure) {
      setError(backupErrorMessage(failure, "restore"));
    } finally {
      setBusy(false);
    }
  };
  const dates = pending?.transactions.map((row) => row.date).sort() ?? [];
  return (
    <section className="card backup-centre" id="backup">
      <h2>Backup and restore</h2>
      <p className="muted">
        A portable copy of your accounts, transactions and rules. Password
        protection happens on this device.
      </p>
      <p className="backup-status">
        <Archive size={16} aria-hidden="true" />
        {data?.last
          ? `Last backup: ${formatUkDate(data.last.slice(0, 10))} · ${data.exported ?? 0} transactions`
          : "No backup saved yet. Save your first backup."}
      </p>
      <div className="actions">
        <button className="primary" onClick={openSave} disabled={busy}>
          Save backup
        </button>
        <button
          onClick={() => {
            setError("");
            picker.current?.click();
          }}
          disabled={busy}
        >
          Restore
        </button>
      </div>
      <input
        ref={picker}
        className="visually-hidden"
        tabIndex={-1}
        type="file"
        accept=".feng,.json,application/json,application/vnd.feng.backup+json"
        aria-label="Choose Feng backup"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            setPending(undefined);
            setPasswordFile(undefined);
            void read(file);
          }
        }}
      />
      {saving && (
        <Sheet
          title="Save backup"
          onClose={closeSave}
          footer={
            <>
              <button type="button" onClick={closeSave} disabled={busy}>
                Cancel
              </button>
              <button
                className="primary"
                form={saveForm}
                type="submit"
                disabled={
                  busy || (protect && (password.length < 12 || !confirmation))
                }
              >
                {busy ? "Preparing…" : "Save backup"}
              </button>
            </>
          }
        >
          <form
            id={saveForm}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label className="switch-row">
              <span>Protect with a password (recommended)</span>
              <input
                type="checkbox"
                role="switch"
                checked={protect}
                disabled={busy}
                onChange={(event) => setProtect(event.target.checked)}
              />
            </label>
            {protect ? (
              <>
                <Password
                  label="Backup password"
                  value={password}
                  onChange={setPassword}
                  disabled={busy}
                />
                <p className="muted">
                  At least 12 characters. Keep this password safe; it cannot be
                  recovered.
                </p>
                <Password
                  label="Confirm backup password"
                  value={confirmation}
                  onChange={setConfirmation}
                  disabled={busy}
                  confirm
                />
              </>
            ) : (
              <p className="notice warning">
                This file will contain readable financial data. Store it
                privately.
              </p>
            )}
            <label className="switch-row">
              <span>Include attachments</span>
              <input
                type="checkbox"
                role="switch"
                checked={includeAttachments}
                disabled={busy}
                onChange={(event) =>
                  setIncludeAttachments(event.target.checked)
                }
              />
            </label>
            <p className="muted">
              {includeAttachments
                ? "Includes attached images and PDFs."
                : "Notes and financial records are included; attached files are omitted."}
            </p>
            {error && <p role="alert">{error}</p>}
          </form>
        </Sheet>
      )}
      {passwordFile && (
        <Sheet
          title="Unlock backup"
          onClose={cancelRestore}
          footer={
            <>
              <button type="button" onClick={cancelRestore} disabled={busy}>
                Cancel
              </button>
              <button
                className="primary"
                form={passwordForm}
                type="submit"
                disabled={busy || !restorePassword}
              >
                Unlock and preview
              </button>
            </>
          }
        >
          <p>
            Encrypted backup from{" "}
            {formatUkDate(passwordFile.header.createdAt.slice(0, 10))}. Your
            data stays unchanged until you confirm replacement.
          </p>
          <form
            id={passwordForm}
            onSubmit={(event) => {
              event.preventDefault();
              void read(passwordFile.file, restorePassword);
            }}
          >
            <Password
              label="Backup password"
              value={restorePassword}
              onChange={setRestorePassword}
              disabled={busy}
            />
            {error && <p role="alert">{error}</p>}
          </form>
        </Sheet>
      )}
      {pending && (
        <Sheet
          title="Restore backup"
          onClose={cancelRestore}
          footer={
            <>
              <button type="button" onClick={cancelRestore} disabled={busy}>
                Cancel restore
              </button>
              <button
                className="danger primary"
                type="button"
                disabled={busy || !acknowledged}
                onClick={() => void replace()}
              >
                Replace data with backup
              </button>
            </>
          }
        >
          <div className="restore-warning">
            <h3>Replace all local financial data?</h3>
            <dl className="settings-preview" aria-label="Backup contents">
              {[
                ["Accounts", pending.accounts.length],
                ["Transactions", pending.transactions.length],
                ["Statements", pending.statements.length],
                [
                  "Personal rules",
                  pending.rules.filter((rule) => !rule.builtIn).length,
                ],
              ].map(([label, count]) => (
                <div className="restore-count" key={label}>
                  <dt>{label}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
            <p className="muted">
              Saved{" "}
              <time className="date-value" dateTime={pending.exportedAt}>
                {formatUkDate(pending.exportedAt.slice(0, 10))}
              </time>
              {dates.length > 0 && (
                <>
                  <br />{" "}
                  <span className="date-value">
                    {formatDateRange(dates[0], dates.at(-1)!)}
                  </span>
                </>
              )}
            </p>
            {dates.some((date) => date > localToday()) && (
              <p className="notice warning">
                This backup contains future-dated transactions. They do not
                verify today's balances.
              </p>
            )}
            <details>
              <summary>Backup details</summary>
              <p>Backup version {pending.version}</p>
            </details>
            <p>
              Accounts, transactions, categories, rules and settings will be
              replaced. Save your current data first if you need to keep it.
            </p>
            <button type="button" disabled={busy} onClick={openSave}>
              Back up current data first
            </button>
            <label className="check">
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={busy}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              I understand that this replaces all existing data on this device.
            </label>
            {error && <p role="alert">{error}</p>}
          </div>
        </Sheet>
      )}
      {error && !saving && !passwordFile && !pending && (
        <p role="alert">{error}</p>
      )}
      {notice && <Toast message={notice} />}
    </section>
  );
}
