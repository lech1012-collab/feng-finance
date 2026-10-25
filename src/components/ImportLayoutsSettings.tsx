import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type FinanceDB } from "../storage/database";
import {
  renameLayoutTemplate,
  deleteLayoutTemplate,
} from "../storage/layout-templates";
import { undoChange } from "../storage/audit";
import { formatUkDate } from "../domain/dates";
import { ContextHelp } from "./ContextHelp";
import "./import-settings.css";

export function ImportLayoutsSettings({
  database = db,
}: {
  database?: FinanceDB;
}) {
  const templates = useLiveQuery(
    () => database.layoutTemplates.orderBy("lastUsedAt").reverse().toArray(),
    [database],
  );
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [changeId, setChangeId] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(
    operation: () => Promise<{ changeId: string }>,
    message: string,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await operation();
      setChangeId(result.changeId);
      setNotice(message);
      setEditing(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The import layout could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card" id="import-layouts">
      <div className="context-help-heading">
        <h2>Import layouts</h2>
        <ContextHelp title="Import layouts">
          <p>
            Saved column mappings help recognise a statement layout. Every
            import is checked again against the statement balances or totals.
          </p>
        </ContextHelp>
      </div>
      {templates?.map((template) => (
        <div key={template.id} className="import-layout-setting">
          {editing === template.id ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  () => renameLayoutTemplate(template.id, name, database),
                  "Import layout renamed.",
                );
              }}
            >
              <label>
                Layout name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={200}
                  autoFocus
                  disabled={busy}
                />
              </label>
              <div className="import-settings-actions">
                <button disabled={busy || !name.trim()}>Save name</button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(undefined)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <div>
                <strong>{template.name}</strong>
                <small>
                  {template.institution ?? "Other"} · Last used{" "}
                  {formatUkDate(template.lastUsedAt.slice(0, 10))}
                </small>
                {template.status === "check_needed" && (
                  <span className="small-chip warning">
                    Check columns on next import
                  </span>
                )}
              </div>
              <div className="import-settings-actions">
                <button
                  disabled={busy}
                  aria-label={`Rename ${template.name} import layout`}
                  onClick={() => {
                    setEditing(template.id);
                    setName(template.name);
                  }}
                >
                  Rename
                </button>
                <button
                  disabled={busy}
                  aria-label={`Delete ${template.name} import layout`}
                  onClick={() =>
                    void run(
                      () => deleteLayoutTemplate(template.id, database),
                      "Import layout deleted.",
                    )
                  }
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      ))}
      {templates && !templates.length && (
        <p>
          No saved layouts yet. Save a layout when mapping statement columns
          during import.
        </p>
      )}
      {notice && (
        <div role="status">
          {notice}{" "}
          {changeId && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await undoChange(changeId, database);
                  return { changeId: "" };
                }, "Import layout change undone.")
              }
            >
              Undo
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="notice warning">
          {error}
        </p>
      )}
    </section>
  );
}
