import { bounds, reconstructFontRows, reconstructTable } from "./table";
import { DATE_PATTERN, headerRole, MONEY_PATTERN } from "./tokens";
import { barclaycardPanelRight } from "../../parsers/barclaycard-layout";
import type {
  ColumnBand,
  ExtractedTextItem,
  ReconstructedRow,
  ReconstructedTable,
  SourcePage,
  TableCell,
} from "./types";

const month =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const cardDate = new RegExp(
  `^(?:\\d{1,2}\\s+${month}(?:\\s+\\d{2,4})?|\\d{1,2}[/.]\\d{1,2}[/.]\\d{2,4}|\\d{4}-\\d{2}-\\d{2})$`,
  "i",
);
const combinedDate = new RegExp(
  `^(\\d{1,2}\\s+${month}(?:\\s+\\d{2,4})?|\\d{1,2}[/.]\\d{1,2}[/.]\\d{2,4}|\\d{4}-\\d{2}-\\d{2})\\s+(.+)$`,
  "i",
);
const cardSection =
  /^(?:your transactions|payments towards your account|transactions, interest and charges|how you've used your card|promotional transactions|interest and charges)\b/i;
const carry = /^your (?:previous|new) balance\b/i;
const footer =
  /^(?:page\s+\d|ways to pay|how to pay|how you can pay|important information|report lost|www\.|barclaycard\.co\.uk)/i;

/** PDF.js combines neighbouring date/merchant draws. Amount runs stay untouched. */
function separateDate(item: ExtractedTextItem): ExtractedTextItem[] {
  const text = item.text.trim();
  if (cardDate.test(text)) return [item];
  const match = text.match(combinedDate);
  if (!match) return [item];
  const width = (item.width * match[1].length) / text.length;
  const confidence = Math.min(item.confidence ?? 1, 0.85);
  return [
    { ...item, text: match[1], width, confidence },
    {
      ...item,
      text: match[2],
      x: item.x + width,
      width: item.width - width,
      confidence,
    },
  ];
}

function dateAnchors(items: ExtractedTextItem[]): number[] {
  const result: number[] = [];
  for (const item of [...items].sort((a, b) => a.x - b.x))
    if (
      cardDate.test(item.text.trim()) &&
      !result.some((x) => Math.abs(x - item.x) < 15)
    )
      result.push(item.x);
  return result;
}

function coverWithoutLedger(source: ExtractedTextItem[]) {
  const raw = reconstructFontRows(source);
  return (
    !source.some((item) => /^Your transactions\b/i.test(item.text.trim())) &&
    source.some((item) => /^Number\s+[\d•*xX]/i.test(item.text.trim())) &&
    !raw.some(
      (row) =>
        row.items.some((item) => cardDate.test(item.text.trim())) &&
        row.items.some((item) => MONEY_PATTERN.test(item.text.trim())),
    ) &&
    !raw.some(
      (row) =>
        row.items.some((item) => headerRole(item.text) === "date") &&
        row.items.some((item) => headerRole(item.text) === "amount"),
    )
  );
}

function panelTable(
  items: ExtractedTextItem[],
  page: SourcePage,
  dateX: number,
  right: number,
  panel: number,
): ReconstructedTable {
  const rows = reconstructFontRows(items);
  const dated = rows.filter((row) =>
    row.items.some(
      (item) =>
        Math.abs(item.x - dateX) < 15 && cardDate.test(item.text.trim()),
    ),
  );
  const amounts = dated.flatMap((row) =>
    row.items.filter(
      (item) => item.x > dateX + 30 && MONEY_PATTERN.test(item.text.trim()),
    ),
  );
  const unreadableMonetary = dated.flatMap((row) =>
    row.items.filter(
      (item) =>
        item.x > dateX + 30 && /^(?:GBP\s*|[£€$])/.test(item.text.trim()),
    ),
  );
  // A wholly unreadable amount panel still retains every dated source row.
  // The empty fallback band is a layout hint, never an invented amount value.
  const amountRuns = [...amounts, ...unreadableMonetary];
  const amountX = amountRuns.length
    ? Math.min(...amountRuns.map((item) => item.x))
    : right - (right - dateX) * 0.2;
  const descriptionItems = dated.flatMap((row) =>
    row.items.filter(
      (item) =>
        item.x > dateX + 15 &&
        item.x < amountX - 10 &&
        !MONEY_PATTERN.test(item.text.trim()) &&
        !/^(?:e|c|m)$/i.test(item.text.trim()),
    ),
  );
  const descriptionX = descriptionItems.length
    ? Math.min(...descriptionItems.map((item) => item.x))
    : dateX + 35;
  const prefix = `p${page.page}-r${panel}`;
  const columns: ColumnBand[] = [
    {
      id: `${prefix}-date`,
      x0: Math.max(0, dateX - 6),
      x1: descriptionX - 6,
      alignment: "left",
      headerText: "Date",
      inferredRole: "date",
    },
    {
      id: `${prefix}-description`,
      x0: descriptionX - 6,
      x1: amountX - 30,
      alignment: "left",
      headerText: "Description",
      inferredRole: "description",
    },
    {
      id: `${prefix}-amount`,
      x0: amountX,
      x1: right,
      alignment: "right",
      headerText: "Amount",
      inferredRole: "amount",
    },
    {
      id: `${prefix}-marker`,
      x0: amountX - 30,
      x1: amountX,
      alignment: "left",
      headerText: "",
      inferredRole: "ignore",
    },
  ];
  const cellsFor = (source: ExtractedTextItem[]): TableCell[] => {
    const groups = new Map<string, ExtractedTextItem[]>();
    // Amounts are right-aligned: a wider value elsewhere can start to the left
    // of this row's contactless marker. Classify the marker against this row's
    // monetary runs, not the panel-wide minimum left edge.
    const rowAmounts = source.filter(
      (item) =>
        item.x >= amountX - 6 &&
        (MONEY_PATTERN.test(item.text.trim()) ||
          /^(?:GBP\s*|[£€$])/.test(item.text.trim())),
    );
    for (const item of source) {
      const text = item.text.trim();
      const marker =
        /^(?:e|c|m)$/i.test(text) &&
        rowAmounts.some(
          (amount) => item.x >= amount.x - 30 && item.x < amount.x,
        );
      const header = headerRole(text);
      const role = marker
        ? "marker"
        : item.x < descriptionX - 6 ||
            (Math.abs(item.x - dateX) < 15 && DATE_PATTERN.test(text))
          ? "date"
          : item.x >= amountX - 6 || header === "amount"
            ? "amount"
            : "description";
      const id = `${prefix}-${role}`;
      const group = groups.get(id) ?? [];
      group.push(item);
      groups.set(id, group);
    }
    return [...groups].map(([columnId, source]) => ({
      columnId,
      text: source
        .map((item) => item.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
      rect: bounds(source),
      parseSource: source.some((item) => item.parseSource === "ocr")
        ? "ocr"
        : "text",
    }));
  };
  const has = (cells: TableCell[], role: string) =>
    cells.some((cell) => cell.columnId === `${prefix}-${role}`);
  const result: ReconstructedRow[] = [];
  let previous: ReconstructedRow | undefined;
  let active = false;
  let ended = false;
  let section = "";
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const cells = cellsFor(row.items);
    const current: ReconstructedRow = {
      id: `${prefix}-row${index}`,
      kind: "unknown",
      rect: bounds(row.items),
      cells,
      section,
    };
    if (cardSection.test(row.text)) {
      section = row.text;
      current.section = section;
      current.kind = "section";
      previous = undefined;
      if (/^Your transactions\b/i.test(row.text)) ended = false;
    } else if (carry.test(row.text)) {
      current.kind = "carry";
      previous = undefined;
      if (/^Your new balance\b/i.test(row.text)) {
        active = false;
        ended = true;
      }
    } else if (footer.test(row.text)) {
      current.kind = "footer";
      active = false;
      previous = undefined;
      ended = true;
    } else if (ended) {
      // Payment instructions often start in the date band. They cannot
      // reactivate the ledger just because that band contains some text.
      current.kind = "footer";
      previous = undefined;
    } else if (
      row.items.some((item) => headerRole(item.text) === "date") &&
      row.items.some((item) => headerRole(item.text) === "amount")
    ) {
      current.kind = "header";
      active = true;
      previous = undefined;
    } else {
      if (has(cells, "date")) active = true;
      const dated = has(cells, "date");
      const monetary = has(cells, "amount");
      const next = rows[index + 1];
      const nextCells =
        next && next.y - row.y <= 24 ? cellsFor(next.items) : [];
      const wrappedNewTransaction =
        !dated &&
        !monetary &&
        active &&
        has(nextCells, "amount") &&
        !has(nextCells, "date") &&
        (!previous || has(previous.cells, "amount")) &&
        !/^reference\b|^ref\s*:|^original amount\b|^exchange rate\b|^\d[\d,.]*\s+(?:Euro|EUR|USD|dollars)\b/i.test(
          row.text,
        );
      if (active && (dated || monetary || wrappedNewTransaction)) {
        current.kind = "transaction";
        if (
          !dated &&
          previous &&
          !has(previous.cells, "amount") &&
          row.y - (previous.rect.y + previous.rect.height) < 30
        ) {
          current.kind = "continuation";
          current.continuesRowId = previous.id;
        } else previous = current;
      } else if (
        active &&
        previous &&
        row.y - (previous.rect.y + previous.rect.height) < 40
      ) {
        current.kind = "continuation";
        current.continuesRowId = previous.id;
      } else previous = undefined;
    }
    result.push(current);
  }
  const used = new Set(
    result.flatMap((row) => row.cells.map((c) => c.columnId)),
  );
  return {
    columns: columns.filter((c) => used.has(c.id)),
    rows: result,
    pages: [page],
  };
}

function prefixTable(
  table: ReconstructedTable,
  panel: number,
): ReconstructedTable {
  const columnIds = new Map(
    table.columns.map((column) => [
      column.id,
      column.id.replace(/^(p\d+)-/, `$1-r${panel}-`),
    ]),
  );
  const rowIds = new Map(
    table.rows.map((row) => [row.id, `p${row.rect.page}-r${panel}-${row.id}`]),
  );
  return {
    ...table,
    columns: table.columns.map((column) => ({
      ...column,
      id: columnIds.get(column.id)!,
    })),
    rows: table.rows.map((row) => ({
      ...row,
      id: rowIds.get(row.id)!,
      continuesRowId: row.continuesRowId
        ? rowIds.get(row.continuesRowId)
        : undefined,
      cells: row.cells.map((cell) => ({
        ...cell,
        columnId: columnIds.get(cell.columnId) ?? cell.columnId,
      })),
    })),
  };
}

/**
 * Only call for a Barclaycard profile. Reading panels must be separated before
 * Y grouping, including a single ledger beside non-transaction information.
 * An uncertain region count returns undefined so the ordinary evidence review
 * remains available. Coordinates and page dimensions always refer to the PDF.
 */
export function reconstructCardRegions(
  original: ExtractedTextItem[],
  pages: SourcePage[],
): ReconstructedTable | undefined {
  const items = original.flatMap(separateDate);
  const anchors = new Map(
    pages.map((page) => [
      page.page,
      dateAnchors(items.filter((item) => item.page === page.page)),
    ]),
  );
  const knownSingleLedger = pages.some((page) => {
    const source = items.filter((item) => item.page === page.page);
    const dateXs = anchors.get(page.page)!;
    return (
      dateXs.length === 1 &&
      source.some((item) => /^Your transactions\b/i.test(item.text.trim())) &&
      barclaycardPanelRight(source, dateXs[0], undefined, page.width) <
        page.width
    );
  });
  if ([...anchors.values()].some((value) => value.length > 2)) return;
  // Two date columns in one table (purchase date and posting date) are not two
  // reading panels. A genuine left panel also has a transaction description.
  const independentPanels = new Set<number>();
  for (const page of pages) {
    const dateXs = anchors.get(page.page)!;
    if (dateXs.length !== 2) continue;
    const left = items.filter(
      (item) => item.page === page.page && item.x < dateXs[1] - 15,
    );
    const hasDescription = reconstructFontRows(left).some(
      (row) =>
        row.items.some((item) => cardDate.test(item.text.trim())) &&
        row.items.some(
          (item) =>
            item.x > dateXs[0] + 15 &&
            !cardDate.test(item.text.trim()) &&
            !MONEY_PATTERN.test(item.text.trim()) &&
            !/^(?:[£€$]|GBP\b|e$|c$|m$)/i.test(item.text.trim()),
        ),
    );
    // Cover-page issue/due dates are metadata, not two reading panels. Leave
    // that page with ordinary reconstruction without vetoing a real ledger
    // on a later page. The original items remain available to metadata/proof.
    if (hasDescription) independentPanels.add(page.page);
  }
  if (!knownSingleLedger && !independentPanels.size) return;
  const tables: ReconstructedTable[] = [];
  for (const page of pages) {
    const source = items.filter((item) => item.page === page.page);
    const dateXs = anchors.get(page.page)!;
    // Identity, issue/due dates and balances are read from the untouched
    // original items by identifyMetadata, not inferred as transactions.
    if (coverWithoutLedger(source)) continue;
    if (
      !dateXs.length ||
      (dateXs.length === 2 && !independentPanels.has(page.page))
    ) {
      tables.push(prefixTable(reconstructTable(source, [page]), 0));
      continue;
    }
    // Keep a one-ledger page in the same source-correction model. Ordinary
    // full-page inference can otherwise interpret help pages as transactions.
    for (let panel = 0; panel < dateXs.length; panel++) {
      const left = dateXs[panel] - 15;
      const right = barclaycardPanelRight(
        source,
        dateXs[panel],
        dateXs[panel + 1],
        page.width,
      );
      tables.push(
        panelTable(
          source.filter((item) => item.x >= left && item.x < right),
          page,
          dateXs[panel],
          right,
          panel,
        ),
      );
    }
  }
  return {
    columns: tables.flatMap((table) => table.columns),
    rows: tables.flatMap((table) => table.rows),
    pages,
  };
}
