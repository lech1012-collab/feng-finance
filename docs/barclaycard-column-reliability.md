# Barclaycard column recognition — 2.2.17

## Diagnosis

The native reader separated two dated transaction panels, but left a single
dated panel open to the right edge of the page. Barclaycard also prints account
information in that space. Limits aligned with transaction rows could replace
the actual posted amount; other sidebar lines contaminated merchant text.
The resulting reconciliation failure was correct and must remain a blocker.

Manual source correction then encountered a second layout problem. Its card
region reconstruction required two date columns. Standalone issue/due dates on
the cover could veto the actual ledger on the next page. Full-year dates could
also be split into a short date and a supposed amount. Full-page inference then
read payment instructions and inherited help pages as transactions. A large
queue of questions therefore represented layout failure, not many unread
purchases.

## Implementation

- Share a positional boundary between native and source-correction readers.
  Established information headings bound the ledger before rows are grouped;
  a genuine second ledger retains its separate date and amount columns.
- Recognise the supported single-ledger layout during source correction.
  Retain original page coordinates for previews, unread rows and corrections.
- Keep whole dates intact. Treat a card cover without a transaction table or
  dated movement as metadata. The untouched source still supplies card identity,
  issue date, due date and independently printed balances.
- End a card panel at its closing balance or payment instructions. Instruction
  text in the former date band cannot reactivate the ledger.
- Preserve exact financial reconciliation, source-coverage checks, genuine
  unreadable fields, legitimate repeated purchases, repayment signs and foreign
  currency continuation text. A fee included in a posted purchase is not added
  again. Unknown layouts retain the existing generic mapping route.

Parser provenance advances to 2.2.4; the database schema is unchanged. Previously
saved records are not rewritten. An open draft must be reread using the updated
application before the new extraction applies.

## Verification

Private local reproduction compared the uploaded four-page PDF with both actual
browser parsing routes, including every dated posted amount and occurrence.
The corrected routes each produce 23 transactions, no required field corrections,
and a zero reconciliation difference. The missing printed period start remains
one statement-level coverage notice; it does not require re-entering purchases.
No source PDF, extracted personal data or private screenshot enters Git.

Fictitious four-page fixtures cover adjacent limits, separate cover dates,
payment instructions, repeated purchases, foreign currency notes and one damaged
amount. Unit/integration tests verify native selection, source-correction counts,
exact reconciliation, blocked invalid imports and final database counts. Mobile
Chromium/WebKit tests exercise both a clean multi-PDF import and one genuine
amount correction with no intermediate database writes.
