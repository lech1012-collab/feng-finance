import { mkdir, copyFile, readdir, access, rm, cp } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
await rm("public/ocr", { recursive: true, force: true });
await mkdir("public/ocr", { recursive: true });
const paths = [
  ["node_modules/tesseract.js/dist/worker.min.js", "public/ocr/worker.min.js"],
  [
    "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
    "public/ocr/eng.traineddata.gz",
  ],
];
for (const name of await readdir("node_modules/tesseract.js-core"))
  if (/^tesseract-core-(?:simd-)?lstm\.wasm(?:\.js)?$/.test(name))
    paths.push([
      join("node_modules/tesseract.js-core", name),
      join("public/ocr", name),
    ]);
for (const [src, dest] of paths) {
  await access(src);
  await copyFile(src, dest);
}
await mkdir("public/icons", { recursive: true });
const svg = Buffer.from(
  '<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" rx="100" fill="#12213f"/><path d="M168 350V162h184v42H212v39h110v41H212v66Z" fill="white"/><path d="M290 310h62v40h-62Z" fill="#94a8d0"/></svg>',
);
for (const n of [192, 512])
  await sharp(svg).resize(n, n).png().toFile(`public/icons/icon-${n}.png`);
await sharp(svg).png().toFile("public/icons/maskable-512.png");

for (const dir of ["cmaps", "standard_fonts", "wasm"])
  await cp("node_modules/pdfjs-dist/" + dir, "public/pdfjs/" + dir, {
    recursive: true,
  });
