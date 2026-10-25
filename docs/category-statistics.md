# Recorded category statistics — 2.2.22

## What changed

The previous implementation admitted only fully verified months into the
average. The chart could show six usable recorded monthly totals yet
show no average or standard deviation because every statement was labelled
partial. This confused completeness of the source history with the ability to
describe the records already imported.

Category statistics now use recorded monthly totals. Verification remains a
separate confidence indicator. No import, statement reconciliation, balance,
planning or whole-finance coverage rule is weakened by this display change.

## Calculation

- Sum this category's effective transactions within each reporting month.
  Transfers and card repayments are excluded; splits and allocated refunds use
  the existing effective-transaction projection without double counting.
- Use the previous 1, 3, 6 or 12 months according to the selected window. The
  selected month is excluded from its own historical baseline.
- Include any month with recorded category activity, even with incomplete
  coverage, inferred source dates, pending transfer review or manual accounts.
  Include an explicit recorded zero, including a fully refunded purchase.
- A month with no category activity counts as zero only when verified coverage
  establishes that value. Otherwise it is a gap and is omitted from both the
  sum and the sample count. Unrelated activity does not establish category zero.
- Average = sum of included monthly totals / number of included months.
  One observation is enough to show an average.
- Sample standard deviation = square root of the sum of squared deviations
  from the average divided by n−1. Two observations are enough; a single
  observation has no sample deviation. Identical monthly totals give zero.
- Changing the selected month or history window recalculates the comparison.
  The difference from average is shown for recorded selected-month totals too,
  labelled as recorded when coverage is partial.

The chart shows every baseline month plus the selected month. The dashed line is
the recorded average; the band is average ± sample standard deviation, bounded
at zero for display. It is a descriptive band, not a budget or prediction.

From 2.2.24, the chart header shows **Average monthly spending** (or **Average
monthly income**) and **Monthly variation (standard deviation)** as separate
values. The chart explanation describes the average line and variation band in
words. This wording change leaves the underlying calculations unchanged.

## Confidence and currency

Partial months are included and identified on the chart, in View values and in
Months used for comparison. A short note explains that further imports may
change the totals. Coverage details remain available but do not block the
statistics. The stronger verified “above usual variation” alert still requires
complete current and historical data; ordinary recorded differences do not.

The known category account scope stays consistent and is selected from native
history before display-currency projection. Fully refunded purchases and
accounts with missing exchange rates remain in scope. With no category history,
all statement accounts must support a verified zero rather than guessing which
accounts would have contained the missing spending.

Missing conversions for category transactions prevent that month's mixed-
currency total from being calculated: the app never averages an understated
converted subtotal as if it were the whole category. Existing cached rates can
be used for recorded statistics, with stale/approximate conversion still
labelled. Missing rates for unrelated categories do not block the category mean.
Income shares and property summaries keep their full financial scope. Reporting
dates, including payday-aligned periods, are resolved from the full ledger.

Refund provenance checks remain visible in coverage even when a recorded
refund-adjusted total participates in descriptive statistics. Linked refunds,
split parents and native account/currency inconsistencies cannot manufacture
verified coverage. No native amounts, dates, statements, schema or parser
versions are rewritten. Existing imports work without reimporting.

## Verification

Fictional tests cover all-partial history, moving month/window selection, sample
sizes, zero deviation, explicit and verified zeros, missing months, altered or
deleted rows, inferred dates, manual accounts, transfers, refunds, splits,
foreign-currency subtotals and stale/missing rates. Browser checks cover live
categorisation, offline calculation, unchanged saved financial records,
transaction drill-down, 320–430 px widths and enlarged text. Real financial
records and the user's screenshots are not published as fixtures.
