# Contextual help and compact warnings — UX handoff

Design baseline: Feng Finance 2.2.24. This is a source audit and implementation
handoff, not a claim that the proposed screens have been implemented or tested.
The audit covers every route in `App.tsx`, the Settings subsections, and their
major financial, planning, import and editing components. It uses source and
existing guidance only; no private financial records or user screenshots belong
in this document or public test artifacts.

The owner wants explanation and non-blocking warning detail behind small nearby
symbols. Apply that request to existing guidance: the financial state still
needs a short visible name, while its explanation can live behind the symbol.
Do not retain a paragraph merely because an older review asked for an explicit
explanation. Preserve the underlying financial safeguards.

## Shared interaction contract

- Use `ContextHelp` for section-level help. A question-mark circle is visually
  18–20px inside a minimum 44 × 44 CSS pixel button. Use a warning triangle for
  a current, non-blocking caution. Both have a topic-specific accessible name,
  such as “How monthly averages are calculated” or “Why this month is partial”.
- Put the trigger beside the affected heading or compact status, in normal DOM
  reading order. A heading/trigger row must wrap at narrow widths and enlarged
  text. Keep the trigger adjacent to its heading when other actions wrap.
- Group one concept in one help panel. Do not add a question mark beside each
  metric or repeat the same partial-coverage warning around one card. If the
  section has both general help and a live caution, combine the relevant detail
  in the warning panel where that remains understandable.
- On a page, open the existing `Sheet` pattern: modal dialog, named title,
  visible close button, scrollable content, Escape dismissal, focus contained
  in the dialog and returned to the invoking button. Click, tap, Enter and Space
  must work. A native `title` or hover tooltip is not the explanation.
- Inside a form or workflow already in a `Sheet`/dialog, use an in-place
  disclosure with the same small trigger and an associated content region.
  Do not open a second modal. A help panel must not contain further help
  popups. Use ordinary headings and lists for its grouped detail.
- Never nest the help button inside a link, button, `summary` or form `label`.
  Put it beside the existing control. For an entire clickable account row,
  retain its short status in the row and show detailed evidence in the existing
  account editor; any additional trigger belongs outside that row.
- Help opens only on explicit activation. It must not open automatically after
  a value change. Navigating to a corrective action from help closes the help.
  Help must not modify the ledger, acknowledge a financial risk or save a
  preference merely by opening or closing.
- Keep all content bundled locally, with no network lookup, telemetry or remote
  help dependency. Dynamic dates, counts and reasons use the same calculations
  as the visible screen. Do not duplicate financial calculation logic in help.

## What can collapse

| Content                                                                                | Default presentation                                                                        | What stays outside help                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Definitions, formulae, educational examples, gesture instructions, generic methodology | Nearby `?`                                                                                  | Clear labels and an operable primary control                                            |
| Current non-blocking coverage, stale-rate, partial-history or estimate detail          | Warning symbol beside a concise status                                                      | “Partial”, “Unverified”, “Estimated”, “Rates needed” or equivalent; material count/date |
| A blocker, failed save, unsafe financial outcome or action needing repair              | One concise visible result and direct repair action; expanded reasons behind warning symbol | Actual difference/error, affected scope and next action                                 |
| A decision with a destructive, privacy, security or financial consequence              | Short consequence at the point of action; optional background help                          | Scope, consent, confirmation, essential constraint and cancel/confirm controls          |
| User data and task controls                                                            | Existing data list, table, sheet or disclosure                                              | Values, source evidence, filters, selectable options and actions                        |

“View values”, source evidence, charge lists, schedules, saved reports, statement
figures and historical records are data views. Keep their existing discoverable
entry points. Moving their introductory prose does not turn the data view into
help. An unavailable amount must never look like zero or a complete total.

## Category page — priority implementation

File: `src/pages/Category.tsx`; route: `/categories/:id`.

1. Put one help trigger beside **Spending over time** / **Income over time**.
   Suggested panel title: **About this comparison**. Use an accessible name
   such as **How this category comparison is calculated**.
2. Move these existing explanations into that panel:
   - The comparison-account list and its scope rule from the paragraph above
     the month picker. Give it a **Accounts included** subsection.
   - The prose beginning “Tap a bar or month below…” and the definitions of the
     dashed average line and shaded variation band.
   - The prose beginning “Faded bars are partial months…” including missing
     months, explicit recorded zero and verified zero.
   - All of **Average and standard deviation explained**, preserving the
     recorded-total mean, sample `n−1` calculation, two-observation requirement,
     skipped gaps, FX limitation, excluded transfers and selected-month rule.
   - **Months used for comparison**, including each month’s included/skipped
     result, amount or reason, reporting dates and coverage reasons. Render it
     as a flat list in the panel, with visible reasons under each affected
     month. Remove the nested **Coverage details** disclosures.
3. Keep the current month, period picker, history-window control, financial
   KPIs, average and variation amounts on the page. Keep the baseline count
   next to the average: **n of window previous months**. Show **Unavailable**
   where appropriate; the help explains why.
4. Replace the repeated partial-history paragraphs with a single compact
   **Recorded · partial history** status and adjacent warning symbol. Its
   panel explains that partial months count and further imports can change
   recorded totals. Keep **Based on recorded totals** or an equally clear
   qualifier with a partial difference from average.
5. Keep **Rates needed** with an **Add exchange rates** action when totals
   cannot be computed. The longer missing-currency explanation belongs behind
   its warning symbol. Retain `≈` on converted values; move general conversion
   mechanics behind help while retaining a current stale/missing-rate status.
6. Retain a concise current above-usual result, such as **Above usual variation**,
   with its warning symbol explaining the threshold. The result must not vanish
   into a generic help button.
7. Keep **View values** directly below the plot, outside help. It is the
   accessible month-by-month data alternative and transaction drill-down.
   Preserve partial/unavailable qualifiers in those rows. The chart should
   retain compact visual keys for partial and missing data; the legend’s
   explanation lives in the help.
8. Keep property KPIs, subcategory totals and transaction rows/actions visible.
   Do not move this financial content into the comparison panel.

The default page should no longer contain expanded methodology or coverage
lists. Opening help exposes the existing explanation without adding a second
help button for the same average/variation concept.

## Route-by-route handoff

| Page / source                                                                | Trigger placement and content to move                                                                                                                                                                          | Retain visibly / compact warning treatment                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home — `Home.tsx`: **This month**                                            | Beside heading. Group imported-only accounting, complete/verified comparison requirements, refund treatment and why transfers/card repayments are excluded.                                                    | Amounts, active period, current coverage chip, **No income source imported**, **Not imported**, **Rates needed**, concise **Not comparable yet**. Keep **Not counted** transfer/card-repayment amounts and links; these are useful data/actions. Move repeated unverified-history prose to the warning symbol.                                       |
| Home — `PositionSummary.tsx`: **Where you stand**                            | Beside heading. Explain cash, card debt/credit, net worth, valuation dates and earmarked pots.                                                                                                                 | Separate amounts, included-account coverage, dated observation, **Net worth unavailable** and concise missing/stale status. Warning detail can list affected accounts. Never hide a known debt because full monthly coverage is missing.                                                                                                             |
| Home — `BalanceTrend.tsx`: **Balance trend**                                 | Beside heading. Move **How this is calculated**, drag/keyboard teaching, statement-date sampling, gap interpretation and converted-change explanation.                                                         | Selected scope/range, actual amount and date, change and endpoint dates, **Statement dates only** when applicable, **Unverified** for reported-only values, concise gap count/status. For an unavailable scope, retain a short reason and account-selector/import action.                                                                            |
| Home — `Home.tsx`: **Pots and goals**                                        | Beside heading only when needed. Group earmark semantics and shared/missing linked-balance explanation.                                                                                                        | Pot name, progress/target, **Included in cash**, current unavailable/partial status and Planning link.                                                                                                                                                                                                                                               |
| Home — shared `Chart.tsx` cash-flow card                                     | Place help beside the Cash flow heading or compact chart key. Move repeated unverified-statement/partial-month explanation into the chart help.                                                                | Axes, compact legend, current selected-point readout and partial/unavailable marks. Where supplied, keep **View chart values** outside help.                                                                                                                                                                                                         |
| Home — **Coming up**                                                         | Beside heading. Move recurring-payment detection, complete-month baseline and cached-rate assumptions.                                                                                                         | **Estimated · next 30 days**, payment dates, amounts, evidence count, current **Forecast unavailable** reason in short form. Keep **Rates needed** and original amount when conversion is absent.                                                                                                                                                    |
| Home — **Insight** / **Data health**                                         | Use one help trigger only for the comparison threshold or backup-handoff meaning; do not add one to every insight row.                                                                                         | Actual insight and link; short **n of 3 verified months** / **Selected month incomplete**; last backup date/count, backup-due/no-backup state and Backup action.                                                                                                                                                                                     |
| Accounts — `Accounts.tsx`, `ManualAccountEditor.tsx`                         | Beside **Bank and card accounts** and **Assets and liabilities**. Group statement-created accounts, manual valuation/net-worth accounting and valuation estimates.                                             | Native amounts, debt versus credit, as-of dates, Verified/Unverified/Manual, update-due/no-value states, inclusion setting and Add/Edit actions. Detailed evidence reason moves to the existing account editor, without adding a nested button to the row.                                                                                           |
| Transactions — `Transactions.tsx`, `AdvancedSearch.tsx`                      | Beside **Categories** drop rail and sorting heading. Move drag/Shift/Command instructions and generic sorting teaching. Group split-search counting guidance beside **Search and saved views**.                | Active filters/date range, account balances and dates, match/review/selection counts, category choice, sort/skip/undo, current suggestions and their short evidence. Keep empty-state next action and save errors.                                                                                                                                   |
| Transaction detail — `TransactionDetail.tsx`, `TransactionAccuracy.tsx`      | Beside the classification controls / **How this counts**. Group transfer/refund accounting, source interpretation and conversion mechanics. For split/refund editors, use in-place help in the existing sheet. | Amount, original description, account/date, actual rule origin and Edit rule action, refund’s counted purchase month, conversion amount/date/rate, Source data disclosure, split remainder and invalid-amount errors. Keep any change to a closed month and remove-split consequences at confirmation.                                               |
| Transaction detail — **Link an internal transfer**, `TransferReview.tsx`     | Beside section heading. Group opposite-side match and income/spending exclusion explanation.                                                                                                                   | Candidate rows/amounts, confirmation buttons, current **Unconfirmed · counted in cash flow** status, ambiguous-match state and errors.                                                                                                                                                                                                               |
| Transaction detail — `AttachmentManager.tsx`                                 | Beside **Notes and attachments**. Move image compression, local storage and backup-inclusion teaching.                                                                                                         | Attachment count/limit, add/view/delete controls, short autosave state and error. File constraints needed to choose an attachment stay near the chooser.                                                                                                                                                                                             |
| Analyse — `Analysis.tsx`, `DeeperInsights.tsx`                               | Beside main summary/coverage and **What changed?**. Move general coverage methodology, transaction-date conversion explanation and the three-verified-month rule.                                              | Chosen reporting date range, amounts, `≈`, Partial/Unverified, missing-rate repair, concise withheld-comparison reason and **n of 3 verified months**. Do not open two help controls for the same coverage condition.                                                                                                                                |
| Analyse — **Income, expenses & net cash flow**                               | Beside chart heading; shared chart help handles gaps/partial bars. Move custom-date partial-bar explanation.                                                                                                   | Active range and short **Selected dates only** when custom dates cut through months; chart and values remain directly inspectable.                                                                                                                                                                                                                   |
| Analyse — **Compare with previous period**, **Category trends**              | One help beside comparison heading explains previous-period selection, verified-only average and comparability. Move generic category-trend instructions to it.                                                | Actual previous date range, comparison values or **Not comparable yet**, number of verified months used, category links, Category trends list and Monthly values table outside help.                                                                                                                                                                 |
| Property — `/property`, same `Analysis.tsx`                                  | Reuse analysis help with property-specific wording; a nearby trigger can explain category scope and property cash flow.                                                                                        | Rental income, property costs, net amount, period, partial/FX states, cost categories and transaction links. Do not imply tax profit from net cash flow.                                                                                                                                                                                             |
| Reports — `/analysis?view=reports`, `ReportBuilder.tsx`                      | Beside report title/control group. Group measure/filter instructions, original-currency exports, conversion explanation and overlapping tag totals.                                                            | Report name, selected range/measure/filters, table/chart, native-data export, save/edit/delete and actual errors. For tag grouping, retain a short **Tag totals overlap** qualifier with warning help.                                                                                                                                               |
| Reports — **Property income for Self Assessment**                            | Beside heading. Move background on selected allowable expenses and cash-flow/report scope. In the existing allowable-expenses sheet use inline help.                                                           | Tax year, **Not tax advice**, selected-expenses wording, amounts, expense selection and export. No additional tax treatment may be invented by this copy-only change.                                                                                                                                                                                |
| Trips/projects — `/analysis?view=trips`, `TagAnalysis.tsx`, `TagManager.tsx` | Beside **Trips and projects** only if explaining tags/multi-tag overlap. Avoid `?` on every tag.                                                                                                               | Tags, range, count, totals, transaction links and merge/delete controls. Merge/delete consequences stay in their existing confirmation.                                                                                                                                                                                                              |
| Subscriptions — `Subscriptions.tsx`                                          | Beside page/summary heading. Group detection history, unconfirmed candidates, evidence, annualisation, no background checks and swipe instructions.                                                            | Through-date, estimated annual cost, review counts, **Unconfirmed**, **At latest prices**, charge evidence disclosure, Keep/Plan cancellation/status controls and direct errors.                                                                                                                                                                     |
| Subscriptions — current card warnings                                        | One adjacent warning symbol per affected card can group price rise, overlap, stale-history and post-cancellation detail.                                                                                       | Concise **Price increased** with actual increase; **Charged after cancellation**; **Also on another account**; **No recent charge** as applicable. Keep **Feng does not cancel payments** at the cancellation action. Cancellation plans are **Potential avoided charges**, not confirmed savings. Detailed provider steps may collapse behind help. |
| Month review — `/review`, `MonthReview.tsx`                                  | Beside each step’s heading. Group three-month average/coverage rules and move **Why Planning may show a different suggestion** beside **Pots and goals**.                                                      | Period, step/progress, figures, **n of 3 complete months**, partial/unverified status, actual changes, contribution suggestion/as-of date, confirm/edit controls and backup state. A blocked close keeps its review count or concise coverage requirement and corrective action.                                                                     |

## Planning handoff

File: `src/pages/Planning.tsx` and `src/components/PlanningExtensions.tsx`.
Use the visible view’s heading for its help. Keep tabs, current month, currency
and form actions outside help. A generic page introduction can move to one
**About planning** panel; it does not need a persistent paragraph above tabs.

| View                                   | Move behind the nearby trigger                                                                                                                                                               | Retain visibly / current warning                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forecast — **Projected total balance** | **Forecast inputs and assumptions**; starting-anchor/account detail, missing-day estimation, recurring income/bill rules, variable-spending method, scenario spread and cached-FX mechanics. | **Estimated**, starting/as-of date, projected amount, horizon, baseline-month/verified-account counts, compact legend. When unavailable keep the short blocking reason and Import/Review action. Keep **Below zero around [date]** and its checking action when the model indicates shortage. Expanded caveats use its warning symbol.                |
| Forecast — **Upcoming payments**       | Pattern detection and why expected values can change. Group with forecast help where adjacent.                                                                                               | Expected date/amount, original currency if rates missing, **Estimated** key and **No recurring pattern yet** with Import next step.                                                                                                                                                                                                                   |
| Pots — **Pots and goals**              | Earmarks, annual-cost suggestions, **How this suggestion works**, calendar-month/payday distinction, contribution formula and shared-account counting.                                       | **Included in cash**, target, due date, saved/remaining amount, monthly suggestion and its as-of date, source account/date, **Balance unavailable**, contribution/save actions. Never hide a constraint that prevents contributing or linking.                                                                                                        |
| Budgets — **Monthly budgets**          | **How budgets work**, base + carry − spent formula, rollover education and period mechanics.                                                                                                 | Budget, spent, carried and left amounts, reporting month, **Partial**, missing-rate status, **Provisional carry** and closed-month state. Keep rollover option labels and amount/date constraints within the editor.                                                                                                                                  |
| Calendar — **Payments calendar**       | Filled/outline explanation, cached-currency methodology and recurring-series detection.                                                                                                      | Compact **Imported / Expected** key, dates, totals, **Estimated**, actual price-change figures and actions. Missing rates get a short **Partial · rates needed** state with warning details. Keep **Possible duplicate bill** plus count and review action. Same-bill/separate-bills confirmation retains its consequence.                            |
| Calendar — recurring series editor     | Advanced cadence/default explanation and extra matching teaching, using inline help within the editor sheet.                                                                                 | Name, money direction, amount/currency, cadence/start/end, account, confirmation/ignore/cancel, and short **Imported transactions stay unchanged** consequence when confirming a match.                                                                                                                                                               |
| Debt — **Debt payoff planner**         | Monthly-interest formula, unchanged-rate/no-borrowing assumptions, avalanche/snowball education, minimum-payment default and calculation horizon.                                            | **Estimated**, actual debt values/as-of dates, APR/payment inputs, total interest/payoff date, interest saved, schedule disclosure. Keep **Unverified balance**, missing FX, insufficient payment/non-reducing debt and unresolved payoff in concise text with next action. An empty minimum input must still expose which default is being accepted. |
| What if? — **What if?**                | Preview-only teaching, baseline/scenario reading instructions and five-scenario-limit background.                                                                                            | **Scenario · does not change actual balances**, scenario name/currency, adjustment count, dated projected difference, adjustment controls, values disclosure and unavailable-baseline/rate status. The scenario edit sheet uses in-place help.                                                                                                        |

## Settings handoff

The Settings index is already a compact navigation menu. Do not add help to its
individual links. Add help within the selected subsection, beside its heading.
Where an existing settings component is wrapped in `details`, keep any new help
button outside its `summary`; do not make users navigate nested explanation
disclosures just to reach their settings.

| Subsection / source                                                    | Move to grouped help                                                                                                                                                             | Retain at the control or as short status                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Appearance — `Theme.tsx`                                               | No new help needed for self-explanatory System/Light/Dark labels.                                                                                                                | Current selection and save error.                                                                                                                                                                                                                                                                     |
| Currency — `CurrencySetting.tsx`                                       | Totals versus native values, rate source/caching, transaction-date/manual-rate mechanics and data-sent explanation.                                                              | Selected display currency, `≈`, cache date/stale/no-rates status, update/manual-rate controls and errors. `CurrencyViewNotice` retains which view/currency is active and any missing-rate repair action.                                                                                              |
| Your month — `PeriodSetting.tsx`                                       | Home/budget/review scope and payday fallback mechanics.                                                                                                                          | Chosen calendar/fixed-day/payday option, day control, actual example date range and validation/save errors.                                                                                                                                                                                           |
| Accounts — `Accounts.tsx`, `ManualAccountEditor.tsx`                   | As described in Accounts route above; the same shared component receives the change once.                                                                                        | Amounts, dates, inclusion/currency constraints and account-edit consequences.                                                                                                                                                                                                                         |
| Categories — `CategoriesManager.tsx`                                   | History-preserving rename and category role explanation.                                                                                                                         | Name, parent, colour, transaction count, archived state, restrictions and move/archive/delete consequences. No help beside every category.                                                                                                                                                            |
| Rules — `RulesManager.tsx`, `PersonalRules.tsx`, `ConditionEditor.tsx` | Manual learning, explicit versus auto-rule precedence, order/drag education, recorded provenance, regular-expression teaching and single-use background.                         | Actual match conditions/actions/account scope, priority, preview count, explicit current-versus-future application and save/delete actions. **First 30 matches** stays with a truncated preview. Error and conflict choices remain visible.                                                           |
| Tags — `TagManager.tsx`                                                | General trip/project use and multi-tag overlap.                                                                                                                                  | Tag list, counts, creation/editing and merge/delete scope.                                                                                                                                                                                                                                            |
| Transfer matching — `TransferReview.tsx`                               | Unique-match/two-day/same-currency heuristics and explanations of automatic versus manual mode.                                                                                  | Selected mode, concise **Future imports** scope, pending-pair count, eligible-pair confirmation and mismatch/errors.                                                                                                                                                                                  |
| Reminders — `Reminders.tsx`                                            | **Learn more about calendar reminders**: privacy of exported files, calendar-alert dependency and refreshing dates.                                                              | Toggle/time/day controls, **In-app; export for alerts while closed**, due items/export action. Keep **Existing calendar events are not removed** at the disable/export decision; detailed explanation can collapse.                                                                                   |
| Reports — `Settings.tsx`                                               | What property-tax-summary enables and where to find it.                                                                                                                          | Enable switch and concise selected state.                                                                                                                                                                                                                                                             |
| Backup and restore — `BackupCentre.tsx`, `EncryptedBackup.tsx`         | Portable-copy scope, local encryption methodology, attachment handling and download-handoff meaning.                                                                             | Last backup date/count, save/restore actions and current backup-due state. Keep password length, **Password cannot be recovered**, **Readable financial data** for unencrypted output, attachment inclusion choice, restore preview/counts/date and explicit replacement scope/confirmations visible. |
| Previous data — `SafetyRecovery.tsx`                                   | General update-safety-copy background and distinction from a portable backup.                                                                                                    | Available backup date/version/expiry and Restore action. Replacement and lost-post-update-change warning, including restored PIN/unlock state, stays in confirmation. Keep expired/unavailable/error state visible.                                                                                   |
| App lock — `SecuritySettings.tsx`                                      | Casual-access model, device unlock details and lock-delay background.                                                                                                            | Lock on/off, method/delay controls. At enable/change keep **Does not encrypt stored data**, **No PIN recovery**, backup action and relevant validation/errors. These consequences may be short; they must not be symbol-only.                                                                         |
| Device storage — `StorageUsage.tsx`                                    | What browser storage/persistence means and attachment-storage background.                                                                                                        | Usage/quota, attachment bytes, **Protected / Not protected**, request-protection action. Keep **Storage nearly full** plus Backup/Remove attachments action when above threshold; expanded risk moves to warning help.                                                                                |
| Export — `Settings.tsx`                                                | The spreadsheet explanation can join an **About exports** panel if more guidance exists; one obvious CSV action does not need a new `?` solely for “spreadsheet copy”.           | Export CSV action and errors. Do not suggest CSV can restore the app.                                                                                                                                                                                                                                 |
| Recent changes — `RecentChanges.tsx`                                   | Only generic audit/Undo methodology if explanatory copy is added; do not hide actual change records.                                                                             | Date, change, Undo availability and errors.                                                                                                                                                                                                                                                           |
| Demo data — `Settings.tsx`                                             | Fictitious-data background.                                                                                                                                                      | Load/Delete actions, Demo indicator and concise **Imported records kept** at deletion confirmation.                                                                                                                                                                                                   |
| Import layouts — `ImportLayoutsSettings.tsx`                           | Saved-column-mapping purpose and revalidation process.                                                                                                                           | Layout names/institutions/last-used date, **Check columns next import**, rename/delete and empty-state next action.                                                                                                                                                                                   |
| Import diagnostics — `ImportDiagnosticsSettings.tsx`                   | Five-import retention, exclusion from backup/Undo, redaction mechanics and migration-safety-copy expiry.                                                                         | At the opt-in keep **Stores statement text and figures locally**. At disable keep **Deletes retained diagnostics**. Keep retained count, export/clear actions and errors. Do not hide consent behind a `?`.                                                                                           |
| Statement history — `Settings.tsx`                                     | **Original PDFs are not stored**, parser/extraction terminology and source-trust background can share heading help.                                                              | Month/statement lists, dates, balances, actual difference, Reconciled/Unverified, override status and present source warnings. Data/technical disclosures remain available; compact non-blocking warnings can use a symbol within the opened statement view.                                          |
| About and feedback — `AboutLifecycle.tsx`, `FeedbackPanel.tsx`         | Privacy and storage model, technical-context explanation and installation background. Reuse grouped Privacy / Install help rather than add tiny triggers beside every paragraph. | Version, release links, installation actions, feedback controls, current storage state. Keep **Do not send statements or real figures** by the send action, the preview of what will be sent, and any send/copy error.                                                                                |
| Danger zone — `Settings.tsx`                                           | Only optional background.                                                                                                                                                        | Backup first, exact deletion scope, keep-versus-remove distinction, checkbox/typed ERASE gate, irreversible consequences and confirm/cancel controls. Do not collapse the information needed to approve deletion.                                                                                     |

## Import and active editing workflows

Files: `Import.tsx`, `ImportAccountStep.tsx`, `CsvMappingPanel.tsx`,
`GenericColumnMapping.tsx`, `ImportStatementReview.tsx`,
`StatementReviewWorkspace.tsx`, `GuidedStatementReview.tsx`,
`GenericImportReview.tsx`, `ImportTransferReview.tsx`,
`ImportTransactionReview.tsx`, `SourceRowCorrection.tsx`,
`ImportRiskConfirmation.tsx`, `ImportAnnualSummary.tsx`.

- Add one help trigger beside **Add your statements** for supported formats,
  local/offline processing, duplicate checks and PDF handling. Move **Other file
  formats** prose into that grouped panel while retaining file-picker actions.
- In each statement review, group generic **Reading details**, validation-method
  definitions, credit-card signs and statement-versus-analysis movement rules.
  Keep current import status, remaining-check counts, account/date/currency,
  extracted figures, actual reconciliation difference and blocking step visible.
- Column-mapping help explains source columns, signs, date/number conventions and
  saved layouts. Current selected conventions, sample values, difference and
  Save-layout prerequisites stay at the form. If this workspace is already a
  sheet, help expands inside it.
- Row-correction and guided-review task instructions stay short and visible:
  **Copy the amount from your statement** is needed to perform the current task.
  General parser/OCR teaching can collapse. Never hide unread fields/pages,
  invalid data, changing/excluding a row, duplicate/manual-entry decisions,
  **Nothing imported yet**, explicit override or a failed recheck.
- Optional transfer linking uses one help trigger for automatic-match rules and
  excluded-cash-flow accounting. Keep automatic/confirmed/later counts, pair
  amounts, account names and link decisions outside help.
- Keep the annual-summary **Summary only** status and **Nothing will be saved**
  visible. Printed annual totals are data, not help. Move explanation of annual
  versus transaction statements behind the nearby trigger; retain the monthly
  statement next action.
- `ImportRiskConfirmation` remains an explicit confirmation. It must display
  **Unverified**, unread-page omission, material notice/remaining risk and the
  selected-valid-transactions limit. Help cannot replace acknowledgement.
- Keep batch progress, pending import counts, Leave/Discard consequences and
  confirmation controls visible. Do not clear a warning because someone opened
  its detail panel.

The same rule applies to manual entry, category sorting, split/refund editors
and saved-rule conflicts: move general teaching; retain current scope,
remaining amounts, automatic-learning consequence, source uncertainty and the
decision the user is actually making.

## Global notices and introduction

- Preserve the one-time beta acknowledgement with concise check-your-statements
  and on-device-data statements. Its existing privacy disclosure can remain an
  in-place disclosure; it is already an intentional introduction, not recurring
  page clutter.
- Update/reload readiness, demo mode, offline state and safe-update controls
  remain visible. Never move a pending import/write warning behind help.
- Backup reminders may compact to **Backup due** and a direct **Save backup**
  action, with a warning symbol for the longer why. Separate-browser/installed-app
  storage must retain a concise **Data is separate here** status and backup /
  restore action; losing that distinction would mislead users about their data.
- Installation instructions shown after choosing Install/Install help and
  What's new release content are the requested task itself. Do not replace their
  steps/content with another help popup.

## Implementation and review checklist

- [x] Default category page has no expanded average/std explanation or
      comparison-month/coverage list. One nearby trigger reaches them all.
- [x] All routes and Settings subsections above are checked at least once; no
      replacement is a mechanical sweep of all `p`, `small` or `details` elements.
- [x] Complete, partial, unverified, no-data, missing-FX and stale-FX states retain
      their concise status. Amounts and unavailable placeholders are unchanged.
- [x] Status icons have a stable topic-specific accessible name; meaning is not
      conveyed by colour, shape or a bare asterisk alone. Opening warnings does
      not acknowledge or dismiss financial risk.
- [x] Existing table/data alternatives, source evidence, transaction drill-downs,
      repayment schedules and action disclosures remain directly discoverable.
- [x] Help is reachable and operable with keyboard; focus is visible, enters the
      open panel, remains in its modal, and returns on close/Escape. Inside an
      existing dialog, help expands in place. No nested modal is introduced.
- [x] Interactive markup is valid: no help control inside a button/link/summary/
      label, and no warning trigger swallowing a parent row’s click behavior.
- [x] At 320, 390 and 430px and desktop, light/dark and 200% text, triggers have
      44px targets, headings wrap, content remains readable and the document
      does not overflow horizontally. Help content scrolls with Close reachable.
- [x] Opening and closing help preserves selection, filters, chart scope, form
      drafts, pending imports and scroll position as far as the shared sheet
      already supports. No help interaction mutates financial records.
- [x] Bundled help and dynamic warning detail work offline. No external fetch,
      tracking, service or financial-data upload is introduced.
- [x] Meaningful regression checks cover financial-status visibility and
      representative page-help / help-inside-editor focus behavior. Run the
      repository’s required release checks; record only checks actually run.
- [x] Visual review uses fictitious demo/synthetic data only. Do not copy user
      screenshots, statements, account labels or financial figures into public
      fixtures, docs, screenshots or release artifacts.
- [ ] Physical iPhone / VoiceOver, safe-area and native text-size review remains
      explicitly manual unless performed on the real device.

## Guidance reviewed

Existing behavior and safeguards were checked against `docs/ux-review.md`,
`docs/ux-v225-review.md`, `docs/final-polish-plan.md`, `docs/planning-v2.md`,
`docs/category-statistics.md`, `docs/balance-trend-ux.md`,
`docs/import-guided-review-ux.md`, `docs/import-exceptions-only.md`, and
`docs/import-session-ux-handoff.md`, with the actual route/component source as
the current implementation reference. The existing
`Sheet.tsx`, `UIPrimitives.tsx`, Settings navigation and existing data disclosures
provide the reusable interaction patterns. This handoff changes information
placement and warning density; it does not authorize weaker coverage,
reconciliation, comparison, privacy, backup or destructive-action rules.

## Implemented in 2.2.25

The shared `ContextHelp` control uses a 20px question or warning symbol inside
a 44px target. Page help opens the existing sheet with keyboard focus contained,
Escape/backdrop dismissal and focus returned to the exact trigger. Help inside
an existing editor expands within that same dialog, with bounded scrolling;
its keyboard events cannot trigger financial sorting or Undo shortcuts.

Financial explanations remain inside the app's privacy boundary and close on
backgrounding. Opening warning detail does not accept risk, acknowledge a
separate-storage warning, mark transactions reviewed or change financial data.
Backup-due and separate-storage notices retain their direct backup actions.

The category page groups definitions, chart reading and baseline coverage in
one comparison panel, reachable from the average and chart. Current amounts,
actual variation, concise partial/unverified states, missing-rate repairs and
View values remain directly available. Other pages follow the matrix above.

Local verification includes 1,348 unit/component tests across 171 files,
Chromium/WebKit checks of offline help, unchanged records, warning access,
keyboard focus and shortcut isolation, background privacy and retained import
file-picker behavior. Fictitious-data browser review covers all 38 route and
Settings targets, with a separate 21-case matrix across seven main views at
320px/light, 390px/200% text/dark and 1280px/light. This matrix found no horizontal
overflow, undersized help targets, modal accessibility violations or changed
financial records. Existing chart/statistics and mobile financial safeguards
remain regression-tested. Full repository verification runs in CI before
deployment. No physical iPhone or VoiceOver session is claimed; use the
[manual device checklist](iphone-checklist.md) for those checks.

## Pointer focus after closing a popup

Keep the opener focused when a popup closes so keyboard and assistive-technology
users keep their place. Safari can nevertheless paint a focus ring after a tap
because the native dialog moved focus programmatically. A shared, in-memory
input-modality tracker suppresses control outlines after pointer input throughout
the app. Keyboard input immediately restores the normal focus styles. Text-entry
fields keep their editing indicator, and selected states and warning borders are
unchanged. The tracker captures events even inside shortcut-isolating editors;
it stores no preference or financial data.

Help controls keep a transparent outer background so sticky hover after a tap
does not resemble an additional ring around the icon or badge.
