import { readFileSync } from "node:fs";
const ROOT = process.argv[2];
const { OcctKernel } = await import(ROOT + "/node_modules/occt-wasm/dist/index.js");
const k = await OcctKernel.init();
for (const f of process.argv.slice(3)) {
  const s = k.importStep(readFileSync(f, "latin1"));
  let worst = 0, n = 0; const t0 = performance.now();
  for (const face of k.getSubShapes(s, "face")) {
    for (const e of k.getSubShapes(face, "edge")) {
      let cd; try { cd = k.curveData(e); } catch { continue; }
      if (!(cd.last > cd.first)) continue;
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const p = k.curvePointAtParam(e, cd.first + t * (cd.last - cd.first));
        const vtx = k.makeVertex(p.x,p.y,p.z); const d = k.distanceBetween(vtx, face); k.release(vtx); n++;
        worst = Math.max(worst, d);
      }
    }
  }
  console.log(f.split("/").pop(), "valid", k.isValid(s), "vol", Math.round(k.getVolume(s)), "desvio máx aresta→face", worst.toExponential(3), "mm em", n, "pontos,", Math.round(performance.now() - t0), "ms");
}
