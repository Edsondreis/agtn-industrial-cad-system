import { describe, expect, it } from "vitest";
import { SM_LAYERS } from "../output";
import { type TrayInput, solveTray } from "../tray";
import { flatEntities, flatPattern } from "./flat";
import type { SheetBaseSpec, SheetOp } from "./model";
import { solveSheet } from "./solve";
import { aba, defaults, rectBase, spec, XY } from "./testkit";
import { genericOpReason, sheetWarnings } from "./validate";

const near = (a: number, b: number, t = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(t);
const ok = (s: ReturnType<typeof solveSheet>) => {
  if (!s.ok) throw new Error(s.issues.map((i) => i.message).join("; "));
  return s;
};
const ptsKey = (pts: readonly { x: number; y: number }[]) => pts.map((p) => `${p.x.toFixed(7)},${p.y.toFixed(7)}`).sort();

describe("planificação — leitura do mesmo grafo", () => {
  it("L 50 × 30: contorno retangular 100 × 76,178318, área e perímetro exatos", () => {
    const s = ok(solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90))));
    const fp = flatPattern(s);
    expect(fp.state).toBe("valida");
    expect(fp.cut.length).toBe(1);
    expect(fp.cut[0].length).toBe(4);
    near(fp.box.maxX - fp.box.minX, 100, 1e-9);
    near(fp.box.maxY - fp.box.minY, 76.178318229, 1e-8);
    near(fp.area, 100 * 76.178318229, 1e-6);
    near(fp.cutLength, 2 * (100 + 76.178318229), 1e-8);
  });
  it("bandeja 4 abas canto aberto = contorno de solveTray (vértices, área e comprimento de corte)", () => {
    const BASE: TrayInput = { A: 535, B: 520, flanges: { S: 25.4, N: 25.4, O: 25.4, L: 25.4 }, ref: "externa", T: 3.18, R: 2, K: 0.33, corner: "aberto", overlap: "A", gap: 0 };
    for (const p of [{}, { ref: "interna" as const }, { angleDeg: 60, flanges: { S: 40, N: 30, O: 50, L: 0 } }]) {
      const inp = { ...BASE, ...p };
      const tray = solveTray(inp);
      const edges = (["L1", "L2", "L3", "L4"] as const).filter((e) => inp.flanges[({ L1: "S", L2: "L", L3: "N", L4: "O" } as const)[e]] > 0);
      const ops = edges.map((e) => aba(`A_${e}`, [["B", e]], inp.flanges[({ L1: "S", L2: "L", L3: "N", L4: "O" } as const)[e]], inp.angleDeg ?? 90, { ref: inp.ref }));
      const s = ok(solveSheet(spec(rectBase(inp.A, inp.B, { T: inp.T, R: inp.R, K: inp.K }), ...ops)));
      const fp = flatPattern(s);
      expect(fp.state).toBe("valida");
      expect(fp.cut.length).toBe(1);
      const ours = fp.cut[0].map((q) => ({ x: q.x - fp.box.minX, y: q.y - fp.box.minY }));
      expect(ptsKey(ours)).toEqual(ptsKey(tray.contour));
      near(fp.cutLength, tray.cutLength, 1e-9);
      near(fp.area, tray.area, 1e-9 * tray.area);
    }
  });
  it("dobra por linha: planificação = chapa original 100 × 60 (4 vértices)", () => {
    const op: SheetOp = { t: "linha", id: "D1", label: "Dobra_1", flange: "B", a: { x: 40, y: -10 }, b: { x: 40, y: 70 }, fixed: "esq", bend: { deflectionDeg: 120 }, side: "baixo", ref: "interna" };
    const fp = flatPattern(ok(solveSheet(spec(rectBase(100, 60), op))));
    expect(fp.state).toBe("valida");
    expect(ptsKey(fp.cut[0])).toEqual(ptsKey([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }]));
    expect(fp.bends[0].sense).toBe("BAIXO");
  });
  it("furos: posição relativa igual no plano (mesma transformação da aba)", () => {
    const cut: SheetOp = { t: "recorte", id: "R1", label: "Furo", flange: "A@B/L1", loops: [{ segs: [{ t: "circle", c: { x: 50, y: 15 }, r: 4 }] }] };
    const s = ok(solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90), cut)));
    const fp = flatPattern(s);
    const c = fp.holes[0].segs[0] as { c: { x: number; y: number } };
    // aba: origem local na ponta da faixa recuada; y local 15 → no plano: 4 − BA − (15 − 4) abaixo da aresta L1
    near(c.c.y, 4 - 4.178318229 - (15 - 4), 1e-8);
    near(c.c.x, 50, 1e-12);
    near(fp.area, s.flatArea, 1e-9);
    near(s.flatArea, 100 * 76.178318229 - Math.PI * 16, 1e-6);
  });
  it("abas válidas no 3D que se sobrepõem no plano (rasgo em U) → planificação INVÁLIDA com motivo", () => {
    const P = (x: number, y: number) => ({ x, y });
    const pts = [P(0, 0), P(100, 0), P(100, 100), P(60, 100), P(60, 50), P(40, 50), P(40, 100), P(0, 100)];
    const base: SheetBaseSpec = { id: "B", label: "Base", defaults: defaults(), plane: XY, side: "cima", holes: [], outline: pts.map((a, i) => ({ key: `L${i + 1}`, a, b: pts[(i + 1) % pts.length] })) };
    const s = ok(solveSheet(spec(base, aba("A", [["B", "L4"], ["B", "L6"]], 30, 90))));
    const fp = flatPattern(s);
    expect(fp.state).toBe("invalida");
    expect(fp.reasons[0]).toContain("Sobreposição na planificação");
    expect(fp.reasons[0]).toContain("A.1");
    expect(flatEntities(fp)).toEqual([]);
  });
  it("operação genérica depois da chapa → inválida com o nome", () => {
    const s = ok(solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90))));
    const fp = flatPattern(s, [genericOpReason(["Arredondar_1"])!]);
    expect(fp.state).toBe("invalida");
    expect(fp.reasons).toEqual(["Arredondar_1 não é operação de chapa — a planificação não representa mais o sólido."]);
  });
});

describe("planificação — entidades nas camadas existentes", () => {
  it("contorno, linhas e regiões de dobra, marcação D1 CIMA 90° RI2", () => {
    const s = ok(solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90), aba("C", [["B", "L3"]], 20, 45, { side: "baixo" }))));
    const ents = flatEntities(flatPattern(s));
    const layers = new Set(SM_LAYERS.map((l) => l.name));
    for (const e of ents) expect(layers.has(e.layer)).toBe(true);
    const by = (l: string) => ents.filter((e) => e.layer === l);
    expect(by("CONTORNO_CORTE").length).toBe(1);
    expect(by("LINHAS_DOBRA").length).toBe(2);
    expect(by("REGIAO_DOBRA").length).toBe(4);
    expect(by("MARCACAO").map((e) => (e as { value: string }).value)).toEqual(["D1 CIMA 90,0° RI2,00", "D2 BAIXO 45,0° RI2,00"]);
    // origem no canto inferior esquerdo
    const pl = by("CONTORNO_CORTE")[0] as unknown as { pts: { x: number; y: number }[] };
    near(Math.min(...pl.pts.map((p) => p.x)), 0, 1e-12);
    near(Math.min(...pl.pts.map((p) => p.y)), 0, 1e-12);
  });
  it("avisos de fabricação: R/T pequeno, K estimado", () => {
    const s = ok(solveSheet(spec(rectBase(100, 50, { R: 0.5, kSource: "estimado" }), aba("A", [["B", "L1"]], 30, 90))));
    expect(sheetWarnings(s).map((w) => w.code)).toEqual(["R_SMALL", "K_ESTIMATED"]);
  });
});
