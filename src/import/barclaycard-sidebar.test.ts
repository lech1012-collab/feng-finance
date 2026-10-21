import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { sidebarCardFixture } from "../tests/barclaycard-sidebar";
import { reconstructRows } from "./layout";
import {
  prepareDraft,
  draftReconciliation,
  commitDraft,
  validateDraft,
  type ExtractedFile,
} from "./pipeline";
import * as generic from "./generic";
import { fieldCorrections } from "./generic/review-decision";

function source(unread = false): ExtractedFile {
  const fixture = sidebarCardFixture(unread);
  return {
    rows: reconstructRows(
      fixture.items.map((item) => ({ ...item, y: item.y + item.height })),
    ),
    hash: `fictional-card-sidebar-${unread}`,
    filename: "fictional-card-sidebar.pdf",
    method: "embedded-text",
    warnings: [],
    extraction: {
      items: fixture.items,
      pages: fixture.pages,
      quality: [],
      pageCount: 4,
      completedPages: [1, 2, 3, 4],
      unreadPages: [],
      cancelled: false,
      method: "text",
    },
  };
}
beforeEach(async () => {
  vi.restoreAllMocks();
  await clearLocalData();
  await initializeDatabase();
});
afterAll(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

describe("single-ledger Barclaycard import through the real review pipeline", () => {
  it("selects the native reader and imports every posted row with no transaction corrections", async () => {
    const fallback = vi.spyOn(generic, "parseGenericStatement");
    const draft = await prepareDraft(source());
    expect(fallback).not.toHaveBeenCalled();
    expect(draft.parserFallback).toBe(true);
    expect(draft.parserReview).toBeUndefined();
    expect(draft.bankSource?.reconciledExactly).toBe(true);
    expect(draft.statement.rowsNeedingReview).toBe(0);
    expect(draft.statement.rowsTotalChecked).toBe(23);
    expect(draft.transactions).toHaveLength(23);
    expect(draft.warnings).toEqual([]);
    expect(() => validateDraft(draft, false)).not.toThrow();
    expect(await db.transactions.count()).toBe(0);
    await commitDraft(draft);
    expect(await db.transactions.count()).toBe(23);
    expect(await db.statements.count()).toBe(1);
  });
  it("hands off a genuine unread amount to one source correction and keeps exact reconciliation required", async () => {
    const file = source(true);
    const native = await prepareDraft(file);
    expect(native.transactions).toHaveLength(22);
    expect(draftReconciliation(native).status).toBe("warning");
    expect(() => validateDraft(native, false)).toThrow();
    const draft = await prepareDraft(
      file,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      { preferGeneric: true, skipCellOcr: true },
    );
    expect(draft.parserReview?.rowChecks).toHaveLength(23);
    const corrections = fieldCorrections(draft.parserReview!.rowChecks);
    expect(corrections).toHaveLength(1);
    expect(() => validateDraft(draft, false)).toThrow();
    expect(await db.transactions.count()).toBe(0);
    const corrected = await prepareDraft(
      file,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      {
        preferGeneric: true,
        skipCellOcr: true,
        actions: {
          [corrections[0].rowId]: {
            kind: "correct",
            date: "2026-09-06",
            description: "FICTIONAL BEAUTY SHOP",
            amount: -2300,
          },
        },
      },
    );
    expect(fieldCorrections(corrected.parserReview!.rowChecks)).toHaveLength(0);
    expect(draftReconciliation(corrected)).toMatchObject({
      status: "reconciled",
      difference: 0,
    });
    expect(corrected.transactions).toHaveLength(23);
    expect(() => validateDraft(corrected, false)).not.toThrow();
    await commitDraft(corrected);
    expect(await db.transactions.count()).toBe(23);
  });
});
