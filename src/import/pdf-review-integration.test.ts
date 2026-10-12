import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { setImportDiagnosticsEnabled } from "../storage/import-diagnostics";
import { reconcile, reconcileWithPolicy } from "../domain/reconcile";
import { genericFixture } from "./generic/fixtures";
import { reconstructRows } from "./layout";
import {
  commitDraft,
  draftReconciliation,
  prepareDraft,
  savePdfLayout,
  validateDraft,
  type ExtractedFile,
} from "./pipeline";
import type { PdfImportSession } from "./pdf-session-types";
import type { SourceRect } from "./generic/types";
import { layoutItems } from "../tests/statement-layouts";
import { groupedBarclaysItems } from "../tests/barclays-grouped";
import { getParser } from "../parsers";
import generatedCard from "../tests/synthetic-barclaycard-pdf-text.json";

function source(
  fixture: Parameters<typeof genericFixture>[0] = "T6",
  hash: string = fixture,
): ExtractedFile {
  const data = genericFixture(fixture);
  return {
    rows: reconstructRows(
      data.items.map((item) => ({ ...item, y: item.y + item.height })),
    ),
    hash,
    filename: "fictitious.pdf",
    method: "embedded-text",
    warnings: [],
    extraction: {
      ...data,
      quality: [],
      pageCount: data.pages.length,
      completedPages: data.pages.map((p) => p.page),
      unreadPages: [],
      cancelled: false,
      method: "text",
    },
  };
}
function cells(file: ExtractedFile, amount: string) {
  const readCells = vi.fn(async (rects: SourceRect[]) =>
    rects.map((rect) => ({
      rect,
      items: [
        {
          ...file.extraction!.items.find(
            (item) =>
              item.page === rect.page &&
              Math.abs(item.y - rect.y) < 3 &&
              item.x >= rect.x - 1,
          )!,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          text: rect.x < 400 ? amount : "1,100.00",
          parseSource: "ocr" as const,
          fontSize: 10,
          confidence: 0.6,
        },
      ],
    })),
  );
  file.pdfSession = { readCells } as unknown as PdfImportSession;
  return readCells;
}
beforeEach(async () => {
  await clearLocalData();
  await initializeDatabase();
});
afterAll(async () => {
  await db.delete();
});

describe("PDF review pipeline integrity", () => {
  it("imports and reuses a layout for both actual Barclaycard reading panels without losing any purchases or refund", async () => {
    const makeCard = (hash: string): ExtractedFile => {
      const items = generatedCard.items.map((item) => ({
        ...item,
        parseSource: "text" as const,
      }));
      return {
        rows: reconstructRows(
          items.map((item) => ({ ...item, y: item.y + item.height })),
        ),
        filename: "synthetic-card.pdf",
        hash,
        method: "embedded-text",
        warnings: [],
        extraction: {
          items,
          pages: generatedCard.pages,
          quality: [],
          pageCount: 2,
          completedPages: [1, 2],
          unreadPages: [],
          cancelled: false,
          method: "text",
        },
      };
    };
    const file = makeCard("two-card-panels");
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
    expect(draft.transactions).toHaveLength(6);
    expect(draft.statement).toMatchObject({
      openingBalance: -90000,
      closingBalance: -10968,
      periodSource: "transaction-coverage",
      statementDate: "2026-10-04",
    });
    expect(draftReconciliation(draft).status).toBe("reconciled");
    expect(draft.parserReview?.checks).toMatchObject({
      calculatedMoneyIn: 90500,
      calculatedMoneyOut: 11468,
    });
    expect(
      draft.warnings.some((warning) =>
        warning.includes("issue date but no period start"),
      ),
    ).toBe(true);
    const template = await savePdfLayout(
      file,
      draft.parserReview!,
      "Two card panels",
    );
    expect(
      template.columnRoles.filter((column) => column.role === "date"),
    ).toHaveLength(2);
    expect(
      template.columnRoles.filter((column) => column.role === "amount"),
    ).toHaveLength(2);
    const reused = await prepareDraft(
      makeCard("two-card-panels-regenerated"),
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      { skipCellOcr: true },
    );
    expect(reused.statement.parserMethod).toBe("template");
    expect(reused.transactions).toHaveLength(6);
    expect(draftReconciliation(reused).status).toBe("reconciled");
    await commitDraft({ ...draft, reviewedWarnings: true });
    expect(await db.transactions.count()).toBe(6);
  });
  it("retains stronger exact running-balance evidence when a net-reconciled legacy reader omits opposite movements", async () => {
    const file = source("T5GBP");
    const parser = getParser("Revolut", file.rows);
    const legacy = parser.parse(file.rows);
    for (const [y, income, out, balance] of [
      [300, "50.00", "", "1,124.50"],
      [330, "", "50.00", "1,074.50"],
    ] as const)
      for (const [x, text] of [
        [30, "4 Sep 2026"],
        [110, "FICTIONAL EXTRA MOVEMENT"],
        ...(out ? [[320, out] as const] : []),
        ...(income ? [[400, income] as const] : []),
        [500, balance],
      ] as const)
        file.extraction!.items.push({
          ...file.extraction!.items[0],
          x,
          y,
          text,
          width: text.length * 5,
        });
    file.rows = reconstructRows(
      file.extraction!.items.map((item) => ({
        ...item,
        y: item.y + item.height,
      })),
    );
    // Simulate the old adapter losing a pair whose net is zero. Its balance
    // check alone cannot detect this omission; individual source balances can.
    const oldReader = vi.spyOn(parser, "parse").mockReturnValue(legacy);
    try {
      const draft = await prepareDraft(
        file,
        undefined,
        undefined,
        undefined,
        [],
        undefined,
        {
          skipCellOcr: true,
        },
      );
      expect(draft.parserReview?.comparison?.legacyStatus).toBe("different");
      expect(draft.parserReview?.checks.reconciledExactly).toBe(true);
      expect(draft.parserFallback).toBe(false);
      expect(draft.transactions.map((row) => row.amount)).toEqual([
        20000, -10000, -2550, 5000, -5000,
      ]);
      await commitDraft(draft);
      expect(await db.transactions.count()).toBe(5);
    } finally {
      oldReader.mockRestore();
    }
  });
  it("does not prefer a legacy net balance when printed gross credits and debits each disagree by one penny", async () => {
    const file = source("T4");
    const parser = getParser("American Express", file.rows);
    const legacy = parser.parse(file.rows);
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
    const oldReader = vi.spyOn(parser, "parse").mockReturnValue({
      ...legacy,
      transactions: legacy.transactions.map((transaction) => ({
        ...transaction,
        description: `${transaction.description} LEGACY READING`,
      })),
    });
    try {
      const draft = await prepareDraft(
        file,
        undefined,
        undefined,
        undefined,
        [],
        undefined,
        {
          skipCellOcr: true,
        },
      );
      expect(draft.parserReview?.checks.reconciliation.difference).toBe(0);
      expect(draft.parserReview?.checks.moneyInDifference).toBe(-1);
      expect(draft.parserReview?.checks.moneyOutDifference).toBe(-1);
      expect(draft.parserFallback).toBe(false);
      expect(draftReconciliation(draft).status).toBe("warning");
      expect(() =>
        validateDraft({ ...draft, reviewedWarnings: true }, false),
      ).toThrow(/review|reconciliation/i);
    } finally {
      oldReader.mockRestore();
    }
  });
  it.each(["amex", "amex-posted", "revolut", "grouped-barclays"] as const)(
    "keeps all independently validated transactions in the established %s layout",
    async (kind) => {
      const items = (
        kind === "grouped-barclays"
          ? groupedBarclaysItems()
          : layoutItems(kind === "amex-posted" ? "amex" : kind)
      ).map((item) => ({
        ...item,
        fontSize: item.height,
        parseSource: "text" as const,
      }));
      const institution =
        kind === "amex" || kind === "amex-posted"
          ? "American Express"
          : kind === "revolut"
            ? "Revolut"
            : "Barclays";
      if (kind === "amex-posted")
        items.find(
          (item) => item.page === 2 && item.y === 205 && item.x === 58,
        )!.text = "Sep 6";
      const rows = reconstructRows(items);
      const legacy = getParser(institution, rows).parse(rows);
      const file: ExtractedFile = {
        rows,
        filename: "synthetic-layout.pdf",
        hash: kind,
        method: "embedded-text",
        warnings: [],
        extraction: {
          items,
          pages: [...new Set(items.map((item) => item.page))].map((page) => ({
            page,
            width: 620,
            height: 850,
            rotation: 0,
          })),
          quality: [],
          completedPages: [...new Set(items.map((item) => item.page))],
          unreadPages: [],
          pageCount: Math.max(...items.map((item) => item.page)),
          cancelled: false,
          method: "text",
        },
      };
      const draft = await prepareDraft(
        file,
        undefined,
        undefined,
        undefined,
        [],
        undefined,
        { skipCellOcr: true },
      );
      expect(
        draft.transactions
          .map((row) => [row.date, row.bookingDate, row.amount])
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        JSON.stringify({
          fallback: draft.parserFallback,
          comparison: draft.parserReview?.comparison?.legacyStatus,
          checks: draft.parserReview?.rowChecks.map((row) => ({
            issues: row.issues,
            reading: row.readings[0],
          })),
        }),
      ).toEqual(
        legacy.transactions
          .map((row) => [row.date, row.bookingDate, row.amount])
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      );
      expect(draft.statement.closingBalance).toBe(legacy.closingBalance);
      expect(draftReconciliation(draft).difference).toBe(0);
      if (kind === "amex-posted") {
        expect(
          draft.transactions.find((row) => row.date === "2026-09-05")
            ?.bookingDate,
        ).toBe("2026-09-06");
        expect(draftReconciliation(draft).status).toBe("reconciled");
        expect(
          draft.warnings.some((warning) =>
            warning.includes("outside the statement period"),
          ),
        ).toBe(false);
      }
    },
  );
  it("keeps historical tolerance but rejects one penny on a newly imported PDF", async () => {
    expect(reconcile(100, 101, []).status).toBe("reconciled");
    expect(reconcileWithPolicy(100, 101, [], "exact-v2.2").status).toBe(
      "warning",
    );
    const draft = await prepareDraft(
      source("T11"),
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      { skipCellOcr: true },
    );
    expect(draft.statement.validationPolicy).toBe("exact-v2.2");
    expect(draftReconciliation(draft).status).toBe("warning");
    expect(() => validateDraft(draft, false)).toThrow(/review|reconciliation/i);
  });
  it("imports an unknown bank without inventing identity or dropping source evidence", async () => {
    const draft = await prepareDraft(source());
    expect(draft.account).toMatchObject({
      institution: "Other",
      maskedAccountIdentifier: "•••• 2222",
    });
    expect(draft.transactions).toHaveLength(3);
    expect(draft.transactions.map((row) => row.amount)).toEqual([
      20000, -10000, -2550,
    ]);
    expect(draft.parserReview?.checks.reconciledExactly).toBe(true);
    await commitDraft(draft);
    expect(
      (await db.statements.get(draft.statement.id))?.validationStatus,
    ).toBe("reconciled");
    expect(
      (await db.transactions.toArray()).every(
        (row) => row.checkLevel === "balance" && row.parseSource === "text",
      ),
    ).toBe(true);
  });
  it("leaves malformed rows in source review and forbids an invalid-row override", async () => {
    const file = source();
    file.extraction!.items.find(
      (item) => item.x === 320 && item.y === 240,
    )!.text = "1OO.OO";
    const draft = await prepareDraft(
      file,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      { skipCellOcr: true },
    );
    expect(draft.transactions).toHaveLength(2);
    expect(draft.parserReview?.rowChecks).toHaveLength(3);
    expect(() =>
      validateDraft({ ...draft, reviewedWarnings: true }, true),
    ).toThrow(/invalid date, amount or description/);
    const rowId = draft.parserReview!.rowChecks[1].rowId;
    const corrected = await prepareDraft(
      file,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      {
        skipCellOcr: true,
        actions: {
          [rowId]: {
            kind: "correct",
            date: "2026-09-02",
            description: "FICTIONAL SHOP",
            amount: -10000,
          },
        },
      },
    );
    expect(corrected.transactions).toHaveLength(3);
    expect(draftReconciliation(corrected).status).toBe("reconciled");
    expect(corrected.transactions[1].parseSource).toBe("user");
    await commitDraft(corrected);
  });
  it("excludes a source row separately from declining a duplicate ledger addition", async () => {
    const file = source();
    const draft = await prepareDraft(file);
    draft.transactions[1].include = false;
    expect(draftReconciliation(draft).status).toBe("reconciled");
    const excluded = await prepareDraft(
      file,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      {
        actions: {
          [draft.parserReview!.rowChecks[1].rowId]: {
            kind: "exclude",
            reason: "Reviewed source correction",
          },
        },
        skipCellOcr: true,
      },
    );
    expect(excluded.transactions).toHaveLength(2);
    expect(excluded.statement.rowsExcludedByReview).toBe(1);
    expect(draftReconciliation(excluded).status).toBe("warning");
    expect(() => validateDraft(excluded, false)).toThrow(
      /review|reconciliation/i,
    );
  });
  it("retains an outside-period printed date only with an explicit Unverified import", async () => {
    const file = source();
    file.extraction!.items.find(
      (item) => item.y === 210 && item.x === 30,
    )!.text = "31 Aug 2026";
    const draft = await prepareDraft(
      file,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      {
        skipCellOcr: true,
      },
    );
    expect(draft.transactions[0].date).toBe("2026-08-31");
    expect(draft.parserReview?.rowChecks[0].issues).toContain("outside-period");
    expect(draftReconciliation(draft)).toMatchObject({
      status: "warning",
      difference: 0,
    });
    const reviewed = { ...draft, reviewedWarnings: true };
    expect(() => validateDraft(reviewed, false)).toThrow(
      /review|reconciliation|Unverified/i,
    );
    await commitDraft(reviewed, true);
    expect((await db.transactions.get(draft.transactions[0].id))?.date).toBe(
      "2026-08-31",
    );
    expect(await db.statements.get(draft.statement.id)).toMatchObject({
      validationStatus: "warning",
      validationOverride: true,
    });
  });
  it("requires malformed calendar corrections to be corrected or excluded even through an override", async () => {
    const file = source();
    const original = await prepareDraft(file);
    const rowId = original.parserReview!.rowChecks[1].rowId;
    const draft = await prepareDraft(
      file,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      {
        skipCellOcr: true,
        actions: {
          [rowId]: {
            kind: "correct",
            date: "2026-02-30",
            description: "FICTIONAL SHOP",
            amount: -10000,
          },
        },
      },
    );
    expect(draft.transactions).toHaveLength(2);
    expect(() =>
      validateDraft({ ...draft, reviewedWarnings: true }, true),
    ).toThrow(/invalid date, amount or description/);
    const excluded = await prepareDraft(
      file,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      {
        skipCellOcr: true,
        actions: { [rowId]: { kind: "exclude" } },
      },
    );
    await commitDraft({ ...excluded, reviewedWarnings: true }, true);
    expect(await db.transactions.count()).toBe(2);
  });
  it("reimported transaction duplicates still participate in source proof", async () => {
    const initial = await prepareDraft(source());
    await commitDraft(initial);
    const repeated = await prepareDraft(source("T6", "different-hash"));
    expect(repeated.transactions.every((row) => !row.include)).toBe(true);
    expect(draftReconciliation(repeated).status).toBe("reconciled");
    expect(repeated.parserReview?.checks.calculatedMoneyOut).toBe(12550);
  });
  it("does not trust normalized edits that bypass the source-row review", async () => {
    const draft = await prepareDraft(source());
    draft.transactions[0].amount += 100;
    draft.transactions[1].amount -= 100;
    expect(draftReconciliation(draft).status).toBe("reconciled");
    expect(() => validateDraft(draft, true)).toThrow("Source readings changed");
  });
  it("keeps the generic table when missing period prevents normalization", async () => {
    const file = source();
    file.extraction!.items = file.extraction!.items.filter(
      (item) => item.y !== 65,
    );
    await expect(prepareDraft(file)).rejects.toThrow("Statement period");
    expect(file.generic?.table.rows.length).toBeGreaterThan(0);
    expect(file.generic?.errorCode).toBe("missing-period");
  });
  it("requires an explicit Unverified import for unread pages, even when completed-page figures match", async () => {
    const file = source();
    file.extraction!.unreadPages = [2];
    file.extraction!.cancelled = true;
    const draft = await prepareDraft(
      file,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      { skipCellOcr: true },
    );
    expect(draftReconciliation(draft).status).toBe("warning");
    expect(draft.statement.unreadPages).toEqual([2]);
    expect(() => validateDraft(draft, false)).toThrow(/review|reconciliation/i);
    await commitDraft({ ...draft, reviewedWarnings: true }, true);
    expect(
      (await db.statements.get(draft.statement.id))?.validationOverride,
    ).toBe(true);
  });
  it("accepts cell OCR automatically only when the individual balance matches exactly", async () => {
    const file = source("T11");
    const read = cells(file, "100.00");
    const draft = await prepareDraft(file);
    expect(read).toHaveBeenCalledOnce();
    expect(draft.transactions[1].amount).toBe(-10000);
    expect(draft.transactions[1]).toMatchObject({
      parseSource: "ocr",
      checkLevel: "ocr",
    });
    expect(draftReconciliation(draft).status).toBe("reconciled");
    expect(draft.statement.parserMethod).toBe("text+ocr");
  });
  it("does not revert balance-proved OCR corrections when an adapter's opposite numeric errors cancel in the statement net", async () => {
    const file = source("T1");
    file.extraction!.items.find(
      (item) => item.page === 1 && item.x === 400 && item.y === 210,
    )!.text = "200.01";
    file.extraction!.items.find(
      (item) => item.page === 1 && item.x === 320 && item.y === 240,
    )!.text = "100.01";
    file.extraction!.items.find(
      (item) => item.page === 2 && item.x === 30 && item.y === 100,
    )!.text = "31 Aug 2026";
    file.rows = reconstructRows(
      file.extraction!.items.map((item) => ({
        ...item,
        y: item.y + item.height,
      })),
    );
    file.pdfSession = {
      readCells: vi.fn(async (rects: SourceRect[]) =>
        rects.map((rect) => {
          const original = file.extraction!.items.find(
            (item) =>
              item.page === rect.page && item.x === rect.x && item.y === rect.y,
          )!;
          return {
            rect,
            items: [
              {
                ...original,
                parseSource: "ocr" as const,
                text:
                  original.text === "200.01"
                    ? "200.00"
                    : original.text === "100.01"
                      ? "100.00"
                      : original.text,
              },
            ],
          };
        }),
      ),
    } as unknown as PdfImportSession;
    const draft = await prepareDraft(file);
    expect(draft.parserFallback).toBe(false);
    expect(draft.transactions.map((row) => row.amount)).toEqual([
      20000, -10000, -2550,
    ]);
    expect(draft.transactions[0].parseSource).toBe("ocr");
    expect(draft.transactions[1].parseSource).toBe("ocr");
    expect(draft.statement.parserMethod).toBe("text+ocr");
    expect(draftReconciliation(draft)).toMatchObject({
      status: "warning",
      difference: 0,
    });
    expect(draft.parserReview?.rowChecks[2].issues).toContain("outside-period");
  });
  it.each([
    "DIRECT DEBIT TO BARCLAYCARD",
    "PAYMENT TO AMERICAN EXPRESS",
    "TRANSFER TO REVOLUT",
  ])(
    "keeps a Barclays cash account current when the transaction counterparty is %s",
    async (description) => {
      const file = source("T1");
      file.extraction!.items.find(
        (item) => item.page === 1 && item.x === 110 && item.y === 240,
      )!.text = description;
      file.rows = reconstructRows(
        file.extraction!.items.map((item) => ({
          ...item,
          y: item.y + item.height,
        })),
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
      expect(draft.account.accountType).toBe("current");
      expect(draft.statement.bankProfileId).toBe("barclays-current");
      expect(draft.statement).toMatchObject({
        openingBalance: 100000,
        closingBalance: 107450,
      });
      expect(draftReconciliation(draft).status).toBe("reconciled");
      await commitDraft(draft);
      expect((await db.accounts.get(draft.account.id))?.accountType).toBe(
        "current",
      );
    },
  );
  it("retains a conflicting OCR alternative instead of silently adopting it", async () => {
    const file = source("T11");
    cells(file, "999.00");
    const draft = await prepareDraft(file);
    expect(draft.transactions[1].amount).toBe(-10001);
    expect(draftReconciliation(draft).status).toBe("warning");
    const row = draft.parserReview!.rowChecks[1];
    const alternative = row.readings.find(
      (reading) => reading.amount === -99900,
    );
    expect(alternative).toBeDefined();
    const accepted = await prepareDraft(
      file,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      {
        skipCellOcr: true,
        actions: {
          [row.rowId]: { kind: "accept", readingId: alternative!.id },
        },
      },
    );
    expect(accepted.transactions[1].amount).toBe(-99900);
    expect(draftReconciliation(accepted).status).toBe("warning");
  });
  it("cell OCR cancellation retains the source result for manual review", async () => {
    const file = source("T11");
    file.pdfSession = {
      readCells: vi
        .fn()
        .mockRejectedValue(new DOMException("Cancelled", "AbortError")),
    } as unknown as PdfImportSession;
    const draft = await prepareDraft(file);
    expect(draft.transactions[1].amount).toBe(-10001);
    expect(file.generic?.rowChecks).toHaveLength(3);
  });
  it("saves a private layout with one representative column set and rechecks every reuse", async () => {
    const file = source("T1");
    const draft = await prepareDraft(
      file,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      { skipCellOcr: true },
    );
    const template = await savePdfLayout(
      file,
      draft.parserReview!,
      "My statement layout",
    );
    expect(template.columnRoles).toHaveLength(5);
    expect(template.fingerprint).not.toMatch(/FICTIONAL|2026|2222|1,000/);
    const reused = await prepareDraft(
      source("T1", "new-template-hash"),
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      { skipCellOcr: true },
    );
    expect(reused.statement.layoutTemplateId).toBe(template.id);
    expect(reused.statement.parserMethod).toBe("template");
    const wrong = source("T11", "changed-template-hash");
    const changed = await prepareDraft(
      wrong,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      { skipCellOcr: true },
    );
    expect(changed.statement.layoutTemplateId).toBe(template.id);
    expect(draftReconciliation(changed).status).toBe("warning");
    expect((await db.layoutTemplates.get(template.id))?.status).toBe(
      "check_needed",
    );
  });
  it("stores opt-in diagnostics atomically outside Undo and preserves the earliest real import date", async () => {
    await setImportDiagnosticsEnabled(true, db);
    await db.settings.put({
      key: "firstRealImportAt",
      value: "2026-09-01T12:00:00.000Z",
    });
    const draft = await prepareDraft(source());
    await commitDraft(draft);
    expect((await db.settings.get("firstRealImportAt"))?.value).toBe(
      "2026-09-01T12:00:00.000Z",
    );
    expect(await db.importDiagnostics.count()).toBe(1);
    expect(
      (await db.changeLog.toArray())
        .flatMap((change) => change.changes)
        .some((change) => change.table === "importDiagnostics"),
    ).toBe(false);
    await setImportDiagnosticsEnabled(false, db);
    expect(await db.importDiagnostics.count()).toBe(0);
  });
});
