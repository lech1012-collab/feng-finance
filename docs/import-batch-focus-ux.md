# Multi-statement import: attention-first review and final confirmation

UX review: 20 October 2026. Scope: the import journey following 2.2.10.
This handoff supersedes the persistent confirmation-footer recommendation in
`import-ux-redesign.md`. The financial checks and source-correction journey
remain authoritative.

## Decision

Put **Confirm import at the end of the review content**, in normal document
flow. It must not stick to the viewport, overlay a statement, or sit above
the bottom navigation while the user scrolls. Default the completed batch to
**Needs attention**, with **All statements** available beside it.

This is preferable to a smaller persistent bar. The user's screenshot shows
many already-imported statements and a large disabled confirmation covering
the content needed to resolve two exceptions. Filtering removes the irrelevant
scrolling; an ordinary final action then remains easy to reach without taking
away review space. The established mobile navigation can remain fixed.

## What the current implementation does

- `batchPresentation` already obtains attention state from `importBlockers`
  and sorts exceptions first, but `Import.tsx` renders every statement.
- The current footer inherits `position: sticky` from `styles.css` and several
  mobile bottom offsets. Import-specific `bottom` rules do not remove that
  positioning, so the large footer remains over the review as the user scrolls.
- The batch's save guards, duplicate accounting and transfer preview use the
  complete entries collection. That separation is correct and must remain.

## Revised journey

1. **Pick together.** Select any supported combination of PDFs in one picker.
   Add statements continues to append. Cancelling a picker changes nothing.
2. **Check automatically.** Show per-file progress and Stop processing. Do not
   render the final confirmation region during initial processing. Errors and
   cancellations retain the existing explicit review requirements.
3. **Show only useful work.** When checks finish, show a compact batch summary
   and the two view controls. Needs attention is selected for a new batch.
   Ready, saved and skipped cards are absent from this view's layout and
   accessibility tree. They remain in the batch and are available under All.
4. **Review one exception.** Open the first unresolved statement, preserving
   the existing direct amount entry, source evidence, correction, financial
   override and explicit exclusion capabilities. Review next statement opens
   the next actual unresolved statement and focuses its heading.
5. **Finish a correction without losing the object.** Keep the active expanded
   exception visible through rechecking and after its last blocker resolves.
   Its status changes to Ready. Immediately after the statement card, a small
   message says **This statement is ready.** and offers **Continue**. Continue collapses it and moves to the
   next unresolved statement, or to the final import summary when none remain.
   Closing its own summary also releases this temporary visibility.
6. **Confirm once at the end.** The compact final region reports the whole
   batch's real outcome, then offers Confirm import. It follows the review and
   any optional transfer detail in ordinary flow. A successful confirmation
   keeps the existing one-write journey and returns Home.

An explicitly excluded active statement can likewise remain temporarily with
**This statement will be skipped.** and Continue. The resolved message/action
belongs after the card inside its review wrapper, rather than only at its top:
someone correcting a row near the bottom should move forward, not scroll back
through a long card. Use one Continue action, not duplicated top/bottom controls.

Continue is a navigation convenience, not a new required acknowledgement.
The user may confirm directly when the existing financial gates permit it.
No extra consent checkbox, mandatory categorisation or transfer wizard is added.

## States and exact content

| State                                       | Default visible statement cards                                                     | Final region                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Files being checked                         | Processing list with every selected file's progress                                 | Not rendered during initial checking                                                          |
| Mixed batch                                 | Only actual attention statements, plus an active correction retained until finished | Whole-batch outcome; Confirm disabled with the truthful reason until existing gates permit it |
| All ready                                   | No long list; `No statements need attention.` and truthful ready/skipped counts     | New records and/or balance updates; enabled Confirm when ready                                |
| Only duplicates or explicitly skipped files | No long list; `No statements need attention.` and truthful skipped count            | `No changes to save.` and Back to Home, if the existing `hasChanges` calculation is false     |
| Last exception just resolved                | Keep that expanded object temporarily with `This statement is ready.` and Continue  | Actual whole-batch outcome; Continue moves to this region                                     |
| Explicit All statements view                | Every statement, including skipped/saved, with its real state and existing detail   | Same batch outcome and same guards; filter never changes them                                 |
| Partial save/retry                          | Preserve saved/failed states and all current recovery controls                      | Report actual saved/remaining outcome; never save an already-saved statement twice            |

Zero new transactions does not always mean no changes: a reconciled balance-only
statement may still require a balance update. Use the existing financial
`hasChanges` calculation, not a new UI heuristic. Likewise a failed statement
with zero extracted transactions still needs attention.

Back to Home in a completed no-change batch completes and releases that pending
memory-only session. It must not leave an invisible duplicate-only batch to be
resumed later. This action requires review phase, no operation in progress, no
blockers and no changes to save; it must never delete existing financial records.

## Controls and accessibility contract

- Use a group named **Statement view** containing two ordinary buttons:
  **Needs attention (N)** and **All statements (N)**. Use `aria-pressed` for
  selected state. This is a list filter, not two unrelated page tabs.
- Needs attention's number is the current authoritative blocker count. All
  statements' number is the entire selected batch, including skipped/saved.
  A temporarily retained ready card is not counted as needing attention.
- Counts may update without replacing or blurring the focused filter button.
  Announce the concise batch status politely; do not announce every row or
  force repeated screen-reader announcements during parsing.
- Leave Needs attention selected when its count reaches zero. Do not silently
  switch to All and reintroduce the long list. A user can choose All at any time.
- Preserve an explicit filter choice through Add statements, corrections,
  ordinary tab navigation and resume. Reset it to Needs attention only when
  starting a genuinely new batch after confirmation or discard.
- Filter switching changes presentation only. Retain existing mounted review
  components/drafts and source sessions; use hidden wrappers rather than
  unmounting the editing subtree and losing a draft or modal state.
- Keep statement wrappers in their original selection order in both views.
  The attention filter already gives exceptions priority without sorting their
  DOM positions. Changing an expanded statement from attention to ready must
  not move it below other statements while the person is finishing that object.
- Pin only an expanded object that actually needed attention. Opening an
  originally ready or skipped statement under All must not pin it into the
  attention view. Preserve an active pin through its temporary checking state.
- Continue, after the card, must remove/collapse the resolved pin and open/focus the next real
  attention heading. When there is no next exception, focus and reveal the
  final **Import summary** region (`tabIndex=-1`, suggested ID
  `import-confirmation`). It contains the actual confirmation button; Continue
  itself never saves financial records.
- Closing a pinned summary also releases it and moves focus somewhere visible,
  to the next attention heading or final region. Do not leave keyboard focus
  inside a hidden object or open the system file picker.
- After a user changes the filter, retain focus on the filter. No automatic
  scroll to a newly hidden card. A review-next action may reveal its target.
- Keep failure messages, financial warnings and batch-level transfer conflicts
  independent of list filtering. An error cannot disappear merely because its
  card is not rendered in the chosen presentation.

## Mobile and desktop sizing

- The filter belongs to the compact review summary and scrolls normally with
  the page. Each target is at least 44 CSS px high. Two equal flexible columns
  may wrap text or become rows at enlarged text; never require horizontal pan.
  Use a font-relative minimum so 200% text can stack the controls instead of
  squeezing the word `statements` against its button edges. Retain actual
  wording and readable inset; do not shrink labels or use ellipses.
- The final action group has no elevated floating container, shadow, viewport
  bottom offset or sticky/fixed positioning at any breakpoint. Use an ordinary
  separator, about 12 px vertical padding and 8 px internal gaps.
- Confirm remains a clear primary action, at least 48 px high. On mobile it
  spans the available content width. On desktop it can use its natural width
  beside the summary. The container should use only its content height.
- Normal-size summary text is approximately 14–16 px with a readable line
  height; one or two compact lines are sufficient. Reflow at enlarged text
  rather than setting a fixed/max height or clipping outcome counts.
- Existing page padding must let the last action scroll fully above the fixed
  navigation and safe-area inset. Do not recreate space-consuming sticky
  offsets as a large empty spacer. Do not make cards or figures horizontally
  scrollable to compensate for the layout.
- Source-correction sheets retain their separate keyboard-aware footer. This
  change concerns only the batch confirmation region, not the amount editor's
  Save amount control.

## Financial invariants for the developer

View filtering must not modify `skip`, transaction `include`, duplicate
acknowledgements, overrides, categories, transfer choices, source actions,
account identity, validation status or stored records. Use the complete batch
for every count, blocker check, transfer preview and save operation.

Ready statements hidden in the attention view still import. Skipped statements
stay skipped for their original financial/user decision. Every error and real
blocker remains a blocker in either view. No implicit acceptance, silent
exclusion, parser-policy change, reconciliation relaxation, duplicate override,
database migration or new network communication is part of this design.

## Developer/reviewer gates

1. **Presentation logic:** show a mixed large batch with many duplicates and
   two failing statements. Needs attention displays only the two failures.
   All reveals the complete batch. Changing filters changes no financial data.
2. **Correction lifecycle:** start a real typed amount correction, recheck,
   switch routes and resume. Input/session state survives. A resolved expanded
   card remains stable until Continue/close; that action focuses the next
   exception or final summary without committing anything.
3. **Commit semantics:** hidden ready statements still save with their exact
   expected signed amounts and balances. Failed reconciliation continues to
   block. Duplicate-only, balance-only, explicitly excluded and partial-retry
   cases show truthful outcomes and retain existing protections.
4. **Actual geometry:** at 320×568, 390×844, enlarged text, reduced keyboard
   height and desktop: assert static positioning and that the final region
   moves with document scroll. No review content is covered. The final action
   can scroll fully above bottom navigation and safe area.
5. **Visual review:** inspect original-size screenshots of mixed attention,
   all-ready, duplicate-only, explicit All and the scrolled final action in
   dark/light. Check hierarchy and real content, not only viewport width.
6. **Release verification:** run relevant unit/browser tests, financial/privacy
   regressions, production build and release checks. Record automated evidence
   separately from physical iPhone Safari/installed-PWA testing.

The review approves the design above for implementation. Final implementation
sign-off requires the actual browser evidence; this document does not claim
physical iPhone testing or successful deployment.

## Candidate visual review

The UX reviewer inspected the first candidate's synthetic Chromium screenshots
at 320 px, 390 px, 390 px with 200% text and 1440 px, plus WebKit's 390 px
multi-statement final state. Evidence is in the task workspace under
`/workspace/feng-import-attention/new-flow-results`.

- The mixed 21-file batch displays only its two attention statements by default.
  All statements reveals the full batch and retains truthful counts.
- The final 48 px mobile button has no surrounding floating box and no content
  overlap. The scrolled 320 px and enlarged-text final states keep it readable
  above bottom navigation. Desktop uses a compact natural-width action.
- An empty review list left roughly 72–78 px of dead space before the final
  summary. The developer removed its inherited padding/layout contribution and
  duplicate adjacent margin. The rebuilt all-ready and duplicate-only screenshots
  confirm the intended compact spacing, using a 28 px normal-text layout gap.
- At 200% text, the initial fixed two-column filter left insufficient inset around
  `statements`. The refined font-relative grid stacks the controls when the
  labels no longer fit. The rebuilt enlarged-text screenshot confirms a readable
  one-column layout, preserving wording, target size and text scaling.
- The rebuilt duplicate-only state explicitly says `No changes to save.` in the
  final summary and offers Back to Home. It no longer displays a disabled
  confirmation or an unexplained empty review. Financial completion/cleanup is
  separately covered by the principal engineer's browser regression.

The refined screenshots are in
`/workspace/feng-import-attention/verified-results`. The UX reviewer approves
the refined visual candidate within the reviewed synthetic journeys. The final
action is compact, follows the content and does not obscure review. The default
view limits the list to useful work while keeping All statements available.

At enlarged text, the filter group may require normal vertical scrolling to
bring both controls above the fixed app navigation. Evidence screenshots should
center that group rather than treating a partly below-fold control as a layout
defect. The controls and final action must remain reachable by ordinary scroll;
the principal engineer verifies this with viewport/scroll assertions.

This visual sign-off does not claim that the complete browser suite, deployment
or physical iPhone review has completed. Record automated financial/interaction
checks and release results separately after their final rerun.
