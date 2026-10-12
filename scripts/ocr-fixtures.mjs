// Synthetic statements only. The resulting PDF has image pixels and no text layer.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

const destination = process.argv[2] ?? "tests/fixtures";
await mkdir(destination, { recursive: true });
const pageWidth = 612;
const pageHeight = 792;
function imageMarkup(page, count) {
  const text = (value, x, y, size = 11, anchor = "start") =>
    `<text x="${x}" y="${y}" font-family="DejaVu Sans, sans-serif" font-size="${size}" fill="#111" text-anchor="${anchor}">${value}</text>`;
  const line = (y) =>
    `<path d="M32 ${y} H580" stroke="#333" stroke-width="0.5"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="2550" height="3300" viewBox="0 0 ${pageWidth} ${pageHeight}"><rect width="612" height="792" fill="white"/>` +
    text("Barclays", 32, 50, 22) +
    text("Current account statement", 32, 78, 13) +
    text("Statement period: 1 September 2026 to 30 September 2026", 32, 108) +
    text("Account number: 12344321", 32, 132) +
    text("Currency: GBP", 32, 155) +
    text("Opening balance", 32, 187) +
    text(page === 1 ? "500.00" : "2,621.57", 578, 187, 11, "end") +
    line(211) +
    text("Date", 32, 232) +
    text("Description", 138, 232) +
    text("Money out", 380, 232, 11, "end") +
    text("Money in", 467, 232, 11, "end") +
    text("Balance", 578, 232, 11, "end") +
    line(240) +
    (page === 1
      ? text("1 Sep 2026", 32, 274) +
        text("SIEMENS SALARY", 138, 274) +
        text("2,200.00", 467, 274, 11, "end") +
        text("2,700.00", 578, 274, 11, "end") +
        text("4 Sep 2026", 32, 320) +
        text("WAITROSE", 138, 320) +
        text("78.43", 380, 320, 11, "end") +
        text("2,621.57", 578, 320, 11, "end")
      : text("6 Sep 2026", 32, 274) +
        text("TFL TRAVEL", 138, 274) +
        text("5.00", 380, 274, 11, "end") +
        text("2,616.57", 578, 274, 11, "end")) +
    line(355) +
    text("Money in", 32, 384) +
    text(page === 1 ? "2,200.00" : "0.00", 578, 384, 11, "end") +
    text("Money out", 32, 408) +
    text(page === 1 ? "78.43" : "5.00", 578, 408, 11, "end") +
    text("Closing balance", 32, 444) +
    text(page === 1 ? "2,621.57" : "2,616.57", 578, 444, 11, "end") +
    text(`Page ${page} of ${count}`, 32, 752, 10) +
    text("FICTITIOUS TEST DATA", 578, 752, 9, "end") +
    "</svg>"
  );
}

for (const [filename, count, garbled] of [
  ["ocr-generic", 1, false],
  ["ocr-cancel", 2, false],
  ["ocr-garbled", 1, true],
]) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(
    garbled
      ? "Synthetic statement with unusable embedded text"
      : "Synthetic image-only statement",
  );
  pdf.setSubject(
    "Generated fictitious fixture; no personal financial information",
  );
  for (let n = 1; n <= count; n++) {
    const image = await sharp(Buffer.from(imageMarkup(n, count)))
      .png()
      .toBuffer();
    const embedded = await pdf.embedPng(image);
    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    });
    if (garbled) {
      // Simulate a damaged text layer without changing the readable pixels.
      // All transaction-position tokens are unusable, so local OCR is required.
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      for (const x of [32, 138, 340, 430, 540])
        page.drawText("#@!~?", {
          x,
          y: 282,
          size: 11,
          font,
          color: rgb(1, 1, 1),
        });
    }
  }
  await writeFile(`${destination}/${filename}.pdf`, await pdf.save());
}

// A digital row differs from its printed running balance by exactly one penny.
// It must remain a warning; the legacy one-penny tolerance must not hide it.
const penny = await PDFDocument.create();
penny.setTitle("Synthetic one-penny reconciliation failure");
penny.setSubject(
  "Generated fictitious fixture; no personal financial information",
);
const font = await penny.embedFont(StandardFonts.Helvetica);
const page = penny.addPage([pageWidth, pageHeight]);
const print = (value, x, y, size = 11, right = false) =>
  page.drawText(value, {
    x: right ? x - font.widthOfTextAtSize(value, size) : x,
    y: pageHeight - y,
    size,
    font,
  });
print("Barclays", 32, 50, 22);
print("Current account statement", 32, 78, 13);
print("Statement period: 1 September 2026 to 30 September 2026", 32, 108);
print("Account number: 12344321", 32, 132);
print("Currency: GBP", 32, 155);
print("Opening balance", 32, 187);
print("500.00", 578, 187, 11, true);
print("Date", 32, 232);
print("Description", 138, 232);
print("Money out", 380, 232, 11, true);
print("Money in", 467, 232, 11, true);
print("Balance", 578, 232, 11, true);
print("1 Sep 2026", 32, 274);
print("SIEMENS SALARY", 138, 274);
print("2,200.00", 467, 274, 11, true);
print("2,700.00", 578, 274, 11, true);
print("4 Sep 2026", 32, 320);
print("WAITROSE", 138, 320);
print("78.44", 380, 320, 11, true);
print("2,621.57", 578, 320, 11, true);
print("Money in", 32, 384);
print("2,200.00", 578, 384, 11, true);
print("Money out", 32, 408);
print("78.43", 578, 408, 11, true);
print("Closing balance", 32, 444);
print("2,621.57", 578, 444, 11, true);
print("Page 1 of 1 - FICTITIOUS TEST DATA", 32, 752, 9);
await writeFile(`${destination}/generic-one-penny.pdf`, await penny.save());
