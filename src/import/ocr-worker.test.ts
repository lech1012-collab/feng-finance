import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalOcrWorker } from "./ocr-worker";
import type { OcrRuntimeRequest, OcrRuntimeResponse } from "./ocr-worker-types";

class BrowserWorker {
  static instances: BrowserWorker[] = [];
  readonly messages: {
    message: OcrRuntimeRequest;
    transfer: Transferable[];
  }[] = [];
  readonly terminate = vi.fn();
  onmessage: ((event: MessageEvent<OcrRuntimeResponse>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: Event) => void) | null = null;
  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    BrowserWorker.instances.push(this);
  }
  postMessage(message: OcrRuntimeRequest, transfer: Transferable[] = []) {
    this.messages.push({ message, transfer });
  }
  emit(message: OcrRuntimeResponse) {
    this.onmessage?.({ data: message } as MessageEvent<OcrRuntimeResponse>);
  }
}

beforeEach(() => {
  BrowserWorker.instances.length = 0;
  vi.stubGlobal("Worker", BrowserWorker);
});
afterEach(() => vi.unstubAllGlobals());

describe("cancelable OCR worker lifetime", () => {
  it("terminates immediately during initialization rather than waiting for Tesseract", async () => {
    const controller = new AbortController();
    const creating = createLocalOcrWorker({
      signal: controller.signal,
      dpi: 300,
    });
    const worker = BrowserWorker.instances[0];
    expect(worker.options).toEqual({ type: "module", name: "feng-local-ocr" });
    expect(worker.messages[0].message).toMatchObject({
      action: "initialize",
      dpi: 300,
      base: new URL("ocr/", location.origin).href,
    });
    controller.abort();
    await expect(creating).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });

  it("sends transferable PNG bytes and stops an active recognition with no late progress", async () => {
    const controller = new AbortController();
    const progress = vi.fn();
    const creating = createLocalOcrWorker({
      signal: controller.signal,
      progress,
      dpi: 300,
    });
    const native = BrowserWorker.instances[0];
    native.emit({ id: 1, kind: "ready" });
    const client = await creating;
    const image = new Uint8Array([1, 2, 3]).buffer;
    const canvas = {
      toBlob: (cb: (blob: Blob) => void) =>
        cb({ arrayBuffer: async () => image } as Blob),
    } as HTMLCanvasElement;
    const recognizing = client.recognize(canvas);
    await vi.waitFor(() => expect(native.messages).toHaveLength(2));
    expect(native.messages[1]).toEqual({
      message: { id: 2, action: "recognize", image },
      transfer: [image],
    });
    native.emit({ kind: "progress", fraction: 0.5 });
    expect(progress).toHaveBeenCalledWith(0.5);
    controller.abort();
    await expect(recognizing).rejects.toMatchObject({ name: "AbortError" });
    native.emit({ kind: "progress", fraction: 1 });
    expect(progress).toHaveBeenCalledOnce();
    await client.terminate();
    expect(native.terminate).toHaveBeenCalledOnce();
  });

  it("uses sanitized actionable failures and releases an unsuccessful initializer", async () => {
    const creating = createLocalOcrWorker({ dpi: 300 });
    const native = BrowserWorker.instances[0];
    native.emit({ id: 1, kind: "error", code: "initialize" });
    await expect(creating).rejects.toThrow(
      "Install the app fully while online",
    );
    expect(native.terminate).toHaveBeenCalledOnce();
  });

  it("resolves completed work before disposing and rejects further image work", async () => {
    const creating = createLocalOcrWorker({ dpi: 300 });
    const native = BrowserWorker.instances[0];
    native.emit({ id: 1, kind: "ready" });
    const client = await creating;
    const setting = client.setParameters({
      tessedit_char_whitelist: "0123456789,.-()",
    });
    native.emit({ id: 2, kind: "result" });
    await setting;
    const image = new ArrayBuffer(4);
    const canvas = {
      toBlob: (cb: (blob: Blob) => void) =>
        cb({ arrayBuffer: async () => image } as Blob),
    } as HTMLCanvasElement;
    const recognizing = client.recognize(canvas);
    await vi.waitFor(() => expect(native.messages).toHaveLength(3));
    native.emit({ id: 3, kind: "result", data: { blocks: [] } });
    await expect(recognizing).resolves.toEqual({ data: { blocks: [] } });
    await client.terminate();
    await expect(client.setParameters({})).rejects.toThrow("closed");
    expect(native.terminate).toHaveBeenCalledOnce();
  });
});
