#!/usr/bin/env node
/** Inspection aids only. Original viewport and full-page screenshots remain untouched. */
import sharp from "sharp";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

const root = resolve(process.argv[2] || "audit");
const inventory = JSON.parse(
  await readFile(
    new URL("./feng-polish-screen-inventory.json", import.meta.url),
    "utf8",
  ),
);
const output = join(root, "visual-contact-sheets");
await mkdir(output, { recursive: true });
const manifest = [];
for (const setup of inventory.setups) {
  const desktop = setup.engine === "chromium";
  const per = desktop ? 8 : 10,
    cols = desktop ? 2 : 5;
  const renderW = desktop ? Math.round(setup.width / 2) : setup.width;
  const renderH = desktop ? Math.round(setup.height / 2) : setup.height;
  const overviewW = 120,
    cellW = renderW + overviewW,
    captionH = 32;
  for (let start = 0; start < inventory.states.length; start += per) {
    const group = inventory.states.slice(start, start + per);
    const exists = await Promise.all(
      group.map(async (state) => {
        try {
          await access(join(root, "after", setup.id, state.id + ".json"));
          return true;
        } catch {
          return false;
        }
      }),
    );
    if (exists.some((value) => !value)) continue;
    const file =
      setup.id + "-" + String(start / per + 1).padStart(2, "0") + ".png";
    const composite = [],
      details = [];
    for (let index = 0; index < group.length; index++) {
      const state = group[index],
        x = (index % cols) * cellW,
        y = Math.floor(index / cols) * (renderH + captionH);
      const data = JSON.parse(
        await readFile(
          join(root, "after", setup.id, state.id + ".json"),
          "utf8",
        ),
      );
      const source = await readFile(join(root, "after", data.image));
      const full = await readFile(join(root, "after", data.fullImage));
      const viewport = await sharp(source)
        .resize(renderW, renderH, { fit: "fill" })
        .png()
        .toBuffer();
      const overview = await sharp(full)
        .resize(overviewW, renderH, { fit: "contain", background: "#d9dfe9" })
        .png()
        .toBuffer();
      const label = `${start + index + 1}. ${state.id}`.replace(/[&<>]/gu, "");
      const caption = Buffer.from(
        `<svg width="${cellW}" height="${captionH}"><rect width="100%" height="100%" fill="#eef2f8"/><text x="8" y="21" font-family="sans-serif" font-size="13" fill="#131b28">${label}</text></svg>`,
      );
      composite.push(
        { input: caption, left: x, top: y },
        { input: viewport, left: x, top: y + captionH },
        { input: overview, left: x + renderW, top: y + captionH },
      );
      details.push({
        id: state.id,
        title: state.title,
        entryScript: data.metrics.entryScript,
        stylesheets: data.metrics.stylesheets,
        source: "after/" + data.image,
        fullSource: "after/" + data.fullImage,
        viewportSha256: createHash("sha256").update(source).digest("hex"),
        fullSha256: createHash("sha256").update(full).digest("hex"),
        capturedAt: data.capturedAt,
      });
    }
    await sharp({
      create: {
        width: cellW * cols,
        height: Math.ceil(group.length / cols) * (renderH + captionH),
        channels: 4,
        background: "#eef2f8",
      },
    })
      .composite(composite)
      .png()
      .toFile(join(output, file));
    manifest.push({
      file,
      setup: setup.id,
      viewportScale: desktop ? 0.5 : 1,
      fullPageOverview: true,
      states: details,
    });
  }
}
await writeFile(
  join(output, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    contactSheets: manifest.length,
    states: manifest.reduce((count, item) => count + item.states.length, 0),
  }),
);
