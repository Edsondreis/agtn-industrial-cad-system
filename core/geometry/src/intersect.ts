import { angleOf, type Vec2, EPS, add, cross, dist, dot, mul, sub } from "./vec";
import { angleWithin, normAngle } from "./angle";
import type { Entity } from "./entities";
import { type ArcSeg, type LineSeg, type Seg, entitySegs } from "./segments";

/**
 * Interseções exatas (analíticas) entre linhas, círculos e arcos.
 * Parâmetros: linha → t ∈ ℝ (0 = a, 1 = b); arco → ângulo absoluto.
 */

export interface LineLineHit {
  p: Vec2;
  t: number;
  u: number;
}

/** Interseção de retas infinitas definidas por (a1,a2) e (b1,b2). `null` se paralelas. */
export function lineLine(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): LineLineHit | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const den = cross(r, s);
  const scale = Math.max(1, Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y));
  if (Math.abs(den) <= 1e-12 * scale) return null;
  const qp = sub(b1, a1);
  const t = cross(qp, s) / den;
  const u = cross(qp, r) / den;
  return { p: add(a1, mul(r, t)), t, u };
}

/** Parâmetros t da reta infinita (a,b) que intersectam o círculo (c,r). */
export function lineCircleParams(a: Vec2, b: Vec2, c: Vec2, r: number): number[] {
  const d = sub(b, a);
  const f = sub(a, c);
  const A = dot(d, d);
  if (A < EPS * EPS) return [];
  const len = Math.sqrt(A);
  // Tangência decidida pela GEOMETRIA (distância centro→reta vs. raio), não pelo
  // discriminante: perto da tangência o discriminante amplifica ruído de 1e-15 em
  // cordas de ~1e-7 mm (meia-corda ≈ √(2rδ)), gerando falsos cruzamentos.
  const tFoot = -dot(f, d) / A;
  const gap = Math.abs(cross(d, f)) / len - r;
  const scale = Math.max(1, r, Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y), Math.abs(c.x), Math.abs(c.y));
  const tolGap = 1e-9 * scale;
  if (gap > tolGap) return [];
  if (gap >= -tolGap) return [tFoot];
  const B = 2 * dot(f, d);
  const C = dot(f, f) - r * r;
  const disc = Math.max(0, B * B - 4 * A * C);
  const sq = Math.sqrt(disc);
  // Forma numericamente estável
  const q = -0.5 * (B + Math.sign(B || 1) * sq);
  const t1 = q / A;
  const t2 = Math.abs(q) > 0 ? C / q : -B / (2 * A);
  return t1 <= t2 ? [t1, t2] : [t2, t1];
}

/** Interseções de dois círculos completos. */
export function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const d = dist(c1, c2);
  if (d < EPS) return [];
  const tol = 1e-9 * Math.max(1, r1, r2);
  if (d > r1 + r2 + tol || d < Math.abs(r1 - r2) - tol) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  let h2 = r1 * r1 - a * a;
  if (h2 < 0) h2 = 0;
  const h = Math.sqrt(h2);
  const ex = { x: (c2.x - c1.x) / d, y: (c2.y - c1.y) / d };
  const pm = add(c1, mul(ex, a));
  if (h <= tol) return [pm];
  return [
    { x: pm.x - ex.y * h, y: pm.y + ex.x * h },
    { x: pm.x + ex.y * h, y: pm.y - ex.x * h },
  ];
}

const T_EPS = 1e-9;
const onArc = (s: ArcSeg, p: Vec2): boolean => angleWithin(angleOf(sub(p, s.c)), s.a0, s.sweep, 1e-9);

export interface SegHitOptions {
  /** Estender o primeiro segmento (reta infinita / círculo completo). */
  extendA?: boolean;
  /** Estender o segundo segmento. */
  extendB?: boolean;
}

/** Interseções entre dois segmentos (limitadas aos seus domínios, salvo extensão). */
export function segSeg(sa: Seg, sb: Seg, opt: SegHitOptions = {}): Vec2[] {
  if (sa.kind === "line" && sb.kind === "line") {
    const h = lineLine(sa.a, sa.b, sb.a, sb.b);
    if (!h) return [];
    const okA = opt.extendA || (h.t >= -T_EPS && h.t <= 1 + T_EPS);
    const okB = opt.extendB || (h.u >= -T_EPS && h.u <= 1 + T_EPS);
    return okA && okB ? [h.p] : [];
  }
  if (sa.kind === "line" && sb.kind === "arc") return lineArc(sa, sb, !!opt.extendA, !!opt.extendB);
  if (sa.kind === "arc" && sb.kind === "line") return lineArc(sb, sa, !!opt.extendB, !!opt.extendA);
  const a = sa as ArcSeg;
  const b = sb as ArcSeg;
  return circleCircle(a.c, a.r, b.c, b.r).filter(
    (p) => (opt.extendA || onArc(a, p)) && (opt.extendB || onArc(b, p)),
  );
}

function lineArc(l: LineSeg, a: ArcSeg, extLine: boolean, extArc: boolean): Vec2[] {
  const ts = lineCircleParams(l.a, l.b, a.c, a.r);
  const out: Vec2[] = [];
  for (const t of ts) {
    if (!extLine && (t < -T_EPS || t > 1 + T_EPS)) continue;
    const p = { x: l.a.x + (l.b.x - l.a.x) * t, y: l.a.y + (l.b.y - l.a.y) * t };
    if (!extArc && !onArc(a, p)) continue;
    out.push(p);
  }
  return out;
}

/** Remove pontos duplicados (tolerância absoluta). */
export function uniquePoints(pts: Vec2[], tol = 1e-7): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) if (!out.some((q) => dist(p, q) <= tol)) out.push(p);
  return out;
}

/** Todas as interseções entre duas entidades. */
export function entityIntersections(e1: Entity, e2: Entity): Vec2[] {
  const s1 = entitySegs(e1);
  const s2 = entitySegs(e2);
  const out: Vec2[] = [];
  for (const a of s1) for (const b of s2) out.push(...segSeg(a, b));
  return uniquePoints(out);
}

/** Interseções internas de uma polilinha (entre segmentos não adjacentes). */
export function selfIntersections(segs: Seg[], closed: boolean, tol = 1e-7): Vec2[] {
  const out: Vec2[] = [];
  const n = segs.length;
  // Na junção de segmentos adjacentes (tangência reta↔arco) o ponto calculado pode
  // desviar ~1e-7 mm do vértice em peças grandes: tolerância proporcional à escala.
  let scale = 1;
  for (const s of segs) {
    const ps = s.kind === "line" ? [s.a, s.b] : [s.c];
    for (const q of ps) scale = Math.max(scale, Math.abs(q.x), Math.abs(q.y));
    if (s.kind === "arc") scale = Math.max(scale, s.r);
  }
  const jTol = Math.max(tol, 1e-8 * scale);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (closed && i === 0 && j === n - 1);
      const hits = segSeg(segs[i], segs[j]);
      for (const p of hits) {
        if (adjacent) {
          // Ponto de junção compartilhado não é autointerseção
          const shared = [segs[i], segs[j]].every((s) => {
            const ends = s.kind === "line" ? [s.a, s.b] : [arcEndpoints(s)[0], arcEndpoints(s)[1]];
            return ends.some((q) => dist(q, p) <= jTol);
          });
          if (shared) continue;
        }
        out.push(p);
      }
    }
  }
  return uniquePoints(out, tol);
}

function arcEndpoints(s: ArcSeg): [Vec2, Vec2] {
  return [
    { x: s.c.x + Math.cos(s.a0) * s.r, y: s.c.y + Math.sin(s.a0) * s.r },
    { x: s.c.x + Math.cos(s.a0 + s.sweep) * s.r, y: s.c.y + Math.sin(s.a0 + s.sweep) * s.r },
  ];
}

/** Parâmetro de um ponto ao longo do segmento: linha → t; arco → ângulo relativo a a0. */
export function segParam(s: Seg, p: Vec2): number {
  if (s.kind === "line") {
    const d = sub(s.b, s.a);
    const l2 = dot(d, d);
    return l2 < EPS * EPS ? 0 : dot(sub(p, s.a), d) / l2;
  }
  return normAngle(angleOf(sub(p, s.c)) - s.a0);
}
