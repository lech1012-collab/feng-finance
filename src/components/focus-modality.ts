/**
 * Native dialogs may restore :focus-visible after a tap, especially in Safari.
 * Keep focus restoration for accessibility, but distinguish actual pointer use
 * from keyboard navigation when painting control outlines.
 */
export function trackFocusModality(document: Document) {
  const root = document.documentElement;
  const pointer = () => {
    root.dataset.focusModality = "pointer";
  };
  const keyboard = () => {
    root.dataset.focusModality = "keyboard";
  };
  // Capture also sees events inside editors that isolate their shortcuts.
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("keydown", keyboard, true);
  return () => {
    document.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("keydown", keyboard, true);
    delete root.dataset.focusModality;
  };
}
