import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ImportStatementReview } from "./ImportStatementReview";
import type { FileReview } from "../import/review-model";
import { annualCardFixture } from "../tests/barclaycard-annual";
import { identifyBarclaycardAnnualSummary } from "../parsers/barclaycard-annual";
import { reconstructRows } from "../import/layout";

function entry(): FileReview {
  const rows = reconstructRows(annualCardFixture().items);
  return {
    id: "annual",
    file: new File([], "fictional-annual-summary.pdf"),
    state: "review",
    progress: "Annual summary recognised",
    error: "",
    bank: "",
    accountId: "",
    manualPeriod: false,
    periodStart: "",
    periodEnd: "",
    optionsChanged: false,
    override: false,
    skip: true,
    open: true,
    showAll: false,
    invalidAmounts: [],
    extracted: {
      rows,
      hash: "annual",
      filename: "fictional-annual-summary.pdf",
      method: "embedded-text",
      warnings: [],
      summary: identifyBarclaycardAnnualSummary(rows),
    },
  };
}
beforeEach(cleanup);
describe("annual summary preview", () => {
  it("shows the printed period, separate issue date and read-only totals without corrective controls", () => {
    render(
      <ImportStatementReview
        entry={entry()}
        accounts={[]}
        categories={[]}
        history={[]}
        busy={false}
        patch={vi.fn()}
        reparse={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Barclaycard annual summary" }),
    ).toBeVisible();
    expect(screen.getByText("Summary only")).toBeVisible();
    expect(screen.getByText("1 Sep 2025")).toHaveAttribute(
      "datetime",
      "2025-09-01",
    );
    expect(screen.getByText("31 Aug 2026")).toHaveAttribute(
      "datetime",
      "2026-08-31",
    );
    expect(screen.getByText("4 Sep 2026")).toHaveAttribute(
      "datetime",
      "2026-09-04",
    );
    expect(screen.getByText("£3,210.45")).toBeVisible();
    expect(screen.getByText("£4.55")).toBeVisible();
    expect(screen.getByText("£23.40")).toBeVisible();
    expect(screen.getByText("£3,000.00")).toBeVisible();
    expect(
      screen.getByText(/Use monthly Barclaycard statements/),
    ).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("does not replace an unavailable period with the issue date", () => {
    const file = entry();
    file.extracted!.summary!.period = undefined;
    render(
      <ImportStatementReview
        entry={file}
        accounts={[]}
        categories={[]}
        history={[]}
        busy={false}
        patch={vi.fn()}
        reparse={vi.fn()}
      />,
    );
    expect(screen.getByText("Printed period unavailable")).toBeVisible();
    expect(screen.getByText("4 Sep 2026")).toBeVisible();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
