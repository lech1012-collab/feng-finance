import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { annualCardFixture } from "../tests/barclaycard-annual";
import { reconstructRows } from "./layout";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { AnnualSummaryOnlyError } from "../parsers/barclaycard-annual";
import { prepareDraft, type ExtractedFile } from "./pipeline";
import { parseGenericStatement } from "./generic";

function annualSource(): ExtractedFile {
  const f = annualCardFixture();
  return {
    rows: reconstructRows(f.items),
    hash: "fictional-annual-card",
    filename: "fictional-annual.pdf",
    method: "embedded-text",
    warnings: [],
    extraction: {
      ...f,
      quality: [],
      pageCount: 2,
      completedPages: [1, 2],
      unreadPages: [],
      cancelled: false,
      method: "text",
    },
  };
}
beforeEach(async () => {
  await clearLocalData();
  await initializeDatabase();
});
afterAll(async () => {
  await db.delete();
});

describe("annual summary import safeguards", () => {
  it("keeps printed dates and totals in a preview without creating transaction or balance records", async () => {
    const file = annualSource();
    await expect(prepareDraft(file)).rejects.toBeInstanceOf(
      AnnualSummaryOnlyError,
    );
    expect(file.summary).toMatchObject({
      period: { start: "2025-09-01", end: "2026-08-31" },
      statementDate: "2026-09-04",
    });
    expect(file.generic).toBeUndefined();
    expect(await db.accounts.count()).toBe(0);
    expect(await db.statements.count()).toBe(0);
    expect(await db.transactions.count()).toBe(0);
  });
  it("cannot be turned into transactions by supplying manual dates or requesting generic recovery", async () => {
    const file = annualSource();
    await expect(
      prepareDraft(
        file,
        "Barclays",
        undefined,
        { start: "2026-01-01", end: "2026-12-31" },
        [],
        undefined,
        { preferGeneric: true },
      ),
    ).rejects.toThrow(/annual summary contains totals/);
    expect(file.summary?.period).toEqual({
      start: "2025-09-01",
      end: "2026-08-31",
    });
    expect(await db.transactions.count()).toBe(0);
  });
  it("does not offer source corrections for aggregate amounts in the generic API", () => {
    const f = annualCardFixture();
    const result = parseGenericStatement(f.items, f.pages, {
      period: { start: "2025-09-01", end: "2026-08-31" },
      actions: {
        fabricated: {
          kind: "correct",
          date: "2026-08-31",
          description: "FICTIONAL TOTAL",
          amount: -321045,
        },
      },
    });
    expect(result.status).toBe("summary-only");
    expect(result.errorCode).toBe("summary-only");
    expect(result.parsed).toBeUndefined();
    expect(result.rowChecks).toEqual([]);
    expect(result.table.rows).toEqual([]);
    expect(result.candidates).toEqual([]);
    expect(result.summary?.period).toEqual({
      start: "2025-09-01",
      end: "2026-08-31",
    });
  });
  it("does not auto-exclude a partial document that could contain an unread ledger", async () => {
    const file = annualSource();
    file.extraction!.unreadPages = [3];
    file.extraction!.pageCount = 3;
    file.extraction!.cancelled = true;
    const read = vi.fn();
    file.pdfSession = { readCells: read } as unknown as NonNullable<
      ExtractedFile["pdfSession"]
    >;
    try {
      await prepareDraft(file, undefined, undefined, undefined, [], undefined, {
        skipCellOcr: true,
      });
    } catch (cause) {
      expect(cause).not.toBeInstanceOf(AnnualSummaryOnlyError);
    }
    expect(file.summary).toBeUndefined();
    expect(file.generic?.errorCode).not.toBe("summary-only");
    expect(read).not.toHaveBeenCalled();
    expect(await db.transactions.count()).toBe(0);
  });
});
