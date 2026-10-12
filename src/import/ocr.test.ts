import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import {
  extractOcrCells,
  extractOcrPages,
  FINANCIAL_OCR_CHARACTERS,
  ocrTextItems,
  OCR_SCALE,
  renderPdfArea,
  clampSourceRect,
} from "./ocr";

const mock = vi.hoisted(() => ({
  createWorker: vi.fn(),
  worker: {
    recognize: vi.fn(),
    setParameters: vi.fn(),
    terminate: vi.fn(),
  },
}));
vi.mock("./ocr-worker", () => ({ createLocalOcrWorker: mock.createWorker }));

function pdf(pageCount = 2, width = 612, height = 792) {
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const cleanup = vi.fn();
  const page = {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: width * scale,
      height: height * scale,
    })),
    render,
    cleanup,
  };
  const doc = {
    numPages: pageCount,
    getPage: vi.fn(async () => page as unknown as PDFPageProxy),
  };
  return { doc: doc as unknown as PDFDocumentProxy, page, render, cleanup };
}

function data(text: string) {
  return {
    blocks: [
      {
        paragraphs: [
          {
            lines: [
              {
                words: [
                  {
                    text,
                    confidence: 92,
                    bbox: { x0: 10, y0: 20, x1: 110, y1: 70 },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  mock.worker.recognize.mockReset();
  mock.worker.setParameters.mockReset().mockResolvedValue({});
  mock.worker.terminate.mockReset().mockResolvedValue(undefined);
  mock.createWorker.mockReset().mockResolvedValue(mock.worker);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("local financial image reading", () => {
  it("renders a clipped cell at 300 DPI rather than rasterising the full page", async () => {
    const p = pdf();
    const result = await renderPdfArea(p.doc, 1, {
      page: 1,
      x: -2,
      y: 100,
      width: 92,
      height: 18,
    });
    expect(result.rect).toEqual({
      page: 1,
      x: 0,
      y: 100,
      width: 90,
      height: 18,
    });
    expect(result.canvas.width).toBe(Math.ceil((90 * 300) / 72));
    expect(result.canvas.height).toBe(Math.ceil((18 * 300) / 72));
    expect(p.render).toHaveBeenCalledWith(
      expect.objectContaining({
        transform: [1, 0, 0, 1, -0, -100 * OCR_SCALE],
        background: "rgb(255, 255, 255)",
      }),
    );
    result.release();
    expect(result.canvas.width).toBe(0);
    expect(p.cleanup).toHaveBeenCalledOnce();
  });

  it("rejects invalid and oversize areas before rendering to protect mobile memory", async () => {
    expect(() =>
      clampSourceRect(
        { page: 1, x: 10, y: 10, width: NaN, height: 10 },
        612,
        792,
      ),
    ).toThrow("invalid");
    expect(() =>
      clampSourceRect(
        { page: 1, x: 900, y: 10, width: 10, height: 10 },
        612,
        792,
      ),
    ).toThrow("outside");
    const p = pdf(1, 2000, 2000);
    await expect(renderPdfArea(p.doc, 1)).rejects.toThrow("too large");
    expect(p.render).not.toHaveBeenCalled();
    expect(p.cleanup).toHaveBeenCalledOnce();
  });

  it("cancels an active PDF render and releases its canvas", async () => {
    const p = pdf();
    const cancel = vi.fn();
    let capturedCanvas!: HTMLCanvasElement;
    p.render.mockImplementation((options?: unknown) => {
      capturedCanvas = (options as { canvas: HTMLCanvasElement }).canvas;
      return { promise: new Promise<void>(() => undefined), cancel };
    });
    const controller = new AbortController();
    const rendering = renderPdfArea(p.doc, 1, undefined, controller.signal);
    await vi.waitFor(() => expect(p.render).toHaveBeenCalledOnce());
    controller.abort();
    await expect(rendering).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalled();
    expect(capturedCanvas.width).toBe(0);
    expect(p.cleanup).toHaveBeenCalledOnce();
  });

  it("returns page one but explicitly marks unread page two when cancelled", async () => {
    const p = pdf();
    const controller = new AbortController();
    mock.worker.recognize
      .mockResolvedValueOnce({ data: data("1,234.56") })
      .mockImplementationOnce(() => {
        controller.abort();
        return new Promise(() => undefined);
      });
    const result = await extractOcrPages(p.doc, [1, 2], {
      signal: controller.signal,
    });
    expect(result.completedPages).toEqual([1]);
    expect(result.unreadPages).toEqual([2]);
    expect(result.cancelled).toBe(true);
    expect(result.items).toEqual([
      expect.objectContaining({
        text: "1,234.56",
        page: 1,
        parseSource: "ocr",
        confidence: 0.6,
      }),
    ]);
    expect(mock.worker.terminate).toHaveBeenCalled();
    expect(p.cleanup).toHaveBeenCalledTimes(2);
  });

  it("uses only bundled paths and checks cells with a numeric whitelist", async () => {
    const p = pdf();
    mock.worker.recognize.mockResolvedValue({ data: data("(124.30)") });
    const result = await extractOcrCells(p.doc, [
      { page: 2, x: 420, y: 200, width: 100, height: 20 },
    ]);
    expect(mock.createWorker).toHaveBeenCalledWith(
      expect.objectContaining({ dpi: 300 }),
    );
    expect(mock.worker.setParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        tessedit_char_whitelist: FINANCIAL_OCR_CHARACTERS,
        tessedit_pageseg_mode: "7",
      }),
    );
    expect(FINANCIAL_OCR_CHARACTERS).toBe("0123456789,.-()");
    expect(result[0].items[0]).toMatchObject({
      text: "(124.30)",
      x: 420 + 10 / OCR_SCALE,
      y: 200 + 20 / OCR_SCALE,
      parseSource: "ocr",
    });
    expect(mock.worker.terminate).toHaveBeenCalledOnce();
  });

  it("does not claim an incomplete cell and terminates after local recognition errors", async () => {
    const p = pdf();
    mock.worker.recognize.mockRejectedValue(
      new Error("Local recognition failed"),
    );
    await expect(
      extractOcrCells(p.doc, [
        { page: 1, x: 400, y: 100, width: 100, height: 20 },
      ]),
    ).rejects.toThrow("Local recognition failed");
    expect(mock.worker.terminate).toHaveBeenCalledOnce();
    expect(p.cleanup).toHaveBeenCalledOnce();
  });

  it("keeps original crop geometry and suppresses overconfident OCR numbers", () => {
    const result = ocrTextItems(
      data("72.01"),
      { page: 4, x: 320, y: 150, width: 90, height: 30 },
      OCR_SCALE,
    );
    expect(result[0]).toMatchObject({
      page: 4,
      fontSize: 50 / OCR_SCALE,
      height: 50 / OCR_SCALE,
      width: 100 / OCR_SCALE,
      confidence: 0.6,
    });
  });
});
