# Final-polish audit method

The audit extends the original `feng-ui-audit.mjs` supplied by the UX designer. It retains the seven browser setups, screenshots, element measurements, `elements.csv`, `issues.csv`, `summary.json` and a clickable HTML report. It uses the repository's existing Playwright and axe dependencies.

Run against immutable production-build directories. Never replace a build while a browser is precaching it or while screenshots are being captured. Set `FENG_E2E_URL` to use the same immutable server for end-to-end tests. Generate synthetic statement fixtures, then run:

```sh
npm run fixtures
npm run build
npm run preview
# In another terminal:
node scripts/feng-ui-audit.mjs http://localhost:4173 --phase before --output audit/before
# After the fixes, against the new production preview:
node scripts/feng-ui-audit.mjs http://localhost:4173 --phase after --output audit/after
node scripts/feng-ui-audit.mjs --report-only --before audit/before --after audit/after
node --test scripts/feng-ui-audit.test.mjs scripts/feng-polish-audit-evidence.test.mjs
```

The five mobile setups run in WebKit; the two desktop setups run in Chromium. Widths/heights are 390×844, 375×667, 320×568, 390×844 at 200% text, 390×844 light, 1440×900 and 1024×768. Fresh isolated contexts contain only fictitious demo/test records. External network requests are blocked and recorded. The audit never reads a personal browser profile.

The inventory contains 140 actual states (980 captures across seven setups), including recurring-bill identity confirmation and Undo. The driver captures every inventoried page, sheet, toast, empty state and error state. The non-reconciling statement is synthetic T11. Captures have matching setup/state filenames; a missing or unaudited state is a failure, rather than an assumed pass. Filtered diagnostic runs can use `FENG_AUDIT_SETUPS` and `FENG_AUDIT_GROUPS`, but do not constitute the full release gate.

## Measurements

- Text is reconstructed with a `Range` for each Unicode character. Actual line placement detects squeezed labels, mid-word breaks and wrapped currency/date substrings. A paragraph may wrap; only its matched monetary/date substring is treated as atomic. Its `£1,234.56` or `13 Oct 2026` substring may not.
- Text-node boundaries across separate block/flex fields are separated when reconstructing words. `Merchant` and a separate metadata field are not treated as one invented word. Inline fragments remain joined.
- Min-content uses real glyph bounds for intact words and the actual font for wrapped words. This avoids comparing a child rendered at 13 px with the font of its enclosing 15 px button. Content dimensions exclude padding; border rectangles are retained separately.
- Label hit areas count for checkboxes/radio buttons, while the small visual checkbox does not itself need to be 44 px. A visible associated label remains mandatory.
- Dividers are checked to 1 px. Four-sided outlines of cards/controls are not between-row separators. Inner separators are checked for width, offset, edge placement and doubling.
- Lists compare amount positions only between distinct repeated rows in the same column; KPI tiles and calendar cells are not lists.
- The bottom of every scrollable area is tested against fixed/sticky bars; its scroll position is restored afterwards.
- axe checks WCAG 2.2 AA, names and contrast. Element CSV also preserves the designer's nearest-solid-background contrast measurement, clearly labelled as approximate. SVG axis labels additionally use their rendered fill against the nearest solid chart background. This targeted measurement catches Recharts text that axe excludes; the new broken/healthy dark and light examples exercise that gap.

## Evidence exceptions

Exceptions are exported per node to `exceptions.csv` and shown in the report. They never disable another check on that element:

- A connected segmented control or navigation composite may have adjoining, non-overlapping hit rectangles. Each segment still has to meet the applicable target floor.
- Full-height contiguous list rows have their own 52/64 px hit regions and share the list component's separators. They are measured separately from adjacent standalone buttons, which require 8 px, or destructive actions, which require 16 px.
- A calendar cell deliberately stacks a day number and a compact daily total. Those independent fields are measured individually; their combination is not an accidentally wrapped two-line label.
- Text inside an actual horizontal scroll container can be reached by scrolling. Its original width and scroll-container selector are retained; page overflow and money/date wrapping remain checked.

Thirty-six seeded browser tests plus eight evidence tests verify the detector against broken money/date strings and statement date ranges, mid-word wrapping, squeezed siblings, clipped text, misplaced/double separators (including border-only and background-only lines), vertical separators (including border-only lines), misaligned amounts within the same table column, destructive spacing, native file controls, leaked skip links, unlabelled checkboxes, small text/targets, overlapping hit regions, copy-format defects, fixed-footer reachability, closed nested disclosures, password-reveal text reservation and healthy reference rows. Transparent hover controls are checked when visible. Thresholds match the supplied specification.

Playwright WebKit does not replace physical iPhone Safari or VoiceOver testing. Root-font scaling approximates Safari text sizing. Physical-device, beta-round and product-owner gates must retain their separate evidence.

A protected password-reveal composite is an explicit, exported exception only when the input reserves the button width plus 8 px. Its button must still meet the target floor and have a name. The seeded unsafe version remains a failure.

The latest successful replay supersedes a previous failure only for that exact setup/group. Historical failures remain recorded as resolved evidence. Missing screenshots, unaudited states and unresolved errors always fail the gate.

Lighthouse tooling is optional and kept outside runtime dependencies. Use `FENG_LIGHTHOUSE_MODULE` to point `scripts/feng-lighthouse.mjs` at an installed Lighthouse ES module; it tests Home, Transactions and Settings in both themes using an isolated demo-only profile.

The explicit two-line allowance for page and sheet titles is an exported exception. Narrow or three-line titles still fail, and clipping and word splitting are checked independently. Every new capture records its JavaScript entry and loaded CSS fingerprints. The main index stylesheet identifies the build; lazy route styles may be added during navigation. A mixed or unidentified after build cannot pass the gate. Earlier before captures identify the immutable baseline entry script; CSS fingerprinting and switch-track measurement were added during this pass.

The final local snapshot uses port 8116 (immutable application source `3470985`). WebKit refused navigation on port 4190
before emitting a document request, while Chromium and curl could reach it; the
same immutable directory passed the independent WebKit opening probe on 8088.
The abandoned 4190 run is retained as failed diagnostic evidence. A failed
capture closes its isolated browser context before the next group runs.

The HTML report opens one setup at a time and supports `?setup=iphone390-dark&state=home-partial`. Every state links to its original JSON, including all character ranges, axe results and element sizes; these large raw measurements are not duplicated in the HTML. Both healthy multi-column tables and a deliberately misaligned cell are covered by the detector tests.

Captures now wait for a real, non-loading page or modal and require stable text across multiple frames. The scene is checked again after viewport/full-page screenshots; a change retries the capture and an unresolved change fails it. After evidence without `sceneReady` cannot pass. Synthetic local-file reads are temporarily delayed for the processing-state capture, then released without modifying the PDF bytes. The original baseline was additionally checked for loading frames; two flagged baseline images are recaptured against the original immutable build.

The visual pass additionally found shrunken switch tracks, joined helper text and an overflowing last-backup receipt at 200% text. Shared switch geometry, selected account-chip text and disclosure markers were corrected. The saved-backup row now has one wrapping text child while its date stays atomic. A native checkbox with a switch role must have a track of at least 36×20 px, independently of its label hit area; a seeded broken track proves this rule catches the original defect.

`node scripts/feng-polish-justify-lows.mjs audit` generates a separate per-occurrence justification file. It preserves every original numerical finding, refuses unknown patterns and reports completion only after the recorded visual review is complete. It does not suppress high or medium findings or turn an incomplete audit into a pass.

A dedicated high-severity receipt-clearance check measures each floating toast against the actual dialog footer top, including modal border and padding. The healthy and overlapping modal examples are seeded independently. The original-size visual pass found that the sorting footer had no matching measurement wrapper; the new footer keeps Skip and View transaction details clear. All 44 audit/evidence tests and six Toast unit tests pass.

Contact sheets pair each viewport with an overview of its full-page source. They are inspection aids; original PNGs are unchanged and hashed in the manifest. The visual review record records each viewed sheet by SHA-256. Financial and source-text details can be opened at original resolution.

Final date-entry checks measure whether the complete DD/MM/YYYY value or its placeholder fits the visible input after padding. The shared UK date field does not rely on the browser OS locale, accepts the iPhone numeric keypad’s eight digits, and keeps ISO storage and existing financial date validation. Chrome and WebKit tests deliberately run in a US locale and verify the persisted date and signed amount. The native calendar helper is visually hidden and excluded from the tab order; its named 44px calendar action remains available.

The nested-control spacing check includes controls in a neighbouring wrapper. It found real gaps in the query builder and rule-action groups that a direct-sibling-only check missed. These gaps were fixed in shared styles. A focusable scroll region containing controls is a navigation/scroll container rather than an independent action; that semantic exception is recorded per occurrence. Individual controls, overlaps, end-of-scroll reachability and toast/footer clearance still receive their own checks. The seeded overlapping-footer case continues to fail.

The final visual record can carry a discovery inspection only when both the fresh final viewport PNG and full-page PNG have the exact SHA-256 hashes of the actual previously inspected source images. It records that method and the original sheet receipt explicitly. Every changed pair requires a new visual inspection. All final geometry, axe results and build identities still come from fresh captures. Baseline captures were accumulated during detector development; earlier baseline states do not have the later scene-readiness, switch-track, hidden-control, nested-gap and date-fit checks. They are disclosed rather than retrospectively passed.

Diagnostic runs are separate from the final before/after directories. A discovery desktop capture failed because the driver left the tag sheet open before trying Split; explicitly completing that sheet fixed the driver. The expanded final audit subsequently caught the rule-removal spacing defect. Neither incomplete diagnostic is release evidence. A local unit run using default worker concurrency timed out under combined browser/build load; the serial full run passed all 1,117 then-current tests. The additional numeric-keypad date test passes independently and is included in final CI. Two older browser assertions matched both a date field and its newly named calendar button; the corrected assertions target the exact textbox and retain all parsing and source-money checks.

The split capture explicitly selects both required categories, asserts Save is disabled with an allocation remainder, then enabled at an exact source allocation. Earlier screenshots had correctly disabled Save because a required category was empty; both split states are replayed against the unchanged before and after builds. Full-page browser screenshots preserve fixed navigation at its initial viewport position, so the separate scroll-reachability check and viewport image describe actual access while scrolling. First-use Home can include its inline Safari install notice; this is not a blocking dialog, and the full-page capture includes the empty-state actions.

The final original-size pass found Recharts default grey axis labels on report lines and what-if charts. Both now use the existing theme text token; report grid lines use the existing divider token. A dedicated SVG-fill contrast rule catches the original grey-on-dark defect. Fresh captures of all 980 states use this corrected build. The earlier 980-state visual review is retained as v2 discovery evidence, and its own earlier receipts as v1. The portable `scripts/verify-polish-visual.py audit` verifies the complete receipt chain and both original PNG hashes for any carried inspection. No fresh geometry or build identity is carried from a previous build.

Ordinary fake audit profiles explicitly store the installation-banner preference alongside their disabled rate-download preference. First-launch profiles do not store it and still exercise the actual notice and installation journey. This fixture choice avoids a racing setup click; it does not change the app or suppress financial warnings.

The report chart uses UK Uncategorised in axis and tooltip labels, and readable measurement names such as Net amount instead of internal field identifiers. The after-state driver asserts the actual rendered UK axis label, including at 320px and 200% text. This final copy patch does not change report values, filtering, grouping or source links.

## Download reproduction

With the verified `audit` directory beside the repository, run:

```sh
python3 scripts/verify-polish-visual.py audit
python3 scripts/feng-polish-standalone.py audit /tmp/feng-polish-downloads
python3 scripts/feng-polish-package.py audit /tmp/feng-polish-downloads
```

The generators refuse incomplete matrices, missing visual receipts or failed audit
gates. The full ZIP contains the raw measurements, original images, Lighthouse
reports and inspection receipt chain. Setup ZIPs include a local HTML index and
one CSV of exact element dimensions for each state. The standalone mobile HTML
embeds both image versions, journey explanations and element measurements, and
works offline without a server. No native operating-system file picker screenshot
is fabricated: the document explains that transition and the real-device checklist
covers it.

The original-size desktop rule-editor check caught a clipped selected Description option, which is rendered by the browser rather than ordinary text nodes. Condition rows now stack at desktop sheet widths too. The new `select-label-fit` check measures selected option text with the actual font and reserves its arrow/padding; a seeded clipped native option must fail. Rule-condition dates and range ends now use the same UK date control. The two browser engines test those boundaries under a US locale, without changing stored rule-date semantics.
