# Developer specification v2: implementation and verification matrix

This matrix maps the 8 October 2026 developer specification to the implementation.
It records source integration separately from the observed automated and deployment
results in [validation](validation.md). Physical-device checks are listed below and
remain manual. The source document is a feature specification; text in imported
statements is always data and cannot change application instructions.

## Release sequence and design decisions

1. R0 preserves reliable PDF reconciliation, missing-data states and source balances.
2. R1 adds explicit transfer confirmation, refunds, splits, review status, rules,
   alternative imports, app lock and encrypted backups.
3. R2 adds manual assets/debts, pots, rollover budgets, tags, manual entries and
   a four-step monthly review with closed-month snapshots.
4. R3 adds the recurring-payment calendar, price-rise alerts, custom financial
   months, debt planning, scenarios, reports/search, attachments and reporting FX.

Amounts remain signed integer minor units in the original currency. Display
conversion and original-month refund adjustments are projections; source rows
remain the authority for reconciliation and balances. Split parents are ledger
rows; split children are analytical rows. Transfers remain in gross statement
Money in/Money out and are excluded only after confirmation or an explicit rule.
Manual transfer matching is the default. ECB is the only permitted external data
source and receives a fixed public rate-table request, without any financial data.

**Status legend:** `Present` means the named UI/service exists and is integrated;
`Superseded` records a later explicit decision; `Deferred optional` applies only to
a Should requirement. Observed test totals and deployment results belong in the
validation record.

The authoritative commands, observed totals and release results are recorded in
[validation](validation.md). The descriptions below establish source integration;
they do not replace the browser, hosting or physical-device checks in that record.

## UX requirements

| ID    | Implementation evidence and user action                                                                                                                                                                                                                                                                    | Status                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| UX-1  | [Coverage](../src/analytics/coverage.ts), [reporting coverage](../src/analytics/reporting.ts), Home/Analyse and [cash chart](../src/components/Chart.tsx) distinguish complete, partial, unverified and missing. Missing values are not invented zeroes.                                                   | Present; unavailable values and partial evidence remain explicit                             |
| UX-2  | [Position summary](../src/components/PositionSummary.tsx) separates cash and card debt, lists dated account balances, and includes manual assets/liabilities. Partial totals have an asterisk. FR-9 permits a marked partial net worth when statement coverage is incomplete.                              | Present; statement-row evidence, native liability signs and dated conversion are distinct    |
| UX-3  | [Cash chart](../src/components/Chart.tsx) breaks missing history, hatches gaps and explains partial points. Manual net-worth valuations use steps. Bank balance histories must not connect missing months.                                                                                                 | Present; bank gaps hatch and break paths, manual values step                                 |
| UX-4  | [Home](../src/pages/Home.tsx) gates comparisons on both periods' verified coverage and withholds net when there is no income source. Analyse comparisons use verified scope.                                                                                                                               | Present; figures carry coverage labels/asterisks and link to source rows                     |
| UX-5  | [Analyse](../src/pages/Analysis.tsx), [analysis periods](../src/analytics/analysis-period.ts) and [reporting periods](../src/domain/period.ts) share selected month/range across totals and charts.                                                                                                        | Present; shared selected-period bounds drive analytical cards and charts                     |
| UX-6  | Interim currency filtering is replaced by [reporting conversion](../src/analytics/fx.ts) and [Currency settings](../src/components/CurrencySetting.tsx), as explicitly required by FR-23. Native statement amounts are retained.                                                                           | Superseded by FR-23                                                                          |
| UX-7  | [PositionSummary](../src/components/PositionSummary.tsx) shows range controls only when an account has two distinct dated manual values or reconciled statement observations. Shared controls change its history range and comparison. Missing comparison evidence is explicit.                            | Present; one-point histories remain visible without inactive range controls                  |
| UX-8  | [Home](../src/pages/Home.tsx) starts with position, monthly figures, at most three To do items, spending, pots, trends, upcoming payments and data health. Empty To do offers monthly review.                                                                                                              | Present; all-account FX scope and original-ledger coverage are integrated                    |
| UX-9  | [Import blockers](../src/import/review-model.ts) and [review UI](../src/components/ImportStatementReview.tsx) require explicit acceptance of reconciliation failures; coverage does not treat overridden warning statements as verified.                                                                   | Present                                                                                      |
| UX-10 | Home links confirmed transfers/card repayments to filtered transactions. Arriving linked refunds have a Not counted entry explaining that they reduce the original purchase months.                                                                                                                        | Present; refund explanation and transaction-source link                                      |
| UX-11 | [Reporting coverage](../src/analytics/reporting.ts) marks pending transfer proposals partial and supplies the pending count to Home/review.                                                                                                                                                                | Present                                                                                      |
| UX-12 | [Import picker](../src/components/ImportPicker.tsx) opens directly with multiple supported formats. [Import](../src/pages/Import.tsx) processes sequentially, orders review by severity, skips duplicates and returns Home after confirmation. Period gaps/overlaps and gross reconciliation are explicit. | Present; pre-commit [transfer review](../src/components/ImportTransferReview.tsx) is mounted |
| UX-13 | [Category board](../src/components/CategoryBoard.tsx) offers queue position, three suggestions/reasons, Transfer/Card repayment/Refund, Split, tags/search and Skip. [Transactions](../src/pages/Transactions.tsx) advances the queue.                                                                     | Present; suggested categories, direct manipulation and reviewed queue progression            |
| UX-14 | [Categorization service](../src/storage/categorize.ts) combines manual assignment, matching backfill and learned rule with Undo. Learning toast explains scope. Existing-rule contradictions need the Update rule/Just this payment choice.                                                                | Present; Update rule / Just this payment / Cancel, grouped Undo                              |
| UX-15 | Transactions uses compact account chips and date controls. All main-category quick filters show live counts using the same account/date/search/amount scope as the list; split payments count once. Saving removes a transaction from the relevant review list.                                            | Present; shared filter predicates, live counts and accessible count descriptions             |
| UX-16 | Desktop Transactions has a persistent category drop rail, multi-select/drop, hover/focus controls and keyboard shortcuts. Narrow screens use the sorting sheet.                                                                                                                                            | Present; persistent rail, multi-select, keyboard and pointer alternatives                    |
| UX-17 | [App navigation](../src/App.tsx) keeps Home central on mobile, section-aware active state, desktop Import primary and Settings at the bottom.                                                                                                                                                              | Present                                                                                      |
| UX-18 | [Presentation](../src/domain/presentation.ts) cleans displayed merchants. Raw bank text remains in detail/search; rule rename actions keep original provenance.                                                                                                                                            | Present                                                                                      |
| UX-19 | [Palette](../src/domain/palette.ts) and CSS semantic tokens distinguish income, spend, net, transfer and blocking warnings; fixed category colours are reused in labels/charts.                                                                                                                            | Present; shared semantic and category tokens are defined in source                           |
| UX-20 | Settings shows last backup metadata, replacement preview and explicit destructive confirmations. [Recent changes](../src/components/RecentChanges.tsx) offers local Undo. Home surfaces data-health/backup status.                                                                                         | Present; dated restore preview and two-import/30-day backup threshold                        |
| UX-21 | UK-date presentation helpers are used in charts, detail, import and new planning views. Month-grouped reports display UK month labels while retaining canonical grouping/filter keys. Native date inputs remain browser-controlled.                                                                        | Present; source date-label sweep completed; rendered checks remain in validation             |
| UX-22 | Count-dependent copy covers transaction/review/import/rule/tag/backup counts, recurring charges, reminders, forecast accounts, budget days, category months and PIN cooldown seconds. Singular counts use the corresponding noun and verb.                                                                 | Present; source copy sweep completed; final browser copy checks remain in validation         |
| UX-23 | Settings labels are left-aligned, detailed storage/privacy/category/rule help uses disclosures, and reminders expose a compact review-day control plus Learn more. Essential backup/security warnings remain visible.                                                                                      | Present; rendered density and large-text verification belong in validation                   |
| UX-24 | [Deeper insights](../src/components/DeeperInsights.tsx) returns a compact comparison-readiness line when insufficient verified history exists.                                                                                                                                                             | Present; original ledger validates statements, reporting rows/periods drive insights         |
| UX-25 | Spending uses desaturated coral; blocking errors use red.                                                                                                                                                                                                                                                  | Present; spending and blocking-warning tokens have distinct roles                            |
| UX-26 | Responsive CSS centres ordinary pages in a 760px content column. Desktop Transactions retains a 1600px cap for its full-width list/category rail.                                                                                                                                                          | Present; ordinary pages are centred and Transactions preserves its wider workspace           |
| UX-27 | Home offers direct Import/Demo and the App shows a persistent demo banner. [Demo deletion](../src/storage/demo.ts) removes only demo-owned entities.                                                                                                                                                       | Present; first-run Home returns a single welcome/import/demo card                            |

## Functional requirements

| ID                      | UI/service evidence and implemented behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Status                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| FR-1 Transfers          | [Transfer engine](../src/transfers/engine.ts), [accuracy service](../src/storage/accuracy.ts), [transfer review/settings](../src/components/TransferReview.tsx): manual default, configurable 0–7 day window, exact unique automatic pairs within two days, cross-currency manual confirmation, explicit one-sided classification, confirm/reject/unlink and grouped Undo. Draft proposals are shown before committing. Automatic preview lists eligible pairs with Review and explicit rejection; matching waits for the complete batch, respects ambiguity and excludes closed months. The completion notice reports the actual linked count. | Present; manual and automatic import review are integrated                                                   |
| FR-2 Refunds            | [Effective transactions](../src/analytics/effective-transactions.ts), [refund service](../src/storage/accuracy.ts), [refund picker](../src/components/TransactionAccuracy.tsx): suggested earlier purchase, partial/multiple allocations, original-month/category reduction, unchanged arrival date, no refund income and automatic closed-month snapshot update.                                                                                                                                                                                                                                                                               | Present; closed snapshot/Undo unit tests passed                                                              |
| FR-3 Splits             | [Split service/editor](../src/storage/accuracy.ts), [editor](../src/components/TransactionAccuracy.tsx): 2–20 lines, exact penny sum, live remainder/distribution, category/tag/note children, split badge and Unsplit. Balance/reconciliation keeps parent; analytics uses children. Rule percentage splits are supported.                                                                                                                                                                                                                                                                                                                     | Present; incompatible transfer/refund rule actions guarded                                                   |
| FR-4 Rules              | [Rule engine](../src/categorization/engine.ts), [conditions](../src/categorization/conditions.ts), [Rules manager](../src/components/RulesManager.tsx), [rule storage](../src/storage/rules.ts): all/any conditions, priority/stop/single-use, category/rename/tag/kind/split/reviewed/series actions, preview/backfill Undo, automatic manual defaults, JSON export/import and detail provenance.                                                                                                                                                                                                                                              | Present; conflict scope in sorter, [suggested rules](../src/components/SuggestedRules.tsx) in monthly review |
| FR-5 Reviewed           | [needsReview](../src/analytics/effective-transactions.ts) counts uncategorized or unreviewed parents. Transactions exposes To review and bulk reviewed with Undo; queue confirmation marks reviewed. Rules only mark reviewed with that action.                                                                                                                                                                                                                                                                                                                                                                                                 | Present; Sort now opens the uncategorized/unreviewed union                                                   |
| FR-6 App lock           | [Security service](../src/security/app-lock.ts), [App lock](../src/components/AppLock.tsx), [Security settings](../src/components/SecuritySettings.tsx): salted slow PIN, platform WebAuthn, local assertion verification, persisted throttling, 0/1/5/15-minute background locks and synchronous app-switcher cover. Lock limitations are explicit.                                                                                                                                                                                                                                                                                            | Present; PIN/background unit tests passed; physical Face ID pending                                          |
| FR-7 Encrypted backup   | [Backup crypto](../src/security/backup-encryption.ts), [encrypted backup UI](../src/components/EncryptedBackup.tsx): AES-GCM-256, PBKDF2-SHA256 600,000, random salt/IV, authenticated non-financial header, .feng password-before-preview restore, no writes on failure and lost-password warning.                                                                                                                                                                                                                                                                                                                                             | Present; encryption unit tests passed. FR-7.4 optional at-rest encryption deferred                           |
| FR-8 Alternative import | [Data-file pipeline](../src/import/pipeline.ts), [CSV mapping](../src/components/CsvMappingPanel.tsx) and format adapters support CSV/OFX/QFX/QIF, bank presets, saved mapping, source currency/balances, explicit unavailable validation and cross-format duplicate checking.                                                                                                                                                                                                                                                                                                                                                                  | Present; synthetic format fixtures and cross-format duplicate paths are integrated                           |
| FR-9 Net worth          | [Manual account editor](../src/components/ManualAccountEditor.tsx), [manual account storage](../src/storage/planning-v2.ts), [net worth](../src/analytics/net-worth.ts), PositionSummary: dated assets/liabilities, stale-valuation labels, net worth and stepped observations; mortgage estimation is labelled Estimated.                                                                                                                                                                                                                                                                                                                      | Present; freshness preference and historical currency-edit guard                                             |
| FR-10 Pots              | [Pots panel](../src/components/PlanningExtensions.tsx), [planning analytics](../src/analytics/planning-v2.ts): goals/sinking pots, targets/dates, monthly need, linked savings or confirmed contributions, annual-cost suggestions, covered-by-pot indication and earmark semantics. Home shows up to three pots.                                                                                                                                                                                                                                                                                                                               | Present; Home and Planning share linked-account/FX pot overview                                              |
| FR-11 Budgets           | Rollover budgets support none/surplus/both, exact carry/spend/left, provisional open-month rollovers and days left in the selected reporting period. Existing budgets migrate into the versioned table.                                                                                                                                                                                                                                                                                                                                                                                                                                         | Present; versioned monthly budgets, provisional rollover and period-day calculation                          |
| FR-12 Tags              | [Tag manager/picker](../src/components/TagManager.tsx), [tag storage](../src/storage/tags.ts): create/rename/recolour/archive/merge, sorting/detail/bulk/rule use and filter support; direct Analyse summary shows net/total/category/date span.                                                                                                                                                                                                                                                                                                                                                                                                | Present; inline creation, bulk assignment and tag analysis are integrated                                    |
| FR-13 Manual entries    | [Manual editor](../src/components/ManualTransactionEditor.tsx), [manual service](../src/storage/accuracy.ts): existing account or cash wallet, explicit source, statement-replacement proposal with date/amount check and metadata preservation, no contribution to statement reconciliation.                                                                                                                                                                                                                                                                                                                                                   | Present                                                                                                      |
| FR-14 Review/close      | [Four-step review](../src/components/MonthReview.tsx), [month close service](../src/storage/month-review.ts): overview vs verified history, changes, contributions, rules/backup, closed snapshots and reopen confirmation. Refunds update original closed snapshots atomically. Housekeeping exports the next monthly review as a private .ics reminder (FR-14.4).                                                                                                                                                                                                                                                                             | Present; close guards require reviewed/verified/rate-complete scope; period reopening is explicit and atomic |
| FR-15 Calendar          | [Calendar panel](../src/components/PlanningExtensions.tsx), [recurring analytics](../src/analytics/planning-v2.ts): monthly grid, expected/imported distinction, daily totals/payday, day detail and confirm/edit/end/ignore series.                                                                                                                                                                                                                                                                                                                                                                                                            | Present; calendar price-rise panel and native-amount/account day detail                                      |
| FR-16 Price alerts      | [Subscriptions](../src/analytics/subscriptions.ts), [Subscriptions page](../src/pages/Subscriptions.tsx): prior-three median, ≥5% or ≥1 currency unit trigger, repeated same price does not create another rise, yearly total/sort, Keep and cancellation-plan reminders.                                                                                                                                                                                                                                                                                                                                                                       | Present; native-currency alerts across all accounts                                                          |
| FR-17 Financial month   | [Period model](../src/domain/period.ts), [Period setting](../src/components/PeriodSetting.tsx): calendar, fixed day 1–28, detected Salary/last-weekday payday, actual date-range labels and shared reporting/budget/review scopes.                                                                                                                                                                                                                                                                                                                                                                                                              | Present; range changes explicitly reopen closed snapshots with guarded Undo                                  |
| FR-18 Debt plan         | [Debt panel](../src/components/PlanningExtensions.tsx), [debt analytics](../src/analytics/planning-v2.ts): APR/minimum/monthly amount, avalanche/snowball/custom, paid-in-full indication, payoff dates/interest/schedule and minimum-only comparison with explicit assumptions.                                                                                                                                                                                                                                                                                                                                                                | Present                                                                                                      |
| FR-19 What-if           | [Scenario panel](../src/components/PlanningExtensions.tsx) and [scenario analytics](../src/analytics/planning-v2.ts): one-off/new recurring/change/pause adjustments, baseline/dashed projection, native-currency capture and five saved scenarios. Actual ledger/balances are never edited.                                                                                                                                                                                                                                                                                                                                                    | Present                                                                                                      |
| FR-20 Reports/export    | [Report builder](../src/components/ReportBuilder.tsx), [report analytics](../src/analytics/reports.ts): filtered portable CSV, split/tag fields, group/measure/table/bar/line, saved pinned reports, UK tax-year bounds and optional property Self Assessment summary with Not tax advice.                                                                                                                                                                                                                                                                                                                                                      | Present                                                                                                      |
| FR-21 Search/views      | [Advanced search](../src/components/AdvancedSearch.tsx), [query parser](../src/domain/query.ts): shared conditions plus tags/kind/review/source/date/note, deterministic shorthand, saved pinned views, CSV and rule-from-filter.                                                                                                                                                                                                                                                                                                                                                                                                               | Present; pinned views remain visible outside expanded filter conditions                                      |
| FR-22 Notes/attachments | [Attachment service](../src/storage/attachments.ts), [attachment manager](../src/components/AttachmentManager.tsx), [storage usage](../src/components/StorageUsage.tsx): searchable notes, five local attachments, 1600px JPEG compression, PDF download, transactional references/Undo, include/exclude backup, quota warning/persistence request.                                                                                                                                                                                                                                                                                             | Present; local attachments and portable backups; physical camera remains a manual check                      |
| FR-23 FX                | [FX service](../src/analytics/fx.ts), CurrencySetting/reporting projection: all-account reporting conversion, exact rational money rounding, previous available daily rate, ECB cache/manual override, offline/stale state, original amounts/rate dates, manual cross-currency transfer confirmation.                                                                                                                                                                                                                                                                                                                                           | Present; indexed rates, all-account reporting/forecast scope and aligned CSP                                 |

## Cross-cutting requirements

- **Non-destructive persistence:** schema v3 adds tables and fields. [Database](../src/storage/database.ts)
  preserves prior schemas; [backup schema](../src/storage/backup-schema.ts) and
  [backup validation](../src/storage/backup.ts) validate references, integer money,
  links, split/refund invariants and portable attachments. Newer unsupported backups
  are rejected rather than partially loaded. [Shared backup limits](../src/storage/backup-limits.ts)
  bound both restore pickers and exports; plaintext export checks its serialized
  byte size before downloading and offers attachment exclusion when necessary.
  Device PIN/WebAuthn credentials stay local and survive restores.
- **Audit/Undo:** [local audit](../src/storage/audit.ts) records touched records with
  Dexie hooks, retains 90 days, preserves blobs and refuses Undo over a later
  conflicting edit or deletion of a referenced record. [Closed-period Undo](../src/storage/audit-month-closes.ts)
  protects current and restored dates, payday boundaries and refund purchase
  months; a grouped refund Undo can restore its original snapshot atomically.
  Security credentials never appear in portable audit/settings.
- **Safe deletion:** import-history deletion refuses to orphan a preserved
  manual refund's purchase link. Demo deletion retains real records, clears a
  mixed refund's incomplete allocation and marks it for review without turning
  it into income. It refreshes closed snapshots in the same auditable action.
- **Privacy/network:** `fx.ts` contains the only deliberate external application
  fetch. It requests a fixed public ECB table using GET, `credentials: omit`,
  `referrerPolicy: no-referrer`, and `redirect: error`. It has no request body,
  personal identifiers or transaction-dependent query parameters. Static PDF/OCR
  assets are same-origin. CSP must allow only self and `data-api.ecb.europa.eu`;
  Vercel headers, Cloudflare `_headers` and a GitHub-Pages-compatible meta policy
  share the same script and network restrictions. Response-only framing controls
  are unavailable through a Pages meta policy. Rate download approval is not
  permission to upload financial data.
- **Accessibility/performance:** touch controls target 44px, sheets/dialogs have
  names and keyboard alternatives, tables preserve labels, and reduced motion is
  respected. Physical VoiceOver and iPhone 12 timing measurements remain manual.
  Rate tables use a WeakMap date index and binary search. Automated 20,000-row timing and populated-cache measurements belong in the validation record; physical-device timing remains manual.
- **Scope:** no bank APIs, automatic bill cancellation, cloud financial sync,
  household files (FR-24), external AI or App Store/native onboarding is added.
- **Calendar correction:** the document's rate example calls 6 September 2026 a
  Saturday and 5 September a Friday. Those dates are Sunday and Saturday. The
  implementation must use calendar-correct prior available rates (Friday
  4 September), not hard-code the erroneous weekday labels.

## Acceptance evidence and remaining manual checks

Source review confirms that the earlier audit findings are now implemented:
range gating/history gaps, one-card first run, review-union sorting, refund source
links, linked pots, all-currency Home/insight projections, pre-commit transfer
review, rule-conflict scope, manual valuation freshness/currency guards,
period-change reopening, close-month coverage guards, aligned CSP, saved-view quick
filters, calendar price/account details and dated restore/backup thresholds.

These code findings do not certify final browser/device behaviour. The
[validation record](validation.md) owns consolidated unit/build/browser results,
network observations, hosting CSP and populated-rate-table timing. It also records
rendered UK copy/pluralisation, semantic-colour and large-text checks. Physical
iPhone, camera, platform authentication and assistive-technology checks remain
manual until performed on the named device. Optional at-rest database encryption remains deferred;
PIN/WebAuthn lock must never be described as encrypting local financial records.

## Automated validation state

This paragraph preserves the focused implementation-stage evidence. Consult
[validation](validation.md#current-recorded-results) for consolidated results;
historical focused totals must not be read as the release's complete test count.

Focused security, attachments, app-lock UI, closed-month and reporting-period
tests passed in the focused implementation run: 21 tests across seven files. They prove AES-GCM round trips/header tampering, wrong
passwords without storage access, random salts/IVs, PIN throttling, local signed
WebAuthn verification, financial UI withholding/background timeout, attachment
limits and atomic Undo, closed-month refusal/reopen, and original-month refund
snapshot updates with Undo. Period-setting tests prove Cancel performs no writes,
confirmed reopening changes settings/snapshots atomically, and one Undo restores
both. Calendar-export tests cover the next-month schedule, year boundary and
avoidance of past dates; their recorded execution is in validation. The shared audit service additionally refuses undoing a period change while
a newer month close exists.

[Security browser workflows](../tests/e2e/v2-security.spec.ts) are written for both browser projects. They cover
320/390px lock screenshots, `.feng` downloads, wrong-password/cancel no data loss,
and offline 1600px compression/attachment storage without HTTP requests.
Their final-build execution status is recorded in [validation](validation.md).
No production/physical-device pass is asserted here. Record consolidated unit,
browser, build, privacy, migration, performance and dependency checks there.

## Manual device and assistive-technology checklist

Test with fictitious data first. Keep an external backup before any real-data
migration or restore test. Use Safari on an actual iPhone and an installed PWA:

- Install through Share → Add to Home Screen; verify standalone launch, dark default,
  safe areas, app-switcher privacy, orientation and offline relaunch.
- At 320, 375, 390 and 430px, plus 150%/200% text, inspect position totals, cards,
  chips, charts, modal fields, sticky import footer and bottom navigation for overlap.
- Import PDF/CSV/OFX/QFX/QIF, including several files from Files. Check one picker,
  progress, failed reconciliation, manual mapping, duplicates/gaps, transfer review,
  confirmation and direct Home/Sort now return.
- Sort through suggestion tap/1–3, swipe, Skip, split, refund and inline tag create.
  Confirm queue advances, matching backfill is explained, and one Undo reverses
  selection/backfill/default rule. Test an existing-rule contradiction.
- On desktop ≥1100px, drag one/multiple selected transaction objects into the
  category rail; repeat with keyboard C/J/K/1–3 and `/`. Verify focus restoration,
  Escape, native text Undo and Cmd/Ctrl+Z application Undo.
- Enable PIN and Face ID/Touch ID. Cancel a biometric prompt, use fallback PIN,
  try incorrect PINs/cooldown, suspend for each configured delay and return.
  Confirm there is no financial-data flash before authentication.
- Export encrypted backups to Files/iCloud Drive with/without attachments. Open the
  file as text and confirm no merchants/amounts. Restore using wrong and correct
  passwords; Cancel preview, then explicitly replace. Confirm local authenticator
  settings and all records survive as documented.
- Add/search a note; choose a photo through Files and camera capture, plus a PDF.
  Check compression, fifth/sixth attachment limit, download, delete/Undo, storage
  warning and persistence grant/denial. Repeat offline.
- Add property, pension and mortgage values on distinct dates. Check manual/stale/
  estimated labels, stepped history, unchanged cash flow and safe currency edits.
- Add a £540 annual pot due 15 March 2027 on 1 October 2026; verify six contributions
  of £90. Link a savings account; confirm progress is automatic and earmarks are
  never deducted from cash. Test budget surplus and overspend rollover across
  reviewed/closed and provisional months.
- Complete the four review steps, close a month, attempt an ordinary edit and cancel
  Reopen. Then link a next-month refund and confirm the original closed snapshot
  updates with notice/Undo while its close remains intact.
- Inspect expected vs imported payments in Calendar, actual payday/date totals,
  edited cadence/end/ignore, a recurring price rise, Keep/cancel-planned reminder,
  and repeated unchanged price suppression. Export the monthly-review next-month
  reminder and verify its configured date and calendar alerts. A cancellation plan
  never cancels a bill.
- Compare debt avalanche/snowball/custom with a reference spreadsheet and verify
  paid-in-full cards. Add a £1,200 future scenario and confirm only projected
  balances change; saved scenarios survive reload/backup.
- Set a fixed 25th/payday month; verify every relevant Home/Analyse/budget/review
  date range and closure guard agrees. Test 6 April–5 April tax-year bounds,
  filtered CSV/split/tag fields, reports, tags, saved views and rule-from-search.
- Import a EUR account, inspect the public-rate notice, conversion/original amount
  and dated rate. Go offline, test weekend/holiday fallback, stale-rate warning,
  manual overrides and always-manual cross-currency transfer confirmation.
- With VoiceOver, navigate landmarks/headings, transactions, sorting actions,
  dialogs, calendar dates and errors. Check labels/values without relying on colour.
  Confirm focus never moves behind an open dialog and returns to its initiating object.
- Measure import/search/rule/transfer/Analyse latency on an iPhone 12 or comparable
  device with 20,000 fictitious transactions and a populated FX cache. Record actual
  timings and browser/device version; automated desktop timing is not an iPhone pass.
- Observe network requests: static assets and the single approved ECB public-table
  GET only. PDF text, bank identities, balances, notes, files and category data must
  never appear in URL, body, headers, telemetry or third-party requests.
