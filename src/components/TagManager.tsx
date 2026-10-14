import { Toast } from "./Toast";
import { useId, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/database";
import { mergeTags, saveTag, tagTransactions } from "../storage/tags";
import { undoChange } from "../storage/audit";
import { authorizeMonthEdit } from "../storage/month-review";
import type { Tag, Transaction } from "../domain/models";
import { ChevronRight } from "lucide-react";
import { Sheet } from "./Sheet";
import { ListRow, SectionCard } from "./UIPrimitives";
import "./v2-rules.css";
import "./transaction-polish.css";

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
          <label className="tag-option tag-chip-target" key={tag.id}>
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
            <span className="tag-chip-visual">
              <span
                className="tag-dot"
                style={{ backgroundColor: tag.colour }}
                aria-hidden="true"
              />
              <span>{tag.name}</span>
              {value.includes(tag.id) && (
                <span className="tag-chip-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </span>
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
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [colour, setColour] = useState("#A99BD6");
  const [mergeTarget, setMergeTarget] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [changeId, setChangeId] = useState("");
  const formId = useId();
  const close = () => {
    setFormOpen(false);
    setEditing(undefined);
    setName("");
    setMergeTarget("");
    setError("");
  };
  async function perform(
    operation: () => Promise<{ changeId: string }>,
    success: string,
  ) {
    setError("");
    setBusy(true);
    try {
      const result = await operation();
      if (!result.changeId) return false;
      setChangeId(result.changeId);
      setMessage(success);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tags could not be updated.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SectionCard
        id="tags"
        title="Tags"
        description="Group spending across categories, such as a holiday or home project."
        actions={
          <button
            type="button"
            onClick={() => {
              setEditing(undefined);
              setName("");
              setColour("#A99BD6");
              setMergeTarget("");
              setError("");
              setFormOpen(true);
            }}
          >
            Add tag
          </button>
        }
      >
        {tags.length ? (
          tags.map((tag) => (
            <ListRow
              key={tag.id}
              title={tag.name}
              icon={
                <span
                  className="tag-dot"
                  style={{ backgroundColor: tag.colour }}
                />
              }
              meta={tag.archived ? "Archived" : undefined}
              amount={<ChevronRight size={16} aria-hidden="true" />}
              onClick={() => {
                setEditing(tag);
                setName(tag.name);
                setColour(tag.colour);
                setMergeTarget("");
                setError("");
                setFormOpen(true);
              }}
            />
          ))
        ) : (
          <p className="muted">No tags yet. Add one for a trip or project.</p>
        )}
        {error && !formOpen && (
          <p role="alert" className="notice warning">
            {error}
          </p>
        )}
      </SectionCard>
      {formOpen && (
        <Sheet
          title={editing ? "Edit tag" : "Add tag"}
          onClose={close}
          footer={
            <button
              className="primary"
              type="submit"
              form={formId}
              disabled={busy}
            >
              {editing ? "Save tag" : "Create tag"}
            </button>
          }
        >
          <form
            id={formId}
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
                  close();
                }
              });
            }}
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
            <label className="tag-colour-control">
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
          </form>
          {editing && tags.length > 1 && (
            <details className="tag-merge-options">
              <summary>Merge tags</summary>
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
                type="button"
                disabled={!mergeTarget || busy}
                onClick={() =>
                  void perform(async () => {
                    const matches = await db.transactions
                      .filter((t) => (t.tags ?? []).includes(editing.id))
                      .toArray();
                    if (!(await authorizeMonthEdit(matches)))
                      return { changeId: "" };
                    return mergeTags(editing.id, mergeTarget);
                  }, "Tags merged. Transactions and rules updated.").then(
                    (saved) => {
                      if (saved) close();
                    },
                  )
                }
              >
                Merge tags
              </button>
            </details>
          )}
          {editing && (
            <div className="tag-management-actions">
              <button
                type="button"
                className={editing.archived ? undefined : "danger"}
                disabled={busy}
                onClick={() =>
                  void perform(
                    () => saveTag({ ...editing, archived: !editing.archived }),
                    editing.archived ? "Tag restored." : "Tag archived.",
                  ).then((saved) => {
                    if (saved) close();
                  })
                }
              >
                {editing.archived ? "Restore tag" : "Archive tag"}
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="notice warning">
              {error}
            </p>
          )}
        </Sheet>
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
    </>
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
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const label = `Tag ${transactionIds.length} transaction${transactionIds.length === 1 ? "" : "s"}`;
  return (
    <>
      <SectionCard title={`${transactionIds.length} selected`}>
        <button
          type="button"
          disabled={!transactionIds.length}
          onClick={() => {
            setError("");
            setOpen(true);
          }}
        >
          {label}
        </button>
      </SectionCard>
      {open && (
        <Sheet
          title="Tag selected transactions"
          onClose={() => setOpen(false)}
          footer={
            <button
              type="button"
              className="primary"
              disabled={busy || !tags.length || !transactionIds.length}
              onClick={async () => {
                setError("");
                setBusy(true);
                try {
                  const rows = (
                    await db.transactions.bulkGet(transactionIds)
                  ).filter((t): t is Transaction => !!t);
                  if (!(await authorizeMonthEdit(rows))) return;
                  const change = await tagTransactions(transactionIds, tags);
                  setChangeId(change.changeId);
                  setMessage(
                    `${change.result} transaction${change.result === 1 ? "" : "s"} tagged.`,
                  );
                  setOpen(false);
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Tags could not be added.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {label}
            </button>
          }
        >
          <TagPicker value={tags} onChange={setTags} />
          {error && (
            <p role="alert" className="notice warning">
              {error}
            </p>
          )}
        </Sheet>
      )}
      {message && (
        <Toast
          id={changeId || message}
          message={message}
          undo={
            changeId
              ? async () => {
                  await undoChange(changeId);
                  setMessage("");
                  setChangeId("");
                }
              : undefined
          }
        />
      )}
    </>
  );
}
