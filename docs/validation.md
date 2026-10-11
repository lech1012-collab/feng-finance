# Version 2 implementation and validation record

The current work implements the 8 October 2026 developer specification in release
order R0–R3. The application remains React/strict TypeScript/Vite/Dexie with local
PDF.js/Tesseract and static PWA hosting. Version 2 uses non-destructive IndexedDB
schema 3; legacy schema-2 records and JSON backup version 1 remain supported.

## Implementation scope

- Trustworthy coverage and dated cash/card/manual net-worth balances; unavailable
  figures stay distinct from zero and comparisons require appropriate coverage.
- Manual-default transfers, confirmed card repayments, original-month refunds,
  exact splits, reviewed status, explicit rules/provenance and alternative imports.
- Optional PIN/WebAuthn app lock, encrypted `.feng` backups, local notes/attachments,
  storage estimates/persistence request and local audit/Undo.
- Manual assets/liabilities, mortgage estimates, pots, rollover budgets, tags,
  manual entries and four-step monthly review with closed-month safeguards.
- Recurring calendar/price-rise alerts, financial-month selection, debt planning,
  scenarios, portable reports/search and approved local-cached reporting FX.

The complete requirement map and outstanding acceptance checks are in
[the v2 matrix](v2-implementation.md). [Privacy](privacy.md) documents the fixed ECB
request and local processing. [Security](security-v2.md) makes clear that app lock
is not local database encryption. Optional at-rest encryption is deferred; no
unsupported guarantee is made. Physical-device checks remain required.

## Current recorded results

Release verification on 9–11 October 2026 uses fictitious data only. The
626-test unit/component run and strict production build passed. Browser checks
cover 65 workflows per engine; the CI workflow repeats both engines and blocks
Pages publication until the same source commit passes.

| Check                                                                        | Recorded result                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                   | **626 passed**, 77 files; 98.93 seconds                                                                                                                                                                                                              |
| Schema-2 upgrade and legacy backup restore                                   | Passed in the full suite; financial IDs, amounts, rules and references preserved                                                                                                                                                                     |
| Splits/refunds/transfers and reconciliation                                  | Passed, including generated minor-unit invariants, cumulative penny refunds, ambiguity and closed-month safeguards                                                                                                                                   |
| Security, attachments, audit and closed snapshots                            | Passed, including signed WebAuthn verification, PIN/background locking, tampered/wrong-password backup refusal and atomic Undo                                                                                                                       |
| Whole-batch automatic transfer review                                        | Passed unit regressions: competing third-file match remains pending; explicit rejection persists; old unrelated pairs are not linked                                                                                                                 |
| `npm run build`                                                              | Passed strict TypeScript and Vite; 436 offline-precache entries, about 22.4 MiB                                                                                                                                                                      |
| Consolidated Chromium/WebKit browser suite                                   | 65 workflows per engine exercised; corrected offline/layout/backup regressions and all final rules/security checks passed in both engines. CI repeats all 130 on the release commit                                                                  |
| `npm audit --audit-level=moderate`                                           | **0 vulnerabilities**, repeated on 11 October before publication                                                                                                                                                                                     |
| ECB endpoint and CORS                                                        | Actual public endpoint returned HTTP 200 and `access-control-allow-origin: *` for the deployment origin; 44,380 public rows, about 9 MiB                                                                                                             |
| GitHub Pages release and upgrade                                             | Exact-commit CI → Pages gate; post-publication smoke checks verify version 2.0.0, schema 3, CSP, explicit update and preserved records from the live v1.9.2 baseline. Run results are recorded in GitHub Actions and the release verification output |
| Physical iPhone Safari/standalone Face ID/Files/camera/VoiceOver/performance | Manual; emulation is not device certification                                                                                                                                                                                                        |

The financial suite covers exact signed source money, split parents retained in
bank reconciliation while children feed analytics, refunds reducing the original
purchase month rather than new income, closed-month reopen/Undo, overlapping
statement duplicates and legitimate identical purchases. Changing reporting
currency never changes native amounts. Manual cash-wallet balances include ledger
movements older than the chart's analysis window.

The browser workflows cover PDF/digital/OCR and CSV/OFX/QFX/QIF, direct picker and
Home return, remembered categorization after import deletion, category counts,
desktop/mobile sorting, transfer confirmation/rejection, manual assets/pots/debt/
scenarios, monthly review, rules/reports/search, backup and offline attachments.
Layout checks include 320/375/390/430px, desktop and 200% text. Mobile
navigation labels remain on one line and its height stays below 20% of the viewport;
full accessible link names are retained. Generated screenshots
are diagnostic artifacts, not real statement images. WebKit receipt tests use a fresh
persistent profile because Linux ephemeral contexts reject native IndexedDB Blob
writes; stopping the test origin verifies offline access without the runner
blocking local Blob URLs.

A measured synthetic desktop benchmark used **20,000 transactions and 40,800 FX
rates**: first conversion **63.7 ms**, verified twelve-month aggregation **144.0 ms**.
The rate index uses binary lookup and the aggregation reuses projected rows. These
measurements do not certify the under-300-ms requirement on a physical iPhone;
rule/matching and actual-device timings remain in the manual checklist.

Privacy tests inspect requests during local digital/OCR import and offline
attachment compression/backup. They also verify the one fixed ECB GET, without
body, cookies or transaction/account parameters. App lock withholds financial UI
until authentication; it does **not** encrypt IndexedDB at rest. Optional local
vault encryption remains explicitly deferred. Password-protected portable `.feng`
backups are encrypted and authenticated before replacement preview.

## Release validation checklist

1. Run focused tests after each affected change, then a consolidated strict build,
   full unit suite and both Playwright engines. Capture exact commands/results.
2. Exercise upgrade from schema 2 and old backups with signed amounts, categories,
   rules, account IDs, fingerprints and card balances preserved. Reject invalid or
   newer backups before writing; inspect link/split/refund/blob references.
3. Import synthetic Barclays/Barclaycard/Amex/Revolut PDFs and CSV/OFX/QFX/QIF.
   Independently compare gross money movement, signs, rows, balances and displayed
   analytics. Test overlap/same-day legitimate duplicates and manual replacements.
4. Check finance composition: transfer+split rule conflicts, partial refunds,
   closed-month changes, period-change Undo after later closure, FX/manual override,
   split children vs parent ledger and local audit dependencies.
5. Inspect 320/375/390/430/desktop layouts and 150%/200% text, keyboard/dialog focus,
   deterministic chart geometry, negative spending, meaningful missing history,
   dark/light themes and semantic category colours.
6. Test unavailable-origin digital/OCR import, notes, attachments, cached FX and
   backup. Inspect requests: self/public ECB only, GET only, no file/personal data
   in headers, body or URL. Check actual host CSP, not just source configuration.
7. Check 20,000-row indexed transactions, bulk rule/matching/reporting performance,
   including first-use FX table indexing. Record real iPhone timing separately.
8. Run dependency vulnerability checks. Verify service-worker explicit update,
   preserved financial records and offline precache completeness.
9. Deploy static assets to HTTPS, confirm actual application/schema versions,
   complete the [manual device checklist](v2-implementation.md#manual-device-and-assistive-technology-checklist)
   and retain a backup before testing real layouts locally.

## Historical baseline

[Version 1 validation history](validation-v1.md) preserves previous version-specific
checks, including the deployed v1.9.2 baseline. Those results apply to those named
releases, not to new v2 code. Currency filtering and conservative automatic
payment classification in older releases are superseded by v2 reporting conversion
and manual-default transfer proposals. Historical test totals must not be presented
as the v2 result.
