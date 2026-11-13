import { type Entity, type Vec2, extendEntity, makeEntity, offsetEntity, trimEntity } from "@agtn/geometry";
import {
  type Constraint,
  type Id,
  type Pt,
  type SEntity,
  type Sketch,
  BUILTIN_POINTS,
  constraintRefs,
  entityOf,
  entityPoints,
  isBuiltin,
  isDimension,
  pointOf,
} from "./types";

/* ------------------------------------------------------------------------------- ids */

function take(s: Sketch, prefix: string): [Id, Sketch] {
  const n = s.seq + 1;
  return [`${prefix}${n}`, { ...s, seq: n }];
}

type PointArg = Pt | Id;

/** Usa um ponto existente (id) ou cria um novo nas coordenadas. */
export function ensurePoint(s: Sketch, p: PointArg): [Id, Sketch] {
  if (typeof p === "string") {
    if (!pointOf(s, p)) throw new Error(`Ponto ${p} não existe.`);
    return [p, s];
  }
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error("Coordenada inválida.");
  const [id, s2] = take(s, "P");
  return [id, { ...s2, points: { ...s2.points, [id]: { id, x: p.x, y: p.y } } }];
}

function putEntity(s: Sketch, prefix: string, make: (id: Id) => SEntity): [Id, Sketch] {
  const [id, s2] = take(s, prefix);
  return [id, { ...s2, entities: { ...s2.entities, [id]: make(id) } }];
}

const P = (s: Sketch, id: Id) => pointOf(s, id)!;
const d2 = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/* ------------------------------------------------------------------------------- entidades */

export function addLine(s: Sketch, a: PointArg, b: PointArg, cons = false): { s: Sketch; id: Id; p1: Id; p2: Id } {
  let p1: Id;
  let p2: Id;
  [p1, s] = ensurePoint(s, a);
  [p2, s] = ensurePoint(s, b);
  if (p1 === p2 || d2(P(s, p1), P(s, p2)) < 1e-9) throw new Error("Linha de comprimento zero.");
  const [id, s2] = putEntity(s, "L", (id) => ({ id, t: "line", p1, p2, cons: cons || undefined }));
  return { s: s2, id, p1, p2 };
}

export function addCircle(s: Sketch, c: PointArg, r: number, cons = false): { s: Sketch; id: Id; c: Id } {
  if (!(r > 0)) throw new Error("O raio deve ser maior que zero.");
  let cid: Id;
  [cid, s] = ensurePoint(s, c);
  const [id, s2] = putEntity(s, "C", (id) => ({ id, t: "circle", c: cid, r, cons: cons || undefined }));
  return { s: s2, id, c: cid };
}

/** Arco pelo centro, início e fim (anti-horário). O fim é projetado no raio do início. */
export function addArc(s: Sketch, c: PointArg, a: PointArg, b: PointArg, cons = false): { s: Sketch; id: Id; c: Id; p1: Id; p2: Id } {
  let cid: Id;
  let p1: Id;
  [cid, s] = ensurePoint(s, c);
  [p1, s] = ensurePoint(s, a);
  const C = P(s, cid);
  const A = P(s, p1);
  const r = d2(C, A);
  if (r < 1e-9) throw new Error("Arco de raio zero.");
  let p2: Id;
  if (typeof b === "string") [p2, s] = ensurePoint(s, b);
  else {
    const ang = Math.atan2(b.y - C.y, b.x - C.x);
    [p2, s] = ensurePoint(s, { x: C.x + r * Math.cos(ang), y: C.y + r * Math.sin(ang) });
  }
  if (p2 === p1 || d2(P(s, p1), P(s, p2)) < 1e-9) throw new Error("Início e fim do arco coincidem — use um círculo.");
  const [id, s2] = putEntity(s, "A", (id) => ({ id, t: "arc", c: cid, p1, p2, cons: cons || undefined }));
  return { s: s2, id, c: cid, p1, p2 };
}

/** Centro do círculo por três pontos (null se colineares). */
export function circumcenter(a: Pt, m: Pt, b: Pt): Pt | null {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const m2 = m.x * m.x + m.y * m.y;
  const b2 = b.x * b.x + b.y * b.y;
  return { x: (a2 * (m.y - b.y) + m2 * (b.y - a.y) + b2 * (a.y - m.y)) / d, y: (a2 * (b.x - m.x) + m2 * (a.x - b.x) + b2 * (m.x - a.x)) / d };
}

/** Arco por três pontos (início, ponto intermediário, fim). */
export function addArc3(s: Sketch, a: PointArg, mid: Pt, b: PointArg, cons = false) {
  const A = typeof a === "string" ? P(s, a) : a;
  const B = typeof b === "string" ? P(s, b) : b;
  const c = circumcenter(A, mid, B);
  if (!c) throw new Error("Os três pontos estão alinhados — use uma linha.");
  // anti-horário de A para B passando por mid?
  const ang = (p: Pt) => Math.atan2(p.y - c.y, p.x - c.x);
  const norm = (v: number) => ((v % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = norm(ang(mid) - ang(A)) < norm(ang(B) - ang(A));
  return ccw ? addArc(s, c, a, b, cons) : addArc(s, c, b, a, cons);
}

export function addPointEntity(s: Sketch, p: PointArg): { s: Sketch; id: Id; p: Id } {
  let pid: Id;
  [pid, s] = ensurePoint(s, p);
  const [id, s2] = putEntity(s, "PT", (id) => ({ id, t: "point", p: pid }));
  return { s: s2, id, p: pid };
}

/** Retângulo por dois cantos: 4 linhas conectadas + 2 horizontais + 2 verticais. */
export function addRectangle(s: Sketch, a: Pt, b: Pt, cons = false): { s: Sketch; lines: Id[]; points: Id[] } {
  if (Math.abs(a.x - b.x) < 1e-9 || Math.abs(a.y - b.y) < 1e-9) throw new Error("Retângulo com largura ou altura zero.");
  const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  const pts: Id[] = [];
  for (const c of corners) {
    let id: Id;
    [id, s] = ensurePoint(s, c);
    pts.push(id);
  }
  const lines: Id[] = [];
  for (let i = 0; i < 4; i++) {
    const r = addLine(s, pts[i], pts[(i + 1) % 4], cons);
    s = r.s;
    lines.push(r.id);
  }
  s = addConstraint(s, { t: "horizontal", l: lines[0] }).s;
  s = addConstraint(s, { t: "horizontal", l: lines[2] }).s;
  s = addConstraint(s, { t: "vertical", l: lines[1] }).s;
  s = addConstraint(s, { t: "vertical", l: lines[3] }).s;
  return { s, lines, points: pts };
}

/** Polilinha de trechos retos (pontos compartilhados). `closed` fecha no primeiro ponto. */
export function addPolyline(s: Sketch, pts: readonly Pt[], closed: boolean): { s: Sketch; lines: Id[]; points: Id[] } {
  if (pts.length < 2) throw new Error("A polilinha precisa de pelo menos 2 pontos.");
  const ids: Id[] = [];
  for (const p of pts) {
    let id: Id;
    [id, s] = ensurePoint(s, p);
    ids.push(id);
  }
  const lines: Id[] = [];
  const n = closed ? ids.length : ids.length - 1;
  for (let i = 0; i < n; i++) {
    const r = addLine(s, ids[i], ids[(i + 1) % ids.length]);
    s = r.s;
    lines.push(r.id);
  }
  return { s, lines, points: ids };
}

/* ------------------------------------------------------------------------------- restrições */

type NewConstraint = Constraint extends infer C ? (C extends Constraint ? Omit<C, "id"> : never) : never;

/** Valida referências e tipo, evita duplicata e devolve o id. */
export function addConstraint(s: Sketch, c: NewConstraint): { s: Sketch; id: Id } {
  const refs = constraintRefs({ ...c, id: "?" } as Constraint);
  for (const r of refs) if (!pointOf(s, r) && !entityOf(s, r)) throw new Error(`Referência ${r} não existe.`);
  checkKinds(s, { ...c, id: "?" } as Constraint);
  if ("v" in c && !(Number.isFinite(c.v) && (c.t === "distanceX" || c.t === "distanceY" || c.v > 0 || (c.t === "angle" && c.v >= 0))))
    throw new Error("Valor da cota inválido.");
  const key = (k: Constraint) => `${k.t}:${constraintRefs(k).slice().sort().join(",")}`;
  const dup = s.constraints.find((k) => key(k) === key({ ...c, id: "?" } as Constraint));
  if (dup) throw new Error(`Já existe a restrição ${dup.id} (${dup.t}).`);
  const [id, s2] = take(s, isDimension({ ...c, id: "?" } as Constraint) ? "D" : "R");
  return { s: { ...s2, constraints: [...s2.constraints, { ...c, id } as Constraint] }, id };
}

function checkKinds(s: Sketch, c: Constraint) {
  const kind = (id: Id) => entityOf(s, id)?.t ?? (pointOf(s, id) ? "p" : "?");
  const isLine = (id: Id) => kind(id) === "line";
  const isRound = (id: Id) => kind(id) === "circle" || kind(id) === "arc";
  const isPt = (id: Id) => kind(id) === "p";
  const need = (ok: boolean, msg: string) => {
    if (!ok) throw new Error(msg);
  };
  switch (c.t) {
    case "coincident":
    case "distance":
    case "distanceX":
    case "distanceY":
      need(isPt(c.a) && isPt(c.b), "Escolha dois pontos.");
      need(c.a !== c.b, "Os pontos devem ser diferentes.");
      break;
    case "pointOnLine":
    case "midpoint":
    case "pointLineDistance":
      need(isPt(c.p) && isLine(c.l), "Escolha um ponto e uma linha.");
      break;
    case "pointOnCircle":
      need(isPt(c.p) && isRound(c.c), "Escolha um ponto e um círculo/arco.");
      break;
    case "horizontal":
    case "vertical":
    case "length":
      need(isLine(c.l), "Escolha uma linha.");
      break;
    case "parallel":
    case "perpendicular":
    case "angle":
      need(isLine(c.a) && isLine(c.b) && c.a !== c.b, "Escolha duas linhas diferentes.");
      break;
    case "tangent":
      need((isLine(c.a) && isRound(c.b)) || (isRound(c.a) && isLine(c.b)) || (isRound(c.a) && isRound(c.b) && c.a !== c.b), "Tangência: linha com arco/círculo ou dois arcos/círculos.");
      break;
    case "concentric":
      need(isRound(c.a) && isRound(c.b) && c.a !== c.b, "Escolha dois círculos/arcos.");
      break;
    case "equal":
      need(((isLine(c.a) && isLine(c.b)) || (isRound(c.a) && isRound(c.b))) && c.a !== c.b, "Igualdade: duas linhas ou dois círculos/arcos.");
      break;
    case "radius":
    case "diameter":
      need(isRound(c.c), "Escolha um círculo ou arco.");
      break;
    case "fixed":
      need(isPt(c.p) && !isBuiltin(c.p), "Escolha um ponto do esboço.");
      break;
  }
}

/** Tangência: decide interna/externa pela posição atual. */
export function tangentConstraint(s: Sketch, a: Id, b: Id): NewConstraint {
  const ea = entityOf(s, a);
  const eb = entityOf(s, b);
  if (ea && eb && ea.t !== "line" && eb.t !== "line") {
    const ca = P(s, ea.t === "point" ? ea.p : ea.c);
    const cb = P(s, eb.t === "point" ? eb.p : eb.c);
    const ra = roundRadius(s, ea);
    const rb = roundRadius(s, eb);
    const d = d2(ca, cb);
    return { t: "tangent", a, b, inner: Math.abs(d - Math.abs(ra - rb)) < Math.abs(d - (ra + rb)) };
  }
  return { t: "tangent", a, b };
}

export function roundRadius(s: Sketch, e: SEntity): number {
  if (e.t === "circle") return e.r;
  if (e.t === "arc") return d2(P(s, e.c), P(s, e.p1));
  return 0;
}

export function setDimension(s: Sketch, cid: Id, v: number): Sketch {
  const c = s.constraints.find((k) => k.id === cid);
  if (!c || !isDimension(c)) throw new Error("Cota não encontrada.");
  if (!Number.isFinite(v) || (v <= 0 && c.t !== "distanceX" && c.t !== "distanceY" && c.t !== "angle")) throw new Error("Valor da cota inválido.");
  return { ...s, constraints: s.constraints.map((k) => (k.id === cid ? ({ ...k, v } as Constraint) : k)) };
}

export function removeConstraints(s: Sketch, ids: readonly Id[]): Sketch {
  const set = new Set(ids);
  return { ...s, constraints: s.constraints.filter((c) => !set.has(c.id)) };
}

/** Apaga entidades, seus pontos órfãos e restrições que ficaram sem referência. */
export function removeEntities(s: Sketch, ids: readonly Id[]): Sketch {
  const del = new Set(ids.filter((i) => !isBuiltin(i)));
  const entities = Object.fromEntries(Object.entries(s.entities).filter(([id]) => !del.has(id)));
  const used = new Set<Id>();
  for (const e of Object.values(entities)) for (const p of entityPoints(e)) used.add(p);
  const points = Object.fromEntries(Object.entries(s.points).filter(([id]) => used.has(id)));
  const alive = (r: Id) => r in points || r in entities || isBuiltin(r);
  return { ...s, entities, points, constraints: s.constraints.filter((c) => constraintRefs(c).every(alive)) };
}

/** Alterna geometria de construção (não entra em perfis). */
export function toggleConstruction(s: Sketch, ids: readonly Id[]): Sketch {
  const entities = { ...s.entities };
  for (const id of ids) {
    const e = entities[id];
    if (e) entities[id] = { ...e, cons: e.cons ? undefined : true };
  }
  return { ...s, entities };
}

/** Move um ponto livremente (antes de resolver). */
export function movePoint(s: Sketch, id: Id, to: Pt): Sketch {
  const p = s.points[id];
  if (!p) return s;
  return { ...s, points: { ...s.points, [id]: { ...p, x: to.x, y: to.y } } };
}

/* ------------------------------------------------------------------------------- aparar / estender / offset */

/** Entidade do esboço convertida para o motor 2D (reaproveita trim/extend/offset testados do CAD 2D). */
export function toGeom(s: Sketch, e: SEntity): Entity | null {
  if (e.t === "line") return makeEntity({ type: "line", a: xy(P(s, e.p1)), b: xy(P(s, e.p2)) }, "0", {}, e.id);
  if (e.t === "circle") return makeEntity({ type: "circle", c: xy(P(s, e.c)), r: e.r }, "0", {}, e.id);
  if (e.t === "arc") {
    const c = P(s, e.c);
    const a = P(s, e.p1);
    const b = P(s, e.p2);
    return makeEntity({ type: "arc", c: xy(c), r: d2(c, a), a0: Math.atan2(a.y - c.y, a.x - c.x), a1: Math.atan2(b.y - c.y, b.x - c.x) }, "0", {}, e.id);
  }
  return null;
}
const xy = (p: Pt): Vec2 => ({ x: p.x, y: p.y });

function curvesExcept(s: Sketch, id: Id): Entity[] {
  return Object.values(s.entities)
    .filter((e) => e.id !== id && e.t !== "point")
    .map((e) => toGeom(s, e))
    .filter((e): e is Entity => !!e);
}

/** Ponto existente nessa posição, ou cria um novo; com restrição "sobre" a entidade que passa por ali. */
function pointAtOrNew(s: Sketch, p: Pt, onto: readonly Entity[], keepIds: readonly Id[]): [Id, Sketch] {
  for (const id of keepIds) if (d2(P(s, id), p) < 1e-7) return [id, s];
  for (const q of Object.values(s.points)) {
    if (d2(q, p) < 1e-7) return [q.id, s];
  }
  let id: Id;
  [id, s] = ensurePoint(s, p);
  // prende o novo ponto na entidade de corte que passa por ele (a geometria continua ligada ao alterar cotas)
  for (const c of onto) {
    if (c.type === "line") {
      const cross = (c.b.x - c.a.x) * (p.y - c.a.y) - (c.b.y - c.a.y) * (p.x - c.a.x);
      if (Math.abs(cross) / Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) < 1e-6) {
        s = addConstraint(s, { t: "pointOnLine", p: id, l: c.id }).s;
        break;
      }
    } else if (c.type === "circle" || c.type === "arc") {
      if (Math.abs(d2(c.c, p) - c.r) < 1e-6) {
        s = addConstraint(s, { t: "pointOnCircle", p: id, c: c.id }).s;
        break;
      }
    }
  }
  return [id, s];
}

/** Restrições dimensionais que deixam de fazer sentido quando a entidade muda de extensão. */
const lengthLike = new Set(["length", "midpoint"]);
/** Restrição que perde o sentido quando a entidade `id` muda de extensão (igual entre linhas = mesmo comprimento). */
const dropsOnResize = (s: Sketch, c: Sketch["constraints"][number], id: Id) =>
  constraintRefs(c).includes(id) && (lengthLike.has(c.t) || (c.t === "equal" && s.entities[id]?.t === "line"));

/** Apara a entidade no trecho clicado, entre as interseções mais próximas. */
export function trim(s: Sketch, id: Id, pick: Pt): Sketch {
  const e = s.entities[id];
  if (!e || e.t === "point") throw new Error("Escolha uma linha, arco ou círculo.");
  const g = toGeom(s, e)!;
  const cutters = curvesExcept(s, id);
  const r = trimEntity(g, cutters, xy(pick));
  if (!r.ok) throw new Error(r.reason);
  const pieces = r.value;
  // remove a original e as restrições de comprimento; mantém as geométricas (horizontal, paralela…)
  const keepC = s.constraints.filter((c) => !dropsOnResize(s, c, id));
  let out: Sketch = { ...s, constraints: keepC };
  const entities = { ...out.entities };
  delete entities[id];
  out = { ...out, entities };
  const origPts = entityPoints(e);
  let first = true;
  for (const piece of pieces) {
    const pid = first ? id : undefined;
    first = false;
    if (piece.type === "line") {
      let a: Id;
      let b: Id;
      [a, out] = pointAtOrNew(out, piece.a, cutters, origPts);
      [b, out] = pointAtOrNew(out, piece.b, cutters, origPts);
      out = putWithId(out, pid, "L", (nid) => ({ id: nid, t: "line", p1: a, p2: b, cons: e.cons }));
    } else if (piece.type === "arc") {
      const c = e.t === "line" ? null : e.c;
      const center = c ?? ensurePoint(out, piece.c)[0];
      const pa = { x: piece.c.x + piece.r * Math.cos(piece.a0), y: piece.c.y + piece.r * Math.sin(piece.a0) };
      const pb = { x: piece.c.x + piece.r * Math.cos(piece.a1), y: piece.c.y + piece.r * Math.sin(piece.a1) };
      let a: Id;
      let b: Id;
      [a, out] = pointAtOrNew(out, pa, cutters, origPts);
      [b, out] = pointAtOrNew(out, pb, cutters, origPts);
      out = putWithId(out, pid, "A", (nid) => ({ id: nid, t: "arc", c: center, p1: a, p2: b, cons: e.cons }));
    }
  }
  return removeEntities(out, []); // limpa pontos órfãos e restrições sem referência
}

function putWithId(s: Sketch, id: Id | undefined, prefix: string, make: (id: Id) => SEntity): Sketch {
  if (id) return { ...s, entities: { ...s.entities, [id]: make(id) } };
  return putEntity(s, prefix, make)[1];
}

/** Estende a ponta clicada de uma linha/arco até a próxima entidade. */
export function extend(s: Sketch, id: Id, pick: Pt): Sketch {
  const e = s.entities[id];
  if (!e || (e.t !== "line" && e.t !== "arc")) throw new Error("Escolha uma linha ou arco.");
  const g = toGeom(s, e)!;
  const bounds = curvesExcept(s, id);
  const r = extendEntity(g, bounds, xy(pick));
  if (!r.ok) throw new Error(r.reason);
  const n = r.value;
  let out = s;
  const movePt = (pid: Id, to: Vec2) => {
    if (d2(P(out, pid), to) < 1e-9) return;
    out = movePoint(out, pid, to);
    for (const b of bounds) {
      if (b.type === "line") {
        const cross = (b.b.x - b.a.x) * (to.y - b.a.y) - (b.b.y - b.a.y) * (to.x - b.a.x);
        if (Math.abs(cross) / Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) < 1e-6) {
          out = addConstraint(out, { t: "pointOnLine", p: pid, l: b.id }).s;
          return;
        }
      } else if ((b.type === "circle" || b.type === "arc") && Math.abs(d2(b.c, to) - b.r) < 1e-6) {
        out = addConstraint(out, { t: "pointOnCircle", p: pid, c: b.id }).s;
        return;
      }
    }
  };
  if (e.t === "line" && n.type === "line") {
    movePt(e.p1, n.a);
    movePt(e.p2, n.b);
  } else if (e.t === "arc" && n.type === "arc") {
    movePt(e.p1, { x: n.c.x + n.r * Math.cos(n.a0), y: n.c.y + n.r * Math.sin(n.a0) });
    movePt(e.p2, { x: n.c.x + n.r * Math.cos(n.a1), y: n.c.y + n.r * Math.sin(n.a1) });
  }
  return { ...out, constraints: out.constraints.filter((c) => !dropsOnResize(s, c, id)) };
}

/**
 * Offset de entidades a uma distância, para o lado do ponto indicado. Cadeias conectadas continuam conectadas
 * (pontos coincidentes do resultado viram o mesmo ponto).
 */
export function offset(s: Sketch, ids: readonly Id[], dist: number, side: Pt): { s: Sketch; ids: Id[] } {
  if (!(dist > 0)) throw new Error("A distância de offset deve ser maior que zero.");
  const made: Id[] = [];
  let out = s;
  const reuse = (p: Vec2): Id => {
    for (const id of made.flatMap((m) => entityPoints(out.entities[m]))) if (d2(P(out, id), p) < 1e-7) return id;
    let id: Id;
    [id, out] = ensurePoint(out, p);
    return id;
  };
  for (const id of ids) {
    const e = s.entities[id];
    if (!e || e.t === "point") continue;
    const g = toGeom(s, e)!;
    const r = offsetEntity(g, dist, xy(side));
    if (!r.ok) throw new Error(r.reason);
    const n = r.value;
    if (n.type === "line") {
      const a = reuse(n.a);
      const b = reuse(n.b);
      const x = addLine(out, a, b, e.cons);
      out = x.s;
      made.push(x.id);
    } else if (n.type === "circle") {
      const x = addCircle(out, n.c, n.r, e.cons);
      out = x.s;
      made.push(x.id);
    } else if (n.type === "arc") {
      const c = reuse(n.c);
      const a = reuse({ x: n.c.x + n.r * Math.cos(n.a0), y: n.c.y + n.r * Math.sin(n.a0) });
      const b = reuse({ x: n.c.x + n.r * Math.cos(n.a1), y: n.c.y + n.r * Math.sin(n.a1) });
      const x = addArc(out, c, a, b, e.cons);
      out = x.s;
      made.push(x.id);
    }
  }
  return { s: out, ids: made };
}

/** Funde dois pontos (coincidência "forte"): substitui `drop` por `keep` em todas as entidades. */
export function mergePoints(s: Sketch, keep: Id, drop: Id): Sketch {
  if (keep === drop || isBuiltin(drop)) return s;
  const sub = (id: Id) => (id === drop ? keep : id);
  const entities: Record<Id, SEntity> = {};
  for (const [id, e] of Object.entries(s.entities)) {
    entities[id] =
      e.t === "line" ? { ...e, p1: sub(e.p1), p2: sub(e.p2) } : e.t === "circle" ? { ...e, c: sub(e.c) } : e.t === "arc" ? { ...e, c: sub(e.c), p1: sub(e.p1), p2: sub(e.p2) } : { ...e, p: sub(e.p) };
  }
  const constraints = s.constraints
    .map((c) => JSON.parse(JSON.stringify(c).replaceAll(`"${drop}"`, `"${keep}"`)) as Constraint)
    .filter((c) => !(c.t === "coincident" && c.a === c.b));
  const points = { ...s.points };
  delete points[drop];
  return { ...s, entities, points, constraints };
}

export { BUILTIN_POINTS };
