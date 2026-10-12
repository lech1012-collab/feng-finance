import { abortable, throwIfAborted } from "./pdf-abort";
import type {
  LocalOcrWorker,
  OcrRuntimeBody,
  OcrRuntimeResponse,
  OcrWordData,
} from "./ocr-worker-types";

interface WorkerOptions {
  signal?: AbortSignal;
  progress?: (fraction: number) => void;
  dpi: number;
}

/**
 * A dedicated parent owns Tesseract's child worker. Terminating the parent also
 * terminates descendant workers, including during Tesseract initialization.
 * PNG transfer keeps PDF/source objects out of the worker and bounds memory.
 */
export async function createLocalOcrWorker(
  options: WorkerOptions,
): Promise<LocalOcrWorker> {
  throwIfAborted(options.signal);
  const nativeWorker = new Worker(
    new URL("./ocr-runtime.worker.ts", import.meta.url),
    {
      type: "module",
      name: "feng-local-ocr",
    },
  );
  const pending = new Map<
    number,
    {
      resolve: (value: OcrWordData | undefined) => void;
      reject: (error: Error | DOMException) => void;
    }
  >();
  let sequence = 0;
  let closed = false;
  const cancellation = () =>
    stop(new DOMException("Import cancelled.", "AbortError"));
  const stop = (
    error = new DOMException("Import cancelled.", "AbortError"),
  ) => {
    if (closed) return;
    closed = true;
    options.signal?.removeEventListener("abort", cancellation);
    nativeWorker.onmessage =
      nativeWorker.onerror =
      nativeWorker.onmessageerror =
        null;
    nativeWorker.terminate();
    for (const job of pending.values()) job.reject(error);
    pending.clear();
  };
  const request = (body: OcrRuntimeBody, transfer: Transferable[] = []) => {
    throwIfAborted(options.signal);
    if (closed)
      return Promise.reject(new Error("Local image reading has been closed."));
    const id = ++sequence;
    return new Promise<OcrWordData | undefined>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        nativeWorker.postMessage({ ...body, id }, transfer);
      } catch {
        pending.delete(id);
        reject(
          new Error(
            "Local image reading could not start. Select the PDF again.",
          ),
        );
      }
    });
  };
  nativeWorker.onmessage = (event: MessageEvent<OcrRuntimeResponse>) => {
    if (closed) return;
    const message = event.data;
    if (message.kind === "progress") {
      if (Number.isFinite(message.fraction))
        options.progress?.(Math.max(0, Math.min(1, message.fraction)));
      return;
    }
    const job = pending.get(message.id);
    if (!job) return;
    pending.delete(message.id);
    if (message.kind === "error")
      job.reject(
        new Error(
          message.code === "initialize"
            ? "Local image reading could not start. Install the app fully while online, then try again."
            : "The image could not be read locally. Review the source PDF or export a clearer copy.",
        ),
      );
    else job.resolve(message.kind === "result" ? message.data : undefined);
  };
  const failed = () => {
    stop(
      new DOMException(
        "Local image reading is unavailable. Try importing a digital PDF.",
        "OperationError",
      ),
    );
  };
  nativeWorker.onerror = failed;
  nativeWorker.onmessageerror = failed;
  options.signal?.addEventListener("abort", cancellation, { once: true });
  const worker: LocalOcrWorker = {
    async setParameters(parameters) {
      await request({ action: "parameters", parameters });
    },
    async recognize(canvas) {
      throwIfAborted(options.signal);
      const blob = await abortable(
        new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (value) =>
              value
                ? resolve(value)
                : reject(new Error("The PDF image could not be prepared.")),
            "image/png",
          );
        }),
        options.signal,
      );
      const image = await abortable(blob.arrayBuffer(), options.signal);
      const data = await request({ action: "recognize", image }, [image]);
      return { data: data ?? { blocks: [] } };
    },
    async terminate() {
      stop();
    },
  };
  try {
    const base = new URL(`${import.meta.env.BASE_URL}ocr/`, location.origin)
      .href;
    await request({ action: "initialize", base, dpi: options.dpi });
    return worker;
  } catch (error) {
    stop();
    throw error;
  }
}
