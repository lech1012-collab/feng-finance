import { describe, expect, it } from "vitest";
import { transaction } from "../tests/helpers";
import { duplicateStatus } from "./duplicates";

describe("cross-format duplicate evidence", () => {
  it("reviews a shortened CSV card description against its multiline PDF counterpart", () => {
    const old = transaction({
      source: "pdf",
      description: "JOHN LEWIS LONDON STORE",
      transactionFingerprint: "pdf",
      amount: -4550,
    });
    const incoming = transaction({
      source: "csv",
      description: "JOHN LEWIS",
      transactionFingerprint: "csv",
      amount: -4550,
    });
    expect(duplicateStatus(incoming, [old])).toBe("possible");
  });
  it("uses an explicit booking date across formats without guessing adjacent days", () => {
    const old = transaction({
      source: "pdf",
      date: "2026-09-01",
      bookingDate: "2026-09-02",
      description: "JOHN LEWIS LONDON",
      transactionFingerprint: "pdf",
    });
    const incoming = transaction({
      source: "ofx",
      date: "2026-09-02",
      description: "JOHN LEWIS",
      transactionFingerprint: "ofx",
    });
    expect(duplicateStatus(incoming, [old])).toBe("possible");
    expect(duplicateStatus({ ...incoming, date: "2026-09-03" }, [old])).toBe(
      "none",
    );
  });
  it("does not suppress the second legitimate matching purchase because a shortened description was seen once", () => {
    const old = transaction({
      source: "pdf",
      description: "JOHN LEWIS LONDON",
      transactionFingerprint: "pdf",
    });
    const incoming = transaction({
      source: "csv",
      description: "JOHN LEWIS",
      transactionFingerprint: "csv",
      occurrence: 1,
    });
    expect(duplicateStatus(incoming, [old])).toBe("none");
  });
  it("does not merge equal amounts at distinct merchants or currencies", () => {
    const old = transaction({
      source: "pdf",
      description: "JOHN LEWIS LONDON",
      transactionFingerprint: "pdf",
    });
    expect(
      duplicateStatus(
        transaction({
          source: "csv",
          description: "MARKS AND SPENCER",
          transactionFingerprint: "csv",
        }),
        [old],
      ),
    ).toBe("none");
    expect(
      duplicateStatus(
        transaction({
          source: "csv",
          description: "JOHN LEWIS",
          currency: "EUR",
          transactionFingerprint: "csv",
        }),
        [old],
      ),
    ).toBe("none");
  });
  it("uses the matching native balance as strong cross-format evidence", () => {
    const old = transaction({
      source: "pdf",
      description: "CARD PURCHASE JOHN LEWIS",
      balanceAfterTransaction: 15000,
      transactionFingerprint: "pdf",
    });
    const incoming = transaction({
      source: "csv",
      description: "JOHN LEWIS",
      balanceAfterTransaction: 15000,
      transactionFingerprint: "csv",
    });
    expect(duplicateStatus(incoming, [old])).toBe("certain");
  });
  it("also reviews a balanced PDF imported after a shortened CSV without balances", () => {
    const old = transaction({
      source: "csv",
      description: "JOHN LEWIS",
      transactionFingerprint: "csv-first",
      amount: -4550,
    });
    const incoming = transaction({
      source: "pdf",
      description: "CARD PURCHASE JOHN LEWIS LONDON STORE",
      transactionFingerprint: "pdf-later",
      amount: -4550,
      balanceAfterTransaction: 15000,
    });
    expect(duplicateStatus(incoming, [old])).toBe("possible");
    expect(duplicateStatus({ ...incoming, occurrence: 1 }, [old])).toBe("none");
  });
  it("preserves an additional identical purchase when an intervening credit restored the same balance", () => {
    const old = transaction({
      source: "csv",
      description: "JOHN LEWIS",
      transactionFingerprint: "first-balanced-purchase",
      balanceAfterTransaction: 15000,
    });
    const incoming = transaction({
      source: "pdf",
      description: "JOHN LEWIS LONDON STORE",
      transactionFingerprint: "second-balanced-purchase",
      occurrence: 1,
      balanceAfterTransaction: 15000,
    });
    expect(duplicateStatus(incoming, [old])).toBe("none");
    expect(
      duplicateStatus(
        { ...incoming, source: "csv", description: "JOHN LEWIS" },
        [old],
      ),
    ).toBe("none");
    expect(duplicateStatus({ ...incoming, occurrence: 0 }, [old])).toBe(
      "certain",
    );
  });
  it("treats a bank-amended FITID amount as uncertain instead of silently throwing away the correction", () => {
    const old = transaction({
      source: "ofx",
      sourceId: "bank-record",
      amount: -1000,
      transactionFingerprint: "old",
    });
    const incoming = transaction({
      source: "ofx",
      sourceId: "bank-record",
      amount: -1100,
      transactionFingerprint: "new",
    });
    expect(duplicateStatus(incoming, [old])).toBe("possible");
  });
});
