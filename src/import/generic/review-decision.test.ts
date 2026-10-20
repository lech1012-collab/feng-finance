import { describe, expect, it } from "vitest";
import { parseGenericStatement } from "./engine";
import { fieldCorrections, rowReviewDecision } from "./review-decision";
import { largeCardFixture } from "../../tests/large-card";
import { knownBankItems } from "../../tests/known-bank-layouts";
import { reconstructRows } from "../layout";
import { getParser } from "../../parsers";
import { recoverNativeAmounts } from "./native-recovery";

describe("field exceptions stay separate from mathematical proof", () => {
  it.each(["exact", "difference"] as const)(
    "133 readable rows have zero editing tasks: %s",
    (mode) => {
      const f = largeCardFixture(mode);
      const result = parseGenericStatement(f.items, f.pages);
      expect(result.rowChecks).toHaveLength(133);
      expect(fieldCorrections(result.rowChecks)).toHaveLength(0);
      expect(result.checks.reconciledExactly).toBe(mode === "exact");
      if (mode === "difference") {
        expect(result.checks.reconciliation).toMatchObject({
          status: "warning",
          difference: 1,
        });
        expect(result.rowChecks.filter((row) => !row.resolved)).toHaveLength(
          133,
        );
      }
    },
  );
  it.each(["amount", "date"] as const)(
    "one unread %s asks only for that field",
    (mode) => {
      const f = largeCardFixture(mode);
      const result = parseGenericStatement(f.items, f.pages);
      const rows = fieldCorrections(result.rowChecks);
      expect(result.rowChecks).toHaveLength(133);
      expect(rows).toHaveLength(1);
      expect(rowReviewDecision(rows[0]).fields).toEqual([mode]);
      expect(result.checks.reconciledExactly).toBe(false);
      const corrected = parseGenericStatement(f.items, f.pages, {
        actions: {
          [rows[0].rowId]: {
            kind: "correct",
            date: "2026-09-13",
            description: "FICTIONAL PURCHASE 72",
            amount: -100,
          },
        },
      });
      expect(fieldCorrections(corrected.rowChecks)).toHaveLength(0);
      expect(corrected.checks.reconciledExactly).toBe(true);
      expect(corrected.parsed!.transactions).toHaveLength(133);
    },
  );
});

describe("right-aligned card money and markers", () => {
  it.each(["e", "c", "m"])(
    "keeps £8.50 readable when marker %s moves inside the old global amount band",
    (marker) => {
      const items = knownBankItems("barclaycard").map((item) => ({
        ...item,
        fontSize: 8,
        parseSource: "text" as const,
      }));
      for (const item of items) {
        if (item.text === "£80.00") item.text = "£8.50";
        if (item.text === "£109.68") item.text = "£38.18";
        if (item.page === 2 && item.y === 136 && item.x === 250) item.x = 235;
        if (item.text === "e") item.text = marker;
      }
      const result = parseGenericStatement(
        items,
        [1, 2].map((page) => ({ page, width: 600, height: 842, rotation: 0 })),
      );
      const purchase = result.rowChecks.find(
        (row) => row.readings[0].description === "WAITROSE",
      )!;
      expect(purchase.readings[0]).toMatchObject({
        amount: -850,
        rawAmount: "£8.50",
      });
      expect(fieldCorrections(result.rowChecks)).toHaveLength(0);
      expect(result.checks.reconciledExactly).toBe(true);
      expect(result.parsed!.transactions).toHaveLength(6);
    },
  );
  it("only corroborates one-to-one unread amounts, never a conflicting value or repeated purchase", () => {
    const items = knownBankItems("barclaycard").map((item) => ({
      ...item,
      fontSize: 8,
      parseSource: "text" as const,
    }));
    const native = getParser("Barclays", reconstructRows(items)).parse(
      reconstructRows(items),
    );
    const pages = [1, 2].map((page) => ({
      page,
      width: 600,
      height: 842,
      rotation: 0,
    }));
    const result = parseGenericStatement(items, pages);
    const purchase = result.rowChecks.find(
      (row) => row.readings[0].description === "WAITROSE",
    )!;
    expect(recoverNativeAmounts(result, native)).toEqual({});
    purchase.readings.forEach((r) => {
      r.amount = undefined;
    });
    expect(recoverNativeAmounts(result, native)).toEqual({
      [purchase.rowId]: -8000,
    });
    expect(
      recoverNativeAmounts(result, { ...native, currency: "EUR" }),
    ).toEqual({});
    expect(
      recoverNativeAmounts(result, { ...native, accountIdentifier: "9999" }),
    ).toEqual({});
    expect(
      recoverNativeAmounts(result, { ...native, periodEnd: "2026-10-01" }),
    ).toEqual({});
    const otherPage = {
      ...native,
      transactions: native.transactions.map((t) => ({
        ...t,
        sourcePage: t.sourcePage + 1,
      })),
    };
    expect(recoverNativeAmounts(result, otherPage)).toEqual({});
    purchase.readings[0].amount = -8001;
    expect(recoverNativeAmounts(result, native)).toEqual({});
    purchase.readings[0].amount = undefined;
    result.rowChecks.push({ ...purchase, rowId: "second-source-occurrence" });
    expect(recoverNativeAmounts(result, native)).toEqual({});
  });
});
