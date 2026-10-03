import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import deployment from "./vercel.json";
export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  preview: {
    headers: Object.fromEntries(
      deployment.headers[0].headers.map((header) => [header.key, header.value]),
    ),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "icons/*.png", "ocr/**/*", "pdfjs/**/*"],
      manifest: {
        name: "Feng Finance",
        short_name: "Feng",
        description: "Private personal cash flow, on your device.",
        theme_color: "#101715",
        background_color: "#101715",
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
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,wasm,gz,bcmap,pfb,ttf}"],
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
});
