import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Transaction } from "../domain/models";
import { db } from "../storage/database";
import { suggestedRules } from "../categorization/rule-suggestions";
import { saveRuleWithExisting } from "../storage/rules";
import { id } from "../domain/normalize";
import { undoChange } from "../storage/audit";
export function SuggestedRules({
  transactions,
}: {
  transactions: Transaction[];
}) {
  const rules = useLiveQuery(() => db.rules.toArray(), [], []);
  const suggestions = suggestedRules(transactions, rules);
  const [message, setMessage] = useState("");
  const [changeId, setChangeId] = useState("");
  return (
    <section aria-label="Suggested categorization rules">
      <h3>Suggested rules</h3>
      {suggestions.length ? (
        suggestions.map((s) => (
          <div className="settings-row" key={s.rule.id}>
            <div>
              <strong>{s.rule.name}</strong>
              <p className="muted">
                You made this choice for {s.count} matching transactions.
              </p>
            </div>
            <button
              onClick={async () => {
                try {
                  const saved = await saveRuleWithExisting(
                    { ...s.rule, id: id() },
                    undefined,
                    false,
                  );
                  setChangeId(saved.changeId);
                  setMessage("Rule saved for future imports.");
                } catch (e) {
                  setMessage(
                    e instanceof Error
                      ? e.message
                      : "The rule could not be saved.",
                  );
                }
              }}
            >
              Use this rule
            </button>
          </div>
        ))
      ) : (
        <p className="muted">Your categorization defaults are up to date.</p>
      )}
      {message && (
        <p role="status">
          {message}{" "}
          {changeId && (
            <button
              onClick={async () => {
                await undoChange(changeId);
                setChangeId("");
                setMessage("Suggested rule undone.");
              }}
            >
              Undo
            </button>
          )}
        </p>
      )}
    </section>
  );
}
