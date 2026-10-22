import { describe, expect, it } from "vitest";
import { annualCardFixture } from "../tests/barclaycard-annual";
import { sidebarCardFixture } from "../tests/barclaycard-sidebar";
import { reconstructRows } from "../import/layout";
import { identifyBarclaycardAnnualSummary } from "./barclaycard-annual";

describe("Barclaycard annual document recognition", () => {
  it("recognises a summary and reads its printed period independently of the issue date and adjacent totals", () => {
    const { items } = annualCardFixture();
    expect(identifyBarclaycardAnnualSummary(reconstructRows(items))).toEqual({
      kind: "annual-summary",
      institution: "Barclays",
      period: { start: "2025-09-01", end: "2026-08-31" },
      statementDate: "2026-09-04",
      totals: {
        currency: "GBP",
        transactions: 321045,
        interest: 455,
        fees: 2340,
        payments: 300000,
      },
    });
  });
  it("reads a range wrapped within the summary column", () => {
    const { items } = annualCardFixture();
    const period = items.find(
      (item) => item.text === "1 Sep 2025 to 31 Aug 2026",
    )!;
    period.text = "1 Sep 2025 to";
    items.push({ ...period, y: period.y + 12, text: "31 Aug 2026" });
    expect(
      identifyBarclaycardAnnualSummary(reconstructRows(items))?.period,
    ).toEqual({ start: "2025-09-01", end: "2026-08-31" });
  });
  it("does not substitute the issue date or interest-rate dates when the annual period is absent", () => {
    const fixture = annualCardFixture();
    const summary = identifyBarclaycardAnnualSummary(
      reconstructRows(
        fixture.items.filter((item) => !item.text.includes(" to 31 Aug")),
      ),
    );
    expect(summary?.kind).toBe("annual-summary");
    expect(summary?.period).toBeUndefined();
    expect(summary?.statementDate).toBe("2026-09-04");
  });
  it("keeps ambiguous printed periods unavailable rather than choosing one", () => {
    const { items } = annualCardFixture();
    const period = items.find((item) => item.text.includes(" to 31 Aug"))!;
    items.push({
      ...period,
      y: period.y + 12,
      text: "1 Aug 2025 to 31 Jul 2026",
    });
    expect(
      identifyBarclaycardAnnualSummary(reconstructRows(items))?.period,
    ).toBeUndefined();
  });
  it("does not select a total when its printed label has competing amounts", () => {
    const { items } = annualCardFixture();
    const amount = items.find((item) => item.text === "£3,210.45")!;
    items.push({ ...amount, x: 285, text: "£3.00" });
    const summary = identifyBarclaycardAnnualSummary(reconstructRows(items));
    expect(summary?.totals?.transactions).toBeUndefined();
    expect(summary?.totals?.payments).toBe(300000);
  });
  it("does not classify a monthly statement from an incidental annual-summary mention", () => {
    const { items } = sidebarCardFixture();
    items.push({
      ...items[0],
      page: 3,
      text: "Your annual statement is available online.",
    });
    expect(
      identifyBarclaycardAnnualSummary(reconstructRows(items)),
    ).toBeUndefined();
  });
  it("keeps a document with a real transaction ledger on the transaction-reading route", () => {
    const annual = annualCardFixture();
    const ledger = sidebarCardFixture()
      .items.filter((item) => item.page === 2)
      .map((item) => ({ ...item, page: 3 }));
    expect(
      identifyBarclaycardAnnualSummary(
        reconstructRows([...annual.items, ...ledger]),
      ),
    ).toBeUndefined();
  });
  it.each(["Date Transactions Amount", "Sep 01 2026 FICTIONAL PURCHASE"])(
    "does not exclude annual documents with a detailed ledger signal: %s",
    (text) => {
      const { items } = annualCardFixture();
      const template = items[0];
      items.push({ ...template, page: 3, y: 100, text });
      if (text.startsWith("Sep"))
        items.push({ ...template, page: 3, y: 100, x: 400, text: "£12.00 CR" });
      expect(
        identifyBarclaycardAnnualSummary(reconstructRows(items)),
      ).toBeUndefined();
    },
  );
});
