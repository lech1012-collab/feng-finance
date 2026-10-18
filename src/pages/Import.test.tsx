import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ImportPage from "./Import";
import { db, initializeDatabase } from "../storage/database";
import { clearLocalData } from "../storage/backup";
import { extractFile, type ExtractedFile } from "../import/pipeline";
import { genericFixture } from "../import/generic/fixtures";
import { reconstructRows } from "../import/layout";
import type { PdfImportSession } from "../import/pdf-session-types";

vi.mock("../import/pipeline", async (original) => ({
  ...(await original<typeof import("../import/pipeline")>()),
  extractFile: vi.fn(),
}));

beforeEach(async () => {
  configure({ asyncUtilTimeout: 5000 });
  vi.mocked(extractFile).mockReset();
  await clearLocalData();
  await initializeDatabase();
});
afterEach(() => cleanup());
afterAll(async () => {
  await db.delete();
});

function extracted(cancelled = false): ExtractedFile {
  const fixture = genericFixture("T6");
  const session: PdfImportSession = {
    id: "fictitious-session",
    hash: "fictitious-hash",
    filename: "fictitious.pdf",
    pageCount: cancelled ? 2 : 1,
    extract: vi.fn(),
    readCells: vi.fn(async () => []),
    crop: vi.fn(
      async () => new Blob(["fictitious crop"], { type: "image/png" }),
    ),
    dispose: vi.fn(async () => undefined),
  };
  return {
    rows: reconstructRows(
      fixture.items.map((item) => ({ ...item, y: item.y + item.height })),
    ),
    hash: session.hash,
    filename: session.filename,
    method: "embedded-text",
    warnings: [],
    pdfSession: session,
    extraction: {
      items: fixture.items,
      pages: fixture.pages,
      quality: [],
      pageCount: cancelled ? 2 : 1,
      completedPages: [1],
      unreadPages: cancelled ? [2] : [],
      cancelled,
      method: "text",
    },
  };
}
function show(files = [new File(["fictitious"], "fictitious.pdf")]) {
  return render(
    <MemoryRouter initialEntries={["/import"]}>
      <Routes>
        <Route
          path="/import"
          element={<ImportPage selectedFiles={files} onImported={vi.fn()} />}
        />
        <Route path="/" element={<h1>Home</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PDF review session lifecycle", () => {
  it("rechecks a repeated PDF after the earlier copy is left out, restoring its automatic row defaults", async () => {
    const earlier = extracted();
    const repeated = extracted();
    vi.mocked(extractFile)
      .mockResolvedValueOnce(earlier)
      .mockResolvedValueOnce(repeated);
    const { container } = show([
      new File([], "earlier.pdf"),
      new File([], "repeated.pdf"),
    ]);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Confirm import" }),
      ).toBeEnabled(),
    );
    const earlierCard = container.querySelector<HTMLElement>(
      ".import-statement-card",
    )!;
    fireEvent.click(earlierCard.querySelector(".import-statement-heading")!);
    fireEvent.click(
      within(earlierCard).getByRole("button", {
        name: "Leave out this statement",
      }),
    );
    expect(earlier.pdfSession!.dispose).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Confirm import" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Review next statement" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Recheck statement" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Confirm import" }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByRole("region", { name: "Batch review" }),
    ).toHaveTextContent("1 ready · 0 need attention · 1 skipped");
    expect(container.querySelector(".import-outcome-footer")).toHaveTextContent(
      "3 new",
    );
    expect(repeated.pdfSession!.dispose).not.toHaveBeenCalled();
    expect(extractFile).toHaveBeenCalledTimes(2);
    expect(await db.transactions.count()).toBe(0);
  });

  it("rechecks duplicate defaults both ways when an overlapping statement's selection changes", async () => {
    const firstSource = extracted();
    const laterSource = { ...extracted(), hash: "fictitious-regenerated-hash" };
    vi.mocked(extractFile)
      .mockResolvedValueOnce(firstSource)
      .mockResolvedValueOnce(laterSource);
    const { container } = show([
      new File([], "first.pdf"),
      new File([], "regenerated.pdf"),
    ]);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Confirm import" }),
      ).toBeEnabled(),
    );
    const card = (filename: string) =>
      [
        ...container.querySelectorAll<HTMLElement>(".import-statement-card"),
      ].find(
        (item) =>
          item.querySelector(".import-source-name")?.textContent === filename,
      )!;
    const original = () => card("first.pdf");
    const regenerated = () => card("regenerated.pdf");
    fireEvent.click(original().querySelector("summary")!);
    fireEvent.click(
      within(original()).getByRole("button", { name: "All transactions (3)" }),
    );
    const salaryRow = (card: HTMLElement) =>
      [...card.querySelectorAll<HTMLElement>(".review-row")].find((row) =>
        /fictional salary/i.test(
          row.querySelector(".review-compact strong")?.textContent ?? "",
        ),
      )!;
    fireEvent.click(salaryRow(original()).querySelector("summary")!);
    fireEvent.click(
      within(salaryRow(original())).getByRole("button", {
        name: "Exclude transaction",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Confirm import" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Review next statement" }),
    );
    fireEvent.click(
      within(regenerated()).getByRole("button", {
        name: "Recheck statement",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Confirm import" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      within(regenerated()).getByRole("button", {
        name: "All transactions (3)",
      }),
    );
    fireEvent.click(salaryRow(regenerated()).querySelector("summary")!);
    expect(
      within(salaryRow(regenerated())).getByRole("button", {
        name: "Exclude transaction",
      }),
    ).toBeVisible();
    // Restoring the original now discovers this row as a duplicate again.
    fireEvent.click(original().querySelector("summary")!);
    fireEvent.click(
      within(salaryRow(original())).getByRole("button", {
        name: "Include transaction",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review next statement" }),
    );
    fireEvent.click(
      within(regenerated()).getByRole("button", {
        name: "Recheck statement",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Confirm import" }),
      ).toBeEnabled(),
    );
    const duplicateRow = salaryRow(regenerated());
    fireEvent.click(duplicateRow.querySelector("summary")!);
    expect(
      within(duplicateRow).getByRole("button", {
        name: "Keep this checked transaction",
      }),
    ).toBeVisible();
    expect(
      within(duplicateRow).queryByRole("button", {
        name: "Exclude transaction",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(duplicateRow).getByText(/Known duplicate|Possible duplicate/),
    ).toBeVisible();
    expect(extractFile).toHaveBeenCalledTimes(2);
    expect(await db.transactions.count()).toBe(0);
  });

  it("appends another picker selection while preserving reviewed rows and live sources", async () => {
    const firstSource = extracted();
    const repeatedSource = extracted();
    vi.mocked(extractFile)
      .mockResolvedValueOnce(firstSource)
      .mockResolvedValueOnce(repeatedSource);
    const { container } = show();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Confirm import" }),
      ).toBeEnabled(),
    );
    expect(
      container.querySelectorAll(".import-statement-card[open]"),
    ).toHaveLength(0);
    fireEvent.click(container.querySelector(".import-statement-heading")!);
    fireEvent.click(
      screen.getByRole("button", { name: "All transactions (3)" }),
    );
    const firstRow = container.querySelector<HTMLElement>(".review-row")!;
    fireEvent.click(firstRow.querySelector("summary")!);
    await waitFor(() =>
      expect(
        within(firstRow).getByRole("option", { name: "Shopping" }),
      ).toBeInTheDocument(),
    );
    fireEvent.change(
      within(firstRow).getByLabelText("Category", { exact: true }),
      {
        target: { value: "shopping" },
      },
    );
    expect(
      within(firstRow).getByLabelText("Category", { exact: true }),
    ).toHaveValue("shopping");
    fireEvent.click(
      within(firstRow).getByRole("button", { name: "Exclude transaction" }),
    );
    const picker = screen.getByLabelText("Select statements", { exact: true });
    fireEvent.change(picker, {
      target: { files: [new File(["same fictitious PDF"], "repeated.pdf")] },
    });
    await screen.findByRole("heading", { name: "Review 2 statements" });
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Batch review" }),
      ).toHaveTextContent("1 ready · 0 need attention · 1 skipped"),
    );
    expect(
      screen.getByText("This PDF was selected more than once."),
    ).toBeInTheDocument();
    expect(firstSource.pdfSession!.dispose).not.toHaveBeenCalled();
    expect(repeatedSource.pdfSession!.dispose).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector(".import-statement-heading")!);
    const preserved = container.querySelector<HTMLElement>(".review-row")!;
    if (!(preserved as HTMLDetailsElement).open)
      fireEvent.click(preserved.querySelector("summary")!);
    expect(
      within(preserved).getByRole("button", { name: "Include transaction" }),
    ).toBeVisible();
    expect(
      within(preserved).getByLabelText("Category", { exact: true }),
    ).toHaveValue("shopping");
    expect(
      container.querySelectorAll(".import-statement-card[open]"),
    ).toHaveLength(1);
    fireEvent.change(
      screen.getByLabelText("Select statements", { exact: true }),
      {
        target: { files: [] },
      },
    );
    expect(
      screen.getByRole("heading", { name: "Review 2 statements" }),
    ).toBeVisible();
    expect(extractFile).toHaveBeenCalledTimes(2);
    expect(firstSource.pdfSession!.dispose).not.toHaveBeenCalled();
    expect(await db.transactions.count()).toBe(0);
    expect(await db.statements.count()).toBe(0);
  });

  it("opens and focuses the next failed statement, retaining ready files when one is left out", async () => {
    const source = extracted();
    vi.mocked(extractFile)
      .mockRejectedValueOnce(new Error("Fictitious malformed first PDF"))
      .mockResolvedValueOnce(source)
      .mockRejectedValueOnce(new Error("Fictitious malformed last PDF"));
    const { container } = show([
      new File([], "first-bad.pdf"),
      new File([], "ready.pdf"),
      new File([], "last-bad.pdf"),
    ]);
    const next = await screen.findByRole("button", {
      name: "Review next statement",
    });
    expect(
      screen.getByRole("region", { name: "Batch review" }),
    ).toHaveTextContent("1 ready · 2 need attention · 0 skipped");
    expect(
      container.querySelectorAll(".import-statement-card[open]"),
    ).toHaveLength(1);
    expect(
      container.querySelector(".import-statement-card[open] > summary"),
    ).toHaveTextContent("first-bad.pdf");
    fireEvent.click(next);
    const last = container.querySelector<HTMLElement>(
      ".import-statement-card[open]",
    )!;
    expect(last.querySelector("summary")).toHaveTextContent("last-bad.pdf");
    expect(last.querySelector("summary")).toHaveFocus();
    fireEvent.click(
      within(last).getByRole("button", { name: "Leave out this statement" }),
    );
    expect(
      screen.getByRole("button", { name: "Confirm import" }),
    ).toBeDisabled();
    fireEvent.click(next);
    const first = container.querySelector<HTMLElement>(
      ".import-statement-card[open]",
    )!;
    fireEvent.click(
      within(first).getByRole("button", { name: "Leave out this statement" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Confirm import" }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByRole("region", { name: "Batch review" }),
    ).toHaveTextContent("1 ready · 0 need attention · 2 skipped");
    expect(container.querySelectorAll(".import-statement-card")).toHaveLength(
      3,
    );
    expect(source.pdfSession!.dispose).not.toHaveBeenCalled();
    expect(await db.transactions.count()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    await screen.findByRole("heading", { name: "Home" });
    expect(await db.transactions.count()).toBe(3);
    expect(await db.statements.count()).toBe(1);
  });

  it("disposes the source on close without saving any records", async () => {
    const source = extracted();
    vi.mocked(extractFile).mockResolvedValue(source);
    show();
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: "Confirm import" }),
        ).toBeEnabled(),
      { timeout: 5000 },
    );
    fireEvent.click(screen.getByRole("link", { name: "Close import review" }));
    expect(
      await screen.findByRole("heading", { name: "Home" }, { timeout: 5000 }),
    ).toBeVisible();
    expect(source.pdfSession!.dispose).toHaveBeenCalledTimes(1);
    expect(await db.transactions.count()).toBe(0);
  });
  it("releases a skipped PDF and requires reading it again when unskipped", async () => {
    const source = extracted();
    const reread = extracted();
    vi.mocked(extractFile)
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(reread);
    const { container } = show();
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: "Confirm import" }),
        ).toBeEnabled(),
      { timeout: 5000 },
    );
    fireEvent.click(container.querySelector(".import-statement-heading")!);
    fireEvent.click(
      screen.getByRole("button", { name: "Leave out this statement" }),
    );
    expect(source.pdfSession!.dispose).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Include and recheck statement" }),
    );
    expect(
      screen.getByRole("button", { name: "Confirm import" }),
    ).toBeDisabled();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Confirm import" }),
      ).toBeEnabled(),
    );
    expect(extractFile).toHaveBeenCalledTimes(2);
    expect(reread.pdfSession!.dispose).not.toHaveBeenCalled();
    expect(await db.transactions.count()).toBe(0);
  });
  it("stops processing while retaining completed pages and explicitly marking the queued file unread", async () => {
    const source = extracted(true);
    vi.mocked(extractFile).mockImplementation(
      (_file, progress, _ocr, options) =>
        new Promise((resolve) => {
          progress("Reading scanned page 2 of 2");
          options?.signal?.addEventListener("abort", () => resolve(source), {
            once: true,
          });
        }),
    );
    const { container } = show([
      new File(["fictitious"], "fictitious.pdf"),
      new File(["fictitious"], "not-read.pdf"),
    ]);
    await within(
      screen.getByRole("region", { name: "Checking statements" }),
    ).findByText("Reading scanned page 2 of 2");
    fireEvent.click(screen.getByRole("button", { name: "Stop processing" }));
    await screen.findByRole("button", { name: "Review next statement" });
    expect(screen.getByText(/Not imported: unread pages 2/)).toBeVisible();
    expect(
      container.querySelectorAll(".import-statement-card[open]"),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Review next statement" }),
    );
    const unreadCard = container.querySelector(".import-statement-card[open]")!;
    expect(
      within(unreadCard as HTMLElement).getAllByText(
        "Processing was cancelled before this file was read. Parse again to check it.",
      )[0],
    ).toBeVisible();
    expect(
      container.querySelectorAll(".import-statement-card[open]"),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Confirm import" }),
    ).toBeDisabled();
    expect(vi.mocked(extractFile)).toHaveBeenCalledTimes(1);
    expect(source.pdfSession!.dispose).not.toHaveBeenCalled();
    expect(await db.transactions.count()).toBe(0);
  });
  it("confirms reconciled rows atomically and returns home with the source released", async () => {
    const source = extracted();
    vi.mocked(extractFile).mockResolvedValue(source);
    show();
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: "Confirm import" }),
        ).toBeEnabled(),
      { timeout: 5000 },
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    expect(
      await screen.findByRole("heading", { name: "Home" }, { timeout: 5000 }),
    ).toBeVisible();
    expect(source.pdfSession!.dispose).toHaveBeenCalledTimes(1);
    expect(await db.transactions.count()).toBe(3);
    expect((await db.statements.toArray())[0]).toMatchObject({
      validationStatus: "reconciled",
      validationPolicy: "exact-v2.2",
    });
  });
});
