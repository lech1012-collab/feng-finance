# Feng Finance

A client-only personal-finance PWA for importing monthly Barclays (including Barclaycard), American Express and Revolut PDF statements. Financial information stays in IndexedDB in the browser. The deployment contains only static assets; there is no backend, account login, external AI, telemetry or cloud sync.

## Run locally

Node 24 LTS and npm are recommended.

```sh
npm ci
npm run fixtures
npm run dev
```

Open the printed development URL. Start empty, import one of the generated PDFs from `tests/fixtures`, or choose **Try fictitious demo data**. Delete demo data in Settings. Fixtures contain no real financial information and are generated, not committed. Development mode does not install a service worker; use the production preview for offline tests.

```sh
npm test                   # Domain, adapters, storage, migrations and components
npm run build              # Strict TypeScript and static production PWA
npm run preview            # Production preview, port 4173
npx playwright install --with-deps chromium webkit
npm run test:e2e           # 390 × 844 workflows in Chromium and WebKit
npm audit                  # Full dependency vulnerability check
npm run check              # Tests, build and browser tests (generate fixtures first)
```

`npm ci` also copies the locally hosted OCR runtime, English language model, PDF font/CMap/decoder assets and generates PWA icons. All parsing assets are included in the service-worker precache. No CDN is needed. The first offline installation downloads approximately 22 MB; wait for **Offline ready** before disconnecting. The OCR model is English.

## Features

- Monthly net cash flow, income, expenses, category bars, property summary, account freshness and deterministic comparisons.
- Digital PDF extraction with positional row/column reconstruction, independent bank adapters, scanned-page local OCR and explicit validation review.
- SHA-256 statement and transaction fingerprints, regenerated/overlapping-statement protection, occurrence handling for identical purchases, conservative transfer matching and manual pairing.
- Search and indexed date/currency filters, accounts/categories/type/amount/property filters, paginated lists, transaction source metadata, merchant/tag/category editing and learned rules.
- Period analysis, monthly/category/property trends, YTD/annual/custom periods, month comparisons, rolling totals and evidence-based recurring-cost suggestions.
- Configurable accounts, categories/subcategories, archiving, deterministic priority rules, JSON backup/replace restore, CSV export, demo deletion and explicit local-data deletion.
- Dark by default, optional persistent light mode, mobile Import navigation, exception-first review, statement balance snapshots, safe-area padding and user-controlled offline PWA updates.
- Private personal-rules file import previews and applies classification corrections to existing records, then remembers rules for future statements.

## Categorizing with gestures

On Home, tap **transactions need a category**. Tap an uncategorized transaction or swipe a purchase sideways to open the sorting sheet. Drag its card onto a category tile, or tap the tile: the category saves immediately. The sheet closes after saving and those transactions immediately leave the uncategorized queue. **Undo** restores the last assignment, including an optional group and newly learned rule, unless another edit has since changed those records.

The sheet can apply your choice to matching uncategorized transactions from the same merchant, account, currency and amount direction. Grouping and learning a future rule are separate, explicit choices. Already categorized transactions and transfers are protected. Property has one tile in the sorting sheet; existing subcategory data remains available in detailed records. Press **C** on a focused transaction for keyboard access; category tiles support Enter. Tap **View transaction details** for tags, transfer controls and source information.

Swipe the month selector left/right to change month. Desktop users can drop PDFs directly onto the Import card. Touch sorting uses Pointer Events rather than relying on desktop-only HTML drag events; vertical list scrolling and cancelled drags do not save changes.

## Architecture

```text
src/domain/           Typed entities, exact money/date parsing, normalization, hashes, reconciliation
src/storage/          Dexie schemas, atomic data operations, demo, backup/restore/export
src/import/           File limits, PDF.js, coordinates, OCR, detection, duplicate review, commit
src/parsers/          Parser contract, shared layout helpers, Barclays / Amex / Revolut adapters
src/categorization/   User rules → built-ins → consistent reviewed merchant history
src/transfers/        Conservative opposite-amount/date/account matching
src/analytics/        Currency-separated calculations and deterministic insights
src/components/       Shared controls and accessible chart tables
src/pages/            Home, import review, transactions/detail, analysis/property, settings
src/tests/            Synthetic row helpers and test setup
scripts/              Local runtime assets, icons and synthetic PDF generators
```

Routing uses hash URLs so static hosting requires no server rewrites. Pages and parsing libraries load as separate chunks. Queries use compound `[currency+date]` and `[accountId+date]` indexes. The explorer renders at most 60 transactions at once; analytics load only relevant time windows. Full-history loading is reserved for explicit backup/export and account-local duplicate/history analysis during import. No original PDF is persisted.

### Money and credit cards

**Every stored `amount`, balance, difference and rule amount range is an integer in that currency's minor units.** GBP `-8245` means **-£82.45**, not -£8,245.00. Backup format 1 explicitly declares `moneyUnit: "minor"`; CSV exports decimal major units. Supported precision: GBP/EUR/USD/CHF/AUD/CAD/NZD/HKD/SGD = 2, JPY = 0, KWD = 3. Ambiguous locale formats are rejected; numbers use English decimal points and comma thousands separators.

Money entering the finances is positive; money leaving is negative. Amex reported amounts owed are stored as negative balances. Purchases are negative, refunds/payments positive. All cash-flow and property totals exclude `isTransfer` or transfer-type rows. Different currencies are never summed or converted. Monetary summation checks safe integer precision. Reconciliation accepts at most one minor unit difference.

A transfer match requires exact opposite amounts, different known accounts, the same currency, dates within five days and reciprocal institution/account evidence in the descriptions. Ambiguous matches remain unlinked. Mark or link a transfer manually when descriptions are insufficient. A partial card payment can pair with its actual opposite deposit; it never matches a purchase or a differently sized payment. Clearly labeled Amex card repayments are classified as transfers immediately, even before the bank-side statement is imported. Other ambiguous or unlinked payments require review so they do not inflate totals.

### Bank parser architecture

Pipeline: file type/size/magic validation → SHA-256 → PDF.js worker → embedded coordinates → Y-tolerant rows / X-based columns → header-based bank detection → bank adapter → normalized transactions → balance reconciliation → duplicate review → deterministic categorization → atomic import and transfer matching.

The interface exposes `canParse`, account, period and currency identification, balances, transactions and validation. The bank adapters select their provider/credit-card semantics and share layout primitives. A dated row without an amount, unsupported dates, both debit/credit values, out-of-period dates and unrecognized transaction-like rows generate explicit review warnings. OCR is used for pages with effectively no embedded text, or explicitly retried when extraction fails. It renders one page at a time, uses Tesseract word bounding boxes and caps transaction confidence at 0.6. Uncertain rows need acknowledgement. Failed reconciliation requires a separate override, stored with the statement for audit.

Barclaycard GBP statements use a separate credit-card adapter within the Barclays institution. It separates the two reading columns before reconstructing rows, treats balances as liabilities, preserves refunds and foreign-currency references, and marks card repayments as transfers. When the PDF prints only an issue date, the review labels **transaction coverage** from the earliest extracted date to that issue date and requires acknowledgement. This does not assert an unprinted billing-period start. `periodSource` and `statementDate` preserve that distinction in the database and backups. Explicit header ranges, including wrapped dates and shared years/months, remain preferred. Missing or conflicting date ranges can be corrected using **Enter statement dates from PDF → Parse again**; manual dates require a source-review acknowledgement and never bypass reconciliation.

UK Amex statements support the low-page explicit billing period, membership identifier, four-column account summary, transaction/process dates, separate-line credit markers, multiline descriptions, foreign-spend references, and transactions near the bottom of a page. A printed transaction date outside the period remains unchanged and requires review. UK Revolut statements skip migration cover pages, read the primary account number and balance-summary table, and stop at the actual footer. Both adapters check gross incoming/outgoing totals as well as net reconciliation. Explicit Revolut payments to an Amex recipient are proposed as transfers and require confirmation that the card belongs to you; change the transaction type during review if necessary. Other person-to-person payments require manual transfer review.

Exact PDF duplicates require a separate override. Known transaction duplicates are excluded by default and remain visible; keeping one requires explicit review. Statement-period matches detect regenerated PDFs. Fingerprints include account, date, normalized description, exact amount, currency, running balance (if present) and repeated-row occurrence. Without balance evidence, overlapping identical rows are potential duplicates rather than silently removed. Import rechecks history inside a single IndexedDB write transaction, including account-creation races. Financial data never partially commits if the transaction fails.

Add another bank by implementing `StatementParser`, registering it in `src/parsers/index.ts`, adding independent header signals and generating a synthetic layout fixture. Add tests for signs, balances, multiline descriptions, page breaks, repeated purchases, currency references and invalid rows. Extend adapter-specific column identification when a real layout differs; do not relax reconciliation to make it pass.

### Personal corrections and appearance

Settings → **Import personal rules** accepts a local JSON file with format `feng-finance-rules`, version `1`, `categories` and `rules` arrays. Category entries contain `id`, `name`, `kind`. Rule entries contain `name`, `match` (`contains`, `starts-with`, `exact`), `pattern`, `direction`, and either `categoryId` or `type: "transfer"`. Preview the matching record count, then **Apply corrections & remember rules**. This is an atomic local update: printed dates/amounts and statement balances are preserved; demo rows are excluded. Conflicting outcomes, unavailable categories, linked transfers and stale previews are rejected. Reapplying the same rules is idempotent. Keep files containing personal names or references out of the repository. The deployed site cannot change another device's records remotely.

Dark is the default theme. Appearance is stored in IndexedDB and included in backups; a localStorage copy of the theme name prevents a light-mode reload flash. No financial data is stored in localStorage. Import opens on uncertain/duplicate/date-exception rows; **All transactions** exposes every extracted row and optional categorization. After import the overview opens on the latest imported transaction month. Account balances are dated statement snapshots, not inferred current balances; card liabilities display as **amount owed**.

### Backup and schema migrations

Format: `{format:"feng-finance", version:1, schemaVersion:2, moneyUnit:"minor", exportedAt, accounts, statements, transactions, categories, rules, transferLinks, settings}`. The original PDFs are not included. Zod validation checks primitive formats/versions, safe integer money, reference integrity, unique IDs, account/currency consistency, category hierarchy, statement counts and transfer pairing before any write. Replace restore runs atomically and requires an explicit UI acknowledgement. Merge restore is deliberately not implemented in V1. Backups are unencrypted sensitive files; save them to a protected location.

IndexedDB starts at schema 1. Schema 2 adds the merchant index and fills missing review/occurrence/tag metadata without clearing data. A migration test opens a schema-1 database and verifies preserved amounts and descriptions. Future schemas must add versioned, non-destructive migrations and tests. Never reset a database automatically in response to a version or parsing error.

## Deployment and installation

The application is hosted at [Feng Finance](https://lech1012-collab.github.io/feng-finance/). See [static deployment instructions](docs/deployment.md). `dist/` is the complete deployable artifact for Vercel, Cloudflare Pages or GitHub Pages. No API keys are required. Verified pushes to `main` deploy automatically through GitHub Actions.

On iPhone: open the HTTPS URL in Safari → **Share** → **Add to Home Screen** → enable **Open as Web App** → **Add**. Launch from the icon. Wait for the offline cache to complete before testing airplane mode. Each browser/profile/origin has a separate database; installing or changing the deployment URL does not move data. Export/restore when moving origins or devices.

## Privacy and release verification

See [privacy/security audit](docs/privacy.md), [real iPhone checklist](docs/iphone-checklist.md) and [implementation/validation notes](docs/validation.md). Browser tests exercise actual generated PDFs, multi-file import, local OCR, atomic review, learned rules, duplicates, currency separation, backup and offline import. The offline test stops its static origin before reloading, importing and exporting and rejects external requests/non-GET requests with payloads.

### Testing private real statements

Place real files only in `private-fixtures/` (ignored) and select them using the app's file picker. Never put real statements, extracted text, backups, account IDs or transaction history into committed tests, screenshots, traces, logs or issue descriptions. `*.pdf`, test reports and private fixtures are ignored. Make a synthetic equivalent when adding a regression. Compare every transaction and balance against the original locally. Export a backup before experimenting with parser changes.

## Known limitations

- Adapters are verified against generated English-layout fixtures, not every historical bank PDF variation. Real statements may need adapter-specific layout work; warnings/manual bank-account selection and explicit reconciliation prevent silent acceptance. No claim of universal bank-layout compatibility is made.
- Native iPhone Safari file picking, installation, storage persistence and update behavior require the documented manual device checks. Playwright WebKit is useful but is not an actual iPhone.
- English embedded text and English OCR; password-protected PDFs must be unlocked locally first. Statements with multiple accounts/currencies must be exported separately. 30 MB / 100 pages maximum. OCR can be slow and consume memory on a phone.
- No exchange-rate conversion, encrypted database, multi-device sync or statement PDF retention. A device passcode and regular backups are essential. The app host cannot recover lost browser data.
- Comparisons require matching sets of accounts with transactions in both months. This is a conservative coverage check, not proof that every statement or every day is covered; totals and averages may still be incomplete. Account freshness makes this visible. Recurrence needs at least three approximately monthly, similarly priced payments and remains a suggestion.
- Property means cash flow only, with the configured Property and Property income categories; this is not tax, accrual accounting, depreciation or investment profitability.

### Subscription review centre

Open **Subscription review** on Home. The on-device detector examines up to three years of transactions, separated by account and currency. It looks for weekly (four charges), monthly/quarterly (three charges), and annual (two charges) patterns. Known service names and the Subscriptions category also surface one-off candidates, without inventing a billing frequency. Price changes and the same merchant on multiple accounts prompt review. Evidence links open the original transaction and statement details.

Swipe a charge left to plan cancellation, or right to keep it. Status tiles provide touch/keyboard alternatives; **All detected** lets you reverse a decision. Complete cancellation through the provider or app store, then mark **I cancelled**. A subsequently imported charge dated after that decision returns to the review queue. Review states are backed up with settings; no transaction amount or category is modified. Annual projections use the latest observed rate and are not guaranteed savings. The app cannot determine usage, cancel a service, or monitor bank activity in the background. Sparse imports, changing merchant descriptors, missing periods and multiple plans billed under one merchant can limit detection; inspect the source charges before acting.

### Rechecking an import after a parser update

Version 1.3.1 (parser 1.0.3) fixes Barclays statements that print a date only once for several transactions. Previously imported records are not changed automatically. Back up before testing a fresh import; use an empty test browser profile or the documented Settings reset. Do not blindly override duplicate protection to repair an earlier incomplete import, because changed descriptions can also affect duplicate matching. Check every transaction and reconciliation before confirming.

### Category overviews and spending context

Tap any Home spending category to open its monthly KPIs, trend, subcategories and source transactions. Browse all categories also includes income and zero-spend categories. Property has its rent/cost/net metrics within this overview; the duplicate Home tile is removed. Tap chart bars or month tiles to drill down. Home can switch category percentages between share of spending and share of recorded income (unavailable with no income; values may exceed 100%).

Compare against the preceding six or twelve calendar months. Only months covered continuously by statements for every account in the selected currency enter the baseline. Inferred transaction-coverage periods and failed reconciliations are excluded. Covered months with no category spending count as zero; missing months do not. Sample standard deviation uses n−1 and requires at least three complete months. The mean ± one standard deviation band is descriptive, not a budget or prediction. The current month is excluded from the baseline, and partial current coverage prevents an overspending alert. Transfers are excluded throughout. Property cash flow includes rental income; category spending remains gross outflows, with refunds shown in the transaction evidence and recorded income.

Navigation is Import · Transactions · Home · Analyse · Settings, with Home central on mobile. Page accents are blue, violet, amber, coral and slate on neutral dark/light surfaces; the former green branding, charts and category colors are replaced. Existing financial records and category assignments are unchanged.

## Home balances and simplified workflow

On desktop, press and drag a transaction row to open the category popup, then
drop that same transaction directly onto a category tile. Uncategorized rows
have no arrow icon. Up to three likely categories appear first, ranked from
local user rules, reviewed merchant history in the same account, built-in rules
and description clues. Suggestions require confirmation and never change
financial amounts or classify transfers as spending. Unknown descriptions show
the full category list. Mobile tap/swipe, keyboard C, tile selection, grouped
sorting, remembered rules and Undo remain available. Dropping outside a tile
does not save; Escape cancels desktop dragging.

The popup also includes a **Transfer** tile for movements between your own
accounts and card repayments. Dropping or tapping clears spending categories,
sets the transaction type to transfer and excludes it from income/expenses.
It works for incoming and outgoing amounts, supports grouping, optional
account-specific remembered rules and Undo. Mark both sides when necessary;
this action does not invent a matching transaction or link an ambiguous pair.

Home's Import statement control opens the native PDF picker directly. The Import
navigation tab does the same. PDFs process locally, with reconciliation and
exception review before committing. A multi-file queue stays in review until its
last statement is confirmed, then returns to Home automatically.

Home shows net cash flow, total balance and each account's signed statement
balance, with 1/3/6/12-month percentage comparisons. Credit-card debt reduces
the total. Balances use the latest statement ending on or before the selected
month end; older snapshots are dated and the total is labelled partial when any
account is stale, unverified or missing. Percentage comparisons require current,
reliable statements for all the same accounts at both endpoints and a nonzero
prior total. Change is `(current - previous) / abs(previous) × 100`, so debt
repayment produces a positive change. Failed validation and inferred periods
withhold comparisons. The Home 1/3/6/12-month selector also controls balance history.
The range ends at the latest eligible closing balance. Daily balances are reconstructed
from the opening balance and all transactions, including transfers, only when the
stored row count and amounts reconcile with the reported closing balance. Partial
extraction, conflicting overlap and missing coverage leave gaps. A dashed line shows
the total; totals and percentage comparisons require all accounts at both dated
endpoints. Currency totals remain separate.

Import both the bank and Barclaycard statements: individual card purchases receive
spending categories, while repayments are transfers. Explicit bank payments to
Barclaycard are paired with a unique same-currency, equal-value card repayment
within five days during import. Refunds and ambiguous matches are excluded.
For previously imported, unpaired bank repayments, open the transaction, choose
Transfer and save; optionally link the matching card repayment. A repayment alone
cannot reveal its underlying purchases, so card statements are needed for a complete
spending breakdown.

Expenses plot below zero, income above zero, and net cash flow uses a distinct
line. Home charts have tooltips and legends; detailed value tables remain in
Analyse. Account freshness and identifiers are shown at the top of Transactions.

Uncategorized on Home opens an all-dates transaction queue. Main category
buttons, including Uncategorized, select filters. Rows explicitly say Needs
category, Categorized or Transfer. Saving through either the sorting sheet or
transaction editor removes categorized rows from that queue. Analyse's category
selector opens the category's charts, complete-month average/sample deviation
and same-month income percentage.
