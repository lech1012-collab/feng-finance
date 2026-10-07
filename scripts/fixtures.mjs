import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("tests/fixtures", { recursive: true });
async function statement(
  bank,
  filename,
  {
    period = "01 Sep 2026 to 30 Sep 2026",
    periodLabel = "Statement period: ",
    account = "12344321",
    currency = "GBP",
    opening = 1000,
    rows = [],
    closing,
    regenerated = false,
  } = {},
) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [];
  let page;
  const create = () => {
    page = doc.addPage([650, 842]);
    pages.push(page);
  };
  create();
  const write = (text, x, y, size = 10) =>
    page.drawText(String(text), {
      x,
      y: 842 - y,
      size,
      font,
      color: rgb(0.1, 0.15, 0.12),
    });
  const amex = bank === "American Express";
  const heading = () => {
    write(bank, 35, 50, 22);
    write(amex ? "Statement of Account" : "Account statement", 35, 78, 12);
    if (period !== null) write(`${periodLabel}${period}`, 35, 103);
    write(`${amex ? "Card ending" : "Account number"}: ${account}`, 35, 123);
    if (bank === "Barclays")
      write("Sort code: 00-00-00 · Current account".replace("·", "-"), 35, 143);
    if (bank === "Revolut")
      write(`IBAN: GB00 REV0 0000 0000 ${account.slice(-4)}`, 35, 143);
    write(`Currency: ${currency}`, 35, 165);
  };
  heading();
  const fmt = (amount) =>
    (amount < 0 ? "-" : "") +
    Math.abs(amount).toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  write(amex ? "Previous balance" : "Opening balance", 35, 190);
  write(fmt(opening), 550, 190);
  const header = () => {
    write("Date", 35, 220);
    write("Description", 140, 220);
    if (amex) write("Amount", 550, 220);
    else {
      write("Money out", 380, 220);
      write("Money in", 460, 220);
      write("Balance", 550, 220);
    }
  };
  header();
  let y = 248,
    balance = amex ? -opening : opening;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.newPage) {
      create();
      write(bank, 35, 50, 16);
      header();
      y = 250;
    }
    write(row.date ?? `${String(2 + i).padStart(2, "0")} Sep`, 35, y);
    write(row.description, 140, y);
    if (row.splitPage) {
      create();
      write(bank, 35, 50, 16);
      header();
      y = 250;
      write(row.continuation ?? "LONDON STORE", 140, y);
    } else if (row.continuation) {
      y += 14;
      write(row.continuation, 140, y);
    }
    balance += row.amount;
    if (amex) {
      const raw = row.credit
        ? fmt(Math.abs(row.amount)) + " CR"
        : row.amount > 0
          ? "-" + fmt(row.amount)
          : fmt(Math.abs(row.amount));
      write(raw, 550, y);
    } else {
      write(fmt(Math.abs(row.amount)), row.amount < 0 ? 380 : 460, y);
      write(fmt(balance), 550, y);
    }
    if (row.foreign) {
      y += 14;
      write(row.foreign, 140, y);
    }
    y += 30;
  }
  const end = closing ?? (amex ? -balance : balance);
  write(amex ? "New balance" : "Closing balance", 35, y + 15);
  write(fmt(end), 550, y + 15);
  write(`Page ${pages.length} of ${pages.length}`, 35, 800);
  if (regenerated) {
    doc.setProducer("Regenerated synthetic fixture");
    doc.setSubject("Same statement, different bytes");
  }
  await writeFile(`tests/fixtures/${filename}.pdf`, await doc.save());
  return { closing: end, count: rows.length };
}
await statement("Barclays", "barclays-card-payment", {
  opening: 1000,
  rows: [
    {
      date: "28 Sep",
      description: "Direct Debit to Barclaycard",
      amount: -900,
    },
  ],
  closing: 100,
});
await statement("Barclays", "barclays-drag", {
  opening: 1000,
  rows: [
    { description: "FICTIONAL WATER", amount: -10 },
    { description: "CITY LEISURE MEMBERSHIP", amount: -20 },
    { description: "UNKNOWN MERCHANT", amount: -30 },
  ],
  closing: 940,
});
let deeperOpening = 1000;
for (const [number, name, days] of [
  ["04", "Apr", "30"],
  ["05", "May", "31"],
  ["06", "Jun", "30"],
  ["07", "Jul", "31"],
]) {
  const income = number === "07" ? 400 : 1000;
  const spending = number === "07" ? 500 : 100;
  await statement("Barclays", `barclays-deeper-${number}`, {
    period: `01 ${name} 2026 to ${days} ${name} 2026`,
    opening: deeperOpening,
    rows: [
      { date: `02 ${name}`, description: "SALARY", amount: income },
      { date: `03 ${name}`, description: "JOHN LEWIS", amount: -spending },
    ],
    closing: deeperOpening + income - spending,
  });
  deeperOpening += income - spending;
}
await statement("Barclays", "barclays", {
  rows: [
    { description: "SIEMENS SALARY", amount: 5000, date: "01 Sep" },
    { description: "RENT RECEIVED", amount: 2100, date: "02 Sep" },
    {
      description: "JOHN LEWIS",
      continuation: "LONDON STORE",
      amount: -1200,
      date: "03 Sep",
    },
    { description: "WAITROSE FULHAM", amount: -82.45, date: "04 Sep" },
    { description: "TFL", amount: -15.2, date: "05 Sep" },
    { description: "WAITROSE FULHAM", amount: -10, date: "06 Sep" },
    { description: "WAITROSE FULHAM", amount: -10, date: "06 Sep" },
    {
      description: "TRANSFER TO REVOLUT",
      amount: -2000,
      date: "10 Sep",
      newPage: true,
    },
    { description: "AMEX CARD PAYMENT", amount: -1000, date: "11 Sep" },
    { description: "SHOP REFUND", amount: 20, date: "12 Sep" },
  ],
});
await statement("Barclays", "barclays-regenerated", {
  regenerated: true,
  rows: [
    { description: "SIEMENS SALARY", amount: 5000, date: "01 Sep" },
    { description: "RENT RECEIVED", amount: 2100, date: "02 Sep" },
    {
      description: "JOHN LEWIS",
      continuation: "LONDON STORE",
      amount: -1200,
      date: "03 Sep",
    },
    { description: "WAITROSE FULHAM", amount: -82.45, date: "04 Sep" },
    { description: "TFL", amount: -15.2, date: "05 Sep" },
    { description: "WAITROSE FULHAM", amount: -10, date: "06 Sep" },
    { description: "WAITROSE FULHAM", amount: -10, date: "06 Sep" },
    {
      description: "TRANSFER TO REVOLUT",
      amount: -2000,
      date: "10 Sep",
      newPage: true,
    },
    { description: "AMEX CARD PAYMENT", amount: -1000, date: "11 Sep" },
    { description: "SHOP REFUND", amount: 20, date: "12 Sep" },
  ],
});
await statement("Barclays", "barclays-october", {
  period: "01 Oct 2026 to 31 Oct 2026",
  rows: [{ date: "03 Oct", description: "JOHN LEWIS", amount: -45 }],
});
await statement("Barclays", "barclays-header-range", {
  period: "1 – 30 September 2026",
  periodLabel: "",
  rows: [{ date: "03 Sep", description: "FICTIONAL STORE", amount: -75 }],
});
await statement("Barclays", "barclays-no-period", {
  period: null,
  rows: [{ date: "03 Sep", description: "FICTIONAL STORE", amount: -75 }],
});
await statement("Barclays", "barclays-warning", {
  closing: 950,
  rows: [{ description: "WAITROSE", amount: -80 }],
});
await statement("Barclays", "barclays-split-page", {
  rows: [{ description: "JOHN LEWIS", amount: -120, splitPage: true }],
});
await statement("American Express", "amex", {
  account: "1008",
  opening: 1200,
  rows: [
    { date: "03 Sep", description: "JOHN LEWIS", amount: -120.5 },
    { date: "04 Sep", description: "NETFLIX", amount: -12.99 },
    { date: "05 Sep", description: "SHOP REFUND", amount: 20, credit: true },
    {
      date: "12 Sep",
      description: "BARCLAYS PAYMENT RECEIVED",
      amount: 1000,
      newPage: true,
    },
    {
      date: "14 Sep",
      description: "TRAVEL HOTEL",
      amount: -75.21,
      foreign: "Original amount USD 94.00 · Exchange rate 1.25".replace(
        "·",
        "-",
      ),
    },
  ],
});
await statement("Revolut", "revolut", {
  account: "9002",
  opening: 100,
  rows: [
    { date: "11 Sep", description: "TRANSFER FROM BARCLAYS", amount: 2000 },
    { date: "12 Sep", description: "TFL", amount: -15 },
    { date: "13 Sep", description: "UBER", amount: -20 },
    { date: "14 Sep", description: "MERCHANT REFUND", amount: 10 },
  ],
});
await statement("Revolut", "revolut-eur", {
  account: "7004",
  currency: "EUR",
  opening: 1234.56,
  rows: [
    { date: "03 Sep", description: "RESTAURANT", amount: -34.56 },
    { date: "04 Sep", description: "SHOP REFUND", amount: 12.34 },
  ],
});
// Raster-only one-page PDF for exercising real local OCR, with high-contrast type.
import sharp from "sharp";
const svg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1300" height="1684"><rect width="1300" height="1684" fill="white"/><g font-family="Arial, sans-serif" fill="black" font-size="22"><text x="70" y="100" font-size="44">Barclays</text><text x="70" y="156">Account statement</text><text x="70" y="206">Statement period: 01 Sep 2026 to 30 Sep 2026</text><text x="70" y="246">Account number: 12344321</text><text x="70" y="286">Sort code: 00-00-00 Current account</text><text x="70" y="330">Currency: GBP</text><text x="70" y="380">Opening balance</text><text x="1100" y="380">1,000.00</text><text x="70" y="440">Date</text><text x="280" y="440">Description</text><text x="760" y="440">Money out</text><text x="920" y="440">Money in</text><text x="1100" y="440">Balance</text><text x="70" y="496">02 Sep</text><text x="280" y="496">WAITROSE</text><text x="760" y="496">80.00</text><text x="1100" y="496">920.00</text><text x="70" y="580">Closing balance</text><text x="1100" y="580">920.00</text></g></svg>`,
);
const png = await sharp(svg).png().toBuffer();
const scan = await PDFDocument.create();
const scanImage = await scan.embedPng(png);
scan
  .addPage([650, 842])
  .drawImage(scanImage, { x: 0, y: 0, width: 650, height: 842 });
await writeFile("tests/fixtures/barclays-scanned.pdf", await scan.save());
console.log("Generated synthetic bank statements (no personal information).");
await statement("Barclays", "barclays-income", {
  opening: 1000,
  rows: [
    { date: "15 Sep", description: "FICTIONAL EMPLOYER", amount: 3726 },
    { date: "18 Sep", description: "FICTIONAL INCOME", amount: 500 },
    { date: "20 Sep", description: "WAITROSE", amount: -100 },
  ],
});

let planningOpening = 1000;
for (const [month, label, end, groceries, bill] of [
  ["07", "Jul", "31", 100, 10],
  ["08", "Aug", "31", 120, 12],
  ["09", "Sep", "30", 110, 12],
]) {
  await statement("Barclays", `barclays-planning-${month}`, {
    account: "77774321",
    opening: planningOpening,
    period: `01 ${label} 2026 to ${end} ${label} 2026`,
    rows: [
      { date: `10 ${label}`, description: "NETFLIX", amount: -bill },
      { date: `15 ${label}`, description: "WAITROSE", amount: -groceries },
      { date: `25 ${label}`, description: "SIEMENS SALARY", amount: 3000 },
    ],
  });
  planningOpening += 3000 - groceries - bill;
}

await statement("Barclays", "barclays-sort", {
  rows: [
    { description: "CORNER SHOP", amount: -20, date: "03 Sep" },
    { description: "CORNER SHOP", amount: -30, date: "04 Sep" },
    { description: "ANOTHER SHOP", amount: -15, date: "05 Sep" },
  ],
});
await statement("Barclays", "barclays-sort-next", {
  period: "01 Oct 2026 to 31 Oct 2026",
  rows: [{ description: "CORNER SHOP", amount: -12, date: "03 Oct" }],
});
