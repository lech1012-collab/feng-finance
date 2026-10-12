import type { ExtractedTextItem, PageQuality, SourcePage } from "./types";
import { textQuality } from "./table";
export function assessPageQuality(
  items: ExtractedTextItem[],
  page: SourcePage | number,
): PageQuality {
  const geometry =
    typeof page === "number"
      ? {
          page,
          width: Math.max(
            1,
            ...items.filter((i) => i.page === page).map((i) => i.x + i.width),
          ),
          height: Math.max(
            1,
            ...items.filter((i) => i.page === page).map((i) => i.y + i.height),
          ),
          rotation: 0,
        }
      : page;
  return textQuality(items, [geometry])[0];
}
