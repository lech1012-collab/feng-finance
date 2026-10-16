import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  CheckboxRow,
  DemoChip,
  KeyValueRow,
  ListRow,
  SectionCard,
  SegmentedControl,
  Stepper,
  SwitchRow,
  WarningBox,
} from "./UIPrimitives";
import { Empty, RangeControl } from "./common";

afterEach(cleanup);

it("keeps each time-range control's accessible label and selected value", () => {
  const change = vi.fn();
  render(
    <RangeControl value="6" label="Balance history range" onChange={change} />,
  );
  expect(
    screen.getByRole("group", { name: "Balance history range" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "6 months" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "1 month" }));
  expect(change).toHaveBeenCalledWith(1);
});

it("does not invoke a disabled segment and exposes exactly one pressed option", () => {
  const change = vi.fn();
  render(
    <SegmentedControl
      label="Display"
      value="table"
      options={[
        { value: "table", label: "Table" },
        { value: "bar", label: "Bar", disabled: true },
      ]}
      onChange={change}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Bar" }));
  expect(change).not.toHaveBeenCalled();
  expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
});

it("switches and acknowledgements retain native labels and descriptions", () => {
  const change = vi.fn();
  render(
    <>
      <SwitchRow
        label="Download daily rates (ECB)"
        description="No personal data is sent."
        checked={false}
        onChange={change}
      />
      <CheckboxRow
        label="Replace the current data"
        checked={false}
        onChange={change}
      />
    </>,
  );
  const toggle = screen.getByRole("switch", {
    name: "Download daily rates (ECB)",
  });
  expect(toggle).toHaveAccessibleDescription("No personal data is sent.");
  fireEvent.click(screen.getByText("Download daily rates (ECB)"));
  expect(change).toHaveBeenCalledWith(true);
  expect(
    screen.getByRole("checkbox", { name: "Replace the current data" }),
  ).not.toBeChecked();
});

it("disabled switches cannot change data when their label is clicked", () => {
  const change = vi.fn();
  render(
    <SwitchRow
      label="Download daily rates (ECB)"
      checked={false}
      disabled
      onChange={change}
    />,
  );
  fireEvent.click(screen.getByText("Download daily rates (ECB)"));
  expect(change).not.toHaveBeenCalled();
});

it("keeps demo navigation as a link with an accessible purpose", () => {
  render(
    <MemoryRouter>
      <DemoChip to="/settings?section=demo#demo" />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("link", { name: "Demo data settings" }),
  ).toHaveAttribute("href", "/settings?section=demo#demo");
});

it("uses plain text for rows and keeps an unknown amount distinct from zero", () => {
  render(
    <SectionCard title="Your accounts">
      <ListRow
        title={"<script>Example</script>"}
        meta="No statement yet"
        amount="Not imported"
      />
      <KeyValueRow label="Net worth" value="Unavailable" />
    </SectionCard>,
  );
  expect(screen.getByRole("region", { name: "Your accounts" })).toBeVisible();
  expect(screen.getByText("<script>Example</script>")).toBeVisible();
  expect(document.querySelector("script")).toBeNull();
  expect(screen.getByText("Not imported")).toBeVisible();
  expect(screen.queryByText("£0.00")).not.toBeInTheDocument();
});

it("keeps a category row as a named native navigation link with an unavailable value", () => {
  render(
    <MemoryRouter>
      <ListRow
        to="/categories/groceries"
        title="Groceries"
        amount="Not comparable"
      />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("link", { name: "Groceries Not comparable" }),
  ).toHaveAttribute("href", "/categories/groceries");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByText("£0.00")).not.toBeInTheDocument();
});

it("exposes the current step without making completed steps interactive", () => {
  render(
    <Stepper
      steps={["Pick", "Check", "Review", "Done"]}
      current={2}
      label="Import progress"
    />,
  );
  const list = screen.getByRole("list", { name: "Import progress" });
  expect(list.querySelector('[aria-current="step"]')).toHaveTextContent(
    "Review",
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("keeps empty-state headings and blocking explanations readable and named", () => {
  render(
    <>
      <Empty title="No transactions match this search">
        <button>Clear search</button>
      </Empty>
      <WarningBox
        title="Balances don't add up"
        severity="error"
        actions={<button>Review transactions</button>}
      >
        The difference is £12.40.
      </WarningBox>
    </>,
  );
  expect(
    screen.getByRole("heading", { name: "No transactions match this search" }),
  ).toBeVisible();
  expect(
    screen.getByRole("region", { name: "Balances don't add up" }),
  ).toHaveTextContent("The difference is £12.40.");
  expect(
    screen.getByRole("button", { name: "Review transactions" }),
  ).toBeVisible();
});
