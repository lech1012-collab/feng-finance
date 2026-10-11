import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { db } from "../storage/database";
import { undoChange } from "../storage/audit";
import { formatUkDate } from "../domain/dates";
export function RecentChanges() {
  const entries = useLiveQuery(
    () => db.changeLog.orderBy("createdAt").reverse().limit(50).toArray(),
    [],
  );
  const [error, setError] = useState("");
  return (
    <details className="card settings-disclosure">
      <summary>Recent changes</summary>
      <p className="muted">
        Changes stay on this device for 90 days. Undo newer edits first when
        they affect the same record.
      </p>
      {entries?.map((entry) => (
        <div className="settings-row" key={entry.id}>
          <span>
            {entry.label}
            <small>
              {formatUkDate(entry.createdAt.slice(0, 10))} ·{" "}
              {entry.changes.length} record
              {entry.changes.length === 1 ? "" : "s"}
              {entry.undoneAt ? " · Undone" : ""}
            </small>
          </span>
          {!entry.undoneAt && (
            <button
              onClick={() =>
                void undoChange(entry.id).catch((e) =>
                  setError(e instanceof Error ? e.message : "Undo failed."),
                )
              }
            >
              Undo
            </button>
          )}
        </div>
      ))}
      {!entries?.length && <p>No recorded changes yet.</p>}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
