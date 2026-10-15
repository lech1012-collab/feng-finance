/**
 * Feng final-polish audit, independent of application code and financial data.
 *
 * Geometry is measured in CSS pixels. Text lines are reconstructed from a
 * Range for each Unicode character, not inferred from element height. Money
 * and date checks measure the actual matched substring: explanatory paragraphs
 * may wrap, but the amount/date inside them may not. Min-content is measured
 * as the longest unbreakable word (or the entire nowrap string) with the actual
 * font, letter spacing and box padding. Native text inputs are checked separately.
 *
 * Exceptions are evidence, never selector-wide suppression. They are returned
 * per element with a reason and measurements: off-screen screen-reader content,
 * contained scrollable tables, structural contiguous list rows and connected
 * segmented controls. All rules remain active on other properties of that node.
 *
 * The caller supplies the seven requested browser setups and state inventory.
 * Usage: await auditState(page, setup, { id, title, route }). The returned object
 * is JSON-serialisable. No IndexedDB, app preferences or financial records change.
 */
import { createRequire } from "node:module";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";

const require = createRequire(import.meta.url);
const AxeBuilder = require("@axe-core/playwright").default;

export const AUDIT_RULES = {
  "page-overflow": ["high", "Document must not scroll horizontally."],
  "chart-label-overlap": [
    "medium",
    "SVG axis labels must not overlap at the rendered text size.",
  ],
  "text-squeezed": [
    "medium",
    "Wrapped lines average at least 8 characters; no 3-line label in a box below 120 px.",
  ],
  "word-split": ["medium", "Names and labels break at word boundaries."],
  "unsafe-word-break": [
    "medium",
    "No break-all/anywhere on an atomic name, label, date or amount.",
  ],
  "amount-wrap": ["high", "Every currency amount is rendered on one line."],
  "date-wrap": ["medium", "Every displayed date is rendered on one line."],
  "sibling-squeeze": [
    "medium",
    "Flex/grid children fit their unbreakable min-content width.",
  ],
  "text-clipped": [
    "medium",
    "Text is never clipped or ellipsised without an intentional scroll container.",
  ],
  "divider-short": ["medium", "Dividers span the content width, within 1 px."],
  "divider-in-row": [
    "medium",
    "Dividers separate rows rather than sitting inside them.",
  ],
  "divider-at-edge": [
    "low",
    "No internal divider as the first/last card child.",
  ],
  "divider-double": ["medium", "No stacked duplicate separator lines."],
  "vertical-line-short": ["low", "Vertical separators span the row height."],
  "amount-alignment": [
    "medium",
    "List amounts share a right edge, within 1 px.",
  ],
  "label-alignment": ["low", "List labels share the content edge."],
  "heading-centred": [
    "low",
    "Card headings align with left-aligned sibling content.",
  ],
  "spacing-token": ["low", "Sibling gaps use 4, 8, 12, 16, 24 or 32 px."],
  "mobile-card-margin": [
    "medium",
    "Top-level mobile cards have 16 px side margins.",
  ],
  "target-gap": [
    "medium",
    "Adjacent independent controls have at least 8 px separation.",
  ],
  "destructive-gap": [
    "high",
    "Destructive controls have at least 16 px from other controls.",
  ],
  "bottom-content-covered": [
    "high",
    "Content remains reachable above fixed/sticky bottom bars.",
  ],
  "fixed-overlap": ["high", "Fixed objects do not obscure actionable content."],
  "control-overlap": [
    "medium",
    "Independent interactive hit regions do not overlap.",
  ],
  "skip-link-leaked": ["medium", "Skip link is visible only when focused."],
  "file-input-leaked": [
    "medium",
    "Native file controls are visually hidden behind named controls.",
  ],
  "custom-select-native-arrow": [
    "low",
    "Custom select must not display a duplicate native arrow.",
  ],
  "checkbox-unlabelled": [
    "high",
    "Every checkbox/radio has a visible associated label.",
  ],
  "switch-geometry": [
    "medium",
    "Switch tracks remain wide enough to contain their thumb in both states.",
  ],
  "target-size": [
    "medium",
    "Targets are at least 44 px mobile / 24 px desktop.",
  ],
  "input-font": ["medium", "Mobile form fields use at least 16 px text."],
  "text-font": ["medium", "No rendered text below 12 px."],
  "document-language": ["medium", "Document language is en-GB."],
  "copy-em-dash": ["low", "UI copy uses no em dashes."],
  "copy-iso-date": ["medium", "Displayed dates use UK words, never ISO."],
  "copy-numeric-date": [
    "medium",
    "Displayed dates use UK words, never numeric US order.",
  ],
  "axe-aa": ["high", "WCAG 2.2 AA and named controls."],
};

/** Raw browser-side, synchronous, read-only measurements. Exported for seeded tests. */
export function collectGeometry({ mobile, setupId, stateId }) {
  const issues = [];
  const exceptions = [];
  const measurements = {
    viewport: { width: innerWidth, height: innerHeight },
    textNodes: 0,
    controls: 0,
    cards: 0,
    dividers: 0,
    textSamples: [],
    targetSamples: [],
    cardSamples: [],
  };
  const tolerance = 1;
  const scale = [4, 8, 12, 16, 24, 32];
  const all = [...document.querySelectorAll("body *")];
  const styles = new WeakMap();
  const cs = (e) =>
    styles.get(e) || (styles.set(e, getComputedStyle(e)), styles.get(e));
  const rect = (e) => {
    const r = e.getBoundingClientRect();
    return {
      x: round(r.x),
      y: round(r.y),
      top: round(r.top),
      left: round(r.left),
      right: round(r.right),
      bottom: round(r.bottom),
      width: round(r.width),
      height: round(r.height),
    };
  };
  const round = (n) => Math.round(n * 100) / 100;
  const cssEscape = (s) => CSS.escape(s);
  const selector = (e) => {
    if (e.id) return "#" + cssEscape(e.id);
    const parts = [];
    for (
      let node = e;
      node && node !== document.body && parts.length < 5;
      node = node.parentElement
    ) {
      if (node.id) {
        parts.unshift("#" + cssEscape(node.id));
        break;
      }
      let part = node.localName;
      const classes = [...node.classList]
        .filter((s) => !s.startsWith("recharts-"))
        .slice(0, 2);
      if (classes.length)
        part += classes.map((s) => "." + cssEscape(s)).join("");
      if (node.parentElement) {
        const peers = [...node.parentElement.children].filter(
          (p) => p.localName === node.localName,
        );
        if (peers.length > 1)
          part += ":nth-of-type(" + (peers.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
    }
    return parts.join(" > ");
  };
  const text = (e) =>
    (e.textContent || "").replace(/\s+/gu, " ").trim().slice(0, 240);
  const name = (e) =>
    e.getAttribute("aria-label") ||
    e.getAttribute("title") ||
    text(e) ||
    e.getAttribute("placeholder") ||
    e.getAttribute("name") ||
    e.localName;
  const visible = (e, includeOffscreen = true) => {
    if (!e || e.closest("[inert],[hidden]")) return false;
    const s = cs(e),
      r = e.getBoundingClientRect();
    if (
      s.display === "none" ||
      s.visibility === "hidden" ||
      Number(s.opacity) === 0 ||
      r.width <= 0 ||
      r.height <= 0
    )
      return false;
    for (let p = e.parentElement; p; p = p.parentElement)
      if (Number(cs(p).opacity) === 0) return false;
    for (let p = e.parentElement; p; p = p.parentElement) {
      if (
        p.localName === "details" &&
        !p.open &&
        !p.querySelector(":scope > summary")?.contains(e)
      )
        return false;
    }
    if (s.clip !== "auto" && s.clip !== "none") return false;
    if (s.clipPath !== "none" && (r.width <= 2 || r.height <= 2)) return false;
    if (r.right <= 0 || r.left >= innerWidth || r.bottom <= -100) return false;
    if (!includeOffscreen && (r.bottom <= 0 || r.top >= innerHeight))
      return false;
    const dialog = document.querySelector("dialog[open]");
    if (dialog && !dialog.contains(e) && !e.contains(dialog)) return false;
    return true;
  };
  const add = (rule, e, measured, expected, note = "") => {
    const entry = {
      rule,
      severity: rule === "axe-aa" ? "high" : rules[rule][0],
      selector: e ? selector(e) : "html",
      text: e ? name(e) : "",
      measured,
      expected,
      note,
      rect: e ? rect(e) : undefined,
      setup: setupId,
      state: stateId,
    };
    if (
      !issues.some(
        (i) => i.rule === entry.rule && i.selector === entry.selector,
      )
    )
      issues.push(entry);
  };
  const except = (rule, e, measured, reason) => {
    const key = rule + selector(e);
    if (!exceptions.some((i) => i.key === key))
      exceptions.push({ key, rule, selector: selector(e), measured, reason });
  };
  // Local copy is serialised with the function; no external closure in page.evaluate.
  const rules = {
    "page-overflow": ["high"],
    "text-squeezed": ["medium"],
    "word-split": ["medium"],
    "unsafe-word-break": ["medium"],
    "amount-wrap": ["high"],
    "date-wrap": ["medium"],
    "sibling-squeeze": ["medium"],
    "text-clipped": ["medium"],
    "divider-short": ["medium"],
    "divider-in-row": ["medium"],
    "divider-at-edge": ["low"],
    "divider-double": ["medium"],
    "vertical-line-short": ["low"],
    "amount-alignment": ["medium"],
    "label-alignment": ["low"],
    "heading-centred": ["low"],
    "spacing-token": ["low"],
    "mobile-card-margin": ["medium"],
    "target-gap": ["medium"],
    "destructive-gap": ["high"],
    "bottom-content-covered": ["high"],
    "fixed-overlap": ["high"],
    "control-overlap": ["medium"],
    "skip-link-leaked": ["medium"],
    "file-input-leaked": ["medium"],
    "custom-select-native-arrow": ["low"],
    "checkbox-unlabelled": ["high"],
    "switch-geometry": ["medium"],
    "target-size": ["medium"],
    "input-font": ["medium"],
    "text-font": ["medium"],
    "document-language": ["medium"],
    "copy-em-dash": ["low"],
    "copy-iso-date": ["medium"],
    "copy-numeric-date": ["medium"],
  };
  if (document.documentElement.scrollWidth > innerWidth + tolerance)
    add(
      "page-overflow",
      null,
      {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        overflowCandidates: all
          .filter(
            (e) =>
              visible(e) &&
              e.getBoundingClientRect().right > innerWidth + 1 &&
              !e.matches("body,main"),
          )
          .sort(
            (a, b) =>
              b.getBoundingClientRect().right - a.getBoundingClientRect().right,
          )
          .slice(0, 20)
          .map((e) => ({
            selector: selector(e),
            text: text(e),
            rect: rect(e),
            whiteSpace: cs(e).whiteSpace,
            minWidth: cs(e).minWidth,
            overflowX: cs(e).overflowX,
          })),
      },
      "documentWidth <= viewportWidth + 1",
    );
  if (document.documentElement.lang.toLowerCase() !== "en-gb")
    add(
      "document-language",
      document.documentElement,
      document.documentElement.lang,
      "en-GB",
    );

  const moneyPattern =
    /(?:[+−-]\s*)?(?:≈\s*)?(?:£|€|US\$|\$|CHF\s|GBP\s|EUR\s)\s?\d[\d,]*(?:\.\d{1,2})?(?:[kKmM])?/gu;
  const datePattern =
    /\b\d{1,2}(?:\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep(?:t)?|Oct|Nov|Dec))?\s+to\s+\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep(?:t)?|Oct|Nov|Dec)(?:\s+\d{4})?\b|\b(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep(?:t)?|Oct|Nov|Dec)(?:\s+\d{4})?\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/gu;
  const atomic = (e) =>
    e.matches(
      'button,a,label,summary,legend,dt,dd,th,td,h1,h2,h3,h4,h5,h6,time,strong,b,small,[class*="amount"],[class*="merchant"],[class*="name"],[class*="label"],[class*="title"],[class*="status"],[class*="chip"]',
    ) ||
    (text(e).length <= 80 && !e.matches("p,blockquote,figcaption"));
  const ownText = (e) =>
    [...e.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim(),
    );
  const textElements = all.filter(
    (e) =>
      visible(e) &&
      !e.closest("script,style,noscript,option,textarea,pre,code") &&
      (ownText(e) ||
        (e.matches(
          "button,a,label,summary,legend,h1,h2,h3,h4,h5,h6,dt,dd,time",
        ) &&
          !e.querySelector("p,div,button,a,summary,li"))),
  );
  const canvas = document.createElement("canvas");
  const drawing = canvas.getContext("2d");
  const textMeasure = (value, e) => {
    const s = cs(e);
    // font-variant-numeric isn't valid in the canvas font shorthand; including
    // it can silently retain the preceding element's font and invent squeeze.
    drawing.font = [s.fontStyle, s.fontWeight, s.fontSize, s.fontFamily].join(
      " ",
    );
    const letterSpacing = parseFloat(s.letterSpacing) || 0;
    return (
      drawing.measureText(value).width +
      letterSpacing * Math.max(0, [...value].length - 1)
    );
  };
  const lineData = (e) => {
    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement &&
        visible(n.parentElement) &&
        !n.parentElement.closest('script,style,.sr-only,[aria-hidden="true"]')
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    });
    const chars = [],
      lines = [];
    let raw = "",
      n,
      previousContainer;
    const flowContainer = (node) => {
      for (let p = node.parentElement; p && p !== e; p = p.parentElement) {
        if (!["inline", "contents"].includes(cs(p).display)) return p;
      }
      return e;
    };
    while ((n = walker.nextNode())) {
      if (raw.length > 1500) break;
      const container = flowContainer(n);
      // Adjacent DOM nodes can be different stacked fields (Name + metadata),
      // not one word. Preserve inline fragments while adding a semantic space
      // at block/independent flex-item boundaries.
      if (
        raw &&
        container !== previousContainer &&
        !/\s$/u.test(raw) &&
        !/^\s/u.test(n.textContent)
      )
        raw += " ";
      previousContainer = container;
      for (let offset = 0; offset < n.textContent.length;) {
        const char = String.fromCodePoint(n.textContent.codePointAt(offset));
        const range = document.createRange();
        range.setStart(n, offset);
        range.setEnd(n, offset + char.length);
        const r = [...range.getClientRects()].find(
          (b) => b.width > 0.1 && b.height > 0.1,
        );
        let lineIndex = -1;
        if (r && !/\s/u.test(char)) {
          const centre = (r.top + r.bottom) / 2;
          lineIndex = lines.findIndex(
            (l) =>
              Math.abs(l.centre - centre) <=
              Math.max(1.5, Math.min(l.height, r.height) * 0.35),
          );
          if (lineIndex === -1) {
            lineIndex = lines.length;
            lines.push({
              centre,
              top: r.top,
              bottom: r.bottom,
              height: r.height,
              text: "",
            });
          }
        }
        chars.push({
          char,
          start: raw.length,
          line: lineIndex,
          element: n.parentElement,
          rect: r
            ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
            : null,
        });
        raw += char;
        offset += char.length;
      }
    }
    for (const c of chars) if (c.line >= 0) lines[c.line].text += c.char;
    const countLines = (start, end) =>
      new Set(
        chars
          .filter(
            (c) =>
              c.start >= start &&
              c.start < end &&
              c.line >= 0 &&
              !/\s/u.test(c.char),
          )
          .map((c) => c.line),
      ).size;
    return { raw, chars, lines, countLines };
  };
  const amountNodes = [];
  for (const e of textElements) {
    const s = cs(e),
      r = e.getBoundingClientRect();
    const font = parseFloat(s.fontSize);
    measurements.textNodes++;
    if (font < 12 - 0.1)
      add("text-font", e, { fontSize: round(font) }, ">= 12 px");
    if (!e.textContent.trim()) continue;
    const data = lineData(e);
    if (!data.lines.length) continue;
    // Preserve the supplied audit's UK-copy checks. Raw PDF text and technical
    // diagnostics are source evidence, rather than application date labels.
    const sourceEvidence = e.closest(
      "[data-source-text],.raw-description,.raw-statement-text,.technical-details,.import-diagnostic-source",
    );
    for (const [pattern, rule] of [
      [/\u2014/u, "copy-em-dash"],
      [/\b\d{4}-\d{2}-\d{2}\b/u, "copy-iso-date"],
      [/\b\d{1,2}\/\d{1,2}\/\d{4}\b/u, "copy-numeric-date"],
    ]) {
      const match = data.raw.match(pattern);
      if (match) {
        if (sourceEvidence)
          except(
            rule,
            e,
            { value: match[0], source: selector(sourceEvidence) },
            "Original source/technical text is retained verbatim for traceability; formatted application labels are checked separately.",
          );
        else add(rule, e, { value: match[0] }, "UK application copy");
      }
    }
    const lines = data.lines.map((l) => ({
      text: l.text,
      top: round(l.top),
      bottom: round(l.bottom),
    }));
    const textLength = data.raw.replace(/\s+/gu, "").length;
    const average = textLength / data.lines.length;
    const compoundFields = [...e.children].filter(
      (c) =>
        visible(c) &&
        text(c) &&
        !["inline", "contents"].includes(cs(c).display),
    );
    if (
      atomic(e) &&
      data.lines.length > 1 &&
      (average < 8 || (data.lines.length >= 3 && r.width < 120))
    ) {
      if (
        e.matches("h1,.sheet-heading h2") &&
        data.lines.length === 2 &&
        r.width >= 120
      )
        except(
          "text-squeezed",
          e,
          { width: round(r.width), lines, averageCharacters: round(average) },
          "The brief explicitly allows page and sheet titles to wrap to two lines. This title has normal width; word splitting, clipping, sibling squeeze and overflow remain separate checks.",
        );
      else if (
        compoundFields.length + (ownText(e) ? 1 : 0) >= 2 &&
        compoundFields.every((c) => !c.querySelector("br"))
      )
        except(
          "text-squeezed",
          e,
          {
            width: round(r.width),
            lines,
            fields: [
              ...(ownText(e)
                ? [{ selector: selector(e), kind: "direct-text" }]
                : []),
              ...compoundFields.map((c) => ({
                selector: selector(c),
                kind: "child-field",
              })),
            ],
          },
          "Separate stacked fields, measured individually below, are not wrapped lines of one label (for example calendar day number and daily total).",
        );
      else
        add(
          "text-squeezed",
          e,
          { width: round(r.width), lines, averageCharacters: round(average) },
          "average >= 8 characters; < 3 lines when width < 120 px",
        );
    }
    const broken = [...data.raw.matchAll(/[\p{L}\p{N}]{3,}/gu)]
      .filter((m) => data.countLines(m.index, m.index + m[0].length) > 1)
      .map((m) => m[0]);
    if (broken.length)
      add(
        "word-split",
        e,
        { words: [...new Set(broken)], lines },
        "words stay intact",
      );
    if (
      atomic(e) &&
      (s.wordBreak === "break-all" || s.overflowWrap === "anywhere")
    )
      add(
        "unsafe-word-break",
        e,
        { wordBreak: s.wordBreak, overflowWrap: s.overflowWrap, lines },
        "word-break normal; overflow-wrap normal on names/labels/amounts",
      );
    for (const [pattern, rule] of [
      [moneyPattern, "amount-wrap"],
      [datePattern, "date-wrap"],
    ]) {
      for (const match of data.raw.matchAll(pattern)) {
        const count = data.countLines(
          match.index,
          match.index + match[0].length,
        );
        if (count > 1)
          add(
            rule,
            e,
            {
              value: match[0],
              lines: count,
              renderedLines: lines,
              matchBounds: data.chars
                .filter(
                  (c) =>
                    c.start >= match.index &&
                    c.start < match.index + match[0].length &&
                    c.rect &&
                    c.line >= 0,
                )
                .map((c) => ({
                  left: round(c.rect.left),
                  right: round(c.rect.right),
                  top: round(c.rect.top),
                  bottom: round(c.rect.bottom),
                })),
            },
            "one rendered line",
          );
      }
    }
    if (moneyPattern.test(text(e))) {
      moneyPattern.lastIndex = 0;
      if (
        atomic(e) &&
        e.children.length === 0 &&
        /^\s*(?:[+−-]\s*)?(?:≈\s*)?(?:£|€|US\$|\$|CHF|GBP|EUR)/u.test(text(e))
      )
        amountNodes.push(e);
    }
    moneyPattern.lastIndex = 0;
    const padding =
      (parseFloat(s.paddingLeft) || 0) + (parseFloat(s.paddingRight) || 0);
    const available = r.width - padding;
    const wordWidths = [...data.raw.matchAll(/\S+/gu)].map((match) => {
      const glyphs = data.chars.filter(
        (c) =>
          c.start >= match.index &&
          c.start < match.index + match[0].length &&
          c.rect,
      );
      // Use actual glyph bounds when intact. This correctly accounts for a
      // 13px strong inside a 15px button, font features and fallback fonts.
      if (
        data.countLines(match.index, match.index + match[0].length) === 1 &&
        glyphs.length
      )
        return (
          Math.max(...glyphs.map((c) => c.rect.right)) -
          Math.min(...glyphs.map((c) => c.rect.left))
        );
      return textMeasure(match[0], glyphs[0]?.element || e);
    });
    const minContent = Math.max(0, ...wordWidths);
    const nonWhitespaceGlyphs = data.chars.filter(
      (c) => c.rect && c.line >= 0 && !/\s/u.test(c.char),
    );
    const nowrapWidth =
      data.lines.length === 1 && nonWhitespaceGlyphs.length
        ? Math.max(...nonWhitespaceGlyphs.map((c) => c.rect.right)) -
          Math.min(...nonWhitespaceGlyphs.map((c) => c.rect.left))
        : minContent;
    const needed =
      s.whiteSpace.includes("nowrap") || s.whiteSpace === "pre"
        ? nowrapWidth
        : minContent;
    const parentDisplay = e.parentElement ? cs(e.parentElement).display : "";
    if (
      (parentDisplay.includes("flex") || parentDisplay.includes("grid")) &&
      needed > available + tolerance &&
      atomic(e)
    )
      add(
        "sibling-squeeze",
        e,
        {
          width: round(r.width),
          contentWidth: round(available),
          minContentWidth: round(needed),
          parentDisplay,
          minWidth: s.minWidth,
        },
        "contentWidth >= minContentWidth",
      );
    const overWidth = e.scrollWidth > e.clientWidth + tolerance;
    const overHeight = e.scrollHeight > e.clientHeight + tolerance;
    const hiddenX = ["hidden", "clip"].includes(s.overflowX),
      hiddenY = ["hidden", "clip"].includes(s.overflowY);
    if (
      (overWidth && hiddenX) ||
      (overHeight && hiddenY) ||
      (s.textOverflow === "ellipsis" && overWidth)
    )
      add(
        "text-clipped",
        e,
        {
          clientWidth: e.clientWidth,
          scrollWidth: e.scrollWidth,
          clientHeight: e.clientHeight,
          scrollHeight: e.scrollHeight,
          overflowX: s.overflowX,
          overflowY: s.overflowY,
          textOverflow: s.textOverflow,
        },
        "all rendered text reachable",
      );
    // Range bounds reveal clipping by an ancestor that scrollWidth on a span misses.
    for (
      let p = e.parentElement;
      p && !p.matches("body,main");
      p = p.parentElement
    ) {
      const ps = cs(p),
        pr = p.getBoundingClientRect();
      if (!["hidden", "clip"].includes(ps.overflowX)) continue;
      const charsOutside = data.chars.filter(
        (c) =>
          c.rect &&
          !/\s/u.test(c.char) &&
          (c.rect.left < pr.left - tolerance ||
            c.rect.right > pr.right + tolerance),
      );
      if (charsOutside.length) {
        const scroll = p.closest(
          '.table-scroll,.chart-table-wrap,[class*="scroll"]',
        );
        if (scroll && ["auto", "scroll"].includes(cs(scroll).overflowX))
          except(
            "text-clipped",
            e,
            {
              clipAncestor: selector(p),
              charactersOutside: charsOutside.length,
              scrollAncestor: selector(scroll),
            },
            "Text is intentionally inside a horizontally scrollable table; it can be reached by scrolling.",
          );
        else
          add(
            "text-clipped",
            e,
            {
              clipAncestor: selector(p),
              charactersOutside: charsOutside.length,
              clipWidth: round(pr.width),
            },
            "no glyph clipped by an ancestor",
          );
        break;
      }
    }
    if (measurements.textSamples.length < 80 || data.lines.length > 1)
      measurements.textSamples.push({
        selector: selector(e),
        text: text(e),
        width: round(r.width),
        fontSize: font,
        lines,
      });
  }

  const controls = all.filter(
    (e) =>
      visible(e) &&
      e.matches(
        'button,a[href],input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"],[tabindex]',
      ) &&
      e.getAttribute("tabindex") !== "-1",
  );
  const targets = [];
  for (const e of controls) {
    const r = e.getBoundingClientRect(),
      s = cs(e);
    measurements.controls++;
    if (
      e.matches('input[type="checkbox"][role="switch"]') &&
      (r.width < 36 - tolerance ||
        r.height < 20 - tolerance ||
        r.width < r.height * 1.5)
    )
      add(
        "switch-geometry",
        e,
        { visualWidth: r.width, visualHeight: r.height, checked: e.checked },
        "at least 36 × 20 px, with a track wider than the thumb",
      );
    let hit = e;
    if (e.matches('input[type="checkbox"],input[type="radio"]')) {
      const labels = e.labels ? [...e.labels].filter((l) => visible(l)) : [];
      const wrap = e.closest("label");
      if (wrap && visible(wrap)) labels.push(wrap);
      const namedBy = (e.getAttribute("aria-labelledby") || "")
        .split(/\s+/u)
        .map((id) => document.getElementById(id))
        .filter((l) => visible(l));
      if (!labels.some((l) => text(l)) && !namedBy.some((l) => text(l)))
        add(
          "checkbox-unlabelled",
          e,
          {
            ariaLabel: e.getAttribute("aria-label"),
            associatedVisibleLabels: labels.length,
          },
          "visible label associated with the control",
        );
      if (labels.length)
        hit = labels.sort(
          (a, b) =>
            b.getBoundingClientRect().width * b.getBoundingClientRect().height -
            a.getBoundingClientRect().width * a.getBoundingClientRect().height,
        )[0];
    }
    const hr = hit.getBoundingClientRect();
    const minimum = mobile ? 44 : 24;
    if (hr.width < minimum - 0.1 || hr.height < minimum - 0.1)
      add(
        "target-size",
        e,
        {
          width: round(hr.width),
          height: round(hr.height),
          effectiveTarget: selector(hit),
          actualElement: rect(e),
        },
        `>= ${minimum} x ${minimum} px`,
      );
    if (
      mobile &&
      e.matches(
        'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]),select,textarea',
      ) &&
      parseFloat(s.fontSize) < 16 - 0.1
    )
      add("input-font", e, { fontSize: parseFloat(s.fontSize) }, ">= 16 px");
    if (e.matches('input[type="file"]'))
      add(
        "file-input-leaked",
        e,
        {
          width: round(r.width),
          height: round(r.height),
          opacity: s.opacity,
          clip: s.clip,
          clipPath: s.clipPath,
        },
        "visually hidden native file input and a named trigger",
      );
    if (
      e.matches("select") &&
      s.appearance !== "none" &&
      e
        .closest('[class*="custom-select"],[class*="select-wrap"]')
        ?.querySelector('svg,[class*="arrow"]')
    )
      add(
        "custom-select-native-arrow",
        e,
        { appearance: s.appearance, customArrow: true },
        "appearance:none when a custom arrow is rendered",
      );
    targets.push({ e, hit, rect: hr });
    measurements.targetSamples.push({
      selector: selector(e),
      name: name(e).slice(0, 140),
      width: round(hr.width),
      height: round(hr.height),
      fontSize: parseFloat(s.fontSize),
      disabled: Boolean(e.disabled),
    });
  }
  const destructive = (e) =>
    e.matches(
      '.danger,.destructive,[class*="danger-button"],[class*="delete-button"],[data-destructive="true"]',
    ) || /^(?:Delete|Erase|Remove|Archive)\b/iu.test(name(e));
  for (let i = 0; i < targets.length; i++) {
    const a = targets[i];
    for (let j = i + 1; j < targets.length; j++) {
      const b = targets[j];
      if (a.hit === b.hit || a.e.contains(b.e) || b.e.contains(a.e)) continue;
      const overlapX =
        Math.min(a.rect.right, b.rect.right) -
        Math.max(a.rect.left, b.rect.left);
      const overlapY =
        Math.min(a.rect.bottom, b.rect.bottom) -
        Math.max(a.rect.top, b.rect.top);
      if (
        overlapX > 1 &&
        overlapY > 1 &&
        !a.hit.contains(b.e) &&
        !b.hit.contains(a.e)
      ) {
        const fixedAncestor = (e) => {
          for (let p = e; p && p !== document.body; p = p.parentElement)
            if (["fixed", "sticky"].includes(cs(p).position)) return p;
          return null;
        };
        const af = fixedAncestor(a.e),
          bf = fixedAncestor(b.e);
        if (!af && !bf)
          add(
            "control-overlap",
            a.e,
            {
              neighbour: selector(b.e),
              overlapX: round(overlapX),
              overlapY: round(overlapY),
            },
            "independent hit areas do not overlap",
          );
        else if (af && bf && af !== bf && !af.contains(bf) && !bf.contains(af))
          add(
            "fixed-overlap",
            a.e,
            {
              neighbour: selector(b.e),
              firstChrome: selector(af),
              secondChrome: selector(bf),
              overlapX: round(overlapX),
              overlapY: round(overlapY),
            },
            "fixed action regions do not overlap",
          );
        else
          except(
            "control-overlap",
            a.e,
            {
              neighbour: selector(b.e),
              overlapX: round(overlapX),
              overlapY: round(overlapY),
              fixedChrome: selector(af || bf),
            },
            "Flow content can pass behind chrome while scrolling. The independent end-of-scroll reachability test verifies that this content can be brought above the bar.",
          );
      }
      if (
        a.e.parentElement !== b.e.parentElement &&
        a.hit.parentElement !== b.hit.parentElement
      )
        continue;
      const ar = a.rect,
        br = b.rect;
      const yOverlap =
        Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top);
      const xOverlap =
        Math.min(ar.right, br.right) - Math.max(ar.left, br.left);
      let gap, axis;
      if (yOverlap > Math.min(ar.height, br.height) * 0.5) {
        gap = Math.max(ar.left, br.left) - Math.min(ar.right, br.right);
        axis = "horizontal";
      } else if (xOverlap > Math.min(ar.width, br.width) * 0.5) {
        gap = Math.max(ar.top, br.top) - Math.min(ar.bottom, br.bottom);
        axis = "vertical";
      } else continue;
      if (gap > 32) continue;
      const passwordField = a.e.closest(".password-field");
      if (
        passwordField &&
        passwordField.contains(b.e) &&
        ((a.e.matches("input") && b.e.matches("button")) ||
          (b.e.matches("input") && a.e.matches("button")))
      ) {
        const input = a.e.matches("input") ? a.e : b.e;
        const button = a.e.matches("button") ? a.e : b.e;
        const padding = parseFloat(cs(input).paddingRight);
        const buttonWidth = button.getBoundingClientRect().width;
        if (padding >= buttonWidth + 8) {
          except(
            "target-gap",
            input,
            {
              button: selector(button),
              reservedTextSpace: padding,
              buttonWidth,
            },
            "Password reveal is an explicitly named composite control. The input reserves the reveal button's width plus 8px, so text and controls do not collide.",
          );
          continue;
        }
      }
      const destructivePair = destructive(a.e) || destructive(b.e);
      const required = destructivePair ? 16 : 8;
      const group = a.e.closest(
        '.segmented-control,[role="tablist"],.bottom-nav,.mobile-navigation,.nav-links',
      );
      const contiguousRows =
        axis === "vertical" &&
        Math.abs(gap) <= tolerance &&
        ar.height >= 52 &&
        br.height >= 52 &&
        a.e.matches("a,button") &&
        b.e.matches("a,button") &&
        a.e.parentElement === b.e.parentElement &&
        a.e.parentElement.matches('.card,ul,ol,[role="list"],[class*="list"]');
      if (
        !destructivePair &&
        gap >= -tolerance &&
        gap < 8 &&
        group?.contains(b.e)
      ) {
        except(
          "target-gap",
          a.e,
          {
            neighbour: selector(b.e),
            gap: round(gap),
            axis,
            group: selector(group),
            targetWidths: [round(ar.width), round(br.width)],
          },
          "Connected composite control: independent non-overlapping target rectangles; adjoining segments intentionally share a boundary.",
        );
      } else if (!destructivePair && contiguousRows) {
        except(
          "target-gap",
          a.e,
          {
            neighbour: selector(b.e),
            gap: round(gap),
            axis,
            rowHeights: [round(ar.height), round(br.height)],
          },
          "Contiguous full-height list rows are the shared list component, rather than a pair of adjacent standalone buttons. Each has its own at-least-52px hit region.",
        );
      } else if (gap < required - tolerance)
        add(
          destructivePair ? "destructive-gap" : "target-gap",
          a.e,
          { neighbour: selector(b.e), gap: round(gap), axis },
          `>= ${required} px`,
        );
    }
  }

  const cards = all.filter(
    (e) => visible(e) && e.matches(".card,.section-card,[data-section-card]"),
  );
  measurements.cards = cards.length;
  for (const e of cards) {
    const r = e.getBoundingClientRect();
    const parentCard = e.parentElement?.closest(
      ".card,.section-card,[data-section-card]",
    );
    const withinSheet = e.closest(
      'dialog,[role="dialog"],.sheet,.bottom-sheet',
    );
    if (mobile && !parentCard && !withinSheet && e.closest("main")) {
      const left = r.left,
        right = innerWidth - r.right;
      measurements.cardSamples.push({
        selector: selector(e),
        leftMargin: round(left),
        rightMargin: round(right),
        radius: cs(e).borderRadius,
      });
      if (Math.abs(left - 16) > tolerance || Math.abs(right - 16) > tolerance)
        add(
          "mobile-card-margin",
          e,
          { leftMargin: round(left), rightMargin: round(right) },
          "16 px each side",
        );
    }
    const heading = [...e.querySelectorAll("h2,h3,h4")].find(
      (h) =>
        h.closest(".card,.section-card,[data-section-card]") === e &&
        visible(h),
    );
    if (heading && cs(heading).textAlign === "center") {
      const siblings = [...e.children].filter(
        (p) => p !== heading && visible(p) && text(p),
      );
      if (siblings.some((p) => cs(p).textAlign !== "center"))
        add(
          "heading-centred",
          heading,
          {
            textAlign: "center",
            siblingAlignment: siblings.map((p) => cs(p).textAlign),
          },
          "same alignment as sibling content",
        );
    }
  }
  const contentBounds = (e) => {
    const r = e.getBoundingClientRect(),
      s = cs(e);
    return {
      left:
        r.left +
        (parseFloat(s.paddingLeft) || 0) +
        (parseFloat(s.borderLeftWidth) || 0),
      right:
        r.right -
        (parseFloat(s.paddingRight) || 0) -
        (parseFloat(s.borderRightWidth) || 0),
    };
  };
  const lines = [];
  const hasBorder = (s, side) =>
    parseFloat(s["border" + side + "Width"]) > 0 &&
    s["border" + side + "Style"] !== "none" &&
    s["border" + side + "Color"] !== "rgba(0, 0, 0, 0)";
  const bordered = all.filter(
    (e) =>
      visible(e) &&
      !e.matches("button,input,select,textarea,svg,path,rect,circle") &&
      (!e.matches("a") ||
        e.matches(
          ".transaction-row,.settings-row,.list-row,.category-row,.insight-row,.upcoming-row,[data-list-row]",
        )) &&
      !e.closest("svg") &&
      (e.matches('hr,[role="separator"]') ||
        hasBorder(cs(e), "Top") ||
        hasBorder(cs(e), "Bottom") ||
        ((hasBorder(cs(e), "Left") || hasBorder(cs(e), "Right")) &&
          e.parentElement &&
          ["flex", "inline-flex", "grid"].includes(
            cs(e.parentElement).display,
          )) ||
        (e.getBoundingClientRect().height <= 4 &&
          e.getBoundingClientRect().width > 20 &&
          !text(e) &&
          cs(e).backgroundColor !== "rgba(0, 0, 0, 0)")),
  );
  for (const e of bordered) {
    const s = cs(e),
      r = e.getBoundingClientRect();
    const isSeparator =
      e.matches('hr,[role="separator"]') || (r.height <= 4 && !text(e));
    const outline =
      hasBorder(s, "Top") &&
      hasBorder(s, "Bottom") &&
      (hasBorder(s, "Left") || hasBorder(s, "Right")) &&
      !isSeparator;
    if (outline) continue; // Four-sided outlines are not between-row divider lines.
    const parent = e.parentElement;
    if (!parent) continue;
    const verticalBorderOnly =
      !hasBorder(s, "Top") &&
      !hasBorder(s, "Bottom") &&
      (hasBorder(s, "Left") || hasBorder(s, "Right"));
    if (verticalBorderOnly) {
      const sameRow = [...parent.children].filter(
        (p) =>
          visible(p) &&
          Math.min(p.getBoundingClientRect().bottom, r.bottom) >
            Math.max(p.getBoundingClientRect().top, r.top),
      );
      const rowHeight = Math.max(
        ...sameRow.map((p) => p.getBoundingClientRect().height),
      );
      measurements.dividers++;
      if (r.height < rowHeight - tolerance)
        add(
          "vertical-line-short",
          e,
          {
            height: round(r.height),
            rowContentHeight: round(rowHeight),
            neighbours: sameRow.map(selector),
          },
          "vertical border runs the full row height",
        );
      continue;
    }
    if (
      e.matches('[aria-orientation="vertical"]') ||
      (isSeparator && r.height > r.width && r.width <= 4)
    ) {
      const parentHeight =
        parent.getBoundingClientRect().height -
        (parseFloat(cs(parent).paddingTop) || 0) -
        (parseFloat(cs(parent).paddingBottom) || 0) -
        (parseFloat(cs(parent).borderTopWidth) || 0) -
        (parseFloat(cs(parent).borderBottomWidth) || 0);
      measurements.dividers++;
      if (Math.abs(r.height - parentHeight) > tolerance)
        add(
          "vertical-line-short",
          e,
          { height: round(r.height), rowContentHeight: round(parentHeight) },
          "full row content height",
        );
      continue;
    }
    const pr = contentBounds(parent),
      gapLeft = r.left - pr.left,
      gapRight = pr.right - r.right;
    measurements.dividers++;
    if (Math.abs(gapLeft) > tolerance || Math.abs(gapRight) > tolerance)
      add(
        "divider-short",
        e,
        {
          leftOffset: round(gapLeft),
          rightOffset: round(gapRight),
          width: round(r.width),
          containerContentWidth: round(pr.right - pr.left),
        },
        "left/right aligned to container content edge within 1 px",
      );
    const children = [...parent.children].filter((p) => visible(p));
    if (isSeparator && (children[0] === e || children.at(-1) === e))
      add(
        "divider-at-edge",
        e,
        { childIndex: children.indexOf(e), visibleChildren: children.length },
        "only between rows",
      );
    if (!isSeparator) {
      const boundaryParent = parent.matches(".swipe-transaction")
        ? parent.parentElement
        : parent;
      const boundaryNode = parent.matches(".swipe-transaction") ? parent : e;
      const siblings = [...boundaryParent.children].filter((p) => visible(p));
      const atTop = hasBorder(s, "Top") && siblings[0] === boundaryNode;
      const atBottom =
        hasBorder(s, "Bottom") && siblings.at(-1) === boundaryNode;
      if (
        (atTop || atBottom) &&
        boundaryParent.closest(".card,.section-card,[data-section-card]")
      )
        add(
          "divider-at-edge",
          e,
          {
            edge: atTop ? "first top border" : "last bottom border",
            container: selector(boundaryParent),
          },
          "row separator only between rows",
        );
    }
    if (
      isSeparator &&
      ["flex", "inline-flex"].includes(cs(parent).display) &&
      cs(parent).flexDirection.startsWith("row") &&
      children.some((p) => p !== e && text(p))
    )
      add(
        "divider-in-row",
        e,
        {
          parentDisplay: cs(parent).display,
          flexDirection: cs(parent).flexDirection,
        },
        "separator between full-width rows",
      );
    const sides = isSeparator
      ? ["Top"]
      : ["Top", "Bottom"].filter((side) => hasBorder(s, side));
    for (const side of sides)
      lines.push({
        e,
        left: r.left,
        right: r.right,
        y: side === "Top" ? r.top : r.bottom,
        width: r.width,
      });
    if (isSeparator && r.height > r.width && r.width <= 4) {
      const parentHeight =
        parent.getBoundingClientRect().height -
        (parseFloat(cs(parent).paddingTop) || 0) -
        (parseFloat(cs(parent).paddingBottom) || 0);
      if (Math.abs(r.height - parentHeight) > tolerance)
        add(
          "vertical-line-short",
          e,
          { height: round(r.height), rowContentHeight: round(parentHeight) },
          "full row content height",
        );
    }
  }
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i],
        b = lines[j];
      if (a.e === b.e || Math.min(a.width, b.width) < 40) continue;
      const fixedOwner = (element) => {
        for (let node = element; node; node = node.parentElement)
          if (["fixed", "sticky"].includes(cs(node).position)) return node;
        return null;
      };
      if (fixedOwner(a.e) !== fixedOwner(b.e)) {
        // A fixed navigation edge and a scrolling card separator are different
        // surfaces. Footer reachability checks cover actual obscured controls.
        continue;
      }
      const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      if (
        Math.abs(a.y - b.y) <= 4 &&
        overlap >= Math.min(a.width, b.width) * 0.8
      )
        add(
          "divider-double",
          b.e,
          {
            other: selector(a.e),
            distance: round(Math.abs(a.y - b.y)),
            overlap: round(overlap),
          },
          "one separator only",
        );
    }

  const amountGroups = new Map();
  for (const e of amountNodes) {
    const row = e.closest(
      'li,tr,[role="listitem"],.transaction-row,.transaction-item,.tx-row,.key-value-row,.settings-row,.list-row,.series-row,.category-row,.insight-row,.upcoming-row,.planning-v2-object,[data-list-row]',
    );
    if (!row || !row.parentElement || !visible(row)) continue;
    const container = row.parentElement;
    const cell = row.matches("tr") ? e.closest("td,th") : null;
    if (!amountGroups.has(container)) amountGroups.set(container, []);
    amountGroups.get(container).push({
      e,
      row,
      cellIndex: cell?.cellIndex ?? null,
      right: e.getBoundingClientRect().right,
    });
  }
  for (const [container, rows] of amountGroups) {
    if (new Set(rows.map((r) => r.row)).size < 2) continue;
    // Compare only separate rows occupying the same column. A KPI grid isn't a list.
    const columns = [];
    for (const row of rows) {
      const rr = row.row.getBoundingClientRect();
      let col = columns.find(
        (c) =>
          c.cellIndex === row.cellIndex &&
          Math.abs(c.left - rr.left) <= tolerance &&
          Math.abs(c.width - rr.width) <= tolerance,
      );
      if (!col) {
        col = {
          left: rr.left,
          width: rr.width,
          cellIndex: row.cellIndex,
          rows: [],
        };
        columns.push(col);
      }
      col.rows.push(row);
    }
    for (const col of columns) {
      if (col.rows.length < 2) continue;
      const positions = col.rows.map((r) => r.right),
        right = Math.max(...positions);
      for (const row of col.rows)
        if (right - row.right > tolerance)
          add(
            "amount-alignment",
            row.e,
            {
              right: round(row.right),
              expectedRight: round(right),
              offset: round(right - row.right),
              list: selector(container),
            },
            "common right edge within 1 px",
          );
      for (const row of col.rows) {
        const label = [...row.row.children].find(
          (c) => c !== row.e && !c.contains(row.e) && text(c) && visible(c),
        );
        if (!label) continue;
        const bounds = contentBounds(row.row),
          lr = label.getBoundingClientRect();
        const containsIcon =
          label.querySelector('svg,img,[aria-hidden="true"]') ||
          row.row.querySelector(":scope > svg,:scope > img");
        if (!containsIcon && Math.abs(lr.left - bounds.left) > tolerance)
          add(
            "label-alignment",
            label,
            {
              left: round(lr.left),
              contentLeft: round(bounds.left),
              offset: round(lr.left - bounds.left),
            },
            "label at row content edge within 1 px",
          );
      }
    }
  }

  for (const e of all.filter((e) => visible(e) && !e.closest("svg"))) {
    const s = cs(e);
    if (!s.display.includes("flex") && !s.display.includes("grid")) continue;
    const children = [...e.children].filter((p) => visible(p));
    if (children.length < 2) continue;
    for (const [prop, value] of [
      ["rowGap", s.rowGap],
      ["columnGap", s.columnGap],
    ]) {
      const n = parseFloat(value);
      if (!Number.isFinite(n) || n <= 0) continue;
      if (!scale.some((v) => Math.abs(v - n) <= 0.1))
        add(
          "spacing-token",
          e,
          { property: prop, gap: round(n) },
          "4, 8, 12, 16, 24 or 32 px",
        );
    }
  }
  for (const e of all.filter(
    (e) =>
      visible(e, false) &&
      (e.matches('.skip-link,.skip,[href="#main"],[href="#main-content"]') ||
        /^Skip to content$/iu.test(text(e))),
  )) {
    if (document.activeElement !== e) {
      const r = e.getBoundingClientRect();
      if (
        r.bottom > 0 &&
        r.top < innerHeight &&
        r.right > 0 &&
        r.left < innerWidth
      )
        add(
          "skip-link-leaked",
          e,
          { focused: false, rect: rect(e), transform: cs(e).transform },
          "visible only while focused",
        );
    }
  }
  // One physical wrapped substring can appear in a span, strong and parent.
  // Keep the most specific node; do not multiply one defect by DOM nesting.
  const unique = [];
  for (const issue of [...issues].reverse()) {
    const key = ["amount-wrap", "date-wrap"].includes(issue.rule)
      ? issue.rule + JSON.stringify(issue.measured.matchBounds)
      : issue.rule + issue.selector;
    if (!unique.some((entry) => entry.key === key)) unique.push({ key, issue });
  }
  return {
    issues: unique.map((entry) => entry.issue).reverse(),
    exceptions,
    measurements,
  };
}

/**
 * Element CSV collector adapted from the user's supplied feng-ui-audit.mjs.
 * Preserves position, visual/hit size, radius, typography, colours and nearest
 * solid-background contrast. Release contrast findings come from axe, which
 * accounts for alpha/backgrounds; this approximation is explicitly a measure.
 */
export function collectElementInventory() {
  const elements = [];
  const vis = (e) => {
    const r = e.getBoundingClientRect(),
      s = getComputedStyle(e);
    if (
      r.width <= 0 ||
      r.height <= 0 ||
      s.visibility === "hidden" ||
      s.display === "none" ||
      Number(s.opacity) === 0 ||
      e.closest("[inert],[hidden]")
    )
      return false;
    for (let p = e.parentElement; p; p = p.parentElement)
      if (Number(getComputedStyle(p).opacity) === 0) return false;
    if (
      (s.clip !== "auto" && s.clip !== "none") ||
      r.right <= 0 ||
      r.left >= innerWidth ||
      r.bottom <= -100
    )
      return false;
    for (let p = e.parentElement; p; p = p.parentElement) {
      if (
        p.localName === "details" &&
        !p.open &&
        !p.querySelector(":scope > summary")?.contains(e)
      )
        return false;
    }
    const dialog = document.querySelector("dialog[open]");
    return !dialog || dialog.contains(e) || e.contains(dialog);
  };
  const sel = (e) => {
    if (e.id) return "#" + CSS.escape(e.id);
    const bits = [];
    for (
      let p = e;
      p && p !== document.body && bits.length < 5;
      p = p.parentElement
    ) {
      if (p.id) {
        bits.unshift("#" + CSS.escape(p.id));
        break;
      }
      let bit =
        p.localName +
        [...p.classList]
          .slice(0, 2)
          .map((c) => "." + CSS.escape(c))
          .join("");
      const peers = p.parentElement
        ? [...p.parentElement.children].filter(
            (n) => n.localName === p.localName,
          )
        : [];
      if (peers.length > 1)
        bit += ":nth-of-type(" + (peers.indexOf(p) + 1) + ")";
      bits.unshift(bit);
    }
    return bits.join(" > ");
  };
  const label = (e) =>
    (
      e.getAttribute("aria-label") ||
      e.innerText ||
      e.title ||
      e.getAttribute("placeholder") ||
      ""
    )
      .trim()
      .replace(/\s+/gu, " ")
      .slice(0, 160);
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/u);
    if (!m) return null;
    const p = m[1]
      .split(/[ ,/]+/u)
      .filter(Boolean)
      .map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = (e) => {
    for (let p = e; p; p = p.parentElement) {
      const c = parse(getComputedStyle(p).backgroundColor);
      if (c && c.a > 0.9) return c;
    }
    return (
      parse(getComputedStyle(document.body).backgroundColor) || {
        r: 255,
        g: 255,
        b: 255,
        a: 1,
      }
    );
  };
  const record = (kind, e, name) => {
    const r = e.getBoundingClientRect(),
      s = getComputedStyle(e);
    let hit = e;
    if (e.matches('input[type="checkbox"],input[type="radio"]')) {
      const l =
        e.closest("label") ||
        (e.id &&
          document.querySelector('label[for="' + CSS.escape(e.id) + '"]'));
      if (l && vis(l)) hit = l;
    }
    const hr = hit.getBoundingClientRect(),
      fg = parse(s.color),
      bg = bgOf(e);
    const contrast =
      fg && bg
        ? (Math.max(lum(fg), lum(bg)) + 0.05) /
          (Math.min(lum(fg), lum(bg)) + 0.05)
        : null;
    return {
      kind,
      tag: e.localName,
      type: e.type || e.getAttribute("role") || "",
      name: name ?? label(e),
      selector: sel(e),
      x: r.x,
      y: r.y + scrollY,
      w: r.width,
      h: r.height,
      hitW: hr.width,
      hitH: hr.height,
      fontSize: parseFloat(s.fontSize),
      fontWeight: parseInt(s.fontWeight, 10) || 400,
      lineHeight: s.lineHeight,
      color: s.color,
      background: s.backgroundColor,
      nearestSolidContrast:
        contrast === null ? null : Math.round(contrast * 100) / 100,
      contrastMethod: "nearest solid background; axe is authoritative",
      radius: s.borderRadius,
      padding: s.padding,
      gap: s.gap,
      display: s.display,
      position: s.position,
      whiteSpace: s.whiteSpace,
      wordBreak: s.wordBreak,
      overflowWrap: s.overflowWrap,
    };
  };
  const iq =
    'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=switch],[role=checkbox],[role=menuitem],[tabindex]:not([tabindex="-1"])';
  for (const e of [...document.querySelectorAll(iq)].filter(vis))
    elements.push(record("interactive", e));
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let n;
  while ((n = walker.nextNode())) {
    const t = n.textContent.trim(),
      e = n.parentElement;
    if (
      !t ||
      !e ||
      seen.has(e) ||
      !vis(e) ||
      e.closest("script,style,noscript,option,textarea")
    )
      continue;
    seen.add(e);
    elements.push(record("text", e, t.slice(0, 160)));
  }
  for (const e of [...document.querySelectorAll("img,svg")].filter(vis))
    elements.push(
      record(
        "image",
        e,
        e.getAttribute("alt") || e.getAttribute("aria-label") || "",
      ),
    );
  return elements;
}

/** Capture reachability at the end of every scroll container, then restore scroll positions. */
async function auditReachability(page, setup, context) {
  return page.evaluate(
    ({ mobile, setupId, stateId }) => {
      const issues = [],
        measurements = [];
      const round = (n) => Math.round(n * 100) / 100;
      const sel = (e) =>
        e.id
          ? "#" + CSS.escape(e.id)
          : e.localName +
            (e.classList.length
              ? "." + [...e.classList].slice(0, 2).map(CSS.escape).join(".")
              : "");
      const visible = (e) => {
        for (
          let parent = e.parentElement;
          parent;
          parent = parent.parentElement
        ) {
          if (
            parent.localName === "details" &&
            !parent.open &&
            !parent.querySelector(":scope > summary")?.contains(e)
          )
            return false;
        }
        const r = e.getBoundingClientRect(),
          s = getComputedStyle(e);
        const opaqueAncestors = (() => {
          for (let p = e.parentElement; p; p = p.parentElement)
            if (Number(getComputedStyle(p).opacity) === 0) return false;
          return true;
        })();
        return (
          opaqueAncestors &&
          r.width > 0 &&
          r.height > 0 &&
          s.display !== "none" &&
          (s.clip === "auto" || s.clip === "none") &&
          !(s.clipPath !== "none" && (r.width <= 2 || r.height <= 2)) &&
          s.visibility !== "hidden" &&
          Number(s.opacity) > 0 &&
          !e.closest("[inert],[hidden]")
        );
      };
      const dialog = document.querySelector("dialog[open]");
      const scope = dialog || document.querySelector("main") || document.body;
      const possible = [
        document.scrollingElement,
        ...scope.querySelectorAll("*"),
      ].filter(
        (e) =>
          e &&
          visible(e) &&
          e.scrollHeight > e.clientHeight + 1 &&
          (e === document.scrollingElement ||
            ["auto", "scroll"].includes(getComputedStyle(e).overflowY)),
      );
      const positions = possible.map((e) => ({
        e,
        top: e.scrollTop,
        left: e.scrollLeft,
      }));
      try {
        for (const scroller of possible) {
          scroller.scrollTop = scroller.scrollHeight;
          const boundaries = [...document.querySelectorAll("body *")].filter(
            (e) => {
              if (!visible(e)) return false;
              const s = getComputedStyle(e),
                r = e.getBoundingClientRect();
              return (
                ["fixed", "sticky"].includes(s.position) &&
                r.top > innerHeight * 0.45 &&
                r.top < innerHeight &&
                r.bottom > 0 &&
                r.width > innerWidth * 0.4 &&
                (e.matches(
                  'footer,nav,[class*="footer"],[class*="bottom-nav"],[class*="tab-bar"],[class*="toast"]',
                ) ||
                  e.getAttribute("role") === "status")
              );
            },
          );
          const content = [
            ...scope.querySelectorAll(
              "button,a[href],input,select,textarea,summary,p,li,h1,h2,h3,strong,.amount",
            ),
          ].filter(
            (e) =>
              visible(e) &&
              !boundaries.some((b) => b.contains(e)) &&
              (!dialog || dialog.contains(e)),
          );
          if (!content.length) continue;
          const last = content.reduce((a, b) =>
            a.getBoundingClientRect().bottom > b.getBoundingClientRect().bottom
              ? a
              : b,
          );
          const lr = last.getBoundingClientRect();
          const sr =
            scroller === document.scrollingElement
              ? { top: 0, bottom: innerHeight, left: 0, right: innerWidth }
              : scroller.getBoundingClientRect();
          const relevant = boundaries.filter((b) => {
            const br = b.getBoundingClientRect();
            return (
              br.right > sr.left &&
              br.left < sr.right &&
              br.top < sr.bottom &&
              br.bottom > sr.top &&
              (!dialog ||
                dialog.contains(b) ||
                b.matches('.global-toast,[role="status"]'))
            );
          });
          const limit = Math.min(
            sr.bottom,
            ...relevant.map((b) => b.getBoundingClientRect().top),
          );
          measurements.push({
            scroller: sel(scroller),
            scrollHeight: scroller.scrollHeight,
            clientHeight: scroller.clientHeight,
            scrollTop: round(scroller.scrollTop),
            paddingBottom: getComputedStyle(scroller).paddingBottom,
            last: sel(last),
            lastBottom: round(lr.bottom),
            visibleBottom: round(limit),
            bars: relevant.map(sel),
          });
          if (lr.bottom > limit + 1 && lr.top < sr.bottom && relevant.length)
            issues.push({
              rule: "bottom-content-covered",
              severity: "high",
              selector: sel(last),
              text: (last.getAttribute("aria-label") || last.textContent || "")
                .trim()
                .slice(0, 160),
              measured: {
                lastBottom: round(lr.bottom),
                availableBottom: round(limit),
                overlap: round(lr.bottom - limit),
                bars: relevant.map(sel),
                scrollAtEnd: true,
              },
              expected:
                "last content fully reachable above fixed/sticky footer",
              setup: setupId,
              state: stateId,
            });
        }
      } finally {
        for (const p of positions) {
          p.e.scrollTop = p.top;
          p.e.scrollLeft = p.left;
        }
      }
      return { issues, measurements };
    },
    {
      mobile: setup.width < 768,
      setupId: setup.id || setup.name,
      stateId: context.id,
    },
  );
}

/** Also runs on saved SVG element rectangles, so baseline evidence stays comparable. */
export function chartLabelOverlap(elements, context = {}) {
  const labels = elements.filter(
    (e) =>
      e.tag === "tspan" &&
      /recharts-[xy]Axis-tick-labels/u.test(e.selector) &&
      e.w > 0 &&
      e.h > 0,
  );
  const issues = new Map();
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i],
        b = labels[j];
      if (
        /recharts-xAxis/u.test(a.selector) !==
        /recharts-xAxis/u.test(b.selector)
      )
        continue;
      const overlapWidth = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapHeight = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (overlapWidth > 1 && overlapHeight > 1)
        issues.set(`${b.selector}|${b.x}|${b.y}`, {
          rule: "chart-label-overlap",
          severity: "medium",
          selector: b.selector,
          text: b.name,
          measured: {
            other: a.selector,
            otherLabel: a.name,
            overlapWidth,
            overlapHeight,
            fontSize: b.fontSize,
          },
          expected:
            "Non-overlapping axis labels at the actual scaled font size",
          rect: {
            x: b.x,
            y: b.y,
            width: b.w,
            height: b.h,
            left: b.x,
            right: b.x + b.w,
            top: b.y,
            bottom: b.y + b.h,
          },
          ...context,
        });
    }
  return [...issues.values()];
}

export async function auditState(page, setup, context = {}) {
  const mobile = (setup.width || page.viewportSize()?.width || 390) < 768;
  const geometry = await page.evaluate(collectGeometry, {
    mobile,
    setupId: setup.id || setup.name,
    stateId: context.id,
  });
  const elements = await page.evaluate(collectElementInventory);
  geometry.issues.push(
    ...chartLabelOverlap(elements, {
      setup: setup.id || setup.name,
      state: context.id,
    }),
  );
  const reachability = await auditReachability(page, setup, context);
  let axe = { violations: [], passes: 0, incomplete: [] };
  if (process.env.FENG_AUDIT_AXE !== "0") {
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    axe = {
      violations: result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
      passes: result.passes.length,
      incomplete: result.incomplete.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    };
    for (const violation of axe.violations)
      for (const n of violation.nodes)
        geometry.issues.push({
          rule: "axe-aa",
          severity: ["critical", "serious"].includes(violation.impact)
            ? "high"
            : "medium",
          selector: n.target.join(" "),
          text: violation.help,
          measured: {
            id: violation.id,
            impact: violation.impact,
            summary: n.summary,
          },
          expected: "WCAG AA",
          setup: setup.id || setup.name,
          state: context.id,
        });
  }
  const issues = [...geometry.issues, ...reachability.issues].sort(
    (a, b) =>
      ({ high: 0, medium: 1, low: 2 })[a.severity] -
        { high: 0, medium: 1, low: 2 }[b.severity] ||
      a.rule.localeCompare(b.rule) ||
      a.selector.localeCompare(b.selector),
  );
  return {
    schema: 1,
    setup: setup.id || setup.name,
    state: context.id,
    title: context.title || context.id,
    route: context.route,
    url: page.url(),
    viewport: page.viewportSize(),
    elements,
    issues,
    counts: {
      high: issues.filter((i) => i.severity === "high").length,
      medium: issues.filter((i) => i.severity === "medium").length,
      low: issues.filter((i) => i.severity === "low").length,
    },
    exceptions: geometry.exceptions,
    measurements: {
      ...geometry.measurements,
      reachability: reachability.measurements,
    },
    axe,
  };
}

const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/gu,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const scriptSafe = (data) => JSON.stringify(data).replace(/</gu, "\\u003c");

/** Generate one standalone review UI from before/after manifest rows. */
export async function renderAuditReport({
  before,
  after = [],
  output,
  title = "Feng Finance final-polish audit",
  metadata = {},
}) {
  const normalise = async (input) =>
    typeof input === "string"
      ? JSON.parse(await readFile(input, "utf8"))
      : input;
  const b = await normalise(before),
    a = await normalise(after);
  const beforeRows = Array.isArray(b) ? b : b.rows || b.results || [],
    afterRows = Array.isArray(a) ? a : a.rows || a.results || [];
  const rows = [];
  for (const [phase, list] of [
    ["before", beforeRows],
    ["after", afterRows],
  ])
    for (const row of list) {
      const audit = row.audit || row;
      let screenshot =
        row.screenshot ||
        row.path ||
        row.fullImage ||
        row.image ||
        audit.screenshot ||
        "";
      const input = phase === "before" ? before : after;
      if (
        screenshot &&
        !screenshot.startsWith("/") &&
        typeof input === "string"
      )
        screenshot = resolve(dirname(input), screenshot);
      rows.push({
        schema: audit.schema,
        setup: audit.setup || row.setup,
        state: audit.state || row.id,
        title: audit.title || row.title,
        route: audit.route || row.metrics?.route,
        issues: audit.issues || [],
        counts: audit.counts || { high: 0, medium: 0, low: 0 },
        exceptions: audit.exceptions || [],
        // Element inventory is retained in elements.csv / state JSON. Duplicating
        // every raw measurement in the HTML would make a complete seven-setup
        // report unusable. The exact state JSON remains linked beside each image.
        raw: `${phase}/${row.setup || audit.setup}/${row.id || audit.state}.json`,
        phase,
        screenshot: screenshot.startsWith("/")
          ? relative(dirname(resolve(output)), screenshot)
              .split("\\")
              .join("/")
          : screenshot,
      });
    }
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>
  :root{color-scheme:dark light;--bg:#f7f8fa;--fg:#171b23;--muted:#515b69;--line:#d4d9e0;--card:white;--high:#9f2431;--medium:#805009;--low:#335db3}*{box-sizing:border-box}body{font:16px/1.5 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}main{max-width:1440px;margin:auto;padding:24px}h1{font-size:28px}h2{font-size:22px}h3{font-size:18px}p{max-width:86ch}.meta,.summary,.controls,.state{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:16px 0}.muted{color:var(--muted)}.controls{display:flex;gap:16px;flex-wrap:wrap;position:sticky;top:0;z-index:2}label{display:grid;gap:4px}select,input{font:inherit;min-height:44px;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg)}.compare{display:grid;grid-template-columns:1fr 1fr;gap:16px}.shot{max-height:650px;overflow:auto;border:1px solid var(--line);border-radius:8px;background:#111}.shot img{display:block;width:100%;height:auto}.shot a{display:block}.issues{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--line);padding:12px 8px}th{font-weight:650}code{font-size:12px;white-space:pre-wrap;word-break:normal}pre{font-size:12px;white-space:pre-wrap}.high{color:var(--high);font-weight:bold}.medium{color:var(--medium);font-weight:bold}.low{color:var(--low)}.badge{display:inline-block;padding:2px 8px;border:1px solid var(--line);border-radius:99px;margin-right:4px}summary{cursor:pointer;padding:12px 0;min-height:44px}a{color:#2359af}.missing{border:1px dashed var(--line);padding:24px}.status-fail{font-weight:bold;color:var(--high)}@media(max-width:800px){main{padding:16px}.compare{grid-template-columns:1fr}.controls{position:static}}@media(prefers-color-scheme:dark){:root{--bg:#111620;--card:#1b2230;--fg:#edf1f7;--muted:#b4c0d3;--line:#414d61;--high:#ff929c;--medium:#f0c17a;--low:#97b8ff}a{color:#a8c6ff}}
  </style></head><body><main><h1>${escape(title)}</h1><p>Measured audit of fictitious records. Click any screenshot to open its original size. High and medium findings block the automated layout gate; low findings require a fix or a documented justification. A missing after-state is never counted as a pass.</p><section class="meta"><h2>Evidence</h2><pre>${escape(JSON.stringify(metadata, null, 2))}</pre><details><summary>Rule definitions and evidence exceptions</summary><p>Text measurements use a Range per Unicode character. Currency/date substrings must stay on one line even in wrapped explanatory paragraphs. All exceptions have element-specific selectors and dimensions; no page or rule is disabled.</p><table><thead><tr><th>Rule</th><th>Severity</th><th>Requirement</th></tr></thead><tbody>${Object.entries(
    AUDIT_RULES,
  )
    .map(
      ([r, [s, d]]) =>
        `<tr><td>${escape(r)}</td><td>${escape(s)}</td><td>${escape(d)}</td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></details></section><section class="summary" id="summary"></section><section class="controls"><label>Setup<select id="setup"><option value="">All setups</option></select></label><label>Screen or state<input id="search" placeholder="Search title, route or issue"></label><label>Show<select id="issues"><option value="all">Every state</option><option value="findings">With findings</option><option value="blocking">High or medium</option></select></label></section><div id="states"></div></main><script type="application/json" id="data">${scriptSafe(rows)}</script><script>
  const requiredStates=${Number(metadata.expectedStatesPerSetup) || 0},captures=${scriptSafe(metadata.afterCaptureCompleteBySetup || {})};const rows=JSON.parse(document.getElementById('data').textContent),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const setups=[...new Set(rows.map(r=>r.setup))];for(const s of setups){const o=document.createElement('option');o.value=s;o.textContent=s;document.getElementById('setup').append(o)}const params=new URLSearchParams(location.search),initialSetup=params.get('setup')||'iphone390-dark';document.getElementById('setup').value=setups.includes(initialSetup)?initialSetup:'';document.getElementById('search').value=params.get('state')||'';const groups=new Map();for(const r of rows){const k=r.setup+'/'+r.state;if(!groups.has(k))groups.set(k,{});groups.get(k)[r.phase]=r}document.getElementById('summary').innerHTML='<h2>Results by setup</h2><table><thead><tr><th>Setup</th><th>Before states / high / medium / low</th><th>After states / high / medium / low</th><th>Gate</th></tr></thead><tbody>'+setups.map(s=>{const phases=['before','after'].map(p=>{const list=rows.filter(r=>r.setup===s&&r.phase===p);return {states:list.length,high:list.reduce((n,r)=>n+(r.counts?.high||0),0),medium:list.reduce((n,r)=>n+(r.counts?.medium||0),0),low:list.reduce((n,r)=>n+(r.counts?.low||0),0)}});const complete=requiredStates>0&&captures[s]===true&&phases[0].states===requiredStates&&phases[1].states===requiredStates,gate=complete&&!phases[1].high&&!phases[1].medium?'PASS':'FAIL';return '<tr><td>'+esc(s)+'</td>'+phases.map(p=>'<td>'+[p.states,p.high,p.medium,p.low].join(' / ')+'</td>').join('')+'<td class="'+(gate==='FAIL'?'status-fail':'')+'">'+gate+'</td></tr>'}).join('')+'</tbody></table>';function draw(){const setup=document.getElementById('setup').value,query=document.getElementById('search').value.toLowerCase(),mode=document.getElementById('issues').value;document.getElementById('states').innerHTML=[...groups].filter(([k,g])=>{const r=g.after||g.before;return(!setup||r.setup===setup)&&(!query||JSON.stringify(g).toLowerCase().includes(query))&&(mode==='all'||Object.values(g).some(p=>mode==='findings'?p.issues.length:p.counts?.high||p.counts?.medium))}).map(([k,g])=>{const r=g.after||g.before;return '<section class="state"><h2>'+esc(r.title||r.state)+'</h2><p class="muted">'+esc(r.setup)+' · '+esc(r.route||'')+'</p><div class="compare">'+['before','after'].map(phase=>{const p=g[phase];if(!p)return '<div><h3>'+phase+'</h3><p class="missing">Evidence not captured; this state cannot pass.</p></div>';return '<div><h3>'+phase+'</h3><p>'+['high','medium','low'].map(s=>'<span class="badge '+s+'">'+s+': '+(p.counts?.[s]||0)+'</span>').join('')+'</p>'+(p.screenshot?'<div class="shot"><a href="'+esc(p.screenshot)+'" target="_blank" rel="noopener"><img src="'+esc(p.screenshot)+'" alt="'+esc(p.title||p.state)+' '+phase+' screenshot" loading="lazy"></a></div>':'<p class="missing">Screenshot not supplied</p>')+'<p><a href="'+esc(p.raw)+'">All raw text, target, accessibility and scroll measurements (JSON)</a></p><details><summary>'+p.issues.length+' measured findings</summary><div class="issues"><table><thead><tr><th>Severity / rule</th><th>Element</th><th>Measured / expected</th></tr></thead><tbody>'+p.issues.map(i=>'<tr><td class="'+i.severity+'">'+esc(i.severity)+'<br>'+esc(i.rule)+'</td><td><code>'+esc(i.selector)+'</code><br>'+esc(i.text)+'</td><td><pre>'+esc(JSON.stringify(i.measured,null,2))+'</pre>'+esc(i.expected)+(i.note?'<p>'+esc(i.note)+'</p>':'')+'</td></tr>').join('')+'</tbody></table></div></details><details><summary>'+p.exceptions.length+' evidence exceptions</summary><pre>'+esc(JSON.stringify(p.exceptions,null,2))+'</pre></details>'+'</div>'}).join('')+'</div></section>'}).join('')}for(const id of ['setup','search','issues'])document.getElementById(id).addEventListener('input',draw);draw();
  </script></body></html>`;
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, html);
  return { output, states: rows.length };
}
