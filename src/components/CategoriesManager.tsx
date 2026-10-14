import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/database";
import { auditedMutation, undoChange } from "../storage/audit";
import type { Category } from "../domain/models";
import { id } from "../domain/normalize";
import { Sheet, SheetFooter } from "./Sheet";
import { Toast } from "./Toast";

export function CategoriesManager() {
  const data = useLiveQuery(async () => {
    const categories = await db.categories.toArray();
    const counts = new Map<string, number>();
    await db.transactions.each((t) => {
      if (t.categoryId)
        counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
    });
    return { categories, counts };
  });
  const [editing, setEditing] = useState<Category | "new">();
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [kind, setKind] = useState<Category["kind"]>("expense");
  const [colour, setColour] = useState("#6EA8FF");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{
    changeId: string;
    message: string;
  }>();
  const open = (category?: Category) => {
    setEditing(category ?? "new");
    setName(category?.name ?? "");
    setParent(category?.parentId ?? "");
    setKind(category?.kind ?? "expense");
    setColour(category?.color ?? "#6EA8FF");
    setError("");
  };
  const save = async () => {
    if (!editing || !data || busy) return;
    setBusy(true);
    setError("");
    try {
      if (!name.trim()) throw new Error("Enter a category name.");
      if (
        data.categories.some(
          (c) =>
            c.id !== (editing === "new" ? "" : editing.id) &&
            !c.archived &&
            c.parentId === (parent || undefined) &&
            c.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
        )
      )
        throw new Error("This category name already exists.");
      if (editing !== "new" && parent !== (editing.parentId ?? ""))
        throw new Error(
          "Choose a parent when adding a category. Existing category relationships are preserved.",
        );
      const result = await auditedMutation(
        "Save category",
        ["categories"],
        async () => {
          if (editing === "new")
            await db.categories.add({
              id: id(),
              name: name.trim(),
              parentId: parent || undefined,
              kind: parent
                ? data.categories.find((c) => c.id === parent)!.kind
                : kind,
              color: colour,
              archived: false,
            });
          else
            await db.categories.update(editing.id, {
              name: name.trim(),
              color: colour,
            });
        },
      );
      setReceipt({ changeId: result.changeId, message: "Category saved." });
      setEditing(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Category could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  const archive = async (category: Category) => {
    setBusy(true);
    setError("");
    try {
      const result = await auditedMutation(
        "Archive category",
        ["categories"],
        () =>
          db.categories.update(category.id, { archived: !category.archived }),
      );
      setReceipt({
        changeId: result.changeId,
        message: category.archived
          ? "Category restored."
          : "Category archived. Historical transactions are preserved.",
      });
      setEditing(undefined);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Category could not be archived.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <div className="section-heading">
        <h2>Categories</h2>
        <button onClick={() => open()}>Add category</button>
      </div>
      <div className="settings-object-list">
        {data?.categories
          .filter((c) => !c.parentId)
          .flatMap((parent) => [
            parent,
            ...data.categories.filter((c) => c.parentId === parent.id),
          ])
          .map((c) => (
            <button
              className="settings-object-row"
              key={c.id}
              onClick={() => open(c)}
            >
              <span>
                <strong>
                  <span
                    className="category-colour-dot"
                    style={{ background: c.color ?? "var(--muted)" }}
                    aria-hidden="true"
                  />
                  {c.parentId
                    ? `${data?.categories.find((p) => p.id === c.parentId)?.name} · `
                    : ""}
                  {c.name}
                </strong>
                <small>
                  {data?.counts.get(c.id) ?? 0} transactions
                  {c.archived ? " · Archived" : ""}
                </small>
              </span>
              <span aria-hidden="true">›</span>
            </button>
          ))}
      </div>
      {editing && (
        <Sheet
          title={editing === "new" ? "Add category" : "Edit category"}
          onClose={() => {
            if (!busy) setEditing(undefined);
          }}
        >
          <form
            id="category-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label>
              Name
              <input
                autoFocus
                required
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {editing === "new" && (
              <>
                <label>
                  Parent
                  <select
                    value={parent}
                    onChange={(e) => setParent(e.target.value)}
                  >
                    <option value="">Main category</option>
                    {data?.categories
                      .filter(
                        (c) => !c.parentId && !c.archived && c.kind === kind,
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
                {editing === "new" && !parent && (
                  <label>
                    Kind
                    <select
                      value={kind}
                      onChange={(e) =>
                        setKind(e.target.value as Category["kind"])
                      }
                    >
                      <option value="expense">Expense</option>
                      <option value="income">Income</option>
                    </select>
                  </label>
                )}
              </>
            )}
            <fieldset>
              <legend>Colour</legend>
              <div className="colour-presets">
                {[
                  "#6EA8FF",
                  "#A99BD6",
                  "#F08A7E",
                  "#E7C46A",
                  "#A6B3C6",
                  "#D994B8",
                ].map((c) => (
                  <button
                    type="button"
                    aria-label={`Colour ${c}`}
                    aria-pressed={colour === c}
                    style={{ background: c }}
                    key={c}
                    onClick={() => setColour(c)}
                  >
                    {colour === c ? "✓" : ""}
                  </button>
                ))}
              </div>
            </fieldset>
            {error && (
              <p role="alert" className="notice warning">
                {error}
              </p>
            )}
            {editing !== "new" && (
              <p className="muted">
                Renaming preserves the category's history and financial role.
              </p>
            )}
            <SheetFooter>
              <button
                className="primary"
                form="category-form"
                type="submit"
                disabled={busy || !name.trim()}
              >
                Save category
              </button>
              {editing !== "new" && (
                <button
                  disabled={busy}
                  type="button"
                  onClick={() => void archive(editing)}
                >
                  {editing.archived ? "Restore category" : "Archive category"}
                </button>
              )}
            </SheetFooter>
          </form>
        </Sheet>
      )}
      {!editing && error && <p role="alert">{error}</p>}
      {receipt && (
        <Toast
          id={receipt.changeId}
          message={receipt.message}
          undo={async () => {
            await undoChange(receipt.changeId);
            setReceipt(undefined);
          }}
        />
      )}
    </section>
  );
}
