import { build } from "esbuild";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { writeFile, mkdir } from "node:fs/promises";
const compiled = await build({
  entryPoints: ["src/tests/statement-layouts.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { layoutItems } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputFiles[0].text).toString("base64")
);
await mkdir("tests/fixtures", { recursive: true });
for (const bank of ["amex", "revolut"]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const items = layoutItems(bank);
  const pages = Array.from(
    { length: Math.max(...items.map((i) => i.page)) },
    () => doc.addPage([595, 842]),
  );
  for (const i of items)
    pages[i.page - 1].drawText(i.text, { x: i.x, y: 842 - i.y, size: 8, font });
  await writeFile(`tests/fixtures/${bank}-uk-layout.pdf`, await doc.save());
}
console.log("Generated fictitious UK card and account statement layouts.");
