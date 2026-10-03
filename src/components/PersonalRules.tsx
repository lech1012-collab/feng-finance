import { useState } from "react";
import {
  applyRuleBundle,
  previewRuleBundle,
  validateRuleBundle,
  type RuleBundle,
} from "../categorization/bundles";
export function PersonalRules() {
  const [bundle, setBundle] = useState<RuleBundle>();
  const [preview, setPreview] =
    useState<Awaited<ReturnType<typeof previewRuleBundle>>>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="card" id="personal-rules">
      <h2>Personal rules</h2>
      <p className="muted">
        Apply your categorization choices to matching transactions and remember
        them for future statements.
      </p>
      <label className="button file-button">
        Import personal rules
        <input
          type="file"
          accept="application/json,.json"
          aria-label="Import personal rules"
          disabled={busy}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setBusy(true);
            setError("");
            setMessage("");
            setPreview(undefined);
            try {
              if (f.size > 100000) throw new Error("Rules file is too large.");
              const b = validateRuleBundle(JSON.parse(await f.text()));
              const p = await previewRuleBundle(b);
              setBundle(b);
              setPreview(p);
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : "This rules file could not be read.",
              );
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {preview && bundle && (
        <div className="rule-preview">
          <h3>{preview.changes.length} transactions to update</h3>
          <p className="muted">
            Dates, amounts and statement balances stay as printed.
          </p>
          {preview.rules.map((r) => (
            <div className="settings-row" key={r.id}>
              <strong>{r.name}</strong>
              <span className="count-chip">
                {preview.changes.filter((c) => c.rule.id === r.id).length}{" "}
                updates
              </span>
            </div>
          ))}
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const n = await applyRuleBundle(bundle, preview.signature);
                setMessage(
                  `${n} transactions updated. Your rules will apply to future imports.`,
                );
                setPreview(undefined);
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Changes could not be saved.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Apply corrections & remember rules
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="notice success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="notice warning">
          {error}
        </p>
      )}
    </section>
  );
}
