// Sonda P-F5-01 (2): constrói calotas de revolução no próprio OCCT, confere contra a fórmula fechada,
// exporta STEP, reimporta e compara. Isola: escritor x leitor, elipse x círculo, polo x sem polo.
import { writeFileSync } from "node:fs";
const ROOT = process.argv[2];
const { OcctKernel } = await import(ROOT + "/node_modules/occt-wasm/dist/index.js");
const k = await OcctKernel.init();
const r = (x) => Math.round(x * 1000) / 1000;
const P = (x, y, z) => ({ x, y, z });

/** semi-eixo radial a (Z), axial b (X); arco de t0..t1 (0 = no costado, π/2 = no polo) */
function head(a, b, t1 = Math.PI / 2) {
  // arco do costado (0,0,a) até t1; t1<π/2 deixa um disco plano no lugar do polo
  let arc;
  if (a >= b) arc = k.makeEllipseArc(P(0, 0, 0), P(0, 1, 0), a, b, 0, t1, P(0, 0, 1));
  else arc = k.makeEllipseArc(P(0, 0, 0), P(0, -1, 0), b, a, Math.PI / 2 - t1, Math.PI / 2, P(1, 0, 0));
  const end = P(b * Math.sin(t1), 0, a * Math.cos(t1));
  const edges = [k.makeLineEdge(P(0, 0, 0), P(0, 0, a)), arc];
  if (t1 < Math.PI / 2 - 1e-12) edges.push(k.makeLineEdge(end, P(end.x, 0, 0)), k.makeLineEdge(P(end.x, 0, 0), P(0, 0, 0)));
  else edges.push(k.makeLineEdge(P(b, 0, 0), P(0, 0, 0)));
  const face = k.makeFace(k.makeWire(edges));
  return k.revolve(face, { point: P(0, 0, 0), direction: P(1, 0, 0) }, 2 * Math.PI);
}
/** volume exato do sólido de revolução de 0 a x1=b·sin t1: π∫ a²(1-x²/b²) dx */
const vExact = (a, b, t1 = Math.PI / 2) => { const x1 = b * Math.sin(t1); return Math.PI * a * a * (x1 - x1 ** 3 / (3 * b * b)); };

const cases = [
  ["elipse 2:1 (a=300,b=150) com polo", 300, 150],
  ["elipse 2:1 (a=294,b=147) com polo", 294, 147],
  ["elipse prolata (a=150,b=300) com polo", 150, 300],
  ["círculo (a=b=200) com polo", 200, 200],
  ["elipse 2:1 truncada (sem polo, t1=80°)", 300, 150, (80 * Math.PI) / 180],
];
for (const [name, a, b, t1] of cases) {
  const s = head(a, b, t1);
  const ve = vExact(a, b, t1);
  const v0 = k.getVolume(s);
  const step = k.exportStep(s);
  const back = k.importStep(step);
  const v1 = k.getVolume(back);
  const bb = k.getBoundingBox(back);
  const types = k.getSubShapes(back, "face").map((f) => k.surfaceType(f)).join(",");
  console.log(`${name}\n  exato=${r(ve)} | construído=${r(v0)} (${((v0 / ve - 1) * 100).toExponential(2)}%) válido=${k.isValid(s)}\n  STEP→OCCT=${r(v1)} (${((v1 / ve - 1) * 100).toFixed(3)}%) válido=${k.isValid(back)} xmax=${r(bb.xmax)} faces=[${types}] arestas=${k.subShapeCount(back, "edge")} (orig ${k.subShapeCount(s, "edge")})`);
  writeFileSync(`/home/claude/probe/out_${a}_${b}_${t1 ? "trunc" : "polo"}.step`, step);
}
