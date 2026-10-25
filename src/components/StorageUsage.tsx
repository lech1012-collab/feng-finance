import { Toast } from "./Toast";
import { ContextHelp } from "./ContextHelp";
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
      <div className="context-help-heading">
        <h2>Device storage</h2>
        <ContextHelp
          title="Device storage"
          tone={usage?.nearlyFull || persistent === false ? "warning" : "help"}
        >
          <p>
            Storage protection reduces the chance that your browser clears Feng
            when storage runs low. Install Feng and request protection where
            your browser supports it.
          </p>
          <p>
            Keep a backup in case this device is lost or browser data is
            cleared.
          </p>
          {usage?.nearlyFull && (
            <p>
              Export a backup and remove large attachments to avoid failed
              imports.
            </p>
          )}
        </ContextHelp>
      </div>
      {usage ? (
        <>
          <p>
            {usage.attachmentBytes === 0
              ? "No attachments"
              : `Attachments: ${formatStorageBytes(usage.attachmentBytes)}`}
          </p>
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
              Storage is more than 80% full.{" "}
              <a href="#/settings?section=backup&save=1">Save a backup</a>
            </p>
          )}
        </>
      ) : (
        <p>Checking storage…</p>
      )}
      <p className="muted">
        {persistent
          ? "Storage: protected."
          : "Storage: not protected. Your browser may clear local data."}
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
                  ? "Protected. Keep a backup in case this device is lost."
                  : "Your browser declined storage protection. Keep your backups safe.",
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
      {notice && <Toast message={notice} />}
    </section>
  );
}
