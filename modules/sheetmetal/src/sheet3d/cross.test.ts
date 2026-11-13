import { describe, expect, it } from "vitest";
import { type BendDir, type FlangeInput, solveProfile } from "../engine";
import { flangeFaces } from "../profiles";
import { type TrayInput, type TraySide, solveTray } from "../tray";
import { apply, v3 } from "./math";
import type { BendSide, SheetOp, SheetRef } from "./model";
import { solveSheet } from "./solve";
import { aba, rectBase, spec } from "./testkit";

/**
 * Testes CRUZADOS: o grafo 3D reproduz, nos casos que eles cobrem, o motor de perfis (`solveProfile`) e a
 * bandeja (`solveTray`, que reproduz a planificação real 710.0CUH25-01-03). Mesmas entradas → mesmos números.
 */
const near = (a: number, b: number, t = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(t);

interface Seg {
  length: number;
  side: BendSide;
  theta: number;
  R: number;
  K: number;
}
const D = 50; // profundidade da base (aba 0 do perfil)
const T = 2;

function both(ref: SheetRef, segs: Seg[]) {
  const op: SheetOp = {
    t: "contorno",
    id: "C",
    label: "Flange",
    edge: { flange: "B", edge: "L1" },
    ref,
    segments: segs.map((s) => ({ length: s.length, side: s.side, bend: { deflectionDeg: s.theta, R: s.R, K: s.K } })),
  };
  const sh = solveSheet(spec(rectBase(200, D, { T }), op));
  if (!sh.ok) throw new Error(sh.issues.map((i) => i.message).join("; "));
  const dirs: BendDir[] = segs.map((s) => (s.side === "cima" ? "left" : "right"));
  const flanges: FlangeInput[] = [D, ...segs.map((s) => s.length)].map((length, i) => {
    const [face, faceEnd] = flangeFaces(ref, i, dirs);
    return { label: `F${i}`, length, face, faceEnd };
  });
  const sp = solveProfile({ T, flanges, bends: segs.map((s, j) => ({ label: `D${j + 1}`, angleDeg: s.theta, R: s.R, K: s.K, dir: dirs[j] })), startAngle: 0, partLength: 200 });
  if (!sp.ok) throw new Error(sp.issues.map((i) => i.message).join("; "));
  return { sh, sp };
}

// seção: X = D − y (da ponta livre da base para a aresta L1), Y = z − T (face A do perfil = z = T local)
const sec = (p: { y: number; z: number }) => ({ x: D - p.y, y: p.z - T });

const CASES: [string, Seg[]][] = [
  ["L", [{ length: 30, side: "cima", theta: 90, R: 2, K: 0.33 }]],
  ["U", [{ length: 40, side: "cima", theta: 90, R: 2, K: 0.33 }, { length: 30, side: "cima", theta: 90, R: 3, K: 0.4 }]],
  ["Z", [{ length: 40, side: "cima", theta: 90, R: 2, K: 0.33 }, { length: 30, side: "baixo", theta: 90, R: 1, K: 0.3 }]],
  [
    "cartola (R/K/θ diferentes por dobra)",
    [
      { length: 25, side: "baixo", theta: 60, R: 3, K: 0.42 },
      { length: 35, side: "cima", theta: 120, R: 1.5, K: 0.31 },
      { length: 45, side: "cima", theta: 45, R: 4, K: 0.36 },
      { length: 28, side: "baixo", theta: 105, R: 2.5, K: 0.45 },
    ],
  ],
];

describe("cruzado com solveProfile (flange de contorno = perfil de seção constante)", () => {
  for (const ref of ["externa", "interna"] as const)
    for (const [name, segs] of CASES)
      it(`${name} — ${ref}: linhas de dobra, desenvolvimento e seção iguais (1e-9)`, () => {
        const { sh, sp } = both(ref, segs);
        sh.bends.forEach((b, j) => {
          const r = sp.bends[j];
          near(b.BA, r.BA, 1e-12);
          near(b.OSB, r.OSB, 1e-12);
          near(b.BD, r.BD, 1e-12);
          near(D - b.flatLine[0].y, r.xLine);
          near(D - b.flatStart[0].y, r.xStart);
          near(D - b.flatEnd[0].y, r.xEnd);
          // seção: pontos de tangência nas faces A (z = T) e B (z = 0), na peça DOBRADA
          const parent = sh.flanges.find((f) => f.id === b.parent)!;
          const child = sh.flanges.find((f) => f.id === b.child)!;
          for (const [zl, tg] of [[T, sp.section!.tangentsA[j]], [0, sp.section!.tangentsB[j]]] as const) {
            const p1 = sec(apply(parent.G, v3(b.tangent[0].x, b.tangent[0].y, zl)));
            const p2 = sec(apply(child.G, v3(0, b.SB, zl)));
            near(p1.x, tg[0].x);
            near(p1.y, tg[0].y);
            near(p2.x, tg[1].x);
            near(p2.y, tg[1].y);
          }
        });
        const last = sh.flanges[sh.flanges.length - 1];
        const ponta = last.flat.find((e) => e.key === "ponta")!;
        near(D - apply(last.H, v3(ponta.a.x, ponta.a.y, 0)).y, sp.developedLength);
        // retos de cada segmento = retos do perfil
        sh.flanges.slice(1).forEach((f, i) => {
          const raiz = f.flat.find((e) => e.key === "raiz")!;
          const lado = f.flat.find((e) => e.key === "lado1")!;
          near(Math.hypot(lado.b.x - lado.a.x, lado.b.y - lado.a.y), sp.flanges[i + 1].flat);
          expect(raiz).toBeTruthy();
        });
      });
  it("autointerseção do perfil (mesma verificação do 2D) → erro", () => {
    const op: SheetOp = {
      t: "contorno",
      id: "C",
      label: "Flange",
      edge: { flange: "B", edge: "L1" },
      ref: "externa",
      segments: [
        { length: 50, side: "cima", bend: { deflectionDeg: 135 } },
        { length: 50, side: "cima", bend: { deflectionDeg: 135 } },
        { length: 50, side: "cima", bend: { deflectionDeg: 135 } },
      ],
    };
    const s = solveSheet(spec(rectBase(200, 50), op));
    expect(s.issues.filter((i) => i.level === "error").map((i) => i.code)).toEqual(["CONTOUR_SELF"]);
  });
  it("segmento mais curto que o recuo → FLANGE_SHORT do motor de perfis", () => {
    const op: SheetOp = { t: "contorno", id: "C", label: "Flange", edge: { flange: "B", edge: "L1" }, ref: "externa", segments: [{ length: 30, side: "cima", bend: { deflectionDeg: 90 } }, { length: 3, side: "cima", bend: { deflectionDeg: 90 } }] };
    const s = solveSheet(spec(rectBase(200, 50), op));
    expect(s.issues.filter((i) => i.level === "error").map((i) => i.code)).toEqual(["FLANGE_SHORT"]);
  });
});

/* ------------------------------------------------------------------------------------------- bandeja */

const SIDE_OF: Record<string, TraySide> = { L1: "S", L2: "L", L3: "N", L4: "O" };

function trayVsSheet(inp: TrayInput) {
  const tray = solveTray(inp);
  if (!tray.ok) throw new Error(tray.issues.map((i) => i.message).join("; "));
  const edges = (["L1", "L2", "L3", "L4"] as const).filter((e) => inp.flanges[SIDE_OF[e]] > 0);
  const ops = edges.map((e) => aba(`A_${e}`, [["B", e]], inp.flanges[SIDE_OF[e]], inp.angleDeg ?? 90, { ref: inp.ref }));
  const sh = solveSheet(spec(rectBase(inp.A, inp.B, { T: inp.T, R: inp.R, K: inp.K }), ...ops));
  if (!sh.ok) throw new Error(sh.issues.map((i) => i.message).join("; "));
  // caixa da planificação: todas as regiões planas e faixas de dobra
  const pts: { x: number; y: number }[] = [];
  for (const f of sh.flanges) for (const e of f.flat) pts.push(apply(f.H, v3(e.a.x, e.a.y, 0)));
  for (const b of sh.bends) pts.push(...b.flatStart, ...b.flatEnd);
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const w = Math.max(...pts.map((p) => p.x)) - minX;
  const h = Math.max(...pts.map((p) => p.y)) - minY;
  return { tray, sh, w, h, minX, minY };
}

const keyOf = (p: { x: number; y: number }) => `${p.x.toFixed(7)},${p.y.toFixed(7)}`;
const segKey = (s: readonly { x: number; y: number }[]) => [keyOf(s[0]), keyOf(s[1])].sort().join("|");

describe("cruzado com solveTray (bandeja 4 abas, canto aberto)", () => {
  const BASE: TrayInput = { A: 535, B: 520, flanges: { S: 25.4, N: 25.4, O: 25.4, L: 25.4 }, ref: "externa", T: 3.18, R: 2, K: 0.33, corner: "aberto", overlap: "A", gap: 0 };
  const cases: [string, Partial<TrayInput>][] = [
    ["710.0CUH25-01-03 (medidas reais), aberto", {}],
    ["interna", { ref: "interna" }],
    ["θ 60°", { angleDeg: 60, flanges: { S: 40, N: 40, O: 40, L: 40 } }],
    ["abas diferentes, uma borda sem aba", { flanges: { S: 40, N: 30, O: 50, L: 0 } }],
  ];
  for (const [name, p] of cases)
    it(`${name}: área, blank e linhas/regiões de dobra iguais`, () => {
      const inp = { ...BASE, ...p };
      const { tray, sh, w, h, minX, minY } = trayVsSheet(inp);
      near(sh.flatArea, tray.area, 1e-9 * tray.area);
      near(w, tray.blank.w, 1e-9);
      near(h, tray.blank.h, 1e-9);
      const ours = new Map<string, string[]>();
      for (const b of sh.bends) {
        const sh2 = (s: readonly { x: number; y: number }[]) => s.map((q) => ({ x: q.x - minX, y: q.y - minY }));
        ours.set(SIDE_OF[b.edge], [segKey(sh2(b.flatLine)), segKey(sh2(b.flatStart)), segKey(sh2(b.flatEnd))]);
      }
      for (const tb of tray.bends) expect(ours.get(tb.side)).toEqual([segKey(tb.line), segKey(tb.start), segKey(tb.end)]);
    });
  it("linhas de dobra = as do canto sobreposto real (DXF 710.0CUH25-01-03), a menos de uma translação", () => {
    const real = solveTray({ ...BASE, corner: "sobreposto" });
    const { sh } = trayVsSheet(BASE);
    const bySide = new Map(sh.bends.map((b) => [SIDE_OF[b.edge], b]));
    const t0 = real.bends[0];
    const o0 = bySide.get(t0.side)!;
    const lo = (s: readonly { x: number; y: number }[]) => (s[0].x + s[0].y <= s[1].x + s[1].y ? s[0] : s[1]);
    const dx = lo(t0.line).x - lo(o0.flatLine).x;
    const dy = lo(t0.line).y - lo(o0.flatLine).y;
    for (const tb of real.bends) {
      const ob = bySide.get(tb.side)!;
      expect(segKey(ob.flatLine.map((q) => ({ x: q.x + dx, y: q.y + dy })))).toBe(segKey(tb.line));
    }
  });
});
