import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  GenericImportReview,
  type GenericImportReviewProps,
} from "./GenericImportReview";
import type {
  GenericParseResult,
  RowCheck,
  SourceRect,
} from "../import/generic/types";

const rect: SourceRect = { page: 1, x: 20, y: 300, width: 550, height: 25 };
function flaggedRow(): RowCheck {
  return {
    rowId: "row-1",
    checkLevel: "review",
    parseSource: "text",
    rect,
    amountRects: [rect],
    balanceRects: [rect],
    previousBalance: 10000,
    calculatedBalance: 7501,
    reportedBalance: 7500,
    difference: 1,
    readings: [
      {
        id: "reading-1",
        date: "2026-09-05",
        description: "FICTIONAL STORE",
        amount: -2499,
        balanceAfterTransaction: 7500,
        parseSource: "text",
      },
      {
        id: "reading-ocr",
        date: "2026-09-05",
        description: "FICTIONAL STORE",
        amount: -2500,
        balanceAfterTransaction: 7500,
        parseSource: "ocr",
      },
    ],
    selectedReadingId: "reading-1",
    issues: ["balance-difference"],
    resolved: false,
  };
}
function resultFixture(): GenericParseResult {
  return {
    status: "mapping-required",
    parsed: {
      institution: "Other",
      accountType: "current",
      accountIdentifier: "•••• 1234",
      currency: "GBP",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      openingBalance: 10000,
      closingBalance: 7500,
      transactions: [],
      warnings: [],
    },
    table: {
      pages: [{ page: 1, width: 595, height: 842, rotation: 0 }],
      columns: [
        {
          id: "date",
          x0: 10,
          x1: 100,
          headerText: "Date",
          alignment: "left",
          inferredRole: "date",
        },
        {
          id: "description",
          x0: 100,
          x1: 400,
          headerText: "Details",
          alignment: "left",
          inferredRole: "description",
        },
        {
          id: "amount",
          x0: 400,
          x1: 490,
          headerText: "Amount",
          alignment: "right",
          inferredRole: "amount",
        },
        {
          id: "balance",
          x0: 490,
          x1: 580,
          headerText: "Balance",
          alignment: "right",
          inferredRole: "balance",
        },
      ],
      rows: [
        {
          id: "row-1",
          kind: "transaction",
          rect,
          cells: [
            { columnId: "date", text: "5 Sep", rect, parseSource: "text" },
            {
              columnId: "description",
              text: "FICTIONAL STORE",
              rect,
              parseSource: "text",
            },
            { columnId: "amount", text: "-24.99", rect, parseSource: "text" },
            { columnId: "balance", text: "75.00", rect, parseSource: "text" },
          ],
        },
      ],
    },
    rowChecks: [flaggedRow()],
    candidates: [],
    layoutFingerprint: "synthetic-layout",
    mapping: {
      columnRoles: [
        { columnId: "date", role: "date" },
        { columnId: "description", role: "description" },
        { columnId: "amount", role: "amount" },
        { columnId: "balance", role: "balance" },
      ],
      signConvention: "signed_positive_in",
      dateFormat: "auto",
    },
    checks: {
      policy: "exact-v2.2",
      reconciliation: {
        status: "warning",
        calculated: 7501,
        reported: 7500,
        difference: 1,
      },
      calculatedMoneyIn: 0,
      calculatedMoneyOut: 2499,
      balanceRowsPassed: 0,
      balanceRowsFailed: 1,
      totalCheckedRows: 0,
      needsReviewRows: 1,
      unreadPages: [],
      evidence: ["running-balances", "opening-closing"],
      reconciledExactly: false,
    },
  };
}
function show(
  result = resultFixture(),
  props: Partial<GenericImportReviewProps> = {},
) {
  const callbacks = {
    onAction: vi.fn(),
    onMapping: vi.fn(),
    onSaveTemplate: vi.fn(),
    onImportAnyway: vi.fn(),
  };
  const view = render(
    <GenericImportReview
      result={result}
      busy={false}
      {...callbacks}
      {...props}
    />,
  );
  return { ...view, ...callbacks };
}
beforeEach(() => {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:local-synthetic-crop");
      static revokeObjectURL = vi.fn();
    },
  );
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.open = false;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("generic PDF evidence review", () => {
  it("opens the specifically requested verified row even beyond the first ten rows, without saving it", () => {
    const result = resultFixture();
    result.status = "parsed";
    result.checks.needsReviewRows = 0;
    result.rowChecks = Array.from({ length: 12 }, (_, index) => ({
      ...flaggedRow(),
      rowId: `row-${index}`,
      checkLevel: "balance",
      resolved: true,
      issues: [],
    }));
    const { onAction } = show(result, {
      correctionRequest: { id: "direct-request", rowId: "row-11" },
    });
    expect(
      screen.getByRole("dialog", { name: "Correct transaction amount" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Amount (GBP)")).toHaveValue("24.99");
    fireEvent.click(screen.getByRole("button", { name: "Cancel correction" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();
  });
  it("shows a one-penny difference and requires explicit confirmation before import anyway", () => {
    const { onImportAnyway } = show();
    expect(screen.getByText(/^Balance difference:/)).toHaveTextContent(
      "Balance difference: +£0.01. Every penny must match.",
    );
    expect(
      screen.queryByText("Statement figures match exactly"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Map columns" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import anyway…" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", {
        name: "Accept unverified statement",
      }),
    ).toBeDisabled();
    expect(onImportAnyway).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Accept unverified statement",
      }),
    );
    expect(onImportAnyway).toHaveBeenCalledExactlyOnceWith();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("retains invalid source rows and prevents accepting or overriding unread values", () => {
    const result = resultFixture();
    result.rowChecks[0].readings = [
      {
        id: "unread",
        rawDate: "? Sept",
        rawAmount: "2?.99",
        description: "FICTIONAL STORE",
        parseSource: "text",
      },
    ];
    result.rowChecks[0].selectedReadingId = "unread";
    result.rowChecks[0].issues = ["invalid-date", "invalid-amount"];
    show(result);
    expect(screen.getByText("? Sept")).toBeInTheDocument();
    expect(screen.getByText("2?.99")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Use reading 1" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Import anyway…" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Correct amount" }),
    ).toBeEnabled();
  });

  it("emits the chosen alternative, exact signed correction and source-row exclusion", () => {
    const { onAction } = show();
    fireEvent.click(screen.getByText(/Compare extracted readings/));
    fireEvent.click(screen.getByRole("button", { name: "Use reading 2" }));
    expect(onAction).toHaveBeenLastCalledWith("row-1", {
      kind: "accept",
      readingId: "reading-ocr",
    });
    fireEvent.click(screen.getByRole("button", { name: "Correct amount" }));
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), {
      target: { value: "-25.00" },
    });
    fireEvent.change(screen.getByLabelText("Description", { exact: true }), {
      target: { value: "Corrected fictional store" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save row" }));
    expect(onAction).toHaveBeenLastCalledWith("row-1", {
      kind: "correct",
      date: "2026-09-05",
      description: "Corrected fictional store",
      amount: -2500,
      balanceAfterTransaction: 7500,
    });
    fireEvent.click(screen.getByRole("button", { name: "Exclude row" }));
    expect(onAction).toHaveBeenLastCalledWith("row-1", { kind: "exclude" });
    expect(
      screen.getByText(/Duplicate rows are handled separately/),
    ).toBeInTheDocument();
  });

  it("rejects ambiguous or excess-precision corrections without emitting a mutation", () => {
    const { onAction } = show();
    fireEvent.click(screen.getByRole("button", { name: "Correct amount" }));
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), {
      target: { value: "25.001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save row" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid date");
    expect(onAction).not.toHaveBeenCalled();
  });

  it("rechecks column changes and saves a named mapping without relying on filenames", () => {
    const { onMapping, onSaveTemplate } = show();
    fireEvent.click(screen.getByRole("button", { name: "Map columns" }));
    fireEvent.change(
      screen.getByRole("combobox", { name: "Role for Amount on page 1" }),
      { target: { value: "out" } },
    );
    const changed = onMapping.mock.calls[0][0];
    expect(changed.columnRoles).toContainEqual({
      columnId: "amount",
      role: "out",
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Amount signs" }), {
      target: { value: "in_out_columns" },
    });
    fireEvent.change(screen.getByLabelText("Layout name"), {
      target: { value: "  Personal current account  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
    expect(onSaveTemplate).toHaveBeenCalledWith(
      "Personal current account",
      expect.objectContaining({
        signConvention: "in_out_columns",
        columnRoles: expect.arrayContaining([
          { columnId: "amount", role: "out" },
        ]),
      }),
    );
    expect(
      screen.getByRole("region", { name: "Column preview, page 1" }),
    ).toHaveAttribute("tabindex", "0");
  });

  it("keeps column samples accessible when metadata cannot yet produce a parsed statement", () => {
    const result = resultFixture();
    result.status = "identity-required";
    result.parsed = undefined;
    result.errorCode = "missing-period";
    const { container } = show(result);
    fireEvent.click(screen.getByRole("button", { name: "Map columns" }));
    expect(
      screen.getByRole("region", { name: "Column preview, page 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import anyway…" }),
    ).toBeDisabled();
    expect(
      container.querySelector(".generic-mapping-column li")?.textContent,
    ).toBe("5 Sep");
  });

  it("labels credit-card proof as totals only and does not claim individual row proof", () => {
    const result = resultFixture();
    result.status = "parsed";
    result.rowChecks = [
      {
        ...flaggedRow(),
        checkLevel: "total",
        issues: [],
        resolved: true,
        difference: undefined,
      },
    ];
    result.checks = {
      ...result.checks,
      reconciliation: { status: "reconciled", difference: 0 },
      totalCheckedRows: 1,
      needsReviewRows: 0,
      balanceRowsFailed: 0,
      evidence: ["printed-movement-totals"],
      reconciledExactly: true,
    };
    show(result);
    expect(
      screen.getByText("Checked against statement total"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no running balance to prove each individual row/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Import anyway…" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Needs review (0)")).not.toBeInTheDocument();
  });

  it("loads crops locally, aborts on unmount and revokes created object URLs", async () => {
    const crop = vi.fn(
      async (_rect: SourceRect, _options?: { signal?: AbortSignal }) =>
        new Blob(["synthetic image"], { type: "image/png" }),
    );
    const { unmount } = show(resultFixture(), { session: { crop } });
    await waitFor(() =>
      expect(
        screen.getByAltText("Original statement row on page 1"),
      ).toHaveAttribute("src", "blob:local-synthetic-crop"),
    );
    expect(crop).toHaveBeenCalledWith(rect, {
      signal: expect.any(AbortSignal),
    });
    const signal = crop.mock.calls[0][1]!.signal!;
    unmount();
    expect(signal.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:local-synthetic-crop",
    );
  });

  it("does not create previews for collapsed reviewed rows or render all large lists at once", () => {
    const result = resultFixture();
    result.rowChecks = Array.from({ length: 35 }, (_, index) => ({
      ...flaggedRow(),
      rowId: `row-${index}`,
      resolved: true,
      reviewAction: { kind: "accept", readingId: "reading-1" },
    }));
    result.checks.needsReviewRows = 0;
    const crop = vi.fn();
    const { container } = show(result, { session: { crop } });
    expect(crop).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".generic-review-row")).toHaveLength(10);
    fireEvent.click(
      screen.getByRole("button", { name: "Show next 10 rows (25 remaining)" }),
    );
    expect(container.querySelectorAll(".generic-review-row")).toHaveLength(20);
  });

  it("renders statement text as text, never as statement-supplied HTML", () => {
    const result = resultFixture();
    result.rowChecks[0].readings[0].description =
      '<img src="https://example.invalid/financial-data">';
    result.table.rows[0].cells[1].text = "<script>stealStatement()</script>";
    const { container } = show(result);
    fireEvent.click(screen.getByRole("button", { name: "Map columns" }));
    expect(container.querySelectorAll("script,img")).toHaveLength(0);
    expect(
      screen.getByText("<script>stealStatement()</script>"),
    ).toBeInTheDocument();
  });

  it("makes unread pages explicit in partial-import confirmation and lets the user cancel safely", () => {
    const result = resultFixture();
    result.checks.unreadPages = [2, 3];
    const { onImportAnyway } = show(result);
    expect(
      screen.getByText(/Not imported: unread pages 2, 3/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Map columns" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import anyway…" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/Pages 2, 3 have not been read/),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Continue reviewing" }),
    );
    expect(onImportAnyway).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import anyway…" }),
    ).toHaveFocus();
  });

  it("never creates an object URL after a pending crop is discarded", async () => {
    let complete: (blob: Blob) => void = () => undefined;
    const crop = vi.fn(
      (_rect: SourceRect, _options?: { signal?: AbortSignal }) =>
        new Promise<Blob>((resolve) => {
          complete = resolve;
        }),
    );
    const { unmount } = show(resultFixture(), { session: { crop } });
    unmount();
    complete(new Blob(["late synthetic crop"]));
    await Promise.resolve();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(crop.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });

  it("shows an actionable local-preview failure without losing the row", async () => {
    const crop = vi.fn(async () => {
      throw new Error("No preview");
    });
    show(resultFixture(), { session: { crop } });
    expect(
      await screen.findByText(
        /Preview unavailable. Compare this row with the original PDF/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Correct amount" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Use reading 2" })).toBeEnabled();
  });
});
