# Import workflow: implementation review

This review covers the import-only 2.2.8 redesign. It does not repeat or replace the full-app 2.2.7 audit. The [design handoff](import-ux-redesign.md) records the journey, incumbent references, component sizing and financial acceptance rules.

## Reproduced baseline

A genuine synthetic Barclays PDF renamed to a long, unbroken filename expands the deployed 2.2.7 page to 1,283 CSS px at both 320 px and 390 px viewport widths. With 200% root text at 390 px it expands to 2,520 px. The raw filename paragraph escapes its statement card. The baseline was replayed after service-worker installation; the failure is independent of the deliberately blocked-worker diagnostic run. No real statement was used.

The previous page also exposes overlapping decision systems: statement warning acceptance, balance override, row inclusion/acknowledgement, source correction, bank options and optional transfer confirmations. The redesigned normal route must not require these to be individually approved when the statements already pass their checks.

## Review gates

| Milestone                                    | Principal review              | Evidence                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Batch journey                             | Accepted                      | Commit `6d5973d`; presentation derives its state from the original `importBlockers`; append preserves drafts/sessions and manual choices; exclusive expansion and focused attention navigation; leave-out/reinclude rechecks; no financial records written during preparation.                                                               |
| 1. Duplicate transitions                     | Accepted                      | A fresh nonduplicate restores its automatic inclusion after the competing statement is left out; a newly discovered duplicate is excluded and unacknowledged. Explicit decisions are tracked per fingerprint, which includes occurrence and balance. Both directions and exact repeated PDFs have integration regressions.                   |
| 1. Automated verification                    | Passed                        | 47 tests across five focused files; independent TypeScript, formatting and diff checks passed. Two earlier new integration tests timed out at the default one-second UI wait during a concurrent run. The unchanged single-worker replay passed all 47. Their cause is not established; the developer's validation log retains the failures. |
| 2. Decision controls and mobile layout       | Accepted                      | Commit `9e4c7e9`; 85 tests in nine focused files, TypeScript and production build pass. Principal inspected source mutations and original-size before/after screenshots; requested explicit years, account type, compact footer/card spacing, exact closed-card balance, and one primary blocker. All corrections are included.              |
| 3. Independent browser and regression checks | Accepted; release CI required | The 30 dedicated Chromium/WebKit cases pass across reviewed replays: exact native ledger, append/cancel, mixed errors, duplicates, seven layouts, financial/source/network assertions, sheets and desktop drop. The final full release remains gated by repository CI.                                                                       |

The implementation developer and principal reviewer are separate agents. The principal owns independent browser acceptance tests and reviews each milestone before the next proceeds. No external human review is claimed.

## Principal corrections and independent checks

The senior developer implemented the handed-off design in two milestones; each
was reviewed before proceeding. Decision actions were checked against the
existing blocker service. Financial acceptance remains separate from ordinary
warnings, presents exact figures and unread-page evidence, and does not turn
an unverified statement into a reconciled one. The rare confirmation sheet is
the only normal visible checkbox in that exceptional journey.

Review corrections included preserving every endpoint year, distinguishing
current accounts from credit cards in closed objects, retaining unknown-balance
labels, reducing the ready footer, keeping existing row decisions while adding
files and preventing a repeated drop handler. Generic exceptions no longer
repeat in a second normalised transaction checklist. Raw source evidence is
scrollable and keyboard accessible rather than clipped or broken into characters.

The first independent candidate browser run passed nine of eleven tests. The
two failures were acceptance-driver errors: an outdated fresh-Home label and
looking for an editor while its statement was collapsed during appended-file
checking. The final tests wait for batch review and open the editor as a user
would. No stored-finance assertion was removed. A separate three-setup replay
passed financial-confirmation and generic-mapping layout, focus return and
minimum input text-size checks at 320 px, 390 px with 200% text, and 1440 px.

## Screen evidence and sizing

All screenshots below contain fictitious statements. They show the frozen
milestone-2 layout; the later QIF-only disclosure correction does not alter these
PDF scenes. Images are original viewport captures, not full-page composites
with a sticky footer repeated through the page.

| Scene                                    | Viewport / text           | Screenshot                                                             |
| ---------------------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| Original long-filename failure           | 390 × 844, dark           | [Before: broken layout](reviews/import-2.2.8/before-long-filename.png) |
| Four native PDFs ready; one final action | 390 × 844, dark           | [Batch review](reviews/import-2.2.8/batch-ready.png)                   |
| Open statement and exact figures         | 390 × 844, dark           | [Statement figures](reviews/import-2.2.8/statement-figures.png)        |
| Financial discrepancy confirmation       | 320 × 568, dark           | [Unverified statement](reviews/import-2.2.8/unverified-320.png)        |
| Unfamiliar-bank mapping on demand        | 390 × 844, 200% root text | [Column mapping](reviews/import-2.2.8/mapping-text200.png)             |
| Same batch in light mode                 | 390 × 844, light          | [Light batch review](reviews/import-2.2.8/batch-light.png)             |

[Raw scene measurements](reviews/import-2.2.8/geometry.json) retain seven scenes
for each of four visual setups: choose files, ready batch, statement figures,
transaction editing, failed balance, financial confirmation and generic mapping.
All 28 captured scenes have document width equal to viewport width, no recorded
page error and no unexpected external request. The independent browser tests
also cover 375 px and 1024/1440 px desktop layouts in both engines.

| Layout contract        | Implementation                                            |
| ---------------------- | --------------------------------------------------------- |
| Touch control          | At least 44 CSS px; primary action at least 48 px         |
| Input text             | At least 16 CSS px, while respecting enlarged text        |
| Card inset             | 16 CSS px; shared 12 px list gap                          |
| Financial values       | Atomic, right aligned; label/value rows wrap deliberately |
| Statement period       | Two complete endpoint dates, each with its year           |
| Raw filename/reference | Bounded horizontal scroll region with keyboard focus      |
| Final action           | Above bottom navigation and safe-area inset               |

The [baseline measurements](reviews/import-2.2.8/before-geometry.json) retain the original overflow.
The same long-filename reproduction measured 1,283 px before and exactly 320 or
390 px after. At 390 px with 200% root text it changed from 2,520 to 390 px.

## Regression follow-up

The first complete CI run passed 217 of 222 browser cases. The five failures
were the same three scenarios across the two engines: an old test needed to
open the deliberately collapsed date settings; a required QIF identity form
needed to open automatically; and Playwright WebKit's offline interception
bypassed the service worker. The QIF presentation correction has two component
regressions (required controls open; prepared controls closed), with all 24
component tests passing. The offline journey now installs a private local origin,
stops its server, and verifies a cold service-worker launch and the exact native
ledger without a reachable server. This keeps the financial and network assertions.

Before that final presentation correction, the full unit suite passed 1,148 tests
in 150 files; the production build, formatting, hygiene and dependency audit
passed. The dependency audit found zero vulnerabilities. Final CI is the delivery
gate for the complete current source, including the two added QIF tests.

## Preserved safety boundaries

Parsers, validation mathematics/tolerances, database schema and transfer matching policies remain outside this change. The final action must continue to call the existing validated batch commit. Read failures, missing evidence, invalid dates/amounts, unverified statements, incomplete pages and potential duplicates remain explicit. Leaving out a statement is visible and reversible before the final import.

## Device limits

Automated Chromium and WebKit checks do not replace the physical iPhone Files picker, software keyboard, safe-area and VoiceOver checklist. Physical-device sign-off is not claimed.

## Reproduce the verification

```sh
npm ci
npm run fixtures
npm test
npm run build
npx playwright install --with-deps chromium webkit
npx playwright test tests/e2e/import-workflow-review.spec.ts
npm run test:e2e
npm audit --audit-level=moderate
```

The [pull request and check history](https://github.com/lech1012-collab/feng-finance/pull/2)
retain the final delivery result. GitHub Pages deploys only after the full main
verification workflow succeeds. No production financial data is used in these
checks or screenshots.
