import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const pkg = JSON.parse(readFileSync(r("./package.json"), "utf-8")) as { version: string };

// Tauri espera porta fixa em desenvolvimento.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: {
      "@agtn/geometry": r("../../core/geometry/src/index.ts"),
      "@agtn/document": r("../../core/document/src/index.ts"),
      "@agtn/dxf": r("../../modules/dxf/src/index.ts"),
      "@agtn/sheetmetal": r("../../modules/sheetmetal/src/index.ts"),
      "@agtn/lasertext": r("../../modules/lasertext/src/index.ts"),
      "@agtn/parts": r("../../modules/parts/src/index.ts"),
    },
  },
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 900 },
});
