import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OcrRuntimeRequest, OcrRuntimeResponse } from "./ocr-worker-types";

const mock = vi.hoisted(() => ({
  createWorker: vi.fn(),
  setParameters: vi.fn(),
  recognize: vi.fn(),
}));
vi.mock("tesseract.js", () => ({
  createWorker: mock.createWorker,
  OEM: { LSTM_ONLY: 1 },
}));

const runtime = {
  location: { origin: "https://feng.test" },
  onmessage: null as ((event: MessageEvent<OcrRuntimeRequest>) => void) | null,
  postMessage: vi.fn<(message: OcrRuntimeResponse) => void>(),
};
async function send(request: OcrRuntimeRequest) {
  if (!runtime.onmessage) await import("./ocr-runtime.worker");
  runtime.onmessage!({ data: request } as MessageEvent<OcrRuntimeRequest>);
}
async function initialize() {
  await send({
    id: 1,
    action: "initialize",
    base: "https://feng.test/finance/ocr/",
    dpi: 300,
  });
  await vi.waitFor(() =>
    expect(runtime.postMessage).toHaveBeenCalledWith({ id: 1, kind: "ready" }),
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  runtime.onmessage = null;
  vi.stubGlobal("self", runtime);
  mock.setParameters.mockResolvedValue(undefined);
  mock.recognize.mockResolvedValue({ data: { blocks: [] } });
  mock.createWorker.mockResolvedValue({
    setParameters: mock.setParameters,
    recognize: mock.recognize,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("private local OCR runtime", () => {
  it("rejects an external asset origin before starting Tesseract", async () => {
    await send({
      id: 1,
      action: "initialize",
      base: "https://external.test/ocr/",
      dpi: 300,
    });
    await vi.waitFor(() =>
      expect(runtime.postMessage).toHaveBeenCalledWith({
        id: 1,
        kind: "error",
        code: "initialize",
      }),
    );
    expect(mock.createWorker).not.toHaveBeenCalled();
  });

  it("loads only base-relative local assets and sends PNG Blob input to the browser engine", async () => {
    await initialize();
    expect(mock.createWorker).toHaveBeenCalledWith(
      "eng",
      1,
      expect.objectContaining({
        workerPath: "https://feng.test/finance/ocr/worker.min.js",
        corePath: "https://feng.test/finance/ocr/",
        langPath: "https://feng.test/finance/ocr/",
        workerBlobURL: false,
        gzip: true,
      }),
    );
    expect(mock.setParameters).toHaveBeenCalledWith({
      user_defined_dpi: "300",
    });
    await send({ id: 2, action: "recognize", image: new ArrayBuffer(8) });
    await vi.waitFor(() => expect(mock.recognize).toHaveBeenCalledOnce());
    const image = mock.recognize.mock.calls[0][0] as Blob;
    expect(image).toBeInstanceOf(Blob);
    expect(image.type).toBe("image/png");
    expect(image.size).toBe(8);
  });

  it("returns only positioned words instead of complete library output or document metadata", async () => {
    mock.recognize.mockResolvedValue({
      data: {
        text: "Private complete statement text",
        pdf: new Uint8Array([1, 2]),
        blocks: [
          {
            text: "Private block text",
            paragraphs: [
              {
                text: "Private paragraph text",
                lines: [
                  {
                    text: "Private line text",
                    words: [
                      {
                        text: "78.43",
                        confidence: 90,
                        bbox: {
                          x0: 1,
                          y0: 2,
                          x1: 3,
                          y1: 4,
                          privateField: "discard",
                        },
                        symbols: [{ text: "Private redundant symbol output" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    await initialize();
    await send({ id: 2, action: "recognize", image: new ArrayBuffer(8) });
    await vi.waitFor(() =>
      expect(runtime.postMessage).toHaveBeenCalledWith({
        id: 2,
        kind: "result",
        data: {
          blocks: [
            {
              paragraphs: [
                {
                  lines: [
                    {
                      words: [
                        {
                          text: "78.43",
                          confidence: 90,
                          bbox: { x0: 1, y0: 2, x1: 3, y1: 4 },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    );
  });

  it("replaces library failures with an allowlisted code without forwarding private exception text", async () => {
    mock.recognize.mockRejectedValue(
      new Error("Private account number 12344321"),
    );
    await initialize();
    await send({ id: 2, action: "recognize", image: new ArrayBuffer(8) });
    await vi.waitFor(() =>
      expect(runtime.postMessage).toHaveBeenCalledWith({
        id: 2,
        kind: "error",
        code: "recognize",
      }),
    );
    expect(JSON.stringify(runtime.postMessage.mock.calls)).not.toContain(
      "12344321",
    );
  });
});
