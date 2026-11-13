import { type CornerKind, type SheetOp, type SheetSolved, flatPattern, solveSheet } from "@agtn/sheetgraph";
import { OcctSolidKernel } from "@agtn/solid";
import type { OcctKernel, ShapeHandle } from "occt-wasm";
import { type TrayInput, solveTray } from "../../sheetmetal/src/tray";
import { aba, rectBase, spec } from "../../sheetmetal/src/sheet3d/testkit";
import { buildSheet } from "./build";

/**
 * ETAPA 2.3 — fechamento de canto. Prova principal: cruzado com a bandeja 2D (`solveTray`, validada contra o
 * DXF real 710.0CUH25-01-03) nos cantos sobreposto, encosto e esquadria — mesma área, blank e comprimento de
 * corte — e o sólido OCCT sem interferência com volume = fórmula.
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
const IDS = ["S@B/L1+L@B/L2", "L@B/L2+N@B/L3", "N@B/L3+O@B/L4", "O@B/L4+S@B/L1"];
const canto = (kind: CornerKind, gap: number, corners: readonly string[], closer: "a" | "b" = "a", id = "CT"): SheetOp => ({ t: "canto", id, label: id === "CT" ? "Canto_1" : id, corners, kind, gap, closer });
/** bandeja com as 4 abas: S/N fecham (overlap A) */
function trayOps(inp: TrayInput): SheetOp[] {
  const th = inp.angleDeg ?? 90;
  const ops: SheetOp[] = (["S", "L", "N", "O"] as const).map((sd, i) => aba(sd, [["B", `L${i + 1}`]], inp.flanges[sd], th, { ref: inp.ref }));
  if (inp.corner === "aberto") return ops;
  const closeA = inp.overlap === "A";
  // canto S+L: a = S · L+N: b = N · N+O: a = N · O+S: b = S (quando S/N fecham)
  const pick: ("a" | "b")[] = closeA ? ["a", "b", "a", "b"] : ["b", "a", "b", "a"];
  IDS.forEach((id, i) => ops.push(canto(inp.corner as CornerKind, inp.gap, [id], pick[i], `C${i}`)));
  return ops;
}

describe("cruzado com solveTray: sobreposto, encosto, esquadria", () => {
  const BASE: TrayInput = { A: 535, B: 520, flanges: { S: 25.4, N: 25.4, O: 25.4, L: 25.4 }, ref: "externa", T: 3.18, R: 2, K: 0.33, corner: "sobreposto", overlap: "A", gap: 0.5 };
  const cases: [string, Partial<TrayInput>][] = [
    ["sobreposto 90° (710.0CUH25-01-03)", {}],
    ["sobreposto folga 0", { gap: 0 }],
    ["sobreposto, fecham O/L", { overlap: "B" }],
    ["encosto 90°", { corner: "encosto" }],
    ["esquadria 90°", { corner: "esquadria" }],
    ["encosto θ 60°", { corner: "encosto", angleDeg: 60, flanges: { S: 40, N: 40, O: 40, L: 40 } }],
    ["esquadria θ 60°", { corner: "esquadria", angleDeg: 60, flanges: { S: 40, N: 40, O: 40, L: 40 } }],
    ["esquadria θ 120°", { corner: "esquadria", angleDeg: 120, flanges: { S: 30, N: 30, O: 30, L: 30 } }],
    ["encosto interna, abas diferentes", { corner: "encosto", ref: "interna", flanges: { S: 40, N: 30, O: 50, L: 35 } }],
  ];
  for (const [name, p] of cases)
    it(`${name}: área, blank e comprimento de corte = bandeja; OCCT sem interferência, volume = fórmula`, () => {
      const inp = { ...BASE, ...p };
      const tray = solveTray(inp);
      expect(tray.ok).toBe(true);
      const sh = solveSheet(spec(rectBase(inp.A, inp.B, { T: inp.T, R: inp.R, K: inp.K }), ...trayOps(inp)));
      expect(codes(sh)).toEqual([]);
      expect(sh.corners!.map((c) => c.kind)).toEqual([inp.corner, inp.corner, inp.corner, inp.corner]);
      const fp = flatPattern(sh);
      expect(fp.state).toBe("valida");
      near(fp.area, tray.area, 1e-9 * tray.area);
      near(fp.box.maxX - fp.box.minX, tray.blank.w, 1e-9);
      near(fp.box.maxY - fp.box.minY, tray.blank.h, 1e-9);
      near(fp.cutLength, tray.cutLength, 1e-9 * tray.cutLength);
      const built = buildSheet(k, sh, T);
      expect(k.isValid(built.shape)).toBe(true);
      expect(Math.abs(built.volume - sh.volume) / sh.volume).toBeLessThan(1e-9);
    });
});

describe("canto — regras e erros", () => {
  const two = (...ops: SheetOp[]) => solveSheet(spec(rectBase(100, 50), aba("S", [["B", "L1"]], 30, 90), aba("L", [["B", "L2"]], 30, 90), ...ops));
  it("sobreposto 90°: a aba que fecha avança SB − g até a face externa da outra; a outra fica aberta", () => {
    const s = two(canto("sobreposto", 0.5, [IDS[0]]));
    expect(codes(s)).toEqual([]);
    const c = s.corners![0];
    near(c.ext.a, 4 - 0.5, 1e-9);
    near(c.ext.b, 0, 0);
    near(s.flanges.find((f) => f.id === "S@B/L1")!.area, (96 + 3.5) * 26, 1e-9);
    expect(c.relief.kind).toBe("retangular");
  });
  it("encosto 90°: a que fecha vai até a face externa (avanço SB); a outra até a face interna + g (SB − T − g)", () => {
    const s = two(canto("encosto", 0.5, [IDS[0]], "b"));
    expect(codes(s)).toEqual([]);
    near(s.corners![0].ext.b, 4, 1e-9);
    near(s.corners![0].ext.a, 4 - 2 - 0.5, 1e-9);
    const built = buildSheet(k, s, T);
    expect(Math.abs(built.volume - s.volume) / s.volume).toBeLessThan(1e-9);
  });
  it("esquadria em canto de base a 60° com θ diferentes: plano bissetor, sem interferência", () => {
    const tri = rectBase(1, 1);
    const base = { ...tri, outline: [{ key: "L1", a: { x: 0, y: 0 }, b: { x: 120, y: 0 } }, { key: "L2", a: { x: 120, y: 0 }, b: { x: 60, y: 103.92304845413263 } }, { key: "L3", a: { x: 60, y: 103.92304845413263 }, b: { x: 0, y: 0 } }] };
    const s = solveSheet(spec(base, aba("S", [["B", "L1"]], 25, 90), aba("L", [["B", "L2"]], 25, 75), canto("esquadria", 0.5, ["S@B/L1+L@B/L2"])));
    expect(codes(s)).toEqual([]);
    near(s.corners![0].angleDeg, 60, 1e-9);
    expect(s.corners![0].ext.a).toBeGreaterThan(0);
    expect(s.corners![0].ext.b).toBeGreaterThan(0);
    expect(flatPattern(s).state).toBe("valida");
    const built = buildSheet(k, s, T);
    expect(k.isValid(built.shape)).toBe(true);
    expect(Math.abs(built.volume - s.volume) / s.volume).toBeLessThan(1e-9);
  });
  it("erros explícitos: folga negativa, encosto/esquadria sem folga, redondo bloqueado, duplicado, canto inexistente, lados opostos", () => {
    expect(codes(two(canto("sobreposto", -1, [IDS[0]])))).toEqual(["CORNER_GAP"]);
    expect(codes(two(canto("encosto", 0, [IDS[0]])))).toEqual(["CORNER_GAP"]);
    expect(codes(two(canto("esquadria", 0, [IDS[0]])))).toEqual(["CORNER_GAP"]);
    expect(codes(two({ ...canto("sobreposto", 0.5, [IDS[0]]), relief: "redondo" } as SheetOp))).toEqual(["CORNER_ROUND"]);
    expect(codes(two(canto("sobreposto", 0.5, [IDS[0]]), canto("encosto", 0.5, [IDS[0]], "a", "C2")))).toEqual(["CORNER_DUP"]);
    expect(codes(two(canto("sobreposto", 0.5, ["S@B/L1+X@B/L9"])))).toEqual(["REF_LOST"]);
    const rec = solveSheet(spec(rectBase(100, 50), aba("S", [["B", "L1"]], 30, 90, { o1: 10 }), aba("L", [["B", "L2"]], 30, 90), canto("sobreposto", 0.5, [IDS[0]])));
    expect(codes(rec)).toEqual(["CORNER_LOST"]);
    const opp = solveSheet(spec(rectBase(100, 50), aba("S", [["B", "L1"]], 30, 90), aba("L", [["B", "L2"]], 30, 90, { side: "baixo" }), canto("sobreposto", 0.5, [IDS[0]])));
    expect(codes(opp)).toEqual(["CORNER_SIDE"]);
  });
  it("muda T/R/θ/altura → o canto é recalculado do histórico (sem acúmulo)", () => {
    for (const [T0, R, th, H] of [[2, 2, 90, 30], [3, 1, 80, 40], [1.5, 4, 95, 25]] as const) {
      const s = solveSheet(spec(rectBase(100, 50, { T: T0, R }), aba("S", [["B", "L1"]], H, th), aba("L", [["B", "L2"]], H, th), canto("encosto", 0.3, [IDS[0]])));
      expect(codes(s)).toEqual([]);
      const built = buildSheet(k, s, T);
      expect(Math.abs(built.volume - s.volume) / s.volume).toBeLessThan(1e-9);
    }
  });
});
