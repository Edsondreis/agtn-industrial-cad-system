import { type Seg, arcSeg, lineSeg, segSeg } from "@agtn/geometry";
import { type V2, add2, len2, mul2, polyArea, sub2, v2 } from "./math";
import type { OutlineEdge } from "./model";

/**
 * Arestas de contorno com arco (alívios oblongo/lágrima, ETAPA 2.1b): arco de `a` a `b` em torno de `arc.c`,
 * varredura com sinal (+ = anti-horário). Exatas em todas as leituras: área, ponto interno, OCCT, DXF.
 */
export const edgeRadius = (e: OutlineEdge): number => (e.arc ? len2(sub2(e.a, e.arc.c)) : 0);

export function edgeSeg(e: OutlineEdge): Seg {
  if (!e.arc) return lineSeg(e.a, e.b);
  const c = e.arc.c;
  const r = edgeRadius(e);
  const a0 = Math.atan2(e.a.y - c.y, e.a.x - c.x);
  const b0 = Math.atan2(e.b.y - c.y, e.b.x - c.x);
  return e.arc.sweep >= 0 ? arcSeg(c, r, a0, e.arc.sweep) : arcSeg(c, r, b0, -e.arc.sweep, true);
}

/** ponto no meio do trecho (reta ou arco) */
export function edgeMid(e: OutlineEdge): V2 {
  if (!e.arc) return mul2(add2(e.a, e.b), 0.5);
  const c = e.arc.c;
  const r = edgeRadius(e);
  const a0 = Math.atan2(e.a.y - c.y, e.a.x - c.x) + e.arc.sweep / 2;
  return v2(c.x + r * Math.cos(a0), c.y + r * Math.sin(a0));
}

/** bulge DXF do trecho (tan(varredura/4); reta = 0) */
export const edgeBulge = (e: OutlineEdge): number => (e.arc ? Math.tan(e.arc.sweep / 4) : 0);

/** Área com sinal de um contorno fechado de retas e arcos. */
export function edgesArea(edges: readonly OutlineEdge[]): number {
  let a = polyArea(edges.map((e) => e.a));
  for (const e of edges)
    if (e.arc) {
      const r = edgeRadius(e);
      a += (r * r * (e.arc.sweep - Math.sin(e.arc.sweep))) / 2;
    }
  return a;
}

export function edgesLength(edges: readonly OutlineEdge[]): number {
  return edges.reduce((s, e) => s + (e.arc ? edgeRadius(e) * Math.abs(e.arc.sweep) : len2(sub2(e.b, e.a))), 0);
}

/** Ponto dentro do contorno (paridade de cruzamentos de um raio em direção irracional; arcos exatos). */
export function pointInEdges(p: V2, edges: readonly OutlineEdge[]): boolean {
  const ray = rayFrom(p, edges);
  let n = 0;
  for (const e of edges) n += segSeg(ray, edgeSeg(e)).length;
  return n % 2 === 1;
}

/**
 * Raio de paridade que sai do contorno: comprimento limitado à caixa do contorno (arcos inclusos). Um raio de 1e9
 * perde precisão na interseção reta × círculo e cria cruzamentos falsos perto de arcos pequenos.
 */
export function rayFrom(p: V2, edges: readonly OutlineEdge[]): Seg {
  let m = 0;
  for (const e of edges) {
    const r = edgeRadius(e);
    for (const q of e.arc ? [e.arc.c] : [e.a, e.b]) m = Math.max(m, Math.abs(q.x - p.x) + r, Math.abs(q.y - p.y) + r);
  }
  const far = 4 * m + 1;
  return lineSeg(p, v2(p.x + far, p.y + far * 0.000137036));
}

/** Arco por três pontos conhecidos: centro, início, fim e o sentido (sinal) dado. */
export function arcEdge(key: string, c: V2, a: V2, b: V2, sweep: number): OutlineEdge {
  return { key, a, b, arc: { c, sweep } };
}

/** Varredura com sinal de a para b em torno de c, passando pelo lado de `via`. */
export function sweepVia(c: V2, a: V2, b: V2, via: V2): number {
  const ang = (p: V2) => Math.atan2(p.y - c.y, p.x - c.x);
  let s = ang(b) - ang(a);
  let t = ang(via) - ang(a);
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  s = norm(s);
  t = norm(t);
  // anti-horário passa por `via` se t < s; senão é horário
  return t <= s ? s : s - 2 * Math.PI;
}
