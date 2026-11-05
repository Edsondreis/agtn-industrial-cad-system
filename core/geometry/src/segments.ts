import { TAU, ccwSweep, normAngle, angleWithin } from "./angle";
import type { Entity, PolylineEntity } from "./entities";
import { type Vec2, EPS, add, angleOf, dist, fromAngle, mid, mul, norm, perpL, sub } from "./vec";

/**
 * Primitivas geométricas elementares usadas por interseção, snap, trim e offset.
 * Arcos são sempre armazenados CCW com início a0 e varredura `sweep` (0, 2π].
 * `rev = true` indica que o sentido de percurso original (ex.: polilinha com bulge negativo) é horário.
 */
export interface LineSeg {
  readonly kind: "line";
  readonly a: Vec2;
  readonly b: Vec2;
}
export interface ArcSeg {
  readonly kind: "arc";
  readonly c: Vec2;
  readonly r: number;
  readonly a0: number;
  readonly sweep: number;
  readonly rev: boolean;
}
export type Seg = LineSeg | ArcSeg;

export const lineSeg = (a: Vec2, b: Vec2): LineSeg => ({ kind: "line", a, b });
export const arcSeg = (c: Vec2, r: number, a0: number, sweep: number, rev = false): ArcSeg => ({
  kind: "arc",
  c,
  r,
  a0: normAngle(a0),
  sweep,
  rev,
});

export const arcPointAt = (s: ArcSeg, t: number): Vec2 => add(s.c, fromAngle(s.a0 + t, s.r));
export const arcStart = (s: ArcSeg): Vec2 => arcPointAt(s, 0);
export const arcEnd = (s: ArcSeg): Vec2 => arcPointAt(s, s.sweep);
export const isFullCircle = (s: ArcSeg): boolean => s.sweep >= TAU - 1e-12;

/** Ponto inicial no sentido de percurso. */
export function segStart(s: Seg): Vec2 {
  if (s.kind === "line") return s.a;
  return s.rev ? arcEnd(s) : arcStart(s);
}
export function segEnd(s: Seg): Vec2 {
  if (s.kind === "line") return s.b;
  return s.rev ? arcStart(s) : arcEnd(s);
}

export function segLength(s: Seg): number {
  return s.kind === "line" ? dist(s.a, s.b) : s.r * s.sweep;
}

export function segMid(s: Seg): Vec2 {
  return s.kind === "line" ? mid(s.a, s.b) : arcPointAt(s, s.sweep / 2);
}

/** Converte um segmento de polilinha com bulge em primitiva. */
export function bulgeSeg(p1: Vec2, p2: Vec2, bulge: number): Seg {
  if (Math.abs(bulge) < 1e-12) return lineSeg(p1, p2);
  const c = dist(p1, p2);
  if (c < EPS) return lineSeg(p1, p2);
  const d = norm(sub(p2, p1));
  const off = (c / 2) * ((1 - bulge * bulge) / (2 * bulge));
  const center = add(mid(p1, p2), mul(perpL(d), off));
  const r = (c * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const sweep = 4 * Math.atan(Math.abs(bulge));
  if (bulge > 0) {
    return arcSeg(center, r, angleOf(sub(p1, center)), sweep, false);
  }
  return arcSeg(center, r, angleOf(sub(p2, center)), sweep, true);
}

/** Bulge de um arco percorrido de `from` até `to` com varredura assinada `signedSweep`. */
export const bulgeFromSweep = (signedSweep: number): number => Math.tan(signedSweep / 4);

export function polylineSegs(p: PolylineEntity): Seg[] {
  const out: Seg[] = [];
  const n = p.pts.length;
  const count = p.closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = p.pts[i];
    const b = p.pts[(i + 1) % n];
    out.push(bulgeSeg(a, b, p.bulges[i] ?? 0));
  }
  return out;
}

/** Decompõe uma entidade em primitivas geométricas (texto e ponto não geram segmentos). */
export function entitySegs(e: Entity): Seg[] {
  switch (e.type) {
    case "line":
      return [lineSeg(e.a, e.b)];
    case "circle":
      return [arcSeg(e.c, e.r, 0, TAU)];
    case "arc":
      return [arcSeg(e.c, e.r, e.a0, ccwSweep(e.a0, e.a1))];
    case "polyline":
      return polylineSegs(e);
    default:
      return [];
  }
}

/** Ponto mais próximo sobre o segmento. */
export function closestOnSeg(p: Vec2, s: Seg): Vec2 {
  if (s.kind === "line") {
    const ab = sub(s.b, s.a);
    const l2 = ab.x * ab.x + ab.y * ab.y;
    if (l2 < EPS * EPS) return s.a;
    let t = ((p.x - s.a.x) * ab.x + (p.y - s.a.y) * ab.y) / l2;
    t = Math.max(0, Math.min(1, t));
    return { x: s.a.x + ab.x * t, y: s.a.y + ab.y * t };
  }
  const ang = angleOf(sub(p, s.c));
  if (angleWithin(ang, s.a0, s.sweep)) return add(s.c, fromAngle(ang, s.r));
  const ps = arcStart(s);
  const pe = arcEnd(s);
  return dist(p, ps) <= dist(p, pe) ? ps : pe;
}

export const distToSeg = (p: Vec2, s: Seg): number => dist(p, closestOnSeg(p, s));
