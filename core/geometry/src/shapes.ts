import { normAngle, TAU } from "./angle";
import { lineLine } from "./intersect";
import { type Vec2, add, angleOf, cross, dist, fromAngle, mid, perpL, sub } from "./vec";

/** Vértices de um retângulo alinhado aos eixos a partir de dois cantos opostos (sentido CCW). */
export function rectanglePoints(p1: Vec2, p2: Vec2): Vec2[] {
  const x0 = Math.min(p1.x, p2.x);
  const x1 = Math.max(p1.x, p2.x);
  const y0 = Math.min(p1.y, p2.y);
  const y1 = Math.max(p1.y, p2.y);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/**
 * Polígono regular.
 * @param mode "inscribed" = raio até os vértices; "circumscribed" = raio até o meio dos lados.
 * @param startAngle ângulo do primeiro vértice (inscrito) ou da normal do primeiro lado (circunscrito).
 */
export function regularPolygon(c: Vec2, sides: number, radius: number, startAngle: number, mode: "inscribed" | "circumscribed"): Vec2[] {
  if (!Number.isInteger(sides) || sides < 3 || sides > 1024) throw new Error("Número de lados deve ser inteiro entre 3 e 1024.");
  const step = TAU / sides;
  const R = mode === "inscribed" ? radius : radius / Math.cos(step / 2);
  const a0 = mode === "inscribed" ? startAngle : startAngle + step / 2;
  const out: Vec2[] = [];
  for (let i = 0; i < sides; i++) out.push(add(c, fromAngle(a0 + i * step, R)));
  return out;
}

export interface ArcDef {
  c: Vec2;
  r: number;
  a0: number;
  a1: number;
}

/** Arco por três pontos (início, ponto intermediário, fim). `null` se colineares. */
export function arcFrom3Points(p1: Vec2, p2: Vec2, p3: Vec2): ArcDef | null {
  if (Math.abs(cross(sub(p2, p1), sub(p3, p1))) < 1e-12 * Math.max(1, dist(p1, p3) ** 2)) return null;
  const m1 = mid(p1, p2);
  const m2 = mid(p2, p3);
  const h = lineLine(m1, add(m1, perpL(sub(p2, p1))), m2, add(m2, perpL(sub(p3, p2))));
  if (!h) return null;
  const c = h.p;
  const r = dist(c, p1);
  const a1 = angleOf(sub(p1, c));
  const a3 = angleOf(sub(p3, c));
  const ccw = cross(sub(p2, p1), sub(p3, p2)) > 0;
  return ccw ? { c, r, a0: normAngle(a1), a1: normAngle(a3) } : { c, r, a0: normAngle(a3), a1: normAngle(a1) };
}

/** Círculo por três pontos. */
export function circleFrom3Points(p1: Vec2, p2: Vec2, p3: Vec2): { c: Vec2; r: number } | null {
  const a = arcFrom3Points(p1, p2, p3);
  return a ? { c: a.c, r: a.r } : null;
}
