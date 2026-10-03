# Privacy and security audit

## Data flow

A selected File is read as local bytes, hashed with Web Crypto, parsed by the local PDF.js worker and optionally rendered into a canvas for a local Tesseract worker. Coordinates, normalized transactions and edits stay in process memory until explicitly imported. The original PDF and canvas are released; PDF bytes are not stored. Import commits local metadata and transactions to IndexedDB. Backup/CSV files are created as local Blob downloads.

There is no fetch/upload route, app server, external AI, analytics, telemetry or session replay. React renders imported descriptions as escaped text, never HTML. PDF JavaScript actions, embedded links and attachments are not executed or navigated. PDF.js and OCR workers are terminated/released after extraction. Bounds: PDF 30 MB/100 pages, scanned canvas 18 million pixels, restore file 50 MB. Currency/date/amount validation and atomic writes protect correctness and integrity. Financial errors shown to the user are not sent to external logging services.

## Expected network requests

- Initial app installation/update: GET requests to this application's origin only, for HTML, manifest, icons, CSS, generated service worker/Workbox, hashed JS, PDF worker, CMaps/fonts/WASM and OCR worker/core/English model.
- Service-worker update checks: GET to `sw.js` (launch and hourly online).
- After precache installation: parsing/assets can be served by the service worker. PDF import works with browser connectivity disabled and requires no external communication. Local cache reads may still appear as requests in DevTools; **from ServiceWorker** indicates local delivery.
- No PDF bytes, account IDs, descriptions, balances, categories, transactions or history in request bodies/URLs/headers. No external origins.

The Playwright offline/privacy test shuts down its test-only static origin, reloads, navigates to import, parses a digital PDF, commits it, and downloads a backup. It observes requests and rejects external origins, non-GET methods and request bodies. A separate scanned-PDF test verifies bundled OCR offline. These tests validate the synthetic workflow, not arbitrary future code or hosting configuration.

## Host policy

Vercel and Cloudflare configs include same-origin CSP, no framing/objects, no form submissions, no referrer, MIME-sniff protection and disabled camera/microphone/location. WASM evaluation is allowed for local OCR and PDF decoders; arbitrary external scripts are not. Inline styles are allowed for React charts and PDF rendering. Browser-level tests use the Vite preview and a test-only static host with the same CSP; inspect these headers on the deployed provider separately.

## Local protections and limitations

IndexedDB and exported JSON are not application-encrypted. Device/browser access implies access to finances. Use an iPhone passcode; save backups in a protected folder. Backups include descriptions and masked account identifiers and are sensitive. The static app URL may be publicly reachable depending on hosting access controls, but one visitor cannot read another device's database.

Browser data eviction, private browsing and clearing website data can remove records. Settings offers a persistence request and always recommends backup. The app does not claim persistence requests guarantee retention on iOS. Use stable origins and explicit backup/restore when changing deployments.

Dependency audit is run for development and production packages; patched PDF.js is required. Track upstream advisories and rebuild/offline-refresh when versions change. A malicious PDF can still consume resources; size/page/pixel limits reduce but cannot eliminate that risk. No financial real-data fixture is committed.

## Manual network check

Load the production deployment with Web Inspector/DevTools. Wait for the offline cache, clear the network log, enable offline mode, select a private PDF and complete its review. Confirm no network transfer succeeds or is needed. Repeat for a scanned fixture. Reconnect to verify only static same-origin update requests; ensure no financial text or file body is transmitted. Avoid saving real-data traces/screenshots in the repository.
