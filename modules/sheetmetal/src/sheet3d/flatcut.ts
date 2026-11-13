import { segSeg } from "@agtn/geometry";
import { edgeSeg, edgesArea, pointInEdges } from "./edges";
import { type V2, add2, apply2, cross2, dot2, invert, len2, mul2, right2, sub2, unit2, v2 } from "./math";
import type { Loop2, LoopSeg, OutlineEdge, SheetIssue, SolvedBend, SolvedFlange, SolvedHole } from "./model";
import { dimAbs } from "./tolerance";

/**
 * RECORTE NA PLANIFICAÇÃO (ETAPA 2.4) — aplicado ao grafo já resolvido, sem segundo motor:
 *  - faixa de dobra: o laço, nas coordenadas (u, s) da faixa, só pode ter lados com u constante ou s constante;
 *    a faixa vira fatias em u com intervalos de material em s (no 3D: setores parciais pela fibra neutra);
 *  - região plana: o laço que entra pela linha de tangência vira um ENTALHE no contorno (mesma aresta de entrada e
 *    de saída); laço inteiro dentro da região vira furo;
 *  - o laço não pode tocar o contorno externo da planificação, nem outro furo; arco ou círculo dentro de uma faixa
 *    e lado oblíquo à dobra dentro da faixa são bloqueados (sem aproximação).
 */
export interface FlatCut {
  readonly op: string;
  readonly label: string;
  readonly key: string;
  readonly loop: Loop2;
}
type Err = (code: string, message: string, extra?: Omit<SheetIssue, "level" | "code" | "message">) => void;

const mapSeg = (s: LoopSeg, f: (p: V2) => V2): LoopSeg =>
  s.t === "line" ? { t: "line", a: f(s.a), b: f(s.b) } : s.t === "arc" ? { ...s, c: f(s.c), a: f(s.a), b: f(s.b) } : { ...s, c: f(s.c) };
const segEdge = (s: Exclude<LoopSeg, { t: "circle" }>, key: string): OutlineEdge => (s.t === "line" ? { key, a: s.a, b: s.b } : { key, a: s.a, b: s.b, arc: { c: s.c, sweep: s.sweep } });
/** ponto do trecho no parâmetro t ∈ [0, 1] (arco: proporcional ao ângulo) */
function at(e: OutlineEdge, t: number): V2 {
  if (!e.arc) return add2(e.a, mul2(sub2(e.b, e.a), t));
  const r = len2(sub2(e.a, e.arc.c));
  const a0 = Math.atan2(e.a.y - e.arc.c.y, e.a.x - e.arc.c.x) + e.arc.sweep * t;
  return v2(e.arc.c.x + r * Math.cos(a0), e.arc.c.y + r * Math.sin(a0));
}
/** trecho [t0, t1] de uma aresta (t1 < t0 = sentido inverso) */
function piece(e: OutlineEdge, t0: number, t1: number, key: string): OutlineEdge {
  const a = at(e, t0);
  const b = at(e, t1);
  return e.arc ? { key, a, b, arc: { c: e.arc.c, sweep: e.arc.sweep * (t1 - t0) } } : { key, a, b, ...(e.bend ? { bend: e.bend } : {}) };
}
/** parâmetro de p (sobre a aresta) */
function paramOf(e: OutlineEdge, p: V2): number {
  if (!e.arc) {
    const d = sub2(e.b, e.a);
    return dot2(sub2(p, e.a), d) / dot2(d, d);
  }
  const c = e.arc.c;
  const a0 = Math.atan2(e.a.y - c.y, e.a.x - c.x);
  let da = Math.atan2(p.y - c.y, p.x - c.x) - a0;
  const s = e.arc.sweep;
  // normaliza no sentido da varredura
  if (s >= 0) while (da < 0) da += 2 * Math.PI;
  else while (da > 0) da -= 2 * Math.PI;
  return da / s;
}

export interface FlatCutResult {
  readonly flanges: SolvedFlange[];
  readonly bends: SolvedBend[];
}

export function applyFlatCuts(cuts: readonly FlatCut[], flanges: readonly SolvedFlange[], bends: readonly SolvedBend[], err: Err): FlatCutResult | null {
  let size = 1;
  for (const f of flanges) for (const e of f.flat) {
    const q = apply2(f.H, e.a);
    size = Math.max(size, Math.abs(q.x), Math.abs(q.y));
  }
  const tol = dimAbs(size);
  const outF = flanges.map((f) => ({ ...f, flat: [...f.flat], holes: [...f.holes] }));
  const outB = bends.map((b) => ({ ...b }));
  const byId = new Map(outF.map((f) => [f.id, f]));

  for (const c of cuts) {
    const where = `${c.label}: o recorte ${c.key}`;
    /* ------------------------------------------------------------- faixas de dobra: fatias (u, s) */
    for (const [bi, b] of outB.entries()) {
      const pf = byId.get(b.parent)!;
      const inv = invert(pf.H);
      const [A, B] = b.tangent;
      const d = unit2(sub2(B, A));
      const n = right2(d);
      const L = b.L;
      const BA = b.BA;
      const us = (p: V2) => {
        const q = sub2(apply2(inv, p), A);
        return v2(dot2(q, d), dot2(q, n));
      };
      const segs = c.loop.segs.map((sg) => mapSeg(sg, us));
      const inside = (p: V2) => p.x > tol && p.x < L - tol && p.y > tol && p.y < BA - tol;
      const rect: OutlineEdge[] = [
        { key: "s0", a: v2(0, 0), b: v2(L, 0) },
        { key: "u1", a: v2(L, 0), b: v2(L, BA) },
        { key: "s1", a: v2(L, BA), b: v2(0, BA) },
        { key: "u0", a: v2(0, BA), b: v2(0, 0) },
      ];
      let touches = false;
      const uSet = new Set<number>([0, L]);
      const sSet = new Set<number>([0, BA]);
      for (const sg of segs) {
        if (sg.t === "circle") {
          const q = sg.c;
          const dist = Math.hypot(Math.max(-q.x, 0, q.x - L), Math.max(-q.y, 0, q.y - BA));
          if (dist < sg.r + tol) {
            err("CUT_CIRCLE_BEND", `${where} é circular e encosta ou atravessa a região de ${b.label} — a parede do furo na região dobrada não tem representação exata no núcleo atual (bloqueado, sem aproximação). Furo circular inteiro numa região plana funciona.`, { op: c.op, bends: [b.id] });
            return null;
          }
          continue;
        }
        const e = segEdge(sg, "");
        const hits = rect.flatMap((r) => segSeg(edgeSeg(e), edgeSeg(r)).map((p) => ({ p, r })));
        const enters = hits.length > 0 || inside(e.a) || inside(at(e, 0.5));
        if (!enters) continue;
        // toca as pontas da faixa (u = 0 / L) → toca o contorno da planificação
        for (const h of hits)
          if ((h.r.key === "u0" || h.r.key === "u1") && h.p.y > -tol && h.p.y < BA + tol) {
            err("CUT2_EDGE", `${where} toca a ponta da região de ${b.label} (contorno da planificação) — a ETAPA 2.4 aceita recortes internos ao contorno.`, { op: c.op, bends: [b.id] });
            return null;
          }
        if (sg.t === "arc") {
          const inn = Array.from({ length: 17 }, (_, i) => at(e, i / 16)).some(inside);
          if (!inn && !hits.length) continue;
          err(
            inn ? "CUT2_ARC" : "CUT2_TOUCH",
            inn
              ? `${where} tem arco dentro da região de ${b.label} — só lados retos paralelos ou perpendiculares à dobra atravessam a faixa (oblongo: deixe os arcos nas regiões planas).`
              : `${where} encosta com um arco na linha de tangência de ${b.label} — ajuste para afastar.`,
            { op: c.op, bends: [b.id] },
          );
          return null;
        }
        // reta: o trecho dentro da faixa precisa ser paralelo (s const.) ou perpendicular (u const.) à dobra
        const dd = sub2(e.b, e.a);
        const Ld = len2(dd);
        const par = Math.abs(dd.y) <= 1e-9 * Ld;
        const perp = Math.abs(dd.x) <= 1e-9 * Ld;
        if (!par && !perp) {
          err("CUT2_OBLIQUE", `${where} tem lado oblíquo à linha de dobra dentro da região de ${b.label} — só lados paralelos ou perpendiculares à dobra (corte normal à chapa exato pela fibra neutra).`, { op: c.op, bends: [b.id] });
          return null;
        }
        if (par) {
          const y = (e.a.y + e.b.y) / 2;
          if (Math.abs(y) <= tol || Math.abs(y - BA) <= tol) {
            touches = true;
            continue;
          }
          if (y > 0 && y < BA) sSet.add(y);
        } else {
          const x = (e.a.x + e.b.x) / 2;
          if (x > 0 && x < L) uSet.add(x);
        }
      }
      if (touches) {
        err("CUT2_TOUCH", `${where} corre sobre a linha de tangência de ${b.label} — ajuste para cruzar a faixa ou ficar fora dela.`, { op: c.op, bends: [b.id] });
        return null;
      }
      const uu = [...uSet].sort((x, y) => x - y);
      const ss = [...sSet].sort((x, y) => x - y);
      // laço retilíneo que entra na faixa tem lados com u constante dentro dela; sem eles, não entra
      if (uu.length === 2 && ss.length === 2) continue;
      // células: dentro do laço = removida
      const slabs: { u0: number; u1: number; mat: [number, number][] }[] = [];
      let removed = false;
      for (let i = 0; i + 1 < uu.length; i++) {
        const mat: [number, number][] = [];
        for (let j = 0; j + 1 < ss.length; j++) {
          const ctr = v2((uu[i] + uu[i + 1]) / 2, (ss[j] + ss[j + 1]) / 2);
          if (pointInEdgesLoop(ctr, segs)) {
            removed = true;
            continue;
          }
          const last = mat[mat.length - 1];
          if (last && Math.abs(last[1] - ss[j]) <= 1e-12) last[1] = ss[j + 1];
          else mat.push([ss[j], ss[j + 1]]);
        }
        const prev = slabs[slabs.length - 1];
        if (prev && prev.mat.length === mat.length && prev.mat.every((m, k) => m[0] === mat[k][0] && m[1] === mat[k][1])) prev.u1 = uu[i + 1];
        else slabs.push({ u0: uu[i], u1: uu[i + 1], mat });
      }
      if (!removed) continue;
      // fusão com recortes anteriores na mesma faixa: interseção dos materiais
      const prevCut = outB[bi].cut;
      let merged = slabs;
      if (prevCut) merged = intersectSlabs(prevCut.slabs, slabs);
      const usAll = [...new Set([...merged.flatMap((q) => [q.u0, q.u1])])].sort((x, y) => x - y);
      const ssAll = [...new Set(merged.flatMap((q) => q.mat.flat()))].sort((x, y) => x - y);
      outB[bi] = { ...outB[bi], cut: { ops: [...(prevCut?.ops ?? []), c.op], us: usAll, ss: ssAll, slabs: merged } };
    }

    /* ------------------------------------------------------------- regiões planas: entalhe ou furo */
    for (const [fi, f] of outF.entries()) {
      const inv = invert(f.H);
      const segs = c.loop.segs.map((sg) => mapSeg(sg, (p) => apply2(inv, p)));
      const E = f.flat;
      if (segs.length === 1 && segs[0].t === "circle") {
        const cc = segs[0];
        // círculo: dentro da região (furo) ou longe dela; tocar a borda é erro
        const dmin = Math.min(...E.map((e) => distPointEdge(cc.c, e)));
        if (pointInEdges(cc.c, E) && dmin > cc.r + tol) {
          outF[fi] = { ...outF[fi], holes: [...outF[fi].holes, { key: `${c.op}#${c.key}`, op: c.op, loop: { segs, key: c.key } } as SolvedHole] };
        } else if (Math.abs(dmin - cc.r) <= tol || (dmin < cc.r && pointInEdges(cc.c, E))) {
          err("CUT2_EDGE", `${where} toca a borda de ${f.label}.`, { op: c.op, flanges: [f.id] });
          return null;
        }
        continue;
      }
      const LE = segs.map((sg, i) => segEdge(sg as Exclude<LoopSeg, { t: "circle" }>, `${c.op}#${c.key}:${i}`));
      type X = { ie: number; te: number; il: number; tl: number; p: V2 };
      const xs: X[] = [];
      for (const [il, le] of LE.entries())
        for (const [ie, e] of E.entries()) {
          for (const p of segSeg(edgeSeg(le), edgeSeg(e))) {
            const te = paramOf(e, p);
            const tl = paramOf(le, p);
            if (!e.bend) {
              err("CUT2_EDGE", `${where} toca o contorno de ${f.label} (borda externa da planificação) — a ETAPA 2.4 aceita recortes internos.`, { op: c.op, flanges: [f.id] });
              return null;
            }
            const eL = len2(sub2(e.b, e.a));
            if (te * eL <= tol || (1 - te) * eL <= tol || le.arc || tl <= 1e-9 || tl >= 1 - 1e-9) {
              err("CUT2_TOUCH", `${where} cruza a linha de tangência de ${f.label} num vértice ou em arco — ajuste a posição.`, { op: c.op, flanges: [f.id] });
              return null;
            }
            xs.push({ ie, te, il, tl, p });
          }
        }
      if (!xs.length) {
        if (pointInEdges(at(LE[0], 0.5), E)) {
          for (const h of outF[fi].holes)
            if (loopsTouch(LE, h.loop, tol)) {
              err("CUT_OVERLAP", `${where} toca o furo ${h.key} de ${f.label}.`, { op: c.op, flanges: [f.id] });
              return null;
            }
          outF[fi] = { ...outF[fi], holes: [...outF[fi].holes, { key: `${c.op}#${c.key}`, op: c.op, loop: { segs, key: c.key } } as SolvedHole] };
        }
        continue;
      }
      // furos da região não podem encostar no recorte
      for (const h of outF[fi].holes)
        if (loopsTouch(LE, h.loop, tol)) {
          err("CUT_OVERLAP", `${where} toca o furo ${h.key} de ${f.label}.`, { op: c.op, flanges: [f.id] });
          return null;
        }
      // trechos do laço entre cruzamentos consecutivos; os de dentro da região viram entalhes
      xs.sort((a, b) => a.il - b.il || a.tl - b.tl);
      if (xs.length % 2) {
        err("CUT2_TOUCH", `${where} encosta na linha de tangência de ${f.label} sem atravessar.`, { op: c.op, flanges: [f.id] });
        return null;
      }
      const portions: { from: X; to: X; path: OutlineEdge[] }[] = [];
      for (let k = 0; k < xs.length; k++) {
        const x0 = xs[k];
        const x1 = xs[(k + 1) % xs.length];
        const path: OutlineEdge[] = [];
        // de x0 até x1 seguindo o laço (o último par dá a volta)
        const wrap = k === xs.length - 1;
        let il = x0.il;
        let t = x0.tl;
        for (let guard = 0, first = true; guard <= LE.length + 1; guard++, first = false) {
          if (il === x1.il && x1.tl >= t && !(first && wrap)) {
            if (x1.tl - t > 1e-12) path.push(piece(LE[il], t, x1.tl, LE[il].key));
            break;
          }
          if (1 - t > 1e-12) path.push(piece(LE[il], t, 1, LE[il].key));
          il = (il + 1) % LE.length;
          t = 0;
        }
        const mid = path.length ? at(path[Math.floor(path.length / 2)], 0.5) : x0.p;
        if (pointInEdges(mid, E)) portions.push({ from: x0, to: x1, path });
      }
      const newE: OutlineEdge[] = [];
      const keyCount = new Map<string, number>();
      const uniq = (e: OutlineEdge): OutlineEdge => {
        const n = (keyCount.get(e.key) ?? 0) + 1;
        keyCount.set(e.key, n);
        return n === 1 ? e : { ...e, key: `${e.key}.${n}` };
      };
      for (const [ie, e] of E.entries()) {
        const mine = portions.filter((q) => q.from.ie === ie || q.to.ie === ie);
        if (!mine.length) {
          newE.push(e);
          continue;
        }
        for (const q of mine)
          if (q.from.ie !== q.to.ie) {
            err("CUT2_SPLIT", `${where} entra e sai de ${f.label} por linhas de tangência diferentes — dividiria a região em duas (não suportado).`, { op: c.op, flanges: [f.id] });
            return null;
          }
        const iv = mine.map((q) => (q.from.te < q.to.te ? { t0: q.from.te, t1: q.to.te, path: q.path } : { t0: q.to.te, t1: q.from.te, path: reversePath(q.path) })).sort((a, b) => a.t0 - b.t0);
        let t = 0;
        for (const v of iv) {
          if (v.t0 < t - 1e-12) {
            err("CUT2_SPLIT", `${where} deixa uma ilha de material em ${f.label} — não suportado.`, { op: c.op, flanges: [f.id] });
            return null;
          }
          newE.push(piece(e, t, v.t0, e.key));
          for (const pe of v.path) newE.push(uniq(pe));
          t = v.t1;
        }
        newE.push(piece(e, t, 1, e.key));
      }
      const area = edgesArea(newE) - outF[fi].holes.reduce((a, h) => a + Math.abs(loopAreaOf(h.loop)), 0);
      outF[fi] = { ...outF[fi], flat: newE, area };
    }
  }
  // áreas das regiões com furos novos
  for (const [fi, f] of outF.entries()) outF[fi] = { ...f, area: edgesArea(f.flat) - f.holes.reduce((a, h) => a + Math.abs(loopAreaOf(h.loop)), 0) };
  return { flanges: outF, bends: outB };
}

function reversePath(p: readonly OutlineEdge[]): OutlineEdge[] {
  return [...p].reverse().map((e) => (e.arc ? { key: e.key, a: e.b, b: e.a, arc: { c: e.arc.c, sweep: -e.arc.sweep } } : { key: e.key, a: e.b, b: e.a }));
}
function intersectSlabs(
  a: readonly { u0: number; u1: number; mat: readonly (readonly [number, number])[] }[],
  b: readonly { u0: number; u1: number; mat: readonly (readonly [number, number])[] }[],
): { u0: number; u1: number; mat: [number, number][] }[] {
  const cuts = [...new Set([...a.flatMap((q) => [q.u0, q.u1]), ...b.flatMap((q) => [q.u0, q.u1])])].sort((x, y) => x - y);
  const out: { u0: number; u1: number; mat: [number, number][] }[] = [];
  const find = (S: typeof a, u: number) => S.find((q) => q.u0 <= u && u <= q.u1)!;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const um = (cuts[i] + cuts[i + 1]) / 2;
    const ma = find(a, um).mat;
    const mb = find(b, um).mat;
    const mat: [number, number][] = [];
    for (const x of ma) for (const y of mb) {
      const lo = Math.max(x[0], y[0]);
      const hi = Math.min(x[1], y[1]);
      if (hi > lo + 1e-12) mat.push([lo, hi]);
    }
    const prev = out[out.length - 1];
    if (prev && prev.mat.length === mat.length && prev.mat.every((m, k) => m[0] === mat[k][0] && m[1] === mat[k][1])) prev.u1 = cuts[i + 1];
    else out.push({ u0: cuts[i], u1: cuts[i + 1], mat });
  }
  return out;
}
function pointInEdgesLoop(p: V2, segs: readonly LoopSeg[]): boolean {
  if (segs.length === 1 && segs[0].t === "circle") return len2(sub2(p, segs[0].c)) < segs[0].r;
  return pointInEdges(p, segs.map((s, i) => segEdge(s as Exclude<LoopSeg, { t: "circle" }>, String(i))));
}
function distPointEdge(p: V2, e: OutlineEdge): number {
  if (e.arc) {
    const r = len2(sub2(e.a, e.arc.c));
    const t = paramOf(e, add2(e.arc.c, mul2(unit2(sub2(p, e.arc.c)), r)));
    if (t >= 0 && t <= 1) return Math.abs(len2(sub2(p, e.arc.c)) - r);
    return Math.min(len2(sub2(p, e.a)), len2(sub2(p, e.b)));
  }
  const ab = sub2(e.b, e.a);
  const t = Math.max(0, Math.min(1, dot2(sub2(p, e.a), ab) / dot2(ab, ab)));
  return len2(sub2(p, add2(e.a, mul2(ab, t))));
}
function loopsTouch(a: readonly OutlineEdge[], h: Loop2, tol: number): boolean {
  const hs = h.segs.map((s, i) =>
    s.t === "circle" ? null : segEdge(s, String(i)),
  );
  if (h.segs.length === 1 && h.segs[0].t === "circle") {
    const c = h.segs[0];
    return a.some((e) => distPointEdge(c.c, e) <= c.r + tol) || pointInEdges(c.c, a);
  }
  const he = hs.filter((x): x is OutlineEdge => x !== null);
  for (const x of a) for (const y of he) if (segSeg(edgeSeg(x), edgeSeg(y)).length) return true;
  return pointInEdges(he[0].a, a) || pointInEdges(a[0].a, he);
}
function loopAreaOf(l: Loop2): number {
  let a = 0;
  for (const s of l.segs) {
    if (s.t === "circle") return Math.PI * s.r * s.r;
    a += cross2(s.a, s.b) / 2;
    if (s.t === "arc") a += (s.r * s.r * (s.sweep - Math.sin(s.sweep))) / 2;
  }
  return a;
}
