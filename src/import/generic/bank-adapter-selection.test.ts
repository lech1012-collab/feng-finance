import { describe, expect, it } from "vitest";
import { getParser } from "../../parsers";
import { reconstructRows } from "../layout";
import { genericFixture } from "./fixtures";
import { parseGenericStatement } from "./engine";
import { detectProfile } from "./profiles";
import { proveBankAdapter } from "./legacy-comparison";
import type { RowCheck } from "./types";

function readings(id: "T1" | "T4" | "T5GBP" = "T1") {
  const fixture = genericFixture(id);
  const profile = detectProfile(fixture.items)!;
  const legacy = getParser(
    profile.institution,
    reconstructRows(fixture.items),
  ).parse(reconstructRows(fixture.items));
  const generic = parseGenericStatement(fixture.items, fixture.pages, {
    institution: profile.institution,
    profile,
  });
  return { fixture, profile, legacy, generic };
}

describe("independently proved bank-adapter selection", () => {
  it.each(["T1", "T4", "T5GBP"] as const)(
    "prefers a known %s bank layout when all financial source occurrences agree",
    (kind) => {
      const { legacy, generic, profile } = readings(kind);
      const proof = proveBankAdapter(legacy, generic, profile);
      expect(proof?.sourceRows).toHaveLength(legacy.transactions.length);
      expect(new Set(proof?.sourceRows.map((row) => row.rowId)).size).toBe(
        legacy.transactions.length,
      );
    },
  );
  it("permits reference-format differences without weakening signed amount, date or balance coverage", () => {
    const { legacy, generic, profile } = readings();
    legacy.transactions[0].description += " REFERENCE: FICTIONAL PAYROLL";
    expect(proveBankAdapter(legacy, generic, profile)).toBeDefined();
    legacy.transactions[0].amount++;
    legacy.transactions[1].amount--;
    // These offsetting errors keep the closing total unchanged.
    expect(proveBankAdapter(legacy, generic, profile)).toBeUndefined();
  });
  it("compares booking dates in the printed Date column while retaining the card purchase date", () => {
    const { legacy, generic, profile } = readings();
    const transaction = legacy.transactions[1];
    const booked = transaction.date;
    transaction.date = "2026-09-01";
    transaction.bookingDate = booked;
    expect(generic.rowChecks[1].readings[0].date).toBe(booked);
    expect(proveBankAdapter(legacy, generic, profile)).toBeDefined();
    expect(transaction.date).toBe("2026-09-01");
    expect(transaction.bookingDate).toBe(booked);
    transaction.bookingDate = "2026-09-03";
    expect(proveBankAdapter(legacy, generic, profile)).toBeUndefined();
  });
  it("keeps OCR source evidence in generic review even when the adapter has an exact total", () => {
    const { legacy, generic, profile } = readings();
    generic.rowChecks[0].parseSource = "ocr";
    expect(proveBankAdapter(legacy, generic, profile)).toBeUndefined();
  });
  it("uses the independent adapter to resolve only a source-candidate ambiguity whose valid financial reading matches", () => {
    const { legacy, generic, profile } = readings();
    const row = generic.rowChecks[0];
    const exact = { ...row.readings[0] };
    row.readings.unshift({
      ...exact,
      id: "ambiguous-generic-reading",
      amount: -exact.amount!,
    });
    row.selectedReadingId = row.readings[0].id;
    row.issues = ["ambiguous-reading"];
    row.resolved = false;
    row.checkLevel = "review";
    row.difference = undefined;
    generic.checks.reconciledExactly = false;
    expect(proveBankAdapter(legacy, generic, profile)).toBeDefined();
    // Merely passing a total cannot manufacture a missing source reading.
    row.readings = [row.readings[0]];
    expect(proveBankAdapter(legacy, generic, profile)).toBeUndefined();
  });
  it("never overrides an individually proved running-balance reading with a conflicting adapter", () => {
    const { legacy, generic, profile } = readings();
    const row = generic.rowChecks[0];
    row.readings[0].amount! += 1;
    row.readings.push({
      ...row.readings[0],
      id: "other-unproved-reading",
      amount: legacy.transactions[0].amount,
    });
    // The selected source reading is independently proved; another candidate
    // cannot justify selecting an adapter that disagrees with that evidence.
    expect(row.difference).toBe(0);
    expect(row.issues).toEqual([]);
    expect(proveBankAdapter(legacy, generic, profile)).toBeUndefined();
  });
  it("rejects the same net with each printed gross total differing by one penny", () => {
    const { legacy, generic, profile } = readings("T4");
    generic.checks.printedMoneyIn! += 1;
    generic.checks.printedMoneyOut! += 1;
    expect(proveBankAdapter(legacy, generic, profile)).toBeUndefined();
  });
  it("does not hide a malformed source row or an omitted opposite-value pair", () => {
    const { legacy, generic, profile } = readings();
    const malformed: RowCheck = {
      ...generic.rowChecks[0],
      rowId: "real-source-row-needs-correction",
      readings: [{ id: "unreadable", description: "", parseSource: "text" }],
      selectedReadingId: "unreadable",
      issues: ["invalid-date", "invalid-amount", "missing-description"],
      resolved: false,
    };
    generic.rowChecks.push(malformed);
    expect(proveBankAdapter(legacy, generic, profile)).toBeUndefined();
    generic.rowChecks.pop();
    for (const amount of [-5000, 5000])
      generic.rowChecks.push({
        ...generic.rowChecks[0],
        rowId: `additional-${amount}`,
        readings: [
          {
            ...generic.rowChecks[0].readings[0],
            id: `additional-${amount}`,
            amount,
            balanceAfterTransaction: undefined,
          },
        ],
        selectedReadingId: `additional-${amount}`,
        difference: undefined,
        issues: ["missing-balance"],
        resolved: false,
      });
    expect(proveBankAdapter(legacy, generic, profile)).toBeUndefined();
  });
  it("preserves legitimate repeated purchases and cannot reuse one source occurrence twice", () => {
    const { legacy, generic, profile } = readings();
    const purchase = { ...legacy.transactions.at(-1)! };
    purchase.balanceAfterTransaction! -= Math.abs(purchase.amount);
    legacy.transactions.push(purchase);
    legacy.closingBalance = purchase.balanceAfterTransaction;
    const source = generic.rowChecks.at(-1)!;
    generic.rowChecks.push({
      ...source,
      rowId: "second-identical-purchase",
      readings: source.readings.map((reading) => ({
        ...reading,
        balanceAfterTransaction: purchase.balanceAfterTransaction,
      })),
    });
    expect(proveBankAdapter(legacy, generic, profile)?.sourceRows).toHaveLength(
      4,
    );
    generic.rowChecks.pop();
    expect(proveBankAdapter(legacy, generic, profile)).toBeUndefined();
  });
  it.each(["missing", "mismatched", "unknown"] as const)(
    "keeps generic handling for a %s bank profile",
    (kind) => {
      const { legacy, generic, profile } = readings();
      const candidate =
        kind === "missing"
          ? undefined
          : kind === "mismatched"
            ? { ...profile, institution: "Revolut" as const }
            : { ...profile, institution: "Other" as const };
      expect(proveBankAdapter(legacy, generic, candidate)).toBeUndefined();
    },
  );
  it("keeps warnings for unread pages, outside-period dates and incomplete adapter extraction", () => {
    const { legacy, generic, profile } = readings();
    generic.checks.unreadPages = [2];
    expect(proveBankAdapter(legacy, generic, profile)).toBeUndefined();
    generic.checks.unreadPages = [];
    legacy.warnings = ["Page 2: a transaction was not fully extracted."];
    expect(proveBankAdapter(legacy, generic, profile)).toBeUndefined();
    legacy.warnings = [];
    legacy.transactions[0].date = "2026-08-31";
    expect(proveBankAdapter(legacy, generic, profile)).toBeUndefined();
  });
  it("preserves user row decisions and mismatched account identity", () => {
    const { legacy, generic, profile } = readings();
    generic.rowChecks[0].reviewAction = {
      kind: "accept",
      readingId: generic.rowChecks[0].readings[0].id,
    };
    expect(proveBankAdapter(legacy, generic, profile)).toBeUndefined();
    generic.rowChecks[0].reviewAction = undefined;
    generic.parsed!.accountIdentifier = "•••• 9999";
    expect(proveBankAdapter(legacy, generic, profile)).toBeUndefined();
  });
});
