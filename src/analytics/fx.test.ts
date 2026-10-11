import { describe, it, expect, vi } from "vitest";
import {
  convertMinor,
  downloadEcbRates,
  workingDayAge,
  projectedReportingTransactions,
  RATE_URL,
} from "./fx";
import { transaction } from "../tests/helpers";
import type { FxRate } from "../domain/models";
const rates: FxRate[] = [
  {
    id: "gbp",
    date: "2026-09-04",
    base: "EUR",
    quote: "GBP",
    rate: "0.8571",
    source: "ecb",
  },
  {
    id: "usd",
    date: "2026-09-04",
    base: "EUR",
    quote: "USD",
    rate: "1.1723",
    source: "ecb",
  },
];
describe("private exact currency conversion", () => {
  it("uses the previous actual working day for Sunday 6 September 2026", () =>
    expect(
      convertMinor(12000, "EUR", "GBP", "2026-09-06", rates),
    ).toMatchObject({ amount: 10285, date: "2026-09-04" }));
  it("crosses through EUR and preserves signs", () =>
    expect(convertMinor(-8571, "GBP", "USD", "2026-09-06", rates)?.amount).toBe(
      -11723,
    ));
  it("finds the latest common quoted date without using a future or mismatched cross rate", () => {
    const history: FxRate[] = [
      ...rates,
      {
        id: "new-gbp",
        date: "2026-09-07",
        base: "EUR",
        quote: "GBP",
        rate: "0.9",
        source: "ecb",
      },
      {
        id: "new-usd",
        date: "2026-09-08",
        base: "EUR",
        quote: "USD",
        rate: "1.2",
        source: "ecb",
      },
    ];
    expect(
      convertMinor(8571, "GBP", "USD", "2026-09-08", history),
    ).toMatchObject({ amount: 11723, date: "2026-09-04" });
    expect(
      convertMinor(10000, "EUR", "GBP", "2026-09-06", history),
    ).toMatchObject({ amount: 8571, date: "2026-09-04" });
    expect(
      convertMinor(10000, "EUR", "GBP", "2026-09-07", history),
    ).toMatchObject({ amount: 9000, date: "2026-09-07" });
    expect(
      convertMinor(10000, "EUR", "GBP", "2026-09-01", history),
    ).toBeUndefined();
  });
  it("keeps originals untouched and reports missing conversions explicitly", () => {
    const source = transaction({
      currency: "EUR",
      amount: -12000,
      date: "2026-09-06",
    });
    const projected = projectedReportingTransactions([source], "GBP", rates);
    expect(source.amount).toBe(-12000);
    expect(source.currency).toBe("EUR");
    expect(projected.transactions[0].amount).toBe(-10285);
    expect(projectedReportingTransactions([source], "GBP", []).missing).toEqual(
      [source],
    );
  });
  it("handles minor-unit precision and manual dated overrides", () => {
    expect(
      convertMinor(100, "JPY", "GBP", "2026-09-06", [
        {
          id: "manual",
          date: "2026-09-01",
          base: "JPY",
          quote: "GBP",
          rate: "0.005",
          source: "manual",
        },
      ])?.amount,
    ).toBe(50);
  });
  it("counts weekends without treating them as working days", () =>
    expect(workingDayAge("2026-09-04", "2026-09-08")).toBe(2));
  it("requests only the fixed public table, without cookies, body or identifiers", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        "TIME_PERIOD,CURRENCY,CURRENCY_DENOM,OBS_VALUE\n2026-09-04,GBP,EUR,0.8571",
    });
    expect((await downloadEcbRates(fetcher))[0].rate).toBe("0.8571");
    expect(fetcher).toHaveBeenCalledWith(RATE_URL, {
      method: "GET",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      headers: { Accept: "text/csv" },
    });
  });
});
