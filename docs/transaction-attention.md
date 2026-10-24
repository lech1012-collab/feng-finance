# Actionable transaction attention — 2.2.23

Previously, `needsReview` returned true for every payment whose `isReviewed`
stamp was false. Imports and automatic category backfills preserve that stamp,
so a correct saved-rule match appeared as both Groceries and “To review”. Home
then opened the categorisation board for those already completed payments.

The shared attention predicate now asks what decision is missing:

- Ordinary payments need a category only when no category or subcategory is
  assigned. A saved-rule, built-in or manual category does not require another
  confirmation, regardless of the old manual review stamp.
- Transfers and card repayments do not need expense categories. Existing
  pending transfer suggestions retain their separate confirmation workflow.
- An unlinked refund still needs a purchase link or an explicit decision to
  treat it as ordinary income. Marking it reviewed does not bypass that task.
- An unconfirmed automatic split still needs confirmation of its allocation.
  Split children do not create separate chores.
- An explicit outstanding source check remains visible. A low OCR confidence
  score alone does not repeat source checks already accepted during import.
  Statement reconciliation, source-row validation and import overrides remain
  unchanged.

Home separates “Categorise N transactions” from “N transactions need attention”.
The first opens a queue containing only missing categories. The second opens
the actual refund, split and source exceptions with specific reason labels.
Clicking a refund or split opens its details instead of a category-choice grid.
Completed rule matches have no warning badge or “Mark reviewed” button, and
backfilled matches leave the queue immediately without a second approval.

This is a derived UI decision, not a migration or bulk update. Native amounts,
dates, categories, manual review stamps, rules and source provenance stay intact.
Explicit monthly closing can proceed once the real decisions and statement
verification are complete. Automatic closing retains its original manual-stamp
requirement, so an update cannot retrospectively close old unreviewed history.

Regression checks use fictitious history containing 189 classified rule matches,
two missing categories, an unlinked refund, an automatic split, a source check,
linked refunds and transfers. They verify queue counts, direct navigation,
offline use, unchanged records and preservation of the genuine exceptions.

The release also corrects browser CI setup to update GitHub's separate APT
mirror-list files. Updating only sources.list and .sources left the slow Azure
mirror active on some Ubuntu runners. A functional test executes the actual
workflow loop against all source formats and checks that signed-source
configuration is preserved; all browser and deployment gates stay enabled.

Security review also updated Zod to 4.6.7, fast-uri to 3.1.9 and
serialize-javascript to 7.1.4. These patch releases address newly reported
collection-validation and URI/serialization advisories without changing backup
formats or disabling the dependency audit. Validation, build and browser checks
are rerun against the patched lockfile.
