import { arcSeg, lineSeg, type Seg, segSeg, selfIntersections } from "@agtn/geometry";
import { bendAllowance, bendDeduction, bendToIncluded, deg, insideSetback, outsideSetback } from "../bend";
import { type BendDir, type BendInput, type FlangeInput, solveProfile } from "../engine";
import { flangeFaces } from "../profiles";
import type { ValueSource } from "../materials";
import {
  IDENTITY,
  type Mat,
  type V2,
  type V3,
  add2,
  apply,
  apply2,
  applyDir,
  compose,
  cross2,
  dot2,
  frameMat,
  len2,
  lineX,
  mul2,
  polyArea,
  right2,
  rotation,
  sub2,
  translation,
  unit2,
  v2,
  v3,
} from "./math";
import type {
  SheetBendParams,
  BendSide,
  EdgeRef,
  Loop2,
  LoopSeg,
  OutlineEdge,
  SheetIssue,
  SheetOp,
  SheetRef,
  SheetSolved,
  SheetSpec,
  SolvedBend,
  SolvedFlange,
  SolvedHole,
} from "./model";
import { dimAbs, numAbs } from "./tolerance";

/**
 * Resolve o grafo da chapa em duas fases:
 *  1. TOPOLOGIA, na ordem das operações: cria abas e dobras, confere referências (aresta perdida, já dobrada,
 *     raiz), divide abas pela dobra por linha e reatribui o que ficou do lado móvel.
 *  2. GEOMETRIA, da base para as pontas (árvore, ordem de criação): recuos SB em cada aresta dobrada → região
 *     plana; faixa de dobra BA; posição da filha. 3D e planificação saem da MESMA cadeia:
 *       planificação:  H_filha = H_pai ∘ P
 *       dobrado:       G_filha = G_pai ∘ Rot(eixo, θ) ∘ Trans(−BA·n) ∘ P
 *     P = posição da filha no plano da pai (origem no fim da faixa recuado de SB; x ao longo da aresta, y para
 *     fora). Aba-raiz FIXA (a base), regra de rebatimento única → mesma entrada, mesma geometria e mesma
 *     disposição planificada; editar medidas não inverte nem desloca abas arbitrariamente.
 * Fórmulas: só as de `bend.ts`.
 */

interface WFlange {
  id: string;
  label: string;
  op: string;
  shape: { kind: "poly"; outline: OutlineEdge[] } | { kind: "aba"; length: number };
  holes: SolvedHole[];
  parentBend: string | null;
}
interface WBend {
  id: string;
  label: string;
  op: string;
  kind: "aba" | "contorno" | "linha";
  parent: string;
  edge: string;
  child: string;
  theta: number;
  R: number;
  K: number;
  kSource: ValueSource;
  side: BendSide;
  ref: SheetRef;
  /** dobra por linha: largura de molde da parte móvel na raiz (conferida na fase 2) */
  lineRaiz?: { x0: number; x1: number };
}

const ABA_EDGES = ["raiz", "lado1", "ponta", "lado0"] as const;
const fmt = (v: number, p = 3) => v.toFixed(p).replace(".", ",");

export function setbackFor(ref: SheetRef, thetaDeg: number, R: number, T: number): number {
  const th = deg(thetaDeg);
  return ref === "externa" ? outsideSetback(th, R, T) : insideSetback(th, R);
}

export function solveSheet(spec: SheetSpec): SheetSolved {
  const issues: SheetIssue[] = [];
  const base = spec.base;
  const T = base.defaults.T;
  const err = (code: string, message: string, extra: Omit<SheetIssue, "level" | "code" | "message"> = {}) =>
    issues.push({ level: "error", code, message, ...extra });
  const warn = (code: string, message: string, extra: Omit<SheetIssue, "level" | "code" | "message"> = {}) =>
    issues.push({ level: "warning", code, message, ...extra });
  const fail = (): SheetSolved => ({ ok: false, issues, T, root: base.id, flanges: [], bends: [], volume: NaN, flatArea: NaN });

  /* ------------------------------------------------------------------------------- parâmetros gerais */
  const d = base.defaults;
  if (!(T > 0) || !Number.isFinite(T)) err("T", "Espessura deve ser maior que zero.", { op: base.id });
  if (!(d.R >= 0) || !Number.isFinite(d.R)) err("RADIUS", "Raio interno padrão deve ser ≥ 0.", { op: base.id });
  if (!(d.K >= 0 && d.K <= 1)) err("K_RANGE", "Fator K padrão deve estar entre 0 e 1.", { op: base.id });
  if (base.outline.length < 3) err("BASE_OUTLINE", "A base precisa de um contorno fechado com pelo menos 3 arestas retas.", { op: base.id });
  else if (polyArea(base.outline.map((e) => e.a)) <= 0) err("BASE_OUTLINE", "Contorno da base deve estar no sentido anti-horário (área positiva).", { op: base.id });
  const keys0 = new Set<string>();
  for (const e of base.outline) {
    if (keys0.has(e.key)) err("BASE_KEYS", `Aresta ${e.key} repetida no contorno da base.`, { op: base.id });
    keys0.add(e.key);
  }
  if (issues.some((i) => i.level === "error")) return fail();

  /* ------------------------------------------------------------------------------- fase 1: topologia */
  const flanges = new Map<string, WFlange>();
  const bends = new Map<string, WBend>();
  const order: string[] = []; // ids de dobra em ordem de criação
  flanges.set(base.id, {
    id: base.id,
    label: base.label,
    op: base.id,
    shape: { kind: "poly", outline: [...base.outline] },
    holes: base.holes.map((loop, i) => ({ key: `${base.id}#${i + 1}`, op: base.id, loop })),
    parentBend: null,
  });

  const edgeKeys = (f: WFlange): string[] => (f.shape.kind === "aba" ? [...ABA_EDGES] : f.shape.outline.map((e) => e.key));
  const bentAt = (fid: string, key: string): WBend | undefined => {
    for (const b of bends.values()) if (b.parent === fid && b.edge === key) return b;
    const f = flanges.get(fid);
    if (f?.parentBend && key === "raiz") return bends.get(f.parentBend);
    return undefined;
  };

  const bendParams = (p: SheetBendParams, label: string, op: string): { theta: number; R: number; K: number; kSource: ValueSource } | null => {
    const theta = p.deflectionDeg;
    const R = p.R ?? d.R;
    const K = p.K ?? d.K;
    const kSource = p.kSource ?? (p.K !== undefined ? "manual" : d.kSource);
    let ok = true;
    if (!Number.isFinite(theta) || theta <= 1e-6 || theta >= 180) {
      err("ANGLE", `${label}: ângulo de dobra (deflexão θ) deve estar entre 0° e 180° (exclusivo).`, { op });
      ok = false;
    } else if (theta > 150) warn("ANGLE_HIGH", `${label}: dobra de θ ${fmt(theta, 1)}° — o vértice virtual fica distante; confira a referência dimensional.`, { op });
    if (!Number.isFinite(R) || R < 0) {
      err("RADIUS", `${label}: raio interno deve ser ≥ 0.`, { op });
      ok = false;
    } else if (R === 0) warn("R_ZERO", `${label}: raio interno zero — dobra viva; o resultado depende fortemente do processo.`, { op });
    if (!Number.isFinite(K) || K < 0 || K > 1) {
      err("K_RANGE", `${label}: fator K deve estar entre 0 e 1.`, { op });
      ok = false;
    } else if (K < 0.2 || K > 0.5) warn("K_UNUSUAL", `${label}: K = ${K} está fora da faixa usual (0,20–0,50).`, { op });
    return ok ? { theta, R, K, kSource } : null;
  };

  /** confere que a aresta existe, não é a raiz e está livre */
  const checkEdge = (ref: EdgeRef, op: string, what: string): WFlange | null => {
    const f = flanges.get(ref.flange);
    if (!f) {
      err("REF_LOST", `${what}: referência perdida — a aba ${ref.flange} não existe mais.`, { op, flanges: [ref.flange] });
      return null;
    }
    if (!edgeKeys(f).includes(ref.edge)) {
      err("REF_LOST", `${what}: referência perdida — a aresta ${ref.edge} não existe na ${f.label}.`, { op, flanges: [f.id] });
      return null;
    }
    if (ref.edge === "raiz" && f.parentBend) {
      err("EDGE_ROOT", `${what}: a aresta escolhida é a ligação da ${f.label} com a aba-pai.`, { op, flanges: [f.id] });
      return null;
    }
    const used = bentAt(f.id, ref.edge);
    if (used) {
      err("EDGE_USED", `${what}: a aresta ${ref.edge} da ${f.label} já tem a dobra ${used.label}.`, { op, flanges: [f.id], bends: [used.id] });
      return null;
    }
    return f;
  };

  const addChild = (parent: WFlange, edge: string, id: string, label: string, op: string, kind: WBend["kind"], length: number, bp: NonNullable<ReturnType<typeof bendParams>>, side: BendSide, ref: SheetRef) => {
    flanges.set(id, { id, label, op, shape: { kind: "aba", length }, holes: [], parentBend: id });
    bends.set(id, { id, label, op, kind, parent: parent.id, edge, child: id, ...bp, side, ref });
    order.push(id);
  };

  const applyOp = (op: SheetOp): void => {
    const nErr = () => issues.filter((i) => i.level === "error").length;
    const before = nErr();
    switch (op.t) {
      case "aba": {
        if (!op.edges.length) return void err("NO_EDGE", `${op.label}: escolha pelo menos uma aresta.`, { op: op.id });
        if (!(op.length > 0) || !Number.isFinite(op.length)) return void err("FLANGE_LEN", `${op.label}: comprimento deve ser maior que zero.`, { op: op.id });
        const bp = bendParams(op.bend, op.label, op.id);
        if (!bp) return;
        const seen = new Set<string>();
        const parents: WFlange[] = [];
        for (const e of op.edges) {
          const k = `${e.flange}/${e.edge}`;
          if (seen.has(k)) return void err("EDGE_DUP", `${op.label}: a aresta ${e.edge} foi escolhida duas vezes.`, { op: op.id });
          seen.add(k);
          const f = checkEdge(e, op.id, op.label);
          if (!f) return;
          parents.push(f);
        }
        if (nErr() > before) return;
        op.edges.forEach((e, i) => {
          const id = `${op.id}@${e.flange}/${e.idKey ?? e.edge}`;
          addChild(parents[i], e.edge, id, op.edges.length > 1 ? `${op.label}.${i + 1}` : op.label, op.id, "aba", op.length, bp, op.side, op.ref);
        });
        return;
      }
      case "contorno": {
        if (!op.segments.length) return void err("CONTOUR_EMPTY", `${op.label}: o perfil precisa de pelo menos um segmento.`, { op: op.id });
        const parent = checkEdge(op.edge, op.id, op.label);
        if (!parent) return;
        const bps = op.segments.map((s, i) => bendParams(s.bend, `${op.label} (dobra ${i + 1})`, op.id));
        op.segments.forEach((s, i) => {
          if (!(s.length > 0) || !Number.isFinite(s.length)) err("FLANGE_LEN", `${op.label} (segmento ${i + 1}): comprimento deve ser maior que zero.`, { op: op.id });
        });
        if (nErr() > before || bps.some((b) => !b)) return;
        // seção conferida pelo motor de perfis (mesmas fórmulas e mesma verificação de aba curta/autointerseção)
        const chk = contourProfile(T, op.ref, op.segments.map((s, i) => ({ length: s.length, side: s.side, ...bps[i]! })));
        for (const is of chk.issues) {
          if (is.level !== "error") continue;
          const seg = is.ref?.flange;
          err(
            is.code === "SELF_INTERSECTION" ? "CONTOUR_SELF" : is.code,
            is.code === "SELF_INTERSECTION"
              ? `${op.label}: o perfil se autointercepta — segmentos se cruzam com os comprimentos/ângulos informados.`
              : `${op.label}${seg && seg > 0 ? ` (segmento ${seg})` : ""}: ${is.message.replace(/^[^:]*: /, "")}`,
            { op: op.id },
          );
        }
        if (nErr() > before) return;
        let p = parent;
        let edge = op.edge.edge;
        op.segments.forEach((s, i) => {
          const id = `${op.id}#${i + 1}`;
          addChild(p, edge, id, `${op.label}.${i + 1}`, op.id, "contorno", s.length, bps[i]!, s.side, op.ref);
          p = flanges.get(id)!;
          edge = "ponta";
        });
        return;
      }
      case "linha":
        return splitByLine(op);
      case "recorte": {
        const f = flanges.get(op.flange);
        if (!f) return void err("REF_LOST", `${op.label}: referência perdida — a aba ${op.flange} não existe mais.`, { op: op.id, flanges: [op.flange] });
        if (!op.loops.length) return void err("CUT_EMPTY", `${op.label}: o esboço não tem contorno fechado.`, { op: op.id });
        op.loops.forEach((loop, i) => f.holes.push({ key: `${op.id}#${i + 1}`, op: op.id, loop }));
        return;
      }
    }
  };

  /** Dobra por linha: só em aba de contorno fixo (base ou parte de outra dobra por linha) — ETAPA 1. */
  function splitByLine(op: Extract<SheetOp, { t: "linha" }>): void {
    const f = flanges.get(op.flange);
    if (!f) return void err("REF_LOST", `${op.label}: referência perdida — a aba ${op.flange} não existe mais.`, { op: op.id, flanges: [op.flange] });
    if (f.shape.kind !== "poly")
      return void err("LINE_ON_ABA", `${op.label}: dobra por linha numa aba gerada (${f.label}) não é suportada na ETAPA 1 — use na base de chapa.`, { op: op.id, flanges: [f.id] });
    const bp = bendParams(op.bend, op.label, op.id);
    if (!bp) return;
    const L = len2(sub2(op.b, op.a));
    if (!(L > dimAbs(1))) return void err("LINE_SHORT", `${op.label}: a linha de dobra tem comprimento nulo.`, { op: op.id });
    const u = unit2(sub2(op.b, op.a));
    const m = op.fixed === "esq" ? right2(u) : mul2(right2(u), -1); // normal para o lado MÓVEL
    const s = (p: V2) => dot2(sub2(p, op.a), m);
    const th = deg(bp.theta);
    const BA = bendAllowance(th, bp.R, bp.K, T);
    const SB = setbackFor(op.ref, bp.theta, bp.R, T);
    const BDr = 2 * SB - BA; // desconto na referência da dobra
    const band = Math.max(BA / 2, Math.abs(BDr) / 2);
    const outline = f.shape.outline;
    const size = Math.max(...outline.map((e) => Math.max(Math.abs(e.a.x), Math.abs(e.a.y)))) + 1;
    const tol = dimAbs(size);
    // nenhum vértice dentro da faixa; exatamente duas arestas cruzam, perpendiculares à linha
    for (const e of outline)
      if (Math.abs(s(e.a)) <= band + tol)
        return void err(
          "LINE_VERTEX",
          `${op.label}: há um canto da ${f.label} dentro da região de dobra (±${fmt(band)} mm da linha) — na ETAPA 1 a linha deve cruzar duas arestas retas, longe dos cantos.`,
          { op: op.id, flanges: [f.id] },
        );
    const crossing = outline.filter((e) => (s(e.a) < 0) !== (s(e.b) < 0));
    if (crossing.length !== 2)
      return void err("LINE_CROSS", `${op.label}: a linha de dobra deve atravessar a ${f.label} de lado a lado uma única vez (cruza ${crossing.length} arestas).`, { op: op.id, flanges: [f.id] });
    for (const e of crossing) {
      const de = unit2(sub2(e.b, e.a));
      if (Math.abs(dot2(de, u)) > 1e-9)
        return void err("LINE_OBLIQUE", `${op.label}: a aresta ${e.key} cruza a região de dobra em ângulo — na ETAPA 1 só arestas perpendiculares à linha de dobra.`, { op: op.id, flanges: [f.id] });
      const used = bentAt(f.id, e.key);
      if (used)
        return void err("LINE_BENT_EDGE", `${op.label}: a linha cruza a aresta ${e.key}, que já tem a dobra ${used.label}.`, { op: op.id, flanges: [f.id], bends: [used.id] });
    }
    // furos: inteiramente de um lado, fora da faixa
    const holeSide: (1 | -1)[] = [];
    for (const h of f.holes) {
      const [lo, hi] = loopRangeAlong(h.loop, (p) => s(p));
      if (hi > -BA / 2 - tol && lo < BA / 2 + tol)
        return void err("LINE_HOLE", `${op.label}: o recorte ${h.key} toca a região de dobra.`, { op: op.id, flanges: [f.id] });
      holeSide.push(lo >= BA / 2 ? 1 : -1);
    }
    const fixedOutline = clipHalf(outline, (p) => BDr / 2 - s(p), `dobra:${op.id}`);
    const movFlat = clipHalf(outline, (p) => s(p) + BDr / 2, "raiz");
    // sistema local da parte móvel: origem no fim da aresta nova da fixa + (BA − 2·SB)·m; x = −d, y = m
    const cut = fixedOutline.find((e) => e.key === `dobra:${op.id}`)!;
    const dd = unit2(sub2(cut.b, cut.a));
    const o = add2(cut.b, mul2(m, BA - 2 * SB));
    const toLocal = (p: V2): V2 => {
      const q = sub2(p, o);
      return v2(-dot2(q, dd), dot2(q, m));
    };
    const movOutline = movFlat.map((e) => ({ key: e.key, a: toLocal(e.a), b: toLocal(e.b) }));
    const raiz = movOutline.find((e) => e.key === "raiz")!;
    const mid = `${op.id}~${f.id}`;
    const moving: WFlange = { id: mid, label: `${op.label} (parte móvel)`, op: op.id, shape: { kind: "poly", outline: movOutline }, holes: [], parentBend: mid };
    // reatribui à parte móvel o que está do lado móvel
    const movingKeys = new Set(outline.filter((e) => s(e.a) > 0 && s(e.b) > 0).map((e) => e.key));
    for (const b of bends.values()) if (b.parent === f.id && movingKeys.has(b.edge)) b.parent = mid;
    const keepHoles: SolvedHole[] = [];
    f.holes.forEach((h, i) => (holeSide[i] > 0 ? moving.holes.push({ ...h, loop: mapLoop(h.loop, toLocal) }) : keepHoles.push(h)));
    f.holes = keepHoles;
    f.shape = { kind: "poly", outline: fixedOutline };
    flanges.set(mid, moving);
    bends.set(mid, {
      id: mid,
      label: op.label,
      op: op.id,
      kind: "linha",
      parent: f.id,
      edge: `dobra:${op.id}`,
      child: mid,
      ...bp,
      side: op.side,
      ref: op.ref,
      lineRaiz: { x0: Math.min(raiz.a.x, raiz.b.x), x1: Math.max(raiz.a.x, raiz.b.x) },
    });
    order.push(mid);
  }

  for (const op of spec.ops) applyOp(op);
  if (issues.some((i) => i.level === "error")) return fail();

  /* ------------------------------------------------------------------------------- fase 2: geometria */
  const outF: SolvedFlange[] = [];
  const outB: SolvedBend[] = [];
  const childrenOf = (fid: string) => order.map((id) => bends.get(id)!).filter((b) => b.parent === fid);
  const pl = base.plane;
  const z0 = base.side === "baixo" ? -T : 0;
  const G0 = frameMat(v3(pl.o.x + pl.n.x * z0, pl.o.y + pl.n.y * z0, pl.o.z + pl.n.z * z0), pl.x, pl.y, pl.n);

  const visit = (fid: string, G: Mat, H: Mat, outline: OutlineEdge[]): boolean => {
    const f = flanges.get(fid)!;
    const off = (key: string): number => {
      const b = bentAt(fid, key);
      return b ? setbackFor(b.ref, b.theta, b.R, T) : 0;
    };
    const flat = trimOutline(outline, off);
    if (!flat.ok) {
      const pb = f.parentBend ? bends.get(f.parentBend) : undefined;
      const need = off("raiz") + off("ponta");
      if (f.shape.kind === "aba" && pb && f.shape.length <= need + numAbs(need)) {
        err(
          "FLANGE_SHORT",
          `${f.label}: ${fmt(f.shape.length)} mm é menor ou igual aos recuos das dobras adjacentes (${fmt(need)} mm). Aumente a aba ou reduza o raio.`,
          { op: f.op, flanges: [f.id] },
        );
      } else
        err("FLANGE_SMALL", `${f.label}: a aresta ${flat.edge} some com os recuos das dobras vizinhas — a aba/base é pequena demais para os raios.`, { op: f.op, flanges: [f.id] });
      return false;
    }
    const size = Math.max(1, ...flat.edges.map((e) => Math.max(Math.abs(e.a.x), Math.abs(e.a.y))));
    const tol = dimAbs(size);
    // furos dentro da região plana (sem tocar a borda nem a região de dobra)
    for (const h of f.holes) {
      const r = loopInside(h.loop, flat.edges, tol);
      if (r) {
        err(r === "cross" ? "CUT_EDGE" : "CUT_OUT", `${f.label}: o recorte ${h.key} ${r === "cross" ? "toca a borda da aba ou a região de dobra (ETAPA 1: só recortes internos)" : "está fora da aba"}.`, {
          op: h.op,
          flanges: [f.id],
        });
        return false;
      }
    }
    for (let i = 0; i < f.holes.length; i++)
      for (let j = i + 1; j < f.holes.length; j++)
        if (loopsTouch(f.holes[i].loop, f.holes[j].loop, tol)) {
          err("CUT_OVERLAP", `${f.label}: os recortes ${f.holes[i].key} e ${f.holes[j].key} se tocam ou se sobrepõem.`, { op: f.holes[j].op, flanges: [f.id] });
          return false;
        }
    const area = polyArea(flat.edges.map((e) => e.a)) - f.holes.reduce((a, h) => a + Math.abs(loopArea(h.loop)), 0);
    outF.push({ id: f.id, label: f.label, op: f.op, outline, flat: flat.edges, holes: f.holes, G, H, parentBend: f.parentBend, area });

    for (const b of childrenOf(fid)) {
      const fe = flat.edges.find((e) => e.key === b.edge)!;
      const A = fe.a;
      const B = fe.b;
      const Lb = len2(sub2(B, A));
      const dE = unit2(sub2(B, A));
      const n = right2(dE);
      const th = deg(b.theta);
      const BA = bendAllowance(th, b.R, b.K, T);
      const SB = setbackFor(b.ref, b.theta, b.R, T);
      // posição da filha no plano da pai: origem em B + (BA − SB)·n, x = −d, y = n
      const o = add2(B, mul2(n, BA - SB));
      const P = frameMat(v3(o.x, o.y, 0), v3(-dE.x, -dE.y, 0), v3(n.x, n.y, 0), v3(0, 0, 1));
      const up = b.side === "cima";
      const C: V3 = v3(A.x, A.y, up ? T + b.R : -b.R);
      const ax: V3 = up ? v3(-dE.x, -dE.y, 0) : v3(dE.x, dE.y, 0);
      const fold = compose(rotation(C, ax, th), compose(translation(v3(-BA * n.x, -BA * n.y, 0)), P));
      const Gc = compose(G, fold);
      const Hc = compose(H, P);
      let childOutline: OutlineEdge[];
      const child = flanges.get(b.child)!;
      if (child.shape.kind === "aba") {
        const Lc = child.shape.length;
        childOutline = [
          { key: "raiz", a: v2(0, 0), b: v2(Lb, 0) },
          { key: "lado1", a: v2(Lb, 0), b: v2(Lb, Lc) },
          { key: "ponta", a: v2(Lb, Lc), b: v2(0, Lc) },
          { key: "lado0", a: v2(0, Lc), b: v2(0, 0) },
        ];
      } else {
        childOutline = child.shape.outline;
        const lr = b.lineRaiz!;
        if (Math.abs(lr.x0) > tol || Math.abs(lr.x1 - Lb) > tol) {
          err(
            "LINE_SPAN",
            `${b.label}: a região de dobra ficou mais curta que a parte móvel — uma aresta vizinha da linha de dobra recebeu aba (não suportado na ETAPA 1).`,
            { op: b.op, bends: [b.id], flanges: [fid] },
          );
          return false;
        }
      }
      const pt = (q: V2) => apply2(H, q);
      const strip = (t: number): [V2, V2] => [pt(add2(A, mul2(n, t))), pt(add2(B, mul2(n, t)))];
      outB.push({
        id: b.id,
        label: b.label,
        op: b.op,
        kind: b.kind,
        parent: fid,
        edge: b.edge,
        child: b.child,
        deflectionDeg: b.theta,
        includedDeg: bendToIncluded(b.theta),
        R: b.R,
        K: b.K,
        kSource: b.kSource,
        side: b.side,
        ref: b.ref,
        T,
        BA,
        OSB: outsideSetback(th, b.R, T),
        ISB: insideSetback(th, b.R),
        BD: bendDeduction(th, b.R, b.K, T),
        SB,
        tangent: [A, B],
        L: Lb,
        axis: { p: apply(G, C), dir: applyDir(G, ax) },
        flatStart: strip(0),
        flatLine: strip(BA / 2),
        flatEnd: strip(BA),
      });
      if (!visit(b.child, Gc, Hc, childOutline)) return false;
    }
    return true;
  };

  const rootShape = flanges.get(base.id)!.shape;
  const ok = visit(base.id, G0, IDENTITY, rootShape.kind === "poly" ? rootShape.outline : []);
  if (!ok || issues.some((i) => i.level === "error")) return fail();
  // ordem estável: abas e dobras na ordem de criação (base primeiro)
  const rank = new Map<string, number>([[base.id, -1], ...order.map((id, i) => [id, i] as [string, number])]);
  outF.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  outB.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const volume = outF.reduce((v, f) => v + f.area * T, 0) + outB.reduce((v, b) => v + deg(b.deflectionDeg) * T * (b.R + T / 2) * b.L, 0);
  const flatArea = outF.reduce((v, f) => v + f.area, 0) + outB.reduce((v, b) => v + b.BA * b.L, 0);
  return { ok: true, issues, T, root: base.id, flanges: outF, bends: outB, volume, flatArea };
}

/* ================================================================================================ */

/** Contorno recuado: cada aresta desloca `off(key)` para dentro; vértices = interseção das retas deslocadas. */
export function trimOutline(outline: readonly OutlineEdge[], off: (key: string) => number): { ok: true; edges: OutlineEdge[] } | { ok: false; edge: string } {
  const n = outline.length;
  const lines = outline.map((e) => {
    const de = unit2(sub2(e.b, e.a));
    const o = off(e.key);
    return { p: sub2(e.a, mul2(right2(de), o)), d: de, o };
  });
  const verts: V2[] = [];
  for (let i = 0; i < n; i++) {
    const L0 = lines[(i + n - 1) % n];
    const L1 = lines[i];
    const x = lineX(L0.p, L0.d, L1.p, L1.d);
    if (x) verts.push(x);
    else {
      // retas paralelas: só aceitas se colineares no mesmo sentido e com o mesmo recuo
      if (dot2(L0.d, L1.d) > 0 && Math.abs(L0.o - L1.o) < 1e-12) verts.push(sub2(outline[i].a, mul2(right2(L1.d), L1.o)));
      else return { ok: false, edge: outline[i].key };
    }
  }
  const edges: OutlineEdge[] = [];
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const de = sub2(b, a);
    const orig = sub2(outline[i].b, outline[i].a);
    if (!(dot2(de, orig) > 0) || len2(de) <= 1e-9 * Math.max(1, len2(orig))) return { ok: false, edge: outline[i].key };
    edges.push({ key: outline[i].key, a, b });
  }
  // polígono recuado continua simples
  const segs: Seg[] = edges.map((e) => lineSeg(e.a, e.b));
  if (selfIntersections(segs, true, 1e-9).length) return { ok: false, edge: outline[0].key };
  return { ok: true, edges };
}

/** Recorta o contorno pelo semiplano g(p) ≥ 0 (g afim). A aresta criada recebe `newKey`. */
function clipHalf(outline: readonly OutlineEdge[], g: (p: V2) => number, newKey: string): OutlineEdge[] {
  const pts: { p: V2; key: string }[] = []; // ponto inicial de cada aresta resultante + chave da aresta que COMEÇA nele
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const e = outline[i];
    const ga = g(e.a);
    const gb = g(e.b);
    if (ga >= 0) pts.push({ p: e.a, key: e.key });
    if ((ga >= 0) !== (gb >= 0)) {
      const t = ga / (ga - gb);
      const x = add2(e.a, mul2(sub2(e.b, e.a), t));
      // saindo do semiplano: daqui começa a aresta nova; entrando: continua a aresta original
      pts.push({ p: x, key: ga >= 0 ? newKey : e.key });
    }
  }
  return pts.map((q, i) => ({ key: q.key, a: q.p, b: pts[(i + 1) % pts.length].p }));
}

function mapLoop(l: Loop2, f: (p: V2) => V2): Loop2 {
  // f é rígida própria (preserva sentido): arcos mantêm o sweep
  return {
    segs: l.segs.map((s): LoopSeg => (s.t === "line" ? { t: "line", a: f(s.a), b: f(s.b) } : s.t === "arc" ? { ...s, c: f(s.c), a: f(s.a), b: f(s.b) } : { ...s, c: f(s.c) })),
  };
}

/** Faixa [mín, máx] de uma função afim sobre o laço (arcos e círculos: extremos exatos). */
function loopRangeAlong(l: Loop2, g: (p: V2) => number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  const g0 = g(v2(0, 0));
  const gx = g(v2(1, 0)) - g0;
  const gy = g(v2(0, 1)) - g0;
  const gl = Math.hypot(gx, gy);
  const put = (v: number) => {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  };
  for (const s of l.segs) {
    if (s.t === "line") {
      put(g(s.a));
      put(g(s.b));
    } else if (s.t === "circle") {
      put(g(s.c) - s.r * gl);
      put(g(s.c) + s.r * gl);
    } else {
      put(g(s.a));
      put(g(s.b));
      // extremos da função no círculo, se dentro do arco
      const ang = Math.atan2(gy, gx);
      for (const [a, sign] of [[ang, 1], [ang + Math.PI, -1]] as const) if (onArcAngle(s, a)) put(g(s.c) + sign * s.r * gl);
    }
  }
  return [lo, hi];
}
function onArcAngle(s: Extract<LoopSeg, { t: "arc" }>, a: number): boolean {
  const a0 = Math.atan2(s.a.y - s.c.y, s.a.x - s.c.x);
  let t = (a - a0) * Math.sign(s.sweep);
  t = ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return t <= Math.abs(s.sweep) + 1e-12;
}

function toSegs(l: Loop2): Seg[] {
  return l.segs.map((s): Seg => {
    if (s.t === "line") return lineSeg(s.a, s.b);
    if (s.t === "circle") return arcSeg(s.c, s.r, 0, 2 * Math.PI);
    const a0 = Math.atan2(s.a.y - s.c.y, s.a.x - s.c.x);
    const b0 = Math.atan2(s.b.y - s.c.y, s.b.x - s.c.x);
    return s.sweep >= 0 ? arcSeg(s.c, s.r, a0, s.sweep) : arcSeg(s.c, s.r, b0, -s.sweep, true);
  });
}
function loopPoint(l: Loop2): V2 {
  const s = l.segs[0];
  return s.t === "circle" ? v2(s.c.x + s.r, s.c.y) : s.a;
}
function pointInPoly(p: V2, edges: readonly OutlineEdge[]): boolean {
  let inside = false;
  for (const e of edges) {
    const { a, b } = e;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}
/** null = dentro e sem tocar; "cross" = toca/cruza a borda; "out" = fora. */
function loopInside(l: Loop2, edges: readonly OutlineEdge[], tol: number): "cross" | "out" | null {
  const ls = toSegs(l);
  for (const e of edges) {
    const es = lineSeg(e.a, e.b);
    for (const s of ls) if (segSeg(es, s).length) return "cross";
    // distância (folga zero = toca)
    for (const s of ls) if (segDistance(es, s) <= tol) return "cross";
  }
  return pointInPoly(loopPoint(l), edges) ? null : "out";
}
function loopsTouch(a: Loop2, b: Loop2, tol: number): boolean {
  const sa = toSegs(a);
  const sb = toSegs(b);
  for (const x of sa) for (const y of sb) if (segSeg(x, y).length || segDistance(x, y) <= tol) return true;
  return pointInLoop(loopPoint(b), sa) || pointInLoop(loopPoint(a), sb);
}
/** Ponto dentro de laço fechado (retas e arcos exatos): paridade de cruzamentos de um raio. */
function pointInLoop(p: V2, segs: readonly Seg[]): boolean {
  // direção irracional para não passar por vértices em casos alinhados
  const far = 1e9;
  const ray = lineSeg(p, v2(p.x + far, p.y + far * 0.000137036));
  let n = 0;
  for (const s of segs) n += segSeg(ray, s).length;
  return n % 2 === 1;
}
/** Distância mínima entre dois trechos (reta/arco) que não se cruzam. */
function segDistance(a: Seg, b: Seg): number {
  const pts = (s: Seg): V2[] => (s.kind === "line" ? [s.a, s.b] : [v2(s.c.x + s.r * Math.cos(s.a0), s.c.y + s.r * Math.sin(s.a0)), v2(s.c.x + s.r * Math.cos(s.a0 + s.sweep), s.c.y + s.r * Math.sin(s.a0 + s.sweep))]);
  let d = Infinity;
  for (const p of pts(a)) d = Math.min(d, pointSeg(p, b));
  for (const p of pts(b)) d = Math.min(d, pointSeg(p, a));
  // reta × arco: ponto do arco mais próximo da reta (direção da normal)
  const la = a.kind === "line" ? a : b.kind === "line" ? b : null;
  const ar = a.kind === "arc" ? a : b.kind === "arc" ? b : null;
  if (la && ar) {
    const dE = unit2(sub2(la.b, la.a));
    const nE = v2(-dE.y, dE.x);
    for (const sg of [1, -1]) {
      const p = add2(ar.c, mul2(nE, sg * ar.r));
      if (onSegArc(ar, p)) d = Math.min(d, pointSeg(p, la));
    }
  }
  if (a.kind === "arc" && b.kind === "arc") {
    // mínimo entre arcos: nas pontas (já contadas) ou sobre a linha dos centros
    const cc = sub2(b.c, a.c);
    const lc = len2(cc);
    if (lc > 0) {
      const u = mul2(cc, 1 / lc);
      for (const [arc, other] of [[a, b], [b, a]] as const)
        for (const sg of [1, -1]) {
          const p = add2(arc.c, mul2(u, sg * arc.r));
          if (onSegArc(arc, p)) d = Math.min(d, pointSeg(p, other));
        }
    } else d = Math.min(d, Math.abs(a.r - b.r));
  }
  return d;
}
function onSegArc(s: Extract<Seg, { kind: "arc" }>, p: V2): boolean {
  let t = Math.atan2(p.y - s.c.y, p.x - s.c.x) - s.a0;
  t = ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return t <= s.sweep + 1e-12;
}
function pointSeg(p: V2, s: Seg): number {
  if (s.kind === "line") {
    const ab = sub2(s.b, s.a);
    const t = Math.max(0, Math.min(1, dot2(sub2(p, s.a), ab) / dot2(ab, ab)));
    return len2(sub2(p, add2(s.a, mul2(ab, t))));
  }
  const ang = Math.atan2(p.y - s.c.y, p.x - s.c.x);
  let t = ang - s.a0;
  t = ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (t <= s.sweep + 1e-12) return Math.abs(len2(sub2(p, s.c)) - s.r);
  const e0 = v2(s.c.x + s.r * Math.cos(s.a0), s.c.y + s.r * Math.sin(s.a0));
  const e1 = v2(s.c.x + s.r * Math.cos(s.a0 + s.sweep), s.c.y + s.r * Math.sin(s.a0 + s.sweep));
  return Math.min(len2(sub2(p, e0)), len2(sub2(p, e1)));
}

/** Área com sinal de um laço (arcos exatos). */
export function loopArea(l: Loop2): number {
  let a = 0;
  for (const s of l.segs) {
    if (s.t === "circle") return Math.PI * s.r * s.r;
    a += cross2(s.a, s.b) / 2;
    if (s.t === "arc") a += (s.r * s.r * (s.sweep - Math.sin(s.sweep))) / 2;
  }
  return a;
}

/* ===================================================================== flange de contorno × solveProfile */

export interface ContourSegment {
  length: number;
  side: BendSide;
  theta: number;
  R: number;
  K: number;
}

/**
 * Seção do flange de contorno no motor de perfis (`solveProfile`): aba 0 = toco da aba-pai (só para a
 * conferência; comprimento = recuo + T), abas 1…n = segmentos. "cima" ↔ dobra "left"; a face z = T local
 * ↔ face A do perfil. Cota por ponta na referência da dobra (`flangeFaces`).
 */
export function contourProfile(T: number, ref: SheetRef, segs: readonly ContourSegment[]) {
  const dirs: BendDir[] = segs.map((s) => (s.side === "cima" ? "left" : "right"));
  const bends: BendInput[] = segs.map((s, j) => ({ label: `D${j + 1}`, angleDeg: s.theta, R: s.R, K: s.K, dir: dirs[j] }));
  const SB0 = setbackFor(ref, segs[0].theta, segs[0].R, T);
  const flanges: FlangeInput[] = [
    { label: "pai", length: SB0 + T, face: flangeFaces(ref, 0, dirs)[0], faceEnd: flangeFaces(ref, 0, dirs)[1] },
    ...segs.map((s, i) => {
      const [face, faceEnd] = flangeFaces(ref, i + 1, dirs);
      return { label: `S${i + 1}`, length: s.length, face, faceEnd };
    }),
  ];
  return solveProfile({ T, flanges, bends, startAngle: 0, partLength: 1 });
}
