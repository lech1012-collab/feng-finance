import { describe, expect, it } from "vitest";
import { backupErrorMessage } from "./backup-error";
import { validateBackup } from "./backup";

const emptyBackup = {
  format: "feng-finance",
  version: 1,
  schemaVersion: 2,
  moneyUnit: "minor",
  exportedAt: "2026-10-08T09:00:00.000Z",
  accounts: [],
  statements: [],
  transactions: [],
  categories: [],
  rules: [],
  transferLinks: [],
  settings: [],
};

function validationMessage(input: unknown): string {
  try {
    validateBackup(input);
    throw new Error("The fixture must fail validation.");
  } catch (error) {
    return backupErrorMessage(error);
  }
}

describe("safe, actionable backup errors", () => {
  it("explains malformed JSON without reproducing imported text", () => {
    const message = backupErrorMessage(
      new SyntaxError('Unexpected token in "PRIVATE ACCOUNT 12345678"'),
    );
    expect(message).toContain("not valid JSON");
    expect(message).toContain("existing data has not been changed");
    expect(message).not.toContain("PRIVATE");
  });

  it("replaces large schema dumps with a supported-backup explanation", () => {
    const message = validationMessage({
      description: "PRIVATE MERCHANT",
      format: "another-product",
    });
    expect(message).toContain("not a supported Feng Finance backup");
    expect(message).toContain("Choose a JSON file exported");
    expect(message).not.toMatch(/PRIVATE|invalid_value|expected|\[|\{/);
    expect(message.length).toBeLessThan(250);
  });

  it.each([{ version: 2 }, { schemaVersion: 99 }])(
    "distinguishes an unsupported version: %j",
    (change) => {
      const message = validationMessage({ ...emptyBackup, ...change });
      expect(message).toContain("backup version is not supported");
      expect(message).toContain("Update Feng Finance");
    },
  );

  it("distinguishes incompatible amount units without suggesting conversion", () => {
    const message = validationMessage({ ...emptyBackup, moneyUnit: "major" });
    expect(message).toContain("unsupported amount format");
    expect(message).toContain("do not change or convert its amounts");
  });

  it("explains invalid financial references without weakening validation", () => {
    const message = validationMessage({
      ...emptyBackup,
      statements: [
        {
          id: "synthetic-statement",
          institution: "Barclays",
          accountId: "missing-account",
          statementPeriodStart: "2026-09-01",
          statementPeriodEnd: "2026-09-30",
          currency: "GBP",
          sourceFilename: "PRIVATE.pdf",
          sourceFileHash: "synthetic-hash",
          importedAt: emptyBackup.exportedAt,
          parserVersion: "synthetic-test",
          extractionMethod: "embedded-text",
          validationStatus: "unavailable",
          transactionCount: 0,
          warnings: [],
        },
      ],
    });
    expect(message).toContain("inconsistent or missing financial records");
    expect(message).toContain("cannot be restored safely");
    expect(message).not.toContain("PRIVATE");
  });

  it("gives storage recovery guidance while hiding browser diagnostics", () => {
    const error = Object.assign(new Error("PRIVATE STORAGE CONTENTS"), {
      name: "QuotaExceededError",
    });
    const message = backupErrorMessage(error, "restore");
    expect(message).toContain("not enough device storage");
    expect(message).toContain("without clearing Feng's site data");
    expect(message).not.toContain("PRIVATE");
    expect(backupErrorMessage(new Error("PRIVATE"), "restore")).toContain(
      "Close other Feng Finance tabs",
    );
    expect(backupErrorMessage(new Error("PRIVATE"), "restore")).not.toContain(
      "PRIVATE",
    );
  });

  it("preserves the file-size limit with an actionable explanation", () => {
    expect(
      backupErrorMessage(new Error("Backup exceeds the 50 MB limit.")),
    ).toContain("exceeds the 50 MB file limit");
  });

  it("distinguishes an unreadable local file from an invalid backup format", () => {
    const error = Object.assign(new Error("PRIVATE FILE DETAILS"), {
      name: "NotReadableError",
    });
    const message = backupErrorMessage(error);
    expect(message).toContain("file could not be read");
    expect(message).toContain("Save or download it locally");
    expect(message).toContain("existing data has not been changed");
    expect(message).not.toMatch(/PRIVATE|not a supported/);
  });
});
