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
afterEach(cleanup);
function pointer(element: HTMLElement, type: string, x: number, y = 100) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, {
    pointerId: 1,
    pointerType: "touch",
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
