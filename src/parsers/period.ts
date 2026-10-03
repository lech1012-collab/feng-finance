import type { TextRow } from "../domain/models";
import { parseDate } from "../domain/dates";

export interface StatementPeriod {
  start: string;
  end: string;
}
export const PERIOD_ERROR =
  "Statement dates could not be read from this PDF. Enter the start and end dates printed on the statement below, then choose Parse again. No transactions have been saved.";

const date =
  "(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.]\\d{1,2}[/.](?:\\d{4}|\\d{2})|\\d{1,2}\\s+[A-Za-z]{3,9}(?:\\s+(?:\\d{4}|\\d{2}))?)";
const boundary = "(?![\\dA-Za-z]|\\s+\\d)";
const range = `(${date})\\s*(?:to|–|—|-)\\s*(${date})${boundary}`;
const shortRange = `([0-9]{1,2})\\s*(?:to|–|—|-)\\s*(${date})${boundary}`;
const label =
  "(?:statement period|period|statement from|account statement|statement dates|your (?:barclays )?(?:bank account )?statement)";

export function validatePeriod(period: StatementPeriod): StatementPeriod {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(period.start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(period.end)
  )
    throw new Error("Enter both statement dates using the date controls.");
  const start = parseDate(period.start),
    end = parseDate(period.end);
  if (start > end)
    throw new Error("Statement start date must be on or before its end date.");
  return { start, end };
}

function resolveRange(startText: string, endText: string): StatementPeriod {
  // Never guess the statement year from today's date or transaction dates.
  let end: string;
  try {
    end = parseDate(endText);
  } catch {
    const start = parseDate(startText);
    end = parseDate(endText, `${start.slice(0, 4)}-12-31`);
  }
  let start: string;
  if (/^\d{1,2}$/.test(startText)) {
    const day = startText.padStart(2, "0");
    start = parseDate(`${end.slice(0, 8)}${day}`);
  } else start = parseDate(startText, end);
  return validatePeriod({ start, end });
}

export function identifyPeriod(
  rows: TextRow[],
  allowHeaderRange = false,
): StatementPeriod {
  // Header-only matching avoids treating merchant references and fee periods as
  // the account's statement period. Repeated page headers are not evidence for
  // choosing a different interval.
  const firstPage = Math.min(...rows.map((r) => r.page));
  const page = rows.filter((r) => r.page === firstPage);
  const table = page.findIndex(
    (r) =>
      /\bdate\b/i.test(r.text) &&
      /description|details|transaction|merchant/i.test(r.text),
  );
  const header = table >= 0 ? page.slice(0, table) : page.slice(0, 30);
  const found = new Map<string, StatementPeriod>();
  for (let i = 0; i < header.length; i++) {
    let text = "";
    for (let j = i; j < Math.min(header.length, i + 3); j++) {
      if (j > i && header[j].y - header[j - 1].y > 45) break;
      text = (text + " " + header[j].text)
        .normalize("NFKC")
        .replace(/\s+/g, " ")
        .trim();
      const labeled = text.match(
        new RegExp(
          `^${label}\\s*:?\\s*(?:from\\s+)?(?:${range}|${shortRange})`,
          "i",
        ),
      );
      const plain = allowHeaderRange
        ? text.match(
            new RegExp(`^(?:from\\s+)?(?:${range}|${shortRange})$`, "i"),
          )
        : null;
      const match = labeled ?? plain;
      if (!match) continue;
      const period = resolveRange(match[1] ?? match[3], match[2] ?? match[4]);
      found.set(`${period.start}/${period.end}`, period);
    }
  }
  if (found.size > 1)
    throw new Error(
      "More than one statement period was found. Enter the start and end dates printed on the statement below, then choose Parse again.",
    );
  const period = [...found.values()][0];
  if (!period) throw new Error(PERIOD_ERROR);
  return period;
}
