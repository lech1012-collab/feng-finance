import type { Institution, TextRow } from "../domain/models";
const signals: Record<Exclude<Institution, "Other">, [RegExp, number][]> = {
  Barclays: [
    [/\bBARCLAYS\b|\bBARCLAYCARD\b/i, 0.55],
    [/money out|your previous balance/i, 0.15],
    [/money in|payments towards your account/i, 0.15],
    [/sort code|current account|account number|your .*visa statement/i, 0.15],
  ],
  "American Express": [
    [/AMERICAN EXPRESS|\bAMEX\b|\bamericanexpress\.co\.uk\b/i, 0.55],
    [/previous (?:closing )?balance|new balance/i, 0.15],
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
  const header = (
    tableStart >= 0 ? rows.slice(0, tableStart + 1) : rows.slice(0, 30)
  ).filter(
    (row) =>
      !/^(?:\d{1,2}\s+\w+\s+)?(?:payment (?:to|from)|direct debit to|bill payment to|transfer (?:to|from)|to |from )/i.test(
        row.text,
      ),
  );
  // Logos may be drawn rather than embedded as text. Issuer domains and legal
  // footer names still identify these PDFs; a bank named as a ledger payee does
  // not. Keep this independent of generic table/profile detection.
  const pageBounds = new Map<number, { left: number; bottom: number }>();
  for (const row of rows) {
    const previous = pageBounds.get(row.page);
    pageBounds.set(row.page, {
      left: Math.min(
        previous?.left ?? Infinity,
        ...row.items.map((item) => item.x),
      ),
      bottom: Math.max(previous?.bottom ?? 0, row.y),
    });
  }
  const issuerFooters = rows.filter(
    (row) =>
      row.y >= 500 &&
      row.y >= (pageBounds.get(row.page)?.bottom ?? Infinity) - 80 &&
      Math.min(...row.items.map((item) => item.x)) <=
        (pageBounds.get(row.page)?.left ?? 0) + 32 &&
      !/^(?:\d{1,2}\s+\w+|\d{4}-\d{2}-\d{2}|to\s|from\s)|\b(?:payment (?:to|from)|direct debit to|bill payment to|transfer (?:to|from))\b/i.test(
        row.text.trim(),
      ) &&
      (/\b(?:Barclays Bank (?:UK )?PLC|Barclaycard is|American Express (?:Services|Europe)|Revolut (?:Bank|Ltd|Limited|Payments))\b/i.test(
        row.text,
      ) ||
        /^(?:www\.|https?:\/\/|visit\s+(?:www\.)?|©\s*\d*\s*)?(?:barclays\.co\.uk|barclaycard\.co\.uk|americanexpress\.co\.uk|revolut\.com)(?:\b|\/)/i.test(
          row.text.trim(),
        )),
  );
  const text = [...header, ...issuerFooters].map((r) => r.text).join("\n");
  const candidates = Object.entries(signals)
    .map(([institution, rules]) => ({
      institution: institution as Institution,
      confidence: rules.reduce(
        (s, [re, w], index) =>
          s +
          (re.test(text) ||
          (index === 0 &&
            institution === "Revolut" &&
            /\b(?:BIC\s*:?\s*REVO(?:GB|LT)[A-Z0-9]{2}(?:[A-Z0-9]{3})?|IBAN\s*:?\s*GB\d{2}\s*REVO)\b/i.test(
              text,
            ))
            ? w
            : 0),
        0,
      ),
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
