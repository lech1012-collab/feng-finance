import { useRef, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { Transaction } from "../domain/models";
import { useSwipe } from "./useSwipe";
export function SwipeTransaction({
  transaction: t,
  returnTo,
  onCategorize,
  children,
  onDragCategorize,
}: {
  transaction: Transaction;
  returnTo?: string;
  onCategorize: () => void;
  children: ReactNode;
  onDragCategorize?: (start: {
    x: number;
    y: number;
    pointerId: number;
  }) => void;
}) {
  const location = useLocation();
  const drag = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const dragged = useRef(false);
  const enabled = !t.isTransfer && t.type !== "transfer" && !t.transferPairId;
  const swipe = useSwipe(() => {
    if (enabled) onCategorize();
  });
  return (
    <div className="swipe-transaction">
      {enabled && (
        <span className="swipe-reveal" aria-hidden="true">
          Choose a category
        </span>
      )}
      <Link
        className="transaction-row"
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        to={`/transactions/${t.id}`}
        state={{ returnTo: returnTo ?? location.pathname + location.search }}
        {...(enabled ? swipe.bind : {})}
        onPointerDown={(e) => {
          if (
            enabled &&
            e.pointerType === "mouse" &&
            window.matchMedia("(min-width: 761px)").matches &&
            e.button === 0 &&
            onDragCategorize
          ) {
            dragged.current = false;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = {
              x: e.clientX,
              y: e.clientY,
              pointerId: e.pointerId,
            };
          } else if (enabled) swipe.bind.onPointerDown(e);
        }}
        onPointerMove={(e) => {
          if (
            drag.current &&
            Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y) >
              8
          ) {
            drag.current = null;
            dragged.current = true;
            onDragCategorize?.({
              x: e.clientX,
              y: e.clientY,
              pointerId: e.pointerId,
            });
          } else if (enabled && !dragged.current) swipe.bind.onPointerMove(e);
        }}
        onPointerUp={(e) => {
          drag.current = null;
          if (enabled && !dragged.current) swipe.bind.onPointerUp(e);
        }}
        onPointerCancel={() => {
          drag.current = null;
          swipe.bind.onPointerCancel();
        }}
        style={{ transform: `translateX(${swipe.offset}px)` }}
        aria-haspopup={enabled && !t.categoryId ? "dialog" : undefined}
        aria-keyshortcuts={enabled ? "C" : undefined}
        onClick={(e) => {
          if (dragged.current) {
            dragged.current = false;
            e.preventDefault();
            return;
          }
          if (swipe.consumeClick()) {
            e.preventDefault();
            return;
          }
          if (
            enabled &&
            !t.categoryId &&
            !e.metaKey &&
            !e.ctrlKey &&
            !e.shiftKey &&
            !e.altKey
          ) {
            e.preventDefault();
            onCategorize();
          }
        }}
        onKeyDown={(e) => {
          if (
            enabled &&
            e.key.toLowerCase() === "c" &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey
          ) {
            e.preventDefault();
            onCategorize();
          }
        }}
      >
        {children}
      </Link>
    </div>
  );
}
