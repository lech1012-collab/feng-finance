# Real iPhone Safari checklist

Record iOS version, device, deployment origin and app version. These checks must be done on an actual device; automated WebKit is not a substitute. Use synthetic data first.

- [ ] Open HTTPS site in Safari; first load has no blocking errors or horizontal overflow at 390 × 844 and larger iPhone sizes.
- [ ] Share → Add to Home Screen → Open as Web App → Add; icon/name appear correctly.
- [ ] Launch icon; app is standalone, correct theme and safe-area top/bottom padding; navigation and import confirmation clear the home indicator.
- [ ] Select a PDF in Files (On My iPhone and iCloud Drive); handle an iCloud file that first needs to download.
- [ ] Select multiple PDFs where the picker supports it; review/commit sequentially; one failed file can be retried/skipped without losing completed imports.
- [ ] Import generated Barclays, Amex and Revolut PDFs; compare all rows, signs, counts and balances.
- [ ] Verify a multiline/page-break transaction, two identical purchases, a refund, a foreign currency reference and credit-card payment.
- [ ] Validation-warning fixture requires explicit override; exact duplicate requires separate override; unchecked possible duplicates remain visible.
- [ ] Scan fixture starts local OCR, keeps scrolling responsive, requires amount verification and reconciles.
- [ ] Portrait and landscape, scrolling, large text/200% zoom, keyboard, date/select controls, touch targets and VoiceOver labels remain usable.
- [ ] Dashboard month navigation, categories → transactions, search/filters, transaction edits/rules, manual transfers and Property analysis work.
- [ ] Wait for Offline ready; enable airplane mode; force-close and relaunch; historical dashboard/transactions/edits/analysis work.
- [ ] Import a digital PDF and scanned PDF in airplane mode (files must already be local).
- [ ] Export backup in airplane mode; save to Files; reopen JSON; export CSV and inspect decimal amounts.
- [ ] Restore valid backup after explicit replace warning; counts/categories/rules/transfer links survive. Invalid/future backup leaves data intact.
- [ ] Delete demo preserves real synthetic imports; clearing all local data needs explicit acknowledgement.
- [ ] Load a previous app release, deploy an updated release; update banner appears; ignore safely, then finish review and tap Update; database contents persist.
- [ ] Import a large statement and inspect responsiveness/memory; measure typical digital monthly workflow against the one-minute goal.
- [ ] Restore a 20,000-row synthetic backup; search/filter monthly pages, analysis and backup remain responsive. Record timings rather than assuming simulator results apply.
- [ ] Safari Web Inspector network check: no financial data leaves the device; imports work disconnected.
- [ ] Export a backup, restart device, confirm data remains; test browser storage/persistence settings. Do not treat this as guaranteed retention.

Only after those checks, test private real statements from ignored `private-fixtures/`, compare each transaction and closing balance locally and record layout differences using synthetic reproductions. Do not share real financial screenshots or traces.

## Version 1.1 appearance and review

- [ ] Starts dark; Settings → Appearance → Light persists through relaunch.
- [ ] Home, Import, Analyse and transaction details have readable, non-overlapping controls at the device's default and enlarged text sizes.
- [ ] Import is reachable from the bottom navigation; confirmation remains above the home indicator and the last editable field can scroll fully into view.
- [ ] The review starts with extraction exceptions; All transactions reveals editable rows without obscuring the confirmation button.
- [ ] A private personal-rules JSON can be selected from Files, previewed and applied; the expected categories/transfers appear in existing transactions and after the next import.
- [ ] After importing statements, Home selects their latest activity month. Account balances are clearly dated statement snapshots.
