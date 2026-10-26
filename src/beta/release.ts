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
  date: "2026-10-26",
  points: [
    "Tap the status on Home’s This month card for coverage details; the separate warning icon is removed.",
  ],
  pleaseTest: [
    "Tap Partial on Home, close the explanation and check that your figures stay unchanged.",
  ],
  betaRound: 1,
  mainTask: "Import one month of statements and categorise everything.",
};

export const RELEASE_HISTORY: readonly ReleaseNotes[] = [
  CURRENT_RELEASE,
  {
    version: "2.2.27",
    date: "2026-10-26",
    points: [
      "Activity category names use their category colour as plain text, without a dot or surrounding pill.",
      "Category labels wrap on small screens and keep readable contrast in light mode.",
    ],
    pleaseTest: [
      "Check category labels in Activity on your phone and switch between light and dark appearance.",
    ],
    betaRound: 1,
    mainTask: "Import one month of statements and categorise everything.",
  },
  {
    version: "2.2.26",
    date: "2026-10-26",
    points: [
      "Home has one account overview link, with cash and card debt keeping their filtered transaction views.",
      "Pots, recurring price changes and reminders have one clear action instead of repeated links.",
      "Home keeps a single monthly import action and a single uncategorised count in its spending card.",
    ],
    pleaseTest: [
      "Tap the account count on Home, then check that Cash and Card debt still open the right transactions.",
      "Open pots and recurring price changes from their single review links.",
    ],
    betaRound: 1,
    mainTask: "Import one month of statements and categorise everything.",
  },
  {
    version: "2.2.25",
    date: "2026-10-25",
    points: [
      "Tap a nearby question mark for explanations, without long sections filling the page.",
      "Warning symbols open supporting details while important statuses and actions stay beside your figures.",
      "Contextual help works offline and stays within an editor when one is already open.",
    ],
    pleaseTest: [
      "Open the help beside a chart or setting, close it and continue where you left off.",
      "Check warning details on your phone with larger text.",
    ],
    betaRound: 1,
    mainTask: "Import one month of statements and categorise everything.",
  },
  {
    version: "2.2.24",
    date: "2026-10-25",
    points: [
      "Category charts show average monthly spending and monthly variation as separate values.",
      "The chart explanation describes the average line and variation band in plain language.",
    ],
    pleaseTest: [
      "Open a category in Analyse and check the average and variation labels on your phone.",
    ],
    betaRound: 1,
    mainTask: "Import one month of statements and categorise everything.",
  },
  {
    version: "2.2.23",
    date: "2026-10-24",
    points: [
      "Already categorised payments no longer need a second manual review.",
      "Home separates missing categories from refunds, splits and source checks that need a decision.",
      "Sorting skips completed rule matches and updates as you categorise payments.",
    ],
    pleaseTest: [
      "Check Home after importing or applying rules: only unresolved payments should need attention.",
      "Categorise a payment and check that it disappears from the sorting queue without another review button.",
    ],
    betaRound: 1,
    mainTask: "Import one month of statements and categorise everything.",
  },
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
