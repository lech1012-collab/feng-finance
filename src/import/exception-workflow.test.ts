import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { largeCardFixture } from "../tests/large-card";
import { reconstructRows } from "./layout";
import { prepareDraft, validateDraft } from "./pipeline";
import { guidedReviewStep } from "./guided-review";
import { importBlockers, type FileReview } from "./review-model";

beforeEach(async () => {
  await clearLocalData();
  await initializeDatabase();
});
afterAll(async () => {
  await db.delete();
});
async function entry(
  mode: Parameters<typeof largeCardFixture>[0],
): Promise<FileReview> {
  const source = largeCardFixture(mode);
  const extracted = {
    filename: "fictional-large-card.pdf",
    hash: `large-${mode}`,
    method: "embedded-text" as const,
    warnings: [],
    rows: reconstructRows(
      source.items.map((item) => ({ ...item, y: item.y + item.height })),
    ),
    extraction: {
      ...source,
      method: "text" as const,
      quality: [],
      pageCount: source.pages.length,
      completedPages: source.pages.map((p) => p.page),
      unreadPages: [],
      cancelled: false,
    },
  };
  const draft = await prepareDraft(
    extracted,
    undefined,
    undefined,
    undefined,
    [],
    undefined,
    { preferGeneric: true, skipCellOcr: true },
  );
  return {
    id: "large-card",
    file: new File([], extracted.filename),
    extracted,
    draft,
    state: "review",
    progress: "",
    error: "",
    bank: "",
    accountId: "",
    periodStart: "",
    periodEnd: "",
    manualPeriod: false,
    optionsChanged: false,
    override: false,
    skip: false,
    open: true,
    showAll: false,
    invalidAmounts: [],
  };
}
describe("large-statement exception workflow and financial gates", () => {
  it("accepts 133 reconciled readable rows without a correction queue", async () => {
    const e = await entry("exact");
    expect(e.draft!.transactions).toHaveLength(133);
    expect(guidedReviewStep(e).kind).toBe("complete");
    expect(importBlockers(e)).toEqual([]);
    expect(() => validateDraft(e.draft!, false)).not.toThrow();
    expect(await db.transactions.count()).toBe(0);
  });
  it("shows one totals task for a 1p discrepancy, with zero forced transaction edits", async () => {
    const e = await entry("difference");
    expect(e.draft!.transactions).toHaveLength(133);
    expect(guidedReviewStep(e).kind).toBe("validation");
    expect(importBlockers(e).length).toBeGreaterThan(0);
    expect(() => validateDraft(e.draft!, false)).toThrow();
    expect(await db.transactions.count()).toBe(0);
  });
  it.each(["amount", "date"] as const)(
    "only asks for the one unread %s",
    async (mode) => {
      const e = await entry(mode);
      const step = guidedReviewStep(e);
      expect(step.kind).toBe("source-row");
      if (step.kind !== "source-row")
        throw new Error("Expected one correction");
      expect(step.remaining).toBe(1);
      expect(step.row.readings[0].description).toBe("FICTIONAL PURCHASE 72");
      expect(() => validateDraft(e.draft!, true)).toThrow(
        /invalid date, amount or description/,
      );
    },
  );
  it("stops a systemic layout failure before opening 133 input panels", async () => {
    const e = await entry("layout");
    expect(guidedReviewStep(e)).toEqual({ kind: "layout", count: 133 });
    expect(guidedReviewStep(e, true).kind).toBe("source-row");
    expect(importBlockers({ ...e, override: true }).length).toBeGreaterThan(0);
    expect(() => validateDraft(e.draft!, true)).toThrow();
  });
});
