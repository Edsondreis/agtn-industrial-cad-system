import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { createReadStream, readFileSync, statSync } from "node:fs";
import type { Connect, Plugin } from "vite";
import { patchOcctGlue } from "../../core/solid/src/occt-csp-patch";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const pkg = JSON.parse(readFileSync(r("./package.json"), "utf-8")) as { version: string };

/**
 * Motor 3D (OCCT em WebAssembly, 21 MB): NÃO vai para o `dist` (que fica embutido no .exe).
 * No aplicativo instalado ele é um recurso separado (`resources/occt/occt-wasm.wasm`, substituível — LGPL),
 * lido pelo comando Rust `read_engine`. Em `vite dev`/`vite preview` (navegador) é servido por este middleware.
 */
const OCCT_WASM = r("../../node_modules/occt-wasm/dist/occt-wasm.wasm");
function occtWasmDev(): Plugin {
  const mw: Connect.NextHandleFunction = (req, res, next) => {
    if (req.url?.split("?")[0] !== "/__engine/occt-wasm.wasm") return next();
    res.setHeader("Content-Type", "application/wasm");
    res.setHeader("Content-Length", String(statSync(OCCT_WASM).size));
    createReadStream(OCCT_WASM).pipe(res);
  };
  return {
    name: "agtn-occt-wasm",
    enforce: "pre",
    // o glue do Emscripten referencia o .wasm por `new URL(...)`, o que faria o Vite copiá-lo para o `dist`
    // (e o Tauri o embutiria no .exe). O binário sempre chega por `init({ wasm })`, então a referência é anulada.
    // F-05 (ETAPA 5): o embind do glue gera código com Function(...) — proibido pela CSP. patchOcctGlue troca os dois
    // geradores por closures equivalentes (= -sDYNAMIC_EXECUTION=0) e PARA o build se o glue não for o da 5.17.1.
    transform(code, id) {
      if (!id.includes("occt-wasm/dist/occt-wasm.js")) return null;
      const out = patchOcctGlue(code).replace('new URL("occt-wasm.wasm",import.meta.url).href', '"occt-wasm.wasm"');
      if (!out.includes('"occt-wasm.wasm"') || out.includes('new URL("occt-wasm.wasm"')) this.error("occt-wasm: referência ao .wasm não encontrada — revise o plugin agtn-occt-wasm.");
      return { code: out, map: null };
    },
    configureServer: (s) => void s.middlewares.use(mw),
    configurePreviewServer: (s) => void s.middlewares.use(mw),
  };
}

// Tauri espera porta fixa em desenvolvimento.
export default defineConfig({
  plugins: [react(), occtWasmDev()],
  worker: { format: "es", plugins: () => [occtWasmDev()] },
  // o occt-wasm não pode ser pré-empacotado pelo esbuild no `vite dev`: o pré-empacotamento pula o transform acima
  optimizeDeps: { exclude: ["occt-wasm"] },
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: {
      "@agtn/geometry": r("../../core/geometry/src/index.ts"),
      "@agtn/document": r("../../core/document/src/index.ts"),
      "@agtn/dxf": r("../../modules/dxf/src/index.ts"),
      "@agtn/sheetmetal": r("../../modules/sheetmetal/src/index.ts"),
      "@agtn/sheetgraph": r("../../modules/sheetmetal/src/sheet3d/index.ts"),
      "@agtn/sheet3d": r("../../modules/sheet3d/src/index.ts"),
      "@agtn/lasertext": r("../../modules/lasertext/src/index.ts"),
      "@agtn/parts": r("../../modules/parts/src/index.ts"),
      "@agtn/plot": r("../../modules/plot/src/index.ts"),
      "@agtn/solid": r("../../core/solid/src/index.ts"),
      "@agtn/model3d": r("../../core/model3d/src/index.ts"),
      "@agtn/sketch": r("../../core/sketch/src/index.ts"),
    },
  },
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 900 },
});
