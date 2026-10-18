import { money } from "../domain/money";
import { formatUkDate } from "../domain/dates";
import {
  unambiguousImportTransfers,
  type ImportTransferPreview,
} from "../import/transfer-review";
import "./ImportTransferReview.css";

export function ImportTransferReview({
  preview,
  selectedIds,
  onChange,
  rejectedAutomaticIds,
  onRejectedAutomaticChange,
  busy,
}: {
  preview: ImportTransferPreview;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  rejectedAutomaticIds: string[];
  onRejectedAutomaticChange: (ids: string[]) => void;
  busy: boolean;
}) {
  if (!preview.proposals.length) return null;
  const automaticIds = new Set(preview.automaticProposalIds);
  const automatic = preview.proposals.filter((proposal) =>
    automaticIds.has(proposal.id),
  );
  const manual = preview.proposals.filter(
    (proposal) => !automaticIds.has(proposal.id),
  );
  const automaticCount = automatic.filter(
    (proposal) => !rejectedAutomaticIds.includes(proposal.id),
  ).length;
  const selected = preview.proposals.filter((proposal) =>
    selectedIds.includes(proposal.id),
  );
  const used = new Set(
    selected.flatMap((proposal) => [proposal.debitTxId, proposal.creditTxId]),
  );
  const unique = unambiguousImportTransfers(preview.proposals).filter(
    (proposal) => !automaticIds.has(proposal.id),
  );
  const transactions = new Map(
    preview.transactions.map((row) => [row.id, row]),
  );
  const accounts = new Map(
    preview.accounts.map((account) => [account.id, account]),
  );
  return (
    <details className="card import-transfer-review">
      <summary>
        <strong>Optional transfer linking</strong>
        <span>
          {automaticCount} automatic · {selected.length} confirmed ·{" "}
          {manual.length - selected.length} left for later
        </span>
      </summary>
      <section aria-label="Confirm internal transfers">
        <h2>Money between your accounts</h2>
        {automatic.length > 0 && (
          <div className="import-automatic-summary">
            <p role="status">
              <strong>
                {automaticCount}{" "}
                {automaticCount === 1 ? "pair will" : "pairs will"} link
                automatically
              </strong>
              <span className="block muted">
                After import · one match, same currency, within 2 days
              </span>
            </p>
          </div>
        )}
        {manual.length > 0 && <h3>Transfers to confirm</h3>}
        {manual.length > 0 && (
          <p>
            Confirm transfers between your own accounts and card repayments.
            Confirmed pairs are excluded from income and spending. Other matches
            stay unlinked until you confirm them.
          </p>
        )}
        {unique.length > 1 && (
          <button
            disabled={busy}
            onClick={() =>
              onChange([
                ...new Set([
                  ...selectedIds,
                  ...unique.map((proposal) => proposal.id),
                ]),
              ])
            }
          >
            Confirm all clear matches
          </button>
        )}
        <div className="import-transfer-list">
          {preview.proposals.map((proposal) => {
            const outgoing = transactions.get(proposal.debitTxId)!,
              incoming = transactions.get(proposal.creditTxId)!;
            const debitAccount = accounts.get(outgoing.accountId)!,
              creditAccount = accounts.get(incoming.accountId)!;
            const isAutomatic = automaticIds.has(proposal.id);
            const checked = isAutomatic
              ? !rejectedAutomaticIds.includes(proposal.id)
              : selectedIds.includes(proposal.id);
            const conflict =
              !checked && (used.has(outgoing.id) || used.has(incoming.id));
            return (
              <article className="import-transfer-pair" key={proposal.id}>
                <span>
                  <strong>
                    {proposal.pairKind === "card_repayment"
                      ? "Card repayment"
                      : "Transfer"}
                    {proposal.crossCurrency ? " · different currencies" : ""}
                    {isAutomatic
                      ? checked
                        ? " · will link automatically"
                        : " · left unlinked"
                      : ""}
                  </strong>
                  <span className="block">
                    {debitAccount.institution} · {debitAccount.displayName} ·{" "}
                    <span className="amount">
                      {money(outgoing.amount, outgoing.currency)}
                    </span>{" "}
                    ·{" "}
                    <time className="date-value" dateTime={outgoing.date}>
                      {formatUkDate(outgoing.date)}
                    </time>
                  </span>
                  <span className="block">
                    {creditAccount.institution} · {creditAccount.displayName} ·{" "}
                    <span className="amount">
                      {money(incoming.amount, incoming.currency, true)}
                    </span>{" "}
                    ·{" "}
                    <time className="date-value" dateTime={incoming.date}>
                      {formatUkDate(incoming.date)}
                    </time>
                  </span>
                  {conflict && (
                    <span className="block muted">
                      A different match for this payment is selected.
                    </span>
                  )}
                </span>
                <button
                  disabled={busy || conflict}
                  aria-label={`${checked ? "Leave unlinked" : "Link"} ${debitAccount.institution} to ${creditAccount.institution} ${money(Math.abs(outgoing.amount), outgoing.currency)}`}
                  onClick={() => {
                    if (isAutomatic)
                      onRejectedAutomaticChange(
                        checked
                          ? [...rejectedAutomaticIds, proposal.id]
                          : rejectedAutomaticIds.filter(
                              (id) => id !== proposal.id,
                            ),
                      );
                    else
                      onChange(
                        checked
                          ? selectedIds.filter((id) => id !== proposal.id)
                          : [...selectedIds, proposal.id],
                      );
                  }}
                >
                  {checked ? "Leave unlinked" : "Link these payments"}
                </button>
              </article>
            );
          })}
        </div>
        {manual.length > 0 && (
          <p className="muted">
            {selected.length} confirmed ·{" "}
            {manual.length -
              selected.filter((proposal) => !automaticIds.has(proposal.id))
                .length}{" "}
            left for later
          </p>
        )}
      </section>
    </details>
  );
}
