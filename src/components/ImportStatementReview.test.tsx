import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ImportStatementReview } from "./ImportStatementReview";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { prepareDraft } from "../import/pipeline";
import type { FileReview } from "../import/review-model";
import { bankRows } from "../tests/helpers";

beforeEach(async () => {
  await clearLocalData();
  await initializeDatabase();
});
afterAll(async () => {
  await db.delete();
});

describe("import review corrections", () => {
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
