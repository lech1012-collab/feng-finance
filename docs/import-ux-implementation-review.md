# Import workflow: implementation review

This review covers the import-only 2.2.8 redesign. It does not repeat or replace the full-app 2.2.7 audit. The [design handoff](import-ux-redesign.md) records the journey, incumbent references, component sizing and financial acceptance rules.

## Reproduced baseline

A genuine synthetic Barclays PDF renamed to a long, unbroken filename expands the deployed 2.2.7 page to 1,283 CSS px at both 320 px and 390 px viewport widths. With 200% root text at 390 px it expands to 2,520 px. The raw filename paragraph escapes its statement card. The baseline was replayed after service-worker installation; the failure is independent of the deliberately blocked-worker diagnostic run. No real statement was used.

The previous page also exposes overlapping decision systems: statement warning acceptance, balance override, row inclusion/acknowledgement, source correction, bank options and optional transfer confirmations. The redesigned normal route must not require these to be individually approved when the statements already pass their checks.

## Review gates

| Milestone                                    | Principal review | Evidence                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Batch journey                             | Accepted         | Commit `6d5973d`; presentation derives its state from the original `importBlockers`; append preserves drafts/sessions and manual choices; exclusive expansion and focused attention navigation; leave-out/reinclude rechecks; no financial records written during preparation.                                                               |
| 1. Duplicate transitions                     | Accepted         | A fresh nonduplicate restores its automatic inclusion after the competing statement is left out; a newly discovered duplicate is excluded and unacknowledged. Explicit decisions are tracked per fingerprint, which includes occurrence and balance. Both directions and exact repeated PDFs have integration regressions.                   |
| 1. Automated verification                    | Passed           | 47 tests across five focused files; independent TypeScript, formatting and diff checks passed. Two earlier new integration tests timed out at the default one-second UI wait during a concurrent run. The unchanged single-worker replay passed all 47. Their cause is not established; the developer's validation log retains the failures. |
| 2. Decision controls and mobile layout       | Accepted         | Commit `9e4c7e9`; 85 tests in nine focused files, TypeScript and production build pass. Principal inspected source mutations and original-size before/after screenshots; requested explicit years, account type, compact footer/card spacing, exact closed-card balance, and one primary blocker. All corrections are included.              |
| 3. Independent browser and regression checks | Pending          | Native four-bank batch, append/cancel, mixed errors, duplicates, offline importing, seven screen setups and financial/source/network assertions.                                                                                                                                                                                             |

The implementation developer and principal reviewer are separate agents. The principal owns independent browser acceptance tests and reviews each milestone before the next proceeds. No external human review is claimed.

## Principal corrections and independent checks

The senior developer implemented the handed-off design in two milestones; each
was reviewed before proceeding. Decision actions were checked against the
existing blocker service. Financial acceptance remains separate from ordinary
warnings, presents exact figures and unread-page evidence, and does not turn
an unverified statement into a reconciled one. The rare confirmation sheet is
the only normal visible checkbox in that exceptional journey.

Review corrections included preserving every endpoint year, distinguishing
current accounts from credit cards in closed objects, retaining unknown-balance
labels, reducing the ready footer, keeping existing row decisions while adding
files and preventing a repeated drop handler. Generic exceptions no longer
repeat in a second normalised transaction checklist. Raw source evidence is
scrollable and keyboard accessible rather than clipped or broken into characters.

The first independent candidate browser run passed nine of eleven tests. The
two failures were acceptance-driver errors: an outdated fresh-Home label and
looking for an editor while its statement was collapsed during appended-file
checking. The final tests wait for batch review and open the editor as a user
would. No stored-finance assertion was removed. A separate three-setup replay
passed financial-confirmation and generic-mapping layout, focus return and
minimum input text-size checks at 320 px, 390 px with 200% text, and 1440 px.

## Preserved safety boundaries

Parsers, validation mathematics/tolerances, database schema and transfer matching policies remain outside this change. The final action must continue to call the existing validated batch commit. Read failures, missing evidence, invalid dates/amounts, unverified statements, incomplete pages and potential duplicates remain explicit. Leaving out a statement is visible and reversible before the final import.

## Device limits

Automated Chromium and WebKit checks do not replace the physical iPhone Files picker, software keyboard, safe-area and VoiceOver checklist. Physical-device sign-off is not claimed.
