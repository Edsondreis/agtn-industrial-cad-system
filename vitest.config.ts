import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@agtn/geometry": r("./core/geometry/src/index.ts"),
      "@agtn/document": r("./core/document/src/index.ts"),
      "@agtn/dxf": r("./modules/dxf/src/index.ts"),
      "@agtn/sheetmetal": r("./modules/sheetmetal/src/index.ts"),
      "@agtn/lasertext": r("./modules/lasertext/src/index.ts"),
      "@agtn/parts": r("./modules/parts/src/index.ts"),
      "@agtn/plot": r("./modules/plot/src/index.ts"),
    },
  },
  test: {
    globals: true,
    include: [
      "core/*/src/**/*.test.ts",
      "modules/*/src/**/*.test.ts",
      "apps/desktop/src/**/*.test.ts",
    ],
  },
});
