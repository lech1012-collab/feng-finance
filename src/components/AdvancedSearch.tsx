import { createPortal } from "react-dom";
import { Toast } from "./Toast";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type {
  Account,
  Category,
  RuleCondition,
  Tag,
  Transaction,
} from "../domain/models";
import { db } from "../storage/database";
import { filterTransactions, parseTransactionQuery } from "../domain/query";
import { id } from "../domain/normalize";
import { saveView } from "../storage/views";
import { saveRuleWithExisting, validateConditions } from "../storage/rules";
import { auditedMutation, undoChange } from "../storage/audit";
import { ConditionEditor } from "./ConditionEditor";
import { transactionsCsv } from "../analytics/reports";
import "./v2-rules.css";

export function queryFromParams(params: URLSearchParams): {
  initialQuery: string;
  initialConditions: RuleCondition[];
  initialError?: string;
  initialMatch?: "all" | "any";
} {
  const initialQuery = (params.get("query") ?? "").slice(0, 500);
  try {
    const text = params.get("conditions") ?? "[]";
    if (text.length > 16000) throw new Error("The saved filter is too large.");
    const initialConditions: RuleCondition[] = JSON.parse(text);
    validateConditions(initialConditions);
    return {
      initialQuery,
      initialConditions,
      ...(params.get("queryMatch") === "any"
        ? { initialMatch: "any" as const }
        : {}),
    };
  } catch {
    return {
      initialQuery,
      initialConditions: [{ field: "amount", operator: "lt", value: 0 }],
      initialError:
        "This saved filter could not be read. Clear search to start again.",
    };
  }
}

export function AdvancedSearch({
  transactions,
  sourceTransactions = transactions,
  accounts,
  categories = [],
  tags = [],
  currency = "GBP",
  onChange,
  initialQuery = "",
  initialConditions = [],
  initialError = "",
  viewsTarget,
  actionsTarget,
  onOpen,
  exportTransactions,
  onViewSaved,
  onQueryStateChange,
  initialMatch = "all",
}: {
  transactions: Transaction[];
  sourceTransactions?: Transaction[];
  accounts: Account[];
  categories?: Category[];
  tags?: Tag[];
  currency?: string;
  onChange: (filtered: Transaction[]) => void;
  initialQuery?: string;
  initialConditions?: RuleCondition[];
  initialError?: string;
  viewsTarget?: HTMLElement | null;
  actionsTarget?: HTMLElement | null;
  onOpen?: () => void;
  exportTransactions?: Transaction[];
  onViewSaved?: () => void;
  initialMatch?: "all" | "any";
  onQueryStateChange?: (state: {
    query: string;
    conditions: RuleCondition[];
    match: "all" | "any";
  }) => void;
}) {
  const views = useLiveQuery(() => db.savedViews.toArray(), [], []);
  const [query, setQuery] = useState(initialQuery);
  const readInitial = () => {
    try {
      return initialConditions.length
        ? initialConditions
        : parseTransactionQuery(
            initialQuery,
            accounts,
            tags,
            new Date().getFullYear(),
            currency,
          );
    } catch {
      return [{ field: "amount" as const, operator: "lt" as const, value: 0 }];
    }
  };
  const [conditions, setConditions] = useState<RuleCondition[]>(readInitial);
  const [match, setMatch] = useState<"all" | "any">(initialMatch);
  const [advanced, setAdvanced] = useState(false);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(initialError);
  const [changeId, setChangeId] = useState("");
  const callback = useRef(onChange);
  callback.current = onChange;
  const initialKey = JSON.stringify([
    initialQuery,
    initialConditions,
    initialError,
    initialMatch,
  ]);
  useEffect(() => {
    setQuery(initialQuery);
    setConditions(readInitial());
    setError(initialError);
    setMatch(initialMatch);
  }, [initialKey]);
  const stateCallback = useRef(onQueryStateChange);
  stateCallback.current = onQueryStateChange;
  useEffect(() => {
    stateCallback.current?.({ query, conditions, match });
  }, [query, JSON.stringify(conditions), match]);
  const matched = useMemo(
    () => filterTransactions(transactions, conditions, match),
    [transactions, JSON.stringify(conditions), match],
  );
  const result = useMemo(() => {
    const byId = new Map(sourceTransactions.map((t) => [t.id, t]));
    return [
      ...new Map(
        matched.map((t) => {
          const row = t.parentId ? (byId.get(t.parentId) ?? t) : t;
          return [row.id, row] as const;
        }),
      ).values(),
    ];
  }, [matched, sourceTransactions]);
  const childMatches = matched.filter((t) => t.parentId).length;
  useEffect(() => {
    callback.current(result);
  }, [result]);
  function setText(text: string) {
    setQuery(text);
    try {
      setConditions(
        parseTransactionQuery(
          text,
          accounts,
          tags,
          new Date().getFullYear(),
          currency,
        ),
      );
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This query could not be read.",
      );
    }
    setMatch("all");
  }
  function download() {
    const sourceById = new Map(sourceTransactions.map((t) => [t.id, t]));
    const children = new Map<string, Transaction[]>();
    for (const row of sourceTransactions)
      if (row.parentId) {
        const lines = children.get(row.parentId) ?? [];
        lines.push(row);
        children.set(row.parentId, lines);
      }
    const url = URL.createObjectURL(
      new Blob(
        [
          transactionsCsv(
            [
              ...new Map(
                (exportTransactions ?? matched)
                  .flatMap((t) => {
                    const source = sourceById.get(t.id) ?? t;
                    return source.kind === "split_parent"
                      ? (children.get(source.id) ?? [])
                      : [source];
                  })
                  .map((t) => [t.id, t]),
              ).values(),
            ],
            accounts,
            categories,
            tags,
          ),
        ],
        {
          type: "text/csv;charset=utf-8",
        },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "feng-finance-filtered-transactions.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="card" aria-label="Advanced transaction search">
      <div className="v2-filter-header">
        <h2>Search and saved views</h2>
        <button aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
          {advanced ? "Hide conditions" : "Build a filter"}
        </button>
      </div>
      {conditions.length > 0 && childMatches > 0 && (
        <p className="muted">
          {childMatches} {childMatches === 1 ? "match is" : "matches are"}{" "}
          within split payments. The list shows each original payment once.
        </p>
      )}
      <label className="sr-only" htmlFor="advanced-query">
        Advanced transaction query
      </label>
      <input
        id="advanced-query"
        type="search"
        value={query}
        placeholder="Try amzn <10 2026 or tag:lisbon"
        onChange={(e) => setText(e.target.value)}
      />
      {!!views.length &&
        (viewsTarget ? (
          createPortal(
            <div
              className="v2-row-actions"
              aria-label="Saved transaction views"
            >
              {views
                .filter((v) => v.pinned)
                .map((v) => (
                  <button
                    key={v.id}
                    onClick={() => {
                      setConditions(v.conditions);
                      setMatch(v.match);
                      setQuery(v.query ?? "");
                    }}
                  >
                    {v.name}
                  </button>
                ))}
            </div>,
            viewsTarget,
          )
        ) : (
          <div className="v2-row-actions" aria-label="Saved transaction views">
            {views
              .filter((v) => v.pinned)
              .map((v) => (
                <button
                  key={v.id}
                  onClick={() => {
                    setConditions(v.conditions);
                    setMatch(v.match);
                    setQuery(v.query ?? "");
                  }}
                >
                  {v.name}
                </button>
              ))}
          </div>
        ))}
      {advanced && (
        <>
          <label>
            Match
            <select
              value={match}
              onChange={(e) => setMatch(e.target.value as "all" | "any")}
            >
              <option value="all">All conditions</option>
              <option value="any">Any condition</option>
            </select>
          </label>
          <ConditionEditor
            conditions={conditions}
            onChange={setConditions}
            accounts={accounts}
            categories={categories}
            tags={tags}
            currency={currency}
          />
          <div className="v2-inline-form">
            <label>
              View name
              <input
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button
              disabled={!name.trim()}
              onClick={async () => {
                try {
                  const saved = await saveView({
                    id: id(),
                    name,
                    conditions,
                    match,
                    pinned: true,
                    query,
                  });
                  setChangeId(saved.changeId);
                  setMessage("View saved as a quick filter.");
                  onViewSaved?.();
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "View could not be saved.",
                  );
                }
              }}
            >
              Save view
            </button>
          </div>
          <div className="v2-inline-form">
            <label>
              Category for a rule
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Choose category</option>
                {categories
                  .filter((c) => !c.archived && !c.parentId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <button
              disabled={!categoryId || !conditions.length}
              onClick={async () => {
                try {
                  const saved = await saveRuleWithExisting(
                    {
                      id: id(),
                      name: name || query || "Saved search rule",
                      conditions,
                      conditionMatch: match,
                      actions: [{ type: "category", categoryId }],
                      match: "contains",
                      pattern: "",
                      direction: "any",
                      priority: 1000,
                      builtIn: false,
                      stopProcessing: true,
                      createdFrom: "user",
                    },
                    undefined,
                    false,
                  );
                  setChangeId(saved.changeId);
                  setMessage(
                    "Rule saved for future imports. Preview it in Settings to apply to existing transactions.",
                  );
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "Rule could not be created.",
                  );
                }
              }}
            >
              Create rule from filter
            </button>
          </div>
          {views.map((v) => (
            <div className="settings-row" key={v.id}>
              <span>{v.name}</span>
              <div className="v2-row-actions">
                <button
                  onClick={() => {
                    setConditions(v.conditions);
                    setMatch(v.match);
                    setQuery(v.query ?? "");
                  }}
                >
                  Open
                </button>
                <button
                  onClick={async () => {
                    const saved = await saveView({ ...v, pinned: !v.pinned });
                    setChangeId(saved.changeId);
                    setMessage(v.pinned ? "View unpinned." : "View pinned.");
                  }}
                >
                  {v.pinned ? "Unpin" : "Pin"}
                </button>
                <button
                  onClick={async () => {
                    const saved = await auditedMutation(
                      "Delete saved view",
                      ["savedViews"],
                      async () => db.savedViews.delete(v.id),
                    );
                    setChangeId(saved.changeId);
                    setMessage("Saved view deleted.");
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </>
      )}
      <div className="v2-filter-header">
        <p className="muted" role="status">
          {result.length} matching{" "}
          {result.length === 1 ? "transaction" : "transactions"}
        </p>
        <div className="v2-row-actions">
          {actionsTarget ? (
            createPortal(
              <>
                <button
                  onClick={() => {
                    setAdvanced(true);
                    onOpen?.();
                  }}
                >
                  Create rule from filter
                </button>
                <button
                  onClick={download}
                  disabled={!(exportTransactions ?? result).length}
                >
                  Export these transactions
                </button>
              </>,
              actionsTarget,
            )
          ) : (
            <button onClick={download} disabled={!result.length}>
              Export these transactions
            </button>
          )}
          {conditions.length > 0 && (
            <button
              onClick={() => {
                setQuery("");
                setConditions([]);
                setError("");
              }}
            >
              Clear search
            </button>
          )}
        </div>
      </div>
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
      {error && (
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
