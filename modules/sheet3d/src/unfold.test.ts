import { type Loop2, type SheetOp, type SheetSolved, flatPattern, sheetMath as M, solveSheet } from "@agtn/sheetgraph";
import { OcctSolidKernel } from "@agtn/solid";
import type { OcctKernel, ShapeHandle } from "occt-wasm";
import { aba, rectBase, spec } from "../../sheetmetal/src/sheet3d/testkit";
import { buildSheet } from "./build";

/**
 * ETAPA 2.5 — desdobrar / redobrar. Separação exigida: θ nominal (não muda) · θ efetivo (0 desdobrada) · BA
 * original (conservado: a região fica plana BA × L × T) · estado. Redobrar recupera a geometria nominal EXATA
 * (tudo é recalculado do histórico — nada acumula).
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
const un = (bends: string[] = [], id = "UN"): SheetOp => ({ t: "desdobrar", id, label: `Desdobrar ${id}`, bends });
const re = (bends: string[] = [], id = "RE"): SheetOp => ({ t: "redobrar", id, label: `Redobrar ${id}`, bends });
const D1 = "A@B/L1";
const D2 = "P@A@B/L1/ponta";
const D3 = "C@B/L3";
/** U com pestana: base 100 × 50, abas em L1 e L3, pestana na ponta da aba de L1 */
const U = (th = 90, T0 = 2, R = 2) => [rectBase(100, 50, { T: T0, R }), aba("A", [["B", "L1"]], 30, th), aba("P", [[D1, "ponta"]], 12, th), aba("C", [["B", "L3"]], 30, th)] as const;
const occt = (s: SheetSolved) => {
  expect(codes(s)).toEqual([]);
  const built = buildSheet(k, s, T);
  expect(k.isValid(built.shape)).toBe(true);
  expect(Math.abs(built.volume - s.volume) / s.volume).toBeLessThan(1e-9);
  return built;
};
const sameG = (a: SheetSolved, b: SheetSolved) => {
  expect(a.flanges.map((f) => f.id)).toEqual(b.flanges.map((f) => f.id));
  a.flanges.forEach((f, i) => f.G.forEach((v, j) => near(v, b.flanges[i].G[j], 1e-12)));
  a.flanges.forEach((f, i) => near(f.area, b.flanges[i].area, 1e-12));
  near(a.volume, b.volume, 1e-9 * b.volume);
  near(a.flatArea, b.flatArea, 1e-12 * b.flatArea);
};
const rect = (x0: number, y0: number, x1: number, y1: number, key = "r"): Loop2 => ({
  key,
  segs: [
    { t: "line", a: { x: x0, y: y0 }, b: { x: x1, y: y0 } },
    { t: "line", a: { x: x1, y: y0 }, b: { x: x1, y: y1 } },
    { t: "line", a: { x: x1, y: y1 }, b: { x: x0, y: y1 } },
    { t: "line", a: { x: x0, y: y1 }, b: { x: x0, y: y0 } },
  ],
});

describe("desdobrar / redobrar", () => {
  it("desdobrar tudo: cada aba vai para a posição da planificação; região plana BA × L × T; sólido = planificação", () => {
    const s = solveSheet(spec(...U(), un()));
    const built = occt(s);
    expect(s.bends.every((b) => !b.folded && b.effectiveDeg === 0 && b.deflectionDeg === 90)).toBe(true);
    const G0 = s.flanges[0].G;
    for (const f of s.flanges)
      for (const e of f.flat) {
        const w = M.apply(f.G, M.v3(e.a.x, e.a.y, 0));
        const q = M.apply2(f.H, e.a);
        const ref = M.apply(G0, M.v3(q.x, q.y, 0));
        near(M.len3(M.sub3(w, ref)), 0, 1e-9);
      }
    near(s.volume, s.flatArea * 2, 1e-9 * s.volume); // tudo plano: V = T × área da planificação
    const bb = k.getBoundingBox(built.shape);
    near(bb.zmin, 0, 1e-6);
    near(bb.zmax, 2, 1e-6);
    const fp = flatPattern(s);
    near(bb.xmax - bb.xmin, fp.box.maxX - fp.box.minX, 1e-6);
    near(bb.ymax - bb.ymin, fp.box.maxY - fp.box.minY, 1e-6);
  });
  it("BA conservado: a filha desdobrada fica a BA da tangência da pai (não colapsa com θ = 0)", () => {
    const s = solveSheet(spec(...U(), un([D1])));
    occt(s);
    const b = s.bends.find((x) => x.id === D1)!;
    const pf = s.flanges.find((f) => f.id === b.parent)!;
    const cf = s.flanges.find((f) => f.id === b.child)!;
    const p0 = M.apply(pf.G, M.v3(b.tangent[1].x, b.tangent[1].y, 0));
    const p1 = M.apply(cf.G, M.v3(0, b.SB, 0)); // início da região plana da filha (x = 0 ↔ B)
    near(M.len3(M.sub3(p1, p0)), b.BA, 1e-9);
    // a pestana (D2) continua dobrada em relação à aba desdobrada
    expect(s.bends.find((x) => x.id === D2)!.folded).toBe(true);
  });
  it("redobrar recupera a geometria nominal EXATA (várias dobras, ordens diferentes)", () => {
    const ref = solveSheet(spec(...U()));
    for (const ops of [
      [un(), re()],
      [un([D1]), re([D1])],
      [un([D1, D3]), re([D3], "R1"), re([D1], "R2")],
      [un([D2]), un([D1], "U2"), re([D1, D2])],
    ]) {
      const s = solveSheet(spec(...U(), ...ops));
      sameG(s, ref);
      expect(s.bends.every((b) => b.folded)).toBe(true);
    }
    const a = occt(ref);
    const b = occt(solveSheet(spec(...U(), un(), re())));
    expect(b.faceLabels.map((l) => l.join("|")).sort()).toEqual(a.faceLabels.map((l) => l.join("|")).sort());
  });
  it("recortes feitos desdobrado voltam com a aba (furo na aba e recorte plano atravessando a dobra)", () => {
    const hole: SheetOp = { t: "recorte", id: "H", label: "Recorte_1", flange: D1, loops: [rect(20, 10, 30, 20, "h")] };
    const fc: SheetOp = { t: "recorte_plano", id: "RP", label: "RecortePlano_1", loops: [rect(40, -5, 60, 10)] };
    const folded = solveSheet(spec(...U(), hole, fc));
    const during = solveSheet(spec(...U(), un([D1]), hole, fc));
    occt(during); // recorte na região de dobra plana (fatias de prisma)
    const back = solveSheet(spec(...U(), un([D1]), hole, fc, re([D1])));
    sameG(back, folded);
    occt(back);
  });
  it("mudar θ, T ou R depois: desdobrada usa o BA do NOVO nominal; redobrada = peça nova sem acúmulo", () => {
    for (const [th, T0, R] of [[60, 2, 2], [120, 3, 1.5], [45, 1.5, 4]] as const) {
      const ref = solveSheet(spec(...U(th, T0, R)));
      const s = solveSheet(spec(...U(th, T0, R), un([D1])));
      occt(s);
      const b = s.bends.find((x) => x.id === D1)!;
      near(b.BA, ((th * Math.PI) / 180) * (R + 0.33 * T0), 1e-12);
      sameG(solveSheet(spec(...U(th, T0, R), un([D1]), re([D1]))), ref);
    }
  });
  it("canto fechado não muda ao desdobrar (definido pela geometria nominal)", () => {
    const base = [rectBase(100, 50), aba("S", [["B", "L1"]], 30, 90), aba("L", [["B", "L2"]], 30, 90)] as const;
    const ct: SheetOp = { t: "canto", id: "CT", label: "Canto_1", corners: ["S@B/L1+L@B/L2"], kind: "encosto", gap: 0.5, closer: "a" };
    const a = solveSheet(spec(...base, ct));
    const b = solveSheet(spec(...base, ct, un(["S@B/L1"])));
    a.flanges.forEach((f, i) => near(f.area, b.flanges[i].area, 1e-12));
    occt(b);
  });
  it("erros explícitos", () => {
    expect(codes(solveSheet(spec(...U(), re([D1]))))).toEqual(["REFOLD_FOLDED"]);
    expect(codes(solveSheet(spec(...U(), un([D1]), un([D1], "U2"))))).toEqual(["UNFOLD_TWICE"]);
    expect(codes(solveSheet(spec(...U(), re())))).toEqual(["REFOLD_NONE"]);
    expect(codes(solveSheet(spec(...U(), un(["X@B/L9"]))))).toEqual(["REF_LOST"]);
  });
});
