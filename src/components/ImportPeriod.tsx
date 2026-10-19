function endpointDate(iso: string) {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(date.getTime())
    ? date
        .toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        })
        .replace(/\bSept\b/g, "Sep")
    : "Date unavailable";
}

export function ImportPeriod({ start, end }: { start: string; end: string }) {
  return (
    <span className="import-period">
      <time className="date-value" dateTime={start}>
        {endpointDate(start)}
      </time>
      {" to "}
      <time className="date-value" dateTime={end}>
        {endpointDate(end)}
      </time>
    </span>
  );
}
