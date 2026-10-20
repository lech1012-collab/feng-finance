# Feng Finance

Feng Finance is a private, client-side personal-finance PWA. It turns Barclays,
Barclaycard, American Express and Revolut statements into traceable cash flow,
account balances and spending analysis. It runs as a website or installed web
app, including on iPhone Safari. No App Store onboarding or backend is required.

Financial records, parsing, categorization, notes, attachments and backups stay
on the device. The external data feature is an approved download of public
ECB exchange-rate tables. The request contains no financial records, account
identifiers, cookies or request body. There is no external AI, telemetry,
advertising, session replay, cloud synchronization or remotely accessible account.
Optional feedback opens an owner-configured form or email only when the user
chooses it; technical context contains no financial records.

## Beta

Feng is a beta. Check imported figures against the original statements before
relying on them; it does not provide financial advice. Start with **Explore with
demo data**, then install it from Safari's Share menu → Add to Home Screen → Add.
Installation help, storage status, What's new, Privacy and Send feedback are in
Settings → About and feedback.

Recognised digital layouts from Barclays current accounts, Barclaycard, American
Express and Revolut use their bank-specific readers first. When source rows,
balances and printed totals agree, review the summary and confirm once. The
generic PDF parser handles unfamiliar banks, unsupported layouts and scanned
statements. Native bank recognition does not require a generic profile or a
second generic reading of every row. Genuine native warnings remain in the
simple review. **Reading details → Review PDF layout** deliberately switches
to generic source correction if an amount or date needs changing.
Every layout still needs its own arithmetic checks; synthetic fixtures do not
certify every real statement variant. Questionable rows remain visible for
correction, and an unverified import requires an explicit override.

Records belong to the browser or installed app where they were imported. The
developer cannot see or recover them. Save backups outside that browser/device.
Feedback is optional and opens after a privacy warning. It includes technical
context, with optional diagnostics redacted locally. Never send real statements
or screenshots containing real figures.

See the [beta test plan](docs/beta-test-plan.md) and
[feedback configuration](docs/feedback-configuration.md). The public source
retains the rights stated in [LICENSE](LICENSE); dependency licences are unchanged.

The [v2 implementation matrix](docs/v2-implementation.md) maps the developer
specification to source code and verification. The
[v2.2 amendment matrix](docs/v22-implementation.md) covers the generic parser and
beta safeguards. Read the
[security notes](docs/security-v2.md), [privacy audit](docs/privacy.md) and
[validation record](docs/validation.md) for limitations and current release checks.
The [final-polish report](FINAL-POLISH-REPORT.md) checks the designer's 44 blockers
and 205 additional findings, with a [140-state journey guide](docs/final-polish-journey.json),
seven browser setups, actual before/after screenshots and element dimensions.
The [earlier implementation record](docs/ux-v225-review.md) remains as historical
context for v2.2.6.

The [2.2.7 beta review downloads](https://github.com/lech1012-collab/feng-finance/releases/tag/v2.2.7)
include a single mobile HTML review with embedded images, seven smaller setup ZIPs
and the complete audit. All review screenshots contain fictitious records.
The [standalone mobile review](https://github.com/lech1012-collab/feng-finance/releases/download/v2.2.7/Feng-Finance-2.2.7-Mobile-UX-Review.html)
can be downloaded and opened in a desktop browser without unzipping anything.
Physical iPhone, VoiceOver and owner/beta-round checks remain separate release gates.

## Development

Node 24 LTS and npm are recommended.

```sh
npm ci
npm run fixtures
npm run dev
```

Open the printed development URL. Start empty, select a generated synthetic PDF
from `tests/fixtures`, or choose **Explore demo**. Demo records are fictitious and
identified separately; **Delete demo data** preserves real records. Development
mode does not install a service worker. Use a production build and preview to
test offline installation.

```sh
npm test                         # Domain, adapters, storage, migrations and UI
npm run build                    # Strict TypeScript and static production PWA
npm run preview                  # Production preview on port 4173
npx playwright install --with-deps chromium webkit
npm run test:e2e                  # Browser workflows, including mobile viewport
npm run test:a11y                 # 161 demo screen states; keep preview running
npm audit                        # Dependency vulnerability review
npm run check                    # Unit tests, build and browser tests
npm run check:repo                # Reject statements, exports and secrets in Git
npm run check:release             # Package, app and changelog versions match
npm run test:hygiene              # Staged-path and release-metadata guard tests
```

Generate fixtures before running browser tests. `npm ci` copies the local PDF,
OCR, English-language, font/CMap and decoder assets and generates PWA icons. No
CDN or API key is needed for parsing. Wait for **Offline ready** after installation
before disconnecting. Physical iPhone checks are documented separately in the
[iPhone checklist](docs/iphone-checklist.md); Playwright WebKit is not an iPhone.

## Everyday workflow

1. On Home, Import opens the file picker directly. Select several PDFs together,
   or use **Select statements** on Import. Desktop also accepts dropped files.
2. Feng checks files locally and presents one batch: ready, needing attention
   and skipped. Reconciled statements stay closed. **Add statements** appends
   more files without clearing corrections; cancelling keeps the batch.
3. Review exceptions one statement at a time. **Review next statement** focuses
   the next unresolved file. Statement figures, all transactions and reading
   settings open on demand. A file can be left out and included/rechecked later.
   Possible duplicates stay excluded by default. Uncertain amounts require their
   own correction or confirmation; categorisation can wait. Optional transfer
   linking stays available without becoming another mandatory review step.
4. **Confirm import** saves the batch once and returns Home. Failed balances,
   incomplete pages and invalid source values retain their original gates.
   Importing unverified figures requires a separate explicit confirmation;
   acceptance never makes those figures reconciled. **To review** includes both
   uncategorised and categorised-but-unreviewed transactions.
5. Sort the remaining records, then use the four-step monthly review to inspect
   changes, confirm pot contributions, review rules/backups and close the month.

Unknown CSV layouts open a mapping preview. Map date, description and either a
signed amount or separate debit/credit columns, choose the account and confirm.
Mappings are remembered per account. Exports without opening/closing balances
remain explicitly unverified; missing balance evidence is not invented.

### Sorting, rules and review status

Tap a transaction to open its sorting sheet. Suggested categories include a
reason and are ranked from local rules, prior choices and description clues.
There are also Transfer, Card repayment, Refund, Split and Tag actions. Saving
advances the queue; Skip leaves the record to review. Uncategorized records leave
that filter immediately after saving a category. The broader To review filter
also includes records that have a category but still need confirmation.

On desktop, drag the transaction itself onto a category in the drop rail. Batch
selection and sorting remain available. Keyboard shortcuts include **C** to sort,
**1–3** for suggestions, **J/K** to navigate, **/** for search and **⌘/Ctrl Z** for
category Undo outside text fields. Inputs retain their native Undo. Touch drag
uses Pointer Events; scrolling or dropping outside a category does not save.

A manual category choice automatically creates or updates the default for that
original merchant, account and money direction. No separate remembering button
is needed. Rename actions retain the original bank identity for matching. Rules
support all/any conditions, descriptions, accounts, directions, amounts, dates,
currencies and advanced regular expressions. Actions include categorization,
rename, tags, reviewed state, transaction kind, percentage splits and recurring
series. Priority, stop-processing and single-use behavior are explicit. Preview
matching records before applying a rule to history. Contradicting an existing
rule provides an Update rule/Just this payment choice.

New data operations record local changes and provide Undo. Bulk operations undo
as one change. Undo refuses to overwrite newer edits or delete an account, tag,
category or source record still used by later records. Recent changes are kept
locally for 90 days. **Erase everything** removes the database, including its
history; export a backup first because the host cannot recover erased data.

### Money, transfers, credit cards, refunds and splits

Every persisted monetary amount is a safe integer in its original currency's
minor units. GBP `-8245` means **-£82.45**. Money entering an account is positive;
money leaving is negative. Credit-card amounts owed are negative balances,
presented as positive **Card debt**. Original amounts are never rewritten by
categorization, conversion, refunds or planning. Statement reconciliation uses
source ledger rows. New PDF imports require exactly zero difference; a one-penny
difference requires review. Historical statements keep their original status.

Import both the bank and card statements. Categorize individual card purchases;
classify the repayment as **Card repayment**, so it does not count again as
spending. A repayment alone cannot reveal its underlying purchase categories.
Account-to-account top-ups use **Transfer**. Confirmed transfers and card
repayments remain in account balances and statement Money in/Money out, but are
excluded from income, spending and net cash flow.

Transfer matching defaults to **Manual**. Candidates have opposite amounts,
different accounts and compatible dates within the configurable 0–7-day window
(default four). Pending proposals are shown for confirmation and make the period
partial. Optional **Automatic** only confirms an unambiguous exact match within
two days; cross-currency matches always require confirmation. Changing the
setting does not reinterpret existing confirmed history. One-sided transfers can
be marked explicitly when the other account is outside Feng. Undo or unlinking
restores both sides consistently.

A refund stays dated when it arrived but reduces the original purchase's month
and category spending. It never becomes income. Link a credit to one or several
earlier purchases, allocating its entire amount exactly; partial reimbursement
of a purchase is supported. Total refunds cannot exceed the purchase. A refund
of a split purchase reduces its category lines proportionately. Linking a refund
to a closed month updates that snapshot with a notice, rather than silently
changing its arrival date or requiring that original month to be reopened.

Split a mixed purchase into 2–20 category lines. The lines must equal the original
to the penny before saving. Analytics, budgets and reports use the children;
statement counts, balances and reconciliation use the original parent once.
Unsplit restores one transaction. No child can be mistaken for another movement
on the source statement.

## Screens and planning

- **Home:** dated cash/card debt/net-worth position, monthly income/spending/net,
  prioritised To do items, category spending, pots, cash-flow history, upcoming
  payments and data health. Figures distinguish complete, partial, unverified
  and missing data. Missing history is a gap, not zero; comparisons require
  verified evidence at both endpoints.
- **Transactions:** account chips, Needs review/Uncategorised and the requested
  category shortcuts, indexed date/account filters, advanced search, saved views,
  bulk review, tags, manual entries, sorting and source detail. Other filters open
  in a sheet; saved views are quick chips. Category, type and tag edits save
  immediately with Undo. Display-name edits retain original bank text. Notes are
  searchable. Up to five local image/PDF attachments can be added; images are
  resized to at most 1600 pixels before storage.
- **Analyse:** one month/range drives cash flow, income/spending/category trends,
  averages, sample deviation, income percentage, comparisons and evidence.
  Category overviews include Property without a redundant Home property card.
  Reports group by category, tag, account, merchant or month, with sums, counts,
  averages, charts and CSV. UK tax-year/property presets are optional and are not
  tax advice.
- **Planning:** Budgets, Pots, Calendar and Debt, with temporary What-if scenarios.
  Budgets support no rollover, surplus-only or both signs. Open-month carry is
  provisional. Goals and sinking pots show targets, contributions, due dates and
  monthly need. Earmarks do not subtract cash a second time.
- **Settings:** appearance, reporting currency/rates, reporting-period rule,
  transfers, categories/rules/tags, security, reminders, storage, backups, recent
  changes and explicit data-deletion options. Mobile Home stays in the middle of
  navigation; desktop Settings stays at the sidebar bottom.

Manual property, vehicle, pension, investment, loan, mortgage and other assets or
liabilities use dated valuations. Liabilities subtract their positive magnitude
from net worth. Freshness reminders are configurable; estimates remain labelled
Estimated until replaced by an actual valuation or statement. Charts use dated
steps and preserve unknown periods. Editing a manual account cannot relabel old
valuation history into another currency.

Calendar entries distinguish expected recurring payments from actual imports.
Recurrence depends on observed evidence and can be confirmed, edited, ended or
ignored. Subscription review highlights a rise of at least 5% or one currency
unit against the previous three-charge median and suppresses repeat alerts at
that same price. Keep dismisses that change; Cancel planned creates a reminder.
Feng cannot determine usage or cancel a service. Complete cancellation with its
provider and check future imported charges.

Debt planning compares avalanche, snowball and custom order using balances,
APR, minimum payments and the available monthly amount. Assumptions, including
monthly interest, are shown; provider fees, rate changes and exact daily-interest
contracts can differ. What-if changes only a saved projection, never actual
transactions or balances. Forecasts are conditional estimates with explicit
missing-data limits, not available-cash guarantees.

Choose a calendar month, fixed start day (1–28) or detected salary/payday period
in Settings. Home, budgets, review and Analyse share those period bounds and show
the actual dates. Closing creates a snapshot and guards subsequent edits with a
Reopen choice. Complete, reviewed periods may optionally auto-close after 60
days; incomplete periods do not qualify. Refunds use the explicit original-month
exception. Changing a period rule handles existing closed snapshots explicitly.

## Reporting currency and offline rates

Settings → **Reporting currency** replaces the old account-currency filter.
GBP, EUR and other supported account currencies can contribute to the same
report. Original transaction, statement and account-detail amounts remain in
native currency. Converted figures show **≈** and expose the rate/date.

ECB rates are downloaded only from `data-api.ecb.europa.eu` with a fixed public GET.
Daily transactions use that date's rate or the most recent prior available
business-day rate. Cross rates go through EUR. Rates are cached in IndexedDB,
backed up and used offline; dated manual overrides work without a download.
Conversion uses exact decimal/rational arithmetic and rounds only at the final
minor unit. Missing rates remain unknown; stale rates are labelled with their
date and an Update action rather than claimed as current. Weekend/holiday
fallback follows the actual calendar, not a hard-coded weekday example.

## Architecture and persistence

```text
src/domain/           Typed models, integer money, dates/periods, fingerprints and queries
src/storage/          Dexie, atomic services, local audit/Undo, backup/restore and demo
src/import/           Validation, PDF/OCR and data-file pipelines, review and atomic commit
src/parsers/          Independent Barclays/Barclaycard, Amex and Revolut adapters
src/categorization/   Shared rule conditions/actions and local category suggestions
src/transfers/        Matching proposals; manual confirmation is the default
src/analytics/        Ledger projections, refunds/splits, coverage, FX, reports and planning
src/security/         Local PIN/WebAuthn and encrypted backup cryptography
src/components/       Accessible shared controls, editors and chart representations
src/pages/            Home, Import, Transactions/detail, Analyse, Planning and Settings
scripts/              Static runtime assets and generated synthetic PDF fixtures
```

Routing uses hash URLs, so static hosting needs no application server rewrite.
PDF.js runs its own worker; OCR uses a local Tesseract worker and English model.
Bank detection uses several signals. Text is reconstructed from positions into
rows and columns. Bank-specific readers are preferred only when the detected
issuer, every financial occurrence, printed balances and movement totals agree.
Unfamiliar or unproved layouts use the generic parser's competing column and sign
readings. Bank profiles supply hints; running balances and printed totals supply
proof. Explicit column mappings and source corrections always use that generic
review. A proved digital bank layout does not trigger numeric OCR unnecessarily.
Wrapped descriptions, repeated dates, signs, totals and statement periods have
regression fixtures. Local OCR handles unusable text, with numeric-cell retry
where arithmetic identifies a suspect value. Row-level review retains source
evidence and optional saved layouts; templates still require fresh validation.
Source text is rendered through React text nodes, never unsafe imported HTML.
Original import PDFs are held in memory through review and released afterward;
they are not persisted. Optional raw diagnostics are off by default, remain local
and retain only the last five imports. Shared diagnostic exports replace every
cell with a placeholder.

Statement SHA-256 hashes detect exact reimports. Transaction fingerprints and
occurrence/balance evidence protect regenerated and overlapping imports without
silently removing legitimate identical purchases. Cross-format matching also
checks already imported PDF/data-file rows. Imports recheck current history in
the write transaction and roll back as a group on failure. Manual entries remain
separate from statement reconciliation and require explicit replacement review
when a later statement may contain the same payment.

Indexes cover dates/currencies/accounts, fingerprints, merchants, split parents,
transaction kinds/tags, recurring due dates and dated valuations/rates. The
explorer paginates rather than rendering the entire ledger. Whole-history
analysis/backup/export still reads the relevant local dataset; do not claim an
actual iPhone performance result from desktop test timings. Audit hooks capture
touched records rather than copying all 20,000 transactions for a single edit.

### Backup, restore and schema versions

Portable JSON remains readable, including older schema versions:

```json
{
  "format": "feng-finance",
  "version": 1,
  "schemaVersion": 4,
  "moneyUnit": "minor",
  "exportedAt": "2026-10-08T12:00:00.000Z"
}
```

The full file additionally contains accounts, statements, transactions,
categories, rules, transfer links/settings, valuations, pots, monthly budgets,
tags, recurring series, closed months, rates, proposals, saved views/reports,
scenarios, saved import layouts and local audit history. Raw import diagnostics
and migration safety backups are local-only and omitted. Attachments are portable
base64 descriptors; export can omit them and removes their references from the
exported copy.
Local PIN hashes, salts, platform credential IDs and other `security:` settings
are excluded, including audit snapshots. Restore keeps the current device's lock
configuration; moving devices requires configuring that device's lock.

Settings → Backup and restore provides one **Save backup** wizard, protected by
default with a confirmed password of at least 12 characters. Restore accepts old
JSON and `.feng` files, including older eight-character passwords.

Use an encrypted **`.feng`** backup for a portable protected copy. It uses
AES-GCM-256, PBKDF2-SHA256 with 600,000 iterations and fresh random salt/IV.
The authenticated header carries format/version/date/encryption metadata, not
financial records. Restore requests the password before preview. A wrong password
writes nothing. Forgotten passwords cannot be recovered by Feng or its host.
Plain JSON remains available for compatibility and is a sensitive unencrypted
file; save it only to a protected location.

Restore validates versions, identifiers, safe integer money, references,
currencies, statement counts, exact split sums, refund allocations, transfer
links and portable receipt bytes before replacing data. A newer schema is
rejected with an Update instruction. Replace restore requires explicit UI
confirmation and runs atomically. Preview and cancellation leave existing data
untouched; save a current backup first to preserve it before replacement. Merge is not supported.

IndexedDB schema 1 is preserved. Schema 2 added merchant/review metadata. Schema
3 additively introduces v2 tables and optional fields, retaining legacy amounts,
original descriptions, account IDs, rules and links. Existing confirmed transfers
are not retrospectively unlinked by the new manual default. Migration tests open
old databases and restore old-format backups without resetting financial data.
Schema 4 adds import layouts, optional diagnostics and local migration recovery.
A pre-update safety snapshot keeps the previous data for 14 days; it is separate
from a portable backup and is not uploaded. Restore previous data requires
confirmation because changes made after the update will be replaced.
It restores original keys, receipt bytes and prior lock settings atomically while
keeping the current additive database schema. Exact recovery does not immediately
rewrite old records with new defaults or perform automatic financial maintenance.
No parser failure or version check automatically clears the database.

For repeat-import testing, export a backup, then Settings → Danger zone → **Delete imported
records**. Accounts, categories, learned rules and plans remain; manual entries
are retained. Reimport and compare every row against the source. **Erase
everything** also removes categorization memory, plans, attachments and the local
lock. The web host has no recovery copy. Browser/profile/origin changes have
separate databases; use backup/restore to move records.

## Installation, reminders and deployment

The static deployment is [Feng Finance](https://lech1012-collab.github.io/feng-finance/).
See [deployment instructions](docs/deployment.md). `dist/` is deployable through
GitHub Pages, Cloudflare Pages or Vercel. GitHub Actions validates changes before
Pages publishing. All production assets are static; no server secret is needed.

On iPhone: open the HTTPS URL in Safari → **Share** → **Add to Home Screen** →
enable **Open as Web App** → **Add**. Launch from the icon. Wait for Offline ready,
then test airplane mode. The service worker offers a user-controlled Reload;
it does not replace application code midway through import. The reload banner
appears on Home after current editing and review have finished.

Settings reminders work while Feng is open. Exported `.ics` events let an existing
calendar show review alerts while the web app is closed, without a notification
server or native app. Events are generic and omit merchant names, amounts and
account information. Calendar alert support varies; verify calendar permissions
and remove old exported events there when preferences change. Feng does not
promise background monitoring or push notifications while closed.

Each release has a matching `vAPP_VERSION` Git tag and bundled What's new entry.
CI checks version metadata and repository hygiene before publishing; normal pull
requests do not need a tag. Verify the release commit with
`npm run check:release -- --require-tag` after creating its tag.

A custom domain can use an owner-supplied `public/CNAME` and `VITE_BASE_PATH=/`.
The project URL builds at `VITE_BASE_PATH=/feng-finance/`. Changing origin creates
separate browser storage; move records using an exported backup and explicit
restore rather than expecting an automatic transfer.

## Private fixtures and limitations

Put real statements only in ignored `private-fixtures/` and select them locally.
Never commit real PDFs, extracted text, backups, account identifiers, screenshots
or traces containing financial records. Generated fixtures and demo data are
fictitious. If a real layout exposes a bug, create a synthetic regression and
extend its profile or parser tests without weakening validation. To add a bank,
provide detection/header/sign hints and synthetic period/layout/balance tests;
both the bank reader and generic fallback must continue to require source evidence.

CI checks tracked repository paths. Where no custom hook is configured, npm also
installs a pre-commit guard. PDFs and CSVs may only be committed under
`tests/fixtures/synthetic/`, and must contain fictitious data. The guard inspects
paths rather than contents and also blocks private fixture folders, backups and
secrets. `.env.example` contains public configuration names; private `.env` files
are ignored and blocked.

- Synthetic adapters do not prove support for every historical bank layout.
  Warnings and explicit source review remain essential; offsetting extraction
  mistakes can still reconcile mathematically.
- Current PDF adapters reject zero extracted rows. A genuinely reconciled
  balance-only statement is valid at storage/review level, but unsupported empty
  PDF layouts are never assumed to mean zero spending.
- English digital/OCR statements; password-protected PDFs must be unlocked
  locally. Multi-account/currency PDFs may need separate exports. PDF limits are
  30 MB and 100 pages. OCR can take time and memory on phones.
- Optional app lock deters casual access. PIN/WebAuthn and app-switcher cover do
  **not** encrypt IndexedDB at rest. Optional database-at-rest encryption from
  FR-7.4 is deferred; encrypted portable backups are implemented. Protect the
  device/browser and maintain backups. Physical Face ID, VoiceOver, iOS Files,
  camera, installation, large text and service-worker updates need real-device
  testing.
- No Open Banking, cloud sync, household sharing, AI assistant or automatic
  movement/cancellation of money. Property reporting is cash flow, not accrual,
  depreciation or a guaranteed tax treatment. Plans depend on imported evidence.

## v2.2.8 Import workflow

This update is limited to Import: preserved multi-file batches, exception-first
review, fewer repetitive decisions and bounded mobile text. Bank readers,
financial calculations, reconciliation policy and database schema are unchanged.
The [design handoff](docs/import-ux-redesign.md) explains the incumbent patterns
and acceptance criteria. The [implementation review](docs/import-ux-implementation-review.md)
records reviewer corrections, screen evidence and verification limits.

## v2.2.7 verified UX beta

[The final-polish report](FINAL-POLISH-REPORT.md) records all 44 blockers and 205
findings, the approved scope exceptions, test results and remaining manual gates.
The review covers 140 actual UI states on seven setups, with matching before and
after screenshots, exact element dimensions and workflow explanations.

[Download the review files](https://github.com/lech1012-collab/feng-finance/releases/tag/v2.2.7).
The single HTML review embeds its screenshots and works without a server.
The complete audit ZIP contains every setup, raw measurements, visual receipts,
Lighthouse reports and verification logs. Smaller setup ZIPs open at `index.html`.
Only fictitious demo and synthetic test data is included.

Repayment-plan and debt-term drafts now save on **Done**, discard closed edits
and retain Undo. The unset theme follows System; saved appearance choices remain.
PIN/passkey changes use confirmation without credential Undo, as approved by the
owner. Lock-delay changes retain Undo. Physical iPhone/VoiceOver, hardware, beta
volunteer and owner sign-off checks remain separate gates; this is a beta.

## v2.2.6 UX review

[The review implementation record](docs/ux-v225-review.md) maps all 44 blockers
and 205 screen findings to shared controls, financial safeguards and verification.
Dark remains the owner-selected default. Native Barclays, Barclaycard, Amex and
Revolut parsing remains ahead of generic source review. Database schema 4,
parser version 2.2.3 and portable backup version 1 remain unchanged.

## v2.2.9 Amount correction

Uncertain import amounts open a fixed editing sheet with the original PDF row,
Money in / Money out controls and strict precision checks. Bank-reader transactions
can open source correction directly. Saving a correction rechecks the statement;
financial records are written only after Confirm import. See the
[workflow, safety rules and mobile verification](docs/import-amount-correction.md).

## v2.2.10 Import correction and resume

Tap the displayed transaction amount itself to open the same correction panel
for native-bank and generic source review. The Amount field accepts ordinary
keystrokes, including incomplete decimals while typing; Save amount validates
precision and rechecks the statement. Source proof and financial import guards
remain unchanged.

A selected batch stays in memory while navigating between tabs, including
corrections, category choices and expanded statements. Import resumes pending
work; Add statements appends PDFs. Discard review explicitly clears only the
unsaved review. Final confirmation returns Home and releases source resources.
Pending imports prevent update reloads. Reloading, closing Feng or an app-lock
remount clears unconfirmed memory-only PDFs; no original statements are persisted.

The [designer-to-developer handoff](docs/import-session-ux-handoff.md) records
the diagnosis, intended journey, interaction sizes and verification contract.
Browser regressions use actual taps and sequential keystrokes, not only value
replacement, and inspect inner text scrolling as well as page width. Physical
iPhone keyboard, Safari/PWA touch and VoiceOver checks remain manual beta gates.

## v2.2.11 Focused batch review

After checking multiple statements, Import opens **Needs attention**. Ready,
duplicate and saved statements remain part of the batch but are hidden from
that view; **All statements** reveals their details. Counts, reconciliation,
duplicate checks and the final save always use the entire batch.

An active corrected statement remains visible until Continue or closing its
card takes you to the next exception or the final summary. Confirmation is a
compact section at the end of the page, so it scrolls with the review instead
of covering the screen. A completed duplicate-only review returns Home and
releases its temporary sources without changing stored financial records.

The [UX designer's developer handoff](docs/import-batch-focus-ux.md) records the
review states, control labels, interaction sizes and verification requirements.

## v2.2.12 Guided statement corrections

Import exceptions now offer a single Review statement action. A focused modal identifies the account first, then shows one transaction at a time with its local PDF crop and a manual amount field. Save and continue rechecks the figures; alternative readings and parser controls remain under optional Statement details. Financial acceptance and import gates are unchanged. See [the guided workflow and review](docs/import-guided-review-ux.md).

## v2.2.13 Missing card identity recovery

A supported digital card statement with an unread identifier now enters the account-identification step with its bank, card type and currency preserved. An explicit account confirmation keeps the source amounts and balances with the native reader. The missing printed identifier keeps the statement labelled unverified; valid amounts need no separate re-entry. No account is saved before the import is confirmed.
