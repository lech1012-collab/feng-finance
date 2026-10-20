import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SourceRowCorrection } from "./SourceRowCorrection";
import { SheetVisibilityContext } from "./Sheet";
import type { RowReading } from "../import/generic/types";
afterEach(cleanup);
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.open = false;
    },
  });
});
const reading: RowReading = {
  id: "source",
  date: "2026-09-05",
  bookingDate: "2026-09-06",
  description: "BEAUTY CODE",
  amount: -8100,
  balanceAfterTransaction: 242000,
  parseSource: "text",
};
function show(
  source: RowReading = reading,
  currency: string | undefined = "GBP",
) {
  const onSave = vi.fn(),
    onCancel = vi.fn();
  const view = render(
    <SourceRowCorrection
      reading={source}
      currency={currency}
      busy={false}
      source={<p>Original PDF</p>}
      onSave={onSave}
      onCancel={onCancel}
    />,
  );
  return { onSave, onCancel, ...view };
}
describe("source amount correction", () => {
  it("asks only for an unread date and preserves the known amount and booking date", () => {
    const save = vi.fn();
    render(
      <SourceRowCorrection
        reading={{ ...reading, date: undefined }}
        currency="GBP"
        busy={false}
        fields={["date"]}
        source={<p>Original PDF</p>}
        onSave={save}
        onCancel={vi.fn()}
        saveLabel="Save and continue"
      />,
    );
    expect(screen.getByRole("dialog", { name: "Correct date" })).toBeVisible();
    expect(screen.getByText(/Amount kept:/)).toHaveTextContent("81.00");
    expect(screen.getByRole("textbox", { name: "Date" })).toHaveValue("");
    expect(
      screen.getByRole("textbox", { name: "Amount (GBP)" }).closest("details"),
    ).not.toHaveAttribute("open");
    fireEvent.change(screen.getByRole("textbox", { name: "Date" }), {
      target: { value: "13092026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        date: "2026-09-13",
        bookingDate: "2026-09-06",
        amount: -8100,
        description: "BEAUTY CODE",
      }),
    );
  });
  it("does not reinterpret an incomplete manually entered year as a valid source date", () => {
    const save = vi.fn();
    const view = render(
      <SourceRowCorrection
        reading={reading}
        currency="GBP"
        busy={false}
        fields={["date"]}
        source={null}
        onSave={save}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Date" }), {
      target: { value: "13/06/6" },
    });
    fireEvent.submit(view.container.ownerDocument.querySelector("form")!);
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Date" })).toHaveValue(
      "13/06/6",
    );
  });
  it("portals outside statement containers and preserves typed values while the import route is hidden", () => {
    const onSave = vi.fn();
    const editor = (active: boolean) => (
      <SheetVisibilityContext.Provider value={active}>
        <div data-testid="source-card">
          <SourceRowCorrection
            reading={reading}
            currency="GBP"
            busy={false}
            source={<p>Original PDF</p>}
            onSave={onSave}
            onCancel={vi.fn()}
          />
        </div>
      </SheetVisibilityContext.Provider>
    );
    const view = render(editor(true));
    const dialog = screen.getByRole("dialog", {
      name: "Correct amount",
    });
    expect(screen.getByTestId("source-card").contains(dialog)).toBe(false);
    expect(dialog.closest(".import-correction-overlay")).toHaveAttribute(
      "data-page",
      "import",
    );
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), {
      target: { value: "12." },
    });
    view.rerender(editor(false));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe("hidden");
    view.rerender(editor(true));
    expect(screen.getByLabelText("Amount (GBP)")).toHaveValue("12.");
    expect(screen.getByRole("dialog")).toBeVisible();
    view.unmount();
    expect(
      document.querySelector(".import-correction-overlay"),
    ).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
  it("keeps the amount field editable when currency is missing and blocks an unsafe save", () => {
    const onSave = vi.fn();
    render(
      <SourceRowCorrection
        reading={reading}
        busy={false}
        source={null}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Amount", { exact: true });
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: "80.00" } });
    expect(input).toHaveValue("80.00");
    fireEvent.click(screen.getByRole("button", { name: "Save amount" }));
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(
      "Choose the statement currency",
    );
    expect(onSave).not.toHaveBeenCalled();
  });
  it("accepts an outgoing amount without a minus key and preserves unrelated source facts", () => {
    const { onSave } = show();
    expect(screen.getByLabelText("Amount (GBP)")).toHaveValue("81.00");
    expect(screen.getByRole("button", { name: "Money out" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), {
      target: { value: "80.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save amount" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      kind: "correct",
      date: "2026-09-05",
      bookingDate: "2026-09-06",
      description: "BEAUTY CODE",
      amount: -8000,
      balanceAfterTransaction: 242000,
    });
    expect(reading.amount).toBe(-8100);
  });
  it("preserves incoming signs and allows an explicit change of direction", () => {
    const { onSave } = show({ ...reading, amount: 8100 });
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), {
      target: { value: "80.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save amount" }));
    expect(onSave.mock.calls[0][0].amount).toBe(8000);
    fireEvent.click(screen.getByRole("button", { name: "Money out" }));
    fireEvent.click(screen.getByRole("button", { name: "Save amount" }));
    expect(onSave.mock.calls[1][0].amount).toBe(-8000);
  });
  it("accepts signed paste and keeps the value consistent after a direction change", () => {
    const { onSave } = show();
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), {
      target: { value: "-80.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Money in" }));
    expect(screen.getByLabelText("Amount (GBP)")).toHaveValue("80.00");
    fireEvent.click(screen.getByRole("button", { name: "Save amount" }));
    expect(onSave.mock.calls[0][0].amount).toBe(8000);
  });
  it("requires an explicit direction when the source amount could not be read", () => {
    const { onSave } = show({ ...reading, amount: undefined });
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), {
      target: { value: "80.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save amount" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose Money in or Money out",
    );
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Money out" }));
    fireEvent.click(screen.getByRole("button", { name: "Save amount" }));
    expect(onSave.mock.calls[0][0].amount).toBe(-8000);
  });
  it.each([
    ["£-80.00", -8000],
    ["80.00 DR", -8000],
    ["80.00 CR", 8000],
    ["−80.00 CR", 8000],
    ["(80.00)", -8000],
  ])(
    "preserves the direction of an explicit pasted amount %s",
    (value, expected) => {
      const { onSave } = show({ ...reading, amount: undefined });
      fireEvent.change(screen.getByLabelText("Amount (GBP)"), {
        target: { value },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save amount" }));
      expect(onSave.mock.calls[0][0].amount).toBe(expected);
    },
  );
  it("rejects excess precision, and cancellation never emits a correction", () => {
    const { onSave, onCancel } = show();
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), {
      target: { value: "80.001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save amount" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "correct decimal places",
    );
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel correction" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });
});
