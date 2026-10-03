import { expect, it } from "vitest";
import { statementIsCurrent } from "./calculations";
it("flags early-month snapshots and accepts month-end or later coverage", () => {
  expect(statementIsCurrent("2026-09-05", "2026-09", "2026-10-03")).toBe(false);
  expect(statementIsCurrent("2026-09-30", "2026-09", "2026-10-03")).toBe(true);
  expect(statementIsCurrent("2026-10-02", "2026-09", "2026-10-03")).toBe(true);
  expect(statementIsCurrent("2026-10-03", "2026-10", "2026-10-03")).toBe(true);
  expect(statementIsCurrent(undefined, "2026-09", "2026-10-03")).toBe(false);
});
