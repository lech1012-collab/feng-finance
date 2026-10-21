import type { PageTextItem } from "../domain/models";

const informationHeading =
  /^(?:Promotional transactions|Interest and charges|Your new balance|Using your card|Ways to pay)\b/i;

/** The other reading panel may contain account information rather than dates.
 * Its cash/contactless limits must never enter the transaction amount column.
 * Keep genuine second transaction panels bounded by their own date anchor. */
export function barclaycardPanelRight(
  items: PageTextItem[],
  dateX: number,
  nextDateX?: number,
  pageRight = Infinity,
) {
  const next = nextDateX === undefined ? pageRight : nextDateX - 15;
  const information = items
    .filter(
      (item) =>
        item.x > dateX + 100 && informationHeading.test(item.text.trim()),
    )
    .map((item) => item.x - 15);
  return Math.min(next, ...information);
}
