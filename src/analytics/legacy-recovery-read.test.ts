import { describe, expect, it } from "vitest";
import type { Transaction } from "../domain/models";
import { transaction } from "../tests/helpers";
import { readCsv } from "../import/formats";
import { reportRows, transactionsCsv } from "./reports";
import { effectiveTransactions } from "./effective-transactions";

function legacyTransaction(patch: Partial<Transaction> = {}): Transaction {
  const row = transaction(patch);
  for (const key of ["tags", "occurrence", "isReviewed"])
    Reflect.deleteProperty(row, key);
  return Object.freeze(row);
}

describe("nonpersisting reporting of exact legacy recovery records", () => {
  it("groups absent tags as untagged and exports legacy defaults without changing the source", () => {
    const row = legacyTransaction({ amount: -12345 });
    const source = structuredClone(row);
    expect(
      reportRows(
        [row],
        { groupBy: "tag", measure: "sum", conditions: [] },
        "GBP",
      ),
    ).toMatchObject([{ key: "untagged", sum: -12345, count: 1 }]);
    const exported = readCsv(transactionsCsv([row]));
    const field = (name: string) =>
      exported.rows[0][exported.headers.indexOf(name)];
    expect(field("Amount")).toBe("-123.45");
    expect(field("Tags")).toBe("");
    expect(field("Tag IDs")).toBe("");
    expect(field("Reviewed")).toBe("false");
    expect(field("Occurrence")).toBe("0");
    expect(row).toEqual(source);
    expect(Object.hasOwn(row, "tags")).toBe(false);
    expect(Object.hasOwn(row, "occurrence")).toBe(false);
    expect(Object.hasOwn(row, "isReviewed")).toBe(false);
  });

  it("uses default occurrence zero for deterministic refund pennies without adding it to raw rows", () => {
    const parent = transaction({
      id: "parent",
      kind: "split_parent",
      amount: -2,
    });
    // Deliberately put the legacy zero-occurrence line after a modern second line.
    const second = transaction({
      id: "second",
      parentId: parent.id,
      amount: -1,
      occurrence: 1,
    });
    const first = legacyTransaction({
      id: "first",
      parentId: parent.id,
      amount: -1,
    });
    const refund = transaction({
      id: "refund",
      amount: 1,
      kind: "refund",
      refundAllocations: [{ transactionId: parent.id, amount: 1 }],
    });
    const source = structuredClone(first);
    const projected = effectiveTransactions([parent, second, first, refund]);
    expect(projected.find((row) => row.id === "first")?.amount).toBe(0);
    expect(projected.find((row) => row.id === "second")?.amount).toBe(-1);
    expect(first).toEqual(source);
    expect(Object.hasOwn(first, "occurrence")).toBe(false);
  });
});
