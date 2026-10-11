import { expect, it } from "vitest";
import type { FxRate, Statement } from "../domain/models";
import { accounts, transaction } from "../tests/helpers";
import { projectedReportingTransactions } from "./fx";
import { reportingMonthlySeries } from "./reporting";

it("preserves exact totals across 20,000 transactions and a full rate history", () => {
  const dates: string[] = [];
  const cursor = new Date("2026-09-30T12:00:00Z");
  while (dates.length < 1020) {
    if (![0, 6].includes(cursor.getUTCDay()))
      dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  const codes = [
    "GBP",
    "USD",
    "AUD",
    "CAD",
    "CHF",
    "CNY",
    "CZK",
    "DKK",
    "HKD",
    "HUF",
    "IDR",
    "ILS",
    "INR",
    "ISK",
    "JPY",
    "KRW",
    "MXN",
    "MYR",
    "NOK",
    "NZD",
    "PHP",
    "PLN",
    "RON",
    "SEK",
    "SGD",
    "THB",
    "TRY",
    "ZAR",
    "BRL",
    "BGN",
    "RUB",
    "HRK",
    "LTL",
    "LVL",
    "EEK",
    "CYP",
    "MTL",
    "SKK",
    "SIT",
    "ROL",
  ];
  const rates: FxRate[] = dates.flatMap((date) =>
    codes.map((quote) => ({
      id: `${quote}:${date}`,
      date,
      base: "EUR",
      quote,
      rate: quote === "GBP" ? "0.85" : "1.2",
      source: "ecb",
    })),
  );
  const ledger = Array.from({ length: 20000 }, (_, i) =>
    transaction({
      id: `large:${i}`,
      date: dates[i % dates.length],
      accountId: i % 2 ? "a1" : "a2",
      currency: i % 2 ? "GBP" : "EUR",
      amount: i % 10 === 0 ? 10000 : -1000,
      statementId: `${i % 2 ? "a1" : "a2"}:${dates[i % dates.length].slice(0, 7)}`,
      categoryId: i % 10 === 0 ? "salary" : "groceries",
    }),
  );
  const nativeAccounts = [
    { ...accounts[0] },
    { ...accounts[1], currency: "EUR" },
  ];
  const documents: Statement[] = [];
  const months = [...new Set(ledger.map((t) => t.date.slice(0, 7)))];
  for (const account of nativeAccounts)
    for (const month of months) {
      const rows = ledger.filter(
        (t) => t.accountId === account.id && t.date.startsWith(month),
      );
      const end = new Date(
        Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
      )
        .toISOString()
        .slice(0, 10);
      documents.push({
        id: `${account.id}:${month}`,
        accountId: account.id,
        institution: account.institution,
        currency: account.currency,
        statementPeriodStart: `${month}-01`,
        statementPeriodEnd: end,
        openingBalance: 1000000,
        closingBalance: 1000000 + rows.reduce((sum, t) => sum + t.amount, 0),
        transactionCount: rows.length,
        validationStatus: "reconciled",
        sourceFilename: "Fictitious performance fixture",
        sourceFileHash: `${account.id}:${month}`,
        importedAt: "2026-10-08T12:00:00Z",
        parserVersion: "synthetic",
        extractionMethod: "embedded-text",
        warnings: [],
      });
    }
  const started = performance.now();
  const projected = projectedReportingTransactions(ledger, "GBP", rates);
  const conversionMs = performance.now() - started;
  expect(projected.missing).toHaveLength(0);
  expect(projected.transactions).toHaveLength(20000);
  expect(projected.transactions.reduce((sum, t) => sum + t.amount, 0)).toBe(
    ledger.reduce(
      (sum, t) =>
        sum + (t.currency === "EUR" ? (t.amount * 85) / 100 : t.amount),
      0,
    ),
  );
  const monthlyStart = performance.now();
  const series = reportingMonthlySeries(
    ledger,
    nativeAccounts,
    documents,
    "2026-09",
    12,
    "GBP",
    rates,
    [],
    [],
    "2026-10-08",
  );
  const monthlyMs = performance.now() - monthlyStart;
  expect(series).toHaveLength(12);
  for (const point of series) {
    const expected = ledger.filter((t) => t.date.startsWith(point.month));
    expect(point.coverage.complete).toBe(true);
    expect(point.net).toBe(
      expected.reduce(
        (sum, t) =>
          sum + (t.currency === "EUR" ? (t.amount * 85) / 100 : t.amount),
        0,
      ),
    );
  }
  console.info(
    `Synthetic desktop benchmark: 20,000 rows / ${rates.length} rates; first conversion ${conversionMs.toFixed(1)} ms; 12-month verified aggregation ${monthlyMs.toFixed(1)} ms.`,
  );
  if (process.env.FENG_BENCHMARK === "1") {
    const cachedStart = performance.now();
    for (let run = 0; run < 5; run++)
      projectedReportingTransactions(ledger, "GBP", rates);
    process.stdout.write(
      `Synthetic desktop benchmark: ${ledger.length} rows, ${rates.length} rates; first conversion ${conversionMs.toFixed(1)} ms; cached conversion ${((performance.now() - cachedStart) / 5).toFixed(1)} ms; verified 12-month aggregation ${monthlyMs.toFixed(1)} ms.\n`,
    );
  }
  // This check guards catastrophic regression; the iPhone latency target is a
  // separately documented device measurement, not a claim from desktop CI.
  expect(conversionMs + monthlyMs).toBeLessThan(5000);
}, 20000);
