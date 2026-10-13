import { describe, expect, it } from "vitest";
import { getParser } from "../parsers";
import {
  knownBankItems,
  type KnownBankLayout,
} from "../tests/known-bank-layouts";
import { reconstructRows } from "./layout";
import { prepareBankAdapterReading } from "./bank-adapter-proof";

function reading(layout: KnownBankLayout = "revolut") {
  const rows = reconstructRows(knownBankItems(layout));
  const institution =
    layout === "amex"
      ? "American Express"
      : layout === "revolut"
        ? "Revolut"
        : "Barclays";
  const parsed = getParser(institution, rows).parse(rows);
  return { rows, parsed, result: prepareBankAdapterReading(parsed, rows) };
}

describe("independent supported-bank financial proof", () => {
  it.each(["barclays-current", "barclaycard", "amex", "revolut"] as const)(
    "validates %s directly without a generic layout/profile or candidate reading",
    (layout) => {
      const { parsed, result } = reading(layout);
      expect(result.bankSource.reconciledExactly).toBe(true);
      expect(result.parsed.bankProfileId).toBe(layout);
      expect(result.parsed.rowsNeedingReview).toBe(0);
      expect(result.parsed.transactions).toHaveLength(
        parsed.transactions.length,
      );
      expect(result.parsed.transactions.map((row) => row.amount)).toEqual(
        parsed.transactions.map((row) => row.amount),
      );
      expect(result.parsed.validationPolicy).toBe("exact-v2.2");
      expect(result.bankSource.parsed).not.toBe(result.parsed);
      expect(result.bankSource.parsed.transactions[0]).not.toBe(
        result.parsed.transactions[0],
      );
    },
  );
  it("uses independently printed Amex credits and debits rather than net reconciliation alone", () => {
    const { result } = reading("amex");
    expect(result.bankSource).toMatchObject({
      printedMoneyIn: 121000,
      printedMoneyOut: 17000,
      reconciledExactly: true,
    });
  });
  it("uses independently printed Revolut money in and money out including transfers", () => {
    const { result } = reading();
    expect(result.bankSource).toMatchObject({
      printedMoneyIn: 95000,
      printedMoneyOut: 51000,
      reconciledExactly: true,
    });
    expect(result.parsed.warnings).toEqual([]);
    expect(
      result.parsed.transactions.some((row) => row.type === "transfer"),
    ).toBe(true);
  });
  it("preserves repeated identical purchases as separate source occurrences", () => {
    const { result } = reading();
    const purchases = result.parsed.transactions.filter(
      (row) => row.amount === -2500,
    );
    expect(purchases).toHaveLength(2);
    expect(new Set(purchases.map((row) => row.parseRowId)).size).toBe(2);
    expect(purchases.map((row) => row.sourcePage)).toEqual([2, 3]);
  });
  it("does not falsely verify offsetting credit/debit mistakes", () => {
    const { rows, parsed } = reading();
    parsed.transactions[0].amount++;
    parsed.transactions[1].amount--;
    const { bankSource, parsed: checked } = prepareBankAdapterReading(
      parsed,
      rows,
    );
    expect(bankSource.reconciledExactly).toBe(false);
    expect(checked.warnings.join(" ")).toMatch(
      /running balance|printed summary/i,
    );
  });
  it("checks each running anchor when redistribution leaves both gross totals and net unchanged", () => {
    const { rows, parsed } = reading();
    parsed.transactions[2].amount += 100;
    parsed.transactions[3].amount -= 100;
    const { bankSource } = prepareBankAdapterReading(parsed, rows);
    expect(bankSource.reconciledExactly).toBe(false);
    expect(bankSource.sourceCoverageIssues.join(" ")).toContain(
      "running balance",
    );
  });
  it("detects omitted offsetting source occurrences even without printed gross totals", () => {
    const { rows, parsed } = reading("barclaycard");
    const additions = reconstructRows([
      ...knownBankItems("barclaycard"),
      ...[
        [-5000, "12 Sep", "FICTIONAL PURCHASE", "£50.00"],
        [5000, "13 Sep", "FICTIONAL REFUND", "£50.00 CR"],
      ].flatMap(([_amount, date, description, amount], index) =>
        [
          [52, String(date)],
          [85, String(description)],
          [260, String(amount)],
        ].map(([x, text]) => ({
          page: 2,
          y: 245 + index * 15,
          x: Number(x),
          text: String(text),
          width: 40,
          height: 8,
        })),
      ),
    ]);
    expect(
      parsed.openingBalance! +
        parsed.transactions.reduce((sum, row) => sum + row.amount, 0),
    ).toBe(parsed.closingBalance);
    const { bankSource } = prepareBankAdapterReading(parsed, additions);
    expect(bankSource.reconciledExactly).toBe(false);
    expect(bankSource.sourceCoverageIssues.join(" ")).toContain(
      "printed transaction rows",
    );
    expect(rows.length).toBeGreaterThan(0);
  });
  it("counts a card purchase beside the other panel's balance summary", () => {
    const { rows, parsed } = reading("barclaycard");
    const combined = rows.map((row) => ({
      ...row,
      items: row.items.map((item) => ({ ...item })),
    }));
    const purchase = combined.find((row) => row.page === 2 && row.y === 195)!;
    purchase.items.push(
      {
        page: 2,
        y: 195,
        x: 330,
        text: "Your new balance",
        width: 90,
        height: 8,
      },
      { page: 2, y: 195, x: 540, text: "£109.68", width: 40, height: 8 },
    );
    purchase.text = purchase.items.map((item) => item.text).join(" ");
    expect(
      prepareBankAdapterReading(parsed, combined).bankSource.reconciledExactly,
    ).toBe(true);
  });
  it("keeps counting the other card panel when one panel reaches its footer", () => {
    const { rows, parsed } = reading("barclaycard");
    const footer = {
      page: 2,
      y: 68,
      items: [
        { page: 2, y: 68, x: 52, text: "Ways to pay", width: 70, height: 8 },
      ],
      text: "Ways to pay",
    };
    expect(
      prepareBankAdapterReading(parsed, [...rows, footer]).bankSource
        .reconciledExactly,
    ).toBe(true);
  });
  it("does not treat foreign-currency references as an extra card transaction", () => {
    const { rows, parsed } = reading("barclaycard");
    const foreign = {
      ...rows.find((row) =>
        row.items.some((item) => item.text.includes("Euro at exchange")),
      )!,
    };
    foreign.y = 260;
    foreign.items = [
      {
        page: 2,
        y: 260,
        x: 365,
        text: "20 Euro at exchange rate 2.00",
        width: 120,
        height: 8,
      },
    ];
    foreign.text = foreign.items[0].text;
    const result = prepareBankAdapterReading(parsed, [...rows, foreign]);
    expect(result.bankSource.reconciledExactly).toBe(true);
  });
  it("cannot skip a printed running-balance anchor even when opening and closing still reconcile", () => {
    const { rows, parsed } = reading();
    delete parsed.transactions[0].balanceAfterTransaction;
    const result = prepareBankAdapterReading(parsed, rows);
    expect(result.bankSource.reconciledExactly).toBe(false);
    expect(result.bankSource.sourceCoverageIssues.join(" ")).toContain(
      "running balances were not read",
    );
  });
  it("keeps malformed dates visible as source-coverage review", () => {
    const { rows, parsed } = reading();
    const modified = rows.map((row) => ({
      ...row,
      items: row.items.map((item) => ({ ...item })),
    }));
    const extra = {
      ...modified.find((row) => row.page === 3 && row.y === 180)!,
    };
    extra.y = 220;
    extra.items = extra.items.map((item) => ({
      ...item,
      y: 220,
      text: item.x === 43 ? "32 Sept 2026" : item.text,
    }));
    extra.text = extra.items.map((item) => item.text).join(" ");
    modified.push(extra);
    const { bankSource } = prepareBankAdapterReading(parsed, modified);
    expect(bankSource.reconciledExactly).toBe(false);
    expect(bankSource.sourceCoverageIssues.join(" ")).toContain(
      "printed transaction rows",
    );
  });
  it.each([
    "currency",
    "date",
    "amount",
    "outside-period",
    "low-confidence",
  ] as const)(
    "retains the bank route but requires review for invalid %s evidence",
    (field) => {
      const { rows, parsed } = reading();
      if (field === "currency") parsed.transactions[0].currency = "EUR";
      else if (field === "date") parsed.transactions[0].date = "2026-09-32";
      else if (field === "amount") parsed.transactions[0].amount = 1.5;
      else if (field === "outside-period")
        parsed.transactions[0].date = "2026-08-31";
      else parsed.transactions[0].extractionConfidence = 0.6;
      const result = prepareBankAdapterReading(parsed, rows);
      expect(result.bankSource.reconciledExactly).toBe(false);
      expect(result.parsed.bankProfileId).toBe("revolut");
      expect(result.parsed.rowsNeedingReview).toBeGreaterThan(0);
    },
  );
  it("does not treat a one-penny gross mismatch as exact evidence", () => {
    const { rows, parsed } = reading("amex");
    const summary = rows.find((row) => row.page === 1 && row.y === 218)!;
    summary.items.find((item) => item.x === 185)!.text = "£1,210.01";
    summary.items.find((item) => item.x === 281)!.text = "£170.01";
    const { bankSource } = prepareBankAdapterReading(parsed, rows);
    expect(bankSource.reconciledExactly).toBe(false);
    expect(bankSource.sourceCoverageIssues.join(" ")).toContain(
      "printed summary",
    );
  });
  it("keeps genuine adapter warnings and unread-page evidence", () => {
    const { rows, parsed } = reading();
    parsed.warnings.push("Page 3: a transaction was not fully extracted.");
    const result = prepareBankAdapterReading(parsed, rows, {
      unreadPages: [4],
    });
    expect(result.parsed.warnings).toContain(
      "Page 3: a transaction was not fully extracted.",
    );
    expect(result.parsed.unreadPages).toEqual([4]);
    expect(result.bankSource.reconciledExactly).toBe(false);
  });
  it("cannot manufacture unavailable opening or closing balances", () => {
    const { rows, parsed } = reading();
    delete parsed.openingBalance;
    delete parsed.closingBalance;
    const result = prepareBankAdapterReading(parsed, rows);
    expect(result.parsed.openingBalance).toBeUndefined();
    expect(result.parsed.closingBalance).toBeUndefined();
    expect(result.bankSource.reconciledExactly).toBe(false);
  });
  it("preserves card coverage notices without requiring generic amount review", () => {
    const { rows, parsed } = reading("barclaycard");
    parsed.periodSource = "transaction-coverage";
    parsed.warnings.push(
      "This statement prints an issue date but no period start. Check coverage against the PDF.",
    );
    const result = prepareBankAdapterReading(parsed, rows);
    expect(result.parsed.warnings).toHaveLength(1);
    expect(result.parsed.rowsNeedingReview).toBe(0);
    expect(result.bankSource.reconciledExactly).toBe(true);
  });
  it("detaches the financial snapshot from editable categorization rows", () => {
    const { result } = reading();
    const original = result.bankSource.parsed.transactions[0].amount;
    result.parsed.transactions[0].amount++;
    result.parsed.openingBalance!++;
    expect(result.bankSource.parsed.transactions[0].amount).toBe(original);
    expect(result.bankSource.parsed.openingBalance).toBe(50000);
  });

  it("keeps explicit manual-period provenance for acknowledgement without discarding exact financial proof", () => {
    const { rows, parsed } = reading();
    const notice =
      "Statement dates were entered manually. Check both dates against the source PDF before importing.";
    const result = prepareBankAdapterReading(
      { ...parsed, periodSource: "manual", warnings: [notice] },
      rows,
    );
    expect(result.bankSource.reconciledExactly).toBe(true);
    expect(result.parsed.periodSource).toBe("manual");
    expect(result.parsed.warnings).toEqual([notice]);
  });
});
