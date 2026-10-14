import { Sheet, SheetFooter } from "./Sheet";
import { Toast } from "./Toast";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type FinanceDB } from "../storage/database";
import {
  expireSafetyBackup,
  previousDataPreview,
  restorePreviousData,
} from "../storage/safety-backup";
import { SECURITY_CHANGE_EVENT } from "../security/events";
import { formatUkDate } from "../domain/dates";
import "./import-settings.css";

export function SafetyRecovery({
  database = db,
  onRestored,
}: {
  database?: FinanceDB;
  onRestored?: () => void;
}) {
  const preview = useLiveQuery(() => previousDataPreview(database), [database]);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    void expireSafetyBackup(database).catch(() =>
      setError(
        "The expired safety copy could not be cleared. Free local storage and try again.",
      ),
    );
  }, [database]);
  if (!preview)
    return error ? (
      <section className="card safety-recovery">
        <h2>Previous data</h2>
        <p role="alert" className="notice warning">
          {error}
        </p>
      </section>
    ) : null;
  async function restore() {
    if (!preview || !confirmed || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await restorePreviousData(database, preview.capturedAt);
      setNotice(
        "Previous data restored. Reopening Feng with the earlier settings.",
      );
      window.dispatchEvent(new Event(SECURITY_CHANGE_EVENT));
      if (onRestored) onRestored();
      else window.location.reload();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Previous data could not be restored. Your current data was kept.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card safety-recovery" id="previous-data">
      <h2>Previous data</h2>
      <p>
        Feng saved your local data before the update to v
        {preview.targetAppVersion} on{" "}
        {formatUkDate(preview.capturedAt.slice(0, 10))}.
      </p>
      <p className="muted">
        Available until {formatUkDate(preview.expiresAt.slice(0, 10))}. This
        safety copy stays on this device and is separate from your downloadable
        backup.
      </p>
      {!confirming ? (
        <button
          onClick={() => {
            setConfirming(true);
            setConfirmed(false);
          }}
        >
          Restore previous data
        </button>
      ) : (
        <Sheet
          title="Restore previous data"
          onClose={() => {
            if (!busy) {
              setConfirming(false);
              setConfirmed(false);
              setError("");
            }
          }}
        >
          <fieldset className="safety-recovery-confirm">
            <legend>Replace current data with the earlier copy</legend>
            <p className="notice warning">
              This replaces all current accounts, transactions, settings and
              attachments with their state before the update. Changes made after
              that update will be lost. The earlier PIN and device unlock
              configuration also return. Export a backup first if you want to
              keep your current data.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I understand that my current data and lock settings will be
              replaced.
            </label>
            <SheetFooter>
              <button
                disabled={!confirmed || busy}
                onClick={() => void restore()}
              >
                {busy ? "Restoring previous data…" : "Restore previous data"}
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  setConfirmed(false);
                  setError("");
                }}
              >
                Cancel
              </button>
            </SheetFooter>
            {error && <p role="alert">{error}</p>}
          </fieldset>
        </Sheet>
      )}
      {notice && <Toast message={notice} />}
      {error && !confirming && (
        <p role="alert" className="notice warning">
          {error}
        </p>
      )}
    </section>
  );
}
