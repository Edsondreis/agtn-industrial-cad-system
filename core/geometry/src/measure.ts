import { ccwSweep, TAU } from "./angle";
import { entityBox, textCorners } from "./bbox";
import { hatchLoopPolygon, pointInHatch } from "./curves";
import type { Entity } from "./entities";
import { closestOnSeg, entitySegs, lineSeg, segLength } from "./segments";
import { type Vec2, dist } from "./vec";

/** Comprimento geométrico real da entidade (mm). */
export function entityLength(e: Entity): number {
  switch (e.type) {
    case "line":
      return dist(e.a, e.b);
    case "circle":
      return TAU * e.r;
    case "arc":
      return e.r * ccwSweep(e.a0, e.a1);
    case "polyline":
    case "ellipse":
    case "spline":
      return entitySegs(e).reduce((s, g) => s + segLength(g), 0);
    default:
      return 0;
  }
}

/** Área de polilinha fechada (fórmula de Gauss + segmentos circulares), com sinal (CCW > 0). */
export function polylineSignedArea(pts: readonly Vec2[], bulges: readonly number[]): number {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
    const b = bulges[i] ?? 0;
    if (Math.abs(b) > 1e-12) {
      const c = dist(p, q);
      const th = 4 * Math.atan(b);
      const r = (c * (1 + b * b)) / (4 * Math.abs(b));
      // área do segmento circular, com sinal do bulge
      a += 2 * Math.sign(b) * ((r * r) / 2) * (Math.abs(th) - Math.sin(Math.abs(th)));
    }
  }
  return a / 2;
}

/** Ponto mais próximo sobre a entidade. */
export function closestOnEntity(p: Vec2, e: Entity): Vec2 {
  if (e.type === "point") return e.p;
  if (e.type === "text") return e.p;
  if (e.type === "dimension") {
    const segs = [lineSeg(e.p1, e.loc), lineSeg(e.p2, e.loc), lineSeg(e.p1, e.p2)];
    let best = e.loc;
    let bd = Infinity;
    for (const s of segs) {
      const q = closestOnSeg(p, s);
      const d = dist(p, q);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best;
  }
  let best: Vec2 = p;
  let bd = Infinity;
  for (const s of entitySegs(e)) {
    const q = closestOnSeg(p, s);
    const d = dist(p, q);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

/** Distância do ponto até a entidade (para seleção por clique). */
export function distToEntity(p: Vec2, e: Entity): number {
  if (e.type === "text") {
    const c = textCorners(e.p, e.h, e.rot, e.value, e.halign);
    if (pointInPolygon(p, c)) return 0;
    let d = Infinity;
    for (let i = 0; i < 4; i++) d = Math.min(d, dist(p, closestOnSeg(p, lineSeg(c[i], c[(i + 1) % 4]))));
    return d;
  }
  if (e.type === "hatch") {
    if (pointInHatch(p, e.loops.map(hatchLoopPolygon))) return 0;
  }
  if (e.type === "dimension") {
    const b = entityBox(e);
    if (p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY) return dist(p, closestOnEntity(p, e)) * 0.5;
  }
  return dist(p, closestOnEntity(p, e));
}

export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Ângulo (rad, 0..π) entre duas direções. */
export function angleBetween(u: Vec2, w: Vec2): number {
  const d = (u.x * w.x + u.y * w.y) / (Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y));
  return Math.acos(Math.max(-1, Math.min(1, d)));
}
