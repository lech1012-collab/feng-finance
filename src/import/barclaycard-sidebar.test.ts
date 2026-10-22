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
import { BarclaycardStatementParser } from "../parsers/barclaycard";

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
  it("keeps the first ledger date even when its unread amount was omitted by the native reader", async () => {
    const file = source();
    file.extraction!.items = file.extraction!.items.filter(
      (item) => !item.text.startsWith("Statement period:"),
    );
    file.extraction!.items.find(
      (item) => item.page === 2 && item.y === 202 && item.text === "£3.50",
    )!.text = "£?.??";
    file.rows = reconstructRows(file.extraction!.items);
    const native = await prepareDraft(file);
    expect(native.statement.statementPeriodStart).toBe("2026-09-03");
    const review = { preferGeneric: true, skipCellOcr: true };
    const recovered = await prepareDraft(
      file,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      review,
    );
    expect(recovered.statement).toMatchObject({
      statementPeriodStart: "2026-09-02",
      periodSource: "transaction-coverage",
    });
    const correction = fieldCorrections(recovered.parserReview!.rowChecks);
    expect(correction).toHaveLength(1);
    const corrected = await prepareDraft(
      file,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      {
        ...review,
        actions: {
          [correction[0].rowId]: {
            kind: "correct",
            date: "2026-09-02",
            amount: -350,
            description: "FICTIONAL PURCHASE 1",
          },
        },
      },
    );
    expect(fieldCorrections(corrected.parserReview!.rowChecks)).toHaveLength(0);
    expect(draftReconciliation(corrected)).toMatchObject({
      status: "reconciled",
      difference: 0,
    });
    expect(corrected.statement).toMatchObject({
      statementPeriodStart: "2026-09-02",
      statementPeriodEnd: "2026-10-04",
      periodSource: "transaction-coverage",
    });
  });
  it("keeps issue-date coverage when native transaction parsing cannot finish", async () => {
    const file = source();
    file.extraction!.items = file.extraction!.items.filter(
      (item) => !item.text.startsWith("Statement period:"),
    );
    file.rows = reconstructRows(file.extraction!.items);
    vi.spyOn(BarclaycardStatementParser.prototype, "parse").mockImplementation(
      () => {
        throw new Error("Native transaction layout could not be read.");
      },
    );
    const draft = await prepareDraft(
      file,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      { skipCellOcr: true },
    );
    expect(draft.parserFallback).toBe(false);
    expect(draft.statement).toMatchObject({
      statementPeriodStart: "2026-09-02",
      statementPeriodEnd: "2026-10-04",
      statementDate: "2026-10-04",
      periodSource: "transaction-coverage",
    });
    expect(draft.transactions).toHaveLength(23);
    expect(fieldCorrections(draft.parserReview!.rowChecks)).toHaveLength(0);
    expect(draftReconciliation(draft)).toMatchObject({
      status: "reconciled",
      difference: 0,
    });
    expect(draft.warnings).toEqual([
      expect.stringContaining("no period start"),
    ]);
    expect(() =>
      validateDraft({ ...draft, reviewedWarnings: true }, false),
    ).not.toThrow();
  });
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
