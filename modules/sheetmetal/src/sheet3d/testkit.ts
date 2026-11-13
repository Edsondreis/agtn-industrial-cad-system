import type { BendSide, SheetBaseSpec, SheetDefaults, SheetOp, SheetRef, SheetSpec } from "./model";

/** Peças de referência para testes (motor puro e OCCT). */
export const XY = { o: { x: 0, y: 0, z: 0 }, x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, n: { x: 0, y: 0, z: 1 } };

export function defaults(p: Partial<SheetDefaults> = {}): SheetDefaults {
  return { T: 2, R: 2, K: 0.33, kSource: "manual", ref: "externa", ...p };
}

/** Retângulo A (x) × B (y); arestas L1 (y=0), L2 (x=A), L3 (y=B), L4 (x=0). */
export function rectBase(A: number, B: number, d: Partial<SheetDefaults> = {}, side: BendSide = "cima"): SheetBaseSpec {
  return {
    id: "B",
    label: "Base",
    defaults: defaults(d),
    plane: XY,
    side,
    outline: [
      { key: "L1", a: { x: 0, y: 0 }, b: { x: A, y: 0 } },
      { key: "L2", a: { x: A, y: 0 }, b: { x: A, y: B } },
      { key: "L3", a: { x: A, y: B }, b: { x: 0, y: B } },
      { key: "L4", a: { x: 0, y: B }, b: { x: 0, y: 0 } },
    ],
    holes: [],
  };
}

export function aba(id: string, edges: [string, string][], length: number, deflectionDeg: number, o: { side?: BendSide; ref?: SheetRef; R?: number; K?: number } = {}): SheetOp {
  return {
    t: "aba",
    id,
    label: id,
    edges: edges.map(([flange, edge]) => ({ flange, edge })),
    length,
    bend: { deflectionDeg, ...(o.R !== undefined ? { R: o.R } : {}), ...(o.K !== undefined ? { K: o.K } : {}) },
    side: o.side ?? "cima",
    ref: o.ref ?? "externa",
  };
}

export const spec = (base: SheetBaseSpec, ...ops: SheetOp[]): SheetSpec => ({ base, ops });
