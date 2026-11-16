// Sonda P-F5-01: o que o OCCT entrega para cada face do vessel_revolved.step
import { readFileSync } from "node:fs";
const ROOT = process.argv[2];
const { OcctKernel } = await import(ROOT + "/node_modules/occt-wasm/dist/index.js");
const k = await OcctKernel.init();
const file = process.argv[3] ?? ROOT + "/tests/step/viewer_ref/vessel_revolved.step";
const s = k.importStep(readFileSync(file, "latin1"));
const r = (x) => Math.round(x * 1000) / 1000;
const v = (p) => `(${r(p.x)},${r(p.y)},${r(p.z)})`;
console.log("valid", k.isValid(s), "vol", r(k.getVolume(s)), "area", r(k.getSurfaceArea(s)));
const bb = k.getBoundingBox(s); console.log("bbox", JSON.stringify(bb));
for (const [i, f] of k.getSubShapes(s, "face").entries()) {
  const t = k.surfaceType(f); const uv = k.uvBounds(f);
  console.log(`face ${i}: ${t} orient=${k.shapeOrientation(f)} area=${r(k.getSurfaceArea(f))} uv=[${r(uv.uMin)},${r(uv.uMax)}]x[${r(uv.vMin)},${r(uv.vMax)}] valid=${k.isValid(f)}`);
  for (const [u, vv] of [[uv.uMin, uv.vMin], [uv.uMin, uv.vMax], [(uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2]]) console.log("   P(", r(u), r(vv), ")=", v(k.pointOnSurface(f, u, vv)));
  for (const e of k.getSubShapes(f, "edge")) {
    let cd; try { cd = k.curveData(e); } catch (x) { cd = { kind: "ERR " + x.message }; }
    console.log(`   edge ${k.curveType(e)} len=${r(k.curveLength(e))} [${r(cd.first)},${r(cd.last)}] ${cd.kind === "ellipse" ? JSON.stringify(cd) : ""}`);
  }
}
