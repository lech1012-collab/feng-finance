import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { bankRows } from "../tests/helpers";
import { prepareDraft } from "./pipeline";
import { genericFixture } from "./generic/fixtures";
import { parseGenericStatement } from "./generic/engine";
import {
  importBlockers,
  invalidSourceRows,
  sourceReview,
  type FileReview,
} from "./review-model";

beforeEach(async () => {
  await clearLocalData();
  await initializeDatabase();
});
afterAll(async () => {
  await db.delete();
});

async function entry(): Promise<FileReview> {
  return {
    id: "fictitious-review",
    file: new File([], "fictitious.pdf"),
    draft: await prepareDraft({
      rows: bankRows(),
      hash: "fictitious",
      filename: "fictitious.pdf",
      method: "embedded-text",
      warnings: [],
    }),
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
  };
}
function source(id: "T6" | "T11" = "T6") {
  const fixture = genericFixture(id);
  return parseGenericStatement(fixture.items, fixture.pages);
}

describe("source review financial gates", () => {
  it("retains malformed raw rows even without a normalized draft", async () => {
    const file = await entry();
    const raw = source();
    delete raw.rowChecks[0].readings[0].amount;
    file.draft = undefined;
    file.extracted = {
      rows: [],
      hash: "fictitious",
      filename: "fictitious.pdf",
      method: "embedded-text",
      warnings: [],
      generic: raw,
    };
    expect(sourceReview(file)).toBe(raw);
    expect(invalidSourceRows(raw)).toHaveLength(1);
    expect(importBlockers(file)).not.toEqual([]);
  });
  it.each(["date", "amount", "description"] as const)(
    "never permits an unread %s through an override",
    async (field) => {
      const file = await entry();
      file.draft!.parserReview = source();
      const reading = file.draft!.parserReview.rowChecks[0].readings[0];
      if (field === "description") reading.description = "";
      else delete reading[field];
      file.override = true;
      expect(importBlockers(file)).toContain(
        "Correct or exclude unread dates, descriptions and amounts.",
      );
      file.draft!.parserReview.rowChecks[0].reviewAction = { kind: "exclude" };
      expect(importBlockers(file)).not.toContain(
        "Correct or exclude unread dates, descriptions and amounts.",
      );
    },
  );
  it("requires explicit unverified acceptance for a valid one-penny mismatch", async () => {
    const file = await entry();
    file.draft!.parserReview = source("T11");
    expect(file.draft!.parserReview.mapping).toBeDefined();
    expect(importBlockers(file)).toContain(
      "Review source rows or explicitly accept an unverified statement.",
    );
    file.override = true;
    expect(importBlockers(file)).toEqual([]);
  });
  it("keeps unknown account identity blocked despite an override", async () => {
    const file = await entry();
    file.draft!.parserReview = source();
    file.draft!.parserReview.status = "identity-required";
    file.override = true;
    expect(importBlockers(file)).toContain(
      "Confirm the account, dates and column mapping.",
    );
  });
  it("does not remove source evidence when duplicate rows are excluded from import", async () => {
    const file = await entry();
    const result = source();
    file.draft!.parserReview = result;
    file.draft!.transactions.forEach((row) => {
      row.include = false;
      row.duplicate = "certain";
    });
    expect(sourceReview(file)?.rowChecks).toHaveLength(3);
    expect(sourceReview(file)?.checks.calculatedMoneyOut).toBe(
      result.checks.calculatedMoneyOut,
    );
    expect(importBlockers(file)).toEqual([]);
  });
  it("keeps the legacy reader confidence guard when its alternative mapping is incomplete", async () => {
    const file = await entry();
    file.draft!.parserReview = source();
    file.draft!.parserFallback = true;
    file.draft!.transactions[0].extractionConfidence = 0.6;
    file.draft!.transactions[0].acknowledged = false;
    expect(importBlockers(file)).toContain(
      "Verify the highlighted amounts or kept duplicates.",
    );
  });
});
