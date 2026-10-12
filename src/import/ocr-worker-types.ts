/** Minimal recognized shape: never retain the OCR engine's unused image output. */
export interface OcrWordData {
  blocks?:
    | {
        paragraphs: {
          lines: {
            words: {
              text: string;
              confidence: number;
              bbox: { x0: number; y0: number; x1: number; y1: number };
            }[];
          }[];
        }[];
      }[]
    | null;
}

export interface LocalOcrWorker {
  setParameters(parameters: Record<string, string | number>): Promise<void>;
  recognize(canvas: HTMLCanvasElement): Promise<{ data: OcrWordData }>;
  terminate(): Promise<void>;
}

export type OcrRuntimeRequest =
  | { id: number; action: "initialize"; base: string; dpi: number }
  | {
      id: number;
      action: "parameters";
      parameters: Record<string, string | number>;
    }
  | { id: number; action: "recognize"; image: ArrayBuffer };

type WithoutId<T> = T extends { id: number } ? Omit<T, "id"> : never;
export type OcrRuntimeBody = WithoutId<OcrRuntimeRequest>;

export type OcrRuntimeResponse =
  | { id: number; kind: "ready" }
  | { id: number; kind: "result"; data?: OcrWordData }
  | {
      id: number;
      kind: "error";
      code: "initialize" | "recognize" | "parameters";
    }
  | { kind: "progress"; fraction: number };
