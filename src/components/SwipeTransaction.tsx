import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { Transaction } from "../domain/models";
import { useSwipe } from "./useSwipe";
export function SwipeTransaction({
  transaction: t,
  returnTo,
  onCategorize,
  children,
}: {
  transaction: Transaction;
  returnTo?: string;
  onCategorize: () => void;
  children: ReactNode;
}) {
  const location = useLocation();
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
        style={{ transform: `translateX(${swipe.offset}px)` }}
        aria-haspopup={enabled && !t.categoryId ? "dialog" : undefined}
        aria-keyshortcuts={enabled ? "C" : undefined}
        onClick={(e) => {
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
