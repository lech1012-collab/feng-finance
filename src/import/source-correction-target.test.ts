import { describe, expect, it } from "vitest";
import { sourceCorrectionRow } from "./source-correction-target";
import { parseGenericStatement } from "./generic";
import { knownBankItems } from "../tests/known-bank-layouts";
const result = () =>
  parseGenericStatement(
    knownBankItems("hsbc").map((item) => ({
      ...item,
      fontSize: item.fontSize ?? item.height,
      parseSource: item.parseSource ?? "text",
    })),
    [{ page: 1, width: 595, height: 842, rotation: 0 }],
  );
const target = {
  date: "2026-09-02",
  sourcePage: 1,
  description: "FICTIONAL GROCER",
  amount: -8000,
};
describe("source correction navigation", () => {
  it("opens only the unique matching source object", () => {
    const source = result();
    const row = source.rowChecks.find((row) =>
      row.readings.some((r) => r.description === target.description),
    )!;
    expect(sourceCorrectionRow(source, target)).toBe(row.rowId);
    expect(
      sourceCorrectionRow(source, { ...target, sourcePage: 2 }),
    ).toBeUndefined();
  });
  it("never guesses between identical purchases", () => {
    const source = result();
    const row = source.rowChecks.find((row) =>
      row.readings.some((r) => r.description === target.description),
    )!;
    source.rowChecks.push({ ...row, rowId: "another-purchase" });
    expect(sourceCorrectionRow(source, target)).toBeUndefined();
  });
  it("can navigate to a unique description and date even when the competing amount differs", () => {
    const source = result();
    const before = structuredClone(source);
    expect(
      sourceCorrectionRow(source, { ...target, amount: -8100 }),
    ).toBeDefined();
    expect(source).toEqual(before);
  });
});
