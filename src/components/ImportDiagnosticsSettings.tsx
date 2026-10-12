import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { APP_VERSION } from "../domain/models";
import { db, type FinanceDB } from "../storage/database";
import {
  importDiagnosticsEnabled,
  setImportDiagnosticsEnabled,
  clearImportDiagnostics,
} from "../storage/import-diagnostics";
import { redactedDiagnosticsText } from "../beta/diagnostics-redaction";
import { download } from "../storage/backup";
import "./import-settings.css";

export function ImportDiagnosticsSettings({
  database = db,
}: {
  database?: FinanceDB;
}) {
  const data = useLiveQuery(
    async () => ({
      enabled: await importDiagnosticsEnabled(database),
      entries: await database.importDiagnostics.orderBy("createdAt").toArray(),
    }),
    [database],
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function run(operation: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      setNotice(message);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Import diagnostics could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="card settings-disclosure" id="import-diagnostics">
      <summary>Import diagnostics</summary>
      <p className="muted">
        Optional troubleshooting data for the last five imports. It contains
        statement text and figures, stays on this device and is excluded from
        downloadable backups and Undo history.
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={data?.enabled ?? false}
          disabled={!data || busy}
          onChange={(event) => {
            const enabled = event.target.checked;
            void run(
              () => setImportDiagnosticsEnabled(enabled, database),
              enabled
                ? "Local import diagnostics enabled."
                : "Local import diagnostics disabled and cleared.",
            );
          }}
        />
        Keep local import diagnostics
      </label>
      <p className="muted">
        Turning this off deletes the retained diagnostics. A migration safety
        copy may still contain their earlier state until its 14-day expiry.
      </p>
      {data?.enabled && <p>{data.entries.length} of 5 imports retained.</p>}
      {!!data?.entries.length && (
        <div className="import-settings-actions">
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const entries = await database.importDiagnostics
                  .orderBy("createdAt")
                  .toArray();
                download(
                  redactedDiagnosticsText(entries, APP_VERSION),
                  "application/json",
                  `feng-redacted-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
                );
              }, "Redacted diagnostics prepared. All extracted text and financial values have been removed.")
            }
          >
            Export redacted diagnostics
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(
                () => clearImportDiagnostics(database),
                "Local import diagnostics cleared.",
              )
            }
          >
            Clear diagnostics
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="notice warning">
          {error}
        </p>
      )}
    </details>
  );
}
