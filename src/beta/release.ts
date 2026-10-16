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
};

export const RELEASE_HISTORY: readonly ReleaseNotes[] = [
  CURRENT_RELEASE,
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
