import { angleWithin } from "./angle";
import { ellipsePoint, ellipseSweep, isFullEllipse, splineDomain, splinePoint, splineValid } from "./curves";
import type { Entity } from "./entities";
import { entityIntersections } from "./intersect";
import { closestOnEntity } from "./measure";
import { arcPointAt, closestOnSeg, entitySegs, isFullCircle, segEnd, segMid, segStart } from "./segments";
import { type Vec2, add, angleOf, dist, fromAngle, sub } from "./vec";

export type SnapKind =
  | "endpoint"
  | "midpoint"
  | "center"
  | "quadrant"
  | "intersection"
  | "perpendicular"
  | "tangent"
  | "nearest"
  | "node"
  | "grid";

export const SNAP_LABEL: Record<SnapKind, string> = {
  endpoint: "Extremidade",
  midpoint: "Ponto médio",
  center: "Centro",
  quadrant: "Quadrante",
  intersection: "Interseção",
  perpendicular: "Perpendicular",
  tangent: "Tangente",
  nearest: "Mais próximo",
  node: "Nó",
  grid: "Grade",
};

/** Prioridade (menor = preferido quando há candidatos à mesma distância). */
const PRIORITY: Record<SnapKind, number> = {
  endpoint: 0,
  intersection: 1,
  center: 2,
  midpoint: 3,
  quadrant: 4,
  node: 0,
  perpendicular: 5,
  tangent: 5,
  nearest: 9,
  grid: 10,
};

export interface SnapCandidate {
  kind: SnapKind;
  p: Vec2;
  entityId?: string;
}

export type SnapModes = Partial<Record<SnapKind, boolean>>;

/** Pontos característicos de uma entidade para os modos ativos. */
export function entitySnapPoints(e: Entity, modes: SnapModes): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  const push = (kind: SnapKind, p: Vec2) => out.push({ kind, p, entityId: e.id });
  if (e.type === "point") {
    if (modes.node) push("node", e.p);
    return out;
  }
  if (e.type === "text") {
    if (modes.node) push("node", e.p);
    return out;
  }
  if (e.type === "dimension") {
    if (modes.endpoint) {
      push("endpoint", e.p1);
      push("endpoint", e.p2);
    }
    return out;
  }
  if (e.type === "hatch") return out;
  if (e.type === "ellipse") {
    const full = isFullEllipse(e);
    if (modes.center) push("center", e.c);
    if (modes.quadrant) {
      const sw = ellipseSweep(e);
      for (let k = 0; k < 4; k++) {
        const t = (k * Math.PI) / 2;
        if (full || angleWithin(t, e.t0, sw, 1e-9)) push("quadrant", ellipsePoint(e, t));
      }
    }
    if (!full) {
      if (modes.endpoint) {
        push("endpoint", ellipsePoint(e, e.t0));
        push("endpoint", ellipsePoint(e, e.t0 + ellipseSweep(e)));
      }
      if (modes.midpoint) push("midpoint", ellipsePoint(e, e.t0 + ellipseSweep(e) / 2));
    }
    return out;
  }
  if (e.type === "spline") {
    const [u0, u1] = splineDomain(e);
    if (modes.endpoint && !e.closed && splineValid(e)) {
      push("endpoint", splinePoint(e, u0));
      push("endpoint", splinePoint(e, u1));
    }
    if (modes.node && e.fit) for (const q of e.fit) push("node", q);
    return out;
  }
  const segs = entitySegs(e);
  for (const s of segs) {
    if (s.kind === "arc" && isFullCircle(s)) {
      if (modes.center) push("center", s.c);
      if (modes.quadrant) for (let k = 0; k < 4; k++) push("quadrant", add(s.c, fromAngle((k * Math.PI) / 2, s.r)));
      continue;
    }
    if (modes.endpoint) {
      push("endpoint", segStart(s));
      push("endpoint", segEnd(s));
    }
    if (modes.midpoint) push("midpoint", segMid(s));
    if (s.kind === "arc") {
      if (modes.center) push("center", s.c);
      if (modes.quadrant)
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 2;
          if (angleWithin(a, s.a0, s.sweep, 0)) push("quadrant", arcPointAt(s, a - s.a0));
        }
    }
  }
  return out;
}

/** Pé da perpendicular de `from` sobre a entidade (dentro do domínio do segmento). */
export function perpendicularPoints(e: Entity, from: Vec2): Vec2[] {
  const out: Vec2[] = [];
  for (const s of entitySegs(e)) {
    if (s.kind === "line") {
      const d = sub(s.b, s.a);
      const l2 = d.x * d.x + d.y * d.y;
      if (l2 === 0) continue;
      const t = ((from.x - s.a.x) * d.x + (from.y - s.a.y) * d.y) / l2;
      if (t >= 0 && t <= 1) out.push({ x: s.a.x + d.x * t, y: s.a.y + d.y * t });
    } else {
      const ang = angleOf(sub(from, s.c));
      for (const a of [ang, ang + Math.PI]) {
        if (angleWithin(a, s.a0, s.sweep)) out.push(add(s.c, fromAngle(a, s.r)));
      }
    }
  }
  return out;
}

/** Pontos de tangência de `from` em círculos/arcos. */
export function tangentPoints(e: Entity, from: Vec2): Vec2[] {
  const out: Vec2[] = [];
  for (const s of entitySegs(e)) {
    if (s.kind !== "arc") continue;
    const d = dist(from, s.c);
    if (d <= s.r) continue;
    const base = angleOf(sub(from, s.c));
    const off = Math.acos(s.r / d);
    for (const a of [base + off, base - off]) if (angleWithin(a, s.a0, s.sweep)) out.push(add(s.c, fromAngle(a, s.r)));
  }
  return out;
}

export interface SnapQuery {
  cursor: Vec2;
  /** Raio de captura em mm (tolerância em pixels / escala). */
  tolerance: number;
  modes: SnapModes;
  /** Entidades próximas (já filtradas pelo índice espacial). */
  nearby: readonly Entity[];
  /** Ponto base da ferramenta (para perpendicular/tangente). */
  base?: Vec2 | null;
}

/** Resolve o melhor ponto de snap para o cursor. */
export function findSnap(q: SnapQuery): SnapCandidate | null {
  const cands: SnapCandidate[] = [];
  for (const e of q.nearby) {
    cands.push(...entitySnapPoints(e, q.modes));
    if (q.base && q.modes.perpendicular)
      for (const p of perpendicularPoints(e, q.base)) cands.push({ kind: "perpendicular", p, entityId: e.id });
    if (q.base && q.modes.tangent)
      for (const p of tangentPoints(e, q.base)) cands.push({ kind: "tangent", p, entityId: e.id });
  }
  if (q.modes.intersection && q.nearby.length > 1) {
    const list = q.nearby.slice(0, 80);
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        for (const p of entityIntersections(list[i], list[j])) cands.push({ kind: "intersection", p });
  }
  let best: SnapCandidate | null = null;
  let bestScore = Infinity;
  for (const c of cands) {
    const d = dist(c.p, q.cursor);
    if (d > q.tolerance) continue;
    const score = d + PRIORITY[c.kind] * q.tolerance * 0.08;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (!best && q.modes.nearest) {
    let bd = Infinity;
    for (const e of q.nearby) {
      const p = closestOnEntity(q.cursor, e);
      const d = dist(p, q.cursor);
      if (d <= q.tolerance && d < bd) {
        bd = d;
        best = { kind: "nearest", p, entityId: e.id };
      }
    }
  }
  return best;
}

export { closestOnSeg };
