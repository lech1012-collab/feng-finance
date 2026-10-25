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
import { ContextHelp } from "./ContextHelp";
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
    <section className="card" id="import-diagnostics">
      <div className="context-help-heading">
        <h2>Import diagnostics</h2>
        <ContextHelp title="Import diagnostics">
          <p>
            Optional troubleshooting data is excluded from downloadable backups
            and Undo history. Exported diagnostics remove extracted text and
            financial values.
          </p>
          <p>
            A migration safety copy may still contain earlier diagnostics until
            its 14-day expiry.
          </p>
        </ContextHelp>
      </div>
      <p className="muted">
        Keeps statement text and figures from the last five imports on this
        device.
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
        Turning this off deletes the retained diagnostics.
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
    </section>
  );
}
