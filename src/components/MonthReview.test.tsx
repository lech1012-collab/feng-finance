import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Pot } from "../domain/models";
import { accounts } from "../tests/helpers";
import { MonthReview } from "./MonthReview";
const fixture = vi.hoisted(() => ({
  value: undefined as unknown,
  confirm: vi.fn().mockResolvedValue({ changeId: "synthetic-change" }),
}));
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => fixture.value }));
vi.mock("./SuggestedRules", () => ({ SuggestedRules: () => null }));
vi.mock("../storage/planning-v2", () => ({
  confirmPotContribution: fixture.confirm,
}));
const pot: Pot = {
  id: "jpy-goal",
  type: "goal",
  name: "Japan trip",
  targetMinor: 60000,
  currency: "JPY",
  targetDate: "2027-03-15",
  createdAt: "2026-10-01T00:00:00Z",
  contributions: [],
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
  fixture.confirm.mockClear();
  fixture.value = {
    rows: [],
    accounts: [
      {
        ...accounts[0],
        id: "euro-saving",
        displayName: "Euro savings",
        currency: "EUR",
        accountType: "savings",
        tracking: "manual",
      },
    ],
    statements: [],
    categories: [],
    settings: [],
    rates: [],
    proposals: [],
    pots: [
      pot,
      {
        ...pot,
        id: "linked",
        name: "Euro goal",
        currency: "EUR",
        linkedAccountId: "euro-saving",
      },
    ],
    valuations: [
      {
        id: "value",
        accountId: "euro-saving",
        date: "2026-10-02",
        valueMinor: 50000,
      },
    ],
    closed: undefined,
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("shows foreign pots, parses a contribution in its native precision and keeps linked saving automatic", async () => {
  render(
    <MemoryRouter>
      <MonthReview month="2026-10" currency="GBP" />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "3. Pots and goals" }));
  fireEvent.click(
    screen.getByRole("button", { name: /Japan trip.*Contribute/ }),
  );
  const input = screen.getByLabelText("Japan trip contribution (JPY)");
  expect(input).toHaveValue("10000");
  expect(screen.getByText(/Automatic from Euro savings/)).toBeInTheDocument();
  expect(
    screen.queryByLabelText(/Euro goal contribution/),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Confirm contribution" }),
  ).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "700" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm contribution" }));
  await waitFor(() =>
    expect(fixture.confirm).toHaveBeenCalledWith("jpy-goal", "2026-10", 700),
  );
});
