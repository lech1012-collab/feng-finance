# Privacy and security architecture (v2)

Feng Finance is a static, client-side PWA. No personal financial information is
uploaded. It has no application backend, financial telemetry, session replay,
external error logger, external AI or API keys. The only external data fetch is a
fixed, public ECB exchange-rate table, approved in the v2 specification.

## Data flow

A selected File is read into local memory. PDF bytes are hashed using Web Crypto,
parsed by the bundled PDF.js worker, and optionally rendered for bundled Tesseract
OCR. Text coordinates, transaction rows, statement balances and review edits remain
local. CSV/OFX/QFX/QIF use local parsers and mapping. Only an explicitly confirmed
import commits account/statement/transaction metadata to IndexedDB. Original
statement PDFs are not retained by default.

Manual entries, rules, linked transfers, refund allocations, split rows, budgets,
valuations, goals, notes and local audit history are stored in IndexedDB. Display
currency conversion and original-month refund adjustments are projections; neither
rewrites original statement amounts. Receipt images/PDFs are retained only when
explicitly attached. Images are decoded/compressed locally; attached PDFs are
local downloads, never executable HTML.

React renders statement/merchant/note text as escaped text. PDF JavaScript actions,
embedded links and attachments are not executed or navigated. PDF/OCR workers and
canvases are released after extraction. Bounds include PDF 30 MB/100 pages, OCR
canvas 18 million pixels, attached files 20 MB/five per transaction, and compressed
images at most 1600px. Backup restores validate schema, amounts and references
before replacing data atomically. Imported error text is not externally logged.

## Expected network requests

- **Installation/update:** same-origin GET requests for HTML, manifest/icons, CSS,
  hashed JavaScript, service worker/Workbox, PDF worker/CMaps/fonts/WASM and OCR
  worker/core/English model. The service worker precaches offline assets.
- **Update checks:** same-origin `sw.js` GET requests on launch and while online.
- **Public exchange rates:** one fixed GET to
  `https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A?lastNObservations=1020&format=csvdata`.
  The request uses `credentials: omit`, `referrerPolicy: no-referrer`,
  `redirect: error`, and only an `Accept: text/csv` application header. It has no
  body, account ID, merchant, balance, file, user-selected transaction date or
  personal-data query parameter. Automatic downloads can be turned off in Currency
  settings; dated manual rates remain possible.
- **Offline:** imported data, review/categorization, planning, notes, attachments and
  backup require no network. Cached rates retain their date. Missing/stale rates
  mark converted totals unavailable/unverified; the app does not invent rates.

PDF/OCR and alternative statement parsing require no external communication.
Financial files/text never appear in request bodies, URLs or headers. A public-rate
request can coincide with viewing a foreign-currency account, but the request is
fixed and contains no information about that account. DevTools may display local
service-worker cache reads as requests; local cache delivery is not an upload.

## Host policies

Vercel response headers, Cloudflare `_headers`, and the HTML meta policy restrict
`connect-src` to `'self'` and `https://data-api.ecb.europa.eu`. All scripts remain
same-origin; WASM evaluation is allowed only for bundled decoders/OCR. Inline styles
are permitted for React/SVG charts. Objects, foreign scripts, form submissions and
referrers are disabled. Response headers additionally disable framing/MIME
sniffing where supported. GitHub Pages cannot configure arbitrary response
headers, so the meta CSP supplies its network/script restrictions. `frame-ancestors`
requires a response header and is not claimed as a meta-policy guarantee.

Camera/microphone/location APIs are disabled by response Permissions-Policy where
supported. Receipt capture uses a user-activated file input with `capture`, not a
camera stream or background recording. WebAuthn is origin-scoped local platform
authentication; it does not send credentials or financial data to an app server.

## Local protection and backups

Optional app lock uses a salted PBKDF2-SHA256 PIN digest, persisted attempt
throttling, and platform WebAuthn when supported. Financial content is withheld
until authentication, covered immediately when hidden, and locked on return after
the configured delay. PIN/authenticator metadata is device-local and excluded from
portable backup settings and audit history; restore preserves the existing local
security configuration.

**App lock does not encrypt IndexedDB at rest.** A device/browser user with direct
storage access may read it. Optional at-rest encryption was a Should requirement
and is deferred until an atomic, recoverable vault design can preserve financial
integrity. Use a device passcode and a stable trusted HTTPS origin.

Plain JSON backups contain financial data and must be saved privately. Optional
password-protected `.feng` backups encrypt the complete portable document with
AES-GCM-256/PBKDF2-SHA256 600,000 iterations, fresh salt and IV, and authenticated
non-financial metadata. Passwords are never saved or sent. A lost password cannot
be recovered. Wrong passwords, tampered headers/ciphertext and invalid references
fail before preview or any database write. Restore still requires explicit
replacement confirmation. See [security implementation](security-v2.md).

## Storage and release limitations

Browser eviction, private browsing and clearing site data can remove records.
Persistent-storage requests are browser-controlled and cannot guarantee iOS
retention. Storage estimates show attachment bytes and warn above 80% quota where
supported. Keep backups outside this browser/device; a PWA update is not a backup.
Changing deployment origin requires explicit export/restore.

Dependencies must pass vulnerability review before release. Malicious PDFs/images
can still consume resources despite size/pixel limits. Real statements, private
rules, backups, traces and screenshots must never enter Git. Committed fixtures and
browser screenshots use fictitious data only.

## Verification

Unit tests inspect crypto, credentials, migration/reference validation and atomic
storage. Browser privacy tests inspect requests during digital/OCR imports and
local attachment actions, including a stopped-origin/offline workflow. FX tests
verify the fixed URL and omission of credentials/body. Check the consolidated
[validation record](validation.md) for actual results; test code existing is not a
claim that the current production build has passed.

For a manual production audit, wait for precache, clear the network log and import
a fictitious PDF/CSV. Confirm only permitted static/public-rate GETs appear, with
no personal values/body. Turn automatic rates off, disconnect and repeat digital
PDF, OCR, sorting, notes/attachments and backup. Do not commit real-data inspector
exports. Reconnect and inspect CSP plus the permitted ECB table request separately.
