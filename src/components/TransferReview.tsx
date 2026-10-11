import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/database";
import {
  confirmTransferProposals,
  rejectTransferProposal,
} from "../storage/accuracy";
import { authorizeMonthEdit } from "../storage/month-review";
import { undoChange } from "../storage/audit";
import { money } from "../domain/money";
import { displayDate, displayMerchant } from "../domain/presentation";
import type { Transaction } from "../domain/models";
import "./accuracy.css";

export function TransferReview({
  transactionIds,
  onChanged,
}: {
  transactionIds?: string[];
  onChanged?: () => void | Promise<void>;
}) {
  const data = useLiveQuery(async () => {
    const proposals = await db.transferProposals
      .where("status")
      .equals("pending")
      .toArray();
    const visible = proposals.filter(
      (proposal) =>
        !transactionIds ||
        transactionIds.includes(proposal.debitTxId) ||
        transactionIds.includes(proposal.creditTxId),
    );
    const transactions = new Map(
      (
        await db.transactions.bulkGet([
          ...new Set(
            visible.flatMap((proposal) => [
              proposal.debitTxId,
              proposal.creditTxId,
            ]),
          ),
        ])
      )
        .filter((row): row is Transaction => !!row)
        .map((row) => [row.id, row]),
    );
    return {
      proposals: visible.filter(
        (proposal) =>
          transactions.has(proposal.debitTxId) &&
          transactions.has(proposal.creditTxId),
      ),
      transactions,
      accounts: await db.accounts.toArray(),
    };
  }, [transactionIds?.join("|")]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ changeId: string; label: string }>();
  const confirm = async (ids: string[]) => {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      const selected = data.proposals.filter((proposal) =>
        ids.includes(proposal.id),
      );
      const rows = selected.flatMap((proposal) => [
        data.transactions.get(proposal.debitTxId)!,
        data.transactions.get(proposal.creditTxId)!,
      ]);
      if (!(await authorizeMonthEdit(rows))) return;
      const result = await confirmTransferProposals(ids);
      setReceipt({
        changeId: result.changeId,
        label: `${result.result.length} transfer${result.result.length === 1 ? "" : "s"} confirmed`,
      });
      await onChanged?.();
    } catch (exception) {
      setError(
        exception instanceof Error
          ? exception.message
          : "Transfer could not be linked.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (!data || (!data.proposals.length && !receipt)) return null;
  const transactions = data.proposals.flatMap((proposal) => [
    proposal.debitTxId,
    proposal.creditTxId,
  ]);
  const unambiguous = new Set(transactions).size === transactions.length;
  return (
    <section className="card transfer-review" aria-label="Transfers to confirm">
      <h2>
        Transfers to confirm
        {data.proposals.length ? ` · ${data.proposals.length}` : ""}
      </h2>
      <p className="coverage-note">
        Confirm money moving between your own accounts. Until confirmed, these
        rows remain ordinary money in and spending.
      </p>
      <div className="transfer-review-list">
        {data.proposals.map((proposal) => {
          const debit = data.transactions.get(proposal.debitTxId)!,
            credit = data.transactions.get(proposal.creditTxId)!;
          return (
            <article key={proposal.id} className="transfer-proposal">
              <h3>
                {proposal.pairKind === "card_repayment"
                  ? "Card repayment"
                  : "Account transfer"}
                {proposal.crossCurrency ? " · Exchange-rate match" : ""}
              </h3>
              <div className="transfer-proposal-sides">
                {[debit, credit].map((row) => (
                  <div key={row.id}>
                    <strong>{money(row.amount, row.currency, true)}</strong>
                    <span>
                      {data.accounts.find(
                        (account) => account.id === row.accountId,
                      )?.displayName ?? "Account"}
                    </span>
                    <small>
                      {displayDate(row.date)} · {displayMerchant(row)}
                    </small>
                  </div>
                ))}
              </div>
              <div className="accuracy-actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void confirm([proposal.id])}
                >
                  Confirm pair
                </button>
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const result = await rejectTransferProposal(proposal.id);
                      setReceipt({
                        changeId: result.changeId,
                        label: "Suggestion dismissed",
                      });
                      await onChanged?.();
                    } catch (exception) {
                      setError(
                        exception instanceof Error
                          ? exception.message
                          : "Suggestion could not be dismissed.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  These are separate payments
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {data.proposals.length > 1 && (
        <button
          disabled={busy || !unambiguous}
          onClick={() =>
            void confirm(data.proposals.map((proposal) => proposal.id))
          }
        >
          Confirm all visible pairs
        </button>
      )}
      {!unambiguous && (
        <p className="coverage-note">
          A transaction has more than one possible match. Choose its correct
          pair individually.
        </p>
      )}
      {error && (
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
      {receipt && (
        <div role="status" className="notice">
          {receipt.label}.{" "}
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await undoChange(receipt.changeId);
                setReceipt(undefined);
                await onChanged?.();
              } catch (exception) {
                setError(
                  exception instanceof Error
                    ? exception.message
                    : "Undo failed.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Undo
          </button>
        </div>
      )}
    </section>
  );
}

export function TransferSettings() {
  const values = useLiveQuery(async () => ({
    mode: (await db.settings.get("transferMatching"))?.value ?? "manual",
    window:
      (await db.settings.get("transferDateWindowDays"))?.value ??
      (await db.settings.get("transferDateWindow"))?.value ??
      "4",
  }));
  const [offer, setOffer] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="card" id="transfers">
      <h2>Transfers</h2>
      <label>
        Transfer matching
        <select
          value={values?.mode ?? "manual"}
          onChange={async (event) => {
            const mode = event.target.value;
            try {
              const { auditedMutation } = await import("../storage/audit");
              await auditedMutation(
                "Change transfer matching",
                ["settings"],
                async () =>
                  db.settings.put({ key: "transferMatching", value: mode }),
              );
              if (mode === "automatic") setOffer(true);
            } catch (exception) {
              setError(
                exception instanceof Error
                  ? exception.message
                  : "Setting could not be saved.",
              );
            }
          }}
        >
          <option value="manual">Manual</option>
          <option value="automatic">Automatic</option>
        </select>
      </label>
      <p className="coverage-note">
        {values?.mode === "automatic"
          ? "Future imports link unique matches within 2 days. Other pairs need confirmation."
          : "You confirm every proposed pair. Existing pairs stay unchanged."}
      </p>
      <label>
        Date window
        <select
          value={values?.window ?? "4"}
          onChange={async (event) => {
            const value = event.target.value;
            try {
              const { auditedMutation } = await import("../storage/audit");
              await auditedMutation(
                "Change transfer date window",
                ["settings"],
                async () =>
                  db.settings.put({ key: "transferDateWindowDays", value }),
              );
            } catch (exception) {
              setError(
                exception instanceof Error
                  ? exception.message
                  : "Setting could not be saved.",
              );
            }
          }}
        >
          {Array.from({ length: 8 }, (_, days) => (
            <option key={days} value={days}>
              {days} day{days === 1 ? "" : "s"}
            </option>
          ))}
        </select>
      </label>
      {offer && <AutomaticOffer onClose={() => setOffer(false)} />}
      {error && (
        <p role="alert" className="notice warning">
          {error}
        </p>
      )}
    </section>
  );
}

function AutomaticOffer({ onClose }: { onClose: () => void }) {
  const eligible = useLiveQuery(async () => {
    const { eligibleAutomaticProposals } = await import("../transfers/engine");
    return eligibleAutomaticProposals(
      await db.transferProposals.where("status").equals("pending").toArray(),
      await db.transactions.toArray(),
    );
  });
  if (!eligible?.length)
    return (
      <p className="coverage-note">
        No pending pairs meet the automatic rules.
      </p>
    );
  return (
    <div className="notice">
      <p>
        Link {eligible.length} pending pair{eligible.length === 1 ? "" : "s"}{" "}
        that meet the automatic rules now?
      </p>
      <TransferReview
        transactionIds={eligible.flatMap((proposal) => [
          proposal.debitTxId,
          proposal.creditTxId,
        ])}
      />
      <button onClick={onClose}>Keep pending</button>
    </div>
  );
}
