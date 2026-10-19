# Import correction and resume: UX handoff

Reviewed against Feng Finance 2.2.9 on 19 October 2026. This document concerns
the import journey only. The user reports that ambiguous amounts still cannot
be typed, transaction objects still move horizontally, and navigating to
another tab loses an unconfirmed batch. Treat these as unresolved failures;
the previous automated pass is not evidence that the user's journey works.

## Measured baseline and review status

The principal engineer reproduced the deployed behaviour with fictitious PDFs,
an actual tap and sequential key events, rather than programmatic `.fill()`:

| Check                       | Observed 2.2.9 baseline                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native amount entry         | The visible field remained `-81.00` after attempted typing; it had the `readonly` attribute and was not editable.                                                       |
| Leave and return            | Two selected statements before navigation; Import opened the system picker; zero statements after returning to the route.                                               |
| Horizontal filename surface | 324 CSS px available, 1,184 px scrollable content, `overflow-x: auto` and `white-space: nowrap`. A bounded page therefore still contained a horizontally movable strip. |

Evidence is retained in the task workspace at
`/workspace/feng-import-session-fix/baseline.json`. It contains synthetic
measurements, not real financial statement contents.

The first implementation candidate was reviewed through source inspection and
actual-size screenshots. It retains the import surface, hidden and inert,
across ordinary application routes; suspends its modal while inactive;
provides directly actionable amounts; portals the correction panel outside
cards; wraps source names; distinguishes resume from Add statements; and
introduces explicit discard. These choices match this handoff. Session
retention applies to ordinary navigation/back within the same running shell.
Reload, app-lock remount and browser/process termination release memory-only
sources; the UI must not promise restoration after those events.

The initial six-case Chromium acceptance run passed the 320 px, 375 px and
390 px at 200% text amount-entry/width journeys and the explicit discard
journey. Two cases stopped before completing: one searched for a merchant
absent from the current fictitious fixture, and one found duplicate source and
normalised amount targets after reparse. The first is a driver-fixture mismatch;
the second also exposes unnecessary duplicated review UI. These are not final
release results. The reviewer approved collapsing the normalised `All
transactions` presentation when its amount is opened for source correction,
while retaining all data and separate duplicate/manual-replacement checks.

The large-text screenshot at 390 × 480 px also exposed a usability issue
beyond width: a three-line dialog heading and stacked footer actions leave a
very small content viewport. The approved correction is a `Correct amount`
title, one full-width `Save amount` footer action, and a 44 px header Close
control with the accessible name `Cancel correction`. Use a correction-scoped
heading size of 1.25 rem and line-height 1.25, respecting enlarged text. Keep
source comparison, Money direction and the live Amount field reachable by
scrolling. A passing page-width assertion alone does not sign off this layout.

Final browser reruns, financial regression results and physical iPhone
qualification must be recorded separately by the principal engineer after
these corrections. The reviewer has not claimed physical-device validation.

The rebuilt compact-editor screenshots have now passed the UX visual
checkpoint. At 320 × 480 px the Amount label/input, both direction controls,
supporting explanation and single Save action are readable. At 390 × 480 px
with 200% root text, the shortened heading fits on one line and the transaction
identity, source crop and entered amount remain visible above the single Save
footer. The panel retains a useful vertical content viewport. Money direction
and additional details may require scrolling at enlarged text; this is
intentional and must remain keyboard/touch accessible. The visual checkpoint
does not substitute for the principal's complete financial and browser rerun.

## Findings from the implementation

| Finding                                                               | Evidence                                                                                                                                                                                                                                                   | Consequence                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import state belongs to a route, rather than the user's pending work. | `Import.tsx` owns `entries`, review decisions, operation cancellation and PDF-session references. Its unmount cleanup aborts work and calls `releaseAllSessions`. `App.tsx` clears `selectedFiles` when import starts and mounts Import only at `/import`. | Changing tabs destroys the only usable copy of the review. Returning cannot reconstruct it without asking for the PDFs again.                                                                                                                       |
| The Import tab is implemented as Add files.                           | Desktop/sidebar import and the mobile Import navigation intercept their click and call `openImportPicker`.                                                                                                                                                 | A user trying to return to their work gets the system picker instead. Navigation and adding files are indistinguishable.                                                                                                                            |
| An apparent amount input can deliberately reject typing.              | `ImportTransactionReview.tsx` still renders a textbox with `readOnly={!!d.bankSource}` and a separate `Correct amount` control. Other rows use an inline `onBlur` edit, while generic source rows open `SourceRowCorrection`.                              | The same financial object has three editing behaviours. A field that looks editable is blocked on a common path.                                                                                                                                    |
| The correction panel is inside expanding row containers.              | `GenericReviewRow` renders `SourceRowCorrection` within its conditional content; `Sheet` returns its dialog inline rather than using a document-level portal.                                                                                              | Closing/replacing an ancestor during reparse can remove the editor. Broad ancestor event handling and import-specific sizing also apply to a modal that should have an independent lifecycle. This is a risk to test, not a proven browser failure. |
| Some horizontal movement is intentional in current CSS.               | `Import.css` gives `.import-raw-reference`, `.source-filename` and `[data-source-text]` horizontal scrolling and `white-space: nowrap`. Generic mapping has a separate two-dimensional table.                                                              | A bounded document can pass a width test while text strips still pan beneath a finger. The user's requirement is a stationary transaction card, not merely a stationary document.                                                                   |
| The regression harness does not cover real text entry.                | `import-amount-correction.spec.ts` uses `.fill()` to enter the amount. Its WebKit horizontal check uses mouse dragging, not physical iPhone touch panning.                                                                                                 | Editable properties and a successful programmatic value replacement do not establish that a tap followed by ordinary keystrokes works on each live ambiguity path.                                                                                  |

Do not infer the exact Beauty Code statement layout from the synthetic fixture.
Use source-preserving real-layout regression input locally where available,
and fictitious fixtures in the repository. Do not include real statements or
their contents in screenshots, public issues or this document.

## Design decision

The user has one pending import session containing one or several statements.
They can leave it and return without losing work. Each ambiguous transaction
has one directly editable amount object. Correction happens in one stable
panel; the list never becomes a draggable or horizontally scrollable surface.
The final import remains a deliberate, validated write to the ledger.

This follows the object-first and exception-first principles in the
[existing import handoff](import-ux-redesign.md): select PDFs together, review
only exceptions, confirm once, return Home. It does not add a new wizard or a
second set of financial acknowledgement controls.

## Intended journey

1. **Start.** With no pending session, Home's Import statement and the Import
   navigation open the system picker in the user's tap gesture. Select several
   PDFs at once. Cancel does not change existing records.
2. **Check.** Open the batch with per-file progress. Reading occurs locally and
   sequentially. Files retain stable identities and positions. Moving to
   Transactions, Home or another tab does not abort or discard the session.
3. **Review.** Show the number of selected statements, the number needing
   attention, and each statement's actual status. Expand the first exception.
   Ready statements need no acknowledgement. `Add statements` opens Files and
   appends; it never replaces the existing batch or reviewed choices.
4. **Correct an amount.** Tap the displayed amount itself, including
   `Amount unread`, on the ambiguous transaction. The amount is an accessible
   button styled as an editable value, not a disabled-looking textbox. On
   desktop use click or Enter/Space. Open the same editor for bank-specific,
   generic, image/OCR and fallback rows.
5. **Enter the source value.** A fixed panel identifies the transaction and
   shows its original source row. Its real Amount input receives focus. Enter
   unsigned decimal digits; Money out/Money in makes the sign explicit and
   does not require a minus key. Preserve a reliably read direction, but require
   a choice when the direction is unknown. Do not guess from merchant name.
   Additional invalid source fields must be visible and identified. Unrelated
   technical options remain collapsed.
6. **Save the correction.** `Save amount` validates the input, records a source
   correction and reruns the existing statement checks. Show `Checking…` on
   that statement, then its truthful new status. Restore focus to the same
   transaction's amount and retain the surrounding scroll position. A balance
   mismatch remains visible and blocking under the current financial policy.
   Cancel abandons that editor's unsaved changes only.
7. **Leave and resume.** Ordinary navigation simply suspends the visible
   review. The Import tab shows a small pending count or attention dot and
   returns to the existing batch without opening Files. Resume preserves
   file order, completed extraction, corrections, category decisions,
   duplicate choices, exclusions, expanded statement, and review position.
8. **Finish.** One Confirm import applies existing financial guards and writes
   the selected batch. After success, release source sessions and go Home.
   A partial save keeps unsaved statements and accurate outcomes available;
   returning must not import already saved statements twice.

The main sequence with four correct native statements is still one file
selection and one confirmation. An ambiguous amount adds one direct editor,
one value entry, an explicit direction only when needed, and one Save.

## Session states and actions

| State                | User sees                                                                             | Import navigation                                  | Allowed exit/next step                                               |
| -------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| Empty                | Import entry point                                                                    | Open Files picker                                  | Select or cancel                                                     |
| Reading              | Named files and progress                                                              | Resume progress                                    | Navigate away, stop reading explicitly, or wait                      |
| Needs attention      | Exact exceptions and ready-file count                                                 | Resume batch                                       | Correct source, leave out a file, add PDFs, or navigate away         |
| Editing amount       | One focused correction panel                                                          | Background navigation is inert while modal is open | Save or cancel the row editor; no background drag                    |
| Ready                | Statements and one confirmation                                                       | Resume batch                                       | Confirm, add PDFs, navigate away, or discard explicitly              |
| Saving               | Current batch save progress                                                           | Resume save status                                 | Prevent concurrent save/discard; preserve validated partial outcomes |
| Partially saved      | Exact saved outcome and remaining work                                                | Resume remaining work                              | Retry remaining files or discard only the unsaved remainder          |
| Completed            | Home with import result                                                               | Start a new selection                              | Source resources released                                            |
| Discard confirmation | Name/count of unsaved statements; no implication that imported ledger data is deleted | Remains in current session                         | Keep review or Discard review                                        |

`Close import review` means **leave review**, not discard. Prefer the accessible
label `Leave review` and a brief first-use status such as `Your review is kept
while Feng stays open`. `Discard review` is a separate secondary action in the
review's overflow area. Confirm only this destructive action: `Discard this
review? Your unsaved corrections and selected PDFs will be removed. Imported
transactions will stay.` Do not show a discard warning whenever a tab is used.

## Correction interaction contract

- The displayed amount is a minimum 44 × 44 CSS px target with an accessible
  name identifying the action and transaction, for example `Correct amount for
Beauty Code`. An unread amount is an actionable `Amount unread` value.
- Do not retain competing read-only financial textboxes on the primary review
  path. Source dates/amounts that are not currently being edited are text or
  actionable values. Keep source evidence immutable internally; a manual
  correction is an explicit reviewed overlay followed by revalidation.
- Render the correction dialog in a document-level portal, outside `<details>`
  and statement cards. Keep its local typed value stable through parent renders.
  The panel owns its form; avoid nested forms and summary click handlers.
- Do not replace or parse the Amount value on every keystroke. Allow temporary
  ``, `0.`, `12.` and decimal input while typing. Validate on Save, show an
  adjacent error associated with the field, and keep the value editable.
- If currency or another prerequisite is absent, explain it next to the editor
  and expose the specific required control. Do not show an unexplained disabled
  Amount input or send the user through unrelated parser settings.
- Save must use the existing correction and reconciliation services. It must
  not directly change immutable native bank proof or silently acknowledge a
  different source row. If source matching is not unique, keep the selected
  transaction identified and ask the user to choose the source row explicitly;
  do not guess from amount alone or open an unrelated first row.
- Cancel/Escape closes only the editor and returns focus to its opener. Save
  closes after a valid correction is accepted for rechecking. Invalid Save
  keeps the editor open and focuses/announces the actual invalid field.
- Keep one `Save amount` action in the footer. The 44 px header Close control
  is the cancellation action, named `Cancel correction` for assistive
  technology. Avoid duplicating Cancel in the footer, especially at enlarged
  text and reduced keyboard height.
- One modal at a time. Do not stack mapping, risk acceptance and correction
  dialogs. Opening one preserves the underlying review without a second inert
  layer. A dismissal must never accept financial warnings.

## Mobile layout and movement contract

| Element                              | Required sizing/behaviour                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Review surface                       | Viewport width; every flex/grid child can shrink with `min-inline-size: 0`; no horizontal page scroll                           |
| Statement and transaction card       | Fixed inline position; 16 px internal inset; 12 px inter-card gap; no drag or swipe affordance during import                    |
| Amount target and secondary controls | At least 44 CSS px touch target; primary Save at least 48 px; values stay legible                                               |
| Amount input                         | At least 16 px text, 48 px height, full available width, text/decimal input mode, no width change while typing                  |
| Merchant and filename                | Preserve exact text but wrap within the object, including long unbroken references; no touch-scroll strip in normal review      |
| Financial values                     | Atomic numbers; stack labels/value rows when needed rather than breaking digits or forcing the page wider                       |
| Correction panel                     | Fixed to visual viewport; bounded width; own vertical scroll; visible header and reachable actions above keyboard and safe area |
| Background while correcting          | Inert and scroll-locked, preserving both x and y position; no card or document translation                                      |
| Source crop                          | Bounded image, no native image dragging; allow meaningful magnification without making the surrounding card movable             |
| Advanced mapping table               | The only necessary 2-D scroll area; explicitly named and confined to advanced mapping, never the main transaction row           |

Use import-scoped styles or a dedicated correction-panel class. Portalling a
dialog must not accidentally remove the import input/spacing rules because
they currently depend on an `.import-workspace` ancestor. Preserve text
scaling and pinch zoom. Do not disable all touch actions or hide page overflow
to conceal an oversized child. Apply wrapping to raw descriptions and
filenames; preserve exact source content through copyable text and the crop.

## Developer handoff

1. **Move session lifetime above routing.** An app-owned in-memory controller
   must own the selected `File` objects, extraction sessions, draft entries,
   operation/abort state and review choices. A mounted review surface may be
   retained while inactive, or state may be supplied to a remounted route. In
   either design route unmount is not session disposal. Avoid duplicating
   mutable state across the shell and route.
2. **Separate commands.** `openImport` resumes a pending session; otherwise it
   opens Files. `addStatements` always opens Files and appends. Explicit
   `discardSession` aborts outstanding work, invalidates late results, disposes
   workers/crops/object URLs and clears only the unsaved review. Successful
   final commit releases the completed source session.
3. **Protect the session from reload triggers.** A pending import must suppress
   automatic/service-worker update reloads even while another route is visible.
   Manual Update should explain that the current review must be completed or
   discarded first. Browser reload/close cannot be promised resumable while
   source PDFs remain memory-only; use the existing safe unload mechanism where
   supported and state the limitation truthfully. No original PDFs, raw source
   text or hidden source blobs are persisted by default.
4. **Unify amount correction.** Make amount objects on all ambiguity paths open
   one portal-based editor. Resolve a stable row identity, preserve the active
   row through reparse, and retain genuine keystrokes. Keep native source
   immutability and existing financial blockers intact.
5. **Remove apparent movement.** Wrap raw references and filenames in normal
   review; constrain dialog/card descendants; maintain background scroll
   position while the keyboard/visual viewport changes. Audit real inner
   scroll regions, not only `document.scrollWidth`.
6. **Verify as a user.** Click/tap the visible amount and enter digits with
   ordinary key events. Exercise every currently rendered ambiguity route,
   including native low-confidence evidence, generic ambiguous readings,
   unread amounts, OCR rows and reparse fallback. Keep the old programmatic
   tests as complementary coverage rather than replacing this journey.

## Manual correction must not wait for OCR

Browser review exposed a further cause of apparently blocked entry. Opening a
native-bank amount selected the generic source view, which waited for
Tesseract's numeric-cell check before mounting the manual editor. The WebKit
case remained at “Checking an amount on page 1” until its editor deadline.

An explicit manual-correction request now sets `skipCellOcr` for that source
reading, matching the existing manual row-correction path. It retains embedded
source evidence, confidence, reconciliation and import blockers. Automatic OCR
fallback for scanned statements is unchanged. A regression holds `readCells`
unresolved forever and proves that the manual editor still opens, a wrong
correction remains blocked and original source values remain unchanged.

## Measurable acceptance criteria

- Select Barclays debit, Barclaycard, Amex and Revolut synthetic PDFs together.
  Leave for Transactions during reading and again during review. Returning via
  Import resumes the same batch without a filechooser event, duplicate
  extraction or lost manual choices. No ledger records exist before Confirm.
- Cancel Add statements and retain the batch byte-for-byte. Append another PDF
  and retain prior corrected values, review decisions, duplicate exclusions,
  file order and account identities. A repeated PDF remains explicitly skipped.
- Tap the visible ambiguous amount itself, then use real sequential keystrokes
  to clear, enter and edit decimals. The caret and focus remain in the input.
  Repeat for native, generic, OCR and fallback source states; a text property
  or `.fill()`-only test is insufficient.
- An unread Beauty Code fixture can be corrected to a known signed amount. The
  resulting statement's expected totals, calculated closing balance, signed
  stored amount, booking date and source-page identity match independent test
  expectations. A wrong amount still fails reconciliation.
- Invalid numbers, excess decimal precision, missing required direction or an
  invalid source date cannot silently close/accept the correction. Cancel has
  no financial effect and preserves the batch. Correcting one row must not
  acknowledge another row or alter its category.
- At 320, 375 and 390 CSS px, 200% text, portrait/landscape and keyboard-reduced
  height: document/card x positions remain fixed; normal review text has no
  horizontal scrolling region; there is no clipped input, footer or financial
  value. Test an actual horizontal touch gesture on iPhone, not only mouse
  wheel simulation. Preserve vertical scroll and useful PDF magnification.
- Navigation back to import does not reopen Files. Close review resumes later;
  explicit Discard requires a clear confirmation, releases resources, and
  leaves already imported transactions intact. Late processing results after
  Discard cannot revive the old batch.
- Pending review blocks unsafe update reloads from every route. Normal
  in-app navigation and offline navigation preserve the memory session. A
  fresh browser load is not represented as retaining PDFs.
- Exactly one accessible modal is active. VoiceOver/keyboard users can identify
  the transaction and Amount field, reach Money direction and Save, understand
  field-specific errors and return to the original transaction after closing.
- A successful batch still confirms once, lands on Home and shows the correct
  ledger. Partial save/retry does not double-import saved statements. Financial
  reconciliation, invalid-source, duplicate and privacy guards remain unchanged.
- Import/resume/correction sends no financial information to a remote endpoint.
  Only fictitious financial data appears in committed fixtures and screenshots.

Automated Chromium/WebKit results must be reported separately from physical
iPhone Safari/installed-PWA testing. The original user's symptom remains open
until the direct amount-entry and horizontal-touch journey has been exercised;
do not equate a passing width check with a verified mobile correction flow.
