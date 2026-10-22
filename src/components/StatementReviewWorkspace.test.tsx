import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StatementReviewWorkspace } from "./StatementReviewWorkspace";
import { genericFixture } from "../import/generic/fixtures";
import { parseGenericStatement } from "../import/generic";
import type { FileReview } from "../import/review-model";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { knownBankItems } from "../tests/known-bank-layouts";
import { reconstructRows } from "../import/layout";
import { prepareDraft } from "../import/pipeline";

beforeEach(async () => {
  cleanup();
  await clearLocalData();
  await initializeDatabase();
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
afterAll(async () => {
  cleanup();
  await db.delete();
});
function entry(): FileReview {
  const f = genericFixture("T3"),
    result = parseGenericStatement(f.items, f.pages);
  return {
    id: "manual",
    file: new File([], "fictional-card.pdf"),
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
    extracted: {
      rows: [],
      hash: "fictional-manual",
      filename: "fictional-card.pdf",
      method: "embedded-text",
      warnings: [],
      generic: result,
    },
  };
}
function props(file = entry()) {
  return {
    entry: file,
    accounts: [],
    busy: false,
    onClose: vi.fn(),
    onContinue: vi.fn(),
    onDiagnostics: vi.fn(),
    onPrepareSource: vi.fn(),
    onSourceAction: vi.fn(),
    onOptions: vi.fn(),
    onAccount: vi.fn(),
    onMapping: vi.fn(),
    onSaveTemplate: vi.fn(),
    reparse: vi.fn(),
    correctSource: vi.fn(),
  };
}
describe("manual statement review workspace", () => {
  it("opens a neutral overview with separate tasks, without mounting the old diagnostic form", () => {
    const p = props();
    const { container } = render(<StatementReviewWorkspace {...p} />);
    expect(
      screen.getByRole("dialog", { name: "Statement overview" }),
    ).toBeVisible();
    expect(
      container.ownerDocument.querySelectorAll(
        ".notice,.review-row,.parse-options,.validation",
      ),
    ).toHaveLength(0);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Check transactions/ }));
    expect(
      screen.getByRole("dialog", { name: "Check transactions" }),
    ).toBeVisible();
    expect(p.onDiagnostics).not.toHaveBeenCalled();
  });
  it("edits one amount without category/type controls, preserving other source fields", () => {
    const p = props();
    render(<StatementReviewWorkspace {...p} initialSection="transactions" />);
    expect(
      screen
        .getAllByRole("button")
        .filter((b) => b.classList.contains("statement-row")),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /FICTIONAL SHOP/ }));
    expect(
      screen.getByRole("dialog", { name: "Correct amount" }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Category")).toBeNull();
    expect(screen.queryByLabelText("Type")).toBeNull();
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), {
      target: { value: "125.51" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    expect(p.onSourceAction).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        kind: "correct",
        amount: -12551,
        date: "2026-09-03",
        description: "FICTIONAL SHOP",
      }),
    );
    expect(p.entry.extracted!.generic!.parsed!.closingBalance).toBe(-92550);
    expect(p.onContinue).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Check transactions" }),
    ).toBeVisible();
  });
  it("cancels an unsaved edit without changing the source", () => {
    const p = props();
    render(<StatementReviewWorkspace {...p} initialSection="transactions" />);
    fireEvent.click(screen.getByRole("button", { name: /FICTIONAL SHOP/ }));
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), {
      target: { value: "9.99" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel correction" }));
    expect(p.onSourceAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /FICTIONAL SHOP/ }));
    expect(screen.getByLabelText("Amount (GBP)")).toHaveValue("125.50");
  });
  it("opens a date-only question while keeping the amount", () => {
    const p = props();
    p.entry.extracted!.generic!.rowChecks[1].readings[0].date = undefined;
    render(<StatementReviewWorkspace {...p} initialSection="transactions" />);
    fireEvent.click(screen.getByRole("button", { name: /FICTIONAL SHOP/ }));
    expect(screen.getByRole("dialog", { name: "Correct date" })).toBeVisible();
    expect(screen.getByText(/Amount kept:/)).toHaveTextContent("125.50");
    expect(
      screen.getByLabelText("Amount (GBP)").closest("details"),
    ).not.toHaveAttribute("open");
  });
  it("requires explicit diagnostic opt-in instead of using diagnostics as a manual fallback", () => {
    const p = props();
    render(<StatementReviewWorkspace {...p} />);
    expect(
      screen.getByRole("button", { name: /Statement totals/ }),
    ).toBeVisible();
    expect(p.onDiagnostics).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByText("Source and technical tools", { selector: "summary" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open diagnostic tools" }),
    );
    expect(p.onDiagnostics).toHaveBeenCalledTimes(1);
    expect(p.onSourceAction).not.toHaveBeenCalled();
  });
  it("keeps statement dates focused and validates them before re-reading", () => {
    const p = props();
    render(<StatementReviewWorkspace {...p} initialSection="reading" />);
    fireEvent.click(screen.getByRole("button", { name: /Statement dates/ }));
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "30092026" },
    });
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "01092026" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save dates and recheck" }),
    );
    expect(p.onOptions).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "01092026" },
    });
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "30092026" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save dates and recheck" }),
    );
    expect(p.onOptions).toHaveBeenCalledWith({
      manualPeriod: true,
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    });
  });
  it("prefills dates already recognized by the recovery reader", () => {
    const p = props();
    render(<StatementReviewWorkspace {...p} initialSection="reading" />);
    fireEvent.click(screen.getByRole("button", { name: /Statement dates/ }));
    expect(screen.getByLabelText("Start date")).toHaveValue("01/09/2026");
    expect(screen.getByLabelText("End date")).toHaveValue("30/09/2026");
    expect(p.onOptions).not.toHaveBeenCalled();
  });
  it("does not choose between identical source occurrences during native handoff", async () => {
    const items = knownBankItems("barclaycard").map((i) => ({
      ...i,
      fontSize: 8,
      parseSource: "text" as const,
    }));
    const extracted = {
      filename: "fictional-handoff.pdf",
      hash: "manual-native-handoff",
      method: "embedded-text" as const,
      warnings: [],
      rows: reconstructRows(items.map((i) => ({ ...i, y: i.y + i.height }))),
      extraction: {
        items,
        pages: [1, 2].map((page) => ({
          page,
          width: 600,
          height: 842,
          rotation: 0,
        })),
        quality: [],
        pageCount: 2,
        completedPages: [1, 2],
        unreadPages: [],
        cancelled: false,
        method: "text" as const,
      },
    };
    const native = await prepareDraft(extracted);
    const generic = await prepareDraft(
      extracted,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      { preferGeneric: true, skipCellOcr: true },
    );
    const p = props({ ...entry(), extracted, draft: native });
    const view = render(
      <StatementReviewWorkspace {...p} initialSection="transactions" />,
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: /FICTIONAL CAFE/i })[0],
    );
    expect(p.onPrepareSource).toHaveBeenCalledTimes(1);
    view.rerender(
      <StatementReviewWorkspace
        {...p}
        entry={{ ...p.entry, draft: generic }}
        initialSection="transactions"
      />,
    );
    expect(screen.queryByRole("dialog", { name: "Correct amount" })).toBeNull();
    expect(screen.getByText(/could not be matched uniquely/)).toBeVisible();
    fireEvent.click(
      screen.getAllByRole("button", { name: /FICTIONAL CAFE/i })[0],
    );
    expect(
      screen.getByRole("dialog", { name: "Correct amount" }),
    ).toBeVisible();
    expect(p.onSourceAction).not.toHaveBeenCalled();
    expect(generic.transactions).toHaveLength(6);
  });
});
