// Test-only static host. Shutting down the origin proves offline operation without
// Playwright WebKit's setOffline/route interception (which bypasses its worker).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import deployment from "../../vercel.json" with { type: "json" };
export interface LocalHost {
  origin: string;
  stop: () => Promise<void>;
  advanceWorker: () => void;
}
export async function startStaticHost(): Promise<LocalHost> {
  const root = resolve("dist");
  let workerVersion = 0;
  const types: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".wasm": "application/wasm",
    ".css": "text/css",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json",
  };
  const server = createServer(async (req, res) => {
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end();
      return;
    }
    try {
      const path = decodeURIComponent(
        new URL(req.url ?? "/", "http://localhost").pathname,
      );
      const file = resolve(root, "." + (path === "/" ? "/index.html" : path));
      if (!file.startsWith(root + sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const data = await readFile(file);
      for (const header of deployment.headers[0].headers)
        res.setHeader(header.key, header.value);
      res.setHeader(
        "Content-Type",
        types[extname(file)] ?? "application/octet-stream",
      );
      res.setHeader("Cache-Control", "no-store");
      res.end(
        path === "/sw.js"
          ? Buffer.concat([
              data,
              Buffer.from(`\n/* test release ${workerVersion} */`),
            ])
          : data,
      );
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Static test host did not start.");
  let stopped = false;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    advanceWorker: () => {
      workerVersion++;
    },
    stop: async () => {
      if (stopped) return;
      stopped = true;
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
