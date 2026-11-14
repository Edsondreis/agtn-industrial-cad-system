import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { patchOcctGlue } from "./core/solid/src/occt-csp-patch";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** F-05 (ETAPA 5): os testes usam o MESMO glue do OCCT que o app (sem geração de código). */
const occtCsp = (): Plugin => ({
  name: "agtn-occt-csp",
  enforce: "pre",
  transform(code, id) {
    return id.includes("occt-wasm/dist/occt-wasm.js") ? { code: patchOcctGlue(code), map: null } : null;
  },
});

export default defineConfig({
  plugins: [occtCsp()],
  resolve: {
    alias: {
      "@agtn/geometry": r("./core/geometry/src/index.ts"),
      "@agtn/document": r("./core/document/src/index.ts"),
      "@agtn/dxf": r("./modules/dxf/src/index.ts"),
      "@agtn/sheetmetal": r("./modules/sheetmetal/src/index.ts"),
      "@agtn/sheetgraph": r("./modules/sheetmetal/src/sheet3d/index.ts"),
      "@agtn/sheet3d": r("./modules/sheet3d/src/index.ts"),
      "@agtn/lasertext": r("./modules/lasertext/src/index.ts"),
      "@agtn/parts": r("./modules/parts/src/index.ts"),
      "@agtn/plot": r("./modules/plot/src/index.ts"),
      "@agtn/solid": r("./core/solid/src/index.ts"),
      "@agtn/model3d": r("./core/model3d/src/index.ts"),
      "@agtn/sketch": r("./core/sketch/src/index.ts"),
    },
  },
  test: {
    globals: true,
    // o occt-wasm passa pelo Vite (e pelo plugin acima) em vez de ser carregado direto pelo Node
    server: { deps: { inline: [/occt-wasm/] } },
    include: [
      "core/*/src/**/*.test.ts",
      "modules/*/src/**/*.test.ts",
      "apps/desktop/src/**/*.test.ts",
    ],
  },
});
