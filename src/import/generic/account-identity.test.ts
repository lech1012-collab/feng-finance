import { describe, expect, it } from "vitest";
import { knownBankItems } from "../../tests/known-bank-layouts";
import { parseGenericStatement } from "./engine";

const account = {
  accountType: "current" as const,
  currency: "GBP",
  maskedAccountIdentifier: "•••• 3333",
};
const pages = [{ page: 1, width: 595, height: 842, rotation: 0 }];
function items(competing = true) {
  const source = knownBankItems("hsbc").map((item) => ({
    ...item,
    fontSize: 8,
    parseSource: "text" as const,
  }));
  if (competing)
    source.push({
      ...source[0],
      x: 48,
      y: 740,
      text: "Payment instructions: account number 87654321",
    });
  return source;
}

describe("explicit account choices during source review", () => {
  it("does not guess between competing identifiers without a bank identity or user choice", () => {
    const result = parseGenericStatement(items(), pages);
    expect(result.status).toBe("identity-required");
    expect(result.errorCode).toBe("missing-account");
    expect(result.parsed?.accountIdentifier).toBeUndefined();
  });
  it("uses the chosen printed identifier and keeps independent financial checks", () => {
    const result = parseGenericStatement(items(), pages, { account });
    expect(result.status).toBe("parsed");
    expect(result.parsed?.accountIdentifier).toBe("•••• 3333");
    expect(result.parsed?.transactions).toHaveLength(2);
    expect(result.checks.reconciledExactly).toBe(true);
  });
  it("never resolves ambiguity with an account absent from the PDF", () => {
    const result = parseGenericStatement(items(), pages, {
      account: { ...account, maskedAccountIdentifier: "•••• 9999" },
    });
    expect(result.status).toBe("identity-required");
    expect(result.parsed?.accountIdentifier).toBeUndefined();
  });
  it("does not replace a unique printed identifier with a conflicting choice", () => {
    const result = parseGenericStatement(items(false), pages, {
      account: { ...account, maskedAccountIdentifier: "•••• 9999" },
    });
    expect(result.parsed?.accountIdentifier).toBe("•••• 3333");
  });
  it("does not treat an account choice as proof of an incorrect amount", () => {
    const source = items();
    source.find((item) => item.y === 260 && item.x === 320)!.text = "£81.00";
    const result = parseGenericStatement(source, pages, { account });
    expect(result.status).not.toBe("identity-required");
    expect(result.checks.reconciledExactly).toBe(false);
    expect(result.rowChecks.some((row) => !row.resolved)).toBe(true);
  });
});
