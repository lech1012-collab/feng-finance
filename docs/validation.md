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

Version 1.9.2 closes observable gaps remaining after the original UX review:
negative spending bars use valid painted SVG geometry below a visible zero
baseline; missing/zero months remain distinct. Restore-count layouts support
narrow and enlarged-text views, and invalid backup messages remain actionable
without exposing imported text or raw validation diagnostics. Failed validation
leaves every database table unchanged.

Sorting tests cover restored queue progress and pending records after Undo,
text-field keyboard Undo, and desktop action/amount geometry. Import review tests
cover arithmetic-reconciled statements still blocked by changed parsing options,
invalid dates/amounts, kept duplicate acknowledgements and batch rechecks. The
header and confirmation use the same blocker source. No schema migration or
financial-record rewrite is introduced.

The keyboard sorting check waits for an enabled suggested category and focuses
the current rendered target before sending its shortcut. This prevents a stale
dialog or unfinished React update from being mistaken for a failed save; the
check still dispatches once and awaits the real atomic database write.

Version 1.9.1 corrects the distinction between a proven closing balance and
complete monthly history. Issue-date-only Barclaycard periods and older Amex
purchase dates no longer hide a reconciled closing debt. A known unverified
closing figure stays visible with its date and reason, but cannot enter verified
aggregates or history. Older snapshots remain dated; future closings are not
backdated. Home uses the latest closing or activity month after import and on
initial launch. Closing-only card statements supply chart points without invented
daily balances, and comparison controls require two distinct statement dates.
Monthly coverage, spending, transfers and baseline eligibility stay unchanged.

Regression tests use actual synthetic Barclaycard and UK Amex PDFs, reload saved
imports, verify positive card debt and transaction chips, and remove a stored row
to ensure its reported figure remains visible while verified debt/net/history are
withheld. Parser-to-storage tests independently cover amounts, row counts,
identities, currencies, dates, overrides and rounding tolerance. No financial
record migration or reimport is required.

Version 1.9.0 implements the UX review with verified cash/card/net balances,
explicit missing-data states, synchronized analysis periods, combined statement
review, automatic category defaults, mobile sorting queues, desktop batch drag
and atomic Undo. Settings now records backup exports, previews restores and
requires typed confirmation for a full erase. Tests cover these workflows,
large text, mobile layouts and category-rail scrolling. Mixed verified/unverified
source imports cannot enter comparison baselines; observed partial chart totals
match recorded KPI totals. Card-only income and custom periods outside source
coverage remain unavailable rather than appearing as zero.

IndexedDB remains at schema version 2. Optional categorization provenance and rule
usage fields preserve existing records and older backups. Processing and storage
remain local; deployment contains static assets only.

The GitHub Pages release was checked on 8 October 2026 using fictitious statements
only. The published app opened the file picker directly, accepted Barclays, Amex
and Revolut PDFs together, reconciled each statement, and returned to Home after
one confirmation. Recorded income, expenses and net cash flow matched the fixture
totals. The EUR account view hid GBP accounts instead of mixing currencies; mobile
layout and the desktop category rail and bottom Settings navigation were checked.
Import requests contained no uploads or external requests.

A separate browser kept the previous live version 1.8.4 open with ten saved
synthetic transactions. Its Update button installed version 1.9.0 and preserved
every transaction field unchanged. These browser checks supplement the 311 unit
and component tests, 76 Chromium/WebKit checks, production build and dependency
audit. Physical iPhone checks remain in the manual checklist. A timing-sensitive
keyboard test now awaits the real atomic IndexedDB save and Undo operations,
rather than applying a one-second database polling limit under CI load.

Version 1.8.4 separates statement money movement from personal cash-flow metrics.
Import labels Money in/Money out sum every extracted row, including transfers and
excluded duplicate rows. Synthetic tests verify card repayment inclusion, incoming
transfers, currency isolation, safe precision, unchanged analytics and browser
statement totals before/after a duplicate import. No private statement values are
used in committed fixtures.

Version 1.8.3 removes remembering controls and automatically saves every manual
category/transfer assignment through sorting, transaction details, transfer linking
and import review. Latest account/direction-scoped exact rules win; demo rows are
excluded. Import-review flags are not persisted as financial data. Tests cover a
later category correction replacing the default, reviewed PDF correction memory,
backup validity, preserved merchant identity after renaming, category-name badges
and absence of transaction arrows. The optional sourceMerchant field preserves
existing IndexedDB records and remains compatible with older JSON backups; there
is no destructive migration.

Version 1.8.2 makes merchant memory the default in direct sorting and transaction
details, with an explicit one-off opt-out and account/direction-scoped exact rules.
Delete imported records atomically clears statements, transactions and transfer
links while retaining accounts, categories, rules and settings. Tests reproduce a
fictional direct debit categorized as Childcare, delete/import/reload, rule scope,
backup restore, full reset and one-off behavior. The detail editor workflow also
verifies persistence through same-PDF reimport. No financial amounts or existing
records are changed by installation; no schema migration is needed.

Version 1.8.1 unifies financial direction for income filters, salary categorization,
detail edits and categorization rules. Tests cover positive Salary/other income with
stale expense labels, negative debits, every transfer marker, account/currency
isolation, unchanged fingerprints/amounts, Undo and identical reconciled balance
history before/after metadata edits. Browser tests import a fictional £3,726 salary,
£500 other income and £100 debit: income £4,226, net £4,126 and closing balance
£5,126. Salary/Income filters remain correct after injecting a legacy type mismatch.

Version 1.8.0 adds the separate Planning page with currency-scoped category budgets,
recurring-payment estimates and conservative balance forecasts. Tests verify exact
minor-unit limits, overspending/unbudgeted totals, baseline coverage, interval and
amount evidence, cancellations/transfers/currency isolation, negative card balances,
stale snapshots, missing rows, scenario ordering, observed-payment deduplication
and horizon changes. Browser checks import three synthetic months, save/reload a
budget, change months and horizons, check the timeline and navigation, and resize
the page at mobile/desktop widths. Existing backup settings preserve budgets without
a schema migration or reset.

Version 1.7.0 adds local deeper insights and reminders. Tests cover complete-month
baseline gating, spending drivers, income drops, merchant medians, currency and
transfer isolation, recurring-price/overlap warnings, reminder cadence and stale
history, configuration persistence and generic calendar exports without financial
identifiers. A four-month synthetic import workflow verifies the explanations,
direct reminder file picker, calendar download and disabling reminders after reload.
No database reset, AI API, native app or notification backend is introduced.

Version 1.6.1 adds a Transfer drop/tap tile to the sorting popup. Storage tests
check incoming/outgoing transfer classification, cleared spending categories,
cash-flow exclusion, remembered rule account scope and atomic Undo. The desktop
browser workflow drops a row onto Transfer and checks both the filtered queue
and resulting dashboard totals. No category schema or database reset is needed.

Version 1.5.2 connects Home's 1/3/6/12-month selector to dated balance history and
its percentage baseline. Verified daily movement includes transfers, while missing
rows, failed reconciliation and conflicting overlap suppress reconstruction.
The Home import workflow checks a visible balance curve, period switching, removal
of Browse all categories and desktop Settings placement. The Barclaycard workflow
imports both the bank debit and card repayment and verifies that neither inflates
spending. Existing records are preserved; there is no schema migration or reset.

- **359 unit/storage/parser/component tests**: exact currency and date parsing, normalization/hashing, legitimate duplicate occurrences, rule ordering/ranges/account constraints, transfer matching and ambiguity, reconciliation cases, cash flow/property/monthly aggregation/comparison/recurrence, backup schema/reference validation and round trips, atomic imports/races, editing, v1→v2 migration, indexed retrieval with 20,000 persisted rows, labeled month controls and monetary formatting at safe-integer boundaries. Dated balance reconstruction tests cover transfers, selected ranges, missing rows, reconciliation failures, conflicting overlap and shared comparison endpoints. Category suggestion tests cover rules/history priority, description clues, archived categories, direction, unknown descriptions, property rollup and transfers.
- **88 browser checks**: forty-four workflows each in Chromium and Playwright WebKit, primarily at 390 × 844; desktop dragging is tested at 1440 × 900. Actual digital/scanned PDF fixtures, multi-bank import, rule correction/reimport, exact/regenerated duplicates, transfer totals, EUR isolation, explicit reconciliation override, backup/restore/demo deletion, unavailable-origin offline reload/import/export, local OCR offline, navigation/property/analysis, explicit service-worker update with preserved database, invalid PDF with unchanged records. Desktop checks drag directly from a row into a suggested tile, verify queue removal and Undo, and cancel a drag with Escape without modifying data.
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

## Version 1.2.0 direct transaction sorting

Added transaction-card swipe/tap sorting, pointer-driven drag/drop onto category tiles, immediate save, next-card progression, grouped merchant assignment and exact account-specific learned rules. Atomic category operations preserve dates, amounts, fingerprints and transfer status; stale selections and concurrent changes block mutation. Undo checks both records and any newly added rule before restoring them. Tests cover group boundaries, properties/subcategories, unchanged cash-flow totals, stale edits, undo, swipe entry, actual pointer drag/drop, cancelled drags, keyboard use and rule application to a later PDF. Month selectors support swipes and the import surface accepts PDF drops. Supplementary browser checks exercise emulated touch swipes and drops and verify the sorting sheet at 320, 390 and 430 pixels with 100% and 200% text sizing. No schema reset or new network service is involved.

## Version 1.3.0 subscription review centre

Local evidence detection covers weekly, monthly, quarterly and annual cadence, known-service candidates, material price increases, account/currency isolation, refunds/transfers, stale observations, multiple-account warnings and charges after a user-recorded cancellation. Decisions use hashed settings keys and are preserved by the existing backup format without a schema reset. Browser tests exercise Home discovery, swipe-to-plan, cancellation guidance, persisted decisions, evidence drill-down and mobile overflow. No provider cancellation or background notification is claimed.

## Version 1.3.1 Barclays grouped-date extraction

Barclays transaction rows with blank date cells inherit the preceding valid transaction date within the table, including continued pages. Wrapped references remain attached to their own transactions; undated description/amount line splits are supported. Orphan rows, invalid dates and missing amounts produce explicit warnings. Page furniture is excluded, and printed gross credits/debits are checked independently of balance reconciliation. Synthetic coordinate and two-page PDF regressions exercise these cases. A supplied private PDF was independently read and every saved dated amount checked against it locally, without adding private fixtures to the repository. Existing imported records are not silently rewritten.

## Version 1.4.0 category context and page palettes

Added reusable category overviews, sample standard deviation, six/twelve-month baseline controls, source drill-down, income ratios, property metrics and subcategory navigation. Coverage uses merged statement intervals across the same currency's account set and excludes inferred/failed statement periods. Tests distinguish zero activity from missing coverage, partial periods, zero income/variance, >100% ratios, transfers, currencies and property children. Home removes its duplicate Property tile and exposes all category overviews. Browser checks cover central Home navigation, page palettes, income-share switching and mobile category layouts. Brand and page styling use no green accent, including generated PWA icons.

### 1.4.1 mobile proportions

Mobile spacing uses a rounded golden-ratio scale (5, 8, 13, 21, 34, 55px).
Cards, headings, metrics, category tiles and review controls share this rhythm.
The Home percentage selector uses content-sized labels rather than stretching
across the card. Controls retain a minimum 44px touch height; text can grow with
accessibility settings. Golden-ratio sizing governs hierarchy and spacing, not
mandatory aspect ratios for financial charts or minimum readable text.

### 1.4.2 navigation consistency

The active navigation tab and page palette use one section mapping. Category,
property and subscription screens belong to Analyse; transaction details belong
to Transactions. Only the active section has `aria-current="page"`. The central
Home icon retains its position but only uses the selected fill on Home. Unknown
URLs redirect to Home. Property analysis has an explicit return to Analyse.
Browser coverage checks every route, direct links, and back/forward navigation.

### 1.4.3 global currency preference

Currency selection lives in Settings and persists in IndexedDB, including backups
and restores. GBP and EUR are always offered, plus currencies from imported
accounts. Imports no longer change this preference. Home, transaction search,
category statistics, property analysis and subscriptions share the preference;
original transaction currencies remain unchanged and amounts are never converted
or combined across currencies. Browser coverage checks separate GBP/EUR totals,
reload persistence, backup inclusion and removal of per-page selectors.

### 1.5.0 import workflow, account balances and transaction queue

Home and Import navigation invoke a continuously mounted native file input from
inside the user gesture, preserving iOS file-picker activation. Selected files are
passed to the importer, consumed once, and processed sequentially. Final commit
returns Home with a local confirmation. The uncategorized queue spans all dates,
excludes transfers and removes saved rows; editor navigation preserves its filter.
Status labels and main-category buttons make categorization state explicit.

Seven balance-domain tests cover credit liabilities, future/missing snapshots,
stale history, account/currency coverage, zero and negative baselines, failed
validation, and 1/3/6/12-month change mathematics. Browser regressions cover the
native picker, immediate Home return, multi-month uncategorized queue, both editing
paths, main category filters, category analysis selection and property sorting.
Home charts omit value tables; expense bars are negative with separate colours.
Account metadata moved to Transactions. The iPhone checklist covers real Files
activation and touch chart interactions, which require a physical device check.

### 1.5.1 focused transaction shortcuts

Transactions offers exactly Uncategorized, Groceries, Income, Property and Salary
as quick filters. Income selects income transactions; Property includes costs and
property income. Tapping the selected shortcut clears it. Other categories remain
available in the detailed Filters selector. Existing browser coverage verifies the
five shortcuts and their results against fictitious demo records.
