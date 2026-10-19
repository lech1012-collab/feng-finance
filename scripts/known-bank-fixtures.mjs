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
