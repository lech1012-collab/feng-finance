import { useLayoutEffect, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { Sheet } from "./Sheet";

/** Every import editor shares the same bounded, stationary mobile surface. */
export function ImportReviewSheet(props: ComponentProps<typeof Sheet>) {
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.className = "app import-workspace import-correction-overlay";
    element.dataset.page = "import";
    return element;
  });
  const [connected, setConnected] = useState(false);
  useLayoutEffect(() => {
    document.body.append(host);
    setConnected(true);
    return () => host.remove();
  }, [host]);
  return connected ? createPortal(<Sheet {...props} />, host) : null;
}
