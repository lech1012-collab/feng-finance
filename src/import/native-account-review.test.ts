import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { knownBankItems } from "../tests/known-bank-layouts";
import { reconstructRows } from "./layout";
import {
  prepareDraft,
  draftReconciliation,
  validateDraft,
  type ExtractedFile,
} from "./pipeline";
import { preparePdfReading } from "./pdf-review";
import { guidedReviewStep } from "./guided-review";
import type { FileReview } from "./review-model";
import type { Account } from "../domain/models";

beforeEach(async () => {
  await clearLocalData();
  await initializeDatabase();
});
afterAll(async () => {
  await db.delete();
});
function source(missing = true): ExtractedFile {
  const items = knownBankItems("barclaycard")
    .filter((item) => !missing || !item.text.startsWith("Number "))
    .map((item) => ({ ...item, parseSource: "text" as const, fontSize: 8 }));
  const pages = [1, 2].map((page) => ({
    page,
    width: 600,
    height: 842,
    rotation: 0,
  }));
  return {
    rows: reconstructRows(
      items.map((item) => ({ ...item, y: item.y + item.height })),
    ),
    hash: "fictional-native-account",
    filename: "fictional-card.pdf",
    method: "embedded-text",
    warnings: [],
    extraction: {
      items,
      pages,
      quality: [],
      pageCount: 2,
      completedPages: [1, 2],
      unreadPages: [],
      cancelled: false,
      method: "text",
    },
  };
}
const account: Account = {
  id: "card-4444",
  institution: "Barclays",
  displayName: "Credit card",
  accountType: "credit",
  currency: "GBP",
  maskedAccountIdentifier: "•••• 4444",
  createdAt: "2026-10-20T00:00:00Z",
  updatedAt: "2026-10-20T00:00:00Z",
};
describe("native card identity recovery", () => {
  it("asks for card identity once while preserving the unverified-source safeguard", async () => {
    const file = source();
    await expect(prepareDraft(file)).rejects.toThrow(
      "Account identifier could not be read",
    );
    expect(file.generic).toBeUndefined();
    expect(file.accountSelection).toEqual({
      institution: "Barclays",
      accountType: "credit",
      currency: "GBP",
    });
    const entry: FileReview = {
      id: "credit",
      file: new File([], "fictional-card.pdf"),
      state: "error",
      progress: "",
      extracted: file,
      error: "Account identifier could not be read.",
      bank: "",
      accountId: "",
      manualPeriod: false,
      periodStart: "",
      periodEnd: "",
      optionsChanged: false,
      override: false,
      skip: false,
      open: true,
      showAll: false,
      invalidAmounts: [],
    };
    expect(guidedReviewStep(entry).kind).toBe("identity");
    const draft = await prepareDraft(file, undefined, account);
    expect(file.accountSelection).toBeUndefined();
    expect(draft.account).toMatchObject(account);
    expect(draft.bankSource).toBeDefined();
    expect(draft.parserReview).toBeUndefined();
    expect(draft.statement.rowsNeedingReview).toBe(6);
    expect(draft.transactions).toHaveLength(6);
    expect(draft.warnings).toContain(
      "The statement account, dates or currency require review.",
    );
    expect(draft.bankSource?.reconciledExactly).toBe(false);
    expect(() => validateDraft(draft, false)).toThrow(/review|reconciliation/i);
    expect(guidedReviewStep({ ...entry, draft, state: "review" }).kind).toBe(
      "account-confirmation",
    );
    expect(draftReconciliation(draft)).toMatchObject({
      status: "warning",
      difference: 0,
      reported: -10968,
    });
    expect(await db.accounts.count()).toBe(0);
    expect(await db.transactions.count()).toBe(0);
  });
  it.each([
    { currency: "EUR" },
    { accountType: "current" as const },
    { institution: "Revolut" as const },
  ])(
    "rejects an account with mismatched bank, currency or type: %j",
    async (change) => {
      await expect(
        prepareDraft(source(), "Barclays", { ...account, ...change }),
      ).rejects.toThrow(/does not match/);
      expect(await db.transactions.count()).toBe(0);
    },
  );
  it("never replaces a printed identifier with a selected account identifier", async () => {
    const reading = await preparePdfReading(source(false), "Barclays", {
      ...account,
      maskedAccountIdentifier: "•••• 9999",
    });
    expect(reading.parsed.accountIdentifier).toBe("•••• 4444");
    expect(reading.parsed.closingBalance).toBe(-10968);
  });
});
