import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ImportPeriod } from "./ImportPeriod";
afterEach(cleanup);
it("retains complete year-bearing endpoints across a year boundary", () => {
  const { container } = render(
    <ImportPeriod start="2025-12-20" end="2026-01-19" />,
  );
  expect(
    [...container.querySelectorAll("time")].map((node) => node.textContent),
  ).toEqual(["20 Dec 2025", "19 Jan 2026"]);
  expect(
    [...container.querySelectorAll("time")].map((node) => node.dateTime),
  ).toEqual(["2025-12-20", "2026-01-19"]);
});
