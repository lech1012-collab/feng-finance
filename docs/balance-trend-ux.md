# Balance trend — UX review and implementation, 2.2.20

## Purpose and diagnosis

The Home chart should answer “How has this balance changed?” The old Balance
history view overlaid bank balances and intermittent card observations, omitted
the value axis, and provided no amount or dated change. Whole-chart hatching
followed missing net-worth coverage even when individual bank history was good.
The Account breakdown toggle, legend and long explanation asked users to decode
the underlying data model.

The UX reviewer recommended one series with a useful default, visible amounts,
direct inspection and deliberate sparse states. A second review caught credit
wording, mixed daily/snapshot provenance and range-specific FX explanations.

## Journey and layout

1. Open Home. Balance trend shows Cash balances when verified current/savings
   history is available. With card-only data, a recorded account is selected.
2. Read the latest available amount and its actual date. A change is shown only
   between two verified observations, with both comparison dates. Percentages
   are secondary and omitted for zero/negative baselines or a credit crossing.
3. Select Cash balances, Net worth or an individual account in a single compact
   picker. Accounts include their masked identifier to distinguish names.
4. Select a useful 1/3/6/12-month range. The first selection finds the smallest
   range with useful observations; explicit user range choices are preserved.
   Longer options appear when they reveal additional earlier observations. The
   selected range drives the plot and comparison dates together.
5. Touch or drag across the chart to inspect a day in the visible readout.
   Keyboard arrows, Home and End inspect the same data. Vertical scrolling
   remains available. Readouts identify unavailable and unverified values.
6. A single observation shows its amount/date and a short next step, without an
   empty plot or range controls. Missing net worth explains the coverage needed
   and offers the account selector. Internal gaps identify missing dates; a
   boundary day alone does not generate an import warning.

The normal mobile value is approximately 30–32 px, controls are at least 44 px,
supporting text is 14 px, and SVG labels are at least 12 px and scale with text
settings. The plot is about 204 px at standard text size. One series replaces the
overlay toggle, colour legend and full-plot shading. Help stays collapsed.

## Financial and technical boundaries

`BalanceTrend` handles the historical card; `PositionSummary` retains the
existing Cash / Card debt / Net worth snapshot. No stored amounts, account types,
transaction signs, schema or reconciliation policies change.

`balance-trend.ts` selects and presents existing reporting balances. Cash is
available only where every included current/savings account has a verified
converted balance. Missing card history does not suppress verified cash.
Net worth keeps the existing complete-account requirement. Individual accounts
can show a reported unverified observation, clearly labelled, without a verified
line or change. Missing/stale conversion data cannot become a verified total.

Debt charts negate the signed ledger balance. Debt owed is positive; a card
credit remains negative on that scale and is labelled Credit balance. Changes
within debt say increased/reduced; credit crossings say the card position
improved/worsened. Net-worth arithmetic retains the original signed liabilities.

The existing balance engines add transient daily-provenance metadata alongside
their unchanged monetary values. Only daily ledger coverage can form line
segments. Closing-only observations remain separate, including adjacent dates;
a mixed range preserves genuine daily segments beside the isolated snapshots.
Missing or unverified days break lines. Dated endpoint changes do not claim to
explain spending or movement during a gap. Transfers still move account balances
without entering income/spending analytics. Converted changes may include FX
movement and are qualified in the UI.

## Review and validation

Fictional unit/component fixtures cover independent cash/card coverage, debt and
credit signs, exact endpoint comparisons, zero baselines, range boundaries,
missing/stale FX, isolated observations and mixed daily/snapshot provenance.
Browser cases cover touch/keyboard inspection, live range selection, sparse
states, card truth after missing rows, themes, 320/390/430 px, large text and
desktop. Screenshots used for design review contain fictional data only.

Real-device Safari/VoiceOver checks remain in the manual release checklist.

The hosted verification initially stalled downloading browser libraries from
the Azure Ubuntu mirror. CI uses Ubuntu's canonical archive with normal APT
signature verification and a bounded browser-setup step. The unit, build,
browser, vulnerability and deployment gates remain required.
