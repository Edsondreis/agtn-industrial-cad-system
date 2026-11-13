import { type Entity, type Vec2, makeEntity } from "@agtn/geometry";
import { fmtMM } from "../output";
import { segSeg } from "@agtn/geometry";
import { edgeBulge, edgeMid, edgeSeg, edgesArea, edgesLength, rayFrom } from "./edges";
import { type V2, add2, apply2, cross2, dot2, len2, mul2, polyArea, sub2, v2 } from "./math";
import type { Loop2, LoopSeg, OutlineEdge, SheetSolved, SolvedBend } from "./model";
import { loopArea } from "./solve";
import { dimAbs, interfArea } from "./tolerance";

/**
 * PLANIFICAÇÃO — leitura do MESMO grafo resolvido (`solveSheet`): nenhuma fórmula nova.
 *  peças: região plana de cada aba (H·região) + faixa de cada dobra (largura BA, entre `flatStart` e `flatEnd`)
 *  contorno de corte = fronteira da união das peças: arestas orientadas (anti-horárias) de todas as peças,
 *  divididas nos pontos de contato, com os pares opostos (arestas internas comuns) cancelados.
 *  Conferências: área da união = Σ áreas (sem sobreposição nem fresta); nenhuma peça invade outra.
 */
export interface FlatBend {
  readonly id: string;
  readonly label: string;
  /** número na ordem de dobra (D1…) */
  readonly n: number;
  readonly sense: "CIMA" | "BAIXO";
  readonly deflectionDeg: number;
  readonly includedDeg: number;
  readonly R: number;
  readonly K: number;
  readonly kSource: SolvedBend["kSource"];
  readonly BA: number;
  readonly BD: number;
  readonly L: number;
  /** ponta da faixa dentro da aresta (alívio aplicável) */
  readonly partial: boolean;
  readonly relief: SolvedBend["relief"] | null;
  readonly line: readonly [V2, V2];
  readonly start: readonly [V2, V2];
  readonly end: readonly [V2, V2];
}
export interface FlatPattern {
  /** "valida" = representa exatamente o sólido de chapa; "invalida" com motivos */
  readonly state: "valida" | "invalida";
  readonly reasons: readonly string[];
  /** contornos de corte (anti-horário = externo, horário = vazio interno): vértices… */
  readonly cut: readonly (readonly V2[])[];
  /** …e o bulge de cada trecho (0 = reta; arcos dos alívios), paralelo a `cut` */
  readonly cutBulges: readonly (readonly number[])[];
  /** furos/recortes internos das abas */
  readonly holes: readonly Loop2[];
  readonly bends: readonly FlatBend[];
  readonly box: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
  readonly area: number;
  readonly cutLength: number;
}

interface Piece {
  id: string;
  edges: OutlineEdge[];
  poly: V2[];
}
const mapEdge = (e: OutlineEdge, f: (p: V2) => V2): OutlineEdge => ({ key: e.key, a: f(e.a), b: f(e.b), ...(e.arc ? { arc: { c: f(e.arc.c), sweep: e.arc.sweep } } : {}) });
const polyPiece = (id: string, pts: V2[]): Piece => ({ id, poly: pts, edges: pts.map((a, i) => ({ key: "", a, b: pts[(i + 1) % pts.length] })) });

export function flatPattern(s: SheetSolved, extraInvalid: readonly string[] = []): FlatPattern {
  const reasons: string[] = [...extraInvalid];
  if (!s.ok) return { state: "invalida", reasons: ["A peça de chapa tem erro."], cut: [], cutBulges: [], holes: [], bends: [], box: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, area: 0, cutLength: 0 };
  const pieces: Piece[] = [];
  const holes: Loop2[] = [];
  for (const f of s.flanges) {
    const edges = f.flat.map((e) => mapEdge(e, (p) => apply2(f.H, p)));
    pieces.push({ id: f.id, edges, poly: edges.map((e) => e.a) });
    for (const h of f.holes) holes.push(mapLoop(h.loop, (p) => apply2(f.H, p)));
  }
  for (const b of s.bends) {
    const r = [b.flatStart[0], b.flatEnd[0], b.flatEnd[1], b.flatStart[1]];
    pieces.push(polyPiece(b.id, polyArea(r) >= 0 ? r : r.reverse()));
  }
  let size = 1;
  for (const p of pieces) for (const q of p.poly) size = Math.max(size, Math.abs(q.x), Math.abs(q.y));
  const tol = dimAbs(size);

  // peças vizinhas (aba–dobra) dividem uma aresta; encostar num ponto (canto aberto) também é permitido:
  // só conta sobreposição de INTERIORES
  const overlapping: string[] = [];
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++)
      if (overlaps(pieces[i], pieces[j], tol)) overlapping.push(`${labelOf(s, pieces[i].id)} × ${labelOf(s, pieces[j].id)}`);
  if (overlapping.length) reasons.push(`Sobreposição na planificação: ${overlapping.join(", ")}.`);

  const loops = overlapping.length ? [] : boundary(pieces, tol);
  const cut = loops.map((l) => l.map((e) => e.a));
  const cutBulges = loops.map((l) => l.map(edgeBulge));
  const cutArea = loops.reduce((a, l) => a + edgesArea(l), 0);
  const holeArea = holes.reduce((a, h) => a + Math.abs(loopArea(h)), 0);
  if (!overlapping.length && Math.abs(cutArea - holeArea - s.flatArea) > interfArea(s.flatArea))
    reasons.push(`Planificação inconsistente: área do contorno ${fmtMM(cutArea - holeArea, 6)} mm² ≠ área do grafo ${fmtMM(s.flatArea, 6)} mm².`);

  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pieces) for (const q of p.poly) {
    box.minX = Math.min(box.minX, q.x);
    box.minY = Math.min(box.minY, q.y);
    box.maxX = Math.max(box.maxX, q.x);
    box.maxY = Math.max(box.maxY, q.y);
  }
  const bends: FlatBend[] = s.bends.map((b, i) => ({
    id: b.id,
    label: b.label,
    n: i + 1,
    sense: b.side === "cima" ? "CIMA" : "BAIXO",
    deflectionDeg: b.deflectionDeg,
    includedDeg: b.includedDeg,
    R: b.R,
    K: b.K,
    kSource: b.kSource,
    BA: b.BA,
    BD: b.BD,
    L: b.L,
    partial: b.partial,
    relief: b.relief ?? null,
    line: b.flatLine,
    start: b.flatStart,
    end: b.flatEnd,
  }));
  const cutLength = loops.reduce((a, l) => a + edgesLength(l), 0) + holes.reduce((a, h) => a + loopLength(h), 0);
  return { state: reasons.length ? "invalida" : "valida", reasons, cut, cutBulges, holes, bends, box, area: s.flatArea, cutLength };
}

const labelOf = (s: SheetSolved, id: string) => s.flanges.find((f) => f.id === id)?.label ?? `região de ${s.bends.find((b) => b.id === id)?.label ?? id}`;

/* -------------------------------------------------------------------------------------- sobreposição */

/** Interiores se cruzam? (encostar numa aresta ou num ponto não conta; arcos exatos) */
function overlaps(A: Piece, B: Piece, tol: number): boolean {
  const a = A.poly;
  const b = B.poly;
  const bx = (p: readonly V2[]) => [Math.min(...p.map((q) => q.x)), Math.min(...p.map((q) => q.y)), Math.max(...p.map((q) => q.x)), Math.max(...p.map((q) => q.y))];
  const [a0, a1, a2, a3] = bx(a);
  const [b0, b1, b2, b3] = bx(b);
  // caixa dos vértices: os arcos de alívio são entalhes (removem material), a caixa da peça continua conservadora
  if (a2 <= b0 + tol || b2 <= a0 + tol || a3 <= b1 + tol || b3 <= a1 + tol) return false;
  for (const ea of A.edges)
    for (const eb of B.edges) {
      if (!ea.arc && !eb.arc) {
        if (properCross(ea.a, ea.b, eb.a, eb.b, tol)) return true;
        continue;
      }
      // com arco: cruzamento longe das pontas dos dois trechos
      for (const x of segSeg(edgeSeg(ea), edgeSeg(eb)))
        if ([ea.a, ea.b, eb.a, eb.b].every((q) => len2(sub2(q, x)) > tol)) return true;
    }
  const probes = (P: Piece) => [...P.poly, ...P.edges.map(edgeMid), centroidInside(P.poly)];
  for (const q of probes(A)) if (strictlyInside(q, B, tol)) return true;
  for (const q of probes(B)) if (strictlyInside(q, A, tol)) return true;
  return false;
}
function properCross(p1: V2, p2: V2, q1: V2, q2: V2, tol: number): boolean {
  const d1 = sub2(p2, p1);
  const d2 = sub2(q2, q1);
  const L1 = len2(d1);
  const L2 = len2(d2);
  const o1 = cross2(d1, sub2(q1, p1)) / L1;
  const o2 = cross2(d1, sub2(q2, p1)) / L1;
  const o3 = cross2(d2, sub2(p1, q1)) / L2;
  const o4 = cross2(d2, sub2(p2, q1)) / L2;
  return ((o1 > tol && o2 < -tol) || (o1 < -tol && o2 > tol)) && ((o3 > tol && o4 < -tol) || (o3 < -tol && o4 > tol));
}
function strictlyInside(p: V2, P: Piece, tol: number): boolean {
  for (const e of P.edges) {
    if (e.arc) {
      const r = len2(sub2(e.a, e.arc.c));
      if (Math.abs(len2(sub2(p, e.arc.c)) - r) <= tol) return false;
      continue;
    }
    const ab = sub2(e.b, e.a);
    const t = Math.max(0, Math.min(1, dot2(sub2(p, e.a), ab) / dot2(ab, ab)));
    if (len2(sub2(p, add2(e.a, mul2(ab, t)))) <= tol) return false;
  }
  // paridade de um raio (direção irracional), arcos exatos
  let n = 0;
  const ray = rayFrom(p, P.edges);
  for (const e of P.edges) n += segSeg(ray, edgeSeg(e)).length;
  return n % 2 === 1;
}
function centroidInside(p: readonly V2[]): V2 {
  // ponto interno: média de um triângulo de orelha (polígono simples anti-horário)
  for (let i = 0; i < p.length; i++) {
    const a = p[(i + p.length - 1) % p.length];
    const b = p[i];
    const c = p[(i + 1) % p.length];
    if (cross2(sub2(b, a), sub2(c, b)) > 0) return v2((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3);
  }
  return p[0];
}

/* -------------------------------------------------------------------------------------- fronteira */

function boundary(pieces: readonly Piece[], tol: number): OutlineEdge[][] {
  const raw: OutlineEdge[] = [];
  for (const p of pieces) raw.push(...p.edges);
  const verts = raw.map((e) => e.a);
  // divide cada RETA nos vértices de outras peças que caem sobre ela (arcos de alívio não são compartilhados)
  const atoms: OutlineEdge[] = [];
  for (const e of raw) {
    if (e.arc) {
      atoms.push(e);
      continue;
    }
    const d = sub2(e.b, e.a);
    const L = len2(d);
    const ts: number[] = [];
    for (const v of verts) {
      const t = dot2(sub2(v, e.a), d) / (L * L);
      if (t * L <= tol || (1 - t) * L <= tol) continue;
      if (Math.abs(cross2(d, sub2(v, e.a))) / L <= tol) ts.push(t);
    }
    ts.sort((x, y) => x - y);
    let prev = e.a;
    for (const t of ts) {
      const q = add2(e.a, mul2(d, t));
      if (len2(sub2(q, prev)) > tol) {
        atoms.push({ key: e.key, a: prev, b: q });
        prev = q;
      }
    }
    atoms.push({ key: e.key, a: prev, b: e.b });
  }
  // cancela pares opostos de retas (aresta interna comum a duas peças)
  const same = (p: V2, q: V2) => len2(sub2(p, q)) <= tol;
  const alive = atoms.map(() => true);
  for (let i = 0; i < atoms.length; i++) {
    if (!alive[i] || atoms[i].arc) continue;
    for (let j = i + 1; j < atoms.length; j++) {
      if (!alive[j] || atoms[j].arc) continue;
      if (same(atoms[i].a, atoms[j].b) && same(atoms[i].b, atoms[j].a)) {
        alive[i] = alive[j] = false;
        break;
      }
    }
  }
  const rest = atoms.filter((_, i) => alive[i]);
  const dirOut = (e: OutlineEdge, atEnd: boolean): V2 => {
    if (!e.arc) return sub2(e.b, e.a);
    // tangente do arco na ponta (sentido de percurso)
    const p = atEnd ? e.b : e.a;
    const r = sub2(p, e.arc.c);
    return e.arc.sweep >= 0 ? v2(-r.y, r.x) : v2(r.y, -r.x);
  };
  const used = rest.map(() => false);
  const loops: OutlineEdge[][] = [];
  for (let s0 = 0; s0 < rest.length; s0++) {
    if (used[s0]) continue;
    const loop: OutlineEdge[] = [];
    let cur = s0;
    for (let guard = 0; guard <= rest.length; guard++) {
      used[cur] = true;
      loop.push(rest[cur]);
      const end = rest[cur].b;
      if (same(end, rest[s0].a) && guard > 0) break;
      const din = dirOut(rest[cur], true);
      let best = -1;
      let bestAng = Infinity;
      for (let k = 0; k < rest.length; k++) {
        if (used[k] && k !== s0) continue;
        if (!same(rest[k].a, end)) continue;
        const dout = dirOut(rest[k], false);
        const ang = Math.atan2(cross2(din, dout), dot2(din, dout));
        if (ang < bestAng) {
          bestAng = ang;
          best = k;
        }
      }
      if (best < 0 || best === s0) break;
      cur = best;
    }
    // funde retas colineares consecutivas
    const out: OutlineEdge[] = [];
    for (const e of loop) {
      const last = out[out.length - 1];
      if (last && !last.arc && !e.arc) {
        const ab = sub2(last.b, last.a);
        const bc = sub2(e.b, e.a);
        if (Math.abs(cross2(ab, bc)) / (len2(ab) * len2(bc)) <= 1e-12 && dot2(ab, bc) > 0) {
          out[out.length - 1] = { key: last.key, a: last.a, b: e.b };
          continue;
        }
      }
      out.push(e);
    }
    if (out.length > 1 && !out[0].arc && !out[out.length - 1].arc) {
      const f = out[0];
      const l = out[out.length - 1];
      const ab = sub2(l.b, l.a);
      const bc = sub2(f.b, f.a);
      if (Math.abs(cross2(ab, bc)) / (len2(ab) * len2(bc)) <= 1e-12 && dot2(ab, bc) > 0) {
        out[0] = { key: l.key, a: l.a, b: f.b };
        out.pop();
      }
    }
    if (out.length >= 2) loops.push(out);
  }
  loops.sort((p, q) => edgesArea(q) - edgesArea(p));
  return loops;
}

/* ------------------------------------------------------------------------------------------- laços */

function mapLoop(l: Loop2, f: (p: V2) => V2): Loop2 {
  return { segs: l.segs.map((s): LoopSeg => (s.t === "line" ? { t: "line", a: f(s.a), b: f(s.b) } : s.t === "arc" ? { ...s, c: f(s.c), a: f(s.a), b: f(s.b) } : { ...s, c: f(s.c) })) };
}
function loopLength(l: Loop2): number {
  return l.segs.reduce((a, s) => a + (s.t === "line" ? len2(sub2(s.b, s.a)) : s.t === "circle" ? 2 * Math.PI * s.r : s.r * Math.abs(s.sweep)), 0);
}

/* -------------------------------------------------------------------------------- entidades 2D (camadas) */

export interface FlatEntityOptions {
  /** deslocamento: por padrão o canto inferior esquerdo da planificação vai para (0, 0) */
  origin?: Vec2;
  bendRegions?: boolean;
  notes?: boolean;
  title?: string;
  markHeight?: number;
}

/**
 * Entidades nas camadas de fabricação existentes (`SM_LAYERS`): CONTORNO_CORTE, LINHAS_DOBRA, REGIAO_DOBRA,
 * MARCACAO ("D1 CIMA 90° RI2", o mesmo texto do 2D) e ANOTACOES. Só para planificação válida.
 */
export function flatEntities(fp: FlatPattern, o: FlatEntityOptions = {}): Entity[] {
  if (fp.state !== "valida") return [];
  const O = o.origin ?? { x: 0, y: 0 };
  const P = (p: V2): Vec2 => ({ x: p.x - fp.box.minX + O.x, y: p.y - fp.box.minY + O.y });
  const out: Entity[] = [];
  fp.cut.forEach((l, i) => out.push(makeEntity({ type: "polyline", pts: l.map(P), bulges: [...(fp.cutBulges[i] ?? l.map(() => 0))], closed: true }, "CONTORNO_CORTE")));
  for (const h of fp.holes) {
    if (h.segs.length === 1 && h.segs[0].t === "circle") out.push(makeEntity({ type: "circle", c: P(h.segs[0].c), r: h.segs[0].r }, "CONTORNO_CORTE"));
    else
      out.push(
        makeEntity(
          { type: "polyline", pts: h.segs.map((s) => P((s as { a: V2 }).a)), bulges: h.segs.map((s) => (s.t === "arc" ? Math.tan(s.sweep / 4) : 0)), closed: true },
          "CONTORNO_CORTE",
        ),
      );
  }
  const w = fp.box.maxX - fp.box.minX;
  const hgt = fp.box.maxY - fp.box.minY;
  const mh = Math.max(1, Math.min(o.markHeight ?? 5, Math.min(w, hgt) / 30));
  for (const b of fp.bends) {
    out.push(makeEntity({ type: "line", a: P(b.line[0]), b: P(b.line[1]) }, "LINHAS_DOBRA"));
    if (o.bendRegions ?? true) {
      out.push(makeEntity({ type: "line", a: P(b.start[0]), b: P(b.start[1]) }, "REGIAO_DOBRA"));
      out.push(makeEntity({ type: "line", a: P(b.end[0]), b: P(b.end[1]) }, "REGIAO_DOBRA"));
    }
    if (o.notes ?? true) {
      const d = sub2(b.line[1], b.line[0]);
      const L = len2(d);
      const u = mul2(d, 1 / L);
      const at = add2(add2(b.line[0], mul2(u, Math.min(10, L * 0.05))), v2(-u.y * mh * 0.4, u.x * mh * 0.4));
      out.push(
        makeEntity(
          { type: "text", p: P(at), h: mh, rot: Math.atan2(u.y, u.x), value: `D${b.n} ${b.sense} ${fmtMM(b.deflectionDeg, 1)}° RI${fmtMM(b.R)}`, halign: 0 },
          "MARCACAO",
        ),
      );
    }
  }
  if (o.title && (o.notes ?? true)) out.push(makeEntity({ type: "text", p: { x: O.x, y: O.y - mh * 3 }, h: mh * 1.2, rot: 0, value: o.title, halign: 0 }, "ANOTACOES"));
  return out;
}
