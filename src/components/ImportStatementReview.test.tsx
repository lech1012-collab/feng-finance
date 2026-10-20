import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ImportStatementReview } from "./ImportStatementReview";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { prepareDraft, draftReconciliation } from "../import/pipeline";
import { importBlockers, type FileReview } from "../import/review-model";
import { bankRows } from "../tests/helpers";
import { genericFixture } from "../import/generic/fixtures";
import { reconstructRows } from "../import/layout";

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
  const showReview = async (
    entry: FileReview,
    patch: (change: Partial<FileReview>) => void = () => undefined,
  ) => {
    const view = render(
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
    fireEvent.click(
      screen.getByText("Statement details", { selector: "summary" }),
    );
    return view;
  };

  it.each([false, true])(
    "discloses required QIF identity controls only before a draft is prepared (prepared=%s)",
    async (prepared) => {
      const entry = await reviewEntry();
      entry.file = new File([], "fictional.qif");
      entry.extracted = {
        rows: [],
        hash: "fictional-qif-identity",
        filename: "fictional.qif",
        method: "QIF",
        format: "qif",
        text: "!Type:Bank\nD09/10/2026\nT-15.00\nPFICTITIOUS QIF PURCHASE\n^\n",
        warnings: [],
      };
      if (!prepared) {
        entry.draft = undefined;
        entry.state = "error";
        entry.error = "Choose the bank and account for this QIF export.";
      }
      const { container } = await showReview(entry);
      const options = container.querySelector(".parse-options");
      if (prepared) {
        expect(options).not.toHaveAttribute("open");
        expect(
          within(options as HTMLElement).getByLabelText("Bank", {
            exact: true,
          }),
        ).not.toBeVisible();
        expect(importBlockers(entry)).toEqual([]);
      } else {
        expect(options).toHaveAttribute("open");
        expect(screen.getByRole("combobox", { name: "Bank" })).toBeVisible();
        expect(screen.getByRole("combobox", { name: "Account" })).toBeVisible();
        expect(
          screen.getByRole("combobox", { name: "QIF date format" }),
        ).toBeVisible();
        expect(importBlockers(entry)).toEqual([entry.error]);
      }
      expect(await db.transactions.count()).toBe(0);
    },
  );

  it("keeps correct row editors on demand and provides no routine checkboxes", async () => {
    const entry = await reviewEntry();
    entry.showAll = true;
    const { container } = await showReview(entry);
    expect(container.querySelectorAll(".review-row input")).toHaveLength(0);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(container.querySelector(".review-compact")!);
    expect(
      screen.getByRole("button", { name: "Exclude transaction" }),
    ).toBeVisible();
    expect(
      container.querySelectorAll(".review-row:not([open]) input"),
    ).toHaveLength(0);
    expect(
      container.querySelectorAll(".review-row[open] input").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it.each(["normal", "excluded", "uncertain", "duplicate"])(
    "mutates only the intended %s row with a named action",
    async (kind) => {
      const entry = await reviewEntry();
      entry.showAll = true;
      const first = entry.draft!.transactions[0];
      if (kind === "excluded" || kind === "duplicate") first.include = false;
      if (kind === "uncertain") {
        first.extractionConfidence = 0.6;
        first.acknowledged = false;
      }
      if (kind === "duplicate") {
        first.duplicate = "possible";
        first.acknowledged = false;
      }
      const patch = vi.fn();
      const { container } = await showReview(entry, patch);
      const row = [
        ...container.querySelectorAll<HTMLDetailsElement>(".review-row"),
      ].find((item) => item.textContent?.includes("John Lewis"))!;
      if (!row.open) fireEvent.click(row.querySelector("summary")!);
      const label =
        kind === "duplicate"
          ? "Keep this checked transaction"
          : kind === "uncertain"
            ? "Amount is correct"
            : kind === "excluded"
              ? "Include transaction"
              : "Exclude transaction";
      fireEvent.click(within(row).getByRole("button", { name: label }));
      const changed = patch.mock.calls.at(-1)![0].draft;
      expect(changed.transactions.slice(1)).toEqual(
        entry.draft!.transactions.slice(1),
      );
      expect(changed.transactions[0]).toMatchObject({
        include: kind !== "normal",
        ...(kind === "duplicate" || kind === "uncertain"
          ? { acknowledged: true }
          : {}),
        amount: first.amount,
        date: first.date,
        sourcePage: first.sourcePage,
      });
    },
  );

  it.each([false, true])(
    "accepts or undoes only the displayed statement warnings (accepted=%s)",
    async (accepted) => {
      const entry = await reviewEntry();
      entry.draft!.warnings = [
        "Fictitious statement warning to compare with the original",
      ];
      entry.draft!.reviewedWarnings = accepted;
      const patch = vi.fn();
      await showReview(entry, patch);
      fireEvent.click(
        screen.getByRole("button", {
          name: accepted
            ? "Undo warning acceptance"
            : "Accept these statement warnings",
        }),
      );
      expect(patch.mock.calls.at(-1)![0].draft).toEqual({
        ...entry.draft,
        reviewedWarnings: !accepted,
      });
    },
  );

  it("requires one explicit financial sheet, keeps cancellation inert and acceptance unverified", async () => {
    const entry = await reviewEntry();
    entry.draft!.transactions[0].amount -= 1;
    const patch = vi.fn();
    await showReview(entry, patch);
    const trigger = screen.getByRole("button", { name: "Import anyway…" });
    fireEvent.click(trigger);
    let dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("Balance difference").nextElementSibling,
    ).toHaveTextContent("+£0.01");
    expect(
      within(dialog).getByRole("button", {
        name: "Accept unverified statement",
      }),
    ).toBeDisabled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Continue reviewing" }),
    );
    expect(patch).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Accept unverified statement",
      }),
    );
    const accepted = { ...entry, ...patch.mock.calls.at(-1)![0] };
    expect(accepted.override).toBe(true);
    expect(draftReconciliation(accepted.draft!).status).toBe("warning");
    expect(importBlockers(accepted)).toEqual([]);
    expect(accepted.draft!.transactions).toEqual(entry.draft!.transactions);
  });

  it("prevents financial acceptance while a corrected amount is invalid", async () => {
    const entry = await reviewEntry();
    entry.draft!.transactions[0].amount -= 1;
    entry.invalidAmounts = [entry.draft!.transactions[0].id];
    const patch = vi.fn();
    await showReview(entry, patch);
    expect(
      screen.getByRole("button", { name: "Import anyway…" }),
    ).toBeDisabled();
    expect(patch).not.toHaveBeenCalled();
    expect(importBlockers(entry)).toContain("Correct the invalid amounts.");
  });

  it.each([
    ["changed parser options", "Parse again"],
    ["invalid amount", "Correct invalid amounts"],
    ["invalid date", "Statement needs review"],
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
    expect(card?.querySelector("summary .ui-chip-visual")).toHaveTextContent(
      label,
    );
    expect(
      card?.querySelector("summary .ui-chip-visual"),
    ).not.toHaveTextContent("✓ Reconciled");
    // Date validation can fail even when the arithmetic difference is zero.
    // Keep the figures visible without calling the whole statement reconciled.
    if (kind === "invalid date") {
      expect(container.querySelector(".validation strong")).toHaveTextContent(
        "Statement needs review",
      );
      expect(screen.getByText("Difference")).toBeInTheDocument();
      expect(screen.getAllByText("£0.00").length).toBeGreaterThan(0);
    } else {
      expect(screen.getByText("✓ Statement reconciled")).toBeInTheDocument();
    }
  });

  it("clears the blocking status only after all review blockers are resolved", async () => {
    const entry = await reviewEntry();
    expect(importBlockers(entry)).toEqual([]);
    const { container } = await showReview(entry);
    expect(container.querySelector(".import-statement-card")).not.toHaveClass(
      "import-statement-blocking",
    );
    expect(
      container.querySelector("summary .ui-chip-visual"),
    ).toHaveTextContent("✓ Reconciled");
  });

  it("identifies a retryable save error without reporting a source reading failure", async () => {
    const entry = await reviewEntry();
    entry.error = "Fictitious storage failure after an earlier statement saved";
    expect(importBlockers(entry)).toEqual([]);
    const { container } = await showReview(entry);
    expect(
      container.querySelector("summary .ui-chip-visual"),
    ).toHaveTextContent("Couldn't save statement");
    expect(screen.getByText("This statement couldn't be saved")).toBeVisible();
    expect(
      screen.queryByText("This statement couldn't be read"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /Previously saved statements will not be imported twice/,
      ),
    ).toBeVisible();
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
    expect(
      container.querySelector("summary .ui-chip-visual"),
    ).toHaveTextContent("Recheck statement");
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
    expect(
      container.querySelector("summary .ui-chip-visual"),
    ).toHaveTextContent("Will be skipped");
  });

  it("hides empty duplicate notices while retaining the statement figures and original description", async () => {
    const entry = await reviewEntry();
    entry.showAll = true;
    const row = entry.draft!.transactions[0];
    row.description = "CARD PAYMENT TO WAITROSE FULHAM";
    row.merchant = "WAITROSE FULHAM";
    const source = structuredClone(entry.draft);
    const { container } = await showReview(entry);
    expect(
      screen.queryByText(/possible or confirmed duplicate transaction/),
    ).not.toBeInTheDocument();
    fireEvent.click(container.querySelector(".review-compact")!);
    expect(container.querySelector(".review-compact strong")).toHaveTextContent(
      "Waitrose",
    );
    expect(screen.getByText(row.description)).toBeInTheDocument();
    expect(screen.getByText("Opening balance")).toBeInTheDocument();
    expect(
      screen.getByText("Money in (including transfers)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Money out (including transfers)"),
    ).toBeInTheDocument();
    expect(entry.draft).toEqual(source);
  });

  it("retains a duplicate warning when any extracted row is a potential duplicate", async () => {
    const entry = await reviewEntry();
    entry.draft!.transactions[0].duplicate = "possible";
    entry.draft!.transactions[0].include = false;
    await showReview(entry);
    expect(
      screen.getByText(/1 possible or confirmed duplicate transaction/),
    ).toBeInTheDocument();
    expect(entry.draft!.transactions[0].include).toBe(false);
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

  it("protects native financial readings from unrechecked edits while keeping categorization editable", async () => {
    const fixture = genericFixture("T1");
    const draft = await prepareDraft({
      rows: reconstructRows(
        fixture.items.map((item) => ({ ...item, y: item.y + item.height })),
      ),
      hash: "recognised-source-correction",
      filename: "fictional-recognised.pdf",
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
    });
    expect(draft.parserFallback).toBe(true);
    const entry = { ...(await reviewEntry()), draft, showAll: true };
    const patch = vi.fn();
    const onSourceAction = vi.fn();
    const onReviewSource = vi.fn();
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
          onSourceAction={onSourceAction}
          onReviewSource={onReviewSource}
        />
      </MemoryRouter>,
    );
    fireEvent.click(document.querySelector(".review-compact")!);
    const row = draft.transactions[0];
    expect(
      screen.queryByRole("textbox", { name: `Amount for ${row.description}` }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /^Date$/ }),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector(`.review-row time[datetime="${row.date}"]`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Tap an amount to correct its source value/),
    ).toBeInTheDocument();
    expect(onSourceAction).not.toHaveBeenCalled();
    expect(patch.mock.calls.some(([change]) => change.draft)).toBe(false);
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Correct amount for / })[0],
    );
    expect(onReviewSource).toHaveBeenCalledWith(row);
    expect(onSourceAction).not.toHaveBeenCalled();
    fireEvent.change(screen.getAllByLabelText("Category", { exact: true })[0], {
      target: { value: "salary" },
    });
    expect(patch.mock.calls.at(-1)?.[0].draft.transactions[0]).toMatchObject({
      categoryId: "salary",
      amount: row.amount,
      date: row.date,
    });
  });
});
