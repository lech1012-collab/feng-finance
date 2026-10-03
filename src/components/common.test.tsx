import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { MonthPicker, Metric } from "./common";
afterEach(cleanup);
it("navigates months with labeled controls", () => {
  const change = vi.fn();
  render(<MonthPicker month="2026-01" onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
  expect(change).toHaveBeenCalledWith("2025-12");
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  expect(change).toHaveBeenCalledWith("2026-02");
});
it("renders currency values as text rather than markup", () => {
  render(<Metric label="Income" value={500000} currency="GBP" />);
  expect(screen.getByText("£5,000.00")).toBeVisible();
  expect(screen.getByText("Income")).toBeVisible();
});
