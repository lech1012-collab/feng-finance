# UX review implementation and validation guide

The designer's review covers desktop screenshots and proposed mobile flows. This
guide maps the 24 numbered findings to the implemented behavior and gives a
repeatable review route. Automated browser checks do not establish that native
iPhone Files, Add to Home Screen, safe areas or calendar alerts have been tested on
a physical device.

## Review recommendations

| #   | Recommendation                          | Implemented behavior and review target                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Make partial balances unmistakable      | Home separates cash, card debt and net position. Coverage states how many accounts have reconciled balances. Net position is unavailable while an active account lacks a verified balance; a missing account offers Import. Card-only data is not presented as net worth.                                                                                     |
| 2   | Distinguish missing history from zero   | Cash-flow and balance charts use unavailable values and broken lines across missing or unverified coverage, with missing-period explanations and hatched placeholders. A verified month with no movement may show zero. Partial months are visually qualified. Check the value table in Analyse as well as the chart.                                         |
| 3   | Gate month comparisons                  | A month-over-month change appears only when both months have complete verified coverage. Otherwise Home explains that the selected month or comparison month is incomplete.                                                                                                                                                                                   |
| 4   | Distinguish unavailable income          | Without an imported income-bearing account, Home and Analyse state that no income source is imported. Net is unavailable where an income source is missing; partial figures are explicitly from imported accounts.                                                                                                                                            |
| 5   | Use one analysis scope                  | The month stepper and 1/3/6/12-month range drive the analysis dates, totals and charts together. Custom dates remain available and are explicitly labeled.                                                                                                                                                                                                    |
| 6   | Make the currency filter visible        | Settings calls the preference **Show accounts in**. A persistent notice identifies other-currency accounts hidden from the current view. Original amounts are never converted, mixed or changed.                                                                                                                                                              |
| 7   | Avoid inert balance ranges              | Balance range controls appear only when enough verified history exists. A selected range without a comparable baseline explains the missing comparison instead of showing an invented percentage.                                                                                                                                                             |
| 8   | Prioritize Home                         | Home leads with position and this month's cash flow, followed by at most three actionable to-dos, spending, trends and concrete upcoming payments. Planning is represented by actual upcoming items rather than a generic navigation card.                                                                                                                    |
| 9   | Explain excluded transfers              | A **Not counted** line separates movements between owned accounts from card repayments and links to the corresponding transaction list. Import's Money in/Money out still includes those statement movements.                                                                                                                                                 |
| 10  | Expose the sorting workload             | The Uncategorized shortcut includes the outstanding count and receives primary emphasis. Home's sorting action opens the uncategorized queue. Transfers are not counted as uncategorized spending.                                                                                                                                                            |
| 11  | Make direct manipulation discoverable   | First-use guidance is specific to the input device. Desktop rows expose a drag handle and Categorize action; mobile offers direct tap/swipe entry. Keyboard hints belong inside sorting controls.                                                                                                                                                             |
| 12  | Give categories stable identities       | Category badges use a fixed category color dot, shared with spending charts. Uncategorized has a dashed treatment. Text states the actual category, so color is supplementary.                                                                                                                                                                                |
| 13  | Explain automatic learning              | A saved manual choice states the learned merchant/account/category scope and offers Undo. Settings lists personal rules with match, account, category, matching transaction count, recorded last use and edit/delete. Transaction details identify known manual or rule origins and link to the rule editor.                                                  |
| 14  | Separate data colors from page palettes | Income, spending, net and transfer colors remain consistent across sections. Section accents affect chrome rather than financial meaning. Green is absent. Warning and blocking treatments remain explicit in text.                                                                                                                                           |
| 15  | Match desktop expectations              | Desktop starts with a primary Import action, then Home, Transactions, Analyse and Planning. Settings is at the bottom. The page and navigation both say Home.                                                                                                                                                                                                 |
| 16  | Compact account filtering               | Transactions uses account chips with balance and statement date that also filter the list, rather than repeating Home's entire position dashboard.                                                                                                                                                                                                            |
| 17  | Keep empty insights small               | Without sufficient verified comparison history, the insights area collapses to a short explanation. When evidence exists it presents mathematical changes and links to their supporting transactions.                                                                                                                                                         |
| 18  | Clean merchant presentation             | Lists display a readable merchant name while keeping the original bank description searchable and available in details. Display cleanup does not alter statement amounts, fingerprints or stored source identity.                                                                                                                                             |
| 19  | Use readable UK dates                   | Dates and ranges use UK presentation formats. Machine-readable stored dates and export dates remain ISO values.                                                                                                                                                                                                                                               |
| 20  | Support touch and larger text           | Mobile controls retain at least 44px targets, with readable body/secondary text and responsive layout. Check 320, 390 and 430px widths and 200% text scaling; native iOS scaling remains a manual check.                                                                                                                                                      |
| 21  | Use desktop space for sorting           | Transactions uses a wider list with a persistent category drop rail. Explicit multi-selection can be categorized together and undone as one operation. The popup remains available as an alternative.                                                                                                                                                         |
| 22  | Simplify Settings                       | Settings uses short help and optional Learn more disclosures. The statement review day is left aligned and compact. Backup shows the last download handoff date/count and warns after 30 days.                                                                                                                                                                |
| 23  | Fix recurring-charge grammar            | Home uses singular **charge** for one result and plural **charges** otherwise.                                                                                                                                                                                                                                                                                |
| 24  | Separate data safety actions            | Backup, Restore and Danger zone are distinct groups. Restore previews accounts, transactions, statements, personal rules and format/schema versions before replacement confirmation. Delete imported records keeps accounts, categories, rules and settings. Erase everything requires the exact text **ERASE**; both destructive paths offer a backup first. |

## Learning and financial safeguards

### Remaining review fixes in 1.9.2

The attachment supplied again on 8 October 2026 is byte-for-byte identical to the
original review, which describes v1.8.3. The 24 recommendations above already
guide v1.9.1; this release corrects remaining observable gaps rather than treating
the older screenshots as a new design.

Cash-flow charts now render spending below zero with valid SVG rectangles and a
visible zero baseline, including expense-only histories. Missing observations
still have no bar or joined net line, and dense month labels retain spacing.
Restore previews separate account, transaction, statement and personal-rule
counts on narrow screens and at enlarged text sizes. Unsupported or inconsistent
backups produce short recovery instructions instead of raw schema dumps; their
validation and atomic replacement are unchanged.

Sorting Undo restores the pending queue and its progress together with the
assignment, scoped backfill and learned rules. Native text Undo remains available
inside search fields. Desktop hover actions occupy space beside the transaction
instead of covering its amount, and do not interfere with active dragging.
Import cards use the same blocker list as confirmation: changed parser options,
invalid fields, retained duplicates and batch rechecks cannot leave a falsely
reassuring Reconciled header. Arithmetic reconciliation remains separately visible
while outstanding review work blocks import.

No financial amounts, extraction rules or database schema are changed. The
automatic learning requirement still takes precedence over the designer's
proposed extra rule-conflict confirmation. OCR and extraction uncertainty remain
subject to required financial review rather than becoming silently deferrable.

The closing balance and complete monthly history have separate evidence checks.
Finding 1 requires a known card debt to remain visible even when a statement does
not establish a complete month. Issue-date-only Barclaycard statements and Amex
statements containing older purchase dates can prove their closing sum from all
stored rows. They do not gain verified calendar coverage from that proof. Known
unverified closing amounts remain visible with their date and reason, and cannot
enter net position or verified history. Older proven snapshots are labeled and do
not establish a current net position. A future closing balance is never backdated
to a purchase month. Initial Home selection and completed imports use the latest
closing or activity month so a newly imported card's dated balance is accessible.

Finding 7 counts distinct verified statement closing dates, rather than counting
multiple reconstructed days from one PDF as multiple imported statements. One
statement therefore does not activate comparison ranges. Closing-only statements
add verified chart points without filling the intervening daily gaps.

The user's requirement takes precedence over the proposed conflict question:
every manual category change automatically becomes the new default, without a
Remember control or an extra confirmation. Learned rules are narrowly scoped to
the source merchant, account and amount direction. Undo restores the transaction
assignment and learned rule together when they have not changed concurrently.
Rules can also be inspected, edited and deleted in Settings. Explicitly selecting
several payments is separate from learning future defaults; saving a category
does not silently rewrite all historical matches.

Rule match counts describe the transactions that match today. They are not a claim
that the rule historically classified every matching payment. Last use and origin
appear only when recorded; older records remain valid without invented provenance.
Editing or deleting a rule leaves historical transactions and their amounts
unchanged. Reviewed merchant history remains part of the categorization engine,
so deleting an explicit rule alone is not a guarantee that an existing merchant
will never be suggested or categorized from history.

Transfers and card repayments preserve the source amount and affect account
balances. They are excluded from income and spending to avoid double counting.
Refunds preserve the signed statement amount; choosing a refund label is not a
blanket instruction to discard that financial movement. Failed reconciliation
requires a specific, explicit override, and overridden data remains unverified
for coverage, comparisons and forecasts.

No update erases existing financial records. Additional provenance fields are
optional and survive JSON backup/restore; older backups remain supported. Erasure
and replacement are deliberate user actions rather than migration behavior.

## Automated review routes

Run the normal fixture, unit, build and browser commands from the README. The
focused Settings suite is `tests/e2e/settings-review.spec.ts`; it checks backup
handoff metadata, restore preview and replacement gating, typed erasure, and rule
creation/edit/deletion. Storage tests cover invalid rule writes, stale edits,
unchanged transactions and failed backup download handoff. Review-specific
coverage and period tests check unavailable values and shared time scopes.

Tests and screenshots use fictional financial data only. Never attach a private
statement or real backup to a browser test that records traces or screenshots.
After changes, run `npm run format:check`, `npm test`, `npm run build` and
`npm run test:e2e`, then review the production output at mobile and desktop sizes.
Results for a release belong in `docs/validation.md`; this guide does not claim
that an unrun check has passed.

## Manual iPhone review

- Install from Safari using Share → Add to Home Screen, then launch standalone.
- Verify the Home position and this-month card above the fold at 390 × 844, with
  smaller and larger text, light/dark modes, portrait/landscape and safe-area insets.
- Use real Files picker selection for one and several synthetic PDFs. Confirm that
  Import opens the picker directly, progress remains responsive, clean statements
  collapse and blocking statements appear first.
- Review a missing amount and a deliberate reconciliation error. Ensure the fix
  and explicit override are distinct and the Home coverage remains unverified
  after an override.
- Confirm a multi-file import once, return directly to Home, and start sorting from
  the completion message or to-do. Check queue progress, skip, suggestion reasons,
  immediate removal, learning confirmation and Undo.
- Compare tap, touch swipe and desktop drag/drop. Verify visible keyboard focus,
  screen-reader labels and usable category selection without dragging.
- Open category and transfer drill-downs; confirm the active navigation section,
  shared currency view and date range remain consistent.
- Check missing and partial chart periods, touch tooltips, fixed financial colors
  and readable category dots in both themes.
- Export a backup to Files/iCloud Drive. Feng records the download handoff, not
  proof that the file was saved. Restore a synthetic file, inspect the preview and
  cancel before confirming; then verify a deliberate restore.
- Verify Delete imported records keeps learned rules, and Erase everything stays
  disabled until the exact text ERASE is entered. Use only demo/synthetic data.
- Launch offline and perform categorization, analysis, backup and digital PDF
  import. Check an explicit service-worker update preserves saved data.
- Export reminders to a calendar and verify calendar alerts on the device. Feng's
  reminders are otherwise shown when the web app is open; there is no background
  notification server, native app or App Store onboarding. Disabling Feng reminders
  does not remove calendar events already imported.

All financial processing remains local. Assets may be fetched for first install
and updates; an installed offline import must not send statement contents,
transaction descriptions, balances or account identifiers over the network.
