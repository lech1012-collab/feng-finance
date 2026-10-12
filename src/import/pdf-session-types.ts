import type {
  ExtractedTextItem,
  PageQuality,
  ParserMethod,
  SourcePage,
  SourceRect,
} from "./generic/types";

export interface ImportProgress {
  phase: "text" | "quality" | "ocr-page" | "ocr-cell";
  page?: number;
  pageCount: number;
  /** Fraction is for the progress indicator, never a financial confidence label. */
  fraction?: number;
  /** This page/cell is committed to the result; a fraction of 1 alone is not. */
  completed?: boolean;
  message: string;
}

export interface PdfExtractionOptions {
  signal?: AbortSignal;
  progress?: (progress: ImportProgress) => void;
  forceOcr?: boolean;
}

export interface ExtractionResult {
  items: ExtractedTextItem[];
  pages: SourcePage[];
  quality: PageQuality[];
  pageCount: number;
  completedPages: number[];
  unreadPages: number[];
  cancelled: boolean;
  method: Extract<ParserMethod, "text" | "text+ocr" | "ocr">;
}

export interface PartialOcrResult {
  items: ExtractedTextItem[];
  completedPages: number[];
  unreadPages: number[];
  cancelled: boolean;
}

export interface CellOcrResult {
  rect: SourceRect;
  items: ExtractedTextItem[];
}

/** The source and raw text never leave the current browser memory. */
export interface PdfImportSession {
  readonly id: string;
  readonly filename: string;
  readonly hash: string;
  readonly pageCount: number;
  extract(options?: PdfExtractionOptions): Promise<ExtractionResult>;
  readCells(
    rects: SourceRect[],
    options?: Omit<PdfExtractionOptions, "forceOcr">,
  ): Promise<CellOcrResult[]>;
  crop(rect: SourceRect, options?: { signal?: AbortSignal }): Promise<Blob>;
  /** Abort work, release PDF/canvas workers and clear raw arrays; safe to repeat. */
  dispose(): Promise<void>;
}
