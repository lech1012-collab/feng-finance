# Implementation and validation record

Implemented as a React / strict TypeScript / Vite static PWA with Dexie, PDF.js, local Tesseract, Recharts, Vitest/Testing Library and Playwright. No application backend or external financial-data service is present.

## Completed engineering phases

1. Foundation: responsive React shell, hash routing, manifest/icons, offline cache, versioned IndexedDB, unit/browser tooling.
2. Data model: minor-unit money, accounts/statements/transactions/categories/rules/transfer links, atomic storage, demo, backup and restore.
   3–6. PDF engine and three adapters: file hashing/limits, coordinates, rows/columns, header detection, periods/accounts/currency, separate current-account and Amex liability semantics (including unpaired card repayments as transfers), generated bank fixtures.
3. OCR: local English worker/model, scanned-page rendering and word coordinates, lower confidence and explicit acknowledgement.
   8–9. Protection and categorization: statement/transaction duplicates with balance and occurrence evidence, concurrency checks, conservative transfers/manual links, deterministic rules, reviewed merchant history and correction rules.
   10–12. Product UI: monthly dashboard, currency selector, transaction filters/detail, property/annual/YTD/custom analysis, trends, comparisons, recurring suggestions and settings.
4. Hardening: monetary boundaries, restore/reference checks, migration coverage, indexed 20,000-row test, browser workflows, unavailable-origin offline tests, update lifecycle test, CSP/static configurations, vulnerability audit and documentation.

## Automated checks

- **146 unit/storage/parser/component tests**: exact currency and date parsing, normalization/hashing, legitimate duplicate occurrences, rule ordering/ranges/account constraints, transfer matching and ambiguity, reconciliation cases, cash flow/property/monthly aggregation/comparison/recurrence, backup schema/reference validation and round trips, atomic imports/races, editing, v1→v2 migration, indexed retrieval with 20,000 persisted rows, labeled month controls and monetary formatting at safe-integer boundaries.
- **28 browser checks**: fourteen workflows each in Chromium and Playwright WebKit at 390 × 844. Actual digital/scanned PDF fixtures, multi-bank import, rule correction/reimport, exact/regenerated duplicates, transfer totals, EUR isolation, explicit reconciliation override, backup/restore/demo deletion, unavailable-origin offline reload/import/export, local OCR offline, navigation/property/analysis, explicit service-worker update with preserved database, invalid PDF with unchanged records.
- Production TypeScript/Vite build and local offline precache generation; static output includes PDF worker/fonts/CMaps/WASM and English OCR assets.
- `npm audit`: zero known vulnerabilities in installed production and development dependencies at verification time.
- Prettier formatting check and manual visual inspection of generated-data dashboards at 390 and 1440 pixels.

The browser test-only static host applies the configured security headers. Offline tests **stop the origin server** before reload/import rather than use network interception: Playwright WebKit's simulated `setOffline` and route abortion bypass its service worker. With the origin actually unavailable, digital and scanned PDF imports work from the local cache in both browsers. The host rejects non-GET methods and stores no request data. The privacy observer additionally rejects external requests, non-GET methods and request bodies.

The update test advances only the test host's service-worker bytes, waits for the update banner, taps Update, observes a reload and verifies all 133 demo records still exist. It caught and corrected a first-session Workbox issue: `isUpdate` can be false for a newly registered worker, so explicit updates now own the native `controllerchange` reload. Unrequested worker changes do not discard a user's draft.

## What the tests establish and do not establish

| Requirement                          | Evidence / remaining release check                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Static, private financial processing | No server/API/telemetry; offline imports and same-origin-only request audit pass. Inspect deployed response headers too.                                                                         |
| Supported digital PDFs and OCR       | Generated fixtures pass through actual PDF.js and OCR in Chromium/WebKit. Historical real bank layout variants still need local validation.                                                      |
| Financial correctness/data integrity | Integer mathematics, signs, transfer exclusion, reconciliations, duplicate/race protection, atomic imports/restores and migration tests. Human review remains required for uncertain extraction. |
| iPhone PWA installation/safe areas   | Manifest, icon, standalone settings, safe-area CSS and WebKit viewport tested. Actual Add to Home Screen and native Files integration require `iphone-checklist.md`.                             |
| Offline dashboard/import/backup      | Both browsers pass against a stopped static origin; all parsing assets are precached. Real iOS storage eviction remains outside the app's control.                                               |
| Service-worker updates               | Automated prompt→explicit update→reload→preserved-records test. Verify a real deployed version upgrade on iPhone.                                                                                |
| 20,000 transactions                  | Indexed-storage test, date-window queries and 60-row pagination. This establishes architecture/functional capacity, not an on-device latency guarantee; measure with the real-device checklist.  |
| Deployable production output         | Production build, provider configs and detailed Vercel/Cloudflare/GitHub Pages instructions. Published to GitHub Pages; live digital import and offline Chromium checks passed.                  |

## Operational release steps

Deploy `dist/` to HTTPS, complete the real-iPhone checklist, locally compare every transaction/sign/balance from representative private statements, and retain a backup before the first real import. Record layout differences using synthetic regressions; never commit real PDFs, backups, screenshots or traces. This is a complete local implementation with automated validation; it is not a claim that every bank layout or iOS version has been certified.

## Version 1.0.1 statement-layout update

Added dedicated two-column Barclaycard GBP parsing, liability signs, repayment transfers, refund handling, foreign references and source-date provenance. An issue-date-only statement shows explicitly labeled transaction coverage and requires acknowledgement; it does not claim an unprinted period start. Added wrapped/unlabeled Barclays header range detection and a reviewed date-entry fallback, with no database reset or schema migration. Private-layout checks run locally with outbound requests blocked; committed regressions use fully fictional statements only.

## Version 1.0.2 Amex and Revolut layout update

UK Amex coverage includes the late first-page period, membership label, tabular liability summary, month-first transaction/process dates, separate-line CR/DR, multiline merchants, foreign-reference amounts, repeated purchases, and transactions below common footer assumptions. UK Revolut coverage includes a migration cover, statement currency headings, account-number priority over IBAN, split summary headings, repeated transaction headers and actual footer boundaries. Gross credits/debits are checked independently of net balance reconciliation. Out-of-period source dates and proposed Amex payment transfers require acknowledgement. No database schema change or reset is needed. Both supplied private layouts are checked locally without recording screenshots or traces; only fictitious coordinate/PDF fixtures are committed.

## Version 1.1.0 financial review and mobile workflow

Compared uploaded statements independently using a separate PDF text extractor, then checked every dated amount and both balances against the app's actual exported records. The independent audit found no transaction amount or balance differences. Classification corrections are delivered in a private, local rules file, not embedded in public code. The app provides a previewed atomic apply operation for the device's existing records and retains rules for subsequent imports. Tests use different, fictitious merchants and amounts; no real financial fixture, output, screenshot or personal rule is committed.

Dark is now the default, with a persistent light option. Mobile navigation keeps Import accessible. Import prioritizes extraction exceptions and keeps all transactions editable; existing reconciliation and duplicate acknowledgements remain required. The overview opens on the latest imported activity month, shows dated account balance snapshots and excludes comparisons across different imported account sets. Analysis has inclusive, validated custom dates, separated rolling totals and layouts checked at 320, 390, 430, 768 and 1440 pixels. Browser checks cover saved appearance, toolbar overlap, horizontal overflow, personal corrections and rules reused by future PDF imports. Native iPhone checks remain manual.
