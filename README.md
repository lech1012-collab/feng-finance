# Feng Finance

A client-only personal-finance PWA for importing monthly Barclays, American Express and Revolut PDF statements. Financial information stays in IndexedDB in the browser. The deployment contains only static assets; there is no backend, account login, external AI, telemetry or cloud sync.

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
- Installable mobile PWA, safe-area padding, offline shell and parsing, and a user-controlled service-worker update prompt.

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

A transfer match requires exact opposite amounts, different known accounts, the same currency, dates within five days and reciprocal institution/account evidence in the descriptions. Ambiguous matches remain unlinked. Mark or link a transfer manually when descriptions are insufficient. A partial card payment can pair with its actual opposite deposit; it never matches a purchase or a differently sized payment. Transfers are excluded only after classification/matching: review unlinked payments so they do not inflate totals.

### Bank parser architecture

Pipeline: file type/size/magic validation → SHA-256 → PDF.js worker → embedded coordinates → Y-tolerant rows / X-based columns → header-based bank detection → bank adapter → normalized transactions → balance reconciliation → duplicate review → deterministic categorization → atomic import and transfer matching.

The interface exposes `canParse`, account, period and currency identification, balances, transactions and validation. The bank adapters select their provider/credit-card semantics and share layout primitives. A dated row without an amount, unsupported dates, both debit/credit values, out-of-period dates and unrecognized transaction-like rows generate explicit review warnings. OCR is used for pages with effectively no embedded text, or explicitly retried when extraction fails. It renders one page at a time, uses Tesseract word bounding boxes and caps transaction confidence at 0.6. Uncertain rows need acknowledgement. Failed reconciliation requires a separate override, stored with the statement for audit.

Exact PDF duplicates require a separate override. Known transaction duplicates are excluded by default and remain visible; keeping one requires explicit review. Statement-period matches detect regenerated PDFs. Fingerprints include account, date, normalized description, exact amount, currency, running balance (if present) and repeated-row occurrence. Without balance evidence, overlapping identical rows are potential duplicates rather than silently removed. Import rechecks history inside a single IndexedDB write transaction, including account-creation races. Financial data never partially commits if the transaction fails.

Add another bank by implementing `StatementParser`, registering it in `src/parsers/index.ts`, adding independent header signals and generating a synthetic layout fixture. Add tests for signs, balances, multiline descriptions, page breaks, repeated purchases, currency references and invalid rows. Extend adapter-specific column identification when a real layout differs; do not relax reconciliation to make it pass.

### Backup and schema migrations

Format: `{format:"feng-finance", version:1, schemaVersion:2, moneyUnit:"minor", exportedAt, accounts, statements, transactions, categories, rules, transferLinks, settings}`. The original PDFs are not included. Zod validation checks primitive formats/versions, safe integer money, reference integrity, unique IDs, account/currency consistency, category hierarchy, statement counts and transfer pairing before any write. Replace restore runs atomically and requires an explicit UI acknowledgement. Merge restore is deliberately not implemented in V1. Backups are unencrypted sensitive files; save them to a protected location.

IndexedDB starts at schema 1. Schema 2 adds the merchant index and fills missing review/occurrence/tag metadata without clearing data. A migration test opens a schema-1 database and verifies preserved amounts and descriptions. Future schemas must add versioned, non-destructive migrations and tests. Never reset a database automatically in response to a version or parsing error.

## Deployment and installation

See [static deployment instructions](docs/deployment.md). `dist/` is the complete deployable artifact for Vercel, Cloudflare Pages or GitHub Pages. No API keys are required. No host account was configured in this workspace; publishing is a hosting-account action, while the production artifact is ready locally.

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
- Comparisons use previous months with data; incomplete statement coverage can make totals and averages incomplete. Account freshness makes this visible. Recurrence needs at least three approximately monthly, similarly priced payments and remains a suggestion.
- Property means cash flow only, with the configured Property and Property income categories; this is not tax, accrual accounting, depreciation or investment profitability.
