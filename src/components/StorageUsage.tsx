import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  formatStorageBytes,
  requestPersistentStorage,
  storageUsage,
} from "../storage/attachments";
import "../security/security.css";
export function StorageUsage() {
  const [revision, setRevision] = useState(0);
  const usage = useLiveQuery(() => storageUsage(), [revision]);
  const [persistent, setPersistent] = useState<boolean>(),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    void navigator.storage
      ?.persisted?.()
      .then(setPersistent)
      .catch(() => setPersistent(false));
  }, []);
  useEffect(() => {
    // Keep quota estimates refreshed after local attachment writes.
    const changed = () => setRevision((current) => current + 1);
    window.addEventListener("focus", changed);
    return () => window.removeEventListener("focus", changed);
  }, []);
  return (
    <section className="card" id="storage">
      <h2>Device storage</h2>
      {usage ? (
        <>
          <p>Attachments: {formatStorageBytes(usage.attachmentBytes)}</p>
          {usage.usedBytes !== undefined && usage.quotaBytes !== undefined && (
            <>
              <p>
                Feng uses {formatStorageBytes(usage.usedBytes)} of{" "}
                {formatStorageBytes(usage.quotaBytes)} available browser
                storage.
              </p>
              <meter
                className="storage-meter"
                value={usage.usedBytes}
                min={0}
                max={usage.quotaBytes}
                high={usage.quotaBytes * 0.8}
                aria-label="Browser storage used"
              />
            </>
          )}
          {usage.nearlyFull && (
            <p className="notice warning" role="alert">
              Storage is more than 80% full. Export a backup and remove large
              attachments to avoid failed imports.
            </p>
          )}
        </>
      ) : (
        <p>Checking storage…</p>
      )}
      <p className="muted">
        {persistent
          ? "Persistent storage is enabled. Keep a backup in case this device is lost or browser data is cleared."
          : "Your browser may clear local data when storage runs low. Request persistent storage and keep regular backups."}
      </p>
      {!persistent && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const granted = await requestPersistentStorage();
              setPersistent(granted);
              setNotice(
                granted
                  ? "Persistent storage enabled."
                  : "Your browser did not grant persistent storage. Keep your backups safe.",
              );
            } catch {
              setNotice(
                "Persistent storage is unavailable in this browser. Keep your backups safe.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Protect local storage
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
