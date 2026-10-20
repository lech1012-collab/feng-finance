import { useState } from "react";
import type { GenericParseResult } from "../import/generic/types";
import { displayMoney } from "./generic-review-view";
import { Sheet } from "./Sheet";
import { CheckboxRow, WarningBox } from "./UIPrimitives";

export function ImportRiskConfirmation({
  result,
  currency,
  reconciliation = result?.checks.reconciliation,
  busy,
  onConfirm,
  onCancel,
  warnings = result?.parsed?.warnings ?? [],
  unreadPages = result?.checks.unreadPages ?? [],
}: {
  result?: GenericParseResult;
  currency?: string;
  reconciliation?: {
    calculated?: number;
    reported?: number;
    difference?: number;
  };
  busy: boolean;
  warnings?: string[];
  unreadPages?: number[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [accepted, setAccepted] = useState(false);
  const figures = [
    ["Reported closing balance", reconciliation?.reported],
    ["Calculated closing balance", reconciliation?.calculated],
    ["Balance difference", reconciliation?.difference],
    ["Money-in difference", result?.checks.moneyInDifference],
    ["Money-out difference", result?.checks.moneyOutDifference],
  ] as const;
  return (
    <Sheet
      title="Import an unverified statement?"
      onClose={onCancel}
      footer={
        <>
          <button type="button" disabled={busy} onClick={onCancel} autoFocus>
            Continue reviewing
          </button>
          <button
            type="button"
            disabled={busy || !accepted}
            onClick={onConfirm}
          >
            Accept unverified statement
          </button>
        </>
      }
    >
      <WarningBox
        title="Some statement figures are unverified"
        severity="error"
      >
        <p>
          This statement will remain <strong>Unverified</strong>. Acceptance
          does not verify the statement.
        </p>
        <dl className="import-risk-figures totals">
          {figures
            .filter(([, value]) => value !== undefined)
            .map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {displayMoney(value, currency, label.includes("difference"))}
                </dd>
              </div>
            ))}
        </dl>
        {!!unreadPages.length && (
          <p>
            Pages {unreadPages.join(", ")} have not been read. Their
            transactions will not be imported.
          </p>
        )}
        {warnings.length > 0 && (
          <ul>
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        )}
        <p>
          Only selected, valid transactions can be added. Check the original PDF
          before relying on these figures.
        </p>
      </WarningBox>
      <CheckboxRow
        checked={accepted}
        onChange={setAccepted}
        disabled={busy}
        label="I checked the original statement and accept importing these unverified figures."
      />
    </Sheet>
  );
}
