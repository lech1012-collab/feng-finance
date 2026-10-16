import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UKDateInput } from "./UKDateInput";

afterEach(cleanup);

function Harness({
  min,
  max,
  save = () => {},
}: {
  min?: string;
  max?: string;
  save?: (date: string) => void;
}) {
  const [date, setDate] = useState("2026-09-01");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save(date);
      }}
    >
      <label>
        Date
        <UKDateInput
          required
          value={date}
          min={min}
          max={max}
          onChange={setDate}
        />
      </label>
      <output aria-label="Stored ISO date">{date}</output>
      <button>Save</button>
    </form>
  );
}

it("shows UK order independently of the browser locale and preserves the ISO value", () => {
  const { container } = render(<Harness />);
  expect(screen.getByRole("textbox", { name: "Date" })).toHaveValue(
    "01/09/2026",
  );
  expect(screen.getByLabelText("Stored ISO date")).toHaveTextContent(
    "2026-09-01",
  );
  expect(container.querySelector('input[type="date"]')).toHaveValue(
    "2026-09-01",
  );
});

it("interprets an ambiguous numeric date in day/month order", () => {
  const save = vi.fn();
  render(<Harness save={save} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Date" }), {
    target: { value: "9/1/2026" },
  });
  expect(screen.getByRole("textbox", { name: "Date" })).toHaveValue(
    "09/01/2026",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(save).toHaveBeenCalledWith("2026-01-09");
});

it("normalises an unambiguous ISO paste immediately to the visible UK format", () => {
  render(<Harness />);
  fireEvent.change(screen.getByRole("textbox", { name: "Date" }), {
    target: { value: "2026-09-30" },
  });
  expect(screen.getByRole("textbox", { name: "Date" })).toHaveValue(
    "30/09/2026",
  );
  expect(screen.getByLabelText("Stored ISO date")).toHaveTextContent(
    "2026-09-30",
  );
});

it("accepts the iPhone numeric keypad's eight digits in UK order while rejecting impossible and partial dates", () => {
  const save = vi.fn();
  render(<Harness save={save} />);
  const input = screen.getByRole("textbox", { name: "Date" });
  for (const draft of ["0901202", "09302026", "31042026"]) {
    fireEvent.change(input, { target: { value: draft } });
    expect(input).toHaveValue(draft);
    expect(input).toBeInvalid();
    expect(screen.getByLabelText("Stored ISO date")).toBeEmptyDOMElement();
  }
  fireEvent.change(input, { target: { value: "09012026" } });
  expect(input).toHaveValue("09/01/2026");
  expect(input).toBeValid();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(save).toHaveBeenCalledWith("2026-01-09");
});

it.each(["09/30/2026", "31/04/2026", "29/02/2027", "30/09/26", "2026-02-30"])(
  "rejects invalid or non-UK date %s without retaining a previous valid submission",
  (value) => {
    const save = vi.fn();
    render(<Harness save={save} />);
    const input = screen.getByRole("textbox", { name: "Date" });
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
    expect(input).toBeInvalid();
    expect(screen.getByRole("alert")).toHaveTextContent("DD/MM/YYYY");
    expect(screen.getByLabelText("Stored ISO date")).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).not.toHaveBeenCalled();
  },
);

it("keeps an incomplete draft visible while clearing its previously valid ISO value", () => {
  render(<Harness />);
  const input = screen.getByRole("textbox", { name: "Date" });
  fireEvent.change(input, { target: { value: "2/0" } });
  expect(input).toHaveValue("2/0");
  expect(screen.getByLabelText("Stored ISO date")).toBeEmptyDOMElement();
  fireEvent.change(input, { target: { value: "29/02/2028" } });
  expect(input).toBeValid();
  expect(screen.getByLabelText("Stored ISO date")).toHaveTextContent(
    "2028-02-29",
  );
  fireEvent.change(input, { target: { value: "" } });
  expect(input).toHaveValue("");
  expect(screen.getByLabelText("Stored ISO date")).toBeEmptyDOMElement();
});

it("honours existing date bounds with UK error messages", () => {
  render(<Harness min="2026-09-01" max="2026-09-30" />);
  const input = screen.getByRole("textbox", { name: "Date" });
  fireEvent.change(input, { target: { value: "31/08/2026" } });
  fireEvent.blur(input);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Use 01/09/2026 or later.",
  );
  fireEvent.change(input, { target: { value: "01/10/2026" } });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Use 30/09/2026 or earlier.",
  );
  fireEvent.change(input, { target: { value: "30/09/2026" } });
  expect(input).toBeValid();
});

it("displays external changes and keeps source-review dates read-only", () => {
  const { rerender } = render(
    <label>
      Date
      <UKDateInput readOnly value="2026-09-01" onChange={vi.fn()} />
    </label>,
  );
  expect(screen.getByRole("textbox", { name: "Date" })).toHaveValue(
    "01/09/2026",
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  rerender(
    <label>
      Date
      <UKDateInput readOnly value="2026-10-02" onChange={vi.fn()} />
    </label>,
  );
  expect(screen.getByRole("textbox", { name: "Date" })).toHaveValue(
    "02/10/2026",
  );
  expect(screen.getByRole("textbox", { name: "Date" })).toHaveAttribute(
    "readonly",
  );
});

it("opens the native calendar without changing the date and formats its selected ISO value", () => {
  const { container } = render(<Harness />);
  const picker =
    container.querySelector<HTMLInputElement>('input[type="date"]')!;
  const showPicker = vi.fn();
  Object.defineProperty(picker, "showPicker", {
    configurable: true,
    value: showPicker,
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Open calendar for Date" }),
  );
  expect(showPicker).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Stored ISO date")).toHaveTextContent(
    "2026-09-01",
  );
  fireEvent.change(picker, { target: { value: "2026-10-02" } });
  expect(screen.getByRole("textbox", { name: "Date" })).toHaveValue(
    "02/10/2026",
  );
  expect(screen.getByLabelText("Stored ISO date")).toHaveTextContent(
    "2026-10-02",
  );
});
