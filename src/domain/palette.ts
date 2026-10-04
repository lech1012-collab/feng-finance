const palette = [
  "#709feb",
  "#b094ef",
  "#e4a064",
  "#d987b0",
  "#8ea2bc",
  "#cb985e",
];
export function categoryColor(id: string) {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}
