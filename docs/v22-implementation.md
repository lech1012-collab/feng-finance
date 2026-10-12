# Specification amendment v2.2

This document maps the 8 October amendment to its implementation. Test and
deployment results are recorded separately in [validation](validation.md).
The original financial specification remains in [v2 implementation](v2-implementation.md).

## Beta safeguards

| Requirement       | Implementation                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First launch      | A versioned, mandatory introduction explains beta accuracy, local data, lack of financial advice and fictitious demo data. Import opens the native picker in the same tap.                                                                                    |
| Installation      | Manifest name Feng, standalone display, relative start/scope and a 180-pixel Apple icon. Safari installation instructions, copy-link help for other iOS browsers and the desktop install event are supported.                                                 |
| Install reminders | Visible appearances are recorded separately from dismissals. Seven days must pass before another appearance; at most three are allowed. Installed apps never show the banner.                                                                                 |
| Storage           | Persistence is requested after acknowledgement. Settings reports browser protection honestly. Safari-tab imports explain that the installed app may use separate storage and offer backup.                                                                    |
| First backup      | Home offers a reminder seven days after the first real import if no backup has been exported. Existing import dates are read without modifying historical records.                                                                                            |
| Feedback          | Settings and a failed-import offer use fixed build configuration. Only technical context is prepared. Financial files and figures must not be submitted. Optional diagnostic exports replace every cell's contents with placeholders.                         |
| Releases          | Version, build date, five-point changelog, testing task and beta round appear in Settings. Updates are checked on launch and foregrounding, wait on Home until editing and pending financial writes end, and require Reload. What's new is acknowledged once. |
| Recovery          | An atomic native structured-clone snapshot captures previous records before migrations change them. It preserves PIN settings and receipt bytes, stays local for 14 days and requires confirmation to replace current data.                                   |
| Repository        | Pre-commit/CI guards reject private fixtures, sensitive exports and PDFs/CSVs outside synthetic fixtures. Release metadata must agree. The conservative licence reserves rights until the owner chooses another licence.                                      |

No invitations, telemetry or automatic feedback uploads are introduced. The owner
can configure a Microsoft Form or email later; absent configuration, the app
offers technical details to copy. See [feedback configuration](feedback-configuration.md)
and the [two-week beta plan](beta-test-plan.md).

## PDF reading and review

The import session retains the PDF, coordinates and crops in browser memory until
confirmation or dismissal. They are released when the import ends. The session
serializes canvas/OCR operations to bound mobile memory.

The generic parser reconstructs rows using font-aware vertical tolerances and
columns using positions and headers. Bank profiles provide hints, while the
existing Barclays, Barclaycard, Amex and Revolut adapters remain available for
parallel comparison and conservative fallback. The parser never fabricates a
zero amount or today's date to make an unread row importable.

| Requirement       | Implementation                                                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text quality      | Empty or predominantly unusable transaction tokens trigger local OCR rather than treating damaged embedded text as trustworthy.                                                                                                           |
| Signs and columns | Competing column/sign interpretations are compared with running balances and independent movement totals. An unresolved interpretation opens column mapping. Credit-card liabilities retain their native negative balance convention.     |
| Exact proof       | New PDFs use exact zero-minor-unit reconciliation. A one-penny difference is a warning. Historical imports retain their originally used tolerance. Duplicate rows remain in source arithmetic even when excluded from insertion.          |
| OCR               | Bundled English OCR runs locally at 300 DPI. Numeric cell OCR reads amount/balance crops and is accepted automatically only when its arithmetic matches exactly.                                                                          |
| Cancellation      | Completed pages survive cancellation. Unread pages are explicitly named; partial imports require unverified acceptance. No transaction on an unread page is silently invented or inserted.                                                |
| Source review     | Unread dates, descriptions and amounts remain visible with source evidence. Accept, Correct and Exclude recheck the statement. Invalid required fields cannot be bypassed with Import anyway.                                             |
| Mapping           | The preview exposes roles, sign convention, date convention and live checks. Saving a named layout records structural geometry, not account numbers or transaction values. Every subsequent use is checked again.                         |
| Traceability      | Optional parser method, source-row ID, check level and layout ID are preserved. The UI uses plain check descriptions rather than confidence percentages.                                                                                  |
| Diagnostics       | Off by default, at most five local diagnostic records are retained when enabled. Disabling clears them. Raw diagnostics and recovery snapshots never enter portable backups or Undo. Saved layouts are portable and editable in Settings. |

OCR readings with exact proof and no unresolved rows may be confirmed normally;
using OCR alone does not require an override. Credit-card total checks are the
honest ceiling when the source has no running balances. Rows with both purchase
and posting dates outside the stated period require review, with native dates
preserved.

An override marks the statement unverified. It cannot turn unequal arithmetic,
missing pages or unresolved source readings into verified coverage. Local source
exclusion and omission of an already-imported duplicate are different decisions.

## Recovery boundaries

The safety copy is not the downloadable JSON backup. It stores original native
keys and structured-clone values, including fields absent from newer domain
defaults. Restore retains the current additive IndexedDB schema, restores raw
values atomically and reloads with the previous lock settings. It does not claim
to downgrade the browser's database schema.

After exact recovery, startup does not add defaults, prune audit history, close
months, record installation impressions or automatically download exchange rates.
User-requested changes remain available. Expiration deletes the safety payload
on the next local access; the small recovery marker remains to prevent an
automatic rewrite of restored data. Empty old databases do not create a
misleading recovery action.

## Verification boundaries

Synthetic fixtures cover multi-page tables, reordered columns, card payments,
mixed currency, unknown issuers, image-only and damaged-text PDFs, year boundaries,
wrapped descriptions and a one-penny discrepancy. Browser checks exercise the
actual app, with the static origin stopped for offline proof. Unit tests cover
financial source guards and atomic migration rollback separately.

Playwright WebKit is not physical Safari. Add to Home Screen, native iOS Files,
Face ID, VoiceOver, eviction behavior and the document's iPhone timing targets
remain in the [manual checklist](iphone-checklist.md). Desktop timings must not be
presented as iPhone measurements.
