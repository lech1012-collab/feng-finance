// Filenames belong to the tab. A random replacement marker is shared across tabs
// so a browser-restored tab can discard hints for a ledger that was erased.
const filesKey = "feng-unfinished-import-files";
const replacementKey = "feng-import-review-replacement";
let memoryReplacement = "";

export function importReviewGeneration(): string {
  try {
    return localStorage.getItem(replacementKey) ?? memoryReplacement;
  } catch {
    return memoryReplacement;
  }
}

export function readInterruptedReview(): string[] {
  try {
    const raw = sessionStorage.getItem(filesKey);
    if (!raw) return [];
    const hint: unknown = JSON.parse(raw);
    if (
      hint &&
      typeof hint === "object" &&
      "generation" in hint &&
      hint.generation === importReviewGeneration() &&
      "names" in hint &&
      Array.isArray(hint.names) &&
      hint.names.every((name) => typeof name === "string")
    )
      return hint.names;
    sessionStorage.removeItem(filesKey);
  } catch {
    // The tab can still start a new review if session storage is unavailable.
  }
  return [];
}

export function rememberImportFiles(names: string[]) {
  try {
    if (!names.length) {
      sessionStorage.removeItem(filesKey);
      return;
    }
    const value = JSON.stringify({
      generation: importReviewGeneration(),
      names,
    });
    if (sessionStorage.getItem(filesKey) !== value)
      sessionStorage.setItem(filesKey, value);
  } catch {
    // Browsers can disable session storage. The active review still works in memory.
  }
}

export function invalidateImportReview() {
  rememberImportFiles([]);
  memoryReplacement = crypto.randomUUID();
  try {
    localStorage.setItem(replacementKey, memoryReplacement);
  } catch {
    // Same-tab resets also work when persistent storage is unavailable.
  }
  window.dispatchEvent(new Event(replacementKey));
}

export function subscribeImportReplacement(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === replacementKey || event.key === null) onChange();
  };
  window.addEventListener(replacementKey, onChange);
  window.addEventListener("storage", onStorage);
  window.addEventListener("pageshow", onChange);
  return () => {
    window.removeEventListener(replacementKey, onChange);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pageshow", onChange);
  };
}
