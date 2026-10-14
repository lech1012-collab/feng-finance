import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Sheet } from "./Sheet";
import { Toast, ToastProvider } from "./Toast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Messages({ undo = vi.fn() }: { undo?: () => void | Promise<void> }) {
  const [message, setMessage] = useState("");
  return (
    <ToastProvider>
      <div data-testid="protected-app">
        <button
          onClick={() =>
            setMessage(
              "Groceries · Waitrose on Barclays. Future ones will follow.",
            )
          }
        >
          Categorise
        </button>
        <button onClick={() => setMessage("Display name saved.")}>
          Rename
        </button>
        <Toast message={message} undo={undo} />
      </div>
    </ToastProvider>
  );
}

it("shows only the latest message and reverses the associated change once", async () => {
  const undo = vi.fn();
  render(<Messages undo={undo} />);
  fireEvent.click(screen.getByRole("button", { name: "Categorise" }));
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent("Display name saved.");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  });
  expect(undo).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("stays available while Undo has focus and expires six seconds after focus leaves", () => {
  vi.useFakeTimers();
  render(<Messages />);
  fireEvent.click(screen.getByRole("button", { name: "Categorise" }));
  const undo = screen.getByRole("button", { name: "Undo" });
  fireEvent.focus(undo);
  act(() => vi.advanceTimersByTime(7000));
  expect(screen.getByRole("status")).toBeVisible();
  fireEvent.blur(undo, {
    relatedTarget: screen.getByRole("button", { name: "Rename" }),
  });
  act(() => vi.advanceTimersByTime(6000));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("keeps a failed Undo available with its actionable error instead of a success", async () => {
  const undo = vi
    .fn()
    .mockRejectedValue(
      new Error("This month is closed. Reopen it before undoing."),
    );
  render(<Messages undo={undo} />);
  fireEvent.click(screen.getByRole("button", { name: "Categorise" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  });
  expect(screen.getByRole("status")).toHaveTextContent(
    "This month is closed. Reopen it before undoing.",
  );
  expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
});

it("positions a toast twelve pixels above the actual bottom navigation", () => {
  const { container } = render(
    <>
      <nav className="mobile-navigation" style={{ position: "fixed" }}>
        Home
      </nav>
      <Messages />
    </>,
  );
  const navigation = container.querySelector("nav")!;
  vi.spyOn(navigation, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 680,
    left: 0,
    top: 680,
    width: 390,
    height: 88,
    right: 390,
    bottom: 768,
    toJSON: () => ({}),
  });
  fireEvent.click(screen.getByRole("button", { name: "Categorise" }));
  expect(screen.getByRole("status").style.bottom).toBe(
    `${window.innerHeight - 680 + 12}px`,
  );
});

it("puts a sheet's toast into the top-layer dialog and leaves its footer clear", () => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    },
  });
  render(
    <ToastProvider>
      <Sheet
        title="Sort transaction"
        onClose={vi.fn()}
        footer={<button>Skip</button>}
      >
        <Toast message="Groceries saved." undo={vi.fn()} />
      </Sheet>
    </ToastProvider>,
  );
  const dialog = screen.getByRole("dialog", { name: "Sort transaction" });
  const footer = dialog.querySelector<HTMLElement>(".sheet-footer")!;
  vi.spyOn(footer, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 700,
    left: 0,
    top: 700,
    width: 390,
    height: 68,
    right: 390,
    bottom: 768,
    toJSON: () => ({}),
  });
  fireEvent(window, new Event("resize"));
  expect(screen.getByRole("status").parentElement).toBe(dialog);
  expect(screen.getByRole("status").style.bottom).toBe("80px");
});
