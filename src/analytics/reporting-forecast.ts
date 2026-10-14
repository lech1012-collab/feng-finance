import type {
  Account,
  FxRate,
  Setting,
  Statement,
  Transaction,
  RecurringSeries,
} from "../domain/models";
import { safeSum } from "../domain/money";
import { planningForecast } from "./planning";
import { convertMinor } from "./fx";

type NativeForecast = ReturnType<typeof planningForecast>;
export interface ReportingUpcomingPayment extends Omit<
  NativeForecast["upcoming"][number],
  "amount"
> {
  amount: number | undefined;
  originalAmount: number;
  originalCurrency: string;
  missingRate: boolean;
}
export interface ReportingForecast extends Omit<
  NativeForecast,
  "upcoming" | "income" | "bills"
> {
  upcoming: ReportingUpcomingPayment[];
  income: number | undefined;
  bills: number | undefined;
  converted: boolean;
  rateDates: string[];
}

/** Each native-currency ledger reconciles independently before any reporting conversion.
 * Forecast conversions use the latest cached rate, clearly an assumption for future dates. */
export function reportingPlanningForecast(
  transactions: Transaction[],
  accounts: Account[],
  statements: Statement[],
  settings: Setting[],
  currency: string,
  today: string,
  horizon: 30 | 60 | 90,
  rates: FxRate[],
  series: RecurringSeries[] = [],
): ReportingForecast {
  const currencies = [
    ...new Set(
      accounts.filter((a) => a.tracking !== "manual").map((a) => a.currency),
    ),
  ];
  if (
    currencies.length <= 1 &&
    (!currencies.length || currencies[0] === currency)
  ) {
    const forecast = planningForecast(
      transactions,
      accounts,
      statements,
      settings,
      currency,
      today,
      horizon,
      series,
    );
    return {
      ...forecast,
      upcoming: forecast.upcoming.map((p) => ({
        ...p,
        originalAmount: p.amount,
        originalCurrency: currency,
        missingRate: false,
      })),
      converted: false,
      rateDates: [] as string[],
    };
  }
  const groups = currencies.map((native) => ({
    native,
    forecast: planningForecast(
      transactions,
      accounts,
      statements,
      settings,
      native,
      today,
      horizon,
      series,
    ),
  }));
  const rateDates = new Set<string>();
  let missingRate = false;
  const conversion = (amount: number, native: string) => {
    const value = convertMinor(amount, native, currency, today, rates);
    if (!value) {
      missingRate = true;
      return 0;
    }
    if (native !== currency) rateDates.add(value.date);
    return value.amount;
  };
  const income = safeSum(
    groups.map((g) => conversion(g.forecast.income, g.native)),
  );
  const bills = safeSum(
    groups.map((g) => conversion(g.forecast.bills, g.native)),
  );
  const upcoming: ReportingUpcomingPayment[] = groups
    .flatMap((g) =>
      g.forecast.upcoming.map((p) => {
        const value = convertMinor(p.amount, g.native, currency, today, rates);
        if (!value) missingRate = true;
        return {
          ...p,
          amount: value?.amount,
          originalAmount: p.amount,
          originalCurrency: g.native,
          missingRate: !value,
        };
      }),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const reason = missingRate
    ? "Cached exchange rates are needed for every account currency."
    : groups.find((g) => g.forecast.reason)?.forecast.reason;
  const baselineMonths = groups.length
    ? Math.min(...groups.map((g) => g.forecast.baselineMonths))
    : 0;
  const startDates = groups
    .map((g) => g.forecast.points[0]?.date)
    .filter((d): d is string => !!d);
  const start = startDates.sort().at(-1);
  const pointMaps = groups.map(
    (g) => new Map(g.forecast.points.map((p) => [p.date, p])),
  );
  const points =
    !reason && start
      ? (groups[0]?.forecast.points ?? [])
          .filter(
            (p) => p.date >= start && pointMaps.every((m) => m.has(p.date)),
          )
          .map((p) => ({
            date: p.date,
            balance: safeSum(
              groups.map((g, i) =>
                conversion(pointMaps[i].get(p.date)!.balance, g.native),
              ),
            ),
            lower: safeSum(
              groups.map((g, i) =>
                conversion(pointMaps[i].get(p.date)!.lower, g.native),
              ),
            ),
            upper: safeSum(
              groups.map((g, i) =>
                conversion(pointMaps[i].get(p.date)!.upper, g.native),
              ),
            ),
          }))
      : [];
  const anchor = points.length
    ? {
        stamp: Date.parse(`${points[0].date}T00:00:00Z`),
        date: points[0].date,
        total: points[0].balance,
        balances: {} as Record<string, number | null>,
      }
    : undefined;
  const dailyVariable = groups.every(
    (g) => g.forecast.dailyVariable !== undefined,
  )
    ? safeSum(
        groups.map((g) =>
          conversion(Math.round(g.forecast.dailyVariable!), g.native),
        ),
      )
    : undefined;
  return {
    upcoming,
    reason: missingRate
      ? "Cached exchange rates are needed for every account currency."
      : reason,
    anchor,
    baselineMonths,
    points,
    income: missingRate ? undefined : income,
    bills: missingRate ? undefined : bills,
    dailyVariable: missingRate ? undefined : dailyVariable,
    converted: true,
    rateDates: [...rateDates],
  };
}
