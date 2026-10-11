# Planning and net worth in version 2

Planning has five views: Budgets, Pots, Calendar, Debt and Forecast. The selected
view is in the URL (`/planning?tab=calendar`), so links from Home open the relevant
view. Left and right arrow keys move between the tabs. The month picker remains
above every view.

## Budgets

Budgets are stored by category, month and currency. A limit applies from its month
onwards until another monthly record changes it. Existing version 1 monthly-limit
settings remain available as defaults; they are not deleted during migration.

The budget calculation is:

`base limit + carried amount − effective category spending = left`

Carry can be disabled, restricted to a positive surplus, or include overspending.
A carry from any month without a close snapshot is labelled provisional. Spending
uses the same calendar/fixed-day/payday period as Home. Split parents are replaced
by their children; linked refunds reduce the original purchase. Transfers are
excluded. Original transaction values remain unchanged.

Foreign transactions use the cached rate for the transaction date. A missing
conversion prevents a category's spending/remaining value from being presented as
known. Partial statement coverage is called out separately.

## Pots and goals

A goal has a target, an optional due date, and either confirmed monthly
contributions or a linked savings account. An irregular-cost pot also has a
category and monthly, quarterly or annual cadence. Historical annual bills can
suggest a new pot.

Pot values are earmarks, never financial transactions or deductions from cash.
For example, £540 due in March, started in October, needs £90 for each of six
months. Confirming October's £90 leaves £450 to fund over the five remaining
months. Contributions are upserted per month, rather than counted twice.

A bill can consume a pot's earmarks only when its native currency and category
match, its amount is within 10% of the target, and it falls within 45 days of the
due date. The next due date advances by the selected cadence. A fully funded bill
shows “Covered by pot”. Small unrelated charges do not spend the earmark. The
expense still appears in actual financial analytics and reconciliation normally.
Linked savings balances already reflect payments, so they are never reduced a
second time by the pot calculation.

Linked balances require a reconciled native statement (or a dated opening
valuation for a manual savings wallet). Missing balances and rates stay unknown.
When several goals use one savings account, the aggregate set-aside total counts
that account once; the cards explain the shared balance. Selecting a past period
does not include later contribution months in its earmark total.

## Assets, liabilities and net worth

Settings can add property, vehicles, pensions, investments, mortgages, loans and
other manual assets or liabilities. Each entry records a dated valuation. Existing
valuation history keeps its original currency; create another account to use a
different currency.

Manual liability valuations are stored as a positive amount owed and presented
negatively in net worth. A £450,000 house and £280,000 mortgage contribute
£170,000. Valuation reminders default to 180 days for property and 90 days for
other types, with an editable limit from 1 to 3,650 days.

History uses steps at valuation dates, without interpolation. Manual wallets add
subsequent manual ledger entries to a dated opening amount. A later valuation is
a closing observation, so earlier entries are not applied again. Split children
never move a wallet balance separately from their parent.

The optional mortgage estimate uses monthly, penny-rounded amortisation and a
binary search for the level payment. It is marked Estimated until replaced by an
observed valuation. Net worth is partial whenever an included account is missing
or unverified; manual assets do not change income or spending.

## Payments calendar and recurring costs

The month calendar distinguishes imported payments (filled) from expected
payments (outlined). Days show outgoing totals in the reporting currency, and
their detail rows preserve original payment currencies and account identities.
Missing rates are labelled unavailable. All day targets are at least 44 pixels
wide; a small phone can scroll the grid within its card.

Recurring series can be confirmed, renamed, assigned a cadence and expected
amount, ended, or ignored. Expected occurrences are suppressed when a compatible
imported payment exists within five days. A display-name change does not break
the original merchant match. Series history retains its original account and
currency. An ignored or cancelled subscription does not reappear as a new
expected charge.

A price rise requires four observations: the newest price is compared with the
median of the previous three. A rise qualifies at 5% **or** one currency unit,
and another charge at the same new price does not create another rise event.
Keep dismisses the review until another qualifying change; cancellation planning
only records an intention. Feng never contacts a provider or cancels a service.

The subscriptions page shows each supported recurring series' yearly cost and a
reporting-currency total, with sorting by yearly cost. Missing conversions make
the aggregate partial; an entirely unknown aggregate is not displayed as zero.
Calendar price-change notices show previous and current prices, the increase and
annual impact, with a link to the subscription review.

## Debt payoff

Enter an APR and optional minimum for each debt, plus a total monthly payment.
Avalanche pays highest APR first; Snowball pays smallest balance first; Custom
uses the chosen order. All required minimums are paid before extra money is
allocated. Empty minimums use the greater of 1% of principal plus that month's
interest, or 25 units in the debt account's original currency. That native
minimum floor is converted separately when the combined plan uses another
reporting currency.

The model charges monthly interest, `balance × APR / 12`, rounded to the
currency's minor unit. It assumes unchanged rates, no new borrowing and monthly
payments. Insufficient minimum payments or non-reducing debt produce a warning.
The simulation stops after 600 months and reports an unresolved payoff rather
than inventing a date.

An independent Decimal spreadsheet verifies the reference case of £2,000 at
24%, £500 at 18% and £300 per month: Avalanche clears both debts in ten payments,
with £241.08 total interest. The first debt clears on payment eight.

Three reconciled card periods where recognised repayments cover the previous
debt identify a card as paid in full monthly. Generic credits and refunds do not
qualify as repayments. Missing debt balances or FX rates block a combined plan.

## Forecast and what-if scenarios

Confirmed calendar series provide the same due dates, amounts and end/ignore
states to the baseline forecast. They replace matching inferred patterns,
rather than adding another copy of the bill. Pauses and price adjustments take
effect on these original billing dates. Reopening a saved scenario only adjusts
payments in the current forecast window; it does not refund a settled historical
payment or alter the dated actual anchor.

Forecasts require recent reconciled balances and at least three complete prior
months for a spending baseline. Native-currency ledgers reconcile separately;
only then are their projections combined with the latest cached rates. Forecast
rates are assumed constant and their dates are shown. Unknown foreign accounts
are not hidden to produce a convenient total.

What-if adjustments support a one-off income/expense, changing a recurring
amount, pausing a series, or a new monthly recurring item. The dashed scenario
line overlays the solid baseline. A £1,200 expense lowers that projection by
exactly £1,200 from its date. Scenarios never edit actual balances, statements or
transactions. Up to five scenarios can be saved. Each preserves the currency in
which its adjustments were entered, even if the reporting currency later changes.

## Traceability and verification

Planning mutations create local audit entries and expose Undo. Backup format
version 1 includes all new version 3 schema tables. Tests cover monetary
conservation, debt reference calculations, due-date clamping, historical
earmarks, linked balances, missing FX, native reconciliation, recurring prices,
manual wallet valuation, backup-safe data and complete UI journeys.

Focused verification:

```sh
npx vitest run src/analytics/planning-v2.test.ts \
  src/analytics/reporting-forecast.test.ts src/storage/planning-v2.test.ts \
  src/components/PlanningExtensions.test.tsx src/analytics/planning.test.ts \
  src/analytics/subscriptions.test.ts --maxWorkers=1
```
