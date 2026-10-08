import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SwipeTransaction } from "./SwipeTransaction";
import { transaction } from "../tests/helpers";

beforeEach(() =>
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  }),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function pointer(
  element: HTMLElement,
  type: string,
  x: number,
  y = 100,
  pointerType = "touch",
) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, {
    pointerId: 1,
    pointerType,
    isPrimary: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  fireEvent(element, event);
}
it("reveals the top suggestion and More on a left swipe without saving until chosen", () => {
  const categorize = vi.fn(),
    quick = vi.fn();
  render(
    <MemoryRouter>
      <SwipeTransaction
        transaction={transaction()}
        onCategorize={categorize}
        suggestion={{ id: "groceries", name: "Groceries" }}
        onQuickCategorize={quick}
      >
        Corner shop
      </SwipeTransaction>
    </MemoryRouter>,
  );
  const row = screen.getByRole("link", { name: "Corner shop" });
  pointer(row, "pointerdown", 200);
  pointer(row, "pointermove", 100);
  pointer(row, "pointerup", 100);
  expect(quick).not.toHaveBeenCalled();
  expect(categorize).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Categorize as Groceries" }),
  );
  expect(quick).toHaveBeenCalledWith("groceries");
});
it("leaves iOS back-edge gestures and vertical scrolling to the browser", () => {
  const categorize = vi.fn();
  render(
    <MemoryRouter>
      <SwipeTransaction transaction={transaction()} onCategorize={categorize}>
        Corner shop
      </SwipeTransaction>
    </MemoryRouter>,
  );
  const row = screen.getByRole("link", { name: "Corner shop" });
  pointer(row, "pointerdown", 10);
  pointer(row, "pointermove", 110);
  pointer(row, "pointerup", 110);
  pointer(row, "pointerdown", 200);
  pointer(row, "pointermove", 202, 160);
  pointer(row, "pointerup", 280, 200);
  expect(categorize).not.toHaveBeenCalled();
});

it("disables same-row hover actions during object drag and restores them on Escape", () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  const categorize = vi.fn();
  const drag = vi.fn();
  render(
    <MemoryRouter>
      <SwipeTransaction
        transaction={transaction()}
        onCategorize={categorize}
        onDragCategorize={drag}
      >
        Corner shop
      </SwipeTransaction>
    </MemoryRouter>,
  );
  const row = screen.getByRole("link", { name: "Corner shop" });
  pointer(row, "pointerdown", 200, 100, "mouse");
  pointer(row, "pointermove", 220, 100, "mouse");
  expect(drag).toHaveBeenCalledExactlyOnceWith({
    x: 220,
    y: 100,
    pointerId: 1,
  });
  expect(row.parentElement).toHaveClass("is-dragging");
  expect(screen.getByRole("button", { name: "Categorize" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Select Waitrose" }),
  ).toBeDisabled();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(row.parentElement).not.toHaveClass("is-dragging");
  expect(screen.getByRole("button", { name: "Categorize" })).toBeEnabled();
  pointer(row, "pointerup", 220, 100, "mouse");
  fireEvent.click(row);
  expect(categorize).not.toHaveBeenCalled();
});
