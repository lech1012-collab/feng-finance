# Version 2.2 implementation and validation record

This release implements the 8 October 2026 developer specification and its v2.2
amendment. It remains a React/strict TypeScript/Vite/Dexie application with local
PDF.js/Tesseract processing and static PWA hosting. Application version **2.2.6**
uses additive IndexedDB **schema 4**. Portable JSON backup format remains
**version 1**; supported older databases and backups are migrated without resetting
financial records.

## Release evidence

### UX review update, v2.2.6

The [designer review implementation record](ux-v225-review.md) covers 44 blockers
and 205 additional findings. Shared sheets, Undo notifications, grouped Settings,
read-only account balances, compact charts and transaction controls are included.
New backup exports are protected by default; older JSON and encrypted backups
remain compatible. Refund suggestions and loan payment requirements are stricter,
and missing FX rates withhold totals while retaining original amounts. Database
schema 4, portable backup format 1 and parser version 2.2.3 remain unchanged.

The local candidate passed **981 unit/component tests in 122 files**, a WCAG audit
of **161 screen states** with zero reported violations or document overflow, and
Lighthouse accessibility **100** / best practices **96**. Dependency audit reported
zero vulnerabilities. The complete production browser suite contains **178 cases**
across Chromium and WebKit. The release workflow must pass every case before Pages
deploys its exact verified commit. The release Actions linked below record final
browser and deployment results; the GitHub release notes record preserved-data
and cold offline verification after publication.

To repeat the accessibility audit, build the app, keep `npm run preview` running,
install Playwright Chromium, and run `npm run test:a11y`. It creates isolated
fictitious demo contexts, never reads a personal browser profile, and writes
technical findings under ignored `test-results-accessibility/`. It checks 23
pages at 320px/390px in dark and light modes, 390px at 200% text in both modes,
and 1280px desktop. This checks WCAG rules and document overflow, not every
visual alignment or physical assistive-technology behavior.

Physical iPhone/Safari/VoiceOver, three real devices, the owner checklist and
volunteer beta feedback remain manual sign-off gates. Automated WebKit results
do not certify real iPhone installation, file pickers, Face ID or storage eviction.

The upgrade baseline for this release is **v1.9.2**. The v2.0.0 source/tag did not reach production: its CI browser checks
found a narrow WebKit layout issue and an offline receipt Undo issue. Those fixes
are included in v2.2. A tagged source commit is not evidence of a completed deployment.

The authoritative consolidated results are recorded on the release commit in
[verification Actions](https://github.com/lech1012-collab/feng-finance/actions/workflows/ci.yml)
and [Pages Actions](https://github.com/lech1012-collab/feng-finance/actions/workflows/pages.yml).
Match the successful runs' SHA to the release tag; Pages builds that exact verified
commit. The local checks below were recorded while preparing the candidate and
do not replace that gate. Live preserved-data upgrade is checked after publication.
Physical iPhone acceptance remains separate even when automated checks pass.

The v2.2.0 release passed [its complete CI run](https://github.com/lech1012-collab/feng-finance/actions/runs/38281554978)
and [exact-commit Pages deployment](https://github.com/lech1012-collab/feng-finance/actions/runs/38283398312).
The live update from v1.9.2 then exposed a release-dialog race: closing What's new
could reopen it before the saved preference reached the live query. Patch v2.2.1
suppresses stale preferences only after acknowledgement succeeds; failed saves
remain retryable and About can still reopen release notes. This patch changes no
financial calculations, parser version, database schema or migration.

Version 2.2.1 subsequently passed [868 unit/component tests and 162 browser cases](https://github.com/lech1012-collab/feng-finance/actions/runs/38286536435)
and [Pages deployment](https://github.com/lech1012-collab/feng-finance/actions/runs/38288425757).
The preserved live profile passed explicit update, exact financial-record and
native safety-copy comparison, one-time release-note acknowledgement, and fresh
offline document navigation/reload with no JavaScript errors.

Version 2.2.2 restored a streamlined bank-specific route for recognised digital
Barclays, Barclaycard, Amex and Revolut layouts. Selection requires exact statement
and printed movement totals, all available running-balance anchors, valid dates
and occurrence-preserving coverage of every financial source row. It runs before
numeric-cell OCR or saved-layout inference. Unknown banks, unproved or changed
layouts, OCR and deliberate mapping/corrections retain generic source review.
The weaker net-only legacy fallback has been removed.

A wrapped regulatory footer in the available original Barclays PDF caused a
false source row and unnecessary amount checks. A narrowly bounded footer rule
fixes it without ignoring similar merchant text or malformed financial values.
The original PDF was independently compared locally with the final draft and
committed ledger; no original PDF, extracted financial values or private screenshots
enter the repository. Earlier original Amex, Revolut and Barclaycard PDF bytes are
unavailable in this workspace, so their preserved synthetic layouts are tested;
those results do not claim a fresh run of the unavailable original files.

Bank-reader financial edits retain source-snapshot and printed-gross checks.
Offsetting amount errors, changed dates/balances and missing occurrences cannot
be committed by accepting a net-zero reconciliation. UI corrections recheck the
generic source; category, merchant, tag and confirmed-transfer edits remain direct.
This patch changes no database or backup schema and does not relabel older imports.

Version 2.2.3 removes the remaining generic prerequisite. A supported digital
bank adapter is selected before generic profile detection, layout templates or
numeric OCR. Its independent source snapshot checks account identity, dates,
currency, printed gross movements, ledger occurrence counts, running balances
and exact closing arithmetic. Bank warnings remain in the simple review instead
of triggering generic amount verification. Genuine discrepancies still block
confirmation until reviewed; an override remains Unverified. Unsupported layouts,
unknown banks and scans retain generic review. Reading options explicitly opens
that route for source corrections, which must be rechecked before committing.
Financial source fields are read-only in native review; categories, merchant
names and transfer choices remain editable. No database or backup migration is
introduced, and previous imports are not relabelled.

Issuer detection also accepts explicit legal footer names and issuer domains
when a PDF logo is graphical. Counterparty bank names in ledger rows remain
excluded. Tests deliberately spy on generic parsing/profile detection to prove
that known bank recognition no longer calls either one.

## Implementation scope

- Dated cash, card debt and manual net-worth balances with complete, partial,
  unverified and unavailable coverage; unknown history remains a gap, not zero.
- Manual-default transfers, confirmed card repayments, original-month refunds,
  exact splits, reviewed status, remembered categorization and explicit rule history.
- PIN/WebAuthn app lock, encrypted `.feng` backups, local notes/attachments and
  atomic audit/Undo. App lock does **not** encrypt IndexedDB at rest.
- Assets/liabilities, pots, rollover budgets, tags, manual entries, monthly review,
  recurring costs, debt/what-if planning, reports and locally cached reporting FX.
- Generic positioned-text PDF reconstruction, bank hints, exact arithmetic,
  local whole-page/cell OCR, source crops, row correction/exclusion, column mapping
  and reusable layouts. Ambiguous or incomplete imports require explicit review.
- Beta notice, installation guidance, honest storage status, backup reminders,
  owner-configured feedback, safe manual updates and local pre-migration recovery.

See the [v2 matrix](v2-implementation.md) and
[amendment implementation matrix](v22-implementation.md) for source mappings.
[Privacy](privacy.md) lists expected requests; [security](security-v2.md) explains
local-lock and encrypted-backup boundaries. Database-at-rest encryption remains
explicitly deferred.

## Recorded v2.2.3 patch checks

- The complete unit/component suite passed **962 tests in 117 files** in CI.
  The final bank/identity changes also passed **97 focused local tests**.
  Release CI repeats the full suite against the exact published commit.
- **24 mobile browser cases passed** across Chromium and WebKit: all four
  recognised banks in a single-confirmation batch, HSBC generic review,
  independent card debt, inherited dates, genuine reconciliation/period warnings,
  and explicit generic source correction preserving a manual category choice.
  **Two additional browser cases passed** for a one-penny native warning and
  deliberate source correction in Chromium and WebKit. Confirmation remains
  blocked until the corrected source figures match exactly.
- Strict TypeScript/production PWA build passed; **441 precache entries**.
  Formatting, release metadata and repository guards passed; **9 Node guard
  tests** passed. Dependency audit reported **0 vulnerabilities**.
- The full browser suite contains **170 cases**. Exact-commit CI must pass
  every case before Pages deploys. Focused local checks do not replace this gate.
- A preserved installed profile was checked before publication: original
  financial fields and native migration safety records/keys remain unchanged.
  The explicit update and cold offline launch are checked after deployment.

The available original Barclays PDF passed the actual UI workflow in both
engines against an independently recorded ledger: every date, amount and printed
balance matched, with one confirmation, no amount acknowledgements, no JavaScript
errors and no prohibited network requests. The other three original
PDFs remain unavailable; their synthetic layouts cover native detection and
signs but do not claim a fresh original-file comparison. Private statements,
figures, screenshots and traces remain outside Git and release CI.

## Recorded v2.2 verification

Automated checks on 12–13 October 2026 use fictitious data only. The separate
private original-PDF comparison stays local. Focused passing checks below
do not substitute for a consolidated run against the final release commit.

| Check                                      | Recorded result                                                                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/component suite                       | **909 tests passed in 114 files** locally for v2.2.2. v2.2.1 CI passed 868 tests in 111 files. The patch release gate repeats the full suite.                                                                                                           |
| Production build                           | Passed strict TypeScript and Vite; **441 precache entries**, approximately **22.5 MiB**. The final source is rebuilt in release CI.                                                                                                                     |
| Beta browser acceptance                    | **18 passed** across Chromium and WebKit: notice acknowledgement, native picker gesture, installation policy, feedback/privacy and safe update lifecycle.                                                                                               |
| Migration and local OCR browser acceptance | **14 passed** across Chromium and WebKit: original keys/PIN/receipt bytes preserved, exact recovery, stopped-origin OCR, source crops, cancellation and one-penny correction.                                                                           |
| Financial write/update guards              | **10 passed** in three focused files, including held and rejected writes, concurrent writes and audit/closure behavior.                                                                                                                                 |
| Full Chromium/WebKit browser suite         | **168 cases configured** for v2.2.2, including six new known-bank/generic/error workflows. v2.2.1 CI passed all 162 prior cases. Patch release CI repeats every case against its own production build and blocks Pages on any failure.                  |
| Dependency audit                           | `npm audit --audit-level=moderate`: **0 vulnerabilities**. Repeat if dependencies change.                                                                                                                                                               |
| Repository/release guards                  | Repository and release metadata checks passed; **9** Node guard tests passed. The release-tag CI job requires matching package, application and changelog versions.                                                                                     |
| GitHub Pages and live upgrade              | v2.2.1 passed exact-commit CI and deployment. The preserved fictitious profile retained original **v1.9.2 / schema 2** records after migration to schema 4 and explicit v2.2.1 update/offline launch. v2.2.2 publication retains the same release gate. |
| Physical iPhone/Safari acceptance          | Manual; browser emulation does not certify installation, Files, Face ID, VoiceOver, eviction or device timing.                                                                                                                                          |

The v2.2.2 targeted browser checks passed **six new routing cases** and **14
existing affected cases** across Chromium and WebKit: supported-bank batch import
with one confirmation, HSBC generic review, card debt, inherited dates,
out-of-period rows, failed reconciliation and one-penny correction. The available
original Barclays PDF also matched every independent ledger date, amount and
printed balance through the actual UI in both engines. One confirmation returned
Home without amount acknowledgements or prohibited requests. The other original
PDF bytes remain unavailable; no private source data enters CI or the repository.

The browser suite independently compares PDF rows, native signs, gross Money
in/Money out, opening/closing balances and resulting analytics. It covers
Barclays, Barclaycard, Amex, Revolut, unfamiliar layouts and alternative data-file
imports. Profile hints must not classify a statement from a payee's bank name.
Repeated page headings and separate card-table panels have dedicated regressions.

New PDF imports require **zero minor-unit difference**. A one-penny discrepancy
requires correction or explicit unverified acceptance. Historical imports retain
their recorded validation policy. A valid posting date may explain a purchase
outside the displayed period; rows whose purchase and posting dates are both
outside it require review. Neither dates nor amounts are invented to reconcile.
Duplicate insertion exclusions still participate in source reconciliation.
Fully resolved OCR rows with exact proof may be confirmed; ambiguous OCR remains
in review. Total-checked card rows are not represented as individually
balance-checked.

Home reads accounts, statements, transactions and supporting dashboard records
inside one readonly IndexedDB transaction. This gives each displayed snapshot a
consistent committed view, rather than mixing a statement balance from one commit
with transactions from another. Regression checks cover Home after PIN unlock,
component remounts and live refresh following a financial edit.

Native persistent-profile checks cover schema 1/2/3 upgrades to schema 4, raw
structured-clone recovery and receipt access after deletion of the original Blob.
The independent safety copy preserves bytes, keys and prior lock settings.
Restore replaces later changes atomically, keeps the current additive schema and
reloads. It is not a database-schema downgrade or an off-device backup.

Layout coverage includes 320/375/390/430px, desktop and 200% text. WebKit native
select sizing and delayed chart resizing are checked without concealing overflow.
Offline receipt tests use a fresh persistent profile because Linux WebKit
ephemeral contexts reject native IndexedDB Blob writes. Stopping the HTTP origin
checks offline use without blocking local Blob URLs.

Privacy checks inspect actual digital/OCR workflows and local attachment/backup
actions. OCR workers, English model, decoders and PDF fonts come from bundled
same-origin assets. Public-rate requests use one fixed ECB GET with no cookies,
body or financial parameters. Optional feedback opens only after the user's
privacy warning/choice; its technical context and redacted diagnostics contain no
financial readings. No external AI, financial telemetry or background upload is
implemented.

## Final release checks

1. Run the consolidated unit suite and strict build on the final source, then all
   168 browser cases in both engines. Record exact totals and resolve failures.
2. Verify upgrades, exact recovery, portable backups, encrypted backups and receipt
   references. Invalid/newer backups must fail before any replacement write.
3. Independently compare imported rows and gross movements with synthetic source
   PDFs. Check overlaps, identical purchases, profile/payee confusion, malformed
   dates, one-penny discrepancies, missing pages and unverified overrides.
4. Check transfer/split/refund composition, closed-month safeguards, period changes,
   missing FX, native amounts and Undo dependencies.
5. Inspect narrow/large-text layouts, keyboard/dialog focus, desktop dragging,
   negative expenses, category navigation and meaningful gaps in history.
6. Stop the asset origin and verify digital/OCR import, sorting, attachments and
   backup. Audit actual host CSP and request hosts after publication.
7. Pass repository/release guards and dependency audit. Publish the verified source
   without private fixtures, create its matching version tag and deploy only static
   assets from that exact commit.
8. Update a preserved older tab/profile using the explicit update control. Verify
   v2.2.2/schema 4, untouched prior financial records, pre-migration safety recovery,
   complete offline assets, one-time release-note acknowledgement and an offline
   relaunch. A safety snapshot created during the v2.2.0 migration retains that
   original version metadata during schema-neutral patches.
9. Complete the [physical iPhone checklist](iphone-checklist.md) before making
   device-specific installation, performance or accessibility claims.

## Historical evidence

The earlier v2 source passed **626 unit/component tests** in 77 files and a strict
production build with 436 precache entries. Its CI browser failures prevented
publication; those results are not a v2.2 release pass.

A historical fictitious desktop benchmark used **20,000 transactions and 40,800
FX rates**: first conversion **63.7 ms**, verified twelve-month aggregation
**144.0 ms**. It does not certify iPhone performance or the amendment's OCR/text
timing targets. Actual device timings remain manual.

[Version 1 validation history](validation-v1.md) preserves checks for named older
releases, including the deployed v1.9.2 baseline. Its currency filtering and older
automatic payment classification are superseded by v2 reporting conversion and
manual-default transfer proposals. Historical totals must not be presented as
results for new source.
