import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { extractEmbeddedPage, openPdf, validateFile } from "./pdf";

const mocks = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist", () => ({
  getDocument: mocks.getDocument,
  GlobalWorkerOptions: {},
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "/pdf.worker.min.mjs",
}));
vi.mock("../domain/normalize", () => ({
  sha256: vi.fn(async () => "local-sha-256"),
}));

beforeEach(() => mocks.getDocument.mockReset());

describe("embedded PDF source", () => {
  it("validates file magic, limits and cancellation before parsing", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\nsynthetic");
    const file = {
      name: "statement.pdf",
      type: "application/pdf",
      size: bytes.length,
      arrayBuffer: async () => bytes.buffer,
    } as File;
    const validated = await validateFile(file);
    expect(Array.from(validated.bytes)).toEqual(Array.from(bytes));
    expect(validated.hash).toBe("local-sha-256");
    await expect(
      validateFile({ ...file, name: "statement.html" } as File),
    ).rejects.toThrow("Unsupported");
    await expect(
      validateFile({ ...file, size: 30 * 1024 * 1024 + 1 } as File),
    ).rejects.toThrow("30 MB");
    await expect(validateFile({ ...file, size: 0 } as File)).rejects.toThrow(
      "empty",
    );
    await expect(
      validateFile({
        ...file,
        arrayBuffer: async () => new ArrayBuffer(8),
      } as File),
    ).rejects.toThrow("valid PDF");
    const controller = new AbortController();
    controller.abort();
    await expect(validateFile(file, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });

  it("uses bundled PDF assets and tears down oversized or password-protected documents", async () => {
    const destroy = vi.fn(async () => undefined);
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 101 }),
      destroy,
    });
    await expect(openPdf(new Uint8Array([1]))).rejects.toThrow("100 pages");
    expect(destroy).toHaveBeenCalledOnce();
    const config = mocks.getDocument.mock.calls[0][0];
    expect(new URL(config.cMapUrl).origin).toBe(location.origin);
    expect(config.cMapUrl).toContain("/pdfjs/cmaps/");
    expect(config.stopAtErrors).toBe(true);
    const password = new Error("Encrypted synthetic document");
    password.name = "PasswordException";
    mocks.getDocument.mockReturnValue({
      promise: Promise.reject(password),
      destroy,
    });
    await expect(openPdf(new Uint8Array([1]))).rejects.toThrow(
      "password-protected",
    );
  });

  it("cancels a loading task while consuming eventual worker rejection", async () => {
    const controller = new AbortController();
    const destroy = vi.fn(async () => undefined);
    let reject!: (error: Error) => void;
    mocks.getDocument.mockReturnValue({
      promise: new Promise((_, no) => {
        reject = no;
      }),
      destroy,
    });
    const loading = openPdf(new Uint8Array([1]), controller.signal);
    controller.abort();
    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
    reject(new Error("Worker destroyed"));
    await Promise.resolve();
    expect(destroy).toHaveBeenCalled();
  });

  it("converts baseline text into top-left rectangles and records font size", async () => {
    const cleanup = vi.fn();
    const page = {
      getViewport: () => ({
        width: 612,
        height: 792,
        rotation: 0,
        convertToViewportPoint: (x: number, y: number) => [x, 792 - y],
      }),
      getTextContent: async () => ({
        items: [
          {
            str: "1,200.00",
            transform: [12, 0, 0, 12, 400, 692],
            width: 70,
            height: 12,
          },
        ],
      }),
      cleanup,
    };
    const doc = { getPage: async () => page } as unknown as PDFDocumentProxy;
    const result = await extractEmbeddedPage(doc, 2);
    expect(result.items[0]).toEqual({
      text: "1,200.00",
      x: 400,
      y: 88,
      width: 70,
      height: 12,
      fontSize: 12,
      page: 2,
      confidence: 1,
      parseSource: "text",
    });
    expect(result.page).toEqual({
      page: 2,
      width: 612,
      height: 792,
      rotation: 0,
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("cleans up a text page on cancellation and rejects invalid coordinates", async () => {
    const cleanup = vi.fn();
    const controller = new AbortController();
    const page = {
      getViewport: () => ({
        width: 612,
        height: 792,
        rotation: 0,
        convertToViewportPoint: (x: number, y: number) => [x, y],
      }),
      getTextContent: vi.fn(async () => {
        controller.abort();
        return { items: [] };
      }),
      cleanup,
    };
    await expect(
      extractEmbeddedPage(
        { getPage: async () => page } as unknown as PDFDocumentProxy,
        1,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(cleanup).toHaveBeenCalledOnce();
    page.getTextContent.mockImplementation(
      async () =>
        ({
          items: [
            {
              str: "invalid",
              transform: [12, 0, 0, 12, NaN, 692],
              width: 70,
              height: 12,
            },
          ],
        }) as never,
    );
    await expect(
      extractEmbeddedPage(
        { getPage: async () => page } as unknown as PDFDocumentProxy,
        1,
      ),
    ).rejects.toThrow("invalid text positions");
    expect(cleanup).toHaveBeenCalledTimes(2);
  });
});
