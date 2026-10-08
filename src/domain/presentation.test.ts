import { expect, it } from "vitest";
import { displayMerchant, displayDateRange, displayDate } from "./presentation";
it("cleans only presentation, preserving raw references for search and rules", () => {
  const t = {
    merchant: "PRIME VIDEO RENT / BUY AMZN.UK/BILL",
    description: "raw source",
  };
  expect(displayMerchant(t)).toBe("Prime Video");
  expect(t.merchant).toBe("PRIME VIDEO RENT / BUY AMZN.UK/BILL");
  expect(
    displayMerchant({
      merchant: "DIRECT DEBIT TO FICTIONAL CLUB REF: 12345678",
      description: "",
    }),
  ).toBe("Fictional Club");
});
it("formats British date ranges without ambiguous ISO text", () => {
  expect(displayDateRange("2026-09-01", "2026-09-30")).toBe("1 to 30 Sep 2026");
  expect(displayDateRange("2026-08-06", "2026-09-05")).toBe(
    "6 Aug to 5 Sep 2026",
  );
  expect(displayDate("2026-09-05")).toContain("Sat 5 Sep");
});
