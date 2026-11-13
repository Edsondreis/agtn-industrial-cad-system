import { type BendProcess, type MaterialId, type ValueSource, defaultKTable, lookupK } from "@agtn/sheetmetal";
import {
  type Loop2,
  type LoopSeg,
  type OutlineEdge,
  type SheetBendParams,
  type SheetOp,
  type SheetSolved,
  type SheetSpec,
  dimAbs,
  sheetMath as M,
  sheetWarnings,
  solveSheet,
} from "@agtn/sheetgraph";
import { type Seg2, defaultRegions, entityOf, pointOf, profiles } from "@agtn/sketch";
import { type Frame, type SheetApply, type SheetBackend, type SheetCtx, type SheetEdgeRef, type SheetFeature, SolidError, to3d } from "@agtn/solid";
import { buildSheet } from "./build";

/**
 * Motor de chapa injetado no PartEvaluator: operação → passo do grafo (`SheetOp`), grafo resolvido
 * (`solveSheet`), sólido OCCT com proveniência (`buildSheet`). Estado = dados puros (sem handles).
 */
export interface SheetState {
  readonly spec: SheetSpec;
  readonly solved: SheetSolved;
  /** rótulos de proveniência por índice de face do sólido */
  readonly faceLabels: readonly (readonly string[])[];
  /** padrões de K da peça (tabela material × processo, ou manual) */
  readonly kRule: { readonly material: string; readonly process: string; readonly K: number | null };
  readonly ms: { readonly solve: number; readonly build: number };
}

export function createSheetBackend(): SheetBackend {
  return { apply };
}

function apply(f: SheetFeature, ctx: SheetCtx): SheetApply {
  const prev = ctx.prev as SheetState | null;
  const t0 = performance.now();
  let spec: SheetSpec;
  let kRule: SheetState["kRule"];
  const recovered: string[] = [];
  if (f.t === "sheetBase") {
    const { frame, sketch } = ctx.sketch(f.sketch);
    const p = profiles(sketch);
    const def = defaultRegions(p);
    if (def.length !== 1) throw new SolidError("INVALID_PARAMS", p.regions.length ? "O esboço da base de chapa precisa de um único contorno fechado (pode ter furos)." : "O esboço da base de chapa não tem contorno fechado.");
    const r = p.regions[def[0]];
    const outline = outlineOf(r.outer.segs);
    kRule = { material: f.material, process: f.process, K: f.K };
    const k = resolveK(kRule, f.T, f.R);
    spec = {
      base: {
        id: f.id,
        label: f.name,
        defaults: { T: f.T, R: f.R, K: k.K, kSource: k.source, ref: f.ref },
        plane: { o: frame.o, x: frame.x, y: frame.y, n: frame.n },
        side: f.side,
        outline,
        holes: r.holes.map((h) => loopOf(h.segs, (q) => q, 1)),
      },
      ops: [],
    };
  } else {
    if (!prev) throw new SolidError("INVALID_PARAMS", "Crie a base de chapa antes desta operação.");
    kRule = prev.kRule;
    spec = { ...prev.spec, ops: [...prev.spec.ops, opOf(f, prev, ctx, recovered)] };
  }
  const solved = solveSheet(spec);
  const t1 = performance.now();
  if (!solved.ok) {
    const errs = solved.issues.filter((i) => i.level === "error");
    throw new SolidError("INVALID_PARAMS", errs.slice(0, 2).map((e) => e.message).join(" "));
  }
  const built = buildSheet(ctx.kernel, solved, ctx.T);
  const t2 = performance.now();
  const warns = [
    ...recovered,
    ...solved.issues.filter((i) => i.level === "warning" && i.op === f.id).map((i) => i.message),
    ...sheetWarnings(solved).filter((w) => w.op === f.id).map((w) => w.message),
    ...built.warnings,
  ];
  const state: SheetState = { spec, solved, faceLabels: built.faceLabels, kRule, ms: { solve: t1 - t0, build: t2 - t1 } };
  return { state, shape: built.shape, ...(warns.length ? { warning: warns.join(" ") } : {}) };
}

/* ----------------------------------------------------------------------------------------- K */

function resolveK(rule: SheetState["kRule"], T: number, R: number): { K: number; source: ValueSource } {
  if (rule.K !== null) return { K: rule.K, source: "manual" };
  const hit = lookupK(defaultKTable(), { material: rule.material as MaterialId, process: rule.process as BendProcess, T, R });
  if (!hit) throw new SolidError("INVALID_PARAMS", `Sem fator K na tabela para ${rule.material} / ${rule.process} com T ${T} e R ${R} — informe o K.`);
  return { K: hit.k, source: hit.source };
}
function bendOf(st: SheetState, deflectionDeg: number, R: number | null, K: number | null): SheetBendParams {
  const base = st.spec.base.defaults;
  if (K !== null) return { deflectionDeg, ...(R !== null ? { R } : {}), K, kSource: "manual" };
  if (R === null) return { deflectionDeg };
  // raio diferente do padrão com K da tabela: K da faixa de R/T desta dobra
  const k = st.kRule.K !== null ? { K: base.K, source: base.kSource } : resolveK(st.kRule, base.T, R);
  return { deflectionDeg, R, K: k.K, kSource: k.source };
}

/* ------------------------------------------------------------------------------------- operações */

function opOf(f: Exclude<SheetFeature, { t: "sheetBase" }>, st: SheetState, ctx: SheetCtx, warn: string[]): SheetOp {
  switch (f.t) {
    case "sheetFlange":
      return { t: "aba", id: f.id, label: f.name, edges: f.edges.map((e) => recoverEdge(st, e, f.name, warn)), length: f.length, bend: bendOf(st, f.deflectionDeg, f.R, f.K), side: f.side, ref: f.ref };
    case "sheetContour":
      return {
        t: "contorno",
        id: f.id,
        label: f.name,
        edge: recoverEdge(st, f.edge, f.name, warn),
        ref: f.ref,
        segments: f.segments.map((s) => ({ length: s.length, side: s.side, bend: bendOf(st, s.deflectionDeg, s.R, s.K) })),
      };
    case "sheetBendLine": {
      const { frame, sketch } = ctx.sketch(f.sketch);
      const m = onFlange(st, f.flange, frame, f.name);
      const l = entityOf(sketch, f.line);
      if (!l || l.t !== "line") throw new SolidError("INVALID_PARAMS", `${f.name}: a linha de dobra ${f.line} não existe mais no esboço.`);
      const a = m.map(pointOf(sketch, l.p1)!);
      const b = m.map(pointOf(sketch, l.p2)!);
      const flip = m.sign < 0;
      return {
        t: "linha",
        id: f.id,
        label: f.name,
        flange: f.flange,
        a,
        b,
        fixed: flip ? (f.fixed === "esq" ? "dir" : "esq") : f.fixed,
        side: flip ? (f.side === "cima" ? "baixo" : "cima") : f.side,
        ref: f.ref,
        bend: bendOf(st, f.deflectionDeg, f.R, f.K),
      };
    }
    case "sheetCut": {
      const { frame, sketch } = ctx.sketch(f.sketch);
      const m = onFlange(st, f.flange, frame, f.name);
      const p = profiles(sketch);
      const outers = p.regions.filter((r) => r.depth === 0);
      if (!outers.length) throw new SolidError("INVALID_PARAMS", `${f.name}: o esboço não tem contorno fechado.`);
      if (outers.some((r) => r.holes.length)) throw new SolidError("INVALID_PARAMS", `${f.name}: recorte com ilha interna não é suportado na ETAPA 1.`);
      return { t: "recorte", id: f.id, label: f.name, flange: f.flange, loops: outers.map((r) => loopOf(r.outer.segs, m.map, m.sign)) };
    }
  }
}

/**
 * Recuperação COMPLEMENTAR de referência (2.2): só quando o id da aresta não existe mais na aba (linha do
 * esboço apagada e redesenhada). Aceita UMA aresta da mesma aba exatamente sobre a reta guardada, com aviso;
 * mais de uma → "referência ambígua"; nenhuma → o grafo acusa "referência perdida". Nunca troca em silêncio.
 */
function recoverEdge(st: SheetState, ref: SheetEdgeRef, what: string, warn: string[]): { flange: string; edge: string; idKey?: string } {
  const plain = { flange: ref.flange, edge: ref.edge };
  const fl = st.solved.flanges.find((x) => x.id === ref.flange);
  if (!fl || !ref.hint || fl.outline.some((e) => e.key === ref.edge) || ["raiz", "lado0", "lado1", "ponta"].includes(ref.edge)) return plain;
  const inv = M.invert(fl.G);
  const a = M.apply(inv, ref.hint.a);
  const b = M.apply(inv, ref.hint.b);
  const size = Math.max(1, ...fl.outline.map((e) => Math.max(Math.abs(e.a.x), Math.abs(e.a.y))));
  const tol = dimAbs(size);
  if (Math.abs(a.z) > tol || Math.abs(b.z) > tol) return plain;
  const onLine = (p: { x: number; y: number }, e: OutlineEdge) => {
    const d = M.sub2(e.b, e.a);
    return Math.abs(M.cross2(d, M.sub2(p, e.a))) / M.len2(d) <= tol;
  };
  const hits = fl.outline.filter((e) => onLine(a, e) && onLine(b, e));
  if (hits.length > 1) throw new SolidError("INVALID_PARAMS", `${what}: referência ambígua — a aresta ${ref.edge} sumiu e ${hits.map((h) => h.key).join(" e ")} estão na mesma reta.`);
  if (hits.length === 1) {
    warn.push(`${what}: referência recuperada por geometria — ${ref.edge} → ${hits[0].key} (linha refeita no mesmo lugar).`);
    // o id da aba-filha continua o original: quem depende dela não perde a referência
    return { flange: ref.flange, edge: hits[0].key, idKey: ref.edge };
  }
  return plain;
}

/** Esboço apoiado numa face (A ou B) da aba: mapa do plano do esboço → sistema local da aba. */
function onFlange(st: SheetState, flange: string, frame: Frame, what: string): { map: (p: { x: number; y: number }) => { x: number; y: number }; sign: number } {
  const fl = st.solved.flanges.find((x) => x.id === flange);
  if (!fl) throw new SolidError("INVALID_PARAMS", `${what}: referência perdida — a aba ${flange} não existe mais.`);
  const inv = M.invert(fl.G);
  const zW = M.applyDir(fl.G, M.v3(0, 0, 1));
  const c = M.dot3(M.unit3(frame.n), zW);
  if (Math.abs(Math.abs(c) - 1) > 1e-9) throw new SolidError("INVALID_PARAMS", `${what}: o esboço não está paralelo à ${fl.label}.`);
  const o = M.apply(inv, frame.o);
  const size = Math.max(1, ...fl.flat.map((e) => Math.max(Math.abs(e.a.x), Math.abs(e.a.y))));
  if (Math.abs(o.z) > dimAbs(size) && Math.abs(o.z - st.solved.T) > dimAbs(size))
    throw new SolidError("INVALID_PARAMS", `${what}: o esboço não está sobre uma face da ${fl.label} (afastado ${o.z.toFixed(4).replace(".", ",")} mm).`);
  return {
    map: (p) => {
      const q = M.apply(inv, to3d(frame, p));
      return { x: q.x, y: q.y };
    },
    sign: Math.sign(c),
  };
}

/** Contorno da base: só retas; chaves = id da linha do esboço (L3, ou L3.1/L3.2 se dividida). */
function outlineOf(segs: readonly Seg2[]): OutlineEdge[] {
  const bad = segs.find((s) => s.t !== "line");
  if (bad) throw new SolidError("INVALID_PARAMS", `A base de chapa só aceita contorno de linhas retas (ETAPA 1) — ${bad.src} é ${bad.t === "arc" ? "arco" : "círculo"}.`);
  const count = new Map<string, number>();
  for (const s of segs) count.set(s.src, (count.get(s.src) ?? 0) + 1);
  const seen = new Map<string, number>();
  return segs.map((s) => {
    const n = (seen.get(s.src) ?? 0) + 1;
    seen.set(s.src, n);
    const l = s as Extract<Seg2, { t: "line" }>;
    return { key: count.get(s.src)! > 1 ? `${s.src}.${n}` : s.src, a: l.a, b: l.b };
  });
}

function loopOf(segs: readonly Seg2[], map: (p: { x: number; y: number }) => { x: number; y: number }, sign: number): Loop2 {
  return {
    segs: segs.map((s): LoopSeg => {
      if (s.t === "line") return { t: "line", a: map(s.a), b: map(s.b) };
      if (s.t === "circle") return { t: "circle", c: map(s.c), r: s.r };
      return { t: "arc", c: map(s.c), r: s.r, a: map(s.a), b: map(s.b), sweep: s.sweep * sign };
    }),
  };
}
