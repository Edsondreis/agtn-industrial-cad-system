import {
  type Sketch,
  addArc,
  addCircle,
  addConstraint,
  addLine,
  addPolyline,
  addRectangle,
  defaultRegions,
  emptySketch,
  extend,
  offset,
  pathChain,
  pointOf,
  profiles,
  removeEntities,
  setDimension,
  solve,
  tangentConstraint,
  trim,
} from "@agtn/sketch";

const near = (a: number, b: number, eps = 1e-7) => expect(Math.abs(a - b)).toBeLessThan(eps);

/** Retângulo totalmente definido: canto na origem, 200 × 100. */
function definedRect() {
  let s = emptySketch();
  const r = addRectangle(s, { x: 3, y: 2 }, { x: 190, y: 95 });
  s = r.s;
  s = addConstraint(s, { t: "coincident", a: r.points[0], b: "O" }).s;
  const w = addConstraint(s, { t: "length", l: r.lines[0], v: 200 });
  s = w.s;
  const h = addConstraint(s, { t: "length", l: r.lines[1], v: 100 });
  s = h.s;
  return { s, r, w: w.id, h: h.id };
}

describe("solver — estados de definição", () => {
  it("retângulo livre é subdefinido com 4 GL (posição + largura + altura)", () => {
    const r = addRectangle(emptySketch(), { x: 0, y: 0 }, { x: 10, y: 5 });
    const res = solve(r.s);
    expect(res.status).toBe("under");
    expect(res.dof).toBe(4);
  });
  it("retângulo preso na origem e cotado fica totalmente definido e com as medidas exatas", () => {
    const { s, r } = definedRect();
    const res = solve(s);
    expect(res.status).toBe("full");
    expect(res.dof).toBe(0);
    const p2 = pointOf(res.sketch, r.points[2])!;
    near(p2.x, 200);
    near(p2.y, 100);
    expect(res.freePoints.size).toBe(0);
  });
  it("alterar a cota ajusta o esboço automaticamente (passo mínimo: origem não se mexe)", () => {
    const { s, r, w } = definedRect();
    const res = solve(setDimension(solve(s).sketch, w, 350));
    expect(res.status).toBe("full");
    const p0 = pointOf(res.sketch, r.points[0])!;
    const p2 = pointOf(res.sketch, r.points[2])!;
    near(p0.x, 0);
    near(p2.x, 350);
    near(p2.y, 100);
  });
  it("cota redundante é detectada (sobredefinido)", () => {
    const { s, r } = definedRect();
    const s2 = addConstraint(s, { t: "length", l: r.lines[2], v: 200 }).s; // lado oposto já é igual
    const res = solve(s2);
    expect(res.status).toBe("over");
    expect(res.redundant.length).toBeGreaterThan(0);
  });
  it("cotas conflitantes: inconsistente, geometria intacta e conflito identificado", () => {
    const { s, r } = definedRect();
    const bad = addConstraint(s, { t: "length", l: r.lines[2], v: 250 });
    const res = solve(bad.s);
    expect(res.status).toBe("inconsistent");
    expect(res.sketch).toBe(bad.s);
    expect(res.conflicts).toContain(bad.id);
  });
  it("pontos livres identificados para colorir (sub-definidos)", () => {
    let s = emptySketch();
    const l = addLine(s, { x: 0, y: 0 }, { x: 10, y: 0 });
    s = addConstraint(l.s, { t: "coincident", a: l.p1, b: "O" }).s;
    const res = solve(s);
    expect(res.freePoints.has(l.p1)).toBe(false);
    expect(res.freePoints.has(l.p2)).toBe(true);
  });
});

describe("solver — cada restrição", () => {
  const lineAt = (s: Sketch, a: [number, number], b: [number, number]) => addLine(s, { x: a[0], y: a[1] }, { x: b[0], y: b[1] });
  it("horizontal, vertical, paralela, perpendicular, ângulo", () => {
    let s = emptySketch();
    const a = lineAt(s, [0, 0], [10, 1]);
    const b = lineAt(a.s, [0, 5], [3, 20]);
    const c = lineAt(b.s, [20, 0], [25, 7]);
    s = c.s;
    s = addConstraint(s, { t: "horizontal", l: a.id }).s;
    s = addConstraint(s, { t: "vertical", l: b.id }).s;
    s = addConstraint(s, { t: "angle", a: a.id, b: c.id, v: 30 }).s;
    const r = solve(s);
    expect(r.status).not.toBe("inconsistent");
    const P = (id: string) => pointOf(r.sketch, id)!;
    near(P(a.p1).y, P(a.p2).y);
    near(P(b.p1).x, P(b.p2).x);
    const ang = Math.abs(Math.atan2(P(c.p2).y - P(c.p1).y, P(c.p2).x - P(c.p1).x) * (180 / Math.PI));
    near(ang, 30, 1e-6);
    let t = addConstraint(r.sketch, { t: "parallel", a: b.id, b: c.id }).s;
    expect(solve(t).status).toBe("inconsistent"); // vertical ∥ 30° é impossível
    t = removeEntities(r.sketch, []);
    const d = lineAt(t, [0, 30], [10, 33]);
    const r2 = solve(addConstraint(d.s, { t: "perpendicular", a: a.id, b: d.id }).s);
    near(pointOf(r2.sketch, d.p1)!.x, pointOf(r2.sketch, d.p2)!.x);
  });
  it("tangência linha × círculo e concentricidade", () => {
    let s = emptySketch();
    const c = addCircle(s, { x: 0, y: 0 }, 10);
    const l = addLine(c.s, { x: -20, y: 13 }, { x: 20, y: 14 });
    s = addConstraint(l.s, { t: "horizontal", l: l.id }).s;
    s = addConstraint(s, tangentConstraint(s, l.id, c.id)).s;
    s = addConstraint(s, { t: "coincident", a: c.c, b: "O" }).s;
    const r = solve(s);
    near(Math.abs(pointOf(r.sketch, l.p1)!.y), r.sketch.entities[c.id].t === "circle" ? (r.sketch.entities[c.id] as { r: number }).r : 0);
    const c2 = addCircle(r.sketch, { x: 3, y: 2 }, 4);
    const r2 = solve(addConstraint(c2.s, { t: "concentric", a: c.id, b: c2.id }).s);
    near(pointOf(r2.sketch, c2.c)!.x, 0);
    near(pointOf(r2.sketch, c2.c)!.y, 0);
  });
  it("igualdade (linhas e raios), fixo, ponto médio, distância, distância X/Y", () => {
    let s = emptySketch();
    const a = addLine(s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const b = addLine(a.s, { x: 0, y: 5 }, { x: 4, y: 9 });
    s = addConstraint(b.s, { t: "equal", a: a.id, b: b.id }).s;
    s = addConstraint(s, { t: "fixed", p: a.p1, x: 1, y: 1 }).s;
    s = addConstraint(s, { t: "distance", a: a.p1, b: b.p1, v: 12 }).s;
    s = addConstraint(s, { t: "distanceX", a: a.p1, b: a.p2, v: 15 }).s;
    s = addConstraint(s, { t: "distanceY", a: a.p1, b: a.p2, v: 0 }).s;
    const pm = addCircle(s, { x: 7, y: 2 }, 1);
    s = addConstraint(pm.s, { t: "midpoint", p: pm.c, l: a.id }).s;
    const r = solve(s);
    expect(r.status).not.toBe("inconsistent");
    const P = (id: string) => pointOf(r.sketch, id)!;
    near(P(a.p1).x, 1);
    near(P(a.p2).x - P(a.p1).x, 15);
    near(Math.hypot(P(b.p2).x - P(b.p1).x, P(b.p2).y - P(b.p1).y), 15);
    near(Math.hypot(P(b.p1).x - 1, P(b.p1).y - 1), 12);
    near(P(pm.c).x, 8.5);
    const c1 = addCircle(r.sketch, { x: 50, y: 0 }, 5);
    const c2 = addCircle(c1.s, { x: 80, y: 0 }, 9);
    let t = addConstraint(c2.s, { t: "equal", a: c1.id, b: c2.id }).s;
    t = addConstraint(t, { t: "diameter", c: c1.id, v: 20 }).s;
    const r2 = solve(t);
    expect((r2.sketch.entities[c2.id] as { r: number }).r).toBeCloseTo(10, 9);
  });
  it("arco: as duas pontas ficam no mesmo raio; raio cotado", () => {
    let s = emptySketch();
    const a = addArc(s, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 });
    s = addConstraint(a.s, { t: "coincident", a: a.c, b: "O" }).s;
    s = addConstraint(s, { t: "radius", c: a.id, v: 25 }).s;
    const r = solve(s);
    const P = (id: string) => pointOf(r.sketch, id)!;
    near(Math.hypot(P(a.p1).x, P(a.p1).y), 25);
    near(Math.hypot(P(a.p2).x, P(a.p2).y), 25);
  });
  it("valida tipos e evita duplicata", () => {
    const l = addLine(emptySketch(), { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(() => addConstraint(l.s, { t: "radius", c: l.id, v: 3 })).toThrow(/círculo/);
    const s = addConstraint(l.s, { t: "horizontal", l: l.id }).s;
    expect(() => addConstraint(s, { t: "horizontal", l: l.id })).toThrow(/Já existe/);
  });
  it("desempenho: grade de 40 retângulos definidos resolve em menos de 2 s", () => {
    let s = emptySketch();
    for (let i = 0; i < 40; i++) {
      const r = addRectangle(s, { x: (i % 8) * 30 + 1, y: Math.floor(i / 8) * 30 + 1 }, { x: (i % 8) * 30 + 21, y: Math.floor(i / 8) * 30 + 16 });
      s = r.s;
      s = addConstraint(s, { t: "fixed", p: r.points[0], x: (i % 8) * 30, y: Math.floor(i / 8) * 30 }).s;
      s = addConstraint(s, { t: "length", l: r.lines[0], v: 20 }).s;
      s = addConstraint(s, { t: "length", l: r.lines[1], v: 15 }).s;
    }
    const t0 = performance.now();
    const r = solve(s);
    const ms = performance.now() - t0;
    expect(r.status).toBe("full");
    expect(ms).toBeLessThan(2000);
  });
});

describe("perfis", () => {
  it("retângulo com círculo dentro → 1 região com furo (área exata)", () => {
    const r = addRectangle(emptySketch(), { x: 0, y: 0 }, { x: 200, y: 100 });
    const c = addCircle(r.s, { x: 100, y: 50 }, 20);
    const p = profiles(c.s);
    const def = defaultRegions(p);
    expect(def.length).toBe(1);
    const reg = p.regions[def[0]];
    expect(reg.holes.length).toBe(1);
    near(reg.area, 20000 - Math.PI * 400, 1e-6);
    expect(p.regions.find((x) => x.depth === 1)).toBeTruthy(); // o disco interno existe, mas não é padrão
  });
  it("perfil com arco (rasgo/oblongo) — área = retângulo + 2 meios círculos", () => {
    let s = emptySketch();
    const a = addLine(s, { x: 0, y: 0 }, { x: 50, y: 0 });
    const b = addArc(a.s, { x: 50, y: 10 }, a.p2, { x: 50, y: 20 });
    const c = addLine(b.s, b.p2, { x: 0, y: 20 });
    const d = addArc(c.s, { x: 0, y: 10 }, c.p2, a.p1);
    s = d.s;
    const p = profiles(s);
    expect(p.regions.length).toBe(1);
    near(p.regions[0].area, 50 * 20 + Math.PI * 100, 1e-6);
  });
  it("linhas cruzadas são cortadas nas interseções; pontas soltas informadas", () => {
    let s = emptySketch();
    s = addRectangle(s, { x: 0, y: 0 }, { x: 100, y: 100 }).s;
    s = addLine(s, { x: 50, y: -20 }, { x: 50, y: 120 }).s; // divide em 2 regiões, com pontas soltas
    const p = profiles(s);
    expect(p.regions.length).toBe(2);
    p.regions.forEach((r) => near(r.area, 5000, 1e-6));
    expect(p.openEnds.length).toBe(2);
  });
  it("geometria de construção não entra no perfil", () => {
    const r = addRectangle(emptySketch(), { x: 0, y: 0 }, { x: 10, y: 10 }, true);
    expect(profiles(r.s).regions.length).toBe(0);
  });
  it("caminho de sweep: cadeia ordenada e detecção de ramificação", () => {
    const p = addPolyline(emptySketch(), [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }], false);
    const ch = pathChain(p.s);
    expect(ch.closed).toBe(false);
    expect(ch.segs.length).toBe(2);
    const bad = addLine(p.s, p.points[1], { x: 100, y: -50 });
    expect(() => pathChain(bad.s)).toThrow(/ramifica/);
  });
});

describe("aparar, estender e offset", () => {
  it("aparar o trecho de uma linha entre duas outras", () => {
    let s = emptySketch();
    const h = addLine(s, { x: 0, y: 0 }, { x: 100, y: 0 });
    s = addLine(h.s, { x: 30, y: -10 }, { x: 30, y: 10 }).s;
    s = addLine(s, { x: 70, y: -10 }, { x: 70, y: 10 }).s;
    const t = trim(s, h.id, { x: 50, y: 0 });
    const lines = Object.values(t.entities).filter((e) => e.t === "line");
    expect(lines.length).toBe(4); // 2 verticais + 2 pedaços
    const total = lines.reduce((a, e) => a + (e.t === "line" ? Math.hypot(pointOf(t, e.p2)!.x - pointOf(t, e.p1)!.x, pointOf(t, e.p2)!.y - pointOf(t, e.p1)!.y) : 0), 0);
    near(total, 20 + 20 + 30 + 30, 1e-9);
    // pontos novos ficam presos às linhas de corte
    expect(t.constraints.filter((c) => c.t === "pointOnLine").length).toBe(2);
    expect(solve(t).status).not.toBe("inconsistent");
  });
  it("estender uma linha até a vizinha", () => {
    let s = emptySketch();
    const a = addLine(s, { x: 0, y: 0 }, { x: 40, y: 0 });
    s = addLine(a.s, { x: 60, y: -10 }, { x: 60, y: 10 }).s;
    const e = extend(s, a.id, { x: 38, y: 0 });
    near(pointOf(e, a.p2)!.x, 60);
  });
  it("offset de uma cadeia fechada mantém a conexão", () => {
    const r = addRectangle(emptySketch(), { x: 0, y: 0 }, { x: 100, y: 50 });
    const o = offset(r.s, r.lines, 5, { x: 50, y: 25 });
    expect(o.ids.length).toBe(4);
    const p = profiles(o.s);
    const inner = p.regions.find((x) => Math.abs(x.area - 90 * 40) < 1e-6);
    expect(inner).toBeTruthy();
  });
});
