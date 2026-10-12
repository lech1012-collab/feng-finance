import type { BankProfile, ExtractedTextItem } from "./types";
import { reconstructFontRows } from "./table";
import { DATE_LIKE, headerRole, MONEY_PATTERN } from "./tokens";
export const bankProfiles: BankProfile[] = [
  {
    id: "barclays-current",
    institution: "Barclays",
    accountTypeHint: "current",
    issuerPatterns: [/\bbarclays\b/i],
    headerHints: {
      out: ["money out", "paid out"],
      in: ["money in", "paid in"],
    },
    signConventionHint: "in_out_columns",
  },
  {
    id: "barclaycard",
    institution: "Barclays",
    accountTypeHint: "credit",
    issuerPatterns: [/\bbarclaycard\b/i],
    headerHints: { amount: ["amount"] },
    signConventionHint: "signed_positive_out",
    sectionSignHints: [
      {
        pattern:
          /payments towards your account|payment received|direct debit payment/i,
        direction: "in",
      },
    ],
  },
  {
    id: "amex",
    institution: "American Express",
    accountTypeHint: "credit",
    issuerPatterns: [/american express|americanexpress\.co\.uk|\bamex\b/i],
    headerHints: { amount: ["amount"], description: ["transaction details"] },
    signConventionHint: "signed_positive_out",
    sectionSignHints: [
      {
        pattern:
          /payments|payment received|payment thank you|direct debit payment/i,
        direction: "in",
      },
    ],
  },
  {
    id: "revolut",
    institution: "Revolut",
    accountTypeHint: "current",
    issuerPatterns: [/\brevolut\b/i],
    headerHints: { out: ["money out"], in: ["money in"] },
    signConventionHint: "in_out_columns",
  },
];
export function detectProfile(items: ExtractedTextItem[]) {
  if (!items.length) return undefined;
  const page = Math.min(...items.map((i) => i.page));
  const rows = reconstructFontRows(items.filter((item) => item.page === page));
  const body = rows.findIndex((row) => {
    const roles = row.items.map((item) => headerRole(item.text));
    const tableHeader =
      roles.includes("date") &&
      roles.some(
        (role) =>
          role === "description" ||
          ["in", "out", "amount", "balance"].includes(role ?? ""),
      );
    const datedMovement =
      row.items.some((item) => DATE_LIKE.test(item.text.trim())) &&
      (row.items.some((item) => MONEY_PATTERN.test(item.text.trim())) ||
        /[£€$]\s*[-+]?\d[\d,]*\.\d{2}\b/.test(row.text) ||
        /\d[\d,]*\.\d{2}(?:\s+(?:CR|DR))?\s*$/i.test(row.text));
    return (
      tableHeader || datedMovement || /^Your transactions\b/i.test(row.text)
    );
  });
  const header = (body >= 0 ? rows.slice(0, body) : rows).filter(
    (row) =>
      !/^(?:payment(?:\s+(?:from|to))?|direct debit(?:\s+to)?|bill payment(?:\s+to)?|transfer(?:\s+(?:from|to))?|top[ -]?up|to\s+(?:Barclaycard|Barclays|Amex|American Express|Revolut))\b/i.test(
        row.text,
      ),
  );
  const text = header.map((row) => row.text).join("\n");
  const credit =
    /card ending|card number|membership number|credit card|visa statement|previous (?:closing )?balance|new balance|payments towards your account/i.test(
      text,
    );
  const current =
    /current account|sort code|opening balance|money in|money out/i.test(text);
  const candidates = bankProfiles
    .map((profile) => {
      const issuerRows = header.filter((row) =>
        profile.issuerPatterns.some((pattern) => pattern.test(row.text)),
      );
      if (!issuerRows.length) return { profile, score: 0 };
      const issuerScore = issuerRows.reduce(
        (score, row) =>
          score +
          2 +
          (header.indexOf(row) < 3 ? 4 : 0) +
          (/barclaycard\.co\.uk|americanexpress\.co\.uk|barclays\.co\.uk|revolut\.com/i.test(
            row.text,
          )
            ? 4
            : 0),
        0,
      );
      return {
        profile,
        score:
          issuerScore +
          (profile.accountTypeHint === "credit"
            ? Number(credit)
            : Number(current)) *
            3,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!candidates.length || candidates[1]?.score === candidates[0].score)
    return undefined;
  return candidates[0].profile;
}
