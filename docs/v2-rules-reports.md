# Rules, tags, search and reports in version 2

These features run entirely on the device and share one deterministic condition model. They do not call an AI service.

## Rules

Settings contains the rules editor, JSON export/import, pause/enable and delete. Auto rules created by manual categorization are labelled Auto. Editing a rule shows matching transactions before saving; Apply to existing defaults to on and can be undone as one atomic change. A rule can match all or any of up to 20 conditions. Amount conditions compare absolute minor-unit amounts; direction specifies money in or out. Thus `AMZN` and amount below £10 matches a £3.49 purchase, but excludes a £24.99 purchase.

Explicit personal rules run before learned Auto rules, then built-in merchant mappings; higher priority wins within each group. Exact matches break a priority tie. The highest-priority matching action for category, display name, kind, reviewed status, recurring series or split is retained. Tags from later matching rules can accumulate unless Stop processing is selected. This keeps a learned merchant default from replacing a deliberately more specific amount rule. Updating a conflicting explicit rule preserves its conditions, account scope, priority and nonfinancial actions. Amounts, dates and source statement balances never change when applying a rule.

Percentage splits use integer arithmetic and allocate the final pennies exactly. Single-use rules are read-only during preview, apply to at most one accepted transaction, and are deleted only when that transaction is committed. Applied rule IDs and hit counts preserve provenance. Rules that modify a closed month require reopening it first. Repeated explicit edits can produce rule suggestions in monthly review; a rule already representing the choice is not suggested again.

After manually splitting an expense, an optional offer can remember its merchant, account and percentage allocation for future imports. Acceptance never modifies the saved split again, and the new rule has its own Undo. Linked refunds and purchases referenced by refunds cannot be reclassified as transfers through Apply to existing; unlinking the refund is required first. Both rule saving and rule import roll back atomically if a matching transaction cannot safely change.

Regular expressions are an advanced option. Patterns are bounded and reject backreferences, lookarounds and nested repetition. Imported statement text is rendered through React as plain text.

## Tags and saved views

Tags can be created, renamed, recoloured, archived and merged. Merging rewrites transaction assignments, rule conditions/actions and saved report/view filters in one reversible operation. Several tags may apply to a transaction or split line. The sorting and detail screens expose a tag picker; the transaction screen supports bulk assignment.

Advanced search supports a graphical condition editor and simple text queries:

- `amzn <10 2026`: Amazon descriptions below £10 in 2026.
- `tesco >20 sep`: Tesco above £20 in September of the current year.
- `tag:lisbon` or `tag:"Lisbon trip"`: a named tag.
- `amex uncategorised`: uncategorized American Express records.
- `source:csv unreviewed`: unreviewed CSV records.

Free text searches descriptions, display names and notes. Search comparisons use the reporting currency's minor-unit precision. Saved views retain their conditions, can be pinned as quick filters, and can become a future-import rule after choosing a category.

## Reports and CSV

Analyse can group by category, tag, account, merchant or reporting month, with net amount, count or average. Display choices are table, bar or line; a table accompanies each chart for accessibility. Saved reports can be pinned. Reports use the effective financial projection: transfers are excluded, split children contribute once, and linked refunds reduce the original purchase month. Payday-aligned month grouping uses the shared period definition.

Tag totals can overlap when one transaction has several tags; the interface explains this. CSV exports preserve original ledger amounts and source currencies, replacing split parents with child lines, and include tags, notes and source/provenance fields. Potential spreadsheet formulas in imported text receive a protective apostrophe. The analytical reporting conversion does not overwrite original stored money.

The UK tax-year preset is inclusive from 6 April to 5 April. The optional Property Self Assessment summary is disabled by default in Settings; users choose their own allowable expense categories and the page states Not tax advice.

## Verification

Focused tests cover priority, all/any conditions, amount signs, unsafe regex rejection, exact percentage allocations over hundreds of penny amounts, single-use previews/commit/Undo, closed-month protection, rule export/import, notes and named-tag queries, merge/Undo, refund/split reports, UK tax boundaries, currency precision and CSV formula handling. React tests exercise preview/save/Undo, saved filters, tag selection and saving reports.
