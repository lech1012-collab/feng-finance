# Importing statements and exports

Feng accepts PDF, CSV, OFX, QFX and QIF files in the same picker. A batch is checked before confirmation, then saved sequentially. Each statement and its corrections are atomic. If a later file fails, earlier successfully saved statements remain visible and are not imported twice on retry.

Files are read on the device. Their contents are never sent to the hosting server. Original files are not retained in IndexedDB; the account, source filename, SHA-256 file hash, normalized rows and validation evidence are retained.

## PDF

Digital PDFs use positional PDF.js extraction and the existing independent Barclays, Barclaycard, American Express and Revolut adapters. Scanned pages use local OCR. Financial validation, low-confidence review and explicit reconciliation overrides remain mandatory.

## CSV

Built-in layouts cover Revolut, Amex UK, Barclays and Barclaycard. The reader supports quoted commas, escaped quotes, quoted line breaks, UTF-8 BOM, tabs and semicolons. Malformed rows fail with their row number rather than being dropped.

An unidentified layout opens the mapping card. Select Date, Description and either a signed Amount column or Money out and Money in columns. Balance is optional. Choose an existing account or provide its institution, currency, account name and last four digits. A new account is saved only after import confirmation.

The mapping is saved per account, including its header layout, in the same audited transaction as the import. Selecting that account on another matching export restores the saved mapping. Changed headers require a fresh check. For a recognized export, **Change export columns** opens the same editor, including UK/US date ordering and the amount convention.

Amex UK and Barclaycard purchase-positive Amount presets invert purchases and credits into Feng's positive-in/negative-out convention. Debit/credit columns already express direction. Generic debit/credit headers alone do not prove that a file is from Barclays. An export without an account identifier uses an existing account only when its institution, currency and account type identify one unambiguous match; otherwise the user chooses the account.

**Balance convention** controls the separate running-balance sign. Card purchase-positive presets default to positive debt and convert it to a negative financial balance; a negative card credit becomes positive money held. Exports that already show money owed as negative must select **Positive money held, negative money owed**. The choice is saved with the account's mapping, and normalization happens before every running-balance reconciliation.

Revolut completed transactions are included; explicitly pending, failed, declined, cancelled and reverted records are excluded from the booked ledger. Separate nonzero fee rows are preserved. A file containing multiple currencies must be exported as separate currency files.

Running balances validate each printed balance anchor. An intermediate mismatch requires review even if opening and closing totals happen to agree. An opening balance inferred from the first running balance is not a printed statement boundary: the period remains transaction coverage, so it cannot establish complete monthly history.

## OFX and QFX

OFX XML and older SGML are parsed as local text. Transaction dates, signed amounts, payees, memos and FITIDs are preserved. A FITID repeated within one file is rejected; reusing a known FITID with a changed amount requires duplicate review. Multiple-account files, document types and external entities are rejected.

A printed ledger balance is retained. When a reconciled prior statement supplies an independent closing balance on the day before the export starts, it can serve as the opening balance. Feng never derives an OFX opening balance by subtracting the imported rows from the closing balance, which would produce a circular reconciliation.

## QIF

Bank, cash and credit-card transaction exports preserve dates, grouped signed amounts, payees and memos. Incomplete records and multiple account sections are rejected. Investment transaction records are unsupported.

If a numeric date could mean either a UK or US date and no other date resolves the order, the user must select the QIF date format before import. Feng does not silently guess between 1 September and 9 January. QIF has no authoritative currency or account identifier, so the selected account supplies those details.

## Validation and duplication

Files without balances show **File has no balances** and remain unverified. A ledger-only OFX file without an independent opening balance also remains unverified. Money in and Money out show gross native-currency movements, including transfers and card repayments; dashboard income and spending exclude confirmed internal transfers.

Duplicate protection combines the file hash, normalized fields, occurrence order, known running balance, FITID and compatible explicit booking dates. Cross-format descriptions may be shortened, so a plausible match without balance evidence is shown as a possible duplicate and excluded by default. It can be kept explicitly. The third identical purchase is retained when only two occurrences already exist; different known running balances distinguish legitimate same-day purchases.

## Transfers, manual entries and closed months

The import review shows potential internal transfer pairs against both selected files and existing history. Matching remains Manual by default. Confirm a pair, choose among competing matches, or leave it for later. **Confirm all clear matches** selects only pairs that have one candidate on both sides. Cross-currency pairs require explicit confirmation and valid cached exchange-rate evidence.

Rows awaiting a categorization split cannot be offered as transfer pairs. If a selected pair becomes invalid after corrections or refreshed duplicate checks, the import reports the change explicitly instead of silently leaving it unlinked.

When the second side of a selected pair is saved, both transaction changes, the link and the proposal confirmation are included in that file's atomic import and Undo entry. Unconfirmed pairs retain normal income/expense behavior and stay in the review queue. Automatic matching, when explicitly enabled, applies only to unique same-currency matches no more than two days apart.

A matching manual entry on the same account, with the same amount and a date within one day, requires an explicit decision: replace a selected manual entry or keep the records separately. Replacement preserves manual categorization, merchant edits, tags, notes and attachments. Manual entries never participate in statement reconciliation. Closed months must be reopened before imported actuals or manual replacements can change them.

The same protection applies to statement balance anchors, including PDFs with no transaction rows and statement periods spanning a closed month. Checking a file never inserts authorization dates into the ledger.

A manual entry with linked transfers, split children or refund allocations must be unlinked or unsplit before replacement. The import leaves those references intact and offers keeping both records instead; it never silently changes linked rows in another account or a closed month.

Every newly saved statement increments the local backup reminder count. Exact skipped files and fully duplicate exports do not increment it. A successful backup download handoff resets the count; a blocked download does not.
