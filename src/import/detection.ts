import type { Institution, TextRow } from "../domain/models";
const signals: Record<Exclude<Institution, "Other">, [RegExp, number][]> = {
  Barclays: [
    [/\bBARCLAYS\b|\bBARCLAYCARD\b/i, 0.55],
    [/money out|your previous balance/i, 0.15],
    [/money in|payments towards your account/i, 0.15],
    [/sort code|current account|account number|your .*visa statement/i, 0.15],
  ],
  "American Express": [
    [/AMERICAN EXPRESS|\bAMEX\b/i, 0.55],
    [/previous balance|new balance/i, 0.15],
    [/card ending|card number|membership/i, 0.15],
    [/payment received|statement of account/i, 0.15],
  ],
  Revolut: [
    [/\bREVOLUT\b/i, 0.55],
    [/account statement/i, 0.15],
    [/IBAN|BIC/i, 0.15],
    [/money out|money in|balance/i, 0.15],
  ],
};
export function detectBank(rows: TextRow[]) {
  const tableStart = rows.findIndex(
    (r) =>
      /\bDate\b/i.test(r.text) &&
      /Description|Details|Transaction|Merchant/i.test(r.text),
  );
  const text = (
    tableStart >= 0 ? rows.slice(0, tableStart + 1) : rows.slice(0, 30)
  )
    .map((r) => r.text)
    .join("\n");
  const candidates = Object.entries(signals)
    .map(([institution, rules]) => ({
      institution: institution as Institution,
      confidence: rules.reduce((s, [re, w]) => s + (re.test(text) ? w : 0), 0),
    }))
    .sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];
  return {
    institution:
      best.confidence >= 0.55 ? best.institution : ("Other" as Institution),
    confidence: Math.min(1, best.confidence),
    ambiguous:
      candidates[1].confidence >= 0.55 &&
      best.confidence - candidates[1].confidence < 0.25,
  };
}
