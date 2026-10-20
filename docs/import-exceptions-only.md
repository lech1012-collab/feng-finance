# Exceptions-only import review — 2.2.15

## Journey and decision

Select PDFs together → automatic local reading → Needs attention → correct only
unread or conflicting fields → recheck statement totals → confirm the batch.
Readable rows do not become amount-entry tasks merely because a card's total
does not reconcile. The exact discrepancy remains visible in one **Check
statement totals** sheet; normal verified import stays blocked. Optional source
inspection and the existing explicit unverified acceptance remain available.

The correction sheet names the field: **Correct amount**, **Correct date**,
**Correct booking date**, **Add description**, **Correct balance**, or **Check
transaction**. It preserves other values and shows the original local PDF crop.
A date-only question shows the amount kept, with optional editing under More
options. An incomplete manually typed year is never silently expanded.
Rows already corrected remain accessible under **Reviewed transactions**, so
an incorrect entry can be reopened while the statement totals still differ.
They are not added back to the mandatory correction queue.

If more than ten rows and a quarter of the statement have actual field errors,
show **Check statement layout** once. The user can inspect mapping/source details
or deliberately choose individual corrections. No rows disappear. Existing batch
selection, paused review, stationary mobile sheets and in-flow final confirmation
are retained. A full reload still discards an unconfirmed PDF session.

## Parser and financial safeguards

- Barclaycard contactless markers (`e`, `c`, `m`) are identified relative to the
  monetary run on their own row. Another wider, right-aligned amount cannot turn
  `£8.50` into the invalid cell `e £8.50`. General money validation stays strict.
- A native total-only warning does not automatically replace readable bank
  transactions with a generic reading. Concrete missing-row/running-balance
  coverage faults can still open source correction automatically.
- When explicit generic review has a blank amount, a native reading can fill it
  only for one uniquely matched page/date/booking-date/description occurrence
  from the same institution, currency, account type and statement period.
  Conflicting valid values and repeated identical purchases are never guessed.
  Original raw source text stays attached; all checks run again afterward.
- Extraction validity is separate from mathematical proof. `rowReviewDecision`
  computes actual field questions; `resolved` and the financial validation model
  keep their original strict meaning. No database migration is required.
- Yearless dates use a unique valid occurrence in the printed period, including
  year crossings. Multiple occurrences remain unread. Earlier purchase dates
  remain visible for the existing booking-date/period safeguards.
- No closing-balance difference is used to invent a transaction amount. No
  rounding tolerance is relaxed. Missing pages, signs, invalid fields, offsetting
  errors, duplicates and source integrity checks remain enforced. Invalid fields
  cannot be accepted through the unverified override.
- PDFs, crops, bank corroboration and OCR run locally. Only fictional source
  fixtures belong in Git and public browser artifacts.

## Verification

Synthetic eleven-page, 133-row fixtures cover exact totals, a 1p discrepancy,
one unread amount, one unread date and systemic unread cells. Unit/integration
checks cover exception counts, field preservation, marker geometry, conservative
native recovery, date inference, native-reader retention and hard validation
gates. Chromium/WebKit journeys cover the actual PDF pipeline, multiple-file
selection, exact saved ledger values, a 320px editor and reduced keyboard-sized
viewport. Existing import journeys retain privacy, route-resume and 200% text
coverage. Real iPhone keyboard, installed-PWA and VoiceOver checks still need a
physical device. Synthetic tests do not certify every private PDF variant.
