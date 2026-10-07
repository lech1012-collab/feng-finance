import { expect, it } from "vitest";
import { statementMovements } from "./movements";
import { transaction } from "../tests/helpers";
import { cashFlow } from "../analytics/calculations";

it("matches statement money out including a card repayment while analytics exclude it", () => {
  const rows = [90000, -15000, 10000, -3000, -2000, -12300].map(
    (amount, index) =>
      transaction({
        id: String(index),
        amount,
        type: index === 5 ? "transfer" : amount > 0 ? "income" : "expense",
        isTransfer: index === 5,
      }),
  );
  expect(statementMovements(rows, "GBP")).toEqual({
    moneyIn: 100000,
    moneyOut: 32300,
  });
  expect(10000 + 100000 - 32300).toBe(77700);
  expect(cashFlow(rows, "GBP")).toMatchObject({
    income: 100000,
    expenses: 20000,
  });
});
it("includes incoming transfers and all extracted rows but isolates currencies", () => {
  const rows = [
    {
      ...transaction({ amount: 80000, type: "transfer", isTransfer: true }),
      include: false,
    },
    transaction({ amount: -50000, type: "transfer", isTransfer: true }),
    transaction({ amount: 90000, currency: "EUR" }),
  ];
  expect(statementMovements(rows, "GBP")).toEqual({
    moneyIn: 80000,
    moneyOut: 50000,
  });
  expect(cashFlow(rows, "GBP")).toEqual({ income: 0, expenses: 0, net: 0 });
});
it("rejects totals exceeding safe monetary precision", () => {
  expect(() =>
    statementMovements(
      [
        transaction({ amount: Number.MAX_SAFE_INTEGER }),
        transaction({ amount: 1 }),
      ],
      "GBP",
    ),
  ).toThrow("safe precision");
});
