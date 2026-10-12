# Privacy and security architecture (v2.2)

Feng Finance is a static, client-side PWA. Feng does not upload personal financial
information. It has no application backend, financial telemetry, session replay,
external error logger, external AI or API keys. The only external data fetch is a
fixed, public ECB exchange-rate table, approved in the v2 specification. Optional
feedback opens an owner-configured destination only after an explicit user choice.

## Data flow

A selected File is read into local memory. PDF bytes are hashed using Web Crypto,
parsed by the bundled PDF.js worker, and optionally rendered for bundled Tesseract
OCR. Text coordinates, transaction rows, statement balances and review edits remain
local. CSV/OFX/QFX/QIF use local parsers and mapping. Only an explicitly confirmed
import commits account/statement/transaction metadata to IndexedDB. Original
statement PDFs remain in browser memory through review for source crops and
corrections. They are released on confirmation or dismissal and are not persisted.

Manual entries, rules, linked transfers, refund allocations, split rows, budgets,
valuations, goals, notes and local audit history are stored in IndexedDB. Display
currency conversion and original-month refund adjustments are projections; neither
rewrites original statement amounts. Receipt images/PDFs are retained only when
explicitly attached. Images are decoded/compressed locally; attached PDFs are
local downloads, never executable HTML.

React renders statement/merchant/note text as escaped text. PDF JavaScript actions,
embedded links and attachments are not executed or navigated. Rendering is
serialized and each canvas is released after its job; the import session disposes
its source document, workers, raw extraction and crops when review ends.
Bounds include PDF 30 MB/100 pages, OCR
canvas 18 million pixels, attached files 20 MB/five per transaction, and compressed
images at most 1600px. Backup restores validate schema, amounts and references
before replacing data atomically. Imported error text is not externally logged.

**Keep import diagnostics** is off by default. Enabling it retains reconstructed
tables and check results for the last five imports locally; disabling it clears
them. Raw diagnostics can contain sensitive readings. They are excluded from
portable backups and audit/Undo. Export diagnostics rebuilds a strict allowlist
with placeholders for every cell, including dates, amounts, descriptions and
headers; account identifiers, filenames, raw differences and image crops are omitted.
Saved layouts retain structural geometry and roles, not transaction readings, and
are included in portable backups.

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
- **Optional feedback:** user-activated navigation to the fixed HTTPS form
  configured at build time, or a configured `mailto:` destination. The warning
  asks testers not to send real statements or screenshots with real figures.
  Only allowlisted app/build/device/browser/display-mode/screen-width context is
  attached. Optional redacted diagnostics are copied locally for the tester to
  paste; they are not uploaded automatically. A separately opened form may make
  its own provider requests outside Feng's application context.
- **Offline:** imported data, review/categorization, planning, notes, attachments and
  backup require no network. Cached rates retain their date. Missing/stale rates
  mark converted totals unavailable/unverified; the app does not invent rates.

PDF/OCR and alternative statement parsing require no external communication.
Financial files/text never appear in request bodies, URLs or headers. A public-rate
request can coincide with viewing a foreign-currency account, but the request is
fixed and contains no information about that account. DevTools may display local
service-worker cache reads as requests; local cache delivery is not an upload.

## Host policies

Preview headers, generated Cloudflare `_headers`, and the HTML meta policy restrict
`connect-src` to `'self'`, `https://data-api.ecb.europa.eu` and the validated
feedback origin when configured. The checked-in Vercel response policy allows
self and ECB; feedback opens by explicit external navigation. All scripts remain
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

The local pre-migration safety backup is a separate exception to portable-backup
redaction: it deliberately preserves prior raw lock settings, original record
keys and receipt bytes so exact recovery is possible. It stays in the same local
database, keeps only the latest snapshot for 14 days and never enters exported
backups or audit history. **Restore previous data** requires confirmation and
replaces changes made after the update. It is not off-device recovery or database
encryption.

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
