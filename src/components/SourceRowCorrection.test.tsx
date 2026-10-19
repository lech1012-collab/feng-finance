import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SourceRowCorrection } from "./SourceRowCorrection";
import type { RowReading } from "../import/generic/types";
afterEach(cleanup);
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
    fireEvent.click(screen.getByRole("button", { name: "Save row" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Save row" }));
    expect(onSave.mock.calls[0][0].amount).toBe(8000);
    fireEvent.click(screen.getByRole("button", { name: "Money out" }));
    fireEvent.click(screen.getByRole("button", { name: "Save row" }));
    expect(onSave.mock.calls[1][0].amount).toBe(-8000);
  });
  it("accepts signed paste and keeps the value consistent after a direction change", () => {
    const { onSave } = show();
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), {
      target: { value: "-80.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Money in" }));
    expect(screen.getByLabelText("Amount (GBP)")).toHaveValue("80.00");
    fireEvent.click(screen.getByRole("button", { name: "Save row" }));
    expect(onSave.mock.calls[0][0].amount).toBe(8000);
  });
  it("requires an explicit direction when the source amount could not be read", () => {
    const { onSave } = show({ ...reading, amount: undefined });
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), {
      target: { value: "80.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save row" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose Money in or Money out",
    );
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Money out" }));
    fireEvent.click(screen.getByRole("button", { name: "Save row" }));
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
      fireEvent.click(screen.getByRole("button", { name: "Save row" }));
      expect(onSave.mock.calls[0][0].amount).toBe(expected);
    },
  );
  it("rejects excess precision, and cancellation never emits a correction", () => {
    const { onSave, onCancel } = show();
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), {
      target: { value: "80.001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save row" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "correct decimal places",
    );
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel correction" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });
});
