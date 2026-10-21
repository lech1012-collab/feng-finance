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
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { useState } from "react";
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

function showAllStatements() {
  const all = within(
    screen.getByRole("group", { name: "Statement view" }),
  ).getByRole("button", { name: /^All statements \(\d+\)$/ });
  expect(all).toBeVisible();
  fireEvent.click(all);
  expect(all).toHaveAttribute("aria-pressed", "true");
}

function showStatementDetails(target?: HTMLElement) {
  const card =
    target ??
    document.querySelector(
      ".import-statement-card.import-statement-blocking[open]",
    ) ??
    document.querySelector(".import-statement-card[open]");
  if (target && !(target as HTMLDetailsElement).open)
    fireEvent.click(target.querySelector("summary")!);
  const details = card?.querySelector<HTMLDetailsElement>(
    ".import-statement-details",
  );
  if (details && !details.open) {
    fireEvent.click(details.querySelector("summary")!);
    fireEvent.click(
      screen.getByText("Source and technical tools", { selector: "summary" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open diagnostic tools" }),
    );
  }
}

function RetainedReview({
  files,
  pending,
}: {
  files: File[];
  pending: (count: number) => void;
}) {
  const location = useLocation();
  const [selected, setSelected] = useState(files);
  const visible = location.pathname === "/import";
  return (
    <>
      <Link to="/transactions">Transactions</Link>
      <Link to="/import">Resume import</Link>
      <div hidden={!visible} inert={!visible}>
        <ImportPage
          active={visible}
          selectedFiles={selected}
          onFilesStarted={() => setSelected([])}
          onPendingChange={pending}
          onImported={vi.fn()}
        />
      </div>
      <Routes>
        <Route path="/transactions" element={<h1>Transactions</h1>} />
        <Route path="/" element={<h1>Home</h1>} />
        <Route path="/import" element={null} />
      </Routes>
    </>
  );
}
describe("PDF review session lifecycle", () => {
  it("keeps extraction and its source alive across navigation, then resumes without reading files again", async () => {
    const source = extracted();
    let finish!: (value: ExtractedFile) => void;
    vi.mocked(extractFile).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = vi.fn();
    render(
      <MemoryRouter initialEntries={["/import"]}>
        <RetainedReview
          files={[new File([], "fictitious.pdf")]}
          pending={pending}
        />
      </MemoryRouter>,
    );
    await waitFor(() => expect(extractFile).toHaveBeenCalledOnce());
    expect(pending).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole("link", { name: "Transactions" }));
    expect(screen.getByRole("heading", { name: "Transactions" })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Review 1 statement" }),
    ).not.toBeInTheDocument();
    finish(source);
    await waitFor(() =>
      expect(document.querySelector(".import-batch-summary")).toHaveTextContent(
        "1 ready",
      ),
    );
    expect(source.pdfSession!.dispose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "Resume import" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Confirm import" }),
      ).toBeEnabled(),
    );
    expect(extractFile).toHaveBeenCalledOnce();
    expect(await db.transactions.count()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    await screen.findByRole("heading", { name: "Home" });
    expect(pending).toHaveBeenLastCalledWith(0);
    expect(source.pdfSession!.dispose).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("link", { name: "Resume import" }));
    expect(
      screen.getByRole("heading", { name: "Import statements" }),
    ).toBeVisible();
    expect(extractFile).toHaveBeenCalledOnce();
  });
  it("suspends a correction while navigating and retains the exact unfinished decimal on return", async () => {
    const source = extracted();
    vi.mocked(extractFile).mockResolvedValue(source);
    const view = render(
      <MemoryRouter initialEntries={["/import"]}>
        <RetainedReview
          files={[new File([], "fictitious.pdf")]}
          pending={vi.fn()}
        />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Confirm import" }),
      ).toBeEnabled(),
    );
    showAllStatements();
    fireEvent.click(document.querySelector(".import-statement-heading")!);
    showStatementDetails();
    fireEvent.click(
      screen.getByRole("button", { name: "All transactions (3)" }),
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Correct amount for / })[0],
    );
    const input = await screen.findByLabelText("Amount (GBP)");
    fireEvent.change(input, { target: { value: "12." } });
    fireEvent.click(screen.getByRole("link", { name: "Transactions" }));
    expect(
      screen.queryByRole("dialog", { name: "Correct amount" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Resume import" }));
    expect(screen.getByLabelText("Amount (GBP)")).toHaveValue("12.");
    expect(extractFile).toHaveBeenCalledOnce();
    expect(await db.transactions.count()).toBe(0);
    view.unmount();
  });
  it("discards only an explicitly confirmed pending review and releases its source", async () => {
    const source = extracted();
    vi.mocked(extractFile).mockResolvedValue(source);
    const pending = vi.fn();
    render(
      <MemoryRouter initialEntries={["/import"]}>
        <RetainedReview
          files={[new File([], "fictitious.pdf")]}
          pending={pending}
        />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Confirm import" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard review" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep review" }));
    expect(source.pdfSession!.dispose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard review" }));
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Discard this review?" }),
      ).getByRole("button", { name: "Discard review" }),
    );
    expect(
      screen.getByRole("heading", { name: "Import statements" }),
    ).toBeVisible();
    expect(pending).toHaveBeenLastCalledWith(0);
    expect(source.pdfSession!.dispose).toHaveBeenCalledOnce();
    expect(await db.transactions.count()).toBe(0);
  });
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
    showAllStatements();
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
    showStatementDetails();
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
    showAllStatements();
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
    showStatementDetails();
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
    showStatementDetails();
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
    showStatementDetails(regenerated());
    if (!(salaryRow(regenerated()) as HTMLDetailsElement).open)
      fireEvent.click(salaryRow(regenerated()).querySelector("summary")!);
    expect(
      within(salaryRow(regenerated())).getByRole("button", {
        name: "Exclude transaction",
      }),
    ).toBeVisible();
    // Restoring the original now discovers this row as a duplicate again.
    fireEvent.click(original().querySelector("summary")!);
    showStatementDetails();
    fireEvent.click(
      within(salaryRow(original())).getByRole("button", {
        name: "Include transaction",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review next statement" }),
    );
    showStatementDetails();
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
    showStatementDetails(regenerated());
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
    showAllStatements();
    expect(
      container.querySelectorAll(".import-statement-card[open]"),
    ).toHaveLength(0);
    fireEvent.click(container.querySelector(".import-statement-heading")!);
    showStatementDetails();
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
    showStatementDetails();
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

  it("releases the source when the entire host unmounts without saving any records", async () => {
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
    fireEvent.click(screen.getByRole("link", { name: "Leave review" }));
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
    showAllStatements();
    fireEvent.click(container.querySelector(".import-statement-heading")!);
    showStatementDetails();
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
    showStatementDetails();
    expect(screen.getByText(/Not imported: unread pages 2/)).toBeVisible();
    expect(
      container.querySelectorAll(".import-statement-card[open]"),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Review next statement" }),
    );
    showStatementDetails();
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
  it("opens manual native amount correction without waiting for numeric OCR and still blocks a wrong correction", async () => {
    const source = extracted();
    source.extraction!.items[0].text = "Barclays";
    source.extraction!.items.find(
      (item) => item.text === "100.00" && item.y === 240,
    )!.text = "101.00";
    source.rows = reconstructRows(
      source.extraction!.items.map((item) => ({
        ...item,
        y: item.y + item.height,
      })),
    );
    // This would never finish if the manual editor accidentally awaited OCR.
    vi.mocked(source.pdfSession!.readCells).mockImplementation(
      () => new Promise(() => undefined),
    );
    vi.mocked(extractFile).mockResolvedValue(source);
    show();
    await screen.findByRole("button", { name: "Review statement" });
    showStatementDetails();
    fireEvent.click(
      await screen.findByRole("button", { name: "All transactions (3)" }),
    );
    expect(
      screen.getByText(/Dates and amounts come from the bank reader/),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: /Correct amount for .*shop/i }),
    );
    const editor = await screen.findByRole("dialog", {
      name: "Correct amount",
    });
    expect(within(editor).getByLabelText("Amount (GBP)")).toHaveValue("101.00");
    expect(source.pdfSession!.readCells).not.toHaveBeenCalled();
    fireEvent.change(within(editor).getByLabelText("Amount (GBP)"), {
      target: { value: "102.00" },
    });
    fireEvent.click(
      within(editor).getByRole("button", { name: "Save amount" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Rechecking source rows…"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Confirm import" }),
    ).toBeDisabled();
    expect(source.pdfSession!.readCells).not.toHaveBeenCalled();
    expect(await db.transactions.count()).toBe(0);
    expect(
      source.extraction!.items.some((item) => item.text === "101.00"),
    ).toBe(true);
  });
  it("prevents discard throughout asynchronous confirm preflight before any financial write", async () => {
    const source = extracted();
    vi.mocked(extractFile).mockResolvedValue(source);
    show();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Confirm import" }),
      ).toBeEnabled(),
    );
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const deferred = db.transactions.bulkGet([]).then(async (rows) => {
      await gate;
      return rows;
    });
    const spy = vi
      .spyOn(db.transactions, "bulkGet")
      .mockReturnValueOnce(deferred);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
      expect(
        screen.getByRole("button", { name: "Discard review" }),
      ).toBeDisabled();
      expect(
        screen.getByText("Checking statements before saving…"),
      ).toBeVisible();
      expect(await db.transactions.count()).toBe(0);
      finish();
      await screen.findByRole("heading", { name: "Home" });
      expect(await db.transactions.count()).toBe(3);
    } finally {
      finish();
      spy.mockRestore();
    }
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
