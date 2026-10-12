import { createWorker, OEM } from "tesseract.js";
import type {
  OcrRuntimeRequest,
  OcrRuntimeResponse,
  OcrWordData,
} from "./ocr-worker-types";

// The module worker has no DOM. Every asset URL is provided from the app origin.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<OcrRuntimeRequest>) => void) | null;
  postMessage(message: OcrRuntimeResponse): void;
};
let engine: Awaited<ReturnType<typeof createWorker>> | undefined;
let activeRequest: OcrRuntimeRequest | undefined;

function fail(request: OcrRuntimeRequest) {
  scope.postMessage({
    id: request.id,
    kind: "error",
    code:
      request.action === "initialize"
        ? "initialize"
        : request.action === "parameters"
          ? "parameters"
          : "recognize",
  });
}

scope.onmessage = (event) => {
  const request = event.data;
  activeRequest = request;
  void (async () => {
    try {
      if (request.action === "initialize") {
        const base = new URL(request.base);
        if (base.origin !== self.location.origin || request.dpi !== 300)
          throw new Error("Invalid local OCR configuration");
        engine = await createWorker("eng", OEM.LSTM_ONLY, {
          workerPath: new URL("worker.min.js", base).href,
          corePath: base.href,
          langPath: base.href,
          workerBlobURL: false,
          gzip: true,
          errorHandler: () => {
            if (activeRequest) fail(activeRequest);
          },
          logger: (message) => {
            if (message.status === "recognizing text")
              scope.postMessage({
                kind: "progress",
                fraction: message.progress,
              });
          },
        });
        await engine.setParameters({ user_defined_dpi: String(request.dpi) });
        scope.postMessage({ id: request.id, kind: "ready" });
      } else if (request.action === "parameters") {
        if (!engine) throw new Error("Not initialized");
        await engine.setParameters(request.parameters);
        scope.postMessage({ id: request.id, kind: "result" });
      } else {
        if (!engine) throw new Error("Not initialized");
        const result = await engine.recognize(
          new Blob([request.image], { type: "image/png" }),
          {},
          { blocks: true },
        );
        // Allowlist only geometry and text actually needed by the import engine.
        const data: OcrWordData = {
          blocks:
            result.data.blocks?.map((block) => ({
              paragraphs: block.paragraphs.map((paragraph) => ({
                lines: paragraph.lines.map((line) => ({
                  words: line.words.map((word) => ({
                    text: word.text,
                    confidence: word.confidence,
                    bbox: {
                      x0: word.bbox.x0,
                      y0: word.bbox.y0,
                      x1: word.bbox.x1,
                      y1: word.bbox.y1,
                    },
                  })),
                })),
              })),
            })) ?? [],
        };
        scope.postMessage({ id: request.id, kind: "result", data });
      }
    } catch {
      // Never forward library exception strings, filenames or financial content.
      fail(request);
    }
  })();
};
