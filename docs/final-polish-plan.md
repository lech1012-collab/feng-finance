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

All six supplied sources were read: the Complete UX Review, v2 specification,
v2.2 amendment, Release Readiness Review, original reference HTML and supplied
Playwright audit. The Release Readiness Review actually places sizing in section
4, Settings in section 5 and the release gate in section 7; its own headings are
used in citations.

The owner approved the review's System default and top-five Home category list
with All categories. Saved Light and Dark preferences remain honoured. Existing
category parents remain unchanged by explicit owner decision. B24 now includes
an explicit, reversible same-bill/separate-bills confirmation. Its decisions stay
local, survive backup and do not change imported transactions or balances.

Financial calculation changes remain limited to B1, B11, B28, B32 and B33, plus
the explicitly approved B24 recurrence identity flow. The ECB backup-cache repair
changes schema validation of cached quote codes, not conversion arithmetic or
supported ledger currencies. No destructive schema migration is introduced.
Credential-changing Undo is a pending owner decision; credential material must
not enter persistent change logs or backups. Real iPhone, VoiceOver and beta
volunteer checks remain manual gates, never automatic passes.
