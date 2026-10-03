import { describe, it, expect } from "vitest";
import { BarclaysStatementParser } from "./barclays";
import { AmexStatementParser } from "./amex";
import { rows, bankRows } from "../tests/helpers";
import { validatePeriod } from "./period";

describe("statement period detection", () => {
  const parser = new BarclaysStatementParser();
  it.each([
    [
      "Statement period: 01 Sep 2026 to 30 Sep 2026",
      "2026-09-01",
      "2026-09-30",
    ],
    [
      "Your statement 1 September – 30 September 2026",
      "2026-09-01",
      "2026-09-30",
    ],
    [
      "Your Barclays Bank Account statement 1 Sep - 30 Sep 2026",
      "2026-09-01",
      "2026-09-30",
    ],
    ["1 September 2026 - 30 September 2026", "2026-09-01", "2026-09-30"],
    ["From 01/09/2026 to 30/09/2026", "2026-09-01", "2026-09-30"],
    ["1 — 30 September 2026", "2026-09-01", "2026-09-30"],
    ["28 December – 27 January 2026", "2025-12-28", "2026-01-27"],
    ["Statement dates: 2026-09-01 to 2026-09-30", "2026-09-01", "2026-09-30"],
    [
      "1\u00a0September 2026 – 30\u00a0September 2026",
      "2026-09-01",
      "2026-09-30",
    ],
  ])("supports %s", (heading, start, end) => {
    expect(parser.identifyStatementPeriod(rows([[[30, heading]]]))).toEqual({
      start,
      end,
    });
  });
  it("reconstructs headings split over adjacent PDF rows", () => {
    expect(
      parser.identifyStatementPeriod(
        rows([
          [[30, "Your statement"]],
          [[30, "1 September 2026 to"]],
          [[30, "30 September 2026"]],
        ]),
      ),
    ).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(
      new AmexStatementParser().identifyStatementPeriod(
        rows([
          [[30, "Statement period:"]],
          [[30, "1 September 2026 to 30 September 2026"]],
        ]),
      ),
    ).toEqual({ start: "2026-09-01", end: "2026-09-30" });
  });
  it("rejects conflicting intervals rather than choosing one", () => {
    expect(() =>
      parser.identifyStatementPeriod(
        rows([
          [[30, "1 Sep 2026 to 30 Sep 2026"]],
          [[30, "1 Aug 2026 to 31 Aug 2026"]],
        ]),
      ),
    ).toThrow("More than one statement period");
  });
  it.each([
    "Statement date: 30 September 2026",
    "Your statement 1 September to 30 September",
    "Interest period from 1 September 2026 to 30 September 2026",
    "Statement period: 1 Sep 2026 to 30 Sep 20261",
    "Statement period: 1 Feb 2026 to 31 Feb 2026",
    "Statement period: 30 Sep 2026 to 1 Sep 2026",
  ])("does not guess an interval for %s", (heading) => {
    expect(() =>
      parser.identifyStatementPeriod(rows([[[30, heading]]])),
    ).toThrow();
  });
  it("ignores date intervals within transaction descriptions", () => {
    const input = bankRows().filter(
      (r) => !r.text.includes("Statement period"),
    );
    input.push(...rows([[[140, "1 Sep 2026 to 30 Sep 2026"]]]));
    expect(() => parser.identifyStatementPeriod(input)).toThrow(
      "Statement dates",
    );
  });
  it("permits explicit user dates without bypassing reconciliation or source review", () => {
    const input = bankRows().filter(
      (r) => !r.text.includes("Statement period"),
    );
    const parsed = parser.parse(input, {
      start: "2026-09-01",
      end: "2026-09-30",
    });
    expect(parsed.transactions).toHaveLength(4);
    expect(parser.validate(parsed).status).toBe("reconciled");
    expect(parsed.warnings).toContain(
      "Statement dates were entered manually. Check both dates against the source PDF before importing.",
    );
  });
  it.each([
    { start: "", end: "2026-09-30" },
    { start: "2026-09-01", end: "" },
    { start: "2026-09-31", end: "2026-10-01" },
    { start: "2026-10-01", end: "2026-09-30" },
  ])("validates manual dates before parsing", (period) =>
    expect(() => validatePeriod(period)).toThrow(),
  );
});
