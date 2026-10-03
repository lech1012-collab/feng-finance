const months = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
export function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    year < 1900 ||
    year > 2200
  )
    throw new Error("Invalid statement date.");
  return date.toISOString().slice(0, 10);
}
export function parseDate(raw: string, referenceEnd?: string) {
  let m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = raw.trim().match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (m) return isoDate(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = raw.trim().match(/^(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{2,4}))?$/);
  if (m) {
    const month = months.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    if (!month) throw new Error("Unsupported date format.");
    let year = m[3]
      ? +m[3] < 100
        ? 2000 + +m[3]
        : +m[3]
      : Number(referenceEnd?.slice(0, 4));
    if (!year) throw new Error("Statement year required.");
    let date = isoDate(year, month, +m[1]);
    if (!m[3] && referenceEnd && date > referenceEnd)
      date = isoDate(--year, month, +m[1]);
    return date;
  }
  throw new Error("Unsupported date format.");
}
export function monthOffset(month: string, offset: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 7);
}
export function monthBounds(month: string): [string, string] {
  return [`${month}-01`, `${monthOffset(month, 1)}-01`];
}
export function monthLabel(month: string) {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
export function dayDistance(a: string, b: string) {
  return (
    Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) /
    86400000
  );
}
