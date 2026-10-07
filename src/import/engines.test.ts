import { describe, it, expect } from "vitest";
import { categorize, matches } from "../categorization/engine";
import { defaultRules, defaultCategories } from "../storage/database";
import { matchTransfers } from "../transfers/engine";
import { duplicateStatus, statementDuplicate } from "./duplicates";
import { fingerprint } from "../domain/normalize";
import type { Rule, Statement } from "../domain/models";
import { accounts, transaction } from "../tests/helpers";
const rule: Rule = {
  id: "r",
  name: "My rule",
  match: "contains",
  pattern: "JOHN LEWIS",
  direction: "negative",
  categoryId: "shopping",
  priority: 100,
  builtIn: false,
};
describe("categorization order", () => {
  it("uses built-in merchants with amount direction", () => {
    expect(categorize(transaction(), defaultRules).categoryId).toBe(
      "groceries",
    );
    expect(
      categorize(transaction({ amount: 1000 }), defaultRules).categoryId,
    ).toBeUndefined();
  });
  it("applies user rules before built-ins", () =>
    expect(
      categorize(transaction(), [
        { ...rule, pattern: "WAITROSE", categoryId: "shopping" },
        ...defaultRules,
      ]).categoryId,
    ).toBe("shopping"));
  it("prefers user exact rules", () =>
    expect(
      categorize(transaction(), [
        { ...rule, pattern: "WAITROSE" },
        {
          ...rule,
          id: "exact",
          pattern: "WAITROSE",
          match: "exact",
          priority: 1,
          categoryId: "household",
        },
      ]).categoryId,
    ).toBe("household"));
  it("supports account, prefix and amount ranges", () => {
    const r = {
      ...rule,
      match: "starts-with" as const,
      pattern: "WAIT",
      accountId: "a1",
      minAmount: 500,
      maxAmount: 1500,
    };
    expect(matches(r, transaction())).toBe(true);
    expect(matches(r, transaction({ accountId: "a2" }))).toBe(false);
    expect(matches(r, transaction({ amount: -1600 }))).toBe(false);
  });
  it("respects linked transfers and explicit transfer rules", () => {
    expect(
      categorize(transaction({ isTransfer: true }), defaultRules).type,
    ).toBe("transfer");
    expect(
      categorize(transaction(), [
        {
          ...rule,
          pattern: "WAITROSE",
          categoryId: undefined,
          type: "transfer",
        },
      ]).isTransfer,
    ).toBe(true);
  });
  it("uses only consistent reviewed merchant history", () => {
    expect(
      categorize(transaction(), [], [transaction({ categoryId: "shopping" })])
        .categoryId,
    ).toBe("shopping");
    expect(
      categorize(
        transaction(),
        [],
        [
          transaction({ categoryId: "shopping" }),
          transaction({ categoryId: "groceries" }),
        ],
      ).categoryId,
    ).toBeUndefined();
  });
  it("avoids archived categories", () =>
    expect(
      categorize(
        transaction(),
        defaultRules,
        [],
        defaultCategories.map((c) => ({
          ...c,
          archived: c.id === "groceries",
        })),
      ).categoryId,
    ).toBeUndefined());
});
describe("duplicate protection", () => {
  it("detects exact PDFs and regenerated statements", () => {
    expect(
      statementDuplicate("abc", [{ sourceFileHash: "abc" } as Statement]),
    ).toBe(true);
    expect(
      statementDuplicate("different", [{ sourceFileHash: "abc" } as Statement]),
    ).toBe(false);
    expect(duplicateStatus(transaction(), [transaction()], true)).toBe(
      "certain",
    );
  });
  it("flags overlapping transactions as uncertain without balance evidence", () =>
    expect(duplicateStatus(transaction(), [transaction()])).toBe("possible"));
  it("recognizes balanced duplicates", () =>
    expect(
      duplicateStatus(transaction({ balanceAfterTransaction: 100 }), [
        transaction({ balanceAfterTransaction: 100 }),
      ]),
    ).toBe("certain"));
  it("preserves two legitimate same-day purchases with distinct balances", async () => {
    const a = transaction({ balanceAfterTransaction: 1000, occurrence: 0 });
    const b = transaction({
      id: "t2",
      balanceAfterTransaction: 0,
      occurrence: 1,
    });
    a.transactionFingerprint = await fingerprint(a);
    b.transactionFingerprint = await fingerprint(b);
    expect(a.transactionFingerprint).not.toBe(b.transactionFingerprint);
    expect(duplicateStatus(b, [a])).toBe("none");
    expect(duplicateStatus(b, [])).toBe("none");
  });
});
describe("conservative transfer matching", () => {
  const pair = (destination = "a2", date = "2026-09-02") => [
    transaction({
      id: "a",
      description:
        destination === "a3" ? "AMEX CARD PAYMENT" : "TRANSFER TO REVOLUT",
      amount: -200000,
    }),
    transaction({
      id: "b",
      accountId: destination,
      date,
      description: "BARCLAYS PAYMENT RECEIVED",
      amount: 200000,
      type: "income",
    }),
  ];
  it.each([
    ["Barclays to Revolut", "a2", "2026-09-01"],
    ["Barclays to Amex", "a3", "2026-09-01"],
    ["one-day mismatch", "a2", "2026-09-02"],
    ["weekend settlement", "a2", "2026-09-04"],
  ])("%s", (_n, account, date) =>
    expect(matchTransfers(pair(account, date), accounts)).toHaveLength(1),
  );
  it("does not match unrelated same-value transactions", () =>
    expect(
      matchTransfers(
        [
          transaction({ id: "a", amount: -1000, description: "SHOP" }),
          transaction({
            id: "b",
            accountId: "a2",
            amount: 1000,
            description: "SALARY",
          }),
        ],
        accounts,
      ),
    ).toHaveLength(0));
  it("does not match partial or ambiguous payments", () => {
    const p = pair("a3");
    expect(
      matchTransfers([p[0], { ...p[1], amount: 150000 }], accounts),
    ).toHaveLength(0);
    expect(matchTransfers([...p, { ...p[1], id: "c" }], accounts)).toHaveLength(
      0,
    );
  });
  it("requires the same currency and different accounts", () => {
    const p = pair();
    expect(
      matchTransfers([p[0], { ...p[1], currency: "EUR" }], accounts),
    ).toHaveLength(0);
    expect(
      matchTransfers([p[0], { ...p[1], accountId: "a1" }], accounts),
    ).toHaveLength(0);
  });
  it("links explicit Barclaycard bank payments with card repayments, never refunds or ambiguous matches", () => {
    const card = { ...accounts[2], institution: "Barclays" as const };
    const ownAccounts = [accounts[0], card];
    const debit = transaction({
      id: "bank",
      amount: -90000,
      description: "Direct Debit to Barclaycard",
    });
    const payment = transaction({
      id: "card",
      accountId: card.id,
      amount: 90000,
      date: "2026-09-04",
      description: "Direct Debit - Payment",
      type: "transfer",
    });
    expect(matchTransfers([debit, payment], ownAccounts)).toHaveLength(1);
    for (const patch of [
      { description: "MERCHANT REFUND" },
      { amount: 80000 },
      { date: "2026-09-10" },
      { currency: "EUR" },
    ]) {
      expect(
        matchTransfers([debit, { ...payment, ...patch }], ownAccounts),
      ).toHaveLength(0);
    }
    expect(
      matchTransfers(
        [{ ...debit, description: "BARCLAYCARD FEES" }, payment],
        ownAccounts,
      ),
    ).toHaveLength(0);
    expect(
      matchTransfers(
        [debit, payment, { ...payment, id: "another" }],
        ownAccounts,
      ),
    ).toHaveLength(0);
  });
});
