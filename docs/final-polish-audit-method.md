# Final-polish audit method

The audit extends the original `feng-ui-audit.mjs` supplied by the UX designer. It retains the seven browser setups, screenshots, element measurements, `elements.csv`, `issues.csv`, `summary.json` and a clickable HTML report. It uses the repository's existing Playwright and axe dependencies.

Run a production preview, generate synthetic statement fixtures, then run:

```sh
npm run fixtures
npm run build
npm run preview
# In another terminal:
node scripts/feng-ui-audit.mjs http://localhost:4173 --phase before --output audit/before
# After the fixes, against the new production preview:
node scripts/feng-ui-audit.mjs http://localhost:4173 --phase after --output audit/after
node scripts/feng-ui-audit.mjs --report-only --before audit/before --after audit/after
node --test scripts/feng-ui-audit.test.mjs
```

The five mobile setups run in WebKit; the two desktop setups run in Chromium. Widths/heights are 390×844, 375×667, 320×568, 390×844 at 200% text, 390×844 light, 1440×900 and 1024×768. Fresh isolated contexts contain only fictitious demo/test records. External network requests are blocked and recorded. The audit never reads a personal browser profile.

The driver captures every inventoried page, sheet, toast, empty state and error state. The non-reconciling statement is synthetic T11. Captures have matching setup/state filenames; a missing or unaudited state is a failure, rather than an assumed pass. Filtered diagnostic runs can use `FENG_AUDIT_SETUPS` and `FENG_AUDIT_GROUPS`, but do not constitute the full release gate.

## Measurements

- Text is reconstructed with a `Range` for each Unicode character. Actual line placement detects squeezed labels, mid-word breaks and wrapped currency/date substrings. A paragraph may wrap; its `£1,234.56` or `13 Oct 2026` substring may not.
- Text-node boundaries across separate block/flex fields are separated when reconstructing words. `Merchant` and a separate metadata field are not treated as one invented word. Inline fragments remain joined.
- Min-content uses real glyph bounds for intact words and the actual font for wrapped words. This avoids comparing a child rendered at 13 px with the font of its enclosing 15 px button. Content dimensions exclude padding; border rectangles are retained separately.
- Label hit areas count for checkboxes/radio buttons, while the small visual checkbox does not itself need to be 44 px. A visible associated label remains mandatory.
- Dividers are checked to 1 px. Four-sided outlines of cards/controls are not between-row separators. Inner separators are checked for width, offset, edge placement and doubling.
- Lists compare amount positions only between distinct repeated rows in the same column; KPI tiles and calendar cells are not lists.
- The bottom of every scrollable area is tested against fixed/sticky bars; its scroll position is restored afterwards.
- axe checks WCAG 2.2 AA, names and contrast. Element CSV also preserves the designer's nearest-solid-background contrast measurement, clearly labelled as approximate. axe is authoritative for the contrast gate.

## Evidence exceptions

Exceptions are exported per node to `exceptions.csv` and shown in the report. They never disable another check on that element:

- A connected segmented control or navigation composite may have adjoining, non-overlapping hit rectangles. Each segment still has to meet the applicable target floor.
- Full-height contiguous list rows have their own 52/64 px hit regions and share the list component's separators. They are measured separately from adjacent standalone buttons, which require 8 px, or destructive actions, which require 16 px.
- A calendar cell deliberately stacks a day number and a compact daily total. Those independent fields are measured individually; their combination is not an accidentally wrapped two-line label.
- Text inside an actual horizontal scroll container can be reached by scrolling. Its original width and scroll-container selector are retained; page overflow and money/date wrapping remain checked.

Fourteen seeded browser tests verify the detector against broken money/date strings, mid-word wrapping, squeezed siblings, clipped text, misplaced/double separators, misaligned amounts, destructive spacing, native file controls, leaked skip links, unlabelled checkboxes, small text/targets, overlapping hit regions, copy-format defects, fixed-footer reachability and healthy reference rows. Thresholds match the supplied specification.

Playwright WebKit does not replace physical iPhone Safari or VoiceOver testing. Root-font scaling approximates Safari text sizing. Physical-device, beta-round and product-owner gates must retain their separate evidence.
