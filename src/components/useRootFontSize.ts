import { useEffect, useState } from "react";

/** Chart gutters scale with text size so axis labels keep their full value. */
export function useRootFontSize() {
  const [size, setSize] = useState(16);
  useEffect(() => {
    const measure = () => {
      const value = Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      if (Number.isFinite(value) && value > 0) setSize(value);
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return size;
}
