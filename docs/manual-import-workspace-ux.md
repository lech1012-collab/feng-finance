# Manual statement review — UX handoff and implementation review

## Problem

The exception wizard still handed several manual actions back to an expanded
diagnostic form. That form repeated account details, warnings, balances,
transaction forms and parsing settings inside coloured boxes. A small correction
required several screens of scrolling. Making the initial wizard shorter did not
fix this fallback journey.

## New journey

1. Select PDFs together. The batch keeps its Needs attention filter and one
   confirmation at the end.
2. Review statement still guides the person through actual exceptions.
3. Statement details opens a bounded **Statement overview** sheet. It never
   expands the diagnostic form. Three plain action rows open **Check transactions**,
   **Statement totals** or **Reading options**.
4. Check transactions is a compact list. The whole row is a touch target. The
   description occupies at most two lines; amount and date stay readable.
5. Tapping a row opens one correction editor, with its original PDF crop. It
   asks for the uncertain field and preserves other values. No category/type
   form, competing amount suggestions or nested warning panels appear.
6. Save correction rechecks the source, returns to the list and retains the
   batch. Corrected rows remain accessible. Continue review handles any remaining
   duplicate, notice or financial decision before returning to the batch.
7. Totals use one plain definition list, including movement differences. A
   direct action opens the transaction list. Account/date changes and column
   identification each have their own focused screen.

The existing diagnostic interface is opt-in under **Source and technical tools →
Open diagnostic tools**. No normal/manual fallback opens it automatically. It
retains detailed source investigation, bank proof and advanced export controls;
its warning surfaces are flattened to a neutral presentation.

## Visual and interaction requirements

- One surface, simple separators, limited accent colour. No nested red/yellow
  transaction cards or repeated warning summaries in the normal journey.
- One main action per focused screen. Touch targets at least 44px; transaction
  rows at least 56px. Input text at least 16px. Source filenames wrap.
- A shared modal owns vertical scrolling, keyboard space and safe-area insets.
  The underlying batch remains stationary. Close pauses the task; changing tabs
  retains the unconfirmed session as before.
- Show only the first 20 list rows, with a deliberate next-page action. Construct
  row navigation in linear time. Financial calculations stay in domain services.
- The explicit unverified-import decision retains one acknowledgement and all
  figures, with longer notices behind a disclosure. Accepting it never verifies
  a discrepancy or permits invalid required fields.

## Developer review gates

Test the screenshot's manual fallback, rather than only the primary wizard:
Statement details → transactions → correction → save → reopen correction → totals.
Exercise native-reader to generic-source handoff, missing source matching,
account/dates, column identification and multiple PDFs. Verify no legacy forms
mount before explicit diagnostic opt-in. Check 320/390px, dark/light, 200% text,
keyboard-sized height, modal focus, retained navigation and unchanged saved data.
Keep existing financial, duplicate, privacy, backup and offline regressions.
Use only fictitious statements in automated evidence; real device Safari remains
a manual device check.

## Implementation checks

- Component tests cover the real Statement details entry point, optional
  diagnostics, editing/cancelling one field, date validation and ambiguous
  same-day source matches.
- Browser coverage follows two PDFs from manual review through correction,
  reopening, reconciliation and final import. It includes 320/390px, 200% text,
  dark/light themes, reduced keyboard-sized space, totals-only exceptions and
  layout recovery in Chromium and WebKit.
- Existing financial assertions still check saved transaction counts, exact
  amounts, zero reconciliation differences and no database writes before final
  confirmation. Legacy investigation tests explicitly opt into diagnostic tools.
- Build tooling moves to patched Vite 8.3.5 with its compatible React plugin;
  the fixture generator now declares esbuild directly instead of relying on
  Vite's previous transitive dependency. No financial schema changes are made.
