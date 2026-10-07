import type { Account, Statement, Transaction } from "../domain/models";
import { monthOffset } from "../domain/dates";
import { normalizeMerchant } from "../domain/normalize";
export const REMINDER_KEY = "reminders";
export interface ReminderConfig {
  enabled: boolean;
  day: number;
}
export interface FinanceReminder {
  id: string;
  title: string;
  date: string;
  detail: string;
  href: string;
  kind: "statement" | "bill";
}
export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function readReminderConfig(value?: string): ReminderConfig {
  try {
    const c: unknown = JSON.parse(value ?? "null");
    if (
      c &&
      typeof c === "object" &&
      "enabled" in c &&
      typeof c.enabled === "boolean" &&
      "day" in c &&
      Number.isInteger(c.day) &&
      Number(c.day) >= 1 &&
      Number(c.day) <= 28
    )
      return { enabled: c.enabled, day: Number(c.day) };
  } catch {
    /* Invalid settings use safe defaults. */
  }
  return { enabled: true, day: 5 };
}
const shiftMonths = (date: string, months: number) => {
  const month = monthOffset(date.slice(0, 7), months);
  const last = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();
  return `${month}-${String(Math.min(Number(date.slice(8)), last)).padStart(2, "0")}`;
};
export function financeReminders(
  accounts: Account[],
  statements: Statement[],
  transactions: Transaction[],
  currency: string,
  today: string,
  config: ReminderConfig,
): FinanceReminder[] {
  if (!config.enabled) return [];
  const result: FinanceReminder[] = [];
  const due = `${today.slice(0, 7)}-${String(config.day).padStart(2, "0")}`;
  const needed = monthOffset(today.slice(0, 7), -1);
  for (const a of accounts.filter(
    (a) => a.currency === currency && !a.isDemo,
  )) {
    const latest = statements
      .filter(
        (s) =>
          s.accountId === a.id &&
          s.currency === currency &&
          s.statementPeriodEnd <= today &&
          !s.isDemo,
      )
      .map((s) => s.statementPeriodEnd)
      .sort()
      .at(-1);
    if ((!latest || latest < `${needed}-01`) && due <= today)
      result.push({
        id: `statement-${a.id}`,
        title: `Update ${a.displayName}`,
        date: due,
        detail: `Import a statement ending in ${needed} or later. ${latest ? `Latest imported ending: ${latest}.` : "No statement imported."}`,
        href: "/import",
        kind: "statement",
      });
  }
  const groups = new Map<string, Transaction[]>();
  const billCategories = new Set([
    "subscriptions",
    "utilities",
    "insurance",
    "childcare",
    "property",
    "healthcare",
    "cleaning",
  ]);
  for (const t of transactions)
    if (
      t.currency === currency &&
      t.date <= today &&
      !t.isDemo &&
      t.amount < 0 &&
      !t.isTransfer &&
      t.type !== "transfer" &&
      !t.transferPairId &&
      billCategories.has(t.categoryId ?? "")
    ) {
      const merchant = normalizeMerchant(t.merchant || t.description);
      if (!merchant) continue;
      const key = JSON.stringify([t.accountId, merchant]);
      const group = groups.get(key) ?? [];
      group.push(t);
      groups.set(key, group);
    }
  for (const [key, rows] of groups) {
    const recent = rows.sort((a, b) => a.date.localeCompare(b.date)).slice(-6);
    const gaps = recent
      .slice(1)
      .map(
        (t, i) => (Date.parse(t.date) - Date.parse(recent[i].date)) / 86400000,
      );
    const cadence =
      recent.length >= 3 && gaps.every((g) => g >= 24 && g <= 38)
        ? 1
        : recent.length >= 3 && gaps.every((g) => g >= 80 && g <= 100)
          ? 3
          : recent.length >= 2 && gaps.every((g) => g >= 350 && g <= 380)
            ? 12
            : 0;
    if (!cadence) continue;
    const last = recent.at(-1)!;
    const date = shiftMonths(last.date, cadence);
    const distance = (Date.parse(date) - Date.parse(today)) / 86400000;
    if (distance < -45 || distance > 14) continue;
    result.push({
      id: `bill-${key}`,
      title: `Review ${last.merchant || last.description}`,
      date,
      detail: `Expected around ${date}, based on ${recent.length} imported payments. Check whether it was paid; imported history cannot confirm a current payment.`,
      href: `/transactions?account=${last.accountId}&allDates=1&search=${encodeURIComponent(last.merchant)}`,
      kind: "bill",
    });
  }
  return result.sort(
    (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
  );
}
/** Calendar content intentionally contains no merchant, amount or account data. */
export function reminderCalendar(
  config: ReminderConfig,
  today: string,
  reminders: FinanceReminder[],
) {
  const next = `${today.slice(0, 7)}-${String(config.day).padStart(2, "0")}`;
  const due = next < today ? shiftMonths(next, 1) : next;
  const event = (date: string, uid: string, title: string, repeat = false) => [
    "BEGIN:VEVENT",
    `UID:${uid}@feng-finance.local`,
    `DTSTAMP:${today.replaceAll("-", "")}T000000Z`,
    `DTSTART:${date.replaceAll("-", "")}T090000`,
    "DURATION:PT15M",
    `SUMMARY:${title}`,
    ...(repeat ? ["RRULE:FREQ=MONTHLY"] : []),
    "BEGIN:VALARM",
    "TRIGGER:PT0S",
    "ACTION:DISPLAY",
    "DESCRIPTION:Open Feng Finance to review your finances",
    "END:VALARM",
    "END:VEVENT",
  ];
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Feng Finance//Local reminders//EN",
    "CALSCALE:GREGORIAN",
    ...event(
      due,
      "monthly-statement-review",
      "Update statements in Feng Finance",
      true,
    ),
    ...reminders
      .filter((r) => r.kind === "bill" && r.date >= today)
      .map((r, i) =>
        event(
          r.date,
          `bill-review-${r.date}-${i}`,
          "Review upcoming bill in Feng Finance",
        ),
      )
      .flat(),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
