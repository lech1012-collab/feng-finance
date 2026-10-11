# Security, backups and private attachments

Feng Finance remains a static, client-side PWA. PINs, authenticator credentials,
backup passwords, notes and attachment bytes are never sent to a server.

## App lock

Settings → Security enables an optional six-digit PIN, then offers a platform
WebAuthn authenticator when supported. Face ID/Touch ID uses a random challenge,
required user verification, origin-scoped credentials, and local verification of
the assertion signature, relying-party hash, origin, challenge, presence and
verification flags. Authentication needs HTTPS or localhost. Credential metadata
is scoped to this origin and device and is excluded from portable backups.

PINs are stored only as salted PBKDF2-SHA256 digests with 600,000 iterations.
Failed attempts are persisted; after five failures there is a 30-second cooldown,
which increases to at most five minutes. No PIN recovery is available. A user who
forgets their PIN can use configured device authentication to export a backup.
Keep a backup before turning the lock on.

Financial UI is not mounted before lock configuration is read or while locked.
Hidden content is immediately covered for the browser's app switcher. Lock delays
are immediate, one, five or fifteen minutes, measured across background/suspension.
A fresh launch or reload always requires authentication when lock is enabled.

**The app lock deters casual access; it does not encrypt IndexedDB at rest.**
Optional local database encryption (FR-7.4, a Should requirement) is deferred:
transparently encrypting values while retaining financial indexes, or purging and
restoring the database on lock, would expose metadata or introduce data-loss risk.
A future vault must migrate and recover atomically before it can be enabled.

## Encrypted `.feng` backups

Export accepts a password of at least eight characters and confirmation, plus an
option to omit attachments. AES-GCM-256 encrypts the entire portable backup using
an unextractable key derived with PBKDF2-SHA256, 600,000 iterations, a fresh 16-byte
salt and a fresh 12-byte IV. The file header contains only format/schema versions,
creation date and cryptographic parameters. Those fields are authenticated as
AES-GCM additional data. Financial data is contained only in the ciphertext.

The password is not saved. Losing it makes the file unrecoverable. Files use this
JSON envelope, which must not be edited:

```text
format, version, schemaVersion, createdAt, encrypted,
encryption, derivation, iterations, salt, iv, payload
```

Restore decrypts and validates before opening the existing replacement preview.
A wrong password, damaged ciphertext, edited header or invalid schema cannot write
any data. Replacement still requires the explicit confirmation checkbox; Cancel
leaves the database unchanged. Encrypted restore files are limited to 100 MB; export
checks the size before encryption so it cannot produce a file this app cannot
restore. Oversized exports can exclude attachments without removing local data.
Legacy JSON backups continue to work. Local PINs
and authenticator settings are preserved through restores and excluded from
exported settings and audit history.

## Notes, attachments and storage

Transactions accept notes up to 10,000 characters and at most five image/PDF
attachments. Uploads are limited to 20 MB each. Images are decoded locally,
resized to at most 1600 pixels on the long edge, and encoded as JPEG at 82% quality.
Smaller images are not enlarged. SVG and HTML files are rejected. PDFs are stored
as local blobs and offered as downloads, never inserted as unsafe HTML.

Attachment addition/deletion updates transaction references atomically. Notes
and attachment edits have local audit history and Undo. Backups serialize blobs
as base64; excluding attachments also removes portable references and affected
audit entries, keeping restore consistency. Transaction text search includes notes.

Settings → Device storage reports attachment usage and browser quota where the
browser supports estimates, warns above 80% usage, and offers persistent storage.
Persistence is browser-controlled and does not replace backups.

## Validation

Focused automated tests cover password round-trips, metadata tampering, wrong
passwords, random salts/nonces, PIN throttling, local verification of a signed
WebAuthn assertion, background locking, attachment limits, atomic references,
notes, and Undo. Browser tests cover narrow viewports, `.feng` export/restore,
offline attachment compression/storage and absence of network requests.

Real iPhone Safari still needs manual Face ID/Touch ID setup, app-switcher privacy,
Files/camera selection, restore downloads and installed-PWA suspension tests.
