import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ImportStatementReview } from "./ImportStatementReview";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { prepareDraft } from "../import/pipeline";
import { importBlockers, type FileReview } from "../import/review-model";
import { bankRows } from "../tests/helpers";

beforeEach(async () => {
  cleanup();
  await clearLocalData();
  await initializeDatabase();
});
afterAll(async () => {
  await db.delete();
});

describe("import review corrections", () => {
  const reviewEntry = async (): Promise<FileReview> => ({
    id: "review-status",
    file: new File([], "fictional-status.pdf"),
    draft: await prepareDraft({
      rows: bankRows(),
      hash: "review-status-test",
      filename: "fictional-status.pdf",
      method: "embedded-text",
      warnings: [],
    }),
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
    open: true,
    showAll: false,
    invalidAmounts: [],
  });
  const showReview = async (entry: FileReview) =>
    render(
      <MemoryRouter>
        <ImportStatementReview
          entry={entry}
          accounts={[]}
          categories={await db.categories.toArray()}
          history={[]}
          busy={false}
          patch={() => undefined}
          reparse={() => undefined}
        />
      </MemoryRouter>,
    );

  it.each([
    ["changed parser options", "Parse again"],
    ["invalid amount", "Correct invalid amounts"],
    ["invalid date", "Review needed"],
    ["retained duplicate", "Verify highlighted rows"],
    ["batch recheck", "Recheck statement"],
  ])("marks %s as blocked even when amounts reconcile", async (kind, label) => {
    const entry = await reviewEntry();
    if (kind === "changed parser options") entry.optionsChanged = true;
    if (kind === "invalid amount")
      entry.invalidAmounts = [entry.draft!.transactions[0].id];
    if (kind === "invalid date")
      entry.draft!.transactions[0].date = "2026-09-31";
    if (kind === "retained duplicate") {
      entry.draft!.transactions[0].duplicate = "possible";
      entry.draft!.transactions[0].include = true;
      entry.draft!.transactions[0].acknowledged = false;
    }
    if (kind === "batch recheck") entry.requiresBatchRecheck = true;
    expect(importBlockers(entry).length).toBeGreaterThan(0);
    const { container } = await showReview(entry);
    const card = container.querySelector(".import-statement-card");
    expect(card).toHaveClass("import-statement-blocking");
    expect(card?.querySelector("summary .small-chip")).toHaveTextContent(label);
    expect(card?.querySelector("summary .small-chip")).not.toHaveTextContent(
      "✓ Reconciled",
    );
    // Arithmetic proof remains visible independently of the outstanding review.
    expect(screen.getByText("✓ Statement reconciled")).toBeInTheDocument();
  });

  it("clears the blocking status only after all review blockers are resolved", async () => {
    const entry = await reviewEntry();
    expect(importBlockers(entry)).toEqual([]);
    const { container } = await showReview(entry);
    expect(container.querySelector(".import-statement-card")).not.toHaveClass(
      "import-statement-blocking",
    );
    expect(container.querySelector("summary .small-chip")).toHaveTextContent(
      "✓ Reconciled",
    );
  });

  it("keeps an exact duplicate blocked when batch changes require rechecking", async () => {
    const entry = await reviewEntry();
    entry.draft!.exactDuplicate = true;
    entry.requiresBatchRecheck = true;
    expect(importBlockers(entry).length).toBeGreaterThan(0);
    const { container } = await showReview(entry);
    expect(container.querySelector(".import-statement-card")).toHaveClass(
      "import-statement-blocking",
    );
    expect(container.querySelector("summary .small-chip")).toHaveTextContent(
      "Recheck statement",
    );
  });

  it("shows a skipped file without a blocking warning", async () => {
    const entry = await reviewEntry();
    entry.skip = true;
    entry.optionsChanged = true;
    expect(importBlockers(entry)).toEqual([]);
    const { container } = await showReview(entry);
    expect(container.querySelector(".import-statement-card")).not.toHaveClass(
      "import-statement-blocking",
    );
    expect(container.querySelector("summary .small-chip")).toHaveTextContent(
      "Will be skipped",
    );
  });

  it("clears a property subcategory when the payment becomes an internal transfer", async () => {
    const draft = await prepareDraft({
      rows: bankRows(),
      hash: "review-test",
      filename: "fictional.pdf",
      method: "embedded-text",
      warnings: [],
    });
    draft.transactions = [
      {
        ...draft.transactions[0],
        categoryId: "property",
        subcategoryId: "property-mortgage-financing",
        extractionConfidence: 0.6,
        acknowledged: false,
      },
    ];
    const entry: FileReview = {
      id: "review",
      file: new File([], "fictional.pdf"),
      draft,
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
      showAll: true,
      invalidAmounts: [],
    };
    const patch = vi.fn();
    render(
      <MemoryRouter>
        <ImportStatementReview
          entry={entry}
          accounts={[]}
          categories={await db.categories.toArray()}
          history={[]}
          busy={false}
          patch={patch}
          reparse={() => undefined}
        />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Type", { exact: true }), {
      target: { value: "transfer" },
    });
    const corrected = patch.mock.calls.at(-1)![0].draft.transactions[0];
    expect(corrected).toMatchObject({
      type: "transfer",
      isTransfer: true,
      manualCategory: true,
      categorySource: "manual",
    });
    expect(corrected.categoryId).toBeUndefined();
    expect(corrected.subcategoryId).toBeUndefined();
    expect(corrected.amount).toBe(draft.transactions[0].amount);
  });
});
