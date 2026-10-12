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
  fireEvent,
  render,
  screen,
  waitFor,
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
  it("disposes the source on close without saving any records", async () => {
    const source = extracted();
    vi.mocked(extractFile).mockResolvedValue(source);
    show();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Confirm import" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("link", { name: "Close import review" }));
    expect(await screen.findByRole("heading", { name: "Home" })).toBeVisible();
    expect(source.pdfSession!.dispose).toHaveBeenCalledTimes(1);
    expect(await db.transactions.count()).toBe(0);
  });
  it("releases a skipped PDF and requires reading it again when unskipped", async () => {
    const source = extracted();
    vi.mocked(extractFile).mockResolvedValue(source);
    show();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Confirm import" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByLabelText(
        "Skip this file. No records from this statement will be saved.",
      ),
    );
    expect(source.pdfSession!.dispose).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByLabelText(
        "Skip this file. No records from this statement will be saved.",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Confirm import" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Parse again", { selector: ".small-chip" }),
    ).toBeVisible();
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
    show([
      new File(["fictitious"], "fictitious.pdf"),
      new File(["fictitious"], "not-read.pdf"),
    ]);
    await screen.findByText("Reading scanned page 2 of 2");
    fireEvent.click(screen.getByRole("button", { name: "Stop processing" }));
    await screen.findByText(
      "Processing was cancelled before this file was read. Parse again to check it.",
    );
    expect(screen.getByText(/Not imported: unread pages 2/)).toBeVisible();
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
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Confirm import" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    expect(await screen.findByRole("heading", { name: "Home" })).toBeVisible();
    expect(source.pdfSession!.dispose).toHaveBeenCalledTimes(1);
    expect(await db.transactions.count()).toBe(3);
    expect((await db.statements.toArray())[0]).toMatchObject({
      validationStatus: "reconciled",
      validationPolicy: "exact-v2.2",
    });
  });
});
