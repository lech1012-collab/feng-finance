import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
} from "react";
import { GripVertical } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import type { Transaction } from "../domain/models";
import { useSwipe } from "./useSwipe";
import { displayMerchant } from "../domain/presentation";
export function SwipeTransaction({
  transaction: t,
  returnTo,
  onCategorize,
  children,
  onDragCategorize,
  selected,
  onSelect,
  suggestion,
  onQuickCategorize,
  accessibleLabel,
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
  selected?: boolean;
  onSelect?: (event: MouseEvent<HTMLElement>) => void;
  suggestion?: { id: string; name: string };
  onQuickCategorize?: (categoryId: string) => void;
  accessibleLabel?: string;
}) {
  const location = useLocation();
  const drag = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const dragged = useRef(false);
  const [revealed, setRevealed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  useEffect(() => {
    if (!isDragging) return;
    const release = () => setIsDragging(false);
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") release();
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("keydown", cancel);
    };
  }, [isDragging]);
  const enabled = !t.isTransfer && t.type !== "transfer" && !t.transferPairId;
  const swipe = useSwipe((direction) => {
    if (!enabled) return;
    if (direction === "left" && suggestion && onQuickCategorize)
      setRevealed(true);
    else onCategorize();
  });
  return (
    <div
      className={`swipe-transaction ${selected ? "selected" : ""} ${revealed ? "revealed" : ""} ${isDragging ? "is-dragging" : ""}`}
    >
      {enabled && revealed && (
        <div className="swipe-actions">
          <button
            onClick={() => {
              setRevealed(false);
              if (suggestion) onQuickCategorize?.(suggestion.id);
            }}
            aria-label={`Categorize as ${suggestion?.name}`}
          >
            {suggestion?.name}
          </button>
          <button
            onClick={() => {
              setRevealed(false);
              onCategorize();
            }}
          >
            More
          </button>
        </div>
      )}
      {enabled && (
        <span className="swipe-reveal" aria-hidden="true">
          Choose a category
        </span>
      )}
      <Link
        className="transaction-row"
        aria-label={accessibleLabel}
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
            setIsDragging(true);
            onDragCategorize?.({
              x: e.clientX,
              y: e.clientY,
              pointerId: e.pointerId,
            });
          } else if (enabled && !dragged.current) swipe.bind.onPointerMove(e);
        }}
        onPointerUp={(e) => {
          drag.current = null;
          setIsDragging(false);
          if (enabled && !dragged.current) swipe.bind.onPointerUp(e);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setIsDragging(false);
          swipe.bind.onPointerCancel();
        }}
        style={{ transform: `translateX(${revealed ? -160 : swipe.offset}px)` }}
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
          if (revealed) {
            e.preventDefault();
            setRevealed(false);
            return;
          }
          if (enabled && onSelect && (e.metaKey || e.ctrlKey || e.shiftKey)) {
            e.preventDefault();
            onSelect(e);
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
        {enabled && (
          <span className="drag-handle desktop-only" aria-hidden="true">
            <GripVertical size={16} />
          </span>
        )}
        {children}
      </Link>
      {enabled && (
        <div className="row-hover-actions desktop-only">
          <button
            className="row-selection"
            aria-label={`Select ${displayMerchant(t)}`}
            aria-pressed={!!selected}
            disabled={isDragging}
            onClick={onSelect}
          >
            Select
          </button>
          <button
            title="Categorize (C)"
            disabled={isDragging}
            onClick={onCategorize}
          >
            Categorize
          </button>
        </div>
      )}
    </div>
  );
}
