import { type Loop2, type SheetOp, type SheetSolved, bendFlatArea, bendVolume, flatPattern, solveSheet } from "@agtn/sheetgraph";
import { OcctSolidKernel } from "@agtn/solid";
import type { OcctKernel, ShapeHandle } from "occt-wasm";
import { aba, rectBase, spec } from "../../sheetmetal/src/sheet3d/testkit";
import { buildSheet } from "./build";

/**
 * ETAPA 2.4 — recortes que atravessam dobras, definidos na planificação. Na faixa: φ = s / (R + K·T) (fibra
 * neutra), revolução parcial exata. Volume = Σ A·T + Σ fatias; OCCT confere volume, superfícies e validade.
 */
let S: OcctSolidKernel;
let k: OcctKernel;
const tmp: ShapeHandle[] = [];
const T = <H extends ShapeHandle>(h: H): H => (tmp.push(h), h);
beforeAll(async () => {
  S = await OcctSolidKernel.create();
  k = S.raw;
});
afterEach(() => {
  for (const h of tmp.splice(0))
    try {
      k.release(h);
    } catch {
      /* */
    }
});
afterAll(() => S.dispose());
const near = (a: number, b: number, t = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(t);
const codes = (s: SheetSolved) => s.issues.filter((i) => i.level === "error").map((i) => i.code);
const BA = (Math.PI / 2) * (2 + 0.33 * 2);
const rect = (x0: number, y0: number, x1: number, y1: number, key = "r"): Loop2 => ({
  key,
  segs: [
    { t: "line", a: { x: x0, y: y0 }, b: { x: x1, y: y0 } },
    { t: "line", a: { x: x1, y: y0 }, b: { x: x1, y: y1 } },
    { t: "line", a: { x: x1, y: y1 }, b: { x: x0, y: y1 } },
    { t: "line", a: { x: x0, y: y1 }, b: { x: x0, y: y0 } },
  ],
});
/** oblongo vertical (lados retos x = cx ± w/2 entre y0 e y1, semicírculos fora) */
const slot = (cx: number, w: number, y0: number, y1: number): Loop2 => {
  const r = w / 2;
  return {
    key: "o",
    segs: [
      { t: "arc", c: { x: cx, y: y0 }, r, a: { x: cx - r, y: y0 }, b: { x: cx + r, y: y0 }, sweep: Math.PI },
      { t: "line", a: { x: cx + r, y: y0 }, b: { x: cx + r, y: y1 } },
      { t: "arc", c: { x: cx, y: y1 }, r, a: { x: cx + r, y: y1 }, b: { x: cx - r, y: y1 }, sweep: Math.PI },
      { t: "line", a: { x: cx - r, y: y1 }, b: { x: cx - r, y: y0 } },
    ],
  };
};
const cut = (...loops: Loop2[]): SheetOp => ({ t: "recorte_plano", id: "RP", label: "RecortePlano_1", loops });
const L = () => [rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90)] as const;
const occt = (s: SheetSolved) => {
  const fp = flatPattern(s);
  expect(fp.state).toBe("valida");
  near(fp.area, s.flatArea, 1e-9);
  const built = buildSheet(k, s, T);
  expect(k.isValid(built.shape)).toBe(true);
  expect(Math.abs(built.volume - s.volume) / s.volume).toBeLessThan(1e-9);
  return { fp, built };
};

describe("recorte na planificação atravessando dobra", () => {
  it("rasgo retangular base → faixa → aba: áreas exatas, faixa em 2 fatias, sólido OCCT = fórmula", () => {
    const [b, a] = L();
    const s = solveSheet(spec(b, a, cut(rect(40, -5, 60, 10))));
    expect(codes(s)).toEqual([]);
    near(s.flanges[0].area, 4600 - 20 * 6, 1e-9);
    near(s.flanges[1].area, 2600 - 20 * (9 - BA), 1e-9);
    const bd = s.bends[0];
    expect(bd.cut!.slabs.map((q) => [q.u0, q.u1, q.mat.length])).toEqual([[0, 40, 1], [40, 60, 0], [60, 100, 1]]);
    near(bendFlatArea(bd), 80 * BA, 1e-9);
    near(bendVolume(bd, 2), (Math.PI / 2) * 2 * 3 * 80, 1e-9);
    const { fp } = occt(s);
    expect(fp.cut.length).toBe(2); // contorno externo + o rasgo
  });
  it("janela só dentro da faixa: duas paredes radiais em φ = s/(R + K·T) — conferidas pela proveniência no OCCT", () => {
    const [b, a] = L();
    const s = solveSheet(spec(b, a, cut(rect(30, 4 - 0.75 * BA, 70, 4 - 0.25 * BA))));
    expect(codes(s)).toEqual([]);
    near(s.flanges[0].area, 4600, 1e-9);
    const q = s.bends[0].cut!.slabs.find((x) => x.u0 === 30)!;
    expect(q.mat.length).toBe(2);
    near(q.mat[0][1], 0.25 * BA, 1e-9);
    near(q.mat[1][0], 0.75 * BA, 1e-9);
    const { built } = occt(s);
    const labels = built.faceLabels.flat();
    expect(labels.filter((l) => /\/s:\d$/.test(l)).length).toBe(2);
  });
  it("oblongo alinhado: arcos nas regiões planas, lados retos cruzando a faixa — exato", () => {
    const [b, a] = L();
    const s = solveSheet(spec(b, a, cut(slot(50, 8, -6, 12))));
    expect(codes(s)).toEqual([]);
    occt(s);
  });
  it("vários recortes e T/R mudando: recalculado do histórico", () => {
    for (const [T0, R] of [[2, 2], [3, 1], [1.5, 3]] as const) {
      const s = solveSheet(spec(rectBase(100, 50, { T: T0, R }), aba("A", [["B", "L1"]], 30, 90), cut(rect(10, -4, 20, 9, "a"), rect(70, -4, 85, 9, "b"))));
      expect(codes(s)).toEqual([]);
      occt(s);
    }
  });
  it("bloqueios explícitos: círculo, arco na faixa, lado oblíquo, borda externa, ponta da faixa, divide a região", () => {
    const [b, a] = L();
    const circ: Loop2 = { key: "c", segs: [{ t: "circle", c: { x: 50, y: 3 }, r: 4 }] };
    expect(codes(solveSheet(spec(b, a, cut(circ))))).toEqual(["CUT_CIRCLE_BEND"]);
    expect(codes(solveSheet(spec(b, a, cut(slot(50, 8, 3, 15)))))).toEqual(["CUT2_ARC"]);
    const obl: Loop2 = { key: "t", segs: [{ t: "line", a: { x: 40, y: -5 }, b: { x: 60, y: -5 } }, { t: "line", a: { x: 60, y: -5 }, b: { x: 65, y: 10 } }, { t: "line", a: { x: 65, y: 10 }, b: { x: 40, y: 10 } }, { t: "line", a: { x: 40, y: 10 }, b: { x: 40, y: -5 } }] };
    expect(codes(solveSheet(spec(b, a, cut(obl))))).toEqual(["CUT2_OBLIQUE"]);
    expect(codes(solveSheet(spec(b, a, cut(rect(40, 30, 60, 60)))))).toEqual(["CUT2_EDGE"]);
    expect(codes(solveSheet(spec(b, a, cut(rect(-5, -5, 10, 10)))))).toEqual(["CUT2_EDGE"]);
    // aba também na L3: rasgo de faixa a faixa atravessando a base inteira → dividiria a base
    const two = solveSheet(spec(b, a, aba("C", [["B", "L3"]], 30, 90), cut(rect(40, -5, 60, 55))));
    expect(codes(two)).toEqual(["CUT2_SPLIT"]);
  });
  it("furo inteiro numa região plana pelo recorte na planificação = furo comum", () => {
    const [b, a] = L();
    const s = solveSheet(spec(b, a, cut({ key: "c", segs: [{ t: "circle", c: { x: 50, y: 30 }, r: 5 }] })));
    expect(codes(s)).toEqual([]);
    near(s.flanges[0].area, 4600 - Math.PI * 25, 1e-9);
    occt(s);
  });
});
