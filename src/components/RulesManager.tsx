import {
  displayMerchant,
  displayDate,
  displayCategory,
} from "../domain/presentation";
import { displayRuleMatch } from "../domain/rule-presentation";
import { ListRow, StatusChip } from "./UIPrimitives";
import { Sheet, SheetFooter } from "./Sheet";
import { Toast } from "./Toast";
import { formatUkDate } from "../domain/dates";
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Rule, RuleAction, RuleCondition } from "../domain/models";
import { db } from "../storage/database";
import {
  exportRules,
  importRules,
  previewRule,
  saveRuleWithExisting,
  deleteRule,
} from "../storage/rules";
import { auditedMutation, undoChange } from "../storage/audit";
import { authorizeMonthEdit } from "../storage/month-review";
import { id } from "../domain/normalize";
import { money } from "../domain/money";
import { ConditionEditor } from "./ConditionEditor";
import { TagPicker } from "./TagManager";
import "./v2-rules.css";

function legacyConditions(rule: Rule): RuleCondition[] {
  if (rule.conditions) return rule.conditions;
  const conditions: RuleCondition[] = [
    {
      field: rule.match === "exact" ? "merchant" : "description",
      operator: rule.match === "exact" ? "equals" : rule.match,
      value: rule.pattern,
    },
  ];
  if (rule.accountId)
    conditions.push({
      field: "accountId",
      operator: "equals",
      value: rule.accountId,
    });
  if (rule.direction !== "any")
    conditions.push({
      field: "direction",
      operator: "equals",
      value: rule.direction,
    });
  if (rule.minAmount !== undefined)
    conditions.push({
      field: "amount",
      operator: "gte",
      value: rule.minAmount,
    });
  if (rule.maxAmount !== undefined)
    conditions.push({
      field: "amount",
      operator: "lte",
      value: rule.maxAmount,
    });
  return conditions;
}
function RuleEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: Rule;
  onClose: () => void;
  onSaved: (message: string, changeId: string) => void;
}) {
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], []);
  const categories = useLiveQuery(
    () => db.categories.filter((c) => !c.archived && !c.parentId).toArray(),
    [],
    [],
  );
  const series = useLiveQuery(() => db.recurringSeries.toArray(), [], []);
  const tags = useLiveQuery(() => db.tags.toArray(), [], []);
  const [rule, setRule] = useState<Rule>({
    ...initial,
    conditions: legacyConditions(initial),
    actions:
      initial.actions ??
      (initial.type === "transfer"
        ? [{ type: "kind", kind: "transfer" }]
        : [{ type: "category", categoryId: initial.categoryId }]),
  });
  const [applyExisting, setApplyExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preview = useLiveQuery(
    () => previewRule(rule),
    [JSON.stringify(rule)],
    [],
  );

  const updateAction = (index: number, patch: Partial<RuleAction>) =>
    setRule({
      ...rule,
      actions: rule.actions?.map((a, i) =>
        i === index ? { ...a, ...patch } : a,
      ),
    });
  const currency =
    accounts.find((a) => a.id === initial.accountId)?.currency ?? "GBP";
  return (
    <Sheet
      title={initial.id.startsWith("new-") ? "Create rule" : "Edit rule"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        id="rule-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            if (applyExisting && !(await authorizeMonthEdit(preview))) return;
            const expected = initial.id.startsWith("new-")
              ? undefined
              : initial;
            const saved = await saveRuleWithExisting(
              {
                ...rule,
                id: initial.id.startsWith("new-") ? id() : rule.id,
                createdFrom: "user",
              },
              expected,
              applyExisting,
            );
            onSaved(
              `${saved.result.count} existing transaction${saved.result.count === 1 ? "" : "s"} updated. Rule saved.`,
              saved.changeId,
            );
            onClose();
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "The rule could not be saved.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Rule name
          <input
            required
            maxLength={150}
            value={rule.name}
            onChange={(e) => setRule({ ...rule, name: e.target.value })}
          />
        </label>
        <div className="v2-inline-form">
          <label>
            Match
            <select
              value={rule.conditionMatch ?? "all"}
              onChange={(e) =>
                setRule({
                  ...rule,
                  conditionMatch: e.target.value as "all" | "any",
                })
              }
            >
              <option value="all">All conditions</option>
              <option value="any">Any condition</option>
            </select>
          </label>
        </div>
        <ConditionEditor
          conditions={rule.conditions ?? []}
          onChange={(conditions) => setRule({ ...rule, conditions })}
          accounts={accounts}
          categories={categories}
          tags={tags}
          currency={currency}
        />
        <h3>Then</h3>
        <div className="rule-actions">
          {rule.actions?.map((a, index) => (
            <fieldset key={index} className="rule-action">
              <legend className="sr-only">Action {index + 1}</legend>
              <label>
                Action
                <select
                  value={a.type}
                  onChange={(e) =>
                    updateAction(index, {
                      type: e.target.value as RuleAction["type"],
                    })
                  }
                >
                  {[
                    ["category", "Set category"],
                    ["rename", "Set display name"],
                    ["tag", "Add tags"],
                    ["kind", "Set transaction kind"],
                    ["split", "Split by percentage"],
                    ["reviewed", "Mark reviewed"],
                    ["recurring", "Link recurring series"],
                  ].map(([v, name]) => (
                    <option key={v} value={v}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              {a.type === "category" && (
                <label>
                  Category
                  <select
                    required
                    value={a.categoryId ?? ""}
                    onChange={(e) =>
                      updateAction(index, { categoryId: e.target.value })
                    }
                  >
                    <option value="">Choose</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {displayCategory(c, categories)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {a.type === "rename" && (
                <label>
                  Display name
                  <input
                    required
                    maxLength={200}
                    value={a.merchant ?? ""}
                    onChange={(e) =>
                      updateAction(index, { merchant: e.target.value })
                    }
                  />
                </label>
              )}
              {a.type === "tag" && (
                <TagPicker
                  value={a.tagIds ?? []}
                  onChange={(tagIds) => updateAction(index, { tagIds })}
                />
              )}
              {a.type === "kind" && (
                <label>
                  Kind
                  <select
                    value={a.kind ?? "normal"}
                    onChange={(e) =>
                      updateAction(index, {
                        kind: e.target.value as RuleAction["kind"],
                      })
                    }
                  >
                    {["normal", "transfer", "card_repayment", "refund"].map(
                      (v) => (
                        <option key={v} value={v}>
                          {v.replaceAll("_", " ")}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              )}
              {a.type === "reviewed" && (
                <label className="v2-check">
                  <input
                    type="checkbox"
                    checked={a.reviewed ?? true}
                    onChange={(e) =>
                      updateAction(index, { reviewed: e.target.checked })
                    }
                  />
                  Reviewed after import
                </label>
              )}
              {a.type === "recurring" && (
                <label>
                  Series
                  <select
                    required
                    value={a.recurringSeriesId ?? ""}
                    onChange={(e) =>
                      updateAction(index, { recurringSeriesId: e.target.value })
                    }
                  >
                    <option value="">Choose</option>
                    {series.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {a.type === "split" && (
                <div>
                  {(a.splits ?? []).map((split, i) => (
                    <div className="v2-inline-form" key={i}>
                      <label>
                        Category
                        <select
                          value={split.categoryId}
                          onChange={(e) =>
                            updateAction(index, {
                              splits: a.splits?.map((s, j) =>
                                j === i
                                  ? { ...s, categoryId: e.target.value }
                                  : s,
                              ),
                            })
                          }
                        >
                          <option value="">Choose</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Share %
                        <input
                          type="number"
                          min="0.01"
                          max="100"
                          step="0.01"
                          value={split.percentage}
                          onChange={(e) =>
                            updateAction(index, {
                              splits: a.splits?.map((s, j) =>
                                j === i
                                  ? { ...s, percentage: Number(e.target.value) }
                                  : s,
                              ),
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          updateAction(index, {
                            splits: a.splits?.filter((_, j) => i !== j),
                          })
                        }
                      >
                        Remove line
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      updateAction(index, {
                        splits: [
                          ...(a.splits ?? []),
                          { categoryId: "", percentage: 0 },
                        ],
                      })
                    }
                  >
                    Add split line
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() =>
                  setRule({
                    ...rule,
                    actions: rule.actions?.filter((_, i) => i !== index),
                  })
                }
              >
                Remove action
              </button>
            </fieldset>
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            setRule({
              ...rule,
              actions: [
                ...(rule.actions ?? []),
                { type: "category", categoryId: "" },
              ],
            })
          }
        >
          Add action
        </button>
        <label className="v2-check">
          <input
            type="checkbox"
            checked={rule.stopProcessing ?? true}
            onChange={(e) =>
              setRule({ ...rule, stopProcessing: e.target.checked })
            }
          />
          Don't apply other rules after this one
        </label>
        <label className="v2-check">
          <input
            type="checkbox"
            checked={rule.singleUse ?? false}
            onChange={(e) => setRule({ ...rule, singleUse: e.target.checked })}
          />
          Use once, then delete
        </label>
        <section aria-live="polite">
          <h3>
            Matches {preview.length} existing transaction
            {preview.length === 1 ? "" : "s"}
          </h3>
          <ul
            className="rule-preview-list"
            tabIndex={0}
            aria-label="Matching transactions"
          >
            {preview.slice(0, 30).map((t) => (
              <li key={t.id}>
                <ListRow
                  title={displayMerchant(t)}
                  meta={
                    <time className="date-value" dateTime={t.date}>
                      {displayDate(t.date)}
                    </time>
                  }
                  amount={
                    <span className="amount">
                      {money(t.amount, t.currency)}
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
          {preview.length > 30 && (
            <p className="muted">Showing the first 30 matches.</p>
          )}
          <label className="v2-check">
            <input
              type="checkbox"
              checked={applyExisting}
              onChange={(e) => setApplyExisting(e.target.checked)}
            />
            Apply to existing transactions
          </label>
          {rule.singleUse && preview.length > 1 && (
            <p className="muted">
              A single-use rule changes only the earliest match.
            </p>
          )}
        </section>
        {error && (
          <p role="alert" className="notice warning">
            {error}
          </p>
        )}
        <SheetFooter>
          <button
            className="primary"
            form="rule-form"
            type="submit"
            disabled={busy}
          >
            {busy ? "Saving…" : "Save rule"}
          </button>
        </SheetFooter>
      </form>
    </Sheet>
  );
}

const isAuto = (rule: Rule) => !!rule.auto || rule.createdFrom === "auto";
const ruleOrder = (a: Rule, b: Rule) =>
  Number(isAuto(a)) - Number(isAuto(b)) || b.priority - a.priority;
export function RulesManager({
  initialRuleId,
}: { initialRuleId?: string } = {}) {
  const rules = useLiveQuery(
    () => db.rules.filter((r) => !r.builtIn).toArray(),
    [],
    [],
  );
  const categories = useLiveQuery(() => db.categories.toArray(), [], []);
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], []);
  const [editing, setEditing] = useState<Rule>();
  const [dragged, setDragged] = useState<string>();
  const initialOpened = useRef("");
  useEffect(() => {
    if (initialRuleId && initialOpened.current !== initialRuleId) {
      const rule = rules.find((r) => r.id === initialRuleId);
      if (rule) {
        setEditing(rule);
        initialOpened.current = initialRuleId;
      }
    }
  }, [initialRuleId, rules]);
  const reorder = async (moving: string, destination: string, offset = 0) => {
    const ordered = [...rules].sort(ruleOrder);
    const current = ordered.findIndex((r) => r.id === moving),
      target = ordered.findIndex((r) => r.id === destination);
    if (
      current >= 0 &&
      target >= 0 &&
      isAuto(ordered[current]) !== isAuto(ordered[target])
    ) {
      setError(
        "Explicit rules run before remembered defaults. Reorder rules within their group.",
      );
      return;
    }
    if (current < 0 || target < 0 || (current === target && !offset)) return;
    const next = [...ordered];
    const [rule] = next.splice(current, 1);
    next.splice(Math.max(0, Math.min(next.length, target + offset)), 0, rule);
    try {
      const result = await auditedMutation(
        "Reorder rules",
        ["rules"],
        async () => {
          for (let i = 0; i < next.length; i++)
            await db.rules.update(next[i].id, {
              priority: 101 + next.length - i,
            });
        },
      );
      setChangeId(result.changeId);
      setMessage(
        "Rule order saved. Explicit rules run before remembered defaults.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Rule order could not be saved.",
      );
    }
  };
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [changeId, setChangeId] = useState("");
  function download(value: unknown) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "feng-finance-rules.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="card" id="categorization-rules">
      <div className="v2-filter-header">
        <h2>Rules</h2>
        <button
          className="primary"
          onClick={() =>
            setEditing({
              id: `new-${id()}`,
              name: "",
              match: "contains",
              pattern: "",
              direction: "any",
              priority: Math.max(100, ...rules.map((r) => r.priority)) + 1,
              builtIn: false,
              enabled: true,
              conditions: [
                { field: "description", operator: "contains", value: "" },
              ],
              actions: [{ type: "category", categoryId: "" }],
              stopProcessing: true,
            })
          }
        >
          Create rule
        </button>
      </div>
      <p className="muted">
        Your manual choices become defaults. Explicit rules run before Auto
        rules; drag to change the order within each group.
      </p>
      <div className="v2-row-actions">
        <button
          onClick={async () => {
            try {
              download(await exportRules());
            } catch {
              setError("Rules could not be exported.");
            }
          }}
        >
          Export rules
        </button>
        <label className="button file-button">
          Import rules
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Import v2 rules"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                if (file.size > 2000000)
                  throw new Error("Choose a rules file smaller than 2 MB.");
                const value: unknown = JSON.parse(await file.text());
                const result = await importRules(value, false);
                setChangeId(result.changeId);
                setMessage(
                  "Rules imported. Edit a rule to preview and apply it to existing transactions.",
                );
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "Rules could not be imported.",
                );
              }
            }}
          />
        </label>
      </div>
      {[...rules].sort(ruleOrder).map((rule, index, ordered) => (
        <div
          className="settings-row rule-list-row"
          key={rule.id}
          draggable
          onDragStart={() => setDragged(rule.id)}
          onDragEnd={() => setDragged(undefined)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (dragged) void reorder(dragged, rule.id);
          }}
        >
          <div>
            <strong>{rule.name}</strong>
            <span className="rule-order-controls">
              <button
                aria-label={`Move ${rule.name} up`}
                disabled={index === 0}
                onClick={() => void reorder(rule.id, ordered[index - 1].id)}
              >
                ↑
              </button>
              <button
                aria-label={`Move ${rule.name} down`}
                disabled={index === ordered.length - 1}
                onClick={() => void reorder(rule.id, ordered[index + 1].id)}
              >
                ↓
              </button>
            </span>
            {(rule.auto || rule.createdFrom === "auto") && (
              <StatusChip>Auto</StatusChip>
            )}
            <div className="muted">
              {rule.stats?.lastHit || rule.lastUsedAt ? (
                <>
                  Last used{" "}
                  <time
                    className="date-value"
                    dateTime={rule.stats?.lastHit ?? rule.lastUsedAt!}
                  >
                    {formatUkDate(
                      (rule.stats?.lastHit ?? rule.lastUsedAt!).slice(0, 10),
                    )}
                  </time>
                </>
              ) : (
                "Not used yet"
              )}
              {rule.singleUse ? " · Once" : ""}
              {rule.enabled === false ? " · Paused" : ""}
              {rule.stats
                ? ` · ${rule.stats.hits} ${rule.stats.hits === 1 ? "match" : "matches"}`
                : " · 0 matches"}
            </div>
          </div>
          <p className="muted">
            {displayRuleMatch(rule, accounts, categories)}
          </p>
          <p className="muted">
            {rule.actions
              ?.map((a) =>
                a.type === "category"
                  ? (categories.find((c) => c.id === a.categoryId)?.name ??
                    "Category")
                  : a.type === "rename"
                    ? `Name: ${a.merchant}`
                    : a.type === "kind"
                      ? a.kind?.replaceAll("_", " ")
                      : a.type === "split"
                        ? "Split by percentage"
                        : a.type === "reviewed"
                          ? "Mark reviewed"
                          : a.type === "tag"
                            ? "Add tags"
                            : "Link recurring series",
              )
              .filter(Boolean)
              .join(" · ") ??
              (rule.type === "transfer"
                ? "Transfer"
                : categories.find((c) => c.id === rule.categoryId)?.name)}{" "}
            <br />
            {rule.conditions?.find((c) => c.field === "accountId")
              ? (accounts.find(
                  (a) =>
                    a.id ===
                    rule.conditions?.find((c) => c.field === "accountId")
                      ?.value,
                )?.displayName ?? "Selected accounts")
              : rule.accountId
                ? (accounts.find((a) => a.id === rule.accountId)?.displayName ??
                  "Selected account")
                : "All accounts"}
          </p>
          <div className="v2-row-actions">
            <button onClick={() => setEditing(rule)}>Edit</button>
            <button
              onClick={async () => {
                try {
                  const result = await auditedMutation(
                    rule.enabled === false ? "Enable rule" : "Pause rule",
                    ["rules"],
                    async () =>
                      db.rules.update(rule.id, {
                        enabled: rule.enabled === false,
                      }),
                  );
                  setChangeId(result.changeId);
                  setMessage("Rule updated.");
                } catch {
                  setError("The rule could not be updated.");
                }
              }}
            >
              {rule.enabled === false ? "Enable" : "Pause"}
            </button>
            <button
              className="danger"
              onClick={async () => {
                if (
                  !window.confirm(
                    `Delete ${rule.name}? Existing transactions keep their categories. You can undo this change.`,
                  )
                )
                  return;
                try {
                  const result = await auditedMutation(
                    "Delete rule",
                    ["rules"],
                    async () => deleteRule(rule),
                  );
                  setChangeId(result.changeId);
                  setMessage("Rule deleted. Existing transactions kept.");
                } catch {
                  setError("The rule could not be deleted.");
                }
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
      {!rules.length && (
        <p className="muted">
          Your first categorisation creates a remembered default.
        </p>
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
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
      {editing && (
        <RuleEditor
          initial={editing}
          onClose={() => setEditing(undefined)}
          onSaved={(message, id) => {
            setMessage(message);
            setChangeId(id);
          }}
        />
      )}
    </section>
  );
}
