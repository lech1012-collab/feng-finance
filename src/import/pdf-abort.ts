/** Abort without leaving a rejected PDF/OCR promise or event listener behind. */
export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException("Import cancelled.", "AbortError");
}

export function isImportAbort(error: unknown) {
  // DOMException is not an Error in every browser realm (including Safari).
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

export async function abortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  cancel?: () => void,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    cancel?.();
    // Promise work may already have started. Consume any subsequent rejection.
    void promise.catch(() => undefined);
    throw new DOMException("Import cancelled.", "AbortError");
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cancel?.();
      reject(new DOMException("Import cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** The session lifetime and a per-operation cancel button can each stop work. */
export function linkedAbort(...signals: (AbortSignal | undefined)[]) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    release: () => {
      for (const signal of signals) signal?.removeEventListener("abort", abort);
    },
  };
}
