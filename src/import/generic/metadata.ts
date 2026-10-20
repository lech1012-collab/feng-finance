import type { Institution, ParsedStatement } from "../../domain/models";
import { identifyPeriod } from "../../parsers/period";
import type {
  BankProfile,
  GenericParseOptions,
  ExtractedTextItem,
  ReconstructedTable,
} from "./types";
import { reconstructFontRows } from "./table";
import { DATE_PATTERN, readMoney } from "./tokens";

export interface StatementMetadata {
  institution: Institution;
  accountIdentifier?: string;
  accountType: ParsedStatement["accountType"];
  currency?: string;
  period?: { start: string; end: string };
  openingBalance?: number;
  closingBalance?: number;
  printedMoneyIn?: number;
  printedMoneyOut?: number;
  issuerText: string;
  profile?: BankProfile;
}
const currencyCodes = /\b(?:GBP|EUR|USD|CHF|AUD|CAD|NZD|HKD|SGD|JPY|KWD)\b/gi;
export function identifyMetadata(
  items: ExtractedTextItem[],
  _table: ReconstructedTable,
  options: GenericParseOptions,
): StatementMetadata {
  const rows = reconstructFontRows(items);
  const text = rows.map((row) => row.text).join("\n");
  const credit =
    options.profile?.accountTypeHint === "credit" ||
    options.account?.accountType === "credit" ||
    options.account?.accountType === "credit_card";
  const codeRows = rows.filter((row) =>
    /\bcurrency\b|\b(?:GBP|EUR|USD|CHF|AUD|CAD|NZD|HKD|SGD|JPY|KWD)\s+Statement\b|account statement|statement of account/i.test(
      row.text,
    ),
  );
  const codes = [
    ...new Set(
      codeRows.flatMap((row) =>
        (row.text.match(currencyCodes) ?? []).map((code) => code.toUpperCase()),
      ),
    ),
  ];
  const detectedCurrency =
    codes.length === 1
      ? codes[0]
      : codes.length > 1
        ? undefined
        : text.includes("£")
          ? "GBP"
          : text.includes("€")
            ? "EUR"
            : undefined;
  const currency =
    codes.length > 1
      ? undefined
      : (detectedCurrency ?? options.account?.currency);
  let period = options.period;
  if (!period) {
    const found = new Map<string, { start: string; end: string }>();
    for (const page of [...new Set(rows.map((row) => row.page))])
      try {
        const candidate = identifyPeriod(
          rows
            .filter((row) => row.page === page)
            .map((row) => ({
              ...row,
              text: row.text.replace(
                /^Account transactions from\s+/i,
                "Statement period: ",
              ),
            })),
          true,
          Number.MAX_SAFE_INTEGER,
        );
        found.set(`${candidate.start}/${candidate.end}`, candidate);
      } catch {
        /* Missing/ambiguous printed dates require explicit source review. */
      }
    if (found.size === 1) period = [...found.values()][0];
  }
  const primaryAccounts = [
    ...text.matchAll(
      /(?:account\s*(?:number|no\.?|ending)|card\s*(?:number|ending)|(?:^|\n)number)\s*[:#]?\s*([•*xX\d][•*xX\d \-]{3,24})/gi,
    ),
  ].map((match) => match[1].replace(/\s|-/g, "").slice(-4));
  const ibans = [
    ...text.matchAll(/\bIBAN\s*[:#]?\s*([A-Z]{2}\d{2}[A-Z\d ]{10,30})/gi),
  ].map((match) => match[1].replace(/\s/g, "").slice(-4));
  const suffixes = [
    ...new Set(primaryAccounts.length ? primaryAccounts : ibans),
  ];
  // A statement may also print the issuer's receiving account in its payment
  // instructions. An established bank-reader identity or explicit user choice
  // can disambiguate those candidates; do not ask the same question forever.
  // A conflicting selection must never replace a unique printed identifier.
  const chosenIdentifier = options.account?.maskedAccountIdentifier;
  const chosenSuffix = chosenIdentifier?.replace(/\D/g, "").slice(-4);
  let identifier =
    suffixes.length === 1
      ? `•••• ${suffixes[0]}`
      : suffixes.length > 1
        ? chosenSuffix && suffixes.includes(chosenSuffix)
          ? `•••• ${chosenSuffix}`
          : undefined
        : chosenIdentifier;
  const membership = rows.find((row) => /membership number/i.test(row.text));
  if (!identifier && !suffixes.length && membership) {
    const label = membership.items.find((item) =>
      /membership number/i.test(item.text),
    )!;
    const next = rows.find(
      (row) =>
        row.page === membership.page &&
        row.y > membership.y &&
        row.y < membership.y + 35,
    );
    const value = next?.items.find(
      (item) =>
        Math.abs(item.x - label.x) < 20 && /^[x*•\d-]{8,25}$/i.test(item.text),
    );
    if (value) identifier = `•••• ${value.text.replace(/-/g, "").slice(-4)}`;
  }
  const metadata: StatementMetadata = {
    institution: options.institution ?? options.profile?.institution ?? "Other",
    accountIdentifier: identifier,
    accountType:
      options.profile?.accountTypeHint ??
      options.account?.accountType ??
      "current",
    currency,
    period,
    issuerText: rows
      .filter((row) => row.page === Math.min(...items.map((item) => item.page)))
      .slice(0, 3)
      .map((row) => row.text)
      .join(" "),
    profile: options.profile,
    ...options.evidence,
  };
  if (!currency) return metadata;
  const balanceSign = credit ? -1 : 1;
  const labels: [
    RegExp,
    keyof Pick<
      StatementMetadata,
      "openingBalance" | "closingBalance" | "printedMoneyIn" | "printedMoneyOut"
    >,
  ][] = [
    [
      /^(?:your )?(?:previous (?:closing )?balance|opening balance|start balance)\b/i,
      "openingBalance",
    ],
    [
      /^(?:your )?(?:new balance|closing balance|end balance)\b/i,
      "closingBalance",
    ],
    [/^(?:money in|paid in|total credits|new credits)\b/i, "printedMoneyIn"],
    [/^(?:money out|paid out|total debits|new debits)\b/i, "printedMoneyOut"],
  ];
  const withoutDate = (row: (typeof rows)[number]) =>
    row.items
      .filter((item) => !DATE_PATTERN.test(item.text.trim()))
      .map((item) => item.text)
      .join(" ");
  for (const [label, key] of labels) {
    if (metadata[key] !== undefined) continue;
    const matches = rows.filter(
      (row) =>
        label.test(withoutDate(row)) &&
        row.items.filter((item) => readMoney(item.text, currency) !== undefined)
          .length === 1,
    );
    const values = [
      ...new Set(
        matches
          .map((row) =>
            row.items
              .map((item) => readMoney(item.text, currency))
              .find((value) => value !== undefined)!,
          )
          .map((value) =>
            key === "openingBalance" || key === "closingBalance"
              ? value * balanceSign
              : Math.abs(value),
          ),
      ),
    ];
    if (values.length === 1) metadata[key] = values[0];
  }
  // Positional account summaries provide independently printed opening, gross movements and closing values.
  for (const row of rows) {
    const labels = row.items
      .map((item) => ({
        item,
        key: /previous closing balance|opening balance/i.test(item.text)
          ? "openingBalance"
          : /new credits|money in/i.test(item.text)
            ? "printedMoneyIn"
            : /new debits|money out/i.test(item.text)
              ? "printedMoneyOut"
              : /closing balance/i.test(item.text)
                ? "closingBalance"
                : undefined,
      }))
      .filter((entry) => entry.key);
    if (labels.length < 3) continue;
    const data = rows.find(
      (candidate) =>
        candidate.page === row.page &&
        candidate.y > row.y &&
        candidate.y < row.y + 65 &&
        candidate.items.filter(
          (item) => readMoney(item.text, currency) !== undefined,
        ).length === 4 &&
        !/^Total\b/i.test(candidate.text),
    );
    if (!data) continue;
    const amounts = data.items
      .filter((item) => readMoney(item.text, currency) !== undefined)
      .sort((a, b) => a.x - b.x);
    const ordered = [...labels].sort((a, b) => a.item.x - b.item.x);
    if (
      ordered.length === 3 &&
      ordered.every((entry) => entry.key !== "closingBalance")
    )
      ordered.push({
        item: { ...row.items.at(-1)!, x: Infinity },
        key: "closingBalance",
      });
    ordered.forEach((entry, index) => {
      const key = entry.key as
        | "openingBalance"
        | "closingBalance"
        | "printedMoneyIn"
        | "printedMoneyOut";
      const value = readMoney(amounts[index]?.text ?? "", currency);
      if (value !== undefined && metadata[key] === undefined)
        metadata[key] =
          key === "openingBalance" || key === "closingBalance"
            ? value * balanceSign
            : Math.abs(value);
    });
  }
  return metadata;
}
