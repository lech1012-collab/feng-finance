const precision: Record<string, number> = {
  GBP: 2,
  EUR: 2,
  USD: 2,
  CHF: 2,
  AUD: 2,
  CAD: 2,
  NZD: 2,
  HKD: 2,
  SGD: 2,
  JPY: 0,
  KWD: 3,
};
export function currencyPrecision(currency: string) {
  const p = precision[currency];
  if (p === undefined)
    throw new Error(
      `Unsupported currency: ${currency}. Select a supported statement currency.`,
    );
  return p;
}
export function parseMoney(raw: string, currency = "GBP"): number {
  const p = currencyPrecision(currency);
  const source = raw.trim();
  const negative = /^-|^\(|\bDR\s*$/i.test(source);
  const credit = /\bCR\s*$/i.test(source);
  const clean = source
    .replace(/(?:GBP|EUR|USD|CHF|AUD|CAD|NZD|HKD|SGD|JPY|KWD|CR|DR)/gi, "")
    .replace(/[£€$¥\s()]/g, "")
    .replace(/^[+-]/, "");
  // Accept grouped English amounts; reject ambiguous decimal/localized formats.
  if (
    !new RegExp(
      `^(?:\\d+|\\d{1,3}(?:,\\d{3})+)(?:\\.\\d{1,${Math.max(p, 1)}})?$`,
    ).test(clean)
  )
    throw new Error(`Invalid amount format: ${raw}`);
  const [whole, fraction = ""] = clean.replaceAll(",", "").split(".");
  if (fraction.length > p) throw new Error("Amount has unsupported precision.");
  const value = Number(whole) * 10 ** p + Number(fraction.padEnd(p, "0"));
  if (!Number.isSafeInteger(value))
    throw new Error("Amount exceeds safe storage limit.");
  return negative && !credit ? -value : value;
}
export function decimalMoney(minor: number, currency = "GBP") {
  const p = currencyPrecision(currency);
  const value = BigInt(Math.abs(minor));
  const factor = BigInt(10 ** p);
  return `${minor < 0 ? "-" : ""}${value / factor}${p ? "." + String(value % factor).padStart(p, "0") : ""}`;
}
export function money(minor: number, currency = "GBP", signed = false) {
  const p = currencyPrecision(currency);
  const value = BigInt(minor);
  const factor = BigInt(10 ** p);
  const whole = value / factor;
  const fraction = String((value < 0n ? -value : value) % factor).padStart(
    p,
    "0",
  );
  const formatter = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: p,
    maximumFractionDigits: p,
    signDisplay: signed && minor !== 0 ? "always" : "auto",
  });
  return formatter
    .formatToParts(whole === 0n && minor < 0 ? -0 : whole)
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("");
}
export function safeSum(values: number[]) {
  return values.reduce((s, x) => {
    const total = s + x;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(total))
      throw new Error("Financial total exceeds safe precision.");
    return total;
  }, 0);
}
