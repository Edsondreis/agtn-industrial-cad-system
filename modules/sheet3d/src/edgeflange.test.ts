import { type SheetBaseSpec, type SheetOp, type SheetSolved, flatPattern, setbackFor, solveSheet } from "@agtn/sheetgraph";
import { OcctSolidKernel } from "@agtn/solid";
import type { OcctKernel, ShapeHandle } from "occt-wasm";
import { type TrayInput, solveTray } from "../../sheetmetal/src/tray";
import { XY, aba, defaults, rectBase, spec } from "../../sheetmetal/src/sheet3d/testkit";
import { buildSheet } from "./build";

/**
 * ETAPA 2.2 — aba de borda: posição do material (δ = 0 / T / SB), várias arestas, detecção de canto.
 * Prova principal: δ > 0 é EXATAMENTE a mesma peça que a base estendida por δ com a aba "por dentro".
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
/** retângulo [x0,x1] × [y0,y1] com as mesmas chaves L1…L4 */
const rectAt = (x0: number, y0: number, x1: number, y1: number, T0 = 2, R = 2): SheetBaseSpec => ({
  id: "B",
  label: "Base",
  defaults: defaults({ T: T0, R }),
  plane: XY,
  side: "cima",
  outline: [
    { key: "L1", a: { x: x0, y: y0 }, b: { x: x1, y: y0 } },
    { key: "L2", a: { x: x1, y: y0 }, b: { x: x1, y: y1 } },
    { key: "L3", a: { x: x1, y: y1 }, b: { x: x0, y: y1 } },
    { key: "L4", a: { x: x0, y: y1 }, b: { x: x0, y: y0 } },
  ],
  holes: [],
});
const same = (a: SheetSolved, b: SheetSolved) => {
  near(a.volume, b.volume, 1e-9 * b.volume);
  near(a.flatArea, b.flatArea, 1e-9 * b.flatArea);
  expect(a.bends.length).toBe(b.bends.length);
  a.bends.forEach((x, i) => {
    const y = b.bends[i];
    near(x.L, y.L, 1e-9);
    for (const [p, q] of [...x.flatLine.map((p, j) => [p, y.flatLine[j]]), ...x.flatStart.map((p, j) => [p, y.flatStart[j]]), ...x.tangent.map((p, j) => [p, y.tangent[j]])]) {
      near(p.x, q.x, 1e-9);
      near(p.y, q.y, 1e-9);
    }
  });
  a.flanges.forEach((f, i) => near(f.area, b.flanges[i].area, 1e-9));
};

describe("aba de borda — posição do material", () => {
  const cases: [string, number, number, number, "externa" | "interna"][] = [
    ["90° externa", 2, 2, 90, "externa"],
    ["60° interna", 3, 1.5, 60, "interna"],
    ["120° externa", 1.5, 4, 120, "externa"],
    ["30° externa (SB < T)", 2, 2, 30, "externa"],
  ];
  for (const [name, T0, R, th, ref] of cases) {
    it(`${name}: δ = T e δ = SB são a base estendida por δ (grafo, planificação e OCCT)`, () => {
      const SB = setbackFor(ref, th, R, T0);
      for (const [pos, delta] of [["fora", T0], ["dobra_fora", SB]] as const) {
        const a = solveSheet(spec(rectBase(100, 50, { T: T0, R }), aba("A", [["B", "L1"]], 30, th, { ref, pos })));
        const b = solveSheet(spec(rectAt(0, -delta, 100, 50, T0, R), aba("A", [["B", "L1"]], 30, th, { ref })));
        expect(codes(a)).toEqual([]);
        same(a, b);
        expect(a.bends[0].position).toBe(pos);
        near(a.bends[0].delta, delta, 1e-12);
        // linha de tangência da pai em y = SB − δ (para dentro; dobra por fora: na própria aresta; < 0 = para fora)
        near(a.bends[0].tangent[0].y, SB - delta, 1e-9);
        expect(flatPattern(a).state).toBe("valida");
        const built = buildSheet(k, a, T);
        expect(k.isValid(built.shape)).toBe(true);
        expect(Math.abs(built.volume - a.volume) / a.volume).toBeLessThan(1e-9);
      }
    });
  }
  it("δ = 0 (dentro) é a ETAPA 1 sem mudança alguma", () => {
    const a = solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90, { pos: "dentro" })));
    const b = solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90)));
    same(a, b);
    expect(a.bends[0].delta).toBe(0);
  });
  it("faixa parcial com material por fora: degrau para fora, sem ponta interna (sem aviso de rasgo, alívio recusado)", () => {
    const s = solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90, { o0: 20, o1: 30, pos: "dobra_fora" })));
    expect(codes(s)).toEqual([]);
    expect(s.bends[0].partial).toBe(false);
    expect(s.issues.some((i) => i.code === "NO_RELIEF")).toBe(false);
    near(s.flanges[0].area, 5000, 1e-9); // a base não perde nada; a faixa nasce na aresta
    const rel: SheetOp = { t: "alivio", id: "AL", label: "Alívio_1", bends: [s.bends[0].id], kind: "retangular", gap: 0.5 };
    const r = solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90, { o0: 20, o1: 30, pos: "dobra_fora" }), rel));
    expect(codes(r)).toEqual(["RELIEF_NOT_NEEDED"]);
    expect(r.issues.find((i) => i.code === "RELIEF_NOT_NEEDED")!.message).toMatch(/não recua a aba-pai/);
    // material por fora a 90°: recua R (> 0) — ainda há ponta interna, o alívio vale com d = R + g
    const f = solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90, { o0: 20, o1: 30, pos: "fora" }), rel));
    expect(codes(f)).toEqual([]);
    near(f.bends[0].relief!.d, 2 + 0.5, 1e-12);
    const built = buildSheet(k, f, T);
    expect(Math.abs(built.volume - f.volume) / f.volume).toBeLessThan(1e-9);
  });
  it("posição desconhecida → erro explícito", () => {
    const op = { ...aba("A", [["B", "L1"]], 30, 90), position: "meio" } as unknown as SheetOp;
    expect(codes(solveSheet(spec(rectBase(100, 50), op)))).toEqual(["POSITION"]);
  });
});

describe("aba de borda — várias arestas e cantos", () => {
  it("duas arestas vizinhas na mesma operação: canto detectado (aberto, 90°), sem interferência", () => {
    const s = solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"], ["B", "L2"]], 30, 90)));
    expect(codes(s)).toEqual([]);
    expect(s.corners).toHaveLength(1);
    const c = s.corners![0];
    expect(c.id).toBe("A@B/L1+A@B/L2");
    expect(c.kind).toBe("aberto");
    near(c.angleDeg, 90, 1e-9);
    near(c.at.x, 96, 1e-9); // vértice das duas linhas de tangência (SB = 4)
    near(c.at.y, 4, 1e-9);
    const built = buildSheet(k, s, T);
    expect(Math.abs(built.volume - s.volume) / s.volume).toBeLessThan(1e-9);
  });
  it("quatro arestas em operações separadas: 4 cantos; recuo no canto desfaz o canto", () => {
    const four = solveSheet(spec(rectBase(100, 50), aba("S", [["B", "L1"]], 30, 90), aba("L", [["B", "L2"]], 30, 90), aba("N", [["B", "L3"]], 30, 90), aba("O", [["B", "L4"]], 30, 90)));
    expect(codes(four)).toEqual([]);
    expect(four.corners!.map((c) => c.id)).toEqual(["S@B/L1+L@B/L2", "L@B/L2+N@B/L3", "N@B/L3+O@B/L4", "O@B/L4+S@B/L1"]);
    const rec = solveSheet(spec(rectBase(100, 50), aba("S", [["B", "L1"]], 30, 90, { o1: 10 }), aba("L", [["B", "L2"]], 30, 90)));
    expect(rec.corners).toEqual([]);
  });
  it("canto de base não retangular: ângulo interno do vértice", () => {
    const tri: SheetBaseSpec = { ...rectAt(0, 0, 1, 1), outline: [{ key: "L1", a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, { key: "L2", a: { x: 100, y: 0 }, b: { x: 30, y: 80 } }, { key: "L3", a: { x: 30, y: 80 }, b: { x: 0, y: 0 } }] };
    const s = solveSheet(spec(tri, aba("A", [["B", "L1"], ["B", "L2"]], 20, 90)));
    expect(codes(s)).toEqual([]);
    near(s.corners![0].angleDeg, (Math.atan2(80, 70) * 180) / Math.PI, 1e-9);
  });
});

describe("cruzado com solveTray: 4 abas com material por fora = bandeja (A + 2T) × (B + 2T)", () => {
  const BASE: TrayInput = { A: 535, B: 520, flanges: { S: 25.4, N: 25.4, O: 25.4, L: 25.4 }, ref: "externa", T: 3.18, R: 2, K: 0.33, corner: "aberto", overlap: "A", gap: 0 };
  for (const [name, p] of [
    ["710.0CUH25-01-03, 90°", {}],
    ["θ 60°, abas 40", { angleDeg: 60, flanges: { S: 40, N: 40, O: 40, L: 40 } }],
  ] as [string, Partial<TrayInput>][])
    it(`${name}: área, blank e linhas de dobra`, () => {
      const inp = { ...BASE, ...p };
      const Tt = inp.T;
      const tray = solveTray({ ...inp, A: inp.A + 2 * Tt, B: inp.B + 2 * Tt });
      expect(tray.ok).toBe(true);
      const th = inp.angleDeg ?? 90;
      const edges = ["L1", "L2", "L3", "L4"] as const;
      const ops = edges.map((e) => aba(`A_${e}`, [["B", e]], inp.flanges.S, th, { pos: "fora" }));
      const sh = solveSheet(spec(rectBase(inp.A, inp.B, { T: Tt, R: inp.R, K: inp.K }), ...ops));
      expect(codes(sh)).toEqual([]);
      near(sh.flatArea, tray.area, 1e-9 * tray.area);
      const fp = flatPattern(sh);
      expect(fp.state).toBe("valida");
      near(fp.box.maxX - fp.box.minX, tray.blank.w, 1e-9);
      near(fp.box.maxY - fp.box.minY, tray.blank.h, 1e-9);
      expect(sh.corners).toHaveLength(4);
      // linhas e limites de dobra = os da bandeja (mesma origem: canto inferior esquerdo do blank)
      const SIDE_OF: Record<string, string> = { L1: "S", L2: "L", L3: "N", L4: "O" };
      const key = (seg: readonly { x: number; y: number }[], dx = 0, dy = 0) =>
        seg.map((q) => `${(q.x - dx).toFixed(7)},${(q.y - dy).toFixed(7)}`).sort().join("|");
      for (const tb of tray.bends) {
        const b = sh.bends.find((x) => SIDE_OF[x.edge] === tb.side)!;
        expect([key(b.flatLine, fp.box.minX, fp.box.minY), key(b.flatStart, fp.box.minX, fp.box.minY), key(b.flatEnd, fp.box.minX, fp.box.minY)]).toEqual([key(tb.line), key(tb.start), key(tb.end)]);
      }
    });
});
