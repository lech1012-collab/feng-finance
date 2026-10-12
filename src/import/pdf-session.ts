import type { PDFDocumentProxy } from "pdfjs-dist";
import { id } from "../domain/normalize";
import type {
  ExtractedTextItem,
  PageQuality,
  SourcePage,
  SourceRect,
} from "./generic/types";
import type {
  ExtractionResult,
  ImportProgress,
  PdfExtractionOptions,
  PdfImportSession,
} from "./pdf-session-types";
import { assessPageQuality } from "./generic/quality";
import {
  extractEmbeddedPage,
  extractPageGeometry,
  openPdf,
  validateFile,
} from "./pdf";
import {
  abortable,
  isImportAbort,
  linkedAbort,
  throwIfAborted,
} from "./pdf-abort";
import { extractOcrCells, extractOcrPages, renderPdfArea } from "./ocr";

export async function createPdfImportSession(
  file: File,
  options: { signal?: AbortSignal } = {},
): Promise<PdfImportSession> {
  const { bytes, hash } = await validateFile(file, options.signal);
  const document = await openPdf(bytes, options.signal);
  return new LocalPdfImportSession(file, hash, document);
}

class LocalPdfImportSession implements PdfImportSession {
  readonly id = id();
  readonly filename: string;
  readonly pageCount: number;
  private sourceFile?: File;
  private document?: PDFDocumentProxy;
  private readonly lifetime = new AbortController();
  private readonly extractions = new Set<ExtractionResult>();
  private pending: Promise<void> = Promise.resolve();
  private disposed = false;
  private disposing?: Promise<void>;

  constructor(
    file: File,
    readonly hash: string,
    document: PDFDocumentProxy,
  ) {
    this.filename = file.name;
    this.pageCount = document.numPages;
    this.sourceFile = file;
    this.document = document;
  }

  private run<T>(
    signal: AbortSignal | undefined,
    operation: (document: PDFDocumentProxy, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.disposed)
      return Promise.reject(
        new Error("This import has been closed. Select the PDF again."),
      );
    // Keeping one canvas/worker operation active bounds memory on mobile devices.
    const queued = this.pending.then(async () => {
      if (this.disposed || !this.document)
        throw new Error("This import has been closed. Select the PDF again.");
      const linked = linkedAbort(this.lifetime.signal, signal);
      try {
        return await operation(this.document, linked.signal);
      } finally {
        linked.release();
      }
    });
    this.pending = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  extract(options: PdfExtractionOptions = {}): Promise<ExtractionResult> {
    return this.run(options.signal, async (document, signal) => {
      const items: ExtractedTextItem[] = [];
      const pages: SourcePage[] = [];
      const quality: PageQuality[] = [];
      const completed = new Set<number>();
      const ocrPages: number[] = [];
      let cancelled = false;
      try {
        for (let page = 1; page <= document.numPages; page++) {
          throwIfAborted(signal);
          options.progress?.({
            phase: "text",
            page,
            pageCount: document.numPages,
            message: `Reading page ${page} of ${document.numPages}`,
          });
          let extracted: { items: ExtractedTextItem[]; page: SourcePage };
          let textFailed = false;
          try {
            extracted = await extractEmbeddedPage(document, page, signal);
          } catch (error) {
            if (isImportAbort(error)) throw error;
            // A corrupt text layer can still have a readable, locally rendered page.
            // Never use its partially decoded words as completed transactions.
            extracted = {
              items: [],
              page: await extractPageGeometry(document, page, signal),
            };
            textFailed = true;
          }
          pages.push(extracted.page);
          const pageQuality = assessPageQuality(
            extracted.items,
            extracted.page,
          );
          if (textFailed)
            Object.assign(pageQuality, { usable: false, reason: "garbled" });
          quality.push(pageQuality);
          if (options.forceOcr || !pageQuality.usable) ocrPages.push(page);
          else {
            items.push(...extracted.items);
            completed.add(page);
          }
          options.progress?.({
            phase: "quality",
            page,
            pageCount: document.numPages,
            fraction: page / document.numPages,
            completed: pageQuality.usable && !options.forceOcr,
            message:
              pageQuality.usable && !options.forceOcr
                ? `Digital text read on page ${page}`
                : `Page ${page} needs local image reading`,
          });
        }
        if (ocrPages.length) {
          const scanned = await extractOcrPages(document, ocrPages, {
            signal,
            progress: options.progress,
          });
          items.push(...scanned.items);
          for (const page of scanned.completedPages) completed.add(page);
          cancelled = scanned.cancelled;
        }
      } catch (error) {
        if (!isImportAbort(error)) throw error;
        cancelled = true;
      }
      const completedPages = [...completed].sort((a, b) => a - b);
      const unreadPages = Array.from(
        { length: document.numPages },
        (_, index) => index + 1,
      ).filter((page) => !completed.has(page));
      const hasOcr = items.some((item) => item.parseSource === "ocr");
      const hasText = items.some((item) => item.parseSource === "text");
      const result: ExtractionResult = {
        items: items.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x),
        pages,
        quality,
        pageCount: document.numPages,
        completedPages,
        unreadPages,
        cancelled,
        method: hasOcr ? (hasText ? "text+ocr" : "ocr") : "text",
      };
      this.extractions.add(result);
      return result;
    });
  }

  readCells(
    rects: SourceRect[],
    options: {
      signal?: AbortSignal;
      progress?: (progress: ImportProgress) => void;
    } = {},
  ) {
    return this.run(options.signal, (document, signal) =>
      extractOcrCells(document, rects, { ...options, signal }),
    );
  }

  crop(
    rect: SourceRect,
    options: { signal?: AbortSignal } = {},
  ): Promise<Blob> {
    return this.run(options.signal, async (document, signal) => {
      const rendered = await renderPdfArea(document, rect.page, rect, signal);
      try {
        const blob = await abortable(
          new Promise<Blob>((resolve, reject) => {
            rendered.canvas.toBlob(
              (value) =>
                value
                  ? resolve(value)
                  : reject(new Error("The PDF preview could not be created.")),
              "image/png",
            );
          }),
          signal,
        );
        throwIfAborted(signal);
        return blob;
      } finally {
        rendered.release();
      }
    });
  }

  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    this.disposed = true;
    this.lifetime.abort();
    this.disposing = (async () => {
      await this.pending;
      for (const extraction of this.extractions) {
        extraction.items.length = 0;
        extraction.pages.length = 0;
        extraction.quality.length = 0;
      }
      this.extractions.clear();
      this.sourceFile = undefined;
      const document = this.document;
      this.document = undefined;
      await document?.loadingTask.destroy();
    })();
    return this.disposing;
  }
}
