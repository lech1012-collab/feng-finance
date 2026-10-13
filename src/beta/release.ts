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
  date: "2026-10-13",
  points: [
    "Barclays, Barclaycard, Amex and Revolut use their validated bank readers automatically.",
    "Familiar statements no longer need repeated amount confirmation.",
    "Unfamiliar or changed layouts keep column mapping and source review.",
  ],
  pleaseTest: [
    "Import a familiar statement and check its summary before confirming.",
    "Try another bank's statement and check its source review.",
  ],
  betaRound: 1,
  mainTask: "Import one month of statements and categorise everything.",
};

export const RELEASE_HISTORY: readonly ReleaseNotes[] = [
  CURRENT_RELEASE,
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
