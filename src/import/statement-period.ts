/** Card purchase dates can precede posting. Coverage follows the printed posting
 * date when provided, while the original transaction date remains unchanged. */
export function outsideStatementPeriod(
  transaction: { date: string; bookingDate?: string },
  start: string,
  end: string,
) {
  const date = transaction.bookingDate ?? transaction.date;
  return date < start || date > end;
}
