# Import amount correction — 2.2.9

This follow-up is limited to editing source values during import. It addresses the reported Beauty Code correction difficulty and sideways movement of mobile transaction cards.

## Workflow

1. Open the uncertain transaction and select **Correct amount**. The same action is available on a bank-reader transaction; it opens the existing source-review route directly.
2. Compare the original PDF row at the top of the editing panel. Enter the amount with the decimal keyboard.
3. Select **Money out** or **Money in**. A readable source amount retains its existing direction. An unread amount requires an explicit choice. No minus key is needed.
4. **Save row** rechecks the statement using the existing correction pipeline. **Cancel correction** discards the edit and returns focus to its trigger.
5. Confirm the import after the remaining statement checks pass. Editing a row does not save financial records.

Date, booking date, description and running balance are preserved when only the amount changes. Other editable source fields remain in a disclosure. Alternative extracted readings remain available in a separate disclosure; they no longer push the amount editor below a long list of possible readings.

## Layout and safety

The editor uses the existing native modal sheet with an inert background, locked page overflow, a scrollable content area, visual-viewport keyboard handling and a separate action footer. Inputs use at least 16px type to avoid iPhone focus zoom. Long source descriptions wrap within the panel; original PDF crops cannot be dragged as images.

Native bank readings remain immutable. The new direct action explicitly opens generic source review and identifies a row by source page, date and normalized description. It does not guess between identical purchases. A unique amount can disambiguate otherwise matching source rows. If the row cannot be uniquely identified, the source review asks the user to select it.

Corrections still use strict currency precision, exact reconciliation and the existing duplicate checks. No database schema, bank parser, financial calculation or transfer-matching policy changes are included.

## Verification

Synthetic Beauty Code data represents an unread amount (`UNREAD`) that must be corrected to an outgoing £80.00. Its independent statement equation is £500 + £2,000 − £80 = £2,420. No real financial PDF is committed or used in browser evidence.

Browser coverage checks 320px, 390px with reduced available keyboard space, and 390px at 200% root text, in Chromium and mobile WebKit. It checks editable numeric entry, explicit direction, rejection of excess precision, cancellation and focus return, unchanged card horizontal position, bounded document and dialog widths, source preview, no premature financial writes, exact saved amounts and balances, and no third-party or financial network requests. A separate native-bank case verifies direct correction and preservation of manual categorization.

The original synthetic inline form did not reproduce a page-width overflow at 320px or 390px. The new modal isolates editing from the transaction cards rather than claiming a particular device-only cause was proved. Reduced browser viewport space is not a real iPhone keyboard test.

Physical iPhone checks remain: open a difficult row, edit with the actual decimal keyboard, drag horizontally inside and outside the panel, scroll the source and details, rotate, increase text size, cancel, reopen, save and check the statement balance before confirming import.
