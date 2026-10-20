// Generate only fictional statements; original user statements never enter Git.
import { build } from "esbuild";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";

const compiled = await build({
  entryPoints: ["src/tests/known-bank-layouts.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { knownBankItems } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputFiles[0].text).toString("base64")
);
await mkdir("tests/fixtures", { recursive: true });
for (const layout of [
  "barclays-current",
  "barclaycard",
  "amex",
  "revolut",
  "hsbc",
  "barclays-malformed",
]) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const items = knownBankItems(layout);
  const pages = Array.from(
    { length: Math.max(...items.map((item) => item.page)) },
    () => document.addPage([layout === "barclaycard" ? 600 : 595, 842]),
  );
  for (const item of items)
    pages[item.page - 1].drawText(item.text, {
      x: item.x,
      y: 842 - item.y,
      size: item.fontSize ?? item.height,
      font,
    });
  await writeFile(
    `tests/fixtures/known-bank-${layout}.pdf`,
    await document.save(),
  );
}
console.log("Generated six fictional known-bank and fallback PDFs.");

// An unread amount remains correctable before any financial records are saved.
{
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([595, 842]);
  for (const item of knownBankItems("hsbc")) {
    const text =
      item.text === "FICTIONAL GROCER"
        ? "BEAUTY CODE"
        : item.y === 260 && item.x === 320
          ? "UNREAD"
          : item.text;
    page.drawText(text, {
      x: item.x,
      y: 842 - item.y,
      size: item.fontSize ?? item.height,
      font,
    });
  }
  await writeFile(
    "tests/fixtures/beauty-code-correction.pdf",
    await document.save(),
  );
}

// Guided review keeps identity ahead of rows and asks one manual amount at a time.
for (const name of ["guided-two-amounts", "guided-missing-account"]) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([595, 842]);
  const items = knownBankItems("hsbc").filter(
    (item) => !(name === "guided-missing-account" && item.y === 95),
  );
  for (const item of items) {
    const text =
      item.text === "FICTIONAL GROCER"
        ? "BEAUTY CODE"
        : item.y === 260 && item.x === 320
          ? "UNREAD"
          : name === "guided-two-amounts" && item.y === 180 && item.x === 500
            ? "£100.00"
            : name === "guided-two-amounts" && item.y === 295 && item.x === 500
              ? "£2,400.00"
              : item.text;
    page.drawText(text, {
      x: item.x,
      y: 842 - (item.y === 295 ? 330 : item.y),
      size: item.fontSize ?? item.height,
      font,
    });
  }
  if (name === "guided-two-amounts") {
    for (const [x, text] of [
      [30, "03 Sep 2026"],
      [110, "SECOND FICTIONAL SHOP"],
      [320, "UNREAD"],
      [500, "£2,400.00"],
    ])
      page.drawText(text, { x, y: 842 - 290, size: 8, font });
  }
  await writeFile(`tests/fixtures/${name}.pdf`, await document.save());
}

// A supported card with an unread identifier must retain its native financial checks.
{
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const pages = [document.addPage([600, 842]), document.addPage([600, 842])];
  for (const item of knownBankItems("barclaycard").filter(
    (item) => !item.text.startsWith("Number "),
  ))
    pages[item.page - 1].drawText(item.text, {
      x: item.x,
      y: 842 - item.y,
      size: item.fontSize ?? item.height,
      font,
    });
  await writeFile(
    "tests/fixtures/guided-credit-account.pdf",
    await document.save(),
  );
}
