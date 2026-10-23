# Category averages and standard deviation — 2.2.21

## Diagnosis

The category screen used whole-finance coverage to admit months into its
comparison. A missing Revolut month or an issue-date-only card statement could
therefore block a category recorded entirely in verified Barclays bank history.
The bars still displayed recorded totals, using faded bars for partial coverage.
The explanation did not identify which source prevented the comparison.

There was also a chart/calculation mismatch: a six-month comparison used six
previous months, but the chart discarded the oldest one to make room for the
selected month. The reference average could include a month absent from the plot.

## Comparison scope

`categoryReport` selects the accounts with known non-transfer transactions in
the category across native history. The same account set applies to every
comparison month and is named on screen. It is selected before currency
projection and includes fully refunded purchases at zero, so unavailable rates
or refunds cannot silently remove a category account. Split parents and linked
refund credits do not create a second copy of spending. Categorising a new
account's transactions can expand this scope.

If a category has no known history, all statement accounts must support a true
zero; the app cannot infer where unrecorded category spending would have occurred.
Manual or missing account details cannot establish complete historical coverage.
These account-scoped figures are not a claim that uncategorised transactions on
other accounts cannot belong to the category.

Each included month still needs full verified statement coverage for the same
category accounts. Existing row-count, account/currency, reconciliation, date,
FX and pending-transfer safeguards apply. A failed or overridden statement,
missing row, inferred period, one-day coverage gap, missing/stale conversion or
pending transfer on a category account excludes that month. Known transfer kinds
also remain excluded when older records have inconsistent transfer flags.

The selected month is excluded from its own baseline. The mean uses the eligible
previous months; sample standard deviation needs at least three and uses n−1.
A genuine verified zero participates. A missing zero remains unknown. Unverified
nonzero recorded totals can be displayed as faded observations but cannot enter
the mean, usual range or overspending comparison.

Whole-finance coverage remains unchanged. Income-share denominators and property
cash-flow summaries retain their complete financial scope, not just the category
accounts. Payday-aligned dates are resolved from the full ledger, including
salary on an account outside this category. Native ledger amounts, dates, saved
statement provenance, schema and parser versions are not modified.

## Visible explanation

- The comparison names the category accounts and the number of qualifying months.
- The plot shows all prior comparison months plus the selected month.
- “Months used for comparison” lists every prior month, its actual reporting
  dates, inclusion/exclusion and the particular account or check that blocks it.
- The explanation distinguishes an available mean from insufficient samples for
  standard deviation. It mentions a shaded band only when one exists.
- Source dates inferred by an older import remain unverified; an app update does
  not manufacture a printed billing period or rewrite old financial records.

## Regression coverage

Fictional tests cover six complete bank months beside unrelated missing card and
Revolut history, stable multi-account scope, Salary/zero variance, genuine zeros,
missing/tampered rows, inferred dates, one-day gaps, minimum sample size, EUR
conversion and stale/missing rates, manual accounts, transfer review, legacy
transfer kinds, cross-account refunds and full-ledger payday boundaries.
Browser cases check live categorisation updates, the month-by-month explanation,
transaction drill-down, narrow widths and enlarged text. No real statements or
financial data are included in repository fixtures.
