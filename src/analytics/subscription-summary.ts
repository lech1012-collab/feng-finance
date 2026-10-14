import type { FxRate } from "../domain/models";
import { convertMinor } from "./fx";
import { safeSum } from "../domain/money";

/** Missing rates withhold the total. Originals remain available for review. */
export function recurringReportingTotal(
  charges: readonly { annual: number; currency: string }[],
  reportingCurrency: string,
  date: string,
  rates: readonly FxRate[],
) {
  const conversions = charges.map((charge) =>
    convertMinor(charge.annual, charge.currency, reportingCurrency, date, [
      ...rates,
    ]),
  );
  const missingRates = conversions.some((value) => !value);
  const currencies = [...new Set(charges.map((charge) => charge.currency))];
  return {
    value:
      missingRates || !charges.length
        ? undefined
        : safeSum(conversions.map((value) => value!.amount)),
    missingRates,
    approximate: charges.some(
      (charge) => charge.currency !== reportingCurrency,
    ),
    originals: currencies.map((currency) => ({
      currency,
      amount: safeSum(
        charges
          .filter((charge) => charge.currency === currency)
          .map((charge) => charge.annual),
      ),
    })),
  };
}
