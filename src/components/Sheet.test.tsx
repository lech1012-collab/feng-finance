import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Sheet, SheetFooter } from "./Sheet";

beforeEach(() => {
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
});
afterEach(cleanup);

function Editor() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Edit account</button>
      {open && (
        <Sheet title="Edit account" onClose={() => setOpen(false)}>
          <label>
            Account name
            <input defaultValue="Everyday account" />
          </label>
          <SheetFooter>
            <button onClick={() => setOpen(false)}>Save account</button>
          </SheetFooter>
        </Sheet>
      )}
    </>
  );
}

it("traps content in a native modal and returns focus to the invoking object", () => {
  render(<Editor />);
  const opener = screen.getByRole("button", { name: "Edit account" });
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByRole("dialog", { name: "Edit account" })).toHaveAttribute(
    "aria-modal",
    "true",
  );
  expect(document.body.style.overflow).toBe("hidden");
  fireEvent.click(screen.getByRole("button", { name: "Close Edit account" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  expect(document.body.style.overflow).toBe("");
});

it("uses one footer host outside the scrolling form and closes on native Escape", () => {
  render(<Editor />);
  fireEvent.click(screen.getByRole("button", { name: "Edit account" }));
  const dialog = screen.getByRole("dialog", { name: "Edit account" });
  const save = screen.getByRole("button", { name: "Save account" });
  expect(save.closest(".sheet-footer")).toBe(
    dialog.querySelector(".sheet-footer"),
  );
  expect(dialog.querySelector(".sheet-content")?.contains(save)).toBe(false);
  const cancel = new Event("cancel", { cancelable: true });
  fireEvent(dialog, cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
