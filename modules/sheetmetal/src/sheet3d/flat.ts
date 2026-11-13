import { type Entity, type Vec2, makeEntity } from "@agtn/geometry";
import { fmtMM } from "../output";
import { type V2, add2, apply2, cross2, dot2, len2, mul2, polyArea, sub2, v2 } from "./math";
import type { Loop2, LoopSeg, SheetSolved, SolvedBend } from "./model";
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
  readonly line: readonly [V2, V2];
  readonly start: readonly [V2, V2];
  readonly end: readonly [V2, V2];
}
export interface FlatPattern {
  /** "valida" = representa exatamente o sólido de chapa; "invalida" com motivos */
  readonly state: "valida" | "invalida";
  readonly reasons: readonly string[];
  /** contornos de corte (anti-horário = externo, horário = vazio interno) */
  readonly cut: readonly (readonly V2[])[];
  /** furos/recortes internos das abas */
  readonly holes: readonly Loop2[];
  readonly bends: readonly FlatBend[];
  readonly box: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
  readonly area: number;
  readonly cutLength: number;
}

interface Piece {
  id: string;
  poly: V2[];
}

export function flatPattern(s: SheetSolved, extraInvalid: readonly string[] = []): FlatPattern {
  const reasons: string[] = [...extraInvalid];
  if (!s.ok) return { state: "invalida", reasons: ["A peça de chapa tem erro."], cut: [], holes: [], bends: [], box: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, area: 0, cutLength: 0 };
  const pieces: Piece[] = [];
  const holes: Loop2[] = [];
  for (const f of s.flanges) {
    pieces.push({ id: f.id, poly: f.flat.map((e) => apply2(f.H, e.a)) });
    for (const h of f.holes) holes.push(mapLoop(h.loop, (p) => apply2(f.H, p)));
  }
  for (const b of s.bends) {
    const r = [b.flatStart[0], b.flatEnd[0], b.flatEnd[1], b.flatStart[1]];
    pieces.push({ id: b.id, poly: polyArea(r) >= 0 ? r : r.reverse() });
  }
  let size = 1;
  for (const p of pieces) for (const q of p.poly) size = Math.max(size, Math.abs(q.x), Math.abs(q.y));
  const tol = dimAbs(size);

  // peças vizinhas (aba–dobra) dividem uma aresta; encostar num ponto (canto aberto) também é permitido:
  // só conta sobreposição de INTERIORES
  const overlapping: string[] = [];
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++)
      if (overlaps(pieces[i].poly, pieces[j].poly, tol)) overlapping.push(`${labelOf(s, pieces[i].id)} × ${labelOf(s, pieces[j].id)}`);
  if (overlapping.length) reasons.push(`Sobreposição na planificação: ${overlapping.join(", ")}.`);

  const cut = overlapping.length ? [] : boundary(pieces, tol);
  const cutArea = cut.reduce((a, l) => a + polyArea(l), 0);
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
    line: b.flatLine,
    start: b.flatStart,
    end: b.flatEnd,
  }));
  const per = (l: readonly V2[]) => l.reduce((a, p, i) => a + len2(sub2(l[(i + 1) % l.length], p)), 0);
  const cutLength = cut.reduce((a, l) => a + per(l), 0) + holes.reduce((a, h) => a + loopLength(h), 0);
  return { state: reasons.length ? "invalida" : "valida", reasons, cut, holes, bends, box, area: s.flatArea, cutLength };
}

const labelOf = (s: SheetSolved, id: string) => s.flanges.find((f) => f.id === id)?.label ?? `região de ${s.bends.find((b) => b.id === id)?.label ?? id}`;

/* -------------------------------------------------------------------------------------- sobreposição */

/** Interiores se cruzam? (encostar numa aresta ou num ponto não conta) */
function overlaps(a: readonly V2[], b: readonly V2[], tol: number): boolean {
  // caixas
  const bx = (p: readonly V2[]) => [Math.min(...p.map((q) => q.x)), Math.min(...p.map((q) => q.y)), Math.max(...p.map((q) => q.x)), Math.max(...p.map((q) => q.y))];
  const [a0, a1, a2, a3] = bx(a);
  const [b0, b1, b2, b3] = bx(b);
  if (a2 <= b0 + tol || b2 <= a0 + tol || a3 <= b1 + tol || b3 <= a1 + tol) return false;
  // cruzamento próprio de arestas
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) if (properCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length], tol)) return true;
  // vértice estritamente dentro do outro, ou ponto médio de aresta dentro (polígonos iguais/contidos)
  const probes = (p: readonly V2[]) => [...p, ...p.map((q, i) => mul2(add2(q, p[(i + 1) % p.length]), 0.5)), centroidInside(p)];
  for (const q of probes(a)) if (strictlyInside(q, b, tol)) return true;
  for (const q of probes(b)) if (strictlyInside(q, a, tol)) return true;
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
function strictlyInside(p: V2, poly: readonly V2[], tol: number): boolean {
  // fora da faixa de tolerância de todas as arestas e dentro pela paridade
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ab = sub2(b, a);
    const t = Math.max(0, Math.min(1, dot2(sub2(p, a), ab) / dot2(ab, ab)));
    if (len2(sub2(p, add2(a, mul2(ab, t)))) <= tol) return false;
  }
  let inside = false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
  }
  return inside;
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

function boundary(pieces: readonly Piece[], tol: number): V2[][] {
  type E = { a: V2; b: V2 };
  const raw: E[] = [];
  for (const p of pieces) for (let i = 0; i < p.poly.length; i++) raw.push({ a: p.poly[i], b: p.poly[(i + 1) % p.poly.length] });
  const verts = raw.map((e) => e.a);
  // divide cada aresta nos vértices de outras peças que caem sobre ela
  const atoms: E[] = [];
  for (const e of raw) {
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
        atoms.push({ a: prev, b: q });
        prev = q;
      }
    }
    atoms.push({ a: prev, b: e.b });
  }
  // cancela pares opostos (aresta interna comum a duas peças)
  const same = (p: V2, q: V2) => len2(sub2(p, q)) <= tol;
  const alive = atoms.map(() => true);
  for (let i = 0; i < atoms.length; i++) {
    if (!alive[i]) continue;
    for (let j = i + 1; j < atoms.length; j++) {
      if (!alive[j]) continue;
      if (same(atoms[i].a, atoms[j].b) && same(atoms[i].b, atoms[j].a)) {
        alive[i] = alive[j] = false;
        break;
      }
    }
  }
  const rest = atoms.filter((_, i) => alive[i]);
  // encadeia
  const used = rest.map(() => false);
  const loops: V2[][] = [];
  for (let s0 = 0; s0 < rest.length; s0++) {
    if (used[s0]) continue;
    const loop: V2[] = [];
    let cur = s0;
    for (let guard = 0; guard <= rest.length; guard++) {
      used[cur] = true;
      loop.push(rest[cur].a);
      const end = rest[cur].b;
      if (same(end, rest[s0].a) && guard > 0) break;
      // próxima: começa no fim desta; se houver mais de uma (peças que só se tocam num ponto), a de giro mais horário
      const din = sub2(rest[cur].b, rest[cur].a);
      let best = -1;
      let bestAng = Infinity;
      for (let k = 0; k < rest.length; k++) {
        if (used[k] && k !== s0) continue;
        if (!same(rest[k].a, end)) continue;
        const dout = sub2(rest[k].b, rest[k].a);
        const ang = Math.atan2(cross2(din, dout), dot2(din, dout)); // −π…π (negativo = horário)
        if (ang < bestAng) {
          bestAng = ang;
          best = k;
        }
      }
      if (best < 0 || best === s0) break;
      cur = best;
    }
    // remove vértices colineares
    const clean: V2[] = [];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[(i + loop.length - 1) % loop.length];
      const b = loop[i];
      const c = loop[(i + 1) % loop.length];
      const ab = sub2(b, a);
      const bc = sub2(c, b);
      if (Math.abs(cross2(ab, bc)) / (len2(ab) * len2(bc)) <= 1e-12 && dot2(ab, bc) > 0) continue;
      clean.push(b);
    }
    if (clean.length >= 3) loops.push(clean);
  }
  // contorno externo primeiro (maior área)
  loops.sort((p, q) => polyArea(q) - polyArea(p));
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
  for (const l of fp.cut) out.push(makeEntity({ type: "polyline", pts: l.map(P), bulges: l.map(() => 0), closed: true }, "CONTORNO_CORTE"));
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
