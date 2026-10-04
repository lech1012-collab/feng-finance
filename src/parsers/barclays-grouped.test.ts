import { describe, it, expect } from "vitest";
import { groupedBarclaysItems } from "../tests/barclays-grouped";
import { reconstructRows } from "../import/layout";
import { BarclaysStatementParser } from "./barclays";
const parser = new BarclaysStatementParser();
const rows = () => reconstructRows(groupedBarclaysItems());
describe("Barclays grouped dates", () => {
  it("retains every blank-date transaction, wrapped amount and page continuation", () => {
    const p = parser.parse(rows());
    expect(p.transactions.map((t) => [t.date, t.amount])).toEqual([
      ["2026-09-03", -1000],
      ["2026-09-03", 20000],
      ["2026-09-03", -3000],
      ["2026-09-03", -4000],
      ["2026-09-03", -2000],
      ["2026-09-04", -5000],
    ]);
    expect(p.transactions[0].description).toBe(
      "CARD PAYMENT TO FICTIONAL MUSIC MONTHLY PLAN",
    );
    expect(p.transactions[2].description).toBe(
      "DIRECT DEBIT TO EXAMPLE CLUB REF: TEST-CLUB",
    );
    expect(p.transactions[4].description).toBe(
      "DIRECT DEBIT TO EXAMPLE WATER COMPANY",
    );
    expect(p.transactions[3].sourcePage).toBe(2);
    expect(p.transactions.at(-1)?.balanceAfterTransaction).toBe(105000);
    expect(p.warnings).toEqual([]);
    expect(parser.validate(p).status).toBe("reconciled");
  });
  it("warns about orphan blank-date rows instead of inventing a date", () => {
    const r = rows().filter((r) => !(r.page === 1 && [200, 214].includes(r.y)));
    const p = parser.parse(r);
    expect(p.transactions).toHaveLength(1);
    expect(p.warnings.some((w) => w.includes("unrecognized"))).toBe(true);
  });
  it("catches missing credit and debit even if their net effect cancels", () => {
    const r = rows();
    for (const label of ["Money in", "Money out"]) {
      const row = r.find((r) => r.items[0].text === label)!;
      row.items.at(-1)!.text = label === "Money in" ? "250.00" : "200.00";
      row.text = row.items.map((i) => i.text).join(" ");
    }
    const p = parser.parse(r);
    expect(parser.validate(p).status).toBe("reconciled");
    expect(
      p.warnings.filter((w) => w.includes("printed summary")),
    ).toHaveLength(2);
  });
  it("warns when a missing amount precedes another transaction on the same date", () => {
    const items = groupedBarclaysItems().filter(
      (i) => !(i.page === 1 && i.y === 200 && i.x === 320),
    );
    const p = parser.parse(reconstructRows(items));
    expect(p.transactions[0].description).toBe(
      "RECEIVED FROM EXAMPLE EMPLOYER",
    );
    expect(p.transactions[0].amount).toBe(20000);
    expect(p.warnings.some((w) => w.includes("no readable amount"))).toBe(true);
  });
  it("does not inherit past an invalid explicit date", () => {
    const items = groupedBarclaysItems();
    items.find((i) => i.text === "03 Sep")!.text = "99 Sep";
    const p = parser.parse(reconstructRows(items));
    expect(p.transactions).toHaveLength(1);
    expect(
      p.warnings.some((w) => w.includes("unsupported transaction date")),
    ).toBe(true);
  });
});
