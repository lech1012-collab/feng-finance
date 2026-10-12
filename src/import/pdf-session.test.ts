import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPdfImportSession } from "./pdf-session";

const mock = vi.hoisted(() => ({
  validateFile: vi.fn(),
  openPdf: vi.fn(),
  extractEmbeddedPage: vi.fn(),
  extractPageGeometry: vi.fn(),
  assessPageQuality: vi.fn(),
  extractOcrPages: vi.fn(),
  extractOcrCells: vi.fn(),
  renderPdfArea: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("./pdf", () => ({
  validateFile: mock.validateFile,
  openPdf: mock.openPdf,
  extractEmbeddedPage: mock.extractEmbeddedPage,
  extractPageGeometry: mock.extractPageGeometry,
}));
vi.mock("./ocr", () => ({
  extractOcrPages: mock.extractOcrPages,
  extractOcrCells: mock.extractOcrCells,
  renderPdfArea: mock.renderPdfArea,
}));
vi.mock("./generic/quality", () => ({
  assessPageQuality: mock.assessPageQuality,
}));
vi.mock("../domain/normalize", () => ({ id: () => "local-session" }));

const file = { name: "synthetic.pdf" } as File;
function page(n: number, text = "digital") {
  return {
    items: [
      {
        text,
        page: n,
        x: 20,
        y: 100,
        width: 60,
        height: 12,
        fontSize: 12,
        parseSource: "text",
        confidence: 1,
      },
    ],
    page: { page: n, width: 612, height: 792, rotation: 0 },
  };
}

beforeEach(() => {
  for (const fn of Object.values(mock)) fn.mockReset();
  mock.validateFile.mockResolvedValue({
    bytes: new Uint8Array([1]),
    hash: "sha256",
  });
  mock.destroy.mockResolvedValue(undefined);
  mock.openPdf.mockResolvedValue({
    numPages: 3,
    loadingTask: { destroy: mock.destroy },
  });
  mock.extractEmbeddedPage.mockImplementation(async (_, n) => page(n));
  mock.extractPageGeometry.mockImplementation(async (_, n) => page(n).page);
  mock.assessPageQuality.mockImplementation((_, geometry) => ({
    page: geometry.page,
    usable: true,
    transactionTokenCount: 10,
    recognisedTokenCount: 10,
    usableFraction: 1,
  }));
  mock.extractOcrPages.mockResolvedValue({
    items: [],
    completedPages: [],
    unreadPages: [],
    cancelled: false,
  });
  mock.extractOcrCells.mockResolvedValue([]);
});

describe("private PDF review session", () => {
  it("falls back to local image reading when an embedded text layer fails", async () => {
    mock.extractEmbeddedPage.mockImplementation(async (_, n) => {
      if (n === 2) throw new Error("Synthetic decoder failure");
      return page(n);
    });
    mock.extractOcrPages.mockResolvedValue({
      items: [{ ...page(2, "recovered").items[0], parseSource: "ocr" }],
      completedPages: [2],
      unreadPages: [],
      cancelled: false,
    });
    const session = await createPdfImportSession(file);
    const result = await session.extract();
    expect(result.items.map((item) => item.text)).toEqual([
      "digital",
      "recovered",
      "digital",
    ]);
    expect(result.quality[1]).toMatchObject({
      usable: false,
      reason: "garbled",
    });
    expect(result.pages).toHaveLength(3);
    expect(mock.extractPageGeometry).toHaveBeenCalledOnce();
    await session.dispose();
  });
  it("uses text on usable pages and OCR only for the failing page", async () => {
    mock.assessPageQuality.mockImplementation((_, geometry) => ({
      page: geometry.page,
      usable: geometry.page !== 2,
      transactionTokenCount: 10,
      recognisedTokenCount: geometry.page === 2 ? 2 : 10,
      usableFraction: geometry.page === 2 ? 0.2 : 1,
    }));
    mock.extractOcrPages.mockResolvedValue({
      items: [{ ...page(2, "scan").items[0], parseSource: "ocr" }],
      completedPages: [2],
      unreadPages: [],
      cancelled: false,
    });
    const session = await createPdfImportSession(file);
    const result = await session.extract();
    expect(session.pageCount).toBe(3);
    expect(result.method).toBe("text+ocr");
    expect(result.items.map((item) => item.text)).toEqual([
      "digital",
      "scan",
      "digital",
    ]);
    expect(result.completedPages).toEqual([1, 2, 3]);
    expect(result.unreadPages).toEqual([]);
    expect(mock.extractOcrPages).toHaveBeenCalledWith(
      expect.anything(),
      [2],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await session.dispose();
  });

  it("retains completed pages after cancel and allows a local crop during review", async () => {
    const controller = new AbortController();
    mock.extractEmbeddedPage.mockImplementation(async (_, n) => {
      if (n === 2) {
        controller.abort();
        throw new DOMException("Cancelled", "AbortError");
      }
      return page(n);
    });
    const release = vi.fn();
    const crop = new Blob(["fictitious crop"], { type: "image/png" });
    mock.renderPdfArea.mockResolvedValue({
      canvas: { toBlob: (cb: (blob: Blob) => void) => cb(crop) },
      release,
    });
    const session = await createPdfImportSession(file);
    const result = await session.extract({ signal: controller.signal });
    expect(result.cancelled).toBe(true);
    expect(result.completedPages).toEqual([1]);
    expect(result.unreadPages).toEqual([2, 3]);
    expect(result.items).toHaveLength(1);
    expect(result.pageCount).toBe(3);
    await expect(
      session.crop({ page: 1, x: 15, y: 90, width: 500, height: 40 }),
    ).resolves.toBe(crop);
    expect(release).toHaveBeenCalledOnce();
    await session.dispose();
    expect(result.items).toEqual([]);
    expect(result.pages).toEqual([]);
    expect(result.quality).toEqual([]);
    expect(mock.destroy).toHaveBeenCalledOnce();
    await session.dispose();
    expect(mock.destroy).toHaveBeenCalledOnce();
    await expect(
      session.crop({ page: 1, x: 15, y: 90, width: 500, height: 40 }),
    ).rejects.toThrow("closed");
  });

  it("keeps cancelled OCR pages visibly unread without silently using broken text", async () => {
    mock.assessPageQuality.mockImplementation((_, geometry) => ({
      page: geometry.page,
      usable: false,
      transactionTokenCount: 0,
      recognisedTokenCount: 0,
      usableFraction: 0,
      reason: "garbled",
    }));
    mock.extractOcrPages.mockResolvedValue({
      items: [{ ...page(1, "read").items[0], parseSource: "ocr" }],
      completedPages: [1],
      unreadPages: [2, 3],
      cancelled: true,
    });
    const session = await createPdfImportSession(file);
    const result = await session.extract();
    expect(result.items.map((item) => item.text)).toEqual(["read"]);
    expect(result.pages).toHaveLength(3);
    expect(result.completedPages).toEqual([1]);
    expect(result.unreadPages).toEqual([2, 3]);
    expect(result.method).toBe("ocr");
    expect(result.cancelled).toBe(true);
    await session.dispose();
  });

  it("bounds memory by serializing crop and cell work and aborts both on disposal", async () => {
    let firstSignal!: AbortSignal;
    mock.extractOcrCells.mockImplementation((_, __, options) => {
      firstSignal = options.signal;
      return new Promise((_, reject) =>
        options.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        ),
      );
    });
    const session = await createPdfImportSession(file);
    const cells = session.readCells([
      { page: 1, x: 420, y: 100, width: 90, height: 20 },
    ]);
    const crop = session.crop({
      page: 1,
      x: 420,
      y: 100,
      width: 90,
      height: 20,
    });
    const cellsRejected = expect(cells).rejects.toMatchObject({
      name: "AbortError",
    });
    const cropRejected = expect(crop).rejects.toThrow("closed");
    await vi.waitFor(() => expect(mock.extractOcrCells).toHaveBeenCalledOnce());
    expect(mock.renderPdfArea).not.toHaveBeenCalled();
    await session.dispose();
    await cellsRejected;
    await cropRejected;
    expect(firstSignal.aborted).toBe(true);
    expect(mock.destroy).toHaveBeenCalledOnce();
  });
});
