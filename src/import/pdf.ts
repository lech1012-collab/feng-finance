import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PageTextItem } from "../domain/models";
import { sha256 } from "../domain/normalize";
GlobalWorkerOptions.workerSrc = workerUrl;
const MAX_SIZE = 30 * 1024 * 1024;
const MAX_PAGES = 100;
export async function validateFile(file: File) {
  if (
    !/\.pdf$/i.test(file.name) ||
    (file.type && file.type !== "application/pdf")
  )
    throw new Error("Unsupported file. Select a PDF statement.");
  if (file.size > MAX_SIZE)
    throw new Error("PDF exceeds 30 MB. Export a smaller statement.");
  if (!file.size) throw new Error("This file is empty.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes("%PDF-"))
    throw new Error("This file is not a valid PDF.");
  return { bytes, hash: await sha256(bytes) };
}
export async function openPdf(bytes: Uint8Array) {
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
    const doc = await loadingTask.promise;
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
export async function extractEmbedded(
  doc: PDFDocumentProxy,
  progress: (message: string) => void,
) {
  const items: PageTextItem[] = [];
  const emptyPages: number[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    progress(`Reading page ${n} of ${doc.numPages}`);
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    let letters = 0;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const [x, y] = viewport.convertToViewportPoint(
        item.transform[4],
        item.transform[5],
      );
      items.push({
        text: item.str,
        x,
        y,
        width: item.width,
        height: item.height,
        page: n,
        confidence: 1,
      });
      letters += item.str.replace(/\s/g, "").length;
    }
    if (letters < 30) emptyPages.push(n);
    page.cleanup();
  }
  return { items, emptyPages };
}
