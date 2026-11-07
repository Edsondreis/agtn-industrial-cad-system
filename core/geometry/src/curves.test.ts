import { describe, expect, it } from "vitest";
import {
  type EllipseEntity,
  type Entity,
  TAU,
  closestOnEntity,
  dist,
  distToEntity,
  ellipsePoint,
  entityBox,
  entityLength,
  explodeCurve,
  hatchArea,
  hatchLoopPolygon,
  hatchPatternByName,
  hatchPatternSegments,
  interpolateSpline,
  makeEntity,
  mirrorLine,
  patternLines,
  rotation,
  splinePoint,
  transformEntity,
  transformEntityAffine,
} from "./index";

const E = (major: { x: number; y: number }, ratio: number, t0 = 0, t1 = TAU) =>
  makeEntity({ type: "ellipse", c: { x: 10, y: 20 }, major, ratio, t0, t1 }, "0") as EllipseEntity;

describe("elipse", () => {
  it("perímetro de Ramanujan e caixa envolvente", () => {
    const e = E({ x: 50, y: 0 }, 0.5);
    const a = 50;
    const b = 25;
    const h = ((a - b) / (a + b)) ** 2;
    const ram = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    expect(Math.abs(entityLength(e) - ram) / ram).toBeLessThan(1e-4);
    const bb = entityBox(e);
    expect(bb.maxX).toBeCloseTo(60, 6);
    expect(bb.maxY).toBeCloseTo(45, 3);
  });
  it("espelhar e girar mantém os mesmos pontos", () => {
    const e = E({ x: 30, y: 10 }, 0.4, 0.5, 3.9);
    for (const m of [mirrorLine({ x: 0, y: 0 }, { x: 1, y: 2 }), rotation(1.1, { x: 3, y: 4 })]) {
      const t = transformEntity(e, m);
      for (let i = 0; i <= 10; i++) {
        const q = ellipsePoint(e, 0.5 + (3.4 * i) / 10);
        const img = { x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f };
        expect(dist(img, closestOnEntity(img, t))).toBeLessThan(1e-3);
      }
    }
  });
  it("círculo em bloco com escala não uniforme vira elipse exata", () => {
    const c = makeEntity({ type: "circle", c: { x: 0, y: 0 }, r: 10 }, "0");
    const m = { a: 3, b: 0, c: 0, d: 1, e: 5, f: 0 };
    const t = transformEntityAffine(c, m) as EllipseEntity;
    expect(t.type).toBe("ellipse");
    expect(Math.hypot(t.major.x, t.major.y)).toBeCloseTo(30, 9);
    expect(t.ratio).toBeCloseTo(1 / 3, 9);
    const arc = makeEntity({ type: "arc", c: { x: 0, y: 0 }, r: 10, a0: 0, a1: Math.PI / 2 }, "0");
    const ta = transformEntityAffine(arc, { a: 2, b: 0, c: 0, d: -1, e: 0, f: 0 }) as EllipseEntity;
    // arco de (10,0) a (0,10) espelhado em Y e esticado em X → de (20,0) a (0,−10)
    const segEnds = [ellipsePoint(ta, ta.t0), ellipsePoint(ta, ta.t1)];
    const want = [{ x: 20, y: 0 }, { x: 0, y: -10 }];
    for (const w of want) expect(Math.min(...segEnds.map((s) => dist(s, w)))).toBeLessThan(1e-9);
  });
});

describe("spline", () => {
  it("interpolação passa por todos os pontos de ajuste", () => {
    const fit = [{ x: 0, y: 0 }, { x: 10, y: 15 }, { x: 25, y: 5 }, { x: 40, y: 30 }, { x: 60, y: 0 }];
    const s = interpolateSpline(fit);
    expect(s.degree).toBe(3);
    const sp = makeEntity({ type: "spline", ...s }, "0");
    for (const q of fit) expect(dist(q, closestOnEntity(q, sp))).toBeLessThan(1e-6);
    expect(dist(splinePoint(s, 0), fit[0])).toBeLessThan(1e-9);
    expect(dist(splinePoint(s, 1), fit[4])).toBeLessThan(1e-9);
  });
  it("explodir gera polilinha que segue a curva", () => {
    const s = makeEntity({ type: "spline", ...interpolateSpline([{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 0 }]) }, "L1", { color: 3 });
    const [pl] = explodeCurve(s) as Entity[];
    expect(pl.type).toBe("polyline");
    expect(pl.layer).toBe("L1");
    expect(pl.color).toBe(3);
    expect(Math.abs(entityLength(pl) - entityLength(s))).toBeLessThan(1e-9);
  });
});

describe("hachura", () => {
  const square = { pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], bulges: [0, 0, 0, 0] };
  const hole = { pts: [{ x: 40, y: 50 }, { x: 60, y: 50 }], bulges: [1, 1] }; // círculo r=10
  it("área desconta o furo", () => {
    const polys = [square, hole].map(hatchLoopPolygon);
    expect(hatchArea(polys, [square, hole])).toBeCloseTo(10000 - Math.PI * 100, 9);
  });
  it("padrão LINE: linhas horizontais a cada 3,175 mm recortadas pelo furo", () => {
    const lines = patternLines(hatchPatternByName("LINE")!, 0, 1);
    const polys = [square].map(hatchLoopPolygon);
    const { segs } = hatchPatternSegments(polys, lines);
    expect(segs.length).toBe(Math.floor(100 / 3.175) + 1 - (100 % 3.175 === 0 ? 0 : 0));
    for (const [a, b] of segs) expect(Math.abs(b.x - a.x)).toBeCloseTo(100, 9);
    const withHole = hatchPatternSegments([square, hole].map(hatchLoopPolygon), lines).segs;
    const total = withHole.reduce((s, [a, b]) => s + dist(a, b), 0);
    expect(total).toBeLessThan(segs.length * 100);
  });
  it("padrão denso demais é limitado sem travar", () => {
    const lines = patternLines(hatchPatternByName("ANSI31")!, 0, 0.0001);
    const r = hatchPatternSegments([square].map(hatchLoopPolygon), lines);
    expect(r.truncated).toBe(true);
  });
  it("seleção por clique dentro da área (fora do furo)", () => {
    const h = makeEntity({ type: "hatch", loops: [square, hole], solid: true, pattern: "SOLID", patternAngle: 0, patternScale: 1, lines: [] }, "0");
    expect(distToEntity({ x: 10, y: 10 }, h)).toBe(0);
    expect(distToEntity({ x: 50, y: 50 }, h)).toBeGreaterThan(5);
  });
});
