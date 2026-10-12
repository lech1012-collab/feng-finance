import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import deployment from "./vercel.json";
export default defineConfig(({ mode }) => {
  const environment = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  let feedbackOrigin = "";
  if (environment.VITE_FEEDBACK_URL) {
    const address = new URL(environment.VITE_FEEDBACK_URL);
    if (address.protocol !== "https:" || address.username || address.password)
      throw new Error(
        "Feedback must use a public HTTPS address without credentials.",
      );
    feedbackOrigin = address.origin;
  }
  const headers = deployment.headers[0].headers.map((header) => ({
    ...header,
    value:
      header.key === "Content-Security-Policy" && feedbackOrigin
        ? header.value.replace(
            "connect-src 'self'",
            `connect-src 'self' ${feedbackOrigin}`,
          )
        : header.value,
  }));
  const buildDate = environment.FENG_BUILD_DATE || new Date().toISOString();
  if (!Number.isFinite(Date.parse(buildDate)))
    throw new Error("Invalid release build date.");
  return {
    base: environment.VITE_BASE_PATH || "/",
    define: { __FENG_BUILD_DATE__: JSON.stringify(buildDate) },
    preview: {
      headers: Object.fromEntries(
        headers.map((header) => [header.key, header.value]),
      ),
    },
    plugins: [
      react(),
      {
        name: "feng-public-feedback-policy",
        transformIndexHtml(html) {
          return feedbackOrigin
            ? html.replace(
                "connect-src 'self'",
                `connect-src 'self' ${feedbackOrigin}`,
              )
            : html;
        },
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "_headers",
            source:
              "/*\n" +
              headers
                .map((header) => `  ${header.key}: ${header.value}`)
                .join("\n") +
              "\n/sw.js\n  Cache-Control: no-cache\n/manifest.webmanifest\n  Cache-Control: no-cache\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n",
          });
        },
      },
      VitePWA({
        registerType: "prompt",
        injectRegister: false,
        includeAssets: ["favicon.svg", "icons/*.png", "ocr/**/*", "pdfjs/**/*"],
        manifest: {
          name: "Feng",
          short_name: "Feng",
          description: "Private personal cash flow, on your device.",
          theme_color: "#101217",
          background_color: "#101217",
          display: "standalone",
          start_url: ".",
          scope: ".",
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
            {
              src: "icons/icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "icons/maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          globPatterns: [
            "**/*.{js,mjs,css,html,svg,png,wasm,gz,bcmap,pfb,ttf}",
          ],
          maximumFileSizeToCacheInBytes: 16000000,
          navigateFallback: "index.html",
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: false,
        },
      }),
    ],
    test: {
      environment: "jsdom",
      setupFiles: ["./src/tests/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
      restoreMocks: true,
    },
    build: { chunkSizeWarningLimit: 1800 },
  };
});
