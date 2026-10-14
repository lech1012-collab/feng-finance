# Final polish verification plan

Baseline: v2.2.6, commit `783ef6ffda325dae9b3979af24c793ef1622d029`.
An immutable copy of the production build is used for the before captures.
All audit records and screenshots use fictitious data dated against 14 October 2026.

1. Inventory routes and actual sheet, dialog, empty and error transitions. Capture
   matching states before changes on the seven requested viewport/theme/text setups.
2. Verify the 44 blockers and every non-Keep finding against source code and measured
   UI evidence. Do not treat the earlier implementation table as proof.
3. Fix shared controls first: sheets and toast, segmented controls and chips, list and
   key-value rows, warning/card structure, then header and typography/spacing tokens.
   Apply these components to existing flows; introduce no new product features.
4. Correct remaining screen-specific presentation gaps, including mobile column
   mapping, and expose local Undo for existing audited settings changes.
5. Run the expanded geometric, typography and accessibility audit, visually inspect
   the requested states, then run financial, storage, privacy and keyboard regressions.
6. Deliver `FINAL-POLISH-REPORT.md`, the reproducible audit and HTML report, matching
   before/after screenshot folders, and a release checklist with evidence.

## Sources and decisions

Read the Complete UX Review, v2 specification, v2.2 amendment, reference HTML and
existing layout audit. The separately named Release Readiness Review and
`feng-ui-audit.mjs` were not present in the supplied attachments or workspace.
The owner has been asked whether to use the Complete UX Review's release gate and
extend the available audit as substitutes. Do not invent the missing source.

Dark default and the Home category list have earlier explicit owner preferences
that conflict with findings D13 and H4. The owner has been asked to resolve them.
Category-parent editing also requires an explicit decision because it changes
existing analysis groupings. Preserve these behaviours pending the answer.

No financial calculation changes are authorised outside B1, B11, B28, B32 and B33.
No schema migration is planned. Real iPhone, VoiceOver and beta volunteer checks
are manual release gates and must not be reported as automated passes.
