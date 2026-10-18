# Import redesign: designer handoff and engineering acceptance

Scope: Import only. Baseline: the deployed 2.2.7 application. Review date: 18 October 2026. All examples and screenshots use synthetic statements. No parser, financial calculation, reconciliation tolerance, database schema or transfer-matching policy is to change.

## Diagnosis

The existing flow presents several simultaneous review systems: statement warnings, reconciliation acceptance, generic source review, normalised transaction review, parser settings, per-row inclusion and transfer linking. Multiple problem statements can all expand at once. This creates a long form whose visible controls are poor indicators of what is actually required. Adding another selection also replaces the existing draft batch.

The layout relies on flexible headings that compete with status chips and atomic date ranges. Long filenames, a 320 px viewport and enlarged text need separate constraints. Reducing font sizes or breaking financial values is not an acceptable fix.

## Established product patterns

This comparison uses published product help and release notes, not an authenticated usability test of those products.

| Source                                                                                                                               | Relevant pattern                                                                                                | Feng decision                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [YNAB, File-Based Import, Elevated](https://www.ynab.com/whats-new/file-based-import-elevated)                                       | Automatic column conversion, clearer payees and remembered categorisation reduce repeat work.                   | Keep native bank detection and learned rules automatic. Never send known statements through a configuration wizard merely to simplify the interface.                                          |
| [Monarch, Importing Transactions Manually](https://help.monarch.com/hc/en-us/articles/4409682789908-Importing-Transactions-Manually) | Suggested mappings and a final summary precede the import action; overlapping records have explicit handling.   | Show one batch summary and one commit. Keep Feng's conservative duplicate protection and existing history; do not adopt replacement of a date range.                                          |
| [Lunch Money, CSV / PDF Importing](https://support.lunchmoney.app/guides/import-via-csv)                                             | Rules and duplicate skipping default on; configuration can be remembered; review follows automatic preparation. | Preserve safe defaults, defer categorisation, and offer mapping only for unfamiliar or changed layouts. Keep all PDF processing on the device; its third-party PDF processing is not adopted. |

## Proposed journey

1. **Choose statements.** Home's existing Import action opens the native picker immediately. The Import page accepts multiple PDFs in one selection and desktop file drop. PDF is the primary format; existing export formats remain available as a secondary disclosure. Cancelling a picker preserves the batch.
2. **Check automatically.** One batch progress view shows completed/total files and each file's state. Process sequentially, preserving cancellation and existing source sessions. Do not ask the user to approve correctly detected bank, account, dates or rows.
3. **Review the batch.** Show a compact summary: statements ready, needing attention and skipped; show the new-transaction count without summing different currencies. A normal four-bank batch has compact closed statement objects and **zero visible checkboxes**. Opening any object reveals the account, period, exact statement figures and transactions.
4. **Resolve exceptions, one statement at a time.** Open only the first statement that needs attention. A prominent `Review next statement` action opens and focuses the next unresolved object. Opening another object closes the previous object. Show the real reason and the existing source evidence; never substitute a generic reassuring status for a failed check.
5. **Confirm once.** One persistent batch footer retains `Confirm import` and the selected new/duplicate/excluded counts. Block it until all existing blockers are resolved or that statement is explicitly left out. Final confirmation commits the selected batch and returns Home. Keep partial-commit recovery and the existing Undo receipt.

Add statements appends to the current batch and preserves reviewed drafts and source sessions. A repeated PDF is still reported and skipped. Leaving one file out is an action on that statement, with a visible way to include and recheck it. A failed file cannot silently block or disappear from the other files.

### Information hierarchy

```text
Review 4 statements                         Add statements
3 ready · 1 needs attention

[Needs attention: Barclays · account suffix]
   Reason, exact difference and next useful action
   Source / row correction when needed
   Statement figures / transactions / technical details on demand

[Ready: American Express · account suffix]
[Ready: Revolut · account suffix]
[Skipped: already imported PDF]

25 new · 2 duplicates skipped
[Review next statement] or [Confirm import]
```

Do not create a second mandatory categorisation or transfer wizard. Categorisation can wait. Preserve current transfer proposals, conflicts and automatic-link preference, but present optional linking in a collapsed batch disclosure with clear action-based decisions. A deferred link remains unconfirmed under the existing policy.

## Decision controls

- **Include a normal transaction:** the safe default, not an exposed checkbox beside every row. An opened transaction offers `Exclude transaction`; an excluded transaction offers `Include transaction`.
- **Uncertain amount:** retain the source and correction fields. An explicit `Amount is correct` action acknowledges that row only. Exclusion is an alternative. Do not bulk-acknowledge uncertain amounts.
- **Possible duplicate:** skipped by default. An explicit `Keep this checked transaction` action sets inclusion and acknowledgement for that row only. Explain the duplicate before offering the action. Never automatically merge identical purchases.
- **Exact duplicate statement:** skipped by default; restoring review is an explicit advanced action, preserving the existing override and per-row checks.
- **Statement warning:** one clearly named action acknowledges the warnings the user can see. Keep a visible accepted state and a way to undo that decision before import.
- **Unverified financial statement:** retain a deliberate confirmation sheet, exact difference/unread-page evidence and one explicit acknowledgement. This is the appropriate exceptional use of a checkbox. Acceptance never changes the validation status to reconciled, bypasses invalid source fields, or silently imports unread pages.
- **Bank/account/date/OCR/layout corrections:** progressive technical detail, not a routine checklist. Preserve all correction and reparse capabilities.

## Mobile layout contract

- Import-scoped styles only; avoid another global CSS override layer affecting other pages.
- Test 320×568, 375×667, 390×844 dark/light, 390×844 at 200% text and desktop 1024/1440.
- Minimum 44 px touch targets, primary action 48 px, inputs at least 16 px text; use shared spacing and colours.
- Statement heading: identity and status occupy their own rows when space is limited. Icons and chips cannot squeeze names into narrow columns.
- Filenames and raw unbroken source references use a bounded, keyboard-accessible horizontal region. They must not widen the page. Display names wrap at word boundaries. Do not hide real evidence with an ellipsis or arbitrary clipping.
- Periods may wrap **between complete endpoint dates**. Each date and each money value remains atomic. Do not force an entire long date range onto one line at 200% text.
- Financial rows stack deliberately at narrow widths/large text, with values aligned right. No `break-all`, shrinking text or hiding overflow to conceal layout defects.
- Keep the final action reachable above the bottom navigation and safe area. Preserve keyboard access, focus return, status announcements, source correction and scrolling with the iOS keyboard.

## Senior developer milestones and reviewer gates

1. **Batch model and journey.** Add a presentation-only batch model backed by `importBlockers`. Implement append/preserve, one expanded statement, the attention summary/navigation and single commit. Reviewer checks that skipped/duplicate/error/partial states and batch rechecks remain truthful.
2. **Decision controls and responsive layout.** Reduce repetitive checkbox decisions, preserve explicit financial overrides, progressively disclose technical and optional transfer controls, and implement the mobile contract. Reviewer inspects original-size screenshots and checks each decision's state mutation against the existing blocker service.
3. **Regression and delivery.** Run focused unit tests, full unit/build checks and relevant Chromium/WebKit journeys. Reviewer exercises the implemented flow independently, including mixed good/bad files and append/reimport. Record actual results and remaining physical-iPhone limitations.

No milestone passes on appearance alone. Keep financial assertions; change test selectors only where the deliberate interface has changed. Do not weaken a failing balance, duplicate, invalid-number, source-page, network or database assertion to obtain a pass.

## Required acceptance evidence

- Four native bank PDFs selected together: native readers, exactly 25 transactions, exact signed balances, no normal-path acknowledgement checkboxes, one confirmation, then Home.
- A second picker selection adds to the same batch, preserves prior review choices and does not write records before confirmation. Cancelling does not clear it.
- A repeated PDF is visible and skipped; valid same-day identical purchases remain distinct under existing logic.
- Mixed good/malformed files: the bad file is clearly identified, commit is blocked until resolved or left out, ready files remain available, and including a left-out file performs the required recheck.
- Failed reconciliation remains blocked; dismissing/cancelling confirmation does not accept it. An explicit override remains unverified. Invalid source amounts/dates still cannot be imported.
- Uncertain row, duplicate row and manual replacement controls mutate only the intended decision. Uncategorised rows do not force a categorisation detour.
- Mobile screenshots and geometry checks include long filenames, long descriptions, large text, statement figures, row editing, generic mapping, warning confirmation and the final footer. Assert no page overflow or clipped/wrapped financial values. Include keyboard and automated accessibility checks.
- Import causes no financial upload. Offline multi-PDF import remains covered. Existing account/date/source traceability, cancellation, partial commit recovery and import Undo still pass.
