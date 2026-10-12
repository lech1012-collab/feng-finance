import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PageTextItem } from "../domain/models";
import { sha256 } from "../domain/normalize";
import type { ExtractedTextItem, SourcePage } from "./generic/types";
import { abortable, throwIfAborted } from "./pdf-abort";

GlobalWorkerOptions.workerSrc = workerUrl;
const MAX_SIZE = 30 * 1024 * 1024;
const MAX_PAGES = 100;

export async function validateFile(file: File, signal?: AbortSignal) {
  throwIfAborted(signal);
  if (
    !/\.pdf$/i.test(file.name) ||
    (file.type && file.type !== "application/pdf")
  )
    throw new Error("Unsupported file. Select a PDF statement.");
  if (file.size > MAX_SIZE)
    throw new Error("PDF exceeds 30 MB. Export a smaller statement.");
  if (!file.size) throw new Error("This file is empty.");
  const bytes = new Uint8Array(await abortable(file.arrayBuffer(), signal));
  if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes("%PDF-"))
    throw new Error("This file is not a valid PDF.");
  const hash = await abortable(sha256(bytes), signal);
  throwIfAborted(signal);
  return { bytes, hash };
}

export async function openPdf(bytes: Uint8Array, signal?: AbortSignal) {
  throwIfAborted(signal);
  const base = new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.origin)
    .href;
  const loadingTask = getDocument({
    data: bytes,
    cMapUrl: base + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: base + "standard_fonts/",
    wasmUrl: base + "wasm/",
    useSystemFonts: true,
    disableFontFace: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  try {
    const doc = await abortable(loadingTask.promise, signal, () => {
      void loadingTask.destroy();
    });
    if (doc.numPages > MAX_PAGES)
      throw new Error(
        "Statement exceeds 100 pages. Split it into monthly statements.",
      );
    return doc;
  } catch (error) {
    await loadingTask.destroy();
    if (error instanceof Error && error.name === "PasswordException")
      throw new Error(
        "This PDF is password-protected. Unlock it locally and select the unlocked copy.",
      );
    throw error;
  }
}

/** Geometry is available even when a PDF text-layer decoder fails. */
export async function extractPageGeometry(
  doc: PDFDocumentProxy,
  pageNumber: number,
  signal?: AbortSignal,
): Promise<SourcePage> {
  throwIfAborted(signal);
  const page = await abortable(doc.getPage(pageNumber), signal);
  try {
    const viewport = page.getViewport({ scale: 1 });
    if (
      ![viewport.width, viewport.height, viewport.rotation].every(
        Number.isFinite,
      ) ||
      viewport.width <= 0 ||
      viewport.height <= 0
    )
      throw new Error(
        "The PDF page dimensions are invalid. Try exporting the statement again.",
      );
    return {
      page: pageNumber,
      width: viewport.width,
      height: viewport.height,
      rotation: viewport.rotation,
    };
  } finally {
    page.cleanup();
  }
}

/** One complete page is committed to the result at a time, never partial words. */
export async function extractEmbeddedPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  signal?: AbortSignal,
): Promise<{ items: ExtractedTextItem[]; page: SourcePage }> {
  throwIfAborted(signal);
  const page = await abortable(doc.getPage(pageNumber), signal);
  try {
    const viewport = page.getViewport({ scale: 1 });
    const content = await abortable(page.getTextContent(), signal);
    const items: ExtractedTextItem[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const [a, b, c, d, e, f] = item.transform;
      const horizontalLength = Math.hypot(a, b) || 1;
      const verticalLength = Math.hypot(c, d) || item.height || 1;
      const height = Math.abs(item.height || verticalLength);
      const width = Math.abs(item.width);
      const horizontal = [a / horizontalLength, b / horizontalLength];
      const vertical = [c / verticalLength, d / verticalLength];
      const corners = [
        [e, f],
        [e + horizontal[0] * width, f + horizontal[1] * width],
        [e + vertical[0] * height, f + vertical[1] * height],
        [
          e + horizontal[0] * width + vertical[0] * height,
          f + horizontal[1] * width + vertical[1] * height,
        ],
      ].map(([x, y]) => viewport.convertToViewportPoint(x, y));
      const xs = corners.map(([x]) => x);
      const ys = corners.map(([, y]) => y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const transformedWidth = Math.max(...xs) - x;
      const transformedHeight = Math.max(...ys) - y;
      if (
        ![x, y, transformedWidth, transformedHeight, verticalLength].every(
          Number.isFinite,
        )
      )
        throw new Error(
          "The PDF has invalid text positions. Try exporting the statement again.",
        );
      items.push({
        text: item.str,
        x,
        y,
        width: transformedWidth,
        height: transformedHeight,
        fontSize: Math.max(1, verticalLength),
        page: pageNumber,
        confidence: 1,
        parseSource: "text",
      });
    }
    throwIfAborted(signal);
    return {
      items,
      page: {
        page: pageNumber,
        width: viewport.width,
        height: viewport.height,
        rotation: viewport.rotation,
      },
    };
  } finally {
    page.cleanup();
  }
}

/** Compatibility adapter for the existing bank parsers. */
export async function extractEmbedded(
  doc: PDFDocumentProxy,
  progress: (message: string) => void,
) {
  const items: PageTextItem[] = [];
  const emptyPages: number[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    progress(`Reading page ${n} of ${doc.numPages}`);
    const extracted = await extractEmbeddedPage(doc, n);
    items.push(
      ...extracted.items.map((item) => ({ ...item, y: item.y + item.height })),
    );
    const letters = extracted.items.reduce(
      (sum, item) => sum + item.text.replace(/\s/g, "").length,
      0,
    );
    if (letters < 30) emptyPages.push(n);
  }
  return { items, emptyPages };
}
