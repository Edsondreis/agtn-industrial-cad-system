import { flatPattern, solveSheet } from "@agtn/sheetgraph";
import { OcctSolidKernel } from "@agtn/solid";
import type { OcctKernel, ShapeHandle } from "occt-wasm";
import { aba, rectBase, spec } from "../../sheetmetal/src/sheet3d/testkit";
import { buildSheet } from "./build";

/** ETAPA 2.1a — faixa de dobra parcial (recuos no início e no fim), no grafo, no OCCT e na planificação. */
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
const codes = (s: ReturnType<typeof solveSheet>) => s.issues.filter((i) => i.level === "error").map((i) => i.code);
const BA = (Math.PI / 2) * (2 + 0.33 * 2);

describe("faixa parcial (recuos)", () => {
  it("aba de 50 mm no meio da aresta de 100: áreas, planificação e sólido exatos", () => {
    const s = solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90, { o0: 20, o1: 30 })));
    expect(codes(s)).toEqual([]);
    const b = s.bends[0];
    near(b.L, 50, 1e-12);
    near(b.tangent[0].x, 20, 1e-12);
    near(b.tangent[1].x, 70, 1e-12);
    // base: 100 × 50 menos o recuo SB = 4 só no trecho da faixa
    near(s.flanges[0].area, 100 * 50 - 4 * 50, 1e-9);
    near(s.flanges[1].area, 26 * 50, 1e-9);
    near(s.flatArea, 4800 + 1300 + BA * 50, 1e-9);
    expect(s.flanges[0].flat.map((e) => e.key)).toEqual(["L1", "L1^1:p0", "L1^1", "L1^1:p1", "L1", "L2", "L3", "L4"]);
    expect(s.issues.some((i) => i.code === "NO_RELIEF")).toBe(true);
    const fp = flatPattern(s);
    expect(fp.state).toBe("valida");
    expect(fp.cut.length).toBe(1);
    const built = buildSheet(k, s, T);
    expect(Math.abs(built.volume - s.volume) / s.volume).toBeLessThan(1e-9);
    expect(k.isValid(built.shape)).toBe(true);
  });
  it("duas faixas parciais na mesma aresta (sem sobrepor) e erros: sobreposição, recuos grandes demais", () => {
    const ok = solveSheet(spec(rectBase(200, 50), aba("A", [["B", "L1"]], 30, 90, { o0: 10, o1: 120 }), aba("C", [["B", "L1"]], 20, 90, { o0: 110, o1: 10 })));
    expect(codes(ok)).toEqual([]);
    expect(ok.bends.map((b) => b.L)).toEqual([70, 80]);
    const built = buildSheet(k, ok, T);
    expect(Math.abs(built.volume - ok.volume) / ok.volume).toBeLessThan(1e-9);
    expect(flatPattern(ok).state).toBe("valida");
    expect(codes(solveSheet(spec(rectBase(200, 50), aba("A", [["B", "L1"]], 30, 90, { o0: 10, o1: 80 }), aba("C", [["B", "L1"]], 20, 90, { o0: 100, o1: 10 }))))).toEqual(["SPAN_OVERLAP"]);
    expect(codes(solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90, { o0: 60, o1: 40 }))))).toEqual(["SPAN_SHORT"]);
    // aba inteira já ocupa a aresta: parcial não entra
    expect(codes(solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90), aba("C", [["B", "L1"]], 20, 90, { o0: 10, o1: 10 }))))).toEqual(["EDGE_USED"]);
  });
  it("recuo menor que o recuo da aba vizinha → erro explícito (não estica nem corta em silêncio)", () => {
    const s = solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L4"]], 30, 90), aba("C", [["B", "L1"]], 20, 90, { o0: 2, o1: 20 })));
    expect(codes(s)).toEqual(["FLANGE_SMALL"]);
  });
  it("paramétrico: T, R e θ mudam e a faixa continua no mesmo trecho [20, 70]", () => {
    for (const [T0, R, th] of [[1, 1, 45], [3, 5, 120], [2, 0.5, 90]] as const) {
      const s = solveSheet(spec(rectBase(100, 50, { T: T0, R }), aba("A", [["B", "L1"]], 30, th, { o0: 20, o1: 30 })));
      expect(codes(s)).toEqual([]);
      near(s.bends[0].tangent[0].x, 20, 1e-12);
      near(s.bends[0].tangent[1].x, 70, 1e-12);
      const built = buildSheet(k, s, T);
      expect(Math.abs(built.volume - s.volume) / s.volume).toBeLessThan(1e-9);
    }
  });
});
