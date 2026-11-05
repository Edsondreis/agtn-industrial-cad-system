import { ccwSweep, normAngle, TAU } from "./angle";
import { type BBox, boxContainsPoint } from "./bbox";
import type { ArcEntity, Entity, LineEntity, PolylineEntity } from "./entities";
import { newId } from "./entities";
import { circleCircle, lineCircleParams, lineLine, segParam, segSeg } from "./intersect";
import {
  type Seg,
  arcSeg,
  bulgeSeg,
  closestOnSeg,
  entitySegs,
  lineSeg,
  polylineSegs,
  segEnd,
  segStart,
} from "./segments";
import { translation, transformEntity } from "./transform";
import { type Vec2, add, angleOf, dist, dot, fromAngle, mul, norm, perpL, samePoint, sub } from "./vec";

export type OpResult<T> = { ok: true; value: T } | { ok: false; reason: string };
const fail = <T>(reason: string): OpResult<T> => ({ ok: false, reason });
const ok = <T>(value: T): OpResult<T> => ({ ok: true, value });

const P_EPS = 1e-9;

/* ------------------------------------------------------------------ */
/* Parametrização de percurso (linhas/arcos/polilinhas)                */
/* ------------------------------------------------------------------ */

/** Ponto no parâmetro local t ∈ [0,1] no sentido de percurso. */
export function segPointAt(s: Seg, t: number): Vec2 {
  if (s.kind === "line") return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
  const u = s.rev ? s.sweep * (1 - t) : s.sweep * t;
  return add(s.c, fromAngle(s.a0 + u, s.r));
}

/** Parâmetro local t ∈ [0,1] (sentido de percurso) de um ponto sobre o segmento. */
export function segTravelParam(s: Seg, p: Vec2): number {
  if (s.kind === "line") return segParam(s, p);
  let u = segParam(s, p);
  if (u > s.sweep + 1e-9) u = u - s.sweep > TAU - u ? 0 : s.sweep; // ponto fora: projeta no extremo mais próximo
  const t = u / s.sweep;
  return s.rev ? 1 - t : t;
}

/** Bulge do sub-trecho [t0,t1] de um segmento de polilinha. */
function subBulge(s: Seg, t0: number, t1: number): number {
  if (s.kind === "line") return 0;
  const th = s.sweep * (t1 - t0);
  return (s.rev ? -1 : 1) * Math.tan(th / 4);
}

/** Extrai o trecho de polilinha entre parâmetros globais g0 < g1 (g = índice do segmento + t local). */
function subPolyline(segs: Seg[], g0: number, g1: number): { pts: Vec2[]; bulges: number[] } {
  const pts: Vec2[] = [];
  const bulges: number[] = [];
  const n = segs.length;
  let g = g0;
  while (g < g1 - P_EPS) {
    const k = Math.floor(g + 1e-12); // contador absoluto (pode passar de n em polilinha fechada)
    const t0 = Math.max(0, g - k);
    const gEnd = Math.min(k + 1, g1);
    const t1 = gEnd - k;
    const s = segs[((k % n) + n) % n];
    const last = gEnd >= g1 - P_EPS;
    if (t1 - t0 > 1e-12) {
      pts.push(segPointAt(s, t0));
      bulges.push(subBulge(s, t0, t1));
    }
    if (last) {
      pts.push(segPointAt(s, t1));
      bulges.push(0);
    }
    g = gEnd;
  }
  return { pts, bulges };
}

/* ------------------------------------------------------------------ */
/* TRIM                                                                */
/* ------------------------------------------------------------------ */

function cutParamsOnSeg(s: Seg, cutters: readonly Entity[]): number[] {
  const out: number[] = [];
  for (const c of cutters) for (const cs of entitySegs(c)) for (const p of segSeg(s, cs)) out.push(segTravelParam(s, p));
  return out;
}

/**
 * Apara a entidade no trecho que contém `pick`, delimitado pelas interseções com `cutters`.
 * Retorna as entidades resultantes (a primeira mantém o id original). Lista vazia = entidade removida.
 */
export function trimEntity(target: Entity, cutters: readonly Entity[], pick: Vec2): OpResult<Entity[]> {
  const others = cutters.filter((c) => c.id !== target.id);
  switch (target.type) {
    case "line": {
      const s = lineSeg(target.a, target.b);
      const ts = cutParamsOnSeg(s, others).filter((t) => t > P_EPS && t < 1 - P_EPS);
      if (!ts.length) return fail("Nenhuma aresta de corte intercepta o objeto.");
      const tp = segTravelParam(s, closestOnSeg(pick, s));
      const lo = Math.max(0, ...ts.filter((t) => t <= tp));
      const hi = Math.min(1, ...ts.filter((t) => t > tp));
      const out: Entity[] = [];
      if (lo > P_EPS) out.push({ ...target, b: segPointAt(s, lo) });
      if (hi < 1 - P_EPS) out.push({ ...target, id: out.length ? newId() : target.id, a: segPointAt(s, hi) });
      return ok(out);
    }
    case "arc": {
      const sw = ccwSweep(target.a0, target.a1);
      const s = arcSeg(target.c, target.r, target.a0, sw);
      const ts = cutParamsOnSeg(s, others).filter((t) => t > P_EPS && t < 1 - P_EPS);
      if (!ts.length) return fail("Nenhuma aresta de corte intercepta o arco.");
      const tp = segTravelParam(s, closestOnSeg(pick, s));
      const lo = Math.max(0, ...ts.filter((t) => t <= tp));
      const hi = Math.min(1, ...ts.filter((t) => t > tp));
      const out: Entity[] = [];
      if (lo > P_EPS) out.push({ ...target, a1: normAngle(target.a0 + sw * lo) });
      if (hi < 1 - P_EPS)
        out.push({ ...target, id: out.length ? newId() : target.id, a0: normAngle(target.a0 + sw * hi) });
      return ok(out);
    }
    case "circle": {
      const s = arcSeg(target.c, target.r, 0, TAU);
      const angs = uniqueSorted(cutParamsOnSeg(s, others).map((t) => normAngle(t * TAU)));
      if (angs.length < 2) return fail("Um círculo precisa de pelo menos duas interseções para ser aparado.");
      const pa = normAngle(angleOf(sub(pick, target.c)));
      let lo = angs[angs.length - 1];
      let hi = angs[0];
      for (let i = 0; i < angs.length; i++) {
        const a = angs[i];
        const b = angs[(i + 1) % angs.length];
        const inGap = i === angs.length - 1 ? pa >= a || pa < b : pa >= a && pa < b;
        if (inGap) {
          lo = a;
          hi = b;
          break;
        }
      }
      // remove o trecho lo→hi (CCW) e mantém hi→lo
      const arc: ArcEntity = {
        type: "arc",
        id: target.id,
        layer: target.layer,
        color: target.color,
        lineweight: target.lineweight,
        linetype: target.linetype,
        c: target.c,
        r: target.r,
        a0: hi,
        a1: lo,
      };
      return ok([arc]);
    }
    case "polyline": {
      const segs = polylineSegs(target);
      const n = segs.length;
      const cuts: number[] = [];
      segs.forEach((s, i) => {
        for (const t of cutParamsOnSeg(s, others)) cuts.push(i + t);
      });
      // inclui auto-interseções com segmentos da própria polilinha como arestas de corte
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          if (Math.abs(i - j) <= 1 || (target.closed && Math.abs(i - j) === n - 1)) continue;
          for (const p of segSeg(segs[i], segs[j])) cuts.push(i + segTravelParam(segs[i], p));
        }
      const total = n;
      let g = uniqueSorted(cuts.filter((c) => c > P_EPS && c < total - P_EPS));
      if (target.closed) {
        // vértices de uma polilinha fechada não são pontos de corte; precisa de ≥ 2 cortes
        if (g.length < 2) return fail("A polilinha fechada precisa de pelo menos duas interseções.");
      } else if (!g.length) return fail("Nenhuma aresta de corte intercepta a polilinha.");
      let bestI = 0;
      let bd = Infinity;
      segs.forEach((s, i) => {
        const d = dist(pick, closestOnSeg(pick, s));
        if (d < bd) {
          bd = d;
          bestI = i;
        }
      });
      const gp = bestI + segTravelParam(segs[bestI], closestOnSeg(pick, segs[bestI]));
      const mk = (pts: Vec2[], bulges: number[], id: string): PolylineEntity => ({
        ...target,
        id,
        pts,
        bulges,
        closed: false,
      });
      if (!target.closed) {
        const lo = Math.max(0, ...g.filter((c) => c <= gp));
        const hi = Math.min(total, ...g.filter((c) => c > gp));
        const out: Entity[] = [];
        if (lo > P_EPS) {
          const r = subPolyline(segs, 0, lo);
          out.push(mk(r.pts, r.bulges, target.id));
        }
        if (hi < total - P_EPS) {
          const r = subPolyline(segs, hi, total);
          out.push(mk(r.pts, r.bulges, out.length ? newId() : target.id));
        }
        return ok(out);
      }
      g = g.slice();
      let lo = g[g.length - 1] - total;
      let hi = g[0];
      for (let i = 0; i < g.length; i++) {
        const a = g[i];
        const b = i + 1 < g.length ? g[i + 1] : g[0] + total;
        const gpp = gp < a ? gp + total : gp;
        if (gpp >= a && gpp < b) {
          lo = a;
          hi = b;
          break;
        }
      }
      // mantém hi → lo + total
      const r = subPolyline(segs, hi, lo + total);
      return ok([mk(r.pts, r.bulges, target.id)]);
    }
    default:
      return fail("TRIM não se aplica a este tipo de objeto.");
  }
}

function uniqueSorted(v: number[], eps = 1e-9): number[] {
  const s = v.slice().sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of s) if (!out.length || x - out[out.length - 1] > eps) out.push(x);
  return out;
}

/* ------------------------------------------------------------------ */
/* EXTEND                                                              */
/* ------------------------------------------------------------------ */

/** Estende a extremidade de linha/arco/polilinha aberta mais próxima de `pick` até o limite mais próximo. */
export function extendEntity(target: Entity, boundaries: readonly Entity[], pick: Vec2): OpResult<Entity> {
  const others = boundaries.filter((b) => b.id !== target.id);
  const bsegs = others.flatMap(entitySegs);
  if (target.type === "line") {
    const s = lineSeg(target.a, target.b);
    const tp = segTravelParam(s, closestOnSeg(pick, s));
    const atEnd = tp >= 0.5;
    let best: number | null = null;
    for (const b of bsegs)
      for (const p of segSeg(s, b, { extendA: true })) {
        const t = segParam(s, p);
        if (atEnd && t > 1 + P_EPS && (best === null || t < best)) best = t;
        if (!atEnd && t < -P_EPS && (best === null || t > best)) best = t;
      }
    if (best === null) return fail("Nenhum limite encontrado na direção da extensão.");
    const np = segPointAt(s, best);
    return ok(atEnd ? { ...target, b: np } : { ...target, a: np });
  }
  if (target.type === "arc") {
    const sw = ccwSweep(target.a0, target.a1);
    const full = arcSeg(target.c, target.r, 0, TAU);
    const pa = normAngle(angleOf(sub(pick, target.c)));
    const atEnd = normAngle(pa - target.a0) >= sw / 2;
    const gap = TAU - sw;
    let best: number | null = null;
    for (const b of bsegs)
      for (const p of segSeg(full, b)) {
        const ang = angleOf(sub(p, target.c));
        const delta = atEnd ? normAngle(ang - target.a1) : normAngle(target.a0 - ang);
        if (delta > 1e-9 && delta < gap - 1e-9 && (best === null || delta < best)) best = delta;
      }
    if (best === null) return fail("Nenhum limite encontrado na direção da extensão.");
    return ok(atEnd ? { ...target, a1: normAngle(target.a1 + best) } : { ...target, a0: normAngle(target.a0 - best) });
  }
  if (target.type === "polyline" && !target.closed && target.pts.length >= 2) {
    const n = target.pts.length;
    const atEnd = dist(pick, target.pts[n - 1]) < dist(pick, target.pts[0]);
    const a = atEnd ? target.pts[n - 2] : target.pts[1];
    const b = atEnd ? target.pts[n - 1] : target.pts[0];
    const bulge = atEnd ? target.bulges[n - 2] : target.bulges[0];
    if (Math.abs(bulge ?? 0) > 1e-12) return fail("EXTEND de polilinha suporta apenas segmentos finais retos.");
    const s = lineSeg(a, b);
    let best: number | null = null;
    for (const bs of bsegs)
      for (const p of segSeg(s, bs, { extendA: true })) {
        const t = segParam(s, p);
        if (t > 1 + P_EPS && (best === null || t < best)) best = t;
      }
    if (best === null) return fail("Nenhum limite encontrado na direção da extensão.");
    const np = segPointAt(s, best);
    const pts = target.pts.slice();
    if (atEnd) pts[n - 1] = np;
    else pts[0] = np;
    return ok({ ...target, pts });
  }
  return fail("EXTEND se aplica a linhas, arcos e polilinhas abertas.");
}

/* ------------------------------------------------------------------ */
/* OFFSET                                                              */
/* ------------------------------------------------------------------ */

interface OffEl {
  kind: "line" | "arc";
  s: Vec2;
  e: Vec2;
  c?: Vec2;
  r?: number;
  /** percurso anti-horário (apenas arcos) */
  ccw?: boolean;
  origStart: Vec2;
  origEnd: Vec2;
}

function offsetSegEl(s: Seg, d: number): OffEl | null {
  // d > 0 desloca para a esquerda do sentido de percurso
  const st = segStart(s);
  const en = segEnd(s);
  if (s.kind === "line") {
    const n = mul(perpL(norm(sub(s.b, s.a))), d);
    return { kind: "line", s: add(st, n), e: add(en, n), origStart: st, origEnd: en };
  }
  const ccw = !s.rev;
  // percurso CCW: esquerda = em direção ao centro
  const r = ccw ? s.r - d : s.r + d;
  if (r <= 1e-9) return null;
  const k = r / s.r;
  const sc = (p: Vec2) => add(s.c, mul(sub(p, s.c), k));
  return { kind: "arc", s: sc(st), e: sc(en), c: s.c, r, ccw, origStart: st, origEnd: en };
}

function joinEls(a: OffEl, b: OffEl, vertex: Vec2, d: number): Vec2 | null {
  if (samePoint(a.e, b.s, 1e-7)) return a.e;
  let cands: Vec2[] = [];
  if (a.kind === "line" && b.kind === "line") {
    const h = lineLine(a.s, a.e, b.s, b.e);
    if (h) cands = [h.p];
  } else if (a.kind === "line" && b.kind === "arc") {
    cands = lineCircleParams(a.s, a.e, b.c!, b.r!).map((t) => add(a.s, mul(sub(a.e, a.s), t)));
  } else if (a.kind === "arc" && b.kind === "line") {
    cands = lineCircleParams(b.s, b.e, a.c!, a.r!).map((t) => add(b.s, mul(sub(b.e, b.s), t)));
  } else {
    cands = circleCircle(a.c!, a.r!, b.c!, b.r!);
  }
  if (!cands.length) return null;
  cands.sort((p, q) => dist(p, vertex) - dist(q, vertex));
  const best = cands[0];
  if (dist(best, vertex) > Math.abs(d) * 50) return null;
  return best;
}

function elBulge(el: OffEl): number {
  if (el.kind === "line") return 0;
  const a0 = angleOf(sub(el.s, el.c!));
  const a1 = angleOf(sub(el.e, el.c!));
  const sw = el.ccw ? normAngle(a1 - a0) : normAngle(a0 - a1);
  return (el.ccw ? 1 : -1) * Math.tan(sw / 4);
}

/** Lado (+1 esquerda, −1 direita) de `p` em relação ao segmento mais próximo da lista. */
function sideOf(segs: Seg[], p: Vec2): number {
  let best: Seg = segs[0];
  let bd = Infinity;
  for (const s of segs) {
    const d = dist(p, closestOnSeg(p, s));
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  if (best.kind === "line") {
    const cr = (best.b.x - best.a.x) * (p.y - best.a.y) - (best.b.y - best.a.y) * (p.x - best.a.x);
    return cr >= 0 ? 1 : -1;
  }
  const inside = dist(p, best.c) < best.r;
  // CCW: centro à esquerda
  return inside === !best.rev ? 1 : -1;
}

/** OFFSET de uma entidade a uma distância `d` (> 0) no lado indicado por `sidePoint`. */
export function offsetEntity(e: Entity, d: number, sidePoint: Vec2): OpResult<Entity> {
  if (!(d > 0) || !Number.isFinite(d)) return fail("Distância de offset deve ser positiva.");
  const id = newId();
  switch (e.type) {
    case "line": {
      const side = sideOf([lineSeg(e.a, e.b)], sidePoint);
      const n = mul(perpL(norm(sub(e.b, e.a))), d * side);
      return ok({ ...e, id, a: add(e.a, n), b: add(e.b, n) });
    }
    case "circle": {
      const inside = dist(sidePoint, e.c) < e.r;
      const r = inside ? e.r - d : e.r + d;
      if (r <= 1e-9) return fail("Offset maior que o raio do círculo.");
      return ok({ ...e, id, r });
    }
    case "arc": {
      const inside = dist(sidePoint, e.c) < e.r;
      const r = inside ? e.r - d : e.r + d;
      if (r <= 1e-9) return fail("Offset maior que o raio do arco.");
      return ok({ ...e, id, r });
    }
    case "polyline": {
      const segs = polylineSegs(e);
      if (!segs.length) return fail("Polilinha vazia.");
      const side = sideOf(segs, sidePoint);
      const els: OffEl[] = [];
      for (const s of segs) {
        const el = offsetSegEl(s, d * side);
        if (!el) return fail("Offset maior que o raio de um trecho em arco da polilinha.");
        els.push(el);
      }
      const n = els.length;
      const joins = e.closed ? n : n - 1;
      for (let i = 0; i < joins; i++) {
        const a = els[i];
        const b = els[(i + 1) % n];
        const j = joinEls(a, b, a.origEnd, d);
        if (!j) return fail("Não foi possível unir os trechos deslocados (geometria incompatível com o offset).");
        a.e = j;
        b.s = j;
      }
      for (const el of els) {
        if (el.kind === "line") {
          const od = sub(el.origEnd, el.origStart);
          const nd = sub(el.e, el.s);
          if (dot(od, nd) <= 0) return fail("Offset grande demais: um segmento seria invertido.");
        }
      }
      const pts = els.map((el) => el.s);
      if (!e.closed) pts.push(els[n - 1].e);
      const bulges = els.map(elBulge);
      if (!e.closed) bulges.push(0);
      return ok({ ...e, id, pts, bulges });
    }
    default:
      return fail("OFFSET se aplica a linhas, círculos, arcos e polilinhas.");
  }
}

/* ------------------------------------------------------------------ */
/* FILLET / CHAMFER (entre duas linhas)                                */
/* ------------------------------------------------------------------ */

export interface CornerResult {
  l1: LineEntity;
  l2: LineEntity;
  /** arco (fillet) ou linha (chamfer); ausente quando raio/distâncias = 0 */
  corner?: { type: "arc"; c: Vec2; r: number; a0: number; a1: number } | { type: "line"; a: Vec2; b: Vec2 };
}

function cornerSetup(l1: LineEntity, pick1: Vec2, l2: LineEntity, pick2: Vec2) {
  const h = lineLine(l1.a, l1.b, l2.a, l2.b);
  if (!h) return null;
  const X = h.p;
  // lado mantido: extremidade do mesmo lado do ponto de seleção em relação a X
  const keep = (l: LineEntity, pick: Vec2) => {
    const dir = norm(sub(l.b, l.a));
    const sp = dot(sub(pick, X), dir);
    const u = sp >= 0 ? dir : mul(dir, -1);
    const da = dot(sub(l.a, X), u);
    const db = dot(sub(l.b, X), u);
    const far = da >= db ? l.a : l.b;
    return { u, far, farDist: Math.max(da, db) };
  };
  return { X, k1: keep(l1, pick1), k2: keep(l2, pick2) };
}

const setLine = (l: LineEntity, far: Vec2, near: Vec2): LineEntity => ({ ...l, a: far, b: near });

/** FILLET entre duas linhas com raio r (r = 0 → cantos vivos). */
export function filletLines(l1: LineEntity, pick1: Vec2, l2: LineEntity, pick2: Vec2, r: number): OpResult<CornerResult> {
  if (r < 0) return fail("Raio deve ser ≥ 0.");
  const st = cornerSetup(l1, pick1, l2, pick2);
  if (!st) return fail("As linhas são paralelas.");
  const { X, k1, k2 } = st;
  if (r === 0) return ok({ l1: setLine(l1, k1.far, X), l2: setLine(l2, k2.far, X) });
  const phi = Math.acos(Math.max(-1, Math.min(1, dot(k1.u, k2.u))));
  if (phi < 1e-9 || Math.abs(Math.PI - phi) < 1e-9) return fail("Ângulo entre as linhas inválido para concordância.");
  const t = r / Math.tan(phi / 2);
  if (t > k1.farDist + 1e-9 || t > k2.farDist + 1e-9) return fail("Raio grande demais para o comprimento das linhas.");
  const T1 = add(X, mul(k1.u, t));
  const T2 = add(X, mul(k2.u, t));
  const bis = norm(add(k1.u, k2.u));
  const C = add(X, mul(bis, r / Math.sin(phi / 2)));
  let a0 = angleOf(sub(T1, C));
  let a1 = angleOf(sub(T2, C));
  if (normAngle(a1 - a0) > Math.PI) [a0, a1] = [a1, a0];
  return ok({
    l1: setLine(l1, k1.far, T1),
    l2: setLine(l2, k2.far, T2),
    corner: { type: "arc", c: C, r, a0: normAngle(a0), a1: normAngle(a1) },
  });
}

/** CHAMFER entre duas linhas com distâncias d1 (na 1ª) e d2 (na 2ª). */
export function chamferLines(l1: LineEntity, pick1: Vec2, l2: LineEntity, pick2: Vec2, d1: number, d2: number): OpResult<CornerResult> {
  if (d1 < 0 || d2 < 0) return fail("Distâncias devem ser ≥ 0.");
  const st = cornerSetup(l1, pick1, l2, pick2);
  if (!st) return fail("As linhas são paralelas.");
  const { X, k1, k2 } = st;
  if (d1 === 0 && d2 === 0) return ok({ l1: setLine(l1, k1.far, X), l2: setLine(l2, k2.far, X) });
  if (d1 > k1.farDist + 1e-9 || d2 > k2.farDist + 1e-9) return fail("Distância de chanfro maior que a linha.");
  const C1 = add(X, mul(k1.u, d1));
  const C2 = add(X, mul(k2.u, d2));
  return ok({ l1: setLine(l1, k1.far, C1), l2: setLine(l2, k2.far, C2), corner: { type: "line", a: C1, b: C2 } });
}

/* ------------------------------------------------------------------ */
/* EXPLODE / JOIN / STRETCH                                            */
/* ------------------------------------------------------------------ */

/** Decompõe polilinha em linhas e arcos. */
export function explodePolyline(p: PolylineEntity): Entity[] {
  return polylineSegs(p).map((s): Entity => {
    const base = { layer: p.layer, color: p.color, lineweight: p.lineweight, linetype: p.linetype, id: newId() };
    if (s.kind === "line") return { ...base, type: "line", a: s.a, b: s.b };
    return { ...base, type: "arc", c: s.c, r: s.r, a0: s.a0, a1: normAngle(s.a0 + s.sweep) };
  });
}

/** Une linhas, arcos e polilinhas abertas encadeadas (extremidades coincidentes) em uma polilinha. */
export function joinEntities(list: readonly Entity[], tol = 1e-6): OpResult<PolylineEntity> {
  type Piece = { segs: Seg[] };
  const pieces: Piece[] = [];
  for (const e of list) {
    if (e.type === "line") pieces.push({ segs: [lineSeg(e.a, e.b)] });
    else if (e.type === "arc") pieces.push({ segs: [arcSeg(e.c, e.r, e.a0, ccwSweep(e.a0, e.a1))] });
    else if (e.type === "polyline" && !e.closed) pieces.push({ segs: polylineSegs(e) });
    else return fail("JOIN aceita linhas, arcos e polilinhas abertas.");
  }
  if (pieces.length < 2) return fail("Selecione pelo menos dois objetos.");
  const rev = (s: Seg): Seg => (s.kind === "line" ? lineSeg(s.b, s.a) : { ...s, rev: !s.rev });
  const revPiece = (p: Piece): Piece => ({ segs: p.segs.slice().reverse().map(rev) });
  let chain = pieces.shift()!.segs.slice();
  let progress = true;
  while (pieces.length && progress) {
    progress = false;
    const head = segStart(chain[0]);
    const tail = segEnd(chain[chain.length - 1]);
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      const ps = segStart(p.segs[0]);
      const pe = segEnd(p.segs[p.segs.length - 1]);
      if (dist(tail, ps) <= tol) chain = chain.concat(p.segs);
      else if (dist(tail, pe) <= tol) chain = chain.concat(revPiece(p).segs);
      else if (dist(head, pe) <= tol) chain = p.segs.concat(chain);
      else if (dist(head, ps) <= tol) chain = revPiece(p).segs.concat(chain);
      else continue;
      pieces.splice(i, 1);
      progress = true;
      break;
    }
  }
  if (pieces.length) return fail("Os objetos não formam uma cadeia contínua (extremidades não coincidem).");
  const closed = dist(segStart(chain[0]), segEnd(chain[chain.length - 1])) <= tol;
  const pts = chain.map(segStart);
  const bulges = chain.map((s) => (s.kind === "line" ? 0 : (s.rev ? -1 : 1) * Math.tan(s.sweep / 4)));
  if (!closed) {
    pts.push(segEnd(chain[chain.length - 1]));
    bulges.push(0);
  }
  const first = list[0];
  return ok({
    type: "polyline",
    id: newId(),
    layer: first.layer,
    color: first.color,
    lineweight: first.lineweight,
    linetype: first.linetype,
    pts,
    bulges,
    closed,
  });
}

/**
 * STRETCH: desloca os pontos de definição contidos na janela; entidades totalmente contidas são movidas.
 * Retorna `null` quando a entidade não é afetada.
 */
export function stretchEntity(e: Entity, win: BBox, delta: Vec2): Entity | null {
  const inside = (p: Vec2) => boxContainsPoint(win, p);
  const mv = (p: Vec2) => (inside(p) ? add(p, delta) : p);
  switch (e.type) {
    case "line": {
      if (!inside(e.a) && !inside(e.b)) return null;
      return { ...e, a: mv(e.a), b: mv(e.b) };
    }
    case "polyline": {
      if (!e.pts.some(inside)) return null;
      return { ...e, pts: e.pts.map(mv) };
    }
    case "dimension": {
      const any = inside(e.p1) || inside(e.p2) || inside(e.loc);
      if (!any) return null;
      return { ...e, p1: mv(e.p1), p2: mv(e.p2), loc: mv(e.loc), assoc: null };
    }
    case "circle":
    case "arc":
    case "point":
    case "text": {
      const key = e.type === "circle" || e.type === "arc" ? e.c : e.p;
      if (!inside(key)) return null;
      return transformEntity(e, translation(delta.x, delta.y));
    }
  }
  return null;
}

export { bulgeSeg, uniqueSorted };
