import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { bankRows } from "../tests/helpers";
import { prepareDraft } from "./pipeline";
import { importBlockers, type FileReview } from "./review-model";
import {
  appendBatchEntries,
  batchPresentation,
  expandBatchStatement,
  nextAttentionStatement,
  reviewedRowSelection,
  statementPresentation,
  statementVisibleInReview,
} from "./batch-presentation";

beforeEach(async () => {
  await clearLocalData();
  await initializeDatabase();
});
afterAll(async () => {
  await db.delete();
});

async function entry(id: string): Promise<FileReview> {
  return {
    id,
    file: new File([], `${id}.pdf`),
    state: "review",
    progress: "Ready to review",
    error: "",
    bank: "",
    accountId: "",
    manualPeriod: false,
    periodStart: "",
    periodEnd: "",
    optionsChanged: false,
    override: false,
    skip: false,
    open: false,
    showAll: false,
    invalidAmounts: [],
    draft: await prepareDraft({
      rows: bankRows(),
      hash: id,
      filename: `${id}.pdf`,
      method: "embedded-text",
      warnings: [],
    }),
  };
}

describe("import batch presentation", () => {
  it("refreshes automatic duplicate decisions in both directions without carrying acknowledgement", async () => {
    const file = await entry("duplicate-transition");
    const row = file.draft!.transactions[0];
    const excludedDuplicate = {
      ...row,
      duplicate: "certain" as const,
      include: false,
    };
    expect(reviewedRowSelection(excludedDuplicate, row, false).include).toBe(
      true,
    );
    expect(reviewedRowSelection(excludedDuplicate, row, true).include).toBe(
      false,
    );
    expect(
      reviewedRowSelection(
        { ...row, include: true, acknowledged: true },
        excludedDuplicate,
        true,
      ),
    ).toMatchObject({ include: false, acknowledged: false });
    expect(
      reviewedRowSelection(
        { ...excludedDuplicate, include: true, acknowledged: true },
        excludedDuplicate,
        true,
      ),
    ).toMatchObject({ include: true, acknowledged: true });
    expect(
      reviewedRowSelection(
        { ...excludedDuplicate, include: true, acknowledged: false },
        { ...excludedDuplicate, acknowledged: true },
        true,
      ),
    ).toMatchObject({ include: true, acknowledged: false });
  });

  it("derives attention and navigation from the authoritative blockers", async () => {
    const ready = await entry("ready");
    const changed = { ...(await entry("changed")), optionsChanged: true };
    const failed = {
      ...(await entry("failed")),
      state: "error" as const,
      draft: undefined,
      error: "Fictitious unread statement",
    };
    const batch = batchPresentation([ready, changed, failed]);
    expect(batch.readyCount).toBe(1);
    expect(batch.attention.map((item) => item.entry.id)).toEqual([
      "changed",
      "failed",
    ]);
    expect(batch.attention.map((item) => item.blockers)).toEqual([
      importBlockers(changed),
      importBlockers(failed),
    ]);
    expect(batch.sorted.map((item) => item.id)).toEqual([
      "changed",
      "failed",
      "ready",
    ]);
    const opened = expandBatchStatement([ready, changed, failed], "changed");
    expect(nextAttentionStatement(opened)?.id).toBe("failed");
    expect(
      nextAttentionStatement(expandBatchStatement(opened, "failed"))?.id,
    ).toBe("changed");
  });

  it("keeps a repeated PDF skipped until an explicit override or required recheck", async () => {
    const file = await entry("repeated");
    file.draft!.exactDuplicate = true;
    expect(statementPresentation(file).state).toBe("skipped");
    file.requiresBatchRecheck = true;
    expect(statementPresentation(file).state).toBe("attention");
    file.requiresBatchRecheck = false;
    file.draft!.duplicateOverride = true;
    expect(statementPresentation(file).state).toBe("ready");
  });

  it("does not call an invalid amount ready after financial acceptance", async () => {
    const file = await entry("invalid");
    file.override = true;
    file.invalidAmounts = [file.draft!.transactions[0].id];
    expect(statementPresentation(file).state).toBe("attention");
    expect(statementPresentation(file).blockers).toContain(
      "Correct the invalid amounts.",
    );
  });

  it("reports left-out, saved and still-checking statements separately", async () => {
    const file = await entry("states");
    const batch = batchPresentation([
      { ...file, skip: true, error: "Fictitious failure" },
      { ...file, id: "saved", state: "saved", imported: 4 },
      { ...file, id: "queued", state: "queued", draft: undefined },
      { ...file, id: "checking", state: "checking", draft: undefined },
    ]);
    expect(batch).toMatchObject({
      readyCount: 0,
      skippedCount: 1,
      savedCount: 1,
      completedCount: 2,
      attention: [],
    });
  });

  it("filters attention for presentation while preserving every statement and financial gate", async () => {
    const ready = await entry("ready-hidden");
    const duplicate = await entry("duplicate-hidden");
    duplicate.draft!.exactDuplicate = true;
    const changed = {
      ...(await entry("changed-visible")),
      optionsChanged: true,
    };
    const entries = [ready, duplicate, changed];
    expect(
      entries.filter((file) => statementVisibleInReview(file, "attention")),
    ).toEqual([changed]);
    expect(
      entries.filter((file) => statementVisibleInReview(file, "all")),
    ).toEqual(entries);
    expect(batchPresentation(entries)).toMatchObject({
      readyCount: 1,
      skippedCount: 1,
    });
    expect(importBlockers(changed)).toContain(
      "Parse again to apply the bank, account or statement dates.",
    );
    expect(ready.draft!.transactions.some((row) => row.include)).toBe(true);
    expect(duplicate.draft!.duplicateOverride).not.toBe(true);
    expect(await db.transactions.count()).toBe(0);
  });

  it("retains only the active attention card through resolution and recheck", async () => {
    const file = { ...(await entry("active-attention")), open: true };
    const other = { ...(await entry("unrelated-ready")), open: true };
    expect(statementVisibleInReview(file, "attention")).toBe(false);
    expect(statementVisibleInReview(file, "attention", file.id)).toBe(true);
    expect(
      statementVisibleInReview(
        { ...file, state: "checking" },
        "attention",
        file.id,
      ),
    ).toBe(true);
    expect(
      statementVisibleInReview({ ...file, skip: true }, "attention", file.id),
    ).toBe(true);
    expect(
      statementVisibleInReview({ ...file, open: false }, "attention", file.id),
    ).toBe(false);
    expect(statementVisibleInReview(other, "attention", file.id)).toBe(false);
  });

  it("shows new blockers immediately even if a ready card was previously hidden", async () => {
    const file = await entry("new-blocker");
    expect(statementVisibleInReview(file, "attention")).toBe(false);
    file.requiresBatchRecheck = true;
    expect(statementVisibleInReview(file, "attention")).toBe(true);
    expect(importBlockers(file)).toContain(
      "Recheck this statement because another selected file was skipped or changed.",
    );
  });

  it("appends without replacing reviewed drafts, source sessions or row decisions", async () => {
    const previous = await entry("previous");
    previous.draft!.transactions[0].include = false;
    previous.draft!.transactions[1].acknowledged = true;
    previous.draft!.transactions[1].replaceManual = false;
    const appended = appendBatchEntries([previous], [await entry("added")]);
    expect(appended[0]).toBe(previous);
    expect(appended[0].draft).toBe(previous.draft);
    expect(appended[0].draft!.transactions[0].include).toBe(false);
    expect(appended[0].draft!.transactions[1]).toMatchObject({
      acknowledged: true,
      replaceManual: false,
    });
    expect(appendBatchEntries(appended, [])[0]).toBe(previous);
    expect(await db.transactions.count()).toBe(0);
  });

  it("expands only one statement and leaves its financial state intact", async () => {
    const first = { ...(await entry("first")), open: true };
    const second = await entry("second");
    const expanded = expandBatchStatement([first, second], second.id);
    expect(expanded.map((file) => file.open)).toEqual([false, true]);
    expect(expanded[0].draft).toBe(first.draft);
    expect(expanded[1].draft).toBe(second.draft);
    expect(expandBatchStatement(expanded).every((file) => !file.open)).toBe(
      true,
    );
    expect(nextAttentionStatement(expanded)).toBeUndefined();
  });
});
