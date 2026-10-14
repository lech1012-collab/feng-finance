import { useState } from "react";
import type { Setting } from "../domain/models";
import {
  needsFirstBackupReminder,
  needsSeparateStorageWarning,
  type BetaPreferences,
  type RuntimeMode,
} from "./policy";

export function DataNotices({
  prefs,
  mode,
  hasRealImports,
  onBackup,
  onSave,
}: {
  prefs: BetaPreferences;
  mode: RuntimeMode;
  hasRealImports: boolean;
  onBackup: () => Promise<void>;
  onSave: (settings: Setting[]) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const separate = needsSeparateStorageWarning(prefs, mode, hasRealImports);
  const overdue = hasRealImports && needsFirstBackupReminder(prefs);
  if (!separate && !overdue) return null;
  const backup = async () => {
    setBusy(true);
    setError("");
    try {
      await onBackup();
    } catch {
      setError(
        "The backup could not be prepared. Your existing data is safe. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="notice warning beta-data-notice"
      aria-label="Save a backup"
    >
      <div>
        <p>
          {separate
            ? "Data in this Safari tab is separate from the installed app. Save a backup and restore it in the installed app."
            : "You imported your first statements a week ago. Save a backup in Files or iCloud Drive to protect your data."}
        </p>
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() => void backup()}
        >
          Save backup
        </button>
        {separate && (
          <button
            disabled={busy}
            onClick={() =>
              void onSave([
                { key: "separateStorageWarningSeen", value: "true" },
              ]).catch(() =>
                setError("Your choice could not be saved. Please try again."),
              )
            }
          >
            I understand
          </button>
        )}
      </div>
    </section>
  );
}
