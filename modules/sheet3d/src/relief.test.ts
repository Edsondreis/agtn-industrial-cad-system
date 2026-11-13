import { entitySegs, polylineSignedArea } from "@agtn/geometry";
import { type SheetOp, edgeBulge, edgeMid, flatEntities, flatPattern, solveSheet } from "@agtn/sheetgraph";
import { OcctSolidKernel } from "@agtn/solid";
import type { OcctKernel, ShapeHandle } from "occt-wasm";
import { aba, rectBase, spec } from "../../sheetmetal/src/sheet3d/testkit";
import { buildSheet } from "./build";

/** ETAPA 2.1b — alívio de dobra: geometria real no sólido e na planificação, recalculada com T/R/θ. */
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
const relief = (kind: "retangular" | "oblongo" | "lagrima", o: { gap?: number; width?: number; depth?: number; bends?: string[] } = {}): SheetOp => ({
  t: "alivio",
  id: "AL",
  label: "Alívio_1",
  bends: o.bends ?? ["A@B/L1"],
  kind,
  gap: o.gap ?? 0.5,
  ...(o.width !== undefined ? { width: o.width } : {}),
  ...(o.depth !== undefined ? { depth: o.depth } : {}),
});
const partial = (T0 = 2, R = 2, th = 90) => [rectBase(100, 50, { T: T0, R }), aba("A", [["B", "L1"]], 30, th, { o0: 20, o1: 30 })] as const;
// área removida da base, por alívio (w, d na referência do vértice virtual; SB = recuo)
const REMOVED = {
  retangular: (w: number, d: number) => w * d,
  oblongo: (w: number, d: number) => w * (d - w / 2) + (Math.PI * (w / 2) ** 2) / 2,
  lagrima: (w: number, d: number) => w * d + (3 * Math.PI * w * w) / 4,
};

describe("alívio de dobra", () => {
  for (const kind of ["retangular", "oblongo", "lagrima"] as const)
    it(`${kind} automático nas duas pontas: área exata, planificação válida, sólido OCCT = fórmula`, () => {
      const [b0, a0] = partial();
      const s = solveSheet(spec(b0, a0, relief(kind)));
      expect(codes(s)).toEqual([]);
      const r = s.bends[0].relief!;
      const SB = 4;
      near(r.w, 2 + 0.5, 1e-12); // w = T + g
      near(r.d, kind === "oblongo" ? SB + 0.5 + r.w / 2 : SB + 0.5, 1e-12); // d = SB + g (= R + T + g a 90°)
      expect(r.ends).toEqual(["inicio", "fim"]);
      near(s.flanges[0].area, 100 * 50 - SB * 50 - 2 * REMOVED[kind](r.w, r.d), 1e-9);
      expect(s.issues.some((i) => i.code === "NO_RELIEF")).toBe(false);
      const fp = flatPattern(s);
      expect(fp.state).toBe("valida");
      expect(fp.cut.length).toBe(1);
      const arcs = fp.cutBulges[0].filter((b) => b !== 0).length;
      expect(arcs).toBe(kind === "retangular" ? 0 : 2);
      near(fp.area, s.flatArea, 1e-9);
      const built = buildSheet(k, s, T);
      expect(k.isValid(built.shape)).toBe(true);
      expect(Math.abs(built.volume - s.volume) / s.volume).toBeLessThan(1e-9);
      // o alívio passa a linha de tangência por g e não invade a região de dobra (faces exatas no 3D)
      const labels = built.faceLabels.flat();
      expect(labels.some((l) => l.includes(":r0."))).toBe(true);
      expect(labels.some((l) => l.includes(":r1."))).toBe(true);
    });
  it("recalcula com T, R e θ: w = T + g e d = SB + g acompanham", () => {
    for (const [T0, R, th] of [[1.5, 1, 60], [3, 4, 120], [2, 0.5, 90]] as const) {
      const [b0, a0] = partial(T0, R, th);
      const s = solveSheet(spec(b0, a0, relief("retangular", { gap: 0.8 })));
      expect(codes(s)).toEqual([]);
      const b = s.bends[0];
      near(b.relief!.w, T0 + 0.8, 1e-12);
      near(b.relief!.d, b.SB + 0.8, 1e-12);
      const built = buildSheet(k, s, T);
      expect(Math.abs(built.volume - s.volume) / s.volume).toBeLessThan(1e-9);
    }
  });
  it("manual e erros explícitos: aba inteira, duplicado, profundidade que não passa a tangência, não cabe", () => {
    const [b0, a0] = partial();
    const man = solveSheet(spec(b0, a0, relief("retangular", { width: 3, depth: 7 })));
    expect(codes(man)).toEqual([]);
    near(man.bends[0].relief!.w, 3, 0);
    expect(codes(solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90), relief("retangular"))))).toEqual(["RELIEF_NOT_NEEDED"]);
    expect(codes(solveSheet(spec(b0, a0, relief("retangular"), { ...relief("oblongo"), id: "AL2", label: "Alívio_2" })))).toEqual(["RELIEF_DUP"]);
    expect(codes(solveSheet(spec(b0, a0, relief("retangular", { depth: 3 }))))).toEqual(["RELIEF_FIT"]);
    // recuo de 2 mm: um alívio de 2,5 mm não cabe até o canto
    expect(codes(solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90, { o0: 2, o1: 30 }), relief("retangular"))))).toEqual(["RELIEF_FIT"]);
    // lágrima precisa de profundidade maior que o bulbo
    expect(codes(solveSheet(spec(b0, a0, relief("lagrima", { width: 6 }))))).toEqual(["RELIEF_FIT"]);
  });
  it("alívio ≠ recorte: operação própria, com o bulge dos arcos correto na planificação", () => {
    const [b0, a0] = partial();
    const s = solveSheet(spec(b0, a0, relief("oblongo")));
    const e = s.flanges[0].flat.find((x) => x.arc)!;
    expect(e.key).toMatch(/:r0\.\d/);
    near(edgeBulge(e), Math.tan(e.arc!.sweep / 4), 0);
    near(Math.abs(e.arc!.sweep), Math.PI, 1e-12);
    expect(s.flanges[0].holes).toEqual([]);
  });
  it("DESENHO/DXF: o contorno com bulges reproduz os arcos exatos (mesma área e mesmos pontos médios)", () => {
    for (const kind of ["oblongo", "lagrima"] as const) {
      const [b0, a0] = partial();
      const s = solveSheet(spec(b0, a0, relief(kind)));
      const fp = flatPattern(s);
      const pl = flatEntities(fp, { notes: false })[0];
      const g = pl as unknown as { pts: { x: number; y: number }[]; bulges: number[] }; // polilinha fechada do contorno de corte
      near(Math.abs(polylineSignedArea(g.pts, g.bulges)), fp.area, 1e-9);
      const arcs = entitySegs(pl).filter((q) => q.kind === "arc");
      expect(arcs.length).toBe(2);
      const dx = fp.box.minX;
      const dy = fp.box.minY;
      const mids = s.flanges[0].flat.filter((e) => e.arc).map(edgeMid);
      for (const a of arcs) {
        if (a.kind !== "arc") continue;
        const m = { x: a.c.x + a.r * Math.cos(a.a0 + a.sweep / 2) + dx, y: a.c.y + a.r * Math.sin(a.a0 + a.sweep / 2) + dy };
        expect(mids.some((q) => Math.hypot(q.x - m.x, q.y - m.y) < 1e-9)).toBe(true);
      }
    }
  });
});
