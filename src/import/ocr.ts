import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PageTextItem } from "../domain/models";
import { createWorker, OEM } from "tesseract.js";
export async function extractOcr(
  doc: PDFDocumentProxy,
  pages: number[],
  progress: (message: string) => void,
): Promise<PageTextItem[]> {
  const base = new URL(`${import.meta.env.BASE_URL}ocr/`, location.origin).href;
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: base + "worker.min.js",
    corePath: base,
    langPath: base,
    workerBlobURL: false,
    gzip: true,
    logger: (m) => {
      if (m.status === "recognizing text")
        progress(`Reading scanned text · ${Math.round(m.progress * 100)}%`);
    },
  });
  const items: PageTextItem[] = [];
  try {
    for (const n of pages) {
      progress(`OCR page ${n} of ${doc.numPages}`);
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      if (canvas.width * canvas.height > 18000000)
        throw new Error("Scanned page is too large. Export a smaller PDF.");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable for local OCR.");
      await page.render({ canvasContext: context, canvas, viewport }).promise;
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      for (const block of data.blocks ?? [])
        for (const paragraph of block.paragraphs)
          for (const line of paragraph.lines)
            for (const word of line.words) {
              items.push({
                text: word.text,
                x: word.bbox.x0 / 2,
                y: word.bbox.y1 / 2,
                width: (word.bbox.x1 - word.bbox.x0) / 2,
                height: (word.bbox.y1 - word.bbox.y0) / 2,
                page: n,
                confidence: Math.min(0.6, word.confidence / 100),
              });
            }
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
  } finally {
    await worker.terminate();
  }
  return items;
}
