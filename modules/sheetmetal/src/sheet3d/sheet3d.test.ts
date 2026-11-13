import { describe, expect, it } from "vitest";
import { bendAllowance, bendDeduction, bendToIncluded, deg, includedToBend, insideSetback, outsideSetback } from "../bend";
import { apply, applyDir, axisY, axisZ, cross3, dot3, sub3, unit3, v3 } from "./math";
import type { SheetOp } from "./model";
import { solveSheet } from "./solve";
import { aba, rectBase, spec } from "./testkit";

const near = (a: number, b: number, t = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(t);
const ok = (s: ReturnType<typeof solveSheet>) => {
  if (!s.ok) throw new Error(s.issues.map((i) => `${i.code}: ${i.message}`).join("\n"));
  return s;
};
const codes = (s: ReturnType<typeof solveSheet>) => s.issues.filter((i) => i.level === "error").map((i) => i.code);

describe("chapa 3D — fórmulas (fonte única: bend.ts)", () => {
  it("valores de referência T 2, R 2, K 0,33, θ 90°", () => {
    const s = ok(solveSheet(spec(rectBase(100, 50), aba("A1", [["B", "L1"]], 30, 90))));
    const b = s.bends[0];
    near(b.BA, 4.178318229, 1e-8);
    near(b.OSB, 4, 1e-12);
    near(b.BD, 3.821681771, 1e-8);
  });
  it("θ ∈ {30, 45, 90, 120, 135}°: BA/OSB/ISB/BD idênticos a bend.ts (1e-12)", () => {
    for (const th of [30, 45, 90, 120, 135]) {
      const s = ok(solveSheet(spec(rectBase(200, 100, { T: 3, R: 4, K: 0.4 }), aba("A1", [["B", "L1"]], 60, th))));
      const b = s.bends[0];
      const r = deg(th);
      near(b.BA, bendAllowance(r, 4, 0.4, 3), 1e-12);
      near(b.OSB, outsideSetback(r, 4, 3), 1e-12);
      near(b.ISB, insideSetback(r, 4), 1e-12);
      near(b.BD, bendDeduction(r, 4, 0.4, 3), 1e-12);
      expect(b.deflectionDeg).toBe(th);
      expect(b.includedDeg).toBe(180 - th);
    }
  });
  it("2.1: digitar α = 135° grava θ = 45° e BA = (π/4)(R+K·T)", () => {
    const theta = includedToBend(135);
    expect(theta).toBe(45);
    const s = ok(solveSheet(spec(rectBase(100, 50), aba("A1", [["B", "L1"]], 30, theta))));
    near(s.bends[0].BA, (Math.PI / 4) * (2 + 0.33 * 2), 1e-12);
    expect(bendToIncluded(s.bends[0].deflectionDeg)).toBe(135);
  });
  it("L 50 × 30 externo → planificação 76,178318", () => {
    const s = ok(solveSheet(spec(rectBase(100, 50), aba("A1", [["B", "L1"]], 30, 90))));
    const child = s.flanges[1];
    const ponta = child.flat.find((e) => e.key === "ponta")!;
    const p = apply(child.H, v3(ponta.a.x, ponta.a.y, 0));
    near(50 - p.y, 76.178318229, 1e-8);
  });
});

describe("chapa 3D — orientação dos ângulos (normais orientadas, eixo, sentido)", () => {
  // ângulo com sinal de a para b em torno do eixo u (regra da mão direita)
  const signed = (a: ReturnType<typeof v3>, b: ReturnType<typeof v3>, u: ReturnType<typeof v3>) => (Math.atan2(dot3(cross3(a, b), u), dot3(a, b)) * 180) / Math.PI;
  for (const side of ["cima", "baixo"] as const)
    for (const th of [30, 45, 90, 120, 135])
      it(`${side} θ ${th}°: deflexão θ e ângulo interno α medidos com sinal`, () => {
        const s = ok(solveSheet(spec(rectBase(120, 80), aba("A1", [["B", "L1"]], 40, th, { side }))));
        const [base, child] = s.flanges;
        const b = s.bends[0];
        const nOut = v3(0, -1, 0); // para fora da aresta L1, no plano da base
        const yC = applyDir(child.G, v3(0, 1, 0)); // direção da aba-filha (para longe da dobra)
        const zP = axisZ(base.G);
        const zC = axisZ(child.G);
        // eixo da dobra paralelo à aresta (±x), girando +θ leva a direção da pai à da filha
        expect(Math.abs(dot3(b.axis.dir, v3(1, 0, 0)))).toBeCloseTo(1, 12);
        near(signed(nOut, yC, b.axis.dir), th, 1e-9);
        near(signed(zP, zC, b.axis.dir), th, 1e-9);
        // sentido: a aba sobe (cima) ou desce (baixo) em relação ao +z da base
        expect(Math.sign(dot3(yC, zP))).toBe(side === "cima" ? 1 : -1);
        // α = ângulo entre a aba-pai (voltando da aresta, −n) e a aba-filha
        const back = v3(0, 1, 0);
        near((Math.acos(Math.max(-1, Math.min(1, dot3(back, yC)))) * 180) / Math.PI, 180 - th, 1e-9);
        // o eixo fica do lado de dentro: distância eixo→face interna = R, eixo→face externa = R+T
        const pIn = apply(base.G, v3(60, b.tangent[0].y, side === "cima" ? 2 : 0));
        const pOut = apply(base.G, v3(60, b.tangent[0].y, side === "cima" ? 0 : 2));
        const dist = (p: ReturnType<typeof v3>) => {
          const w = sub3(p, b.axis.p);
          const c = cross3(w, unit3(b.axis.dir));
          return Math.hypot(c.x, c.y, c.z);
        };
        near(dist(pIn), 2, 1e-9);
        near(dist(pOut), 4, 1e-9);
      });
  it("posição dobrada exata: L 90° externo — face de fora no plano da aresta, ponta a 30 mm", () => {
    const s = ok(solveSheet(spec(rectBase(100, 50), aba("A1", [["B", "L1"]], 30, 90))));
    const c = s.flanges[1];
    const p = apply(c.G, v3(10, 30, 0)); // ponta, face z=0 (de fora)
    near(p.y, 0, 1e-12);
    near(p.z, 30, 1e-12);
    const q = apply(c.G, v3(10, 30, 2)); // face de dentro
    near(q.y, 2, 1e-12);
    near(axisY(c.G).z, 1, 1e-12);
  });
});

describe("chapa 3D — determinismo e paramétrico", () => {
  const four = (len: number, th = 90): SheetOp[] => [aba("A", [["B", "L1"], ["B", "L2"], ["B", "L3"], ["B", "L4"]], len, th)].map((o) => ({ ...o })) as SheetOp[];
  it("mesma entrada → mesma geometria e mesma planificação (bit a bit)", () => {
    const a = solveSheet(spec(rectBase(300, 200), ...four(40)));
    const b = solveSheet(spec(rectBase(300, 200), ...four(40)));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("editar comprimento de uma aba não move as outras abas nem a base", () => {
    const s1 = ok(solveSheet(spec(rectBase(300, 200), aba("A", [["B", "L1"]], 40, 90), aba("C", [["B", "L3"]], 40, 90))));
    const s2 = ok(solveSheet(spec(rectBase(300, 200), aba("A", [["B", "L1"]], 75, 90), aba("C", [["B", "L3"]], 40, 90))));
    const f = (s: typeof s1, id: string) => s.flanges.find((x) => x.id === id)!;
    expect(f(s2, "B").G).toEqual(f(s1, "B").G);
    expect(f(s2, "C@B/L3").G).toEqual(f(s1, "C@B/L3").G);
    expect(f(s2, "C@B/L3").H).toEqual(f(s1, "C@B/L3").H);
    expect(f(s2, "A@B/L1").G).toEqual(f(s1, "A@B/L1").G); // posição da aba (raiz) independe do comprimento
  });
  it("editar θ, R, T mantém a base fixa e cada aba no seu lado (sem inversão)", () => {
    for (const [th, R, T] of [[30, 1, 1], [90, 4, 3], [135, 8, 5]] as const) {
      const s = ok(solveSheet(spec(rectBase(300, 200, { T, R }), ...four(60, th))));
      const base = s.flanges[0];
      expect(base.G.slice(0, 3)).toEqual([1, 0, 0]);
      // cada aba planificada fica do lado de fora da sua linha de tangência, além da região de dobra
      const out = { "L1": [0, -1], "L2": [1, 0], "L3": [0, 1], "L4": [-1, 0] } as const;
      for (const f of s.flanges.slice(1)) {
        const e = f.id.split("/")[1] as keyof typeof out;
        const b = s.bends.find((x) => x.child === f.id)!;
        const [nx, ny] = out[e];
        for (const ed of f.flat) {
          const p = apply(f.H, v3(ed.a.x, ed.a.y, 0));
          const q = b.flatEnd[0];
          expect((p.x - q.x) * nx + (p.y - q.y) * ny).toBeGreaterThanOrEqual(-1e-9);
        }
        const s0 = b.flatStart[0];
        const s1 = b.flatEnd[0];
        near((s1.x - s0.x) * nx + (s1.y - s0.y) * ny, b.BA, 1e-9);
      }
    }
  });
});

describe("chapa 3D — volume e área (2.3)", () => {
  it("V = Σ A·T + Σ θ·T·(R+T/2)·L; K = 0,5 → V = T·área plana; K = 0,33 → diferença exata", () => {
    const ops = [aba("A", [["B", "L1"], ["B", "L2"], ["B", "L3"], ["B", "L4"]], 40, 90)];
    const s5 = ok(solveSheet(spec(rectBase(300, 200, { K: 0.5 }), ...ops)));
    near(s5.volume, 2 * s5.flatArea, 1e-9 * s5.volume);
    const s3 = ok(solveSheet(spec(rectBase(300, 200, { K: 0.33 }), ...ops)));
    const diff = s3.bends.reduce((a, b) => a + 2 * (0.5 - 0.33) * (Math.PI / 2) * 2 * b.L, 0);
    near(s3.volume - 2 * s3.flatArea, diff, 1e-9 * s3.volume);
    // canto aberto: a aba vai de tangência a tangência das vizinhas (300 − 2·4 = 292; 200 − 8 = 192)
    expect(s3.bends.map((b) => +b.L.toFixed(9)).sort((a, b) => a - b)).toEqual([192, 192, 292, 292]);
  });
});

describe("chapa 3D — erros explícitos", () => {
  it("aba mais curta que o recuo → FLANGE_SHORT (texto do 2D)", () => {
    const s = solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 3.5, 90)));
    expect(codes(s)).toEqual(["FLANGE_SHORT"]);
    expect(s.issues[0].message).toContain("menor ou igual aos recuos");
  });
  it("θ fora de (0,180), K fora de [0,1], R negativo", () => {
    expect(codes(solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 0))))).toEqual(["ANGLE"]);
    expect(codes(solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 180))))).toEqual(["ANGLE"]);
    expect(codes(solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90, { K: 1.2 }))))).toEqual(["K_RANGE"]);
    expect(codes(solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90, { R: -1 }))))).toEqual(["RADIUS"]);
  });
  it("referência perdida, aresta já dobrada, raiz", () => {
    expect(codes(solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L9"]], 30, 90))))).toEqual(["REF_LOST"]);
    expect(codes(solveSheet(spec(rectBase(100, 50), aba("A", [["X", "L1"]], 30, 90))))).toEqual(["REF_LOST"]);
    expect(codes(solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90), aba("C", [["B", "L1"]], 30, 90))))).toEqual(["EDGE_USED"]);
    expect(codes(solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90), aba("C", [["A@B/L1", "raiz"]], 30, 90))))).toEqual(["EDGE_ROOT"]);
  });
  it("base pequena demais para os recuos → FLANGE_SMALL", () => {
    const s = solveSheet(spec(rectBase(6, 50), aba("A", [["B", "L2"], ["B", "L4"]], 30, 90)));
    expect(codes(s)).toEqual(["FLANGE_SMALL"]);
  });
});

describe("chapa 3D — aba em aba e dobra por linha", () => {
  it("aba na ponta de outra (U) e aba no lado (canto)", () => {
    const s = ok(solveSheet(spec(rectBase(200, 100), aba("A", [["B", "L1"]], 50, 90), aba("C", [["A@B/L1", "ponta"]], 20, 90), aba("D", [["A@B/L1", "lado0"]], 15, 90))));
    expect(s.flanges.map((f) => f.id)).toEqual(["B", "A@B/L1", "C@A@B/L1/ponta", "D@A@B/L1/lado0"]);
    const c = s.flanges[2];
    // retorno: face de fora da ponta a 50 mm de altura, voltada para dentro (y +)
    const p = apply(c.G, v3(5, 20, 0));
    near(p.z, 50, 1e-9);
    near(p.y, 20, 1e-9);
  });
  it("dobra por linha: planificação = chapa original (área e contorno), parte móvel gira θ", () => {
    const op: SheetOp = { t: "linha", id: "D1", label: "Dobra_1", flange: "B", a: { x: 40, y: -10 }, b: { x: 40, y: 70 }, fixed: "esq", bend: { deflectionDeg: 90 }, side: "cima", ref: "externa" };
    const s = ok(solveSheet(spec(rectBase(100, 60), op)));
    near(s.flatArea, 100 * 60, 1e-9);
    const b = s.bends[0];
    // linha de dobra (centro da região) exatamente sobre x = 40 na planificação
    near(b.flatLine[0].x, 40, 1e-12);
    near(b.flatLine[1].x, 40, 1e-12);
    near(b.L, 60, 1e-12);
    // a parte móvel fica à direita de x = 40 + BA/2 na planificação e vertical no 3D
    const m = s.flanges[1];
    const pts = m.flat.map((e) => apply(m.H, v3(e.a.x, e.a.y, 0)));
    near(Math.min(...pts.map((p) => p.x)), 40 + b.BA / 2, 1e-9);
    near(Math.max(...pts.map((p) => p.x)), 100, 1e-9);
    near(Math.abs(axisY(m.G).z), 1, 1e-12);
  });
  it("dobra por linha: obliqua, cruza canto, cruza aresta dobrada → erro", () => {
    const L = (a: [number, number], b: [number, number]): SheetOp => ({ t: "linha", id: "D1", label: "Dobra_1", flange: "B", a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, fixed: "esq", bend: { deflectionDeg: 90 }, side: "cima", ref: "externa" });
    expect(codes(solveSheet(spec(rectBase(100, 60), L([30, -10], [50, 70]))))).toEqual(["LINE_OBLIQUE"]);
    expect(codes(solveSheet(spec(rectBase(100, 60), L([2, -10], [2, 70]))))).toEqual(["LINE_VERTEX"]);
    expect(codes(solveSheet(spec(rectBase(100, 60), aba("A", [["B", "L1"]], 20, 90), L([40, -10], [40, 70]))))).toEqual(["LINE_BENT_EDGE"]);
    expect(codes(solveSheet(spec(rectBase(100, 60), L([40, -10], [40, 70]), aba("A", [["B", "L1"]], 20, 90))))).toEqual(["LINE_SPAN"]);
  });
  it("recortes: dentro ok; tocando borda/região de dobra ou sobrepostos → erro", () => {
    const cut = (c: [number, number], r: number, id = "R1"): SheetOp => ({ t: "recorte", id, label: id, flange: "B", loops: [{ segs: [{ t: "circle", c: { x: c[0], y: c[1] }, r }] }] });
    const s = ok(solveSheet(spec(rectBase(100, 60), aba("A", [["B", "L1"]], 20, 90), cut([50, 30], 5))));
    near(s.flanges[0].area, 100 * 56 - Math.PI * 25, 1e-9);
    expect(codes(solveSheet(spec(rectBase(100, 60), aba("A", [["B", "L1"]], 20, 90), cut([50, 6], 3))))).toEqual(["CUT_EDGE"]);
    expect(codes(solveSheet(spec(rectBase(100, 60), cut([50, 30], 5), cut([56, 30], 3, "R2"))))).toEqual(["CUT_OVERLAP"]);
    expect(codes(solveSheet(spec(rectBase(100, 60), cut([150, 30], 5))))).toEqual(["CUT_OUT"]);
  });
});
