import { Toast } from "./Toast";
import { useId, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/database";
import { mergeTags, saveTag, tagTransactions } from "../storage/tags";
import { undoChange } from "../storage/audit";
import { authorizeMonthEdit } from "../storage/month-review";
import type { Tag, Transaction } from "../domain/models";
import "./v2-rules.css";

export function TagPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const tags = useLiveQuery(
    () => db.tags.filter((t) => !t.archived).toArray(),
    [],
    [],
  );
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const filtered = tags.filter((tag) =>
    tag.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const exists = tags.some(
    (tag) => tag.name.toLocaleLowerCase() === search.trim().toLocaleLowerCase(),
  );
  return (
    <fieldset className="tag-picker">
      <legend>Tags</legend>
      <div className="tag-search-row">
        <label className="sr-only" htmlFor={searchId}>
          Find or create a tag
        </label>
        <input
          id={searchId}
          type="search"
          placeholder="Find or create a tag"
          value={search}
          maxLength={100}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
        />
        {search.trim() && !exists && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const created = await saveTag({
                  name: search.trim(),
                  colour: "#A99BD6",
                  archived: false,
                });
                onChange([...new Set([...value, created.result.id])]);
                setSearch("");
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "This tag could not be created.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Create {search.trim()}
          </button>
        )}
      </div>
      {filtered.length ? (
        filtered.map((tag) => (
          <label className="tag-option" key={tag.id}>
            <input
              type="checkbox"
              checked={value.includes(tag.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, tag.id]
                    : value.filter((t) => t !== tag.id),
                )
              }
            />
            <span className="tag-dot" style={{ backgroundColor: tag.colour }} />
            {tag.name}
          </label>
        ))
      ) : (
        <p className="muted">
          {search
            ? "No matching tags. Create one here."
            : "Name a trip or project to create your first tag."}
        </p>
      )}
      {error && (
        <p role="alert" className="notice warning">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function TagManager() {
  const tags = useLiveQuery(() => db.tags.toArray(), [], []);
  const [editing, setEditing] = useState<Tag>();
  const [name, setName] = useState("");
  const [colour, setColour] = useState("#A99BD6");
  const [mergeTarget, setMergeTarget] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [changeId, setChangeId] = useState("");
  async function perform(
    operation: () => Promise<{ changeId: string }>,
    success: string,
  ) {
    setError("");
    try {
      const result = await operation();
      setChangeId(result.changeId);
      setMessage(success);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tags could not be updated.");
      return false;
    }
  }
  return (
    <section className="card" id="tags">
      <h2>Tags</h2>
      <p className="muted">
        Group spending across categories, such as a holiday or home project.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void perform(
            () =>
              saveTag({
                id: editing?.id,
                name,
                colour,
                archived: editing?.archived ?? false,
              }),
            "Tag saved.",
          ).then((saved) => {
            if (saved) {
              setEditing(undefined);
              setName("");
            }
          });
        }}
        className="v2-inline-form"
      >
        <label>
          Tag name
          <input
            value={name}
            maxLength={100}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Colour
          <span className="colour-presets">
            {[
              "#6EA8FF",
              "#A99BD6",
              "#F08A7E",
              "#E7C46A",
              "#A6B3C6",
              "#D994B8",
              "#8A9EC5",
              "#CC9C79",
            ].map((c) => (
              <button
                aria-label={`Tag colour ${c}`}
                aria-pressed={colour === c}
                type="button"
                key={c}
                style={{ background: c }}
                onClick={() => setColour(c)}
              >
                {colour === c ? "✓" : ""}
              </button>
            ))}
          </span>
        </label>
        <button className="primary" type="submit">
          {editing ? "Save tag" : "Create tag"}
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(undefined);
              setName("");
            }}
          >
            Cancel
          </button>
        )}
      </form>
      {tags.map((tag) => (
        <div className="settings-row" key={tag.id}>
          <span>
            <span className="tag-dot" style={{ backgroundColor: tag.colour }} />
            {tag.name}
            {tag.archived ? " (archived)" : ""}
          </span>
          <div className="v2-row-actions">
            <button
              onClick={() => {
                setEditing(tag);
                setName(tag.name);
                setColour(tag.colour);
              }}
            >
              Edit
            </button>
            <button
              onClick={() =>
                void perform(
                  () => saveTag({ ...tag, archived: !tag.archived }),
                  tag.archived ? "Tag restored." : "Tag archived.",
                )
              }
            >
              {tag.archived ? "Restore" : "Archive"}
            </button>
          </div>
        </div>
      ))}
      {editing && tags.length > 1 && (
        <div className="v2-inline-form">
          <label>
            Merge {editing.name} into
            <select
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
            >
              <option value="">Choose another tag</option>
              {tags
                .filter((t) => t.id !== editing.id && !t.archived)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            disabled={!mergeTarget}
            onClick={() =>
              void perform(async () => {
                const matches = await db.transactions
                  .filter((t) => (t.tags ?? []).includes(editing.id))
                  .toArray();
                if (!(await authorizeMonthEdit(matches)))
                  return { changeId: "" };
                return mergeTags(editing.id, mergeTarget);
              }, "Tags merged. Transactions and rules updated.")
            }
          >
            Merge tags
          </button>
        </div>
      )}
      {message && (
        <Toast
          id={changeId || message}
          message={message}
          undo={
            changeId
              ? async () => {
                  await undoChange(changeId);
                  setChangeId("");
                  setMessage("");
                }
              : undefined
          }
        />
      )}
      {error && (
        <p role="alert" className="notice warning">
          {error}
        </p>
      )}
    </section>
  );
}

export function BulkTagPicker({
  transactionIds,
}: {
  transactionIds: string[];
}) {
  const [tags, setTags] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [changeId, setChangeId] = useState("");
  return (
    <div className="card">
      <TagPicker value={tags} onChange={setTags} />
      <button
        disabled={!tags.length || !transactionIds.length}
        onClick={async () => {
          try {
            const rows = (await db.transactions.bulkGet(transactionIds)).filter(
              (t): t is Transaction => !!t,
            );
            if (!(await authorizeMonthEdit(rows))) return;
            const change = await tagTransactions(transactionIds, tags);
            setChangeId(change.changeId);
            setMessage(
              `${change.result} transaction${change.result === 1 ? "" : "s"} tagged.`,
            );
          } catch (e) {
            setMessage(
              e instanceof Error ? e.message : "Tags could not be added.",
            );
          }
        }}
      >
        Tag {transactionIds.length} transaction
        {transactionIds.length === 1 ? "" : "s"}
      </button>
      {message && (
        <p role="status">
          {message}{" "}
          {changeId && (
            <button
              onClick={async () => {
                await undoChange(changeId);
                setMessage("Tagging undone.");
                setChangeId("");
              }}
            >
              Undo
            </button>
          )}
        </p>
      )}
    </div>
  );
}
