import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContextHelp } from "./ContextHelp";
import { Sheet } from "./Sheet";

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

it("keeps financial explanations within the privacy boundary and closes them before leaving the app", () => {
  render(
    <div className="feng-private-content">
      <ContextHelp title="Recorded balances">
        <p>Private balance evidence</p>
      </ContextHelp>
    </div>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "About Recorded balances" }),
  );
  expect(
    screen
      .getByRole("dialog", { name: "Recorded balances" })
      .closest(".feng-private-content"),
  ).not.toBeNull();
  fireEvent(window, new Event("pagehide"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.queryByText("Private balance evidence"),
  ).not.toBeInTheDocument();
});

it("keeps optional explanations off the page and returns focus after closing help", () => {
  render(
    <ContextHelp title="Monthly averages">
      <p>Only previous recorded months form the comparison.</p>
    </ContextHelp>,
  );
  const trigger = screen.getByRole("button", {
    name: "About Monthly averages",
  });
  expect(screen.queryByText(/Only previous recorded/)).not.toBeInTheDocument();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Monthly averages" });
  expect(dialog).toHaveAttribute("id", trigger.getAttribute("aria-controls"));
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText(/Only previous recorded/)).toBeVisible();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger).toHaveFocus();
});

it("keeps warning details available through a named warning control", () => {
  render(
    <ContextHelp
      title="Partial history"
      tone="warning"
      label="Why spending is partial"
    >
      <p>More statements may change this total.</p>
    </ContextHelp>,
  );
  const trigger = screen.getByRole("button", {
    name: "Why spending is partial",
  });
  expect(trigger).toHaveClass("context-help-trigger--warning");
  fireEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "Partial history" })).toBeVisible();
  expect(screen.getByText(/More statements/)).toBeVisible();
});

it("opens help within an existing editor without nesting a modal or closing its form", () => {
  render(
    <Sheet title="Edit plan" onClose={() => undefined}>
      <div className="context-help-heading">
        <h3>Forecast</h3>
        <ContextHelp title="Forecast assumptions">
          <p>This is an estimate using the saved plan.</p>
        </ContextHelp>
      </div>
      <label>
        Planned amount
        <input defaultValue="100" />
      </label>
    </Sheet>,
  );
  const trigger = screen.getByRole("button", {
    name: "About Forecast assumptions",
  });
  fireEvent.click(trigger);
  const region = screen.getByRole("region", { name: "Forecast assumptions" });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(region).toHaveFocus();
  const shortcut = vi.fn();
  window.addEventListener("keydown", shortcut);
  try {
    fireEvent.keyDown(region, { key: "1" });
    fireEvent.keyDown(region, { key: "j" });
    fireEvent.keyDown(region, { key: "z", ctrlKey: true });
    expect(shortcut).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("keydown", shortcut);
  }
  expect(screen.getByRole("textbox", { name: "Planned amount" })).toHaveValue(
    "100",
  );
  fireEvent.keyDown(region, { key: "Escape" });
  expect(
    screen.queryByRole("region", { name: "Forecast assumptions" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Edit plan" })).toBeVisible();
  expect(trigger).toHaveFocus();
});
