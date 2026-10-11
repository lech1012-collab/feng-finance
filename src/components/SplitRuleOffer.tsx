import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Rule, Transaction } from "../domain/models";
import { allocateMinor } from "../analytics/effective-transactions";
import { id, normalizeMerchant } from "../domain/normalize";
import { displayMerchant } from "../domain/presentation";
import { safeSum } from "../domain/money";
import { db } from "../storage/database";
import { saveRuleWithExisting } from "../storage/rules";
import { undoChange } from "../storage/audit";

/** A future-import offer, never a second edit of the already saved split. */
export function buildSplitRuleOffer(
  transaction: Transaction,
  lines: Transaction[],
): Rule | undefined {
  const merchant = normalizeMerchant(
    transaction.sourceMerchant ?? transaction.merchant,
  );
  if (
    transaction.isDemo ||
    transaction.amount >= 0 ||
    transaction.parentId ||
    transaction.isTransfer ||
    transaction.type === "transfer" ||
    !merchant ||
    ["refund", "transfer", "card_repayment"].includes(transaction.kind ?? "") ||
    lines.length < 2 ||
    lines.length > 20 ||
    lines.some(
      (line) =>
        !line.categoryId ||
        line.parentId !== transaction.id ||
        line.amount >= 0 ||
        line.currency !== transaction.currency,
    ) ||
    safeSum(lines.map((line) => line.amount)) !== transaction.amount
  )
    return;
  const weights = allocateMinor(
    10000,
    lines.map((line) => Math.abs(line.amount)),
  );
  if (weights.some((weight) => weight === 0)) return;
  return {
    id: `split-offer-${transaction.id}`,
    name: `Split ${displayMerchant(transaction)} ${weights.map((weight) => weight / 100).join("/")}`,
    match: "exact",
    pattern: merchant,
    accountId: transaction.accountId,
    direction: "negative",
    priority: 200,
    builtIn: false,
    createdFrom: "user",
    conditionMatch: "all",
    conditions: [
      { field: "merchant", operator: "equals", value: merchant },
      { field: "accountId", operator: "equals", value: transaction.accountId },
      { field: "direction", operator: "equals", value: "negative" },
    ],
    actions: [
      {
        type: "split",
        splits: lines.map((line, index) => ({
          categoryId: line.categoryId!,
          percentage: weights[index] / 100,
          ...(line.tags.length ? { tagIds: [...line.tags] } : {}),
        })),
      },
    ],
    stopProcessing: true,
  };
}

export function SplitRuleOffer({
  transaction,
  lines,
}: {
  transaction: Transaction;
  lines: Transaction[];
}) {
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], []);
  const rules = useLiveQuery(() => db.rules.toArray(), [], []);
  const [changeId, setChangeId] = useState("");
  const [message, setMessage] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setChangeId("");
    setMessage("");
    setDismissed(false);
  }, [transaction.id]);
  const rule = buildSplitRuleOffer(transaction, lines);
  if (!rule || dismissed) return null;
  const percentages = rule
    .actions![0].splits!.map((line) => line.percentage)
    .join("/");
  const account = accounts.find((item) => item.id === transaction.accountId);
  const existing = rules.some(
    (item) =>
      item.enabled !== false &&
      item.accountId === rule.accountId &&
      item.pattern === rule.pattern &&
      JSON.stringify(item.actions) === JSON.stringify(rule.actions),
  );
  return (
    <section className="notice" aria-label="Remember this split">
      {message && <p role="status">{message}</p>}
      {!changeId && !existing && (
        <>
          <p>
            Always split {displayMerchant(transaction)} on{" "}
            {account?.institution ?? "this account"} {percentages}%?
          </p>
          <p className="muted">
            Future imports only. Your saved split stays as it is.
          </p>
          <div className="accuracy-actions">
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const saved = await saveRuleWithExisting(
                    {
                      ...rule,
                      id: id(),
                      priority:
                        Math.max(
                          200,
                          ...rules
                            .filter(
                              (item) =>
                                !item.builtIn &&
                                !item.auto &&
                                item.createdFrom !== "auto",
                            )
                            .map((item) => item.priority),
                        ) + 1,
                    },
                    undefined,
                    false,
                  );
                  setChangeId(saved.changeId);
                  setMessage("Split rule saved for future imports.");
                } catch (error) {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "The split rule could not be saved.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Always split this way
            </button>
            <button disabled={busy} onClick={() => setDismissed(true)}>
              Not now
            </button>
          </div>
        </>
      )}
      {changeId && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await undoChange(changeId);
              setChangeId("");
              setMessage(
                "Split rule undone. Your saved transaction is unchanged.",
              );
            } catch (error) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : "The rule could not be undone.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Undo split rule
        </button>
      )}
    </section>
  );
}
