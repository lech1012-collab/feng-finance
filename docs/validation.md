# Version 2.2 implementation and validation record

This release implements the 8 October 2026 developer specification and its v2.2
amendment. It remains a React/strict TypeScript/Vite/Dexie application with local
PDF.js/Tesseract processing and static PWA hosting. Application version **2.2.1**
uses additive IndexedDB **schema 4**. Portable JSON backup format remains
**version 1**; supported older databases and backups are migrated without resetting
financial records.

## Release evidence

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

## Recorded v2.2 verification

Checks on 12 October 2026 use fictitious data only. Focused passing checks below
do not substitute for a consolidated run against the final release commit.

| Check                                      | Recorded result                                                                                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/component suite                       | **868 tests passed in 111 files** locally for v2.2.1, including three release-dialog regressions. v2.2.0 CI passed 865 tests in 110 files. The patch release gate repeats the full suite.                                                         |
| Production build                           | Passed strict TypeScript and Vite; **441 precache entries**, approximately **22.5 MiB**. The final source is rebuilt in release CI.                                                                                                               |
| Beta browser acceptance                    | **18 passed** across Chromium and WebKit: notice acknowledgement, native picker gesture, installation policy, feedback/privacy and safe update lifecycle.                                                                                         |
| Migration and local OCR browser acceptance | **14 passed** across Chromium and WebKit: original keys/PIN/receipt bytes preserved, exact recovery, stopped-origin OCR, source crops, cancellation and one-penny correction.                                                                     |
| Financial write/update guards              | **10 passed** in three focused files, including held and rejected writes, concurrent writes and audit/closure behavior.                                                                                                                           |
| Full Chromium/WebKit browser suite         | **162 cases passed** in v2.2.0 CI. Patch release CI repeats every case against its own production build and blocks Pages on any failure.                                                                                                          |
| Dependency audit                           | `npm audit --audit-level=moderate`: **0 vulnerabilities**. Repeat if dependencies change.                                                                                                                                                         |
| Repository/release guards                  | Repository and release metadata checks passed; **9** Node guard tests passed. The release-tag CI job requires matching package, application and changelog versions.                                                                               |
| GitHub Pages and live upgrade              | v2.2.0 is deployed after exact-commit CI. The preserved fictitious profile updated explicitly from **v1.9.2 / schema 2** to **v2.2.0 / schema 4**. Patch publication is followed by explicit v2.2.1 update, record comparison and offline launch. |
| Physical iPhone/Safari acceptance          | Manual; browser emulation does not certify installation, Files, Face ID, VoiceOver, eviction or device timing.                                                                                                                                    |

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
   162 browser cases in both engines. Record exact totals and resolve failures.
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
   v2.2.1/schema 4, untouched prior financial records, pre-migration safety recovery,
   complete offline assets, one-time release-note acknowledgement and an offline
   relaunch. A safety snapshot created during the v2.2.0 migration retains that
   original version metadata during the schema-neutral v2.2.1 patch.
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
