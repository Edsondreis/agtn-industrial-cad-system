/**
 * Auditoria do solver (FASE 3): casos com resposta matemática conhecida.
 * Tolerâncias: posições/cotas 1e-7 mm (o solver para em resíduo ≤ 1e-9 mm, com folga para o arredondamento
 * do Jacobiano por diferenças finitas); geometria grande usa tolerância relativa 1e-12 (limite do double).
 */
import { type Constraint, type Id, type Sketch, addConstraint, addLine, addPointEntity, addRectangle, emptySketch, pointOf, solve } from "./index";

const near = (a: number, b: number, eps = 1e-7) => expect(Math.abs(a - b)).toBeLessThan(eps);
const line = (s: Sketch, id: Id) => s.entities[id] as Extract<Sketch["entities"][string], { t: "line" }>;
const P = (s: Sketch, id: Id) => pointOf(s, id)!;
const len = (s: Sketch, l: Id) => {
  const e = line(s, l);
  return Math.hypot(P(s, e.p2).x - P(s, e.p1).x, P(s, e.p2).y - P(s, e.p1).y);
};
const C = (s: Sketch, c: Parameters<typeof addConstraint>[1]) => addConstraint(s, c).s;
/** Linha horizontal de referência totalmente definida: (0,0)→(100,0). */
function base() {
  const a = addLine(emptySketch(), { x: 0, y: 0 }, { x: 100, y: 0 });
  let s = C(a.s, { t: "coincident", a: line(a.s, a.id).p1, b: "O" });
  s = C(s, { t: "horizontal", l: a.id });
  s = C(s, { t: "length", l: a.id, v: 100 });
  return { s, a: a.id };
}
/** Rect w×h com canto em (x0,y0): 4 linhas, 2H, 2V, 2 cotas e o canto fixo → totalmente definido. */
function rect(x0: number, y0: number, w: number, h: number, start = 0.9) {
  const r = addRectangle(emptySketch(), { x: x0, y: y0 }, { x: x0 + w * start, y: y0 + h * start });
  let s = C(r.s, { t: "fixed", p: r.points[0], x: x0, y: y0 });
  s = C(s, { t: "length", l: r.lines[0], v: w });
  s = C(s, { t: "length", l: r.lines[1], v: h });
  return { s, r };
}

describe("auditoria do solver — diagnóstico", () => {
  it("esboço totalmente livre: linha solta = 4 GL, sem restrições", () => {
    const r = solve(addLine(emptySketch(), { x: 1, y: 2 }, { x: 5, y: 7 }).s);
    expect(r.status).toBe("under");
    expect(r.dof).toBe(4);
  });

  it("ângulo 0° entre linhas = paralela (1 equação): GL exatos, sem falso 'redundante'", () => {
    const { s, a } = base();
    const b = addLine(s, { x: 10, y: 20 }, { x: 60, y: 21 });
    const r = solve(C(b.s, { t: "angle", a, b: b.id, v: 0 }));
    expect(r.status).toBe("under");
    expect(r.redundant).toEqual([]);
    expect(r.dof).toBe(3); // 4 da linha b − 1 do ângulo
    const e = line(r.sketch, b.id);
    near(P(r.sketch, e.p1).y, P(r.sketch, e.p2).y);
  });

  it("ângulo 180° e 90°: mesma contagem (1 equação cada)", () => {
    for (const [v, from] of [
      [180, { x: 60, y: 21 }],
      [90, { x: 12, y: 60 }],
    ] as const) {
      const { s, a } = base();
      const b = addLine(s, from, { x: 10, y: 20 });
      const r = solve(C(b.s, { t: "angle", a, b: b.id, v }));
      expect(r.status).toBe("under");
      expect(r.dof).toBe(3);
      const e = line(r.sketch, b.id);
      const dx = P(r.sketch, e.p2).x - P(r.sketch, e.p1).x;
      const dy = P(r.sketch, e.p2).y - P(r.sketch, e.p1).y;
      // direção da linha b (mod 360°): 180° → antiparalela ao eixo X; 90° → vertical
      const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const diff = ((deg - (v === 180 ? 180 : -90)) % 360 + 540) % 360 - 180;
      near(diff, 0, 1e-6);
    }
  });

  it("ângulos próximos de 0° e de 180° (0,01° e 179,99°) convergem com o valor exato", () => {
    for (const v of [0.01, 179.99]) {
      const { s, a } = base();
      const b = addLine(s, v < 90 ? { x: 10, y: 20 } : { x: 60, y: 21 }, v < 90 ? { x: 60, y: 22 } : { x: 10, y: 20 });
      const r = solve(C(b.s, { t: "angle", a, b: b.id, v }));
      expect(r.status).toBe("under");
      const e = line(r.sketch, b.id);
      const ang = Math.abs((Math.atan2(P(r.sketch, e.p2).y - P(r.sketch, e.p1).y, P(r.sketch, e.p2).x - P(r.sketch, e.p1).x) * 180) / Math.PI);
      near(ang, v, 1e-7);
    }
  });

  it("distância ponto–linha 0 equivale a ponto sobre a linha (1 equação, sem singularidade)", () => {
    const { s, a } = base();
    const p = addLine(s, { x: 30, y: 5 }, { x: 40, y: 40 });
    const pid = line(p.s, p.id).p1;
    const r = solve({ ...p.s, constraints: [...p.s.constraints, { id: "Dz", t: "pointLineDistance", p: pid, l: a, v: 0 }] });
    expect(r.status).toBe("under");
    expect(r.dof).toBe(3);
    near(P(r.sketch, pid).y, 0);
  });

  it("pontos coincidentes com cota de distância 10: existe solução — não pode virar 'inconsistente'", () => {
    const a = addPointEntity(emptySketch(), { x: 5, y: 5 });
    const b = addPointEntity(a.s, { x: 5, y: 5 });
    const s = { ...b.s, constraints: [{ id: "D1", t: "distance", a: a.p, b: b.p, v: 10 } as Constraint] };
    const r = solve(s);
    expect(r.status).toBe("under");
    expect(r.dof).toBe(3);
    near(Math.hypot(P(r.sketch, b.p).x - P(r.sketch, a.p).x, P(r.sketch, b.p).y - P(r.sketch, a.p).y), 10);
  });

  it("redundante (consistente) × incompatível × convergido", () => {
    const { s, r } = rect(0, 0, 200, 100);
    expect(solve(s).status).toBe("full");
    const red = solve(C(s, { t: "parallel", a: r.lines[0], b: r.lines[2] }));
    expect(red.status).toBe("over");
    expect(red.redundant.length).toBe(1);
    const bad = solve({ ...s, constraints: [...s.constraints, { id: "X1", t: "length", l: r.lines[2], v: 150 }] });
    expect(bad.status).toBe("inconsistent");
    expect(bad.conflicts).toContain("X1");
    // a geometria original é mantida (nunca solução parcial)
    expect(bad.sketch.points).toEqual(s.points);
  });

  it("restrições em cadeia: 20 segmentos iguais com ângulo de 18° fecham um polígono regular", () => {
    let s = emptySketch();
    const ids: Id[] = [];
    let prev: Id | null = null;
    let first: Id | null = null;
    for (let i = 0; i < 20; i++) {
      const a0 = (i * 2 * Math.PI) / 20;
      const a1 = ((i + 1) * 2 * Math.PI) / 20;
      const R = 100 + (i % 3);
      const r = addLine(s, prev ?? { x: R * Math.cos(a0), y: R * Math.sin(a0) }, i === 19 ? first! : { x: R * Math.cos(a1), y: R * Math.sin(a1) });
      s = r.s;
      if (!first) first = line(s, r.id).p1;
      prev = line(s, r.id).p2;
      ids.push(r.id);
    }
    s = C(s, { t: "fixed", p: first!, x: 100, y: 0 });
    s = C(s, { t: "length", l: ids[0], v: 30 });
    for (let i = 1; i < 20; i++) s = C(s, { t: "equal", a: ids[0], b: ids[i] });
    for (let i = 1; i < 19; i++) s = C(s, { t: "angle", a: ids[i - 1], b: ids[i], v: 18 });
    const r = solve(s);
    expect(["full", "under", "over"]).toContain(r.status);
    for (const id of ids) near(len(r.sketch, id), 30, 1e-7);
  });

  it("geometria muito grande (1e6 mm) e coordenadas negativas: converge e fica totalmente definida", () => {
    for (const [x0, y0] of [
      [1e6, 1e6],
      [-2.5e5, -7.5e5],
    ]) {
      const { s, r } = rect(x0, y0, 5000, 2500);
      const res = solve(s);
      expect(res.status).toBe("full");
      expect(Math.abs(len(res.sketch, r.lines[0]) - 5000) / 5000).toBeLessThan(1e-12);
    }
  });

  it("geometria muito pequena (0,001 mm) e cota próxima de zero", () => {
    const { s, r } = rect(0, 0, 0.001, 0.0005);
    const res = solve(s);
    expect(res.status).toBe("full");
    near(len(res.sketch, r.lines[0]), 0.001, 1e-12);
    near(len(res.sketch, r.lines[1]), 0.0005, 1e-12);
  });

  it("linhas paralelas quase coincidentes (0,001 mm) com distância ponto–linha", () => {
    const { s, a } = base();
    const b = addLine(s, { x: 0, y: 0.002 }, { x: 100, y: 0.0021 });
    let t = C(b.s, { t: "parallel", a, b: b.id });
    t = C(t, { t: "pointLineDistance", p: line(t, b.id).p1, l: a, v: 0.001 });
    const r = solve(t);
    expect(r.status).toBe("under");
    near(P(r.sketch, line(r.sketch, b.id).p2).y, 0.001, 1e-9);
  });

  it("muitos elementos: 60 retângulos definidos (240 linhas, ~720 equações) em tempo razoável", () => {
    let s = emptySketch();
    for (let i = 0; i < 60; i++) {
      const x0 = (i % 10) * 30;
      const y0 = Math.floor(i / 10) * 30;
      const r = addRectangle(s, { x: x0 + 1, y: y0 + 1 }, { x: x0 + 19, y: y0 + 9 });
      s = C(r.s, { t: "fixed", p: r.points[0], x: x0, y: y0 });
      s = C(s, { t: "length", l: r.lines[0], v: 20 });
      s = C(s, { t: "length", l: r.lines[1], v: 10 });
    }
    const t0 = performance.now();
    const r = solve(s);
    const ms = performance.now() - t0;
    expect(r.status).toBe("full");
    console.info(`solver: 60 retângulos, ${s.constraints.length} restrições → ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(3000);
  });
});
