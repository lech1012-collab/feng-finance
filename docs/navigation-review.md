# Navigation and duplicate-action review — 2.2.26

The review follows the Home screenshot report: controls side by side, or within
one object, should not lead to identical information. Keep one clearly named
entry point and keep the underlying figures readable. Main navigation, back
navigation, source evidence and accessible chart values serve separate needs.

## Changes

| Surface                      | Result                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home / Where you stand       | The account count is the single Accounts link. The heading has no second link; Net worth is a noninteractive figure. Cash and Card debt retain their different transaction filters.                           |
| Home / Import                | The monthly Import action remains in the heading. The identical action is removed from To do. Missing coverage still appears on the financial cards; incomplete accounts cannot produce “All sorted”.         |
| Home / Import receipt        | Keeps the import result and uncategorised count; uses the existing To do sorting action instead of a second Sort now button.                                                                                  |
| Home / Category spending     | Real categories occupy the five rows. Uncategorised spending has one count link below, rather than both a category row and another count link. Percentages still use all spending.                            |
| Home / Pots                  | One View pots link opens the Pots tab. Preview rows are readable summaries instead of several links to the same unselected Pots page.                                                                         |
| Home / Coming up             | View forecast opens the Forecast tab, distinct from View pots. Each payment still opens its specific merchant/account history.                                                                                |
| Home / Insight               | Removes the generic Analyse shortcut duplicated by navigation. Subscription insights remain readable when To do already provides their subscription-review action. Other insight drilldowns remain available. |
| Planning / Payments calendar | One Review price changes link serves the whole list; repeated Review charge links are removed from each price-change summary.                                                                                 |
| Monthly review / Changes     | Keeps one Review subscription changes action; individual price-change summaries no longer repeat the same destination.                                                                                        |
| Reminder summary             | One Manage link includes the hidden reminder count; removes the second “more reminders” link.                                                                                                                 |

Category analysis also keeps one comparison-help symbol beside Monthly average.
The repeated symbol opening identical help beside the trend is removed.

## Page and component audit

Reviewed 38 rendered routes using fictitious demo data, plus conditional actions
in the source. These include Home; Activity and transaction detail; category
analysis; Analyse, property, reports and tagged trips; all five Planning tabs;
subscriptions; Accounts; Import; monthly review; the Settings index and every
Settings section.

- Activity account/category filters and source transaction links change scope
  or open individual records. Keep them. The Accounts tool remains its only
  account-management entry point.
- Category charts and View values present the same figures in accessible forms;
  keep both. Subcategory links open different categories. Monthly and full-list
  transaction links use different date scopes.
- Reports retain chart objects and the accessible data table. Editing reports,
  running filters and opening transaction sources perform different actions.
- Planning tabs open different views. A pot, bill or scenario editor is distinct
  from creation, contribution and confirmation controls. Keep these operations.
- Subscriptions keep separate status decisions, provider instructions and
  individual payment evidence. They are not duplicate navigation.
- Accounts keeps creation and individual account editors, including separate
  manual assets. No duplicate generic Accounts shortcut is added.
- Import keeps file selection, review, correction, commit and discard as separate
  operations. Navigation still resumes a pending batch. Reading evidence and
  financial safeguards are unchanged.
- Settings keeps one index link per section. Backup and restore remain separate;
  backing up before replacing data is a deliberate safety step, not redundant
  navigation. Close, cancel, confirmation and recovery controls stay available.
- Main navigation and back links remain predictable on mobile and desktop.

This is a presentation change. No transaction amounts, calculations, parser
rules, IndexedDB schema or stored financial records change.

## Coverage status on Home

The This month card uses its visible status (Partial, Unverified, Complete or
No data) as the single help control. It opens the existing coverage
explanation, replacing the separate warning/help icon. The status remains
visible, has a 44 px minimum touch target, supports keyboard activation and
returns focus when the explanation closes. Financial figures, coverage checks
and comparison rules are unchanged.

The Where you stand card follows the same pattern: Partial or unverified and
Verified balances open its existing position explanation. It no longer repeats
the same information through a separate warning/help icon.
