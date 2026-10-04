import { useRef, useState, type PointerEvent } from "react";
export function useSwipe(onSwipe: (direction: "left" | "right") => void) {
  const start = useRef<{
    x: number;
    y: number;
    id: number;
    horizontal: boolean;
  } | null>(null);
  const suppress = useRef(false);
  const [offset, setOffset] = useState(0);
  const reset = () => {
    start.current = null;
    setOffset(0);
  };
  return {
    offset,
    consumeClick: () => {
      const value = suppress.current;
      suppress.current = false;
      return value;
    },
    bind: {
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        suppress.current = false;
        if (!e.isPrimary || e.button !== 0) return;
        start.current = {
          x: e.clientX,
          y: e.clientY,
          id: e.pointerId,
          horizontal: false,
        };
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        const p = start.current;
        if (!p || p.id !== e.pointerId) return;
        const dx = e.clientX - p.x,
          dy = e.clientY - p.y;
        if (!p.horizontal && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
          reset();
          return;
        }
        if (
          !p.horizontal &&
          Math.abs(dx) > 16 &&
          Math.abs(dx) > Math.abs(dy) * 1.5
        ) {
          p.horizontal = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        if (p.horizontal) setOffset(Math.max(-90, Math.min(90, dx)));
      },
      onPointerUp: (e: PointerEvent<HTMLElement>) => {
        const p = start.current;
        if (!p || p.id !== e.pointerId) return;
        const dx = e.clientX - p.x;
        suppress.current = p.horizontal;
        reset();
        if (p.horizontal && Math.abs(dx) >= 64)
          onSwipe(dx < 0 ? "left" : "right");
      },
      onPointerCancel: reset,
    },
  };
}
