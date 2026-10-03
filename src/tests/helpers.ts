import type {
  Account,
  Transaction,
  PageTextItem,
  TextRow,
} from "../domain/models";
import { reconstructRows } from "../import/layout";
export function transaction(patch: Partial<Transaction> = {}): Transaction {
  return {
    id: "t1",
    accountId: "a1",
    statementId: "s1",
    date: "2026-09-01",
    description: "WAITROSE",
    merchant: "WAITROSE",
    amount: -1000,
    currency: "GBP",
    type: "expense",
    tags: [],
    sourcePage: 1,
    extractionConfidence: 1,
    transactionFingerprint: "fp1",
    occurrence: 0,
    isTransfer: false,
    isReviewed: true,
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
    ...patch,
  };
}
export const accounts: Account[] = [
  {
    id: "a1",
    institution: "Barclays",
    displayName: "Current",
    accountType: "current",
    currency: "GBP",
    maskedAccountIdentifier: "•••• 4321",
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
  },
  {
    id: "a2",
    institution: "Revolut",
    displayName: "Travel",
    accountType: "current",
    currency: "GBP",
    maskedAccountIdentifier: "•••• 9002",
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
  },
  {
    id: "a3",
    institution: "American Express",
    displayName: "Card",
    accountType: "credit",
    currency: "GBP",
    maskedAccountIdentifier: "•••• 1008",
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
  },
];
export function rows(lines: [number, string][][]): TextRow[] {
  return reconstructRows(
    lines.flatMap((line, index) =>
      line.map(([x, text]) => ({
        text,
        x,
        y: 50 + index * 20,
        width: text.length * 5,
        height: 10,
        page: 1,
      })),
    ),
  );
}
export function bankRows(bank = "Barclays"): TextRow[] {
  return rows([
    [[30, bank]],
    [[30, "Account statement"]],
    [[30, "Statement period: 01 Sep 2026 to 30 Sep 2026"]],
    [
      [
        30,
        bank === "American Express"
          ? "Card ending: 1008"
          : "Account number: 12344321",
      ],
    ],
    [[30, "Currency: GBP"]],
    [
      [
        30,
        bank === "American Express" ? "Previous balance" : "Opening balance",
      ],
      [550, "1,000.00"],
    ],
    bank === "American Express"
      ? [
          [30, "Date"],
          [140, "Description"],
          [550, "Amount"],
        ]
      : [
          [30, "Date"],
          [140, "Description"],
          [380, "Money out"],
          [460, "Money in"],
          [550, "Balance"],
        ],
    [
      [30, "01 Sep"],
      [140, "JOHN LEWIS"],
      [380, "120.50"],
      [550, "879.50"],
    ],
    [[140, "LONDON STORE"]],
    [
      [30, "02 Sep"],
      [140, "SIEMENS SALARY"],
      [460, "5,000.00"],
      [550, "5,879.50"],
    ],
    [
      [30, "03 Sep"],
      [140, "WAITROSE"],
      [380, "10.00"],
      [550, "5,869.50"],
    ],
    [
      [30, "03 Sep"],
      [140, "WAITROSE"],
      [380, "10.00"],
      [550, "5,859.50"],
    ],
    [
      [30, "Closing balance"],
      [550, "5,859.50"],
    ],
  ]);
}
