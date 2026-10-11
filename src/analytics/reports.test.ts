import { describe, expect, it } from "vitest";
import {
  reportRows,
  transactionsCsv,
  ukTaxYear,
  propertyTaxSummary,
} from "./reports";
import { transaction, accounts } from "../tests/helpers";
import type { SavedReport } from "../domain/models";
const report: Pick<SavedReport, "groupBy" | "measure" | "conditions"> = {
  groupBy: "category",
  measure: "sum",
  conditions: [],
};

describe("traceable financial reports", () => {
  it("groups September 26 into October for a month beginning on the 25th", () => {
    const settings = [
      {
        key: "period:start",
        value: JSON.stringify({ mode: "fixed", day: 25 }),
      },
    ];
    const rows = reportRows(
      [transaction({ date: "2026-09-26" })],
      { ...report, groupBy: "month" },
      "GBP",
      [],
      [],
      [],
      { settings },
    );
    expect(rows[0].key).toBe("2026-10");
    expect(rows[0].label).toBe("October 2026");
  });
  it("counts split children once and adjusts refunds in original month", () => {
    const parent = transaction({
      id: "parent",
      date: "2026-08-01",
      amount: -6000,
      kind: "split_parent",
    });
    const a = transaction({
      id: "a",
      parentId: parent.id,
      date: parent.date,
      amount: -4500,
      categoryId: "groceries",
      source: "split",
    });
    const b = transaction({
      id: "b",
      parentId: parent.id,
      date: parent.date,
      amount: -1500,
      categoryId: "household",
      source: "split",
    });
    const refund = transaction({
      id: "refund",
      date: "2026-09-01",
      amount: 2000,
      kind: "refund",
      refundAllocations: [{ transactionId: parent.id, amount: 2000 }],
    });
    const rows = reportRows([parent, a, b, refund], report, "GBP");
    expect(rows.map((r) => [r.key, r.sum])).toEqual([
      ["groceries", -3000],
      ["household", -1000],
    ]);
    expect(
      reportRows(
        [parent, a, b, refund],
        {
          ...report,
          conditions: [
            {
              field: "date",
              operator: "between",
              value: "2026-09-01",
              valueTo: "2026-09-30",
            },
          ],
        },
        "GBP",
      ),
    ).toEqual([]);
  });
  it("omits transfers, computes count/average and groups tags", () => {
    const rows = [
      transaction({
        id: "a",
        categoryId: "groceries",
        amount: -100,
        tags: ["trip"],
      }),
      transaction({
        id: "b",
        categoryId: "groceries",
        amount: -200,
        tags: ["trip", "work"],
      }),
      transaction({
        id: "c",
        amount: -10000,
        type: "transfer",
        isTransfer: true,
      }),
    ];
    expect(
      reportRows(rows, { ...report, measure: "average" }, "GBP")[0],
    ).toMatchObject({ count: 2, value: -150 });
    expect(
      reportRows(
        rows,
        { ...report, groupBy: "tag", measure: "count" },
        "GBP",
      ).map((r) => [r.key, r.value]),
    ).toEqual([
      ["trip", 2],
      ["work", 1],
    ]);
  });
  it("UK 2025/26 is inclusive 6 Apr to 5 Apr", () => {
    expect(ukTaxYear(2025)).toEqual({
      from: "2025-04-06",
      to: "2026-04-05",
      label: "2025/26",
    });
    const rows = [
      transaction({
        id: "before",
        date: "2025-04-05",
        amount: 1000,
        categoryId: "property-income",
      }),
      transaction({
        id: "start",
        date: "2025-04-06",
        amount: 1000,
        categoryId: "property-income",
      }),
      transaction({
        id: "end",
        date: "2026-04-05",
        amount: -200,
        categoryId: "property",
      }),
      transaction({
        id: "after",
        date: "2026-04-06",
        amount: -200,
        categoryId: "property",
      }),
    ];
    expect(propertyTaxSummary(rows, 2025, ["property"], "GBP")).toMatchObject({
      income: 1000,
      expenses: 200,
      net: 800,
    });
  });
  it("CSV keeps ledger source amounts, child lines, notes, tags and formula safety", () => {
    const rows = [
      transaction({ id: "p", kind: "split_parent", amount: -6000 }),
      transaction({
        id: "a",
        parentId: "p",
        amount: -4500,
        description: '=HYPERLINK("bad")',
        tags: ["trip"],
        note: "Travel\nnotes",
      }),
      transaction({ id: "b", parentId: "p", amount: -1500, currency: "JPY" }),
    ];
    const csv = transactionsCsv(
      rows,
      accounts,
      [],
      [{ id: "trip", name: "Lisbon trip", colour: "#000000", archived: false }],
    );
    expect(csv).toContain('"-45.00"');
    expect(csv).toContain('"-1500"');
    expect(csv).toContain('"Lisbon trip"');
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toContain('"-60.00"');
    expect(csv).toContain('"Travel\nnotes"');
  });
});
