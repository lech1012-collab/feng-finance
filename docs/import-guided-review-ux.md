# Guided import review — 2.2.12–2.2.14

This change applies only to import review. It follows the attention-only batch view in `import-batch-focus-ux.md` and replaces the expanded diagnostic tile as the normal way to resolve an exception.

## Problem and design decision

A single expanded statement previously mixed an account-identification failure, reconciliation figures, parser diagnostics, alternative readings, individual row controls and bank/date settings. A mobile user could not tell which action to take first. Missing identity could expose more than a hundred unverified rows before the account was resolved.

Keep the statement card compact. Its only primary task is **Review statement**. Open a modal sheet and ask one question at a time. Preserve the existing **Leave out this statement** action and put the full diagnostic interface under **Statement details**. A normal manual correction never asks the person to choose an inferred reading or an alternative amount.

## Journey

1. Select several PDFs together. Processing, retained review, Needs attention / All statements and the final in-flow confirmation are unchanged.
2. Open an exception card. It explains the next task in one sentence. Choose **Review statement**.
3. If identity is missing, first choose an existing account or enter the last four account/card digits, bank, account type and statement currency. For missing dates, ask only for the statement dates. Account creation is staged until the batch is confirmed; no Settings detour is needed.
4. Once identity is resolved, show one ambiguous transaction in **Correct amount**. Show its original local PDF crop, description, a decimal-keyboard amount input and Money out / Money in controls. Other transaction details are collapsed unless a required date or description is invalid. No inferred-reading suggestions appear in this flow.
5. **Save and continue** checks the entered value, rechecks the statement and advances to the next transaction. A short checking state prevents double submission. A valid correction is not asked for repeatedly merely because an independent total is still unequal.
6. Show any remaining statement notices individually. Explicitly accepting a notice does not change an amount or waive reconciliation. Where totals remain unequal, show reported closing, calculated closing and difference. The normal action is to review the statement details; accepting unverified figures remains a secondary disclosure with the existing explicit financial-risk confirmation.
7. **Statement checked → Done** returns to the batch. The resolved card remains stationary until the person continues. Confirm the batch once at the end; hidden ready statements remain included.

The close control is labelled **Pause statement review** (or **Cancel correction** in the amount editor). Saved corrections remain in the retained review when changing tabs. Closing an unsaved field editor cancels that field edit. Nothing is written to the ledger until Confirm import. As before, a full reload or closing the app does not persist an unconfirmed PDF session.

## Safety and implementation review

- `guided-review.ts` is a presentation resolver. It does not alter parsers, source arithmetic, duplicate detection, database schemas or commit validation.
- Identity precedes mapping and row corrections. Checking another row cannot substitute for identifying an account.
- A manually entered value is a source correction. A wrong valid number still leaves a reconciliation warning; it never becomes verified by being typed.
- Invalid source amounts/dates/descriptions remain blocking, including after unverified acceptance.
- Source-row exclusion is optional and requires a separate confirmation. It rechecks the independent totals.
- Only included duplicate/manual matches require decisions; exact statement duplicates retain their existing automatic skip behavior.
- Alternative readings, mapping, OCR retry and other diagnostics remain available under Statement details.
- Every modal uses the shared import sheet surface, bounded to the viewport with independent vertical scrolling, safe-area footer padding and at least 44px interactive controls. Amount inputs are at least 16px to avoid Safari focus zoom.
- Financial source text wraps inside stationary objects. The document and modal must not pan horizontally at 320px, 390px, or 200% text.
- Use native dialog focus trapping, return focus to the opener, and keep ordinary tab navigation/review retention working. The amount source crop is local and is not draggable.

## Verification

Unit checks cover step ordering, manual progression, invalid-value blocking, independent financial warnings and duplicate handling. Browser checks exercise manual correction and cancellation at narrow widths, reduced keyboard space and 200% text, including source crops, amount signs, exact saved ledger values and no financial network requests. Additional mixed-batch checks cover identity before rows and successive manual corrections. Existing financial-detail regression journeys explicitly open Statement details.

Physical iPhone Safari, installed-PWA keyboard behavior and VoiceOver remain manual device checks. The screenshot supplied by the user is the basis for the design diagnosis, not a claim of a successful parse of that private PDF.

### Native-reader identity recovery (2.2.13)

The same account step also handles a native bank reader that has extracted its transactions but cannot read the account/card identifier. A transient structured recovery hint carries only the source bank, account type and currency into the account step. After choosing the account, one explicit unverified-statement confirmation explains the unread identifier and names the linked account. The original identifier, amounts and balances remain unchanged. The statement stays unverified even when the arithmetic difference is zero. Valid native amounts require no separate re-entry. The hint is not written to the database. A synthetic missing-number Barclaycard journey verifies all six source transactions, its negative reported closing balance and zero arithmetic difference, with the unverified acceptance recorded. Existing bank-source integrity safeguards remain enforced.

### Recognized accounts and Continue recovery (2.2.14)

The card can already be recognized by its bank adapter while generic source review sees several identifiers, including a separate account printed in the issuer's payment instructions. Previously the generic reader dropped the known identity, and even selecting the correct account could leave its status as identity-required. Continue then repeated the same account question.

Source review now carries the native adapter's already-read account identity. When several printed identifiers exist, an established identity or explicit account choice resolves them only when its last four digits match a printed candidate. Without that evidence the app still asks rather than guesses. A unique printed account cannot be silently replaced by a different selected account. An incompatible choice shows an actionable error inside the account panel and preserves the selected option so it can be corrected.

**Recognized card → Review statement → first unresolved transaction → Save and continue → next exception or Statement checked** is the normal correction journey. Choosing an account is reserved for genuinely unidentified sources. The account and its ID remain attached to this file during subsequent corrections, including staged accounts in a multiple-file import. Verified rows are not presented as manual questions. Balance differences, missing source fields, duplicate decisions and genuine unread-identifier warnings remain enforced. An account choice does not prove an amount or waive reconciliation.

Regression coverage reproduces both lost native identity and the repeated account-selection status. Fictional PDFs include a recognized card with one unread purchase and another account in its payment instructions, plus an unknown bank with competing identifiers. Browser journeys exercise a mixed batch, a rejected account choice with visible feedback, a successful existing-account selection, direct manual correction and the exact final ledger. No private statements are added to the repository.
