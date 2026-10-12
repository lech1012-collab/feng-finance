import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { PageTextItem } from "../domain/models";
import { createLocalOcrWorker } from "./ocr-worker";
import type { LocalOcrWorker, OcrWordData } from "./ocr-worker-types";
import type { ExtractedTextItem, SourceRect } from "./generic/types";
import type { ImportProgress, PartialOcrResult } from "./pdf-session-types";
import { abortable, isImportAbort, throwIfAborted } from "./pdf-abort";

export const OCR_DPI = 300;
export const OCR_SCALE = OCR_DPI / 72;
const MAX_PIXELS = 18_000_000;
export const FINANCIAL_OCR_CHARACTERS = "0123456789,.-()";

interface OcrOptions {
  signal?: AbortSignal;
  progress?: (progress: ImportProgress) => void;
}
type OcrWorker = LocalOcrWorker;

export function clampSourceRect(
  rect: SourceRect,
  pageWidth: number,
  pageHeight: number,
): SourceRect {
  if (
    !Number.isInteger(rect.page) ||
    rect.page < 1 ||
    ![rect.x, rect.y, rect.width, rect.height, pageWidth, pageHeight].every(
      Number.isFinite,
    ) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    pageWidth <= 0 ||
    pageHeight <= 0
  )
    throw new Error("The selected PDF area is invalid.");
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const x1 = Math.min(pageWidth, rect.x + rect.width);
  const y1 = Math.min(pageHeight, rect.y + rect.height);
  if (x1 <= x || y1 <= y)
    throw new Error("The selected PDF area is outside the page.");
  return { page: rect.page, x, y, width: x1 - x, height: y1 - y };
}

/** Render only the requested local PDF region, at 300 DPI, into a bounded canvas. */
export async function renderPdfArea(
  doc: PDFDocumentProxy,
  pageNumber: number,
  rect?: SourceRect,
  signal?: AbortSignal,
): Promise<{
  canvas: HTMLCanvasElement;
  rect: SourceRect;
  scale: number;
  release: () => void;
}> {
  throwIfAborted(signal);
  if (
    !Number.isInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > doc.numPages
  )
    throw new Error("The selected PDF page is unavailable.");
  const page = await abortable(doc.getPage(pageNumber), signal);
  const canvas = document.createElement("canvas");
  let renderTask: RenderTask | undefined;
  const release = () => {
    canvas.width = canvas.height = 0;
    page.cleanup();
  };
  try {
    const baseViewport = page.getViewport({ scale: 1 });
    const area = clampSourceRect(
      rect ?? {
        page: pageNumber,
        x: 0,
        y: 0,
        width: baseViewport.width,
        height: baseViewport.height,
      },
      baseViewport.width,
      baseViewport.height,
    );
    if (area.page !== pageNumber)
      throw new Error("The selected PDF area belongs to a different page.");
    const width = Math.ceil(area.width * OCR_SCALE);
    const height = Math.ceil(area.height * OCR_SCALE);
    if (width * height > MAX_PIXELS)
      throw new Error(
        "The scanned PDF page is too large to read safely at 300 DPI. Export a smaller PDF.",
      );
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Canvas is unavailable for local PDF reading.");
    const viewport = page.getViewport({ scale: OCR_SCALE });
    renderTask = page.render({
      canvasContext: context,
      canvas,
      viewport,
      transform: [1, 0, 0, 1, -area.x * OCR_SCALE, -area.y * OCR_SCALE],
      background: "rgb(255, 255, 255)",
    });
    await abortable(renderTask.promise, signal, () => renderTask?.cancel());
    throwIfAborted(signal);
    return { canvas, rect: area, scale: OCR_SCALE, release };
  } catch (error) {
    renderTask?.cancel();
    release();
    throw error;
  }
}

async function localWorker(
  options: OcrOptions,
  getProgress: () => ImportProgress,
): Promise<OcrWorker> {
  return createLocalOcrWorker({
    signal: options.signal,
    dpi: OCR_DPI,
    progress: (fraction) => {
      if (!options.signal?.aborted)
        options.progress?.({ ...getProgress(), fraction });
    },
  });
}

export function ocrTextItems(
  data: OcrWordData,
  rect: SourceRect,
  scale: number,
): ExtractedTextItem[] {
  const items: ExtractedTextItem[] = [];
  for (const block of data.blocks ?? [])
    for (const paragraph of block.paragraphs)
      for (const line of paragraph.lines)
        for (const word of line.words) {
          const height = (word.bbox.y1 - word.bbox.y0) / scale;
          items.push({
            text: word.text,
            x: rect.x + word.bbox.x0 / scale,
            y: rect.y + word.bbox.y0 / scale,
            width: (word.bbox.x1 - word.bbox.x0) / scale,
            height,
            fontSize: Math.max(1, height),
            page: rect.page,
            confidence: Math.min(0.6, Math.max(0, word.confidence / 100)),
            parseSource: "ocr",
          });
        }
  return items;
}

/** Cancellation preserves only whole pages whose recognition actually completed. */
export async function extractOcrPages(
  doc: PDFDocumentProxy,
  pages: number[],
  options: OcrOptions = {},
): Promise<PartialOcrResult> {
  const requested = [...new Set(pages)];
  if (
    requested.some(
      (page) => !Number.isInteger(page) || page < 1 || page > doc.numPages,
    )
  )
    throw new Error("A requested OCR page is unavailable.");
  const items: ExtractedTextItem[] = [];
  const completedPages: number[] = [];
  let worker: OcrWorker | undefined;
  let currentPage = requested[0];
  const getProgress = (): ImportProgress => ({
    phase: "ocr-page",
    page: currentPage,
    pageCount: doc.numPages,
    message: `Reading scanned page ${currentPage} of ${doc.numPages}`,
  });
  try {
    if (!requested.length)
      return { items, completedPages, unreadPages: [], cancelled: false };
    worker = await localWorker(options, getProgress);
    for (const page of requested) {
      throwIfAborted(options.signal);
      currentPage = page;
      options.progress?.(getProgress());
      const rendered = await renderPdfArea(
        doc,
        page,
        undefined,
        options.signal,
      );
      try {
        const activeWorker = worker;
        const { data } = await abortable(
          activeWorker.recognize(rendered.canvas),
          options.signal,
          () => {
            void activeWorker.terminate();
          },
        );
        throwIfAborted(options.signal);
        items.push(...ocrTextItems(data, rendered.rect, rendered.scale));
        completedPages.push(page);
        options.progress?.({ ...getProgress(), fraction: 1, completed: true });
      } finally {
        rendered.release();
      }
    }
    return { items, completedPages, unreadPages: [], cancelled: false };
  } catch (error) {
    if (!isImportAbort(error)) throw error;
    return {
      items,
      completedPages,
      unreadPages: requested.filter((page) => !completedPages.includes(page)),
      cancelled: true,
    };
  } finally {
    await worker?.terminate().catch(() => undefined);
  }
}

/** Numeric alternatives only; callers must accept them only after exact reconciliation. */
export async function extractOcrCells(
  doc: PDFDocumentProxy,
  rects: SourceRect[],
  options: OcrOptions = {},
): Promise<{ rect: SourceRect; items: ExtractedTextItem[] }[]> {
  const completed: { rect: SourceRect; items: ExtractedTextItem[] }[] = [];
  let worker: OcrWorker | undefined;
  let current = rects[0];
  const getProgress = (): ImportProgress => ({
    phase: "ocr-cell",
    page: current?.page,
    pageCount: doc.numPages,
    message: `Checking an amount on page ${current?.page ?? 1}`,
  });
  try {
    if (!rects.length) return completed;
    worker = await localWorker(options, getProgress);
    await abortable(
      worker.setParameters({
        tessedit_char_whitelist: FINANCIAL_OCR_CHARACTERS,
        tessedit_pageseg_mode: "7",
      }),
      options.signal,
      () => {
        void worker?.terminate();
      },
    );
    for (const rect of rects) {
      throwIfAborted(options.signal);
      current = rect;
      options.progress?.(getProgress());
      const rendered = await renderPdfArea(
        doc,
        rect.page,
        rect,
        options.signal,
      );
      try {
        const activeWorker = worker;
        const { data } = await abortable(
          activeWorker.recognize(rendered.canvas),
          options.signal,
          () => {
            void activeWorker.terminate();
          },
        );
        throwIfAborted(options.signal);
        completed.push({
          rect: rendered.rect,
          items: ocrTextItems(data, rendered.rect, rendered.scale),
        });
        options.progress?.({ ...getProgress(), fraction: 1, completed: true });
      } finally {
        rendered.release();
      }
    }
    return completed;
  } catch (error) {
    if (!isImportAbort(error)) throw error;
    return completed;
  } finally {
    await worker?.terminate().catch(() => undefined);
  }
}

/** Compatibility adapter for the existing bank parsers. */
export async function extractOcr(
  doc: PDFDocumentProxy,
  pages: number[],
  progress: (message: string) => void,
): Promise<PageTextItem[]> {
  const result = await extractOcrPages(doc, pages, {
    progress: (update) => progress(update.message),
  });
  return result.items.map((item) => ({ ...item, y: item.y + item.height }));
}
