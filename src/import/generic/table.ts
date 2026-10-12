import type { PageTextItem } from "../../domain/models";
import type {
  ColumnBand,
  ExtractedTextItem,
  PageQuality,
  ReconstructedRow,
  ReconstructedTable,
  SourcePage,
  SourceRect,
  TableCell,
} from "./types";
import {
  DATE_LIKE,
  DATE_PATTERN,
  headerRole,
  isWord,
  MONEY_PATTERN,
} from "./tokens";

interface PositionedRow {
  page: number;
  y: number;
  items: ExtractedTextItem[];
  text: string;
}
export function reconstructFontRows(
  items: ExtractedTextItem[],
): PositionedRow[] {
  const rows: PositionedRow[] = [];
  for (const item of [...items]
    .filter((i) => i.text.trim())
    .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)) {
    const row = rows.at(-1);
    const tolerance = Math.max(
      2,
      Math.min(6, (item.fontSize || item.height || 10) * 0.3),
    );
    if (row && row.page === item.page && Math.abs(row.y - item.y) <= tolerance)
      row.items.push(item);
    else rows.push({ page: item.page, y: item.y, items: [item], text: "" });
  }
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    row.text = row.items
      .map((i) => i.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return rows;
}
export function textQuality(
  items: ExtractedTextItem[],
  pages: SourcePage[],
): PageQuality[] {
  const rows = reconstructFontRows(items);
  return pages.map((page) => {
    const source = rows.filter((row) => row.page === page.page);
    if (!source.length)
      return {
        page: page.page,
        usable: false,
        transactionTokenCount: 0,
        recognisedTokenCount: 0,
        usableFraction: 0,
        reason: "empty",
      };
    const transactionRows = source.filter((row) => {
      const roles = headerItems(row);
      if (roles.some((role) => role.role === "date") && roles.length >= 2)
        return false;
      if (
        footerRE.test(row.text) ||
        carryRE.test(row.text) ||
        subtotalRE.test(row.text)
      )
        return false;
      return (
        row.items.some((i) => DATE_LIKE.test(i.text.trim())) ||
        (row.items.some((i) => i.x > page.width * 0.45) && row.items.length > 2)
      );
    });
    const tokens = transactionRows
      .flatMap((row) => row.items.flatMap((i) => i.text.trim().split(/\s+/)))
      .filter(Boolean);
    const count = tokens.filter(
      (t) =>
        DATE_PATTERN.test(t) ||
        MONEY_PATTERN.test(t) ||
        isWord(t) ||
        /^(?:CR|DR)$/i.test(t),
    ).length;
    const fraction = tokens.length ? count / tokens.length : 1;
    return {
      page: page.page,
      usable: fraction >= 0.5,
      transactionTokenCount: tokens.length,
      recognisedTokenCount: count,
      usableFraction: fraction,
      ...(fraction < 0.5
        ? { reason: "low-transaction-token-quality" as const }
        : {}),
    };
  });
}
export function bounds(items: PageTextItem[]): SourceRect {
  const first = items[0];
  if (!first) return { page: 1, x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...items.map((i) => i.x)),
    y = Math.min(...items.map((i) => i.y));
  return {
    page: first.page,
    x,
    y,
    width: Math.max(...items.map((i) => i.x + i.width)) - x,
    height: Math.max(...items.map((i) => i.y + i.height)) - y,
  };
}
const footerRE =
  /^(?:page\s+\d|continued$|report lost|registered in|Barclays Bank UK PLC|Revolut Bank UK Ltd legal|American Express Services|how you can pay|how to pay|ways to pay|your cashback|important information|customer service|sort code\b|account number\b|card ending\b|currency\b|statement period\b|statement of account\b|www\.|©)/i;
const carryRE =
  /\b(?:opening balance|closing balance|start balance|end balance|previous (?:closing )?balance|new balance|balance (?:brought|carried) forward|your (?:previous|new) balance)\b/i;
const subtotalRE =
  /^(?:total(?:s)?(?:\s+|$)|subtotal(?:\s+|$)|new credits\b|new debits\b|money in\s+[£€\d]|money out\s+[£€\d])/i;
const sectionRE =
  /^(?:your transactions|payments(?: towards your account)?|new transactions|transactions, interest and charges|how you've used your card|purchases|card purchases|credits|refunds|interest and charges)\s*$/i;
const issuerBannerRE = /^(?:Barclays|Barclaycard|American Express|Revolut)$/i;
function headerItems(row: PositionedRow) {
  const entries: {
    item: ExtractedTextItem;
    role: NonNullable<ReturnType<typeof headerRole>>;
  }[] = [];
  for (let n = 0; n < row.items.length; n++) {
    const first = row.items[n];
    let match:
      | {
          item: ExtractedTextItem;
          role: NonNullable<ReturnType<typeof headerRole>>;
          length: number;
        }
      | undefined;
    for (let size = Math.min(3, row.items.length - n); size >= 1; size--) {
      const group = row.items.slice(n, n + size);
      if (
        group.some(
          (i, k) => k > 0 && i.x - (group[k - 1].x + group[k - 1].width) > 14,
        )
      )
        continue;
      const role = headerRole(group.map((i) => i.text).join(" "));
      if (!role) continue;
      const rect = bounds(group);
      match = {
        item: { ...first, ...rect, text: group.map((i) => i.text).join(" ") },
        role,
        length: size,
      };
      break;
    }
    if (match) {
      entries.push(match);
      n += match.length - 1;
    }
  }
  return entries.sort((a, b) => a.item.x - b.item.x);
}
function numericAnchors(
  rows: PositionedRow[],
  start: PositionedRow,
  endY: number,
) {
  const points = rows
    .filter(
      (r) =>
        r.page === start.page &&
        r.y > start.y &&
        r.y < endY &&
        r.items.some((i) => DATE_LIKE.test(i.text.trim())),
    )
    .flatMap((r) =>
      r.items
        .filter(
          (i) =>
            !DATE_PATTERN.test(i.text.trim()) &&
            MONEY_PATTERN.test(i.text.trim()),
        )
        .map((i) => i.x + i.width),
    )
    .sort((a, b) => a - b);
  const clusters: { sum: number; count: number }[] = [];
  for (const x of points) {
    const cluster = clusters.find((c) => Math.abs(c.sum / c.count - x) < 14);
    if (cluster) {
      cluster.sum += x;
      cluster.count++;
    } else clusters.push({ sum: x, count: 1 });
  }
  return clusters
    .filter((c) => c.count >= Math.min(2, Math.max(1, points.length)))
    .map((c) => c.sum / c.count);
}
function numericRole(role: ColumnBand["inferredRole"]) {
  return (
    role !== undefined && ["in", "out", "amount", "balance"].includes(role)
  );
}
function inferredHeaders(rows: PositionedRow[], start: PositionedRow) {
  const data = rows.filter(
    (row) =>
      row.y >= start.y &&
      row.items.some((item) => DATE_PATTERN.test(item.text.trim())),
  );
  const dates = start.items.filter((item) =>
    DATE_PATTERN.test(item.text.trim()),
  );
  const words = start.items.filter(
    (item) => !dates.includes(item) && !MONEY_PATTERN.test(item.text.trim()),
  );
  const clusters: {
    right: number;
    items: ExtractedTextItem[];
    rowIds: Set<number>;
  }[] = [];
  for (let rowIndex = 0; rowIndex < data.length; rowIndex++)
    for (const item of data[rowIndex].items) {
      if (
        DATE_PATTERN.test(item.text.trim()) ||
        !MONEY_PATTERN.test(item.text.trim())
      )
        continue;
      const right = item.x + item.width;
      const match = clusters.find(
        (cluster) => Math.abs(cluster.right - right) < 14,
      );
      if (match) {
        match.items.push(item);
        match.rowIds.add(rowIndex);
        match.right =
          match.items.reduce((sum, value) => sum + value.x + value.width, 0) /
          match.items.length;
      } else
        clusters.push({ right, items: [item], rowIds: new Set([rowIndex]) });
    }
  clusters.sort((a, b) => a.right - b.right);
  const balance =
    clusters.length > 1
      ? [...clusters].sort(
          (a, b) => b.rowIds.size - a.rowIds.size || b.right - a.right,
        )[0]
      : undefined;
  const separate =
    clusters.length === 2 &&
    clusters.every((cluster) => cluster.rowIds.size < data.length);
  const numeric = clusters.map((cluster, index) => {
    const item = cluster.items.reduce((a, b) => (a.x < b.x ? a : b));
    const text = separate
      ? index === 0
        ? "Money out"
        : "Money in"
      : cluster === balance
        ? "Balance"
        : clusters.length > 2
          ? index === 0
            ? "Money out"
            : "Money in"
          : "Amount";
    return { ...item, text };
  });
  const synthetic: PositionedRow = {
    ...start,
    items: [
      ...dates.map((item) => ({ ...item, text: "Date" })),
      ...words.slice(0, 1).map((item) => ({ ...item, text: "Description" })),
      ...numeric,
    ],
  };
  return headerItems(synthetic);
}
function rowCells(
  row: PositionedRow,
  columns: ColumnBand[],
  anchors: Map<string, number>,
): TableCell[] {
  const groups = new Map<string, ExtractedTextItem[]>();
  for (const item of row.items) {
    const text = item.text.trim();
    const date =
      DATE_PATTERN.test(text) ||
      (!MONEY_PATTERN.test(text) && DATE_LIKE.test(text));
    const numeric =
      !date && (MONEY_PATTERN.test(text) || /^(?:CR|DR)$/i.test(text));
    const containing = columns.find((c) => item.x >= c.x0 && item.x < c.x1);
    let chosen = containing;
    if (date) {
      const dates = columns.filter((c) => c.inferredRole === "date");
      if (dates.length)
        chosen = [...dates].sort(
          (a, b) => Math.abs(item.x - a.x0) - Math.abs(item.x - b.x0),
        )[0];
    } else if (numeric && containing?.inferredRole !== "date") {
      const nearest = columns
        .filter((c) => numericRole(c.inferredRole))
        .sort(
          (a, b) =>
            Math.abs(item.x + item.width - (anchors.get(a.id) ?? a.x1)) -
            Math.abs(item.x + item.width - (anchors.get(b.id) ?? b.x1)),
        )[0];
      // Numeric references embedded in a description are not monetary columns.
      if (
        nearest &&
        (numericRole(containing?.inferredRole) ||
          Math.abs(
            item.x + item.width - (anchors.get(nearest.id) ?? nearest.x1),
          ) < 24)
      )
        chosen = nearest;
    }
    if (!chosen)
      chosen = [...columns].sort(
        (a, b) =>
          Math.min(Math.abs(item.x - a.x0), Math.abs(item.x - a.x1)) -
          Math.min(Math.abs(item.x - b.x0), Math.abs(item.x - b.x1)),
      )[0];
    if (!chosen) continue;
    const group = groups.get(chosen.id) ?? [];
    group.push(item);
    groups.set(chosen.id, group);
  }
  return [...groups].map(([columnId, items]) => ({
    columnId,
    text: items
      .map((i) => i.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
    rect: bounds(items),
    parseSource: items.some((i) => i.parseSource === "ocr") ? "ocr" : "text",
  }));
}
/** Build per-page column bands. Amount anchors come from the right edge of data, not text starts. */
export function reconstructTable(
  items: ExtractedTextItem[],
  pages: SourcePage[],
): ReconstructedTable {
  const raw = reconstructFontRows(items);
  const firstPage = Math.min(...pages.map((page) => page.page));
  const firstTitle = raw.find((row) => row.page === firstPage);
  const normalizedTitle = (text: string) =>
    text.normalize("NFKC").replace(/\s+/g, " ").trim().toUpperCase();
  const allColumns: ColumnBand[] = [];
  const result: ReconstructedRow[] = [];
  let ordinal = 0;
  let inherited:
    | {
        columns: ColumnBand[];
        anchors: Map<string, number>;
        width: number;
        active: boolean;
        section: string;
      }
    | undefined;
  for (const page of pages) {
    const rows = raw.filter((r) => r.page === page.page);
    const firstTableHeader = rows.find((row) => {
      const heading = headerItems(row);
      return (
        heading.some((entry) => entry.role === "date") &&
        heading.some((entry) => entry.role === "description") &&
        heading.some((entry) => numericRole(entry.role))
      );
    });
    let columns: ColumnBand[] = inherited?.active
      ? inherited.columns.map((c, k) => ({
          ...c,
          id: `p${page.page}-inherited-c${k}`,
          x0: (c.x0 * page.width) / inherited!.width,
          x1: (c.x1 * page.width) / inherited!.width,
        }))
      : [];
    let anchors = new Map<string, number>();
    if (columns.length && inherited)
      columns.forEach((c, k) =>
        anchors.set(
          c.id,
          ((inherited!.anchors.get(inherited!.columns[k].id) ??
            inherited!.columns[k].x1) *
            page.width) /
            inherited!.width,
        ),
      );
    allColumns.push(...columns);
    let active = inherited?.active ?? false;
    let section = inherited?.section ?? "";
    let previousTx: ReconstructedRow | undefined;
    const makeColumns = (
      header: PositionedRow,
      entries: ReturnType<typeof headerItems>,
    ) => {
      const numeric = numericAnchors(rows, header, Infinity);
      const leading = entries.map((e) => e.item.x).sort((a, b) => a - b);
      const cols = entries.map((entry, k) => {
        const role = entry.role;
        const next = leading[k + 1] ?? page.width;
        const c: ColumnBand = {
          id: `p${page.page}-h${ordinal}-c${k}`,
          x0: Math.max(0, entry.item.x - 6),
          x1: next - 6,
          alignment: numericRole(role) ? "right" : "left",
          headerText: entry.item.text,
          inferredRole: role,
        };
        const expected = entry.item.x + entry.item.width;
        const eligible = numeric.filter((x) => x >= c.x0 && x <= c.x1 + 18);
        anchors.set(
          c.id,
          eligible.sort(
            (a, b) => Math.abs(a - expected) - Math.abs(b - expected),
          )[0] ?? Math.min(next - 8, expected),
        );
        return c;
      });
      allColumns.push(...cols);
      return cols;
    };
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      // An inherited date band must not turn a repeated issuer title above the
      // next page's printed table header into a malformed transaction. This
      // positional rule deliberately does not match bank-name merchants or
      // malformed rows inside the table or rows with financial/date tokens.
      if (
        firstTableHeader &&
        row.y < firstTableHeader.y &&
        (issuerBannerRE.test(row.text.trim()) ||
          (firstTitle &&
            normalizedTitle(row.text) === normalizedTitle(firstTitle.text) &&
            row.y < page.height * 0.2 &&
            Math.abs(bounds(row.items).x - bounds(firstTitle.items).x) <=
              Math.max(18, page.width * 0.05))) &&
        !row.items.some(
          (item) =>
            DATE_LIKE.test(item.text.trim()) ||
            MONEY_PATTERN.test(item.text.trim()),
        )
      ) {
        result.push({
          id: `row-${ordinal++}`,
          kind: "header",
          rect: bounds(row.items),
          cells: [],
        });
        previousTx = undefined;
        continue;
      }
      let heading = headerItems(row);
      if (
        heading.some((h) => h.role === "date") &&
        heading.some((h) => numericRole(h.role))
      ) {
        const firstData = rows.find(
          (candidate) =>
            candidate.y > row.y &&
            candidate.items.some((item) => DATE_PATTERN.test(item.text.trim())),
        );
        if (firstData) {
          const missing = inferredHeaders(rows, firstData).filter((entry) => {
            if (entry.role === "description")
              return !heading.some(
                (existing) => existing.role === "description",
              );
            if (!numericRole(entry.role) || entry.item.x < page.width * 0.4)
              return false;
            if (
              heading.some(
                (existing) => Math.abs(existing.item.x - entry.item.x) < 24,
              )
            )
              return false;
            const previous = [...heading]
              .reverse()
              .find((existing) => existing.item.x <= entry.item.x);
            return previous?.role !== "ignore";
          });
          heading = [...heading, ...missing].sort(
            (a, b) => a.item.x - b.item.x,
          );
        }
      }
      if (
        heading.some((h) => h.role === "date") &&
        heading.some((h) => h.role === "description" || numericRole(h.role))
      ) {
        anchors = new Map();
        columns = makeColumns(row, heading);
        active = true;
        previousTx = undefined;
        ordinal++;
        result.push({
          id: `row-${ordinal++}`,
          kind: "header",
          rect: bounds(row.items),
          cells: rowCells(row, columns, anchors),
        });
        continue;
      }
      const hasDate = row.items.some(
        (i) =>
          !MONEY_PATTERN.test(i.text.trim()) && DATE_LIKE.test(i.text.trim()),
      );
      const withoutDate = row.items
        .filter((item) => !DATE_PATTERN.test(item.text.trim()))
        .map((item) => item.text)
        .join(" ");
      const carry =
        carryRE.test(withoutDate) &&
        /^(?:opening balance|closing balance|start balance|end balance|previous (?:closing )?balance|new balance|balance (?:brought|carried) forward|your (?:previous|new) balance)/i.test(
          withoutDate,
        );
      const subtotal = !hasDate && subtotalRE.test(row.text),
        footer = !hasDate && footerRE.test(row.text),
        sectionHeading = !hasDate && sectionRE.test(row.text);
      if (sectionHeading) {
        section = row.text;
        previousTx = undefined;
        result.push({
          id: `row-${ordinal++}`,
          kind: "section",
          rect: bounds(row.items),
          cells: columns.length ? rowCells(row, columns, anchors) : [],
          section,
        });
        continue;
      }
      if (carry || subtotal || footer) {
        result.push({
          id: `row-${ordinal++}`,
          kind: carry ? "carry" : subtotal ? "subtotal" : "footer",
          rect: bounds(row.items),
          cells: columns.length
            ? rowCells(row, columns, anchors)
            : row.items.map((i, k) => ({
                columnId: `metadata-${k}`,
                text: i.text,
                rect: bounds([i]),
                parseSource: i.parseSource,
              })),
        });
        previousTx = undefined;
        if (
          (footer && /how you can pay|your cashback/i.test(row.text)) ||
          (carry &&
            /^(?:closing balance|end balance|new balance|your new balance)/i.test(
              withoutDate,
            ))
        )
          active = false;
        continue;
      }
      if (
        !active &&
        hasDate &&
        row.items.some((i) => MONEY_PATTERN.test(i.text.trim()))
      ) {
        const entries = inferredHeaders(rows, row);
        anchors = new Map();
        columns = makeColumns({ ...row, y: row.y - 1 }, entries);
        active = true;
      }
      if (!active || !columns.length) continue;
      // A two-line repeated heading can appear above an inherited page table.
      // Recognise its prefix only when the next line contains a full new header.
      const followingHeader =
        rows[rowIndex + 1] && headerItems(rows[rowIndex + 1]);
      if (
        /^(?:transaction|process|posting|booking|value)(?:\s+(?:transaction|process|posting|booking|value))*$/i.test(
          row.text.trim(),
        ) &&
        followingHeader &&
        followingHeader.some((entry) => entry.role === "date") &&
        followingHeader.some((entry) => entry.role === "description") &&
        followingHeader.some((entry) => numericRole(entry.role))
      ) {
        result.push({
          id: `row-${ordinal++}`,
          kind: "header",
          rect: bounds(row.items),
          cells: rowCells(row, columns, anchors),
        });
        previousTx = undefined;
        continue;
      }
      const cells = rowCells(row, columns, anchors);
      const amountCells = cells.filter(
        (c) =>
          numericRole(columns.find((k) => k.id === c.columnId)?.inferredRole) &&
          c.text.trim(),
      );
      const dateCells = cells.filter(
        (c) =>
          columns.find((k) => k.id === c.columnId)?.inferredRole === "date" &&
          c.text.trim(),
      );
      // Any text in a numeric/date field is a source row, including corrupted digits.
      const transaction =
        hasDate || dateCells.length > 0 || amountCells.length > 0;
      const current: ReconstructedRow = {
        id: `row-${ordinal++}`,
        kind: transaction ? "transaction" : "continuation",
        rect: bounds(row.items),
        cells,
        section,
      };
      const next = rows[rowIndex + 1];
      const previousHasAmount = previousTx?.cells.some((cell) =>
        numericRole(
          columns.find((column) => column.id === cell.columnId)?.inferredRole,
        ),
      );
      const nextCells =
        next && next.y - row.y <= 24 ? rowCells(next, columns, anchors) : [];
      const nextHasAmount = nextCells.some((cell) =>
        numericRole(
          columns.find((column) => column.id === cell.columnId)?.inferredRole,
        ),
      );
      const nextHasDate = nextCells.some(
        (cell) =>
          columns.find((column) => column.id === cell.columnId)
            ?.inferredRole === "date",
      );
      // Some statements wrap a new blank-date description before its amount line.
      if (
        current.kind === "continuation" &&
        nextHasAmount &&
        !nextHasDate &&
        (!previousTx || previousHasAmount) &&
        !/^reference\b|^ref\s*:|^original amount\b|^exchange rate\b|^(?:CR|DR)$/i.test(
          row.text,
        )
      )
        current.kind = "transaction";
      const previousPending = previousTx && !previousHasAmount;
      if (
        current.kind === "transaction" &&
        previousTx &&
        previousPending &&
        !hasDate &&
        !dateCells.length &&
        row.y - (previousTx.rect.y + previousTx.rect.height) < 30
      ) {
        current.kind = "continuation";
        current.continuesRowId = previousTx.id;
        previousTx.rect = {
          ...previousTx.rect,
          width:
            Math.max(
              previousTx.rect.x + previousTx.rect.width,
              current.rect.x + current.rect.width,
            ) - previousTx.rect.x,
          height: current.rect.y + current.rect.height - previousTx.rect.y,
        };
      }
      if (
        previousTx &&
        cells.length === 1 &&
        /^(?:CR|DR)$/i.test(cells[0].text)
      ) {
        const matching = previousTx.cells.find(
          (c) => c.columnId === cells[0].columnId,
        );
        if (matching) {
          matching.text += " " + cells[0].text;
          current.cells = [];
        }
        current.kind = "continuation";
        current.continuesRowId = previousTx.id;
      } else if (
        current.kind === "continuation" &&
        previousTx &&
        row.y - (previousTx.rect.y + previousTx.rect.height) < 40
      )
        current.continuesRowId = previousTx.id;
      else if (current.kind === "continuation") current.kind = "unknown";
      if (current.kind === "transaction") previousTx = current;
      result.push(current);
    }
    inherited = { columns, anchors, width: page.width, active, section };
  }
  // A page with its own repeated table header can replace every inherited band.
  // Keep only bands actually referenced by reconstructed source evidence.
  const usedColumns = new Set(
    result.flatMap((row) => row.cells.map((cell) => cell.columnId)),
  );
  return {
    columns: allColumns.filter((column) => usedColumns.has(column.id)),
    rows: result,
    pages,
  };
}
