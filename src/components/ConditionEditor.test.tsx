import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { RuleCondition } from "../domain/models";
import { ConditionEditor } from "./ConditionEditor";

afterEach(cleanup);

function Harness({ initial }: { initial: RuleCondition[] }) {
  const [conditions, setConditions] = useState(initial);
  return (
    <>
      <ConditionEditor conditions={conditions} onChange={setConditions} />
      <output aria-label="Stored conditions">
        {JSON.stringify(conditions)}
      </output>
    </>
  );
}

it("uses UK date entry for both range boundaries and clears an invalid boundary", () => {
  render(
    <Harness
      initial={[
        {
          field: "date",
          operator: "between",
          value: "2026-09-01",
          valueTo: "2026-09-30",
        },
      ]}
    />,
  );
  const start = screen.getByRole("textbox", {
    name: "Condition 1 value",
  });
  const end = screen.getByRole("textbox", {
    name: "Condition 1 range end",
  });
  expect(start).toHaveValue("01/09/2026");
  expect(end).toHaveValue("30/09/2026");
  fireEvent.change(start, { target: { value: "09012026" } });
  expect(start).toHaveValue("09/01/2026");
  expect(screen.getByLabelText("Stored conditions")).toHaveTextContent(
    '"value":"2026-01-09"',
  );
  fireEvent.change(end, { target: { value: "31/04/2026" } });
  expect(end).toBeInvalid();
  expect(screen.getByLabelText("Stored conditions")).toHaveTextContent(
    '"valueTo":""',
  );
});

it("keeps the advanced text-pattern operator and value unchanged by its readable label", () => {
  render(
    <Harness
      initial={[
        { field: "description", operator: "regex", value: "^SYNTHETIC.*$" },
      ]}
    />,
  );
  expect(
    screen.getByRole("combobox", { name: "Condition 1 comparison" }),
  ).toHaveValue("regex");
  expect(
    screen.getByText("Advanced: enter a regular expression to match text."),
  ).toBeVisible();
  expect(screen.getByLabelText("Stored conditions")).toHaveTextContent(
    '"value":"^SYNTHETIC.*$"',
  );
});
