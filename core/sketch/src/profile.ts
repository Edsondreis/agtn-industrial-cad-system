import { type Seg, arcSeg, lineSeg, segSeg } from "@agtn/geometry";
import { type Id, type Pt, type Sketch, entityOf, pointOf } from "./types";

/**
 * Perfis do esboço para extrusão/revolução.
 *
 * As curvas (sem construção) são cortadas nas interseções, pontas soltas são descartadas, e as faces do arranjo
 * planar são percorridas (semi-arestas, giro mais à direita). Cada face limitada vira uma região; componentes
 * desconexos dentro de uma face viram furos dessa região. Seleção padrão = regiões de profundidade par
 * (retângulo com círculo dentro → chapa com furo, como nos CADs mecânicos).
 */
export type Seg2 =
  | { readonly t: "line"; readonly a: Pt; readonly b: Pt; readonly src: Id }
  /** arco de `a` a `b`; `sweep` com sinal (positivo = anti-horário) */
  | { readonly t: "arc"; readonly c: Pt; readonly r: number; readonly a: Pt; readonly b: Pt; readonly sweep: number; readonly src: Id }
  | { readonly t: "circle"; readonly c: Pt; readonly r: number; readonly src: Id };

export interface Loop {
  /** trechos encadeados (fim de um = início do próximo) */
  readonly segs: readonly Seg2[];
  /** área com sinal (positiva = anti-horário) */
  readonly area: number;
  /** polígono aproximado (para testes de ponto) */
  readonly poly: readonly Pt[];
}

export interface Region {
  readonly index: number;
  /** contorno anti-horário */
  readonly outer: Loop;
  /** furos (horários) */
  readonly holes: readonly Loop[];
  /** 0 = externa, 1 = ilha dentro de furo… */
  readonly depth: number;
  /** área líquida (mm²) */
  readonly area: number;
  /** ponto garantidamente interno */
  readonly interior: Pt;
  /** entidades do esboço que formam o contorno */
  readonly sources: readonly Id[];
}

export interface ProfileResult {
  readonly regions: readonly Region[];
  /** pontas soltas (curvas que não fecham) — informadas ao usuário */
  readonly openEnds: readonly Pt[];
}

const TAU = Math.PI * 2;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

interface Curve {
  src: Id;
  seg: Seg;
  full: boolean;
}

function curves(s: Sketch): Curve[] {
  const out: Curve[] = [];
  for (const e of Object.values(s.entities)) {
    if (e.cons) continue;
    if (e.t === "line") out.push({ src: e.id, seg: lineSeg(pointOf(s, e.p1)!, pointOf(s, e.p2)!), full: false });
    else if (e.t === "circle") out.push({ src: e.id, seg: arcSeg(pointOf(s, e.c)!, e.r, 0, TAU), full: true });
    else if (e.t === "arc") {
      const c = pointOf(s, e.c)!;
      const a = pointOf(s, e.p1)!;
      const b = pointOf(s, e.p2)!;
      const a0 = Math.atan2(a.y - c.y, a.x - c.x);
      let sw = Math.atan2(b.y - c.y, b.x - c.x) - a0;
      while (sw <= 0) sw += TAU;
      out.push({ src: e.id, seg: arcSeg(c, dist(c, a), a0, sw), full: false });
    }
  }
  return out;
}

/** Parâmetro (0..1 na linha; ângulo 0..sweep no arco) de um ponto sobre o trecho. */
function paramOn(seg: Seg, p: Pt): number {
  if (seg.kind === "line") {
    const dx = seg.b.x - seg.a.x;
    const dy = seg.b.y - seg.a.y;
    return ((p.x - seg.a.x) * dx + (p.y - seg.a.y) * dy) / (dx * dx + dy * dy);
  }
  let t = Math.atan2(p.y - seg.c.y, p.x - seg.c.x) - seg.a0;
  while (t < -1e-12) t += TAU;
  while (t > TAU) t -= TAU;
  return t;
}
function pointAt(seg: Seg, t: number): Pt {
  if (seg.kind === "line") return { x: seg.a.x + (seg.b.x - seg.a.x) * t, y: seg.a.y + (seg.b.y - seg.a.y) * t };
  return { x: seg.c.x + seg.r * Math.cos(seg.a0 + t), y: seg.c.y + seg.r * Math.sin(seg.a0 + t) };
}

interface Edge {
  src: Id;
  u: number;
  v: number;
  seg: Seg2;
}

export function profiles(s: Sketch): ProfileResult {
  const cs = curves(s);
  if (!cs.length) return { regions: [], openEnds: [] };
  // escala para tolerâncias
  let size = 1;
  for (const c of cs) size = Math.max(size, c.seg.kind === "line" ? Math.max(Math.abs(c.seg.a.x), Math.abs(c.seg.a.y), Math.abs(c.seg.b.x), Math.abs(c.seg.b.y)) : Math.abs(c.seg.c.x) + Math.abs(c.seg.c.y) + c.seg.r);
  const tol = 1e-7 * size;

  // 1) cortes nas interseções
  const cuts: number[][] = cs.map((c) => (c.seg.kind === "line" ? [0, 1] : c.full ? [] : [0, c.seg.sweep]));
  for (let i = 0; i < cs.length; i++)
    for (let j = i + 1; j < cs.length; j++)
      for (const p of segSeg(cs[i].seg, cs[j].seg)) {
        cuts[i].push(paramOn(cs[i].seg, p));
        cuts[j].push(paramOn(cs[j].seg, p));
      }

  // 2) vértices fundidos por tolerância
  const verts: Pt[] = [];
  const vid = (p: Pt) => {
    for (let k = 0; k < verts.length; k++) if (dist(verts[k], p) < tol * 10) return k;
    verts.push(p);
    return verts.length - 1;
  };
  const edges: Edge[] = [];
  cs.forEach((c, i) => {
    const sw = c.seg.kind === "arc" ? c.seg.sweep : 1;
    // ordena e funde parâmetros quase iguais sem arredondar (mantém a posição exata das interseções)
    const sorted = cuts[i].map((t) => Math.max(0, Math.min(sw, t))).sort((a, b) => a - b);
    let ts: number[] = [];
    for (const t of sorted) if (!ts.length || t - ts[ts.length - 1] > 1e-9) ts.push(t);
    if (c.full && ts.length > 1 && ts[0] + TAU - ts[ts.length - 1] < 1e-9) ts.pop();
    if (c.full) {
      if (!ts.length) {
        // círculo isolado: uma aresta fechada
        const p = pointAt(c.seg, 0);
        const v = vid(p);
        edges.push({ src: c.src, u: v, v, seg: { t: "circle", c: (c.seg as Extract<Seg, { kind: "arc" }>).c, r: (c.seg as Extract<Seg, { kind: "arc" }>).r, src: c.src } });
        return;
      }
      ts = [...ts, ts[0] + TAU];
    }
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k];
      const t1 = ts[k + 1];
      if (t1 - t0 < 1e-12) continue;
      const a = pointAt(c.seg, t0);
      const b = pointAt(c.seg, t1);
      const u = vid(a);
      const v = vid(b);
      if (c.seg.kind === "line") {
        if (u === v) continue;
        edges.push({ src: c.src, u, v, seg: { t: "line", a, b, src: c.src } });
      } else edges.push({ src: c.src, u, v, seg: { t: "arc", c: c.seg.c, r: c.seg.r, a, b, sweep: t1 - t0, src: c.src } });
    }
  });

  // 3) remove arestas penduradas (pontas soltas) iterativamente
  const openEnds: Pt[] = [];
  let alive = edges.map(() => true);
  for (;;) {
    const deg = new Map<number, number>();
    edges.forEach((e, i) => {
      if (!alive[i]) return;
      deg.set(e.u, (deg.get(e.u) ?? 0) + 1);
      deg.set(e.v, (deg.get(e.v) ?? 0) + 1);
    });
    let changed = false;
    edges.forEach((e, i) => {
      if (!alive[i] || e.u === e.v) return;
      const du = deg.get(e.u)!;
      const dv = deg.get(e.v)!;
      if (du === 1 || dv === 1) {
        alive[i] = false;
        changed = true;
        if (du === 1) openEnds.push(verts[e.u]);
        if (dv === 1) openEnds.push(verts[e.v]);
      }
    });
    if (!changed) break;
  }
  const live = edges.filter((_, i) => alive[i]);
  alive = [];

  // 4) semi-arestas e percurso das faces
  interface HE {
    e: number;
    from: number;
    to: number;
    ang: number;
    seg: Seg2; // orientado from → to
    used: boolean;
  }
  const hes: HE[] = [];
  const closedLoops: Loop[] = [];
  live.forEach((e, i) => {
    if (e.seg.t === "circle") {
      const loop = circleLoop(e.seg, 1);
      closedLoops.push(loop, circleLoop(e.seg, -1));
      return;
    }
    const fwd = e.seg;
    const rev = reverseSeg(e.seg);
    hes.push({ e: i, from: e.u, to: e.v, ang: leaveAngle(fwd), seg: fwd, used: false });
    hes.push({ e: i, from: e.v, to: e.u, ang: leaveAngle(rev), seg: rev, used: false });
  });
  const out = new Map<number, number[]>();
  hes.forEach((h, k) => {
    const l = out.get(h.from) ?? [];
    l.push(k);
    out.set(h.from, l);
  });
  for (const l of out.values()) l.sort((a, b) => hes[a].ang - hes[b].ang);
  const twin = (k: number) => (k % 2 === 0 ? k + 1 : k - 1);
  for (let k0 = 0; k0 < hes.length; k0++) {
    if (hes[k0].used) continue;
    const segs: Seg2[] = [];
    let k = k0;
    let guard = 0;
    while (!hes[k].used && guard++ < hes.length + 2) {
      hes[k].used = true;
      segs.push(hes[k].seg);
      const t = twin(k);
      const list = out.get(hes[k].to)!;
      const pos = list.indexOf(t);
      k = list[(pos - 1 + list.length) % list.length]; // primeiro no sentido horário a partir da volta
    }
    closedLoops.push(makeLoop(segs));
  }

  // 5) faces limitadas (área > 0) e contornos externos (área < 0) por componente
  const faces = closedLoops.filter((l) => l.area > tol * tol);
  const outers = closedLoops.filter((l) => l.area < -tol * tol);
  // furo direto: contorno externo de outro componente dentro da face e sem face intermediária
  const boxes = new Map<Loop, { x0: number; y0: number; x1: number; y1: number }>();
  const holesOf = new Map<Loop, Loop[]>();
  const parentOf = new Map<Loop, Loop | null>();
  for (const o of outers) {
    const probe = o.poly[0];
    let best: Loop | null = null;
    for (const f of faces) {
      if (sameComponent(f, o)) continue;
      if (Math.abs(f.area) <= Math.abs(o.area) + tol) continue;
      if (inside(probe, f.poly) && (!best || f.area < best.area)) best = f;
    }
    parentOf.set(o, best);
    if (best) holesOf.set(best, [...(holesOf.get(best) ?? []), o]);
  }
  // profundidade: nº de faces de outros componentes que contêm a face
  const regions: Region[] = faces.map((f, index) => {
    const holes = holesOf.get(f) ?? [];
    let depth = 0;
    for (const g of faces) if (g !== f && !sameComponent(g, f) && g.area > f.area && inside(f.poly[0], g.poly) && !onLoop(f.poly[0], g.poly, tol * 10)) depth++;
    const area = f.area + holes.reduce((a, h) => a + h.area, 0);
    return { index, outer: f, holes, depth, area, interior: interiorPoint(f, holes), sources: [...new Set([...f.segs, ...holes.flatMap((h) => h.segs)].map((sg) => sg.src))] };
  });
  return { regions, openEnds };

  function sameComponent(a: Loop, b: Loop): boolean {
    // compartilham algum vértice → mesmo componente. Pré-filtro EXATO (ETAPA 3, desempenho): um par de vértices a
    // menos de tol·10 só existe se as caixas dos dois polígonos, alargadas de tol·10, se cruzam — fora disso a resposta
    // já é "não", sem comparar os N×M vértices (era 8 s com 120 furos de 96 pontos).
    const ba = boxOf(a);
    const bb = boxOf(b);
    const g = tol * 10;
    if (ba.x0 - g > bb.x1 || bb.x0 - g > ba.x1 || ba.y0 - g > bb.y1 || bb.y0 - g > ba.y1) return false;
    for (const p of a.poly) for (const q of b.poly) if (dist(p, q) < g) return true;
    return false;
  }
  function boxOf(l: Loop): { x0: number; y0: number; x1: number; y1: number } {
    let b = boxes.get(l);
    if (!b) {
      b = { x0: Number.POSITIVE_INFINITY, y0: Number.POSITIVE_INFINITY, x1: Number.NEGATIVE_INFINITY, y1: Number.NEGATIVE_INFINITY };
      for (const p of l.poly) {
        if (p.x < b.x0) b.x0 = p.x;
        if (p.x > b.x1) b.x1 = p.x;
        if (p.y < b.y0) b.y0 = p.y;
        if (p.y > b.y1) b.y1 = p.y;
      }
      boxes.set(l, b);
    }
    return b;
  }
}

/** Regiões que entram por padrão (profundidade par). */
export const defaultRegions = (r: ProfileResult) => r.regions.filter((x) => x.depth % 2 === 0).map((x) => x.index);

function reverseSeg(s: Seg2): Seg2 {
  if (s.t === "line") return { ...s, a: s.b, b: s.a };
  if (s.t === "arc") return { ...s, a: s.b, b: s.a, sweep: -s.sweep };
  return s;
}

/** Direção de saída (corda até 1% do trecho: desempata linha × arco tangente). */
function leaveAngle(s: Seg2): number {
  if (s.t === "line") return Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
  if (s.t === "arc") {
    const a0 = Math.atan2(s.a.y - s.c.y, s.a.x - s.c.x);
    const t = a0 + s.sweep * 0.01;
    const p = { x: s.c.x + s.r * Math.cos(t), y: s.c.y + s.r * Math.sin(t) };
    return Math.atan2(p.y - s.a.y, p.x - s.a.x);
  }
  return 0;
}

function discretize(s: Seg2): Pt[] {
  if (s.t === "line") return [s.a];
  if (s.t === "circle") {
    const n = 96;
    return Array.from({ length: n }, (_, i) => ({ x: s.c.x + s.r * Math.cos((i / n) * TAU), y: s.c.y + s.r * Math.sin((i / n) * TAU) }));
  }
  const n = Math.max(2, Math.ceil(Math.abs(s.sweep) / (Math.PI / 48)));
  const a0 = Math.atan2(s.a.y - s.c.y, s.a.x - s.c.x);
  return Array.from({ length: n }, (_, i) => ({ x: s.c.x + s.r * Math.cos(a0 + (s.sweep * i) / n), y: s.c.y + s.r * Math.sin(a0 + (s.sweep * i) / n) }));
}

function makeLoop(segs: Seg2[]): Loop {
  let area = 0;
  for (const s of segs) {
    if (s.t === "circle") continue;
    area += (s.a.x * s.b.y - s.b.x * s.a.y) / 2;
    if (s.t === "arc") area += ((s.r * s.r) / 2) * (s.sweep - Math.sin(s.sweep));
  }
  return { segs, area, poly: segs.flatMap(discretize) };
}

function circleLoop(c: Extract<Seg2, { t: "circle" }>, sign: 1 | -1): Loop {
  const poly = discretize(c);
  return { segs: [c], area: sign * Math.PI * c.r * c.r, poly: sign > 0 ? poly : [...poly].reverse() };
}

function inside(p: Pt, poly: readonly Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
function onLoop(p: Pt, poly: readonly Pt[], tol: number): boolean {
  return poly.some((q) => dist(p, q) < tol);
}

/** Ponto interno da região (fora dos furos): centroide se servir; senão, meio do 1º intervalo de uma varredura. */
function interiorPoint(outer: Loop, holes: readonly Loop[]): Pt {
  const ok = (p: Pt) => inside(p, outer.poly) && !holes.some((h) => inside(p, h.poly));
  let cx = 0;
  let cy = 0;
  for (const p of outer.poly) {
    cx += p.x;
    cy += p.y;
  }
  const c = { x: cx / outer.poly.length, y: cy / outer.poly.length };
  if (ok(c)) return c;
  const ys = outer.poly.map((p) => p.y);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  for (const f of [0.5, 0.37, 0.63, 0.25, 0.75, 0.13, 0.87]) {
    const y = y0 + (y1 - y0) * f;
    const xs: number[] = [];
    for (const poly of [outer.poly, ...holes.map((h) => h.poly)])
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if (a.y > y !== b.y > y) xs.push(((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x);
      }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const p = { x: (xs[k] + xs[k + 1]) / 2, y };
      if (ok(p)) return p;
    }
  }
  return c;
}

/**
 * Caminho para varredura (sweep): curvas sem construção encadeadas de ponta a ponta, sem ramificações.
 * Devolve os trechos na ordem e se é fechado.
 */
export function pathChain(s: Sketch): { segs: Seg2[]; closed: boolean } {
  const ents = Object.values(s.entities).filter((e) => !e.cons && e.t !== "point");
  if (!ents.length) throw new Error("O esboço do caminho está vazio.");
  if (ents.length === 1 && ents[0].t === "circle") {
    const c = pointOf(s, ents[0].c)!;
    return { segs: [{ t: "circle", c, r: ents[0].r, src: ents[0].id }], closed: true };
  }
  if (ents.some((e) => e.t === "circle")) throw new Error("O caminho não pode misturar círculo com outras curvas.");
  const ends = new Map<Id, Id[]>();
  for (const e of ents) for (const p of e.t === "line" ? [e.p1, e.p2] : e.t === "arc" ? [e.p1, e.p2] : []) ends.set(p, [...(ends.get(p) ?? []), e.id]);
  for (const [p, list] of ends) if (list.length > 2) throw new Error(`O caminho ramifica no ponto ${p} — use uma única cadeia.`);
  const tips = [...ends].filter(([, l]) => l.length === 1).map(([p]) => p);
  if (tips.length !== 0 && tips.length !== 2) throw new Error("O caminho precisa ser uma única cadeia conectada.");
  const closed = tips.length === 0;
  let cur = closed ? [...ends.keys()][0] : tips[0];
  const used = new Set<Id>();
  const segs: Seg2[] = [];
  for (let guard = 0; guard < ents.length; guard++) {
    const next = (ends.get(cur) ?? []).find((id) => !used.has(id));
    if (!next) break;
    used.add(next);
    const e = entityOf(s, next)!;
    if (e.t === "line") {
      const fwd = e.p1 === cur;
      const a = pointOf(s, fwd ? e.p1 : e.p2)!;
      const b = pointOf(s, fwd ? e.p2 : e.p1)!;
      segs.push({ t: "line", a, b, src: e.id });
      cur = fwd ? e.p2 : e.p1;
    } else if (e.t === "arc") {
      const c = pointOf(s, e.c)!;
      const p1 = pointOf(s, e.p1)!;
      const p2 = pointOf(s, e.p2)!;
      let sw = Math.atan2(p2.y - c.y, p2.x - c.x) - Math.atan2(p1.y - c.y, p1.x - c.x);
      while (sw <= 0) sw += TAU;
      const fwd = e.p1 === cur;
      segs.push(fwd ? { t: "arc", c, r: dist(c, p1), a: p1, b: p2, sweep: sw, src: e.id } : { t: "arc", c, r: dist(c, p1), a: p2, b: p1, sweep: -sw, src: e.id });
      cur = fwd ? e.p2 : e.p1;
    }
  }
  if (used.size !== ents.length) throw new Error("O caminho tem curvas desconectadas.");
  return { segs, closed };
}

/** Ponto médio de um trecho (âncora de face lateral). */
export function segMidpoint(s: Seg2): Pt {
  if (s.t === "line") return { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
  if (s.t === "circle") return { x: s.c.x + s.r, y: s.c.y };
  const a0 = Math.atan2(s.a.y - s.c.y, s.a.x - s.c.x) + s.sweep / 2;
  return { x: s.c.x + s.r * Math.cos(a0), y: s.c.y + s.r * Math.sin(a0) };
}
