# Chart inspection — 2.2.30

The former cash-flow tooltip put several values and a long verification warning
on top of the plot. On an iPhone it hid both the data and the position selected
by the user's finger. Category charts had the same floating-tooltip behavior;
the existing balance readout sat below its plot.

Cash flow, category trends and Balance trend now use the same interaction:

1. Read the selected month/date and values above the plot, in normal page flow.
2. Tap a point or drag horizontally to select the nearest month/date. A vertical
   guide marks the selection; bars have a contrasting edge and line points have
   a marker. Releasing the pointer retains the reading.
3. Swipe vertically to scroll the page. A short direction threshold distinguishes
   a horizontal scrub from scrolling; native pan-y and pinch zoom remain enabled.
4. Tap the selected coverage badge for its explanation. Long warnings stay out of
   the chart. Missing/unverified statuses and unavailable values remain explicit.
5. In a category, tap the month in the readout to open its source transactions.
   Tapping a bar now selects it, so inspection cannot accidentally navigate away.
6. Keyboard users focus the named adjustable chart and use arrows, Home or End.
   Accessible values tables and source links remain available.

The readout reserves space using invisible, noninteractive sizing text, excluded
from the accessibility tree and ordinary text content. Moving between amounts,
zeros and missing-data messages does not move the plot beneath the finger. It
wraps at narrow widths and enlarged text; financial values are not truncated.

`ChartInspector.tsx` provides the reusable reading/gesture contract. Its Recharts
marker uses the actual chart scales, including categorical band centres and
numeric axes. The named chart control owns focus; synthetic mouse events after a
tap cannot focus internal SVG layers or outline a whole series. Pointer coordinates are converted through the rendered SVG, so
resizing or text scaling cannot silently select a neighbouring month. Balance
trend uses the same readout/gesture handling with its existing dated SVG scale.

This changes presentation and inspection only. Amounts, signs, currency
conversion, transfer exclusion, averages, variation, reconciliation and database
schema are unchanged. Missing data stays unavailable, zero remains zero, partial
bars stay faded and balance lines still break at unverified dates. There are no
new dependencies, network services or stored preferences.

Automated coverage includes signed cash-bar geometry, keyboard readings, gap
states, selection persistence, marker placement, native Chromium touch scrolling,
WebKit taps/drag handling, readout stability at enlarged text sizes, category
source navigation, accessibility and unchanged financial records. Real iPhone
Safari/VoiceOver checks remain in the [manual checklist](iphone-checklist.md).
