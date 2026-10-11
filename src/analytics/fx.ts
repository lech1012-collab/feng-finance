import type { FxRate, Transaction } from "../domain/models";
import { currencyPrecision } from "../domain/money";

export const RATE_HOST = "https://data-api.ecb.europa.eu";
// Fixed public table request: never includes an account, merchant, balance or transaction date.
export const RATE_URL = `${RATE_HOST}/service/data/EXR/D..EUR.SP00.A?lastNObservations=1020&format=csvdata`;
type Fraction = { n: bigint; d: bigint };
function fraction(value: string): Fraction {
  if (!/^\d+(?:\.\d{1,12})?$/.test(value))
    throw new Error("Invalid exchange rate.");
  const [whole, decimal = ""] = value.split(".");
  const n = BigInt(whole + decimal),
    d = 10n ** BigInt(decimal.length);
  if (n <= 0n) throw new Error("Exchange rates must be positive.");
  return { n, d };
}
function fixed(value: Fraction) {
  const scale = 100000000n;
  const n = (value.n * scale + value.d / 2n) / value.d;
  return `${n / scale}.${(n % scale).toString().padStart(8, "0")}`;
}
function round(n: bigint, d: bigint) {
  const sign = n < 0n ? -1n : 1n;
  return Number(sign * ((n * sign + d / 2n) / d));
}
type ResolvedRate = { rate: Fraction; asOf: string; source: "ecb" | "manual" };
type RateIndex = {
  direct: Map<string, FxRate[]>;
  quotes: Map<string, FxRate[]>;
  crosses: Map<string, ResolvedRate[]>;
  resolved: Map<string, ResolvedRate | undefined>;
};
const rateIndexes = new WeakMap<FxRate[], RateIndex>();
function rateIndex(rates: FxRate[]): RateIndex {
  const cached = rateIndexes.get(rates);
  if (cached) return cached;
  const index: RateIndex = {
    direct: new Map(),
    quotes: new Map(),
    crosses: new Map(),
    resolved: new Map(),
  };
  const quotesByDate = new Map<string, Map<string, FxRate>>();
  for (const row of rates) {
    if (row.source === "manual") {
      const pair = `${row.base}:${row.quote}`;
      const entries = index.direct.get(pair) ?? [];
      entries.push(row);
      index.direct.set(pair, entries);
    }
    if (row.base === "EUR") {
      const entries = quotesByDate.get(row.quote) ?? new Map<string, FxRate>();
      const existing = entries.get(row.date);
      if (!existing || row.source === "manual" || existing.source !== "manual")
        entries.set(row.date, row);
      quotesByDate.set(row.quote, entries);
    }
  }
  for (const [code, entries] of quotesByDate)
    index.quotes.set(
      code,
      [...entries.values()].sort((a, b) => a.date.localeCompare(b.date)),
    );
  for (const entries of index.direct.values())
    entries.sort((a, b) => a.date.localeCompare(b.date));
  rateIndexes.set(rates, index);
  return index;
}
function previous<T>(
  entries: T[],
  date: string,
  getDate: (entry: T) => string,
): T | undefined {
  let low = 0,
    high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (getDate(entries[middle]) <= date) low = middle + 1;
    else high = middle;
  }
  return entries[low - 1];
}
function resolveRate(
  from: string,
  to: string,
  date: string,
  rates: FxRate[],
): ResolvedRate | undefined {
  const index = rateIndex(rates);
  const pair = `${from}:${to}`,
    key = `${pair}:${date}`;
  if (index.resolved.has(key)) return index.resolved.get(key);
  const direct = previous(index.direct.get(pair) ?? [], date, (r) => r.date);
  if (direct) {
    const value: ResolvedRate = {
      rate: fraction(direct.rate),
      asOf: direct.date,
      source: "manual",
    };
    index.resolved.set(key, value);
    return value;
  }
  let entries = index.crosses.get(pair);
  if (!entries) {
    entries = [];
    const a = index.quotes.get(from) ?? [],
      b = index.quotes.get(to) ?? [];
    const add = (left: FxRate | undefined, right: FxRate | undefined) => {
      const x = left ? fraction(left.rate) : { n: 1n, d: 1n };
      const y = right ? fraction(right.rate) : { n: 1n, d: 1n };
      entries!.push({
        rate: { n: y.n * x.d, d: y.d * x.n },
        asOf: (left ?? right)!.date,
        source:
          left?.source === "manual" || right?.source === "manual"
            ? "manual"
            : "ecb",
      });
    };
    if (from === "EUR") for (const row of b) add(undefined, row);
    else if (to === "EUR") for (const row of a) add(row, undefined);
    else {
      let left = 0,
        right = 0;
      while (left < a.length && right < b.length) {
        if (a[left].date === b[right].date) add(a[left++], b[right++]);
        else if (a[left].date < b[right].date) left++;
        else right++;
      }
    }
    index.crosses.set(pair, entries);
  }
  const value = previous(entries, date, (r) => r.asOf);
  index.resolved.set(key, value);
  return value;
}
export interface Conversion {
  amount: number;
  rate: string;
  date: string;
  source: "ecb" | "manual";
}
export function convertMinor(
  amount: number,
  from: string,
  to: string,
  date: string,
  rates: FxRate[],
): Conversion | undefined {
  if (!Number.isSafeInteger(amount))
    throw new Error("Money must use safe integer minor units.");
  if (from === to) return { amount, rate: "1", date, source: "ecb" };
  const cached = resolveRate(from, to, date, rates);
  if (cached) {
    const amountInTarget = round(
      BigInt(amount) * cached.rate.n * 10n ** BigInt(currencyPrecision(to)),
      cached.rate.d * 10n ** BigInt(currencyPrecision(from)),
    );
    if (!Number.isSafeInteger(amountInTarget))
      throw new Error("Converted amount exceeds safe precision.");
    return {
      amount: amountInTarget,
      rate: fixed(cached.rate),
      date: cached.asOf,
      source: cached.source,
    };
  }
  return undefined;
}
export interface ReportingTransaction extends Transaction {
  originalAmount?: number;
  originalCurrency?: string;
  conversion?: Conversion;
}
/** Display projection only. Reconciliation and account detail must use the untouched ledger. */
export function projectedReportingTransactions(
  rows: Transaction[],
  currency: string,
  rates: FxRate[],
) {
  const missing: Transaction[] = [];
  const transactions: ReportingTransaction[] = [];
  for (const row of rows) {
    const converted = convertMinor(
      row.amount,
      row.currency,
      currency,
      row.date,
      rates,
    );
    if (!converted) {
      missing.push(row);
      continue;
    }
    transactions.push(
      row.currency === currency
        ? { ...row }
        : {
            ...row,
            amount: converted.amount,
            currency,
            originalAmount: row.amount,
            originalCurrency: row.currency,
            conversion: converted,
          },
    );
  }
  return {
    transactions,
    missing,
    converted: transactions.some((t) => !!t.conversion),
  };
}
export function workingDayAge(from: string, to: string) {
  let days = 0;
  for (
    let cursor = new Date(`${from}T12:00:00Z`);
    cursor.toISOString().slice(0, 10) < to;
  ) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (![0, 6].includes(cursor.getUTCDay())) days++;
  }
  return days;
}
export function parseEcbCsv(text: string): FxRate[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  const headers = lines.shift()?.split(",") ?? [];
  const column = (name: string) => headers.indexOf(name);
  const indexes = [
    "TIME_PERIOD",
    "CURRENCY",
    "CURRENCY_DENOM",
    "OBS_VALUE",
  ].map(column);
  if (indexes.some((i) => i < 0))
    throw new Error("The ECB rate table format was not recognised.");
  const result: FxRate[] = [];
  for (const line of lines) {
    // These four ECB columns occur before any free-text/quoted comma fields.
    const parts = line.split(",");
    const [date, quote, base, rate] = indexes.map((i) => parts[i]);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ||
      !/^[A-Z]{3}$/.test(quote ?? "") ||
      base !== "EUR"
    )
      continue;
    try {
      fraction(rate);
    } catch {
      continue;
    }
    result.push({
      id: `ecb:${date}:EUR:${quote}`,
      date,
      base,
      quote,
      rate,
      source: "ecb",
    });
  }
  if (!result.length)
    throw new Error("The ECB rate table contained no usable rates.");
  return result;
}
export async function downloadEcbRates(
  fetcher: typeof fetch = fetch,
): Promise<FxRate[]> {
  const response = await fetcher(RATE_URL, {
    method: "GET",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "error",
    headers: { Accept: "text/csv" },
  });
  if (!response.ok)
    throw new Error(
      "Exchange rates could not be downloaded. Cached rates remain available.",
    );
  return parseEcbCsv(await response.text());
}
