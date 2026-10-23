import { APP_VERSION } from "../domain/models";

export interface ReleaseNotes {
  version: string;
  date: string;
  points: readonly string[];
  pleaseTest: readonly string[];
  betaRound: number;
  mainTask: string;
}

// Keep this version aligned with APP_VERSION and the release tag.
export const CURRENT_RELEASE: ReleaseNotes = {
  version: APP_VERSION,
  date: "2026-10-23",
  points: [
    "Category averages use a consistent set of category accounts, so unrelated incomplete accounts do not block them.",
    "See exactly which previous months qualify for the average and why others are excluded.",
    "Category charts show every month used by the average, plus the selected month.",
  ],
  pleaseTest: [
    "Open a category with three or more complete previous months and check its average and standard deviation.",
    "Open Months used for comparison and check the accounts, included months and any missing date or amount checks.",
  ],
  betaRound: 1,
  mainTask: "Import one month of statements and categorise everything.",
};

export const RELEASE_HISTORY: readonly ReleaseNotes[] = [
  CURRENT_RELEASE,
  {
    version: "2.2.10",
    date: "2026-10-19",
    points: [
      "Tap a transaction amount to type a correction in one stable editor.",
      "Change tabs and return to the same import review without selecting PDFs again.",
      "Source descriptions and filenames wrap within stationary mobile cards.",
    ],
    pleaseTest: [
      "Select several PDFs, visit Transactions, then use Import to resume your review.",
      "Tap an unread or uncertain amount and type a correction with your phone keyboard.",
    ],
    betaRound: 1,
    mainTask: "Import one month of statements and categorise everything.",
  },
  {
    version: "2.2.9",
    date: "2026-10-19",
    points: [
      "Correct uncertain transaction amounts in a fixed editing panel.",
      "Choose Money in or Money out without typing a minus sign.",
      "Reach source correction directly from a bank-reader transaction.",
    ],
    pleaseTest: [
      "Correct an uncertain amount, save it and check the statement balance.",
      "Try the editor on your phone with the keyboard open and larger text.",
    ],
    betaRound: 1,
    mainTask: "Import one month of statements and categorise everything.",
  },
  {
    version: "2.2.8",
    date: "2026-10-19",
    points: [
      "Select several statements and add more without losing your review choices.",
      "Review one exception at a time, then confirm the whole batch.",
      "Clearer mobile statement details, with financial checks kept in place.",
    ],
    pleaseTest: [
      "Import several PDFs, add another selection and review any flagged statements.",
      "Try small screens, larger text and offline importing.",
    ],
    betaRound: 1,
    mainTask: "Import one month of statements and categorise everything.",
  },
  {
    version: "2.2.7",
    date: "2026-10-15",
    points: [
      "Clearer screens and consistent controls at small sizes and large text.",
      "Confirm similar recurring bills, with Undo and local saved decisions.",
      "Review PDF figures before opening column mapping.",
    ],
    pleaseTest: [
      "Import, sort transactions and save a protected backup.",
      "Review small screens, large text and keyboard navigation.",
    ],
    betaRound: 1,
    mainTask: "Import one month of statements and categorise everything.",
  },
  {
    version: "2.2.6",
    date: "2026-10-14",
    points: [
      "A calmer mobile layout, focused Settings and editing sheets with Undo.",
      "One password-protected backup flow and clearer account balances.",
      "Safer refund suggestions, debt plans and missing-rate information.",
    ],
    pleaseTest: [
      "Import, sort transactions and save a protected backup.",
      "Review small screens, large text and keyboard navigation.",
    ],
    betaRound: 1,
    mainTask: "Import one month of statements and categorise everything.",
  },
  {
    version: "2.2.5",
    date: "2026-10-13",
    points: [
      "The optional property tax report switch now saves reliably.",
      "Statement readers and saved financial records are unchanged.",
    ],
    pleaseTest: ["Enable property tax summary in Settings, then open Analyse."],
    betaRound: 1,
    mainTask: "Import one month of statements and categorise everything.",
  },
  {
    version: "2.2.4",
    date: "2026-10-13",
    points: [
      "Short account, category and report links are easier to tap on mobile.",
      "Currency notices and monthly review stay readable with larger text.",
    ],
    pleaseTest: ["Review narrow screens and larger text."],
    betaRound: 1,
    mainTask: "Import one month of statements and categorise everything.",
  },
  {
    version: "2.2.3",
    date: "2026-10-13",
    points: [
      "Barclaycard, Amex and Revolut are recognised independently of the generic parser.",
      "Supported digital statements open a simple review without repeated amount checks.",
      "Other banks keep generic review; Reading options opens layout correction when needed.",
    ],
    pleaseTest: [
      "Import a familiar statement and check its summary before confirming.",
      "Try another bank's statement and check its source review.",
    ],
    betaRound: 1,
    mainTask: "Import one month of statements and categorise everything.",
  },
  {
    version: "2.2.2",
    date: "2026-10-13",
    points: [
      "Restored bank readers for layouts also proved by the generic reader.",
      "Improved Barclays wrapped-footer handling and source correction checks.",
    ],
    pleaseTest: [
      "Import a familiar statement and check its summary before confirming.",
    ],
    betaRound: 1,
    mainTask: "Import one month of statements and categorise everything.",
  },
  {
    version: "2.2.1",
    date: "2026-10-12",
    points: ["What's new closes reliably after you acknowledge an update."],
    pleaseTest: [
      "Update from Home, read What's new and dismiss it once.",
      "Check that your accounts and transactions remain available offline.",
    ],
    betaRound: 1,
    mainTask: "Import one month of statements and categorise everything.",
  },
  {
    version: "2.2.0",
    date: "2026-10-12",
    points: [
      "Clear installation guidance and a private beta introduction.",
      "PDF tables are checked against their own balances and totals.",
      "Review difficult rows and save a layout for next month's statement.",
      "Local safety backups protect data before database updates.",
      "Send feedback with technical details and optional redacted diagnostics.",
    ],
    pleaseTest: [
      "Install Feng, explore the demo, then import one month of statements.",
      "Categorise every transaction and confirm an internal transfer.",
      "Save and restore a backup; update only when the Home banner appears.",
    ],
    betaRound: 1,
    mainTask: "Import one month of statements and categorise everything.",
  },
];
