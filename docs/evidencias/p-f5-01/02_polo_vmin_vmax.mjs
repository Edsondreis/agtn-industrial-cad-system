// Sonda P-F5-01 (3): mesma geometria, só muda o SENTIDO do parâmetro da geratriz (polo em vmin x vmax)
const ROOT = process.argv[2];
const { OcctKernel } = await import(ROOT + "/node_modules/occt-wasm/dist/index.js");
const k = await OcctKernel.init();
const r = (x) => Math.round(x * 1000) / 1000;
const P = (x, y, z) => ({ x, y, z });
function solid(arc, a, b) {
  const face = k.makeFace(k.makeWire([k.makeLineEdge(P(0, 0, 0), P(0, 0, a)), arc, k.makeLineEdge(P(b, 0, 0), P(0, 0, 0))]));
  return k.revolve(face, { point: P(0, 0, 0), direction: P(1, 0, 0) }, 2 * Math.PI);
}
for (const [a, b] of [[300, 150], [200, 200], [500, 125]]) {
  const ve = (2 / 3) * Math.PI * a * a * b;
  // normal +Y, xDir Z: t=0 costado, t=π/2 polo  → polo em vmax
  const fim = solid(k.makeEllipseArc(P(0, 0, 0), P(0, 1, 0), a, b, 0, Math.PI / 2, P(0, 0, 1)), a, b);
  // normal −Y, xDir Z: t=−π/2 polo, t=0 costado  → polo em vmin
  const ini = solid(k.makeEllipseArc(P(0, 0, 0), P(0, -1, 0), a, b, -Math.PI / 2, 0, P(0, 0, 1)), a, b);
  for (const [nome, s] of [["polo em vmax", fim], ["polo em vmin", ini]]) {
    const f = k.getSubShapes(s, "face").find((x) => k.surfaceType(x) === "revolution");
    const uv = k.uvBounds(f);
    const back = k.importStep(k.exportStep(s));
    console.log(`a=${a} b=${b} ${nome}: v=[${r(uv.vMin)},${r(uv.vMax)}] construído ${r(k.getVolume(s) / ve)} | STEP→OCCT ${r(k.getVolume(back) / ve)} válido=${k.isValid(back)}`);
  }
}
