import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { prepareDraft } from "./pipeline";
import { reconstructRows } from "./layout";
import { genericFixture } from "./generic/fixtures";
import { guidedReviewCopy, guidedReviewStep } from "./guided-review";
import { importBlockers, type FileReview } from "./review-model";

beforeEach(async () => {
  await clearLocalData();
  await initializeDatabase();
});
afterAll(async () => {
  await db.delete();
});
async function fixture(): Promise<FileReview> {
  const f = genericFixture("T11");
  const draft = await prepareDraft(
    {
      hash: "guided-fictional",
      filename: "fictional.pdf",
      method: "embedded-text",
      rows: reconstructRows(f.items),
      warnings: [],
      extraction: {
        items: f.items,
        pages: f.pages,
        method: "text",
        quality: [],
        pageCount: f.pages.length,
        completedPages: f.pages.map((page) => page.page),
        unreadPages: [],
        cancelled: false,
      },
    },
    undefined,
    undefined,
    undefined,
    [],
    undefined,
    { preferGeneric: true, skipCellOcr: true },
  );
  return {
    id: "guided",
    file: new File([], "fictional.pdf"),
    state: "review",
    progress: "",
    error: "",
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
    draft,
  };
}
describe("guided exception journey", () => {
  it("asks for identity before any of the unresolved rows", async () => {
    const e = await fixture();
    e.draft!.parserReview!.status = "identity-required";
    e.draft!.parserReview!.errorCode = "missing-account";
    expect(guidedReviewStep(e).kind).toBe("identity");
    expect(guidedReviewCopy(e)).toContain("Identify the account");
    const raw = {
      ...e,
      draft: undefined,
      extracted: {
        rows: [],
        filename: "fictional.pdf",
        hash: "x",
        method: "embedded-text" as const,
        warnings: [],
        generic: e.draft!.parserReview,
      },
    };
    expect(guidedReviewStep(raw).kind).toBe("identity");
  });
  it("advances after a valid manual entry but never treats unequal balances as verified", async () => {
    const e = await fixture();
    const first = guidedReviewStep(e);
    expect(first.kind).toBe("source-row");
    if (first.kind !== "source-row")
      throw new Error("Expected a source question");
    const r = first.row.readings[0];
    first.row.reviewAction = {
      kind: "correct",
      date: r.date!,
      description: r.description,
      amount: r.amount!,
    };
    e.draft!.reviewedWarnings = true;
    expect(guidedReviewStep(e).kind).toBe("validation");
    expect(importBlockers(e).length).toBeGreaterThan(0);
    expect(e.draft!.parserReview!.checks.reconciledExactly).toBe(false);
    expect(await db.transactions.count()).toBe(0);
  });
  it("does not advance past an invalid manual source value even after an override", async () => {
    const e = await fixture();
    const row = e.draft!.parserReview!.rowChecks[0];
    row.readings[0].amount = undefined;
    row.reviewAction = {
      kind: "correct",
      date: "2026-09-01",
      description: "Invalid amount",
      amount: NaN,
    };
    e.override = true;
    e.draft!.reviewedWarnings = true;
    expect(guidedReviewStep(e).kind).toBe("source-row");
    expect(importBlockers(e)).toContain(
      "Correct or exclude unread dates, descriptions and amounts.",
    );
  });
  it("keeps reconciliation gates when an excluded row leaves a missing total", async () => {
    const e = await fixture();
    for (const row of e.draft!.parserReview!.rowChecks)
      row.reviewAction = { kind: "exclude" };
    e.draft!.reviewedWarnings = true;
    expect(guidedReviewStep(e).kind).toBe("validation");
    expect(importBlockers(e).length).toBeGreaterThan(0);
  });
  it("handles changed options and exact duplicates without unnecessary row questions", async () => {
    const e = await fixture();
    expect(guidedReviewStep({ ...e, optionsChanged: true }).kind).toBe(
      "recheck",
    );
    e.draft!.exactDuplicate = true;
    expect(guidedReviewStep(e).kind).toBe("complete");
    expect(importBlockers(e)).toEqual([]);
    expect(guidedReviewStep({ ...e, skip: true }).kind).toBe("complete");
  });
});
