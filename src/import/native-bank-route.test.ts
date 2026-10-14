import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { getParser } from "../parsers";
import { reconstructRows } from "./layout";
import { genericFixture } from "./generic/fixtures";
import * as genericApi from "./generic";
import {
  commitDraft,
  draftReconciliation,
  prepareDraft,
  validateDraft,
  type ExtractedFile,
} from "./pipeline";
import type { PdfImportSession } from "./pdf-session-types";
import generatedCard from "../tests/synthetic-barclaycard-pdf-text.json";

function source(kind: "T1" | "T4" | "T5GBP" | "T6"): ExtractedFile {
  const fixture = genericFixture(kind);
  if (kind === "T5GBP") fixture.items[0].text = "Revolut Account statement";
  return {
    rows: reconstructRows(
      fixture.items.map((item) => ({ ...item, y: item.y + item.height })),
    ),
    hash: `native-route-${kind}`,
    filename: "fictitious.pdf",
    method: "embedded-text",
    warnings: [],
    extraction: {
      ...fixture,
      quality: [],
      pageCount: fixture.pages.length,
      completedPages: fixture.pages.map((page) => page.page),
      unreadPages: [],
      cancelled: false,
      method: "text",
    },
  };
}

function cardSource(): ExtractedFile {
  const items = generatedCard.items.map((item) => ({
    ...item,
    parseSource: "text" as const,
  }));
  return {
    rows: reconstructRows(
      items.map((item) => ({ ...item, y: item.y + item.height })),
    ),
    hash: "native-route-two-panel-card",
    filename: "fictitious-card.pdf",
    method: "embedded-text",
    warnings: [],
    extraction: {
      items,
      pages: generatedCard.pages,
      quality: [],
      pageCount: generatedCard.pages.length,
      completedPages: generatedCard.pages.map((page) => page.page),
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

describe("supported bank readers precede generic inference", () => {
  it("flags future statement periods and requires explicit acknowledgement even when the figures reconcile", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2025-01-13T12:00:00Z"));
    try {
      const draft = await prepareDraft(source("T1"));
      expect(
        draft.warnings.some((warning) =>
          warning.includes("ends in the future"),
        ),
      ).toBe(true);
      expect(() => validateDraft(draft, false)).toThrow(/Acknowledge/);
      draft.reviewedWarnings = true;
      expect(() => validateDraft(draft, false)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    ["T1", "Barclays", "current", 3],
    ["T4", "American Express", "credit", 2],
    ["T5GBP", "Revolut", "current", 3],
  ] as const)(
    "recognises %s without needing a generic profile or a second amount reading",
    async (kind, institution, accountType, count) => {
      const file = source(kind);
      const readCells = vi.fn().mockRejectedValue(new Error("Unexpected OCR"));
      file.pdfSession = { readCells } as unknown as PdfImportSession;
      const profile = vi.spyOn(genericApi, "detectProfile");
      const generic = vi.spyOn(genericApi, "parseGenericStatement");
      const draft = await prepareDraft(file);
      expect(profile).not.toHaveBeenCalled();
      expect(generic).not.toHaveBeenCalled();
      expect(readCells).not.toHaveBeenCalled();
      expect(draft.account).toMatchObject({ institution, accountType });
      expect(draft.parserFallback).toBe(true);
      expect(draft.parserReview).toBeUndefined();
      expect(draft.transactions).toHaveLength(count);
      expect(
        draft.transactions.every((row) => row.extractionConfidence >= 0.8),
      ).toBe(true);
      expect(draft.statement.rowsNeedingReview).toBe(0);
      expect(draft.warnings).toEqual([]);
      expect(draftReconciliation(draft)).toMatchObject({
        status: "reconciled",
        difference: 0,
      });
      await commitDraft(draft);
      expect(await db.transactions.count()).toBe(count);
    },
  );

  it("uses the Barclaycard two-panel reader and retains only its genuine period-coverage notice", async () => {
    const file = cardSource();
    const profile = vi.spyOn(genericApi, "detectProfile");
    const generic = vi.spyOn(genericApi, "parseGenericStatement");
    const draft = await prepareDraft(file);
    expect(profile).not.toHaveBeenCalled();
    expect(generic).not.toHaveBeenCalled();
    expect(draft.parserFallback).toBe(true);
    expect(draft.parserReview).toBeUndefined();
    expect(draft.account).toMatchObject({
      institution: "Barclays",
      accountType: "credit",
    });
    expect(draft.transactions).toHaveLength(6);
    expect(draft.statement).toMatchObject({
      openingBalance: -90000,
      closingBalance: -10968,
      rowsNeedingReview: 0,
      bankProfileId: "barclaycard",
    });
    expect(draftReconciliation(draft).status).toBe("reconciled");
    expect(draft.warnings).toHaveLength(1);
    expect(draft.warnings[0]).toContain("issue date but no period start");
    await commitDraft({ ...draft, reviewedWarnings: true });
    expect(await db.transactions.count()).toBe(6);
  });

  it("retains native extraction warnings as explicit bank review without routing to the generic wizard", async () => {
    const file = source("T4");
    const parser = getParser("American Express", file.rows);
    const parsed = parser.parse(file.rows);
    vi.spyOn(parser, "parse").mockReturnValue({
      ...parsed,
      warnings: ["Page 1: an Amex transaction amount is ambiguous."],
    });
    const generic = vi.spyOn(genericApi, "parseGenericStatement");
    const draft = await prepareDraft(file);
    expect(generic).not.toHaveBeenCalled();
    expect(draft.parserFallback).toBe(true);
    expect(draft.parserReview).toBeUndefined();
    expect(draft.warnings).toContain(
      "Page 1: an Amex transaction amount is ambiguous.",
    );
    expect(() => validateDraft(draft, false)).toThrow(/review|warning/i);
  });

  it("does not silently verify offsetting Amex printed gross-total differences", async () => {
    const file = source("T4");
    file.extraction!.items.find(
      (item) => item.y === 125 && item.x === 480,
    )!.text = "£200.01";
    file.extraction!.items.find(
      (item) => item.y === 145 && item.x === 480,
    )!.text = "£125.51";
    file.rows = reconstructRows(
      file.extraction!.items.map((item) => ({
        ...item,
        y: item.y + item.height,
      })),
    );
    const generic = vi.spyOn(genericApi, "parseGenericStatement");
    const draft = await prepareDraft(file);
    expect(generic).not.toHaveBeenCalled();
    expect(draft.parserFallback).toBe(true);
    expect(draftReconciliation(draft)).toMatchObject({
      status: "warning",
      difference: 0,
    });
    expect(() =>
      validateDraft({ ...draft, reviewedWarnings: true }, false),
    ).toThrow(/review|reconciliation/i);
  });

  it("retains generic source review for an unfamiliar bank", async () => {
    const generic = vi.spyOn(genericApi, "parseGenericStatement");
    const draft = await prepareDraft(source("T6"));
    expect(generic).toHaveBeenCalled();
    expect(draft.parserFallback).toBe(false);
    expect(draft.parserReview).toBeDefined();
    expect(draft.account.institution).toBe("Other");
    expect(draft.transactions).toHaveLength(3);
  });

  it("honours a deliberately selected manual mapping for a known bank", async () => {
    const file = source("T4");
    const mapped = genericApi.parseGenericStatement(
      file.extraction!.items,
      file.extraction!.pages,
      { institution: "American Express" },
    );
    expect(mapped.mapping).toBeDefined();
    const generic = vi.spyOn(genericApi, "parseGenericStatement");
    const draft = await prepareDraft(
      file,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      { mapping: mapped.mapping, skipCellOcr: true },
    );
    expect(generic).toHaveBeenCalled();
    expect(draft.parserFallback).toBe(false);
    expect(draft.statement.parserMethod).toBe("user_mapping");
  });

  it("opens optional generic source correction only when the user asks for it", async () => {
    const file = source("T4");
    const native = await prepareDraft(file);
    expect(native.bankSource).toBeDefined();
    expect(native.parserReview).toBeUndefined();
    const generic = vi.spyOn(genericApi, "parseGenericStatement");
    const requested = await prepareDraft(
      file,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      { preferGeneric: true, skipCellOcr: true },
    );
    expect(generic).toHaveBeenCalled();
    expect(requested.parserFallback).toBe(false);
    expect(requested.bankSource).toBeUndefined();
    expect(requested.parserReview).toBeDefined();
    expect(requested.transactions.map((row) => row.parseRowId)).not.toEqual(
      native.transactions.map((row) => row.parseRowId),
    );
  });

  it("retains generic OCR and source-row review for a scanned supported-bank PDF", async () => {
    const file = source("T4");
    file.method = "OCR";
    file.extraction!.method = "ocr";
    file.extraction!.items = file.extraction!.items.map((item) => ({
      ...item,
      parseSource: "ocr",
      confidence: 0.6,
    }));
    const generic = vi.spyOn(genericApi, "parseGenericStatement");
    const draft = await prepareDraft(
      file,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      { skipCellOcr: true },
    );
    expect(generic).toHaveBeenCalled();
    expect(draft.parserFallback).toBe(false);
    expect(draft.statement.parserMethod).toBe("ocr");
  });
});
