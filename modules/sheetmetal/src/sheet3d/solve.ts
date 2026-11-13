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
  dot3,
  len3,
  mul3,
  sub3,
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
import { type FlatCut, applyFlatCuts } from "./flatcut";
import { edgeSeg, edgesArea, pointInEdges, sweepVia } from "./edges";
import type { CornerKind, MaterialPosition, ReliefKind, SolvedCorner } from "./model";

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
  /** faixa parcial (ETAPA 2.1a): recuos na aresta de molde da pai; ausente = aresta inteira */
  o0?: number;
  o1?: number;
  /** alívio de dobra (ETAPA 2.1b) */
  relief?: { op: string; label: string; kind: ReliefKind; gap: number; width?: number; depth?: number };
  /** posição do material (ETAPA 2.2); ausente = "dentro" */
  position?: MaterialPosition;
  /** desdobrada (ETAPA 2.5) */
  unfolded?: boolean;
}
const isPartial = (b: WBend) => b.o0 !== undefined;

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
  /** pedidos de fechamento de canto (ETAPA 2.3), por id «a»+«b»; casados com os cantos detectados na fase 2 */
  /** recortes na planificação (ETAPA 2.4): aplicados ao grafo resolvido, no fim */
  const flatCuts: FlatCut[] = [];
  const cornerReq = new Map<string, { op: string; label: string; kind: CornerKind; gap: number; closer: "a" | "b"; a: string; b: string; used: boolean }>();
  flanges.set(base.id, {
    id: base.id,
    label: base.label,
    op: base.id,
    shape: { kind: "poly", outline: [...base.outline] },
    holes: loopKeys(base.holes).map((key, i) => ({ key: `${base.id}#${key}`, op: base.id, loop: base.holes[i] })),
    parentBend: null,
  });

  const edgeKeys = (f: WFlange): string[] => (f.shape.kind === "aba" ? [...ABA_EDGES] : f.shape.outline.map((e) => e.key));
  /** dobras numa aresta (várias só com faixas parciais, sem sobreposição) */
  const bendsAt = (fid: string, key: string): WBend[] => {
    const out: WBend[] = [];
    for (const b of bends.values()) if (b.parent === fid && b.edge === key) out.push(b);
    const f = flanges.get(fid);
    if (f?.parentBend && key === "raiz") out.push(bends.get(f.parentBend)!);
    return out;
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
  const checkEdge = (ref: EdgeRef, op: string, what: string, partial = false): WFlange | null => {
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
    const used = bendsAt(f.id, ref.edge).find((b) => !partial || !isPartial(b));
    if (used) {
      err("EDGE_USED", `${what}: a aresta ${ref.edge} da ${f.label} já tem a dobra ${used.label}.`, { op, flanges: [f.id], bends: [used.id] });
      return null;
    }
    return f;
  };

  const addChild = (
    parent: WFlange,
    edge: string,
    id: string,
    label: string,
    op: string,
    kind: WBend["kind"],
    length: number,
    bp: NonNullable<ReturnType<typeof bendParams>>,
    side: BendSide,
    ref: SheetRef,
    span?: { o0: number; o1: number },
    position?: MaterialPosition,
  ) => {
    flanges.set(id, { id, label, op, shape: { kind: "aba", length }, holes: [], parentBend: id });
    bends.set(id, { id, label, op, kind, parent: parent.id, edge, child: id, ...bp, side, ref, ...(span ? span : {}), ...(position && position !== "dentro" ? { position } : {}) });
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
        const o0 = op.offsetStart ?? 0;
        const o1 = op.offsetEnd ?? 0;
        if (!(o0 >= 0) || !(o1 >= 0) || !Number.isFinite(o0) || !Number.isFinite(o1)) return void err("OFFSET", `${op.label}: recuos devem ser ≥ 0.`, { op: op.id });
        const partial = o0 > 0 || o1 > 0;
        const pos = op.position ?? "dentro";
        if (!(["dentro", "fora", "dobra_fora"] as const).includes(pos)) return void err("POSITION", `${op.label}: posição do material desconhecida (${String(pos)}).`, { op: op.id });
        const seen = new Set<string>();
        const parents: WFlange[] = [];
        for (const e of op.edges) {
          const k = `${e.flange}/${e.edge}`;
          if (seen.has(k)) return void err("EDGE_DUP", `${op.label}: a aresta ${e.edge} foi escolhida duas vezes.`, { op: op.id });
          seen.add(k);
          const f = checkEdge(e, op.id, op.label, partial);
          if (!f) return;
          parents.push(f);
        }
        if (nErr() > before) return;
        op.edges.forEach((e, i) => {
          const id = `${op.id}@${e.flange}/${e.idKey ?? e.edge}`;
          addChild(parents[i], e.edge, id, op.edges.length > 1 ? `${op.label}.${i + 1}` : op.label, op.id, "aba", op.length, bp, op.side, op.ref, partial ? { o0, o1 } : undefined, pos);
        });
        return;
      }
      case "contorno": {
        if (!op.segments.length) return void err("CONTOUR_EMPTY", `${op.label}: o perfil precisa de pelo menos um segmento.`, { op: op.id });
        const segIds = op.segments.map((s, i) => s.id ?? String(i + 1));
        if (new Set(segIds).size !== segIds.length) return void err("CONTOUR_IDS", `${op.label}: dois segmentos com o mesmo id.`, { op: op.id });
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
          const id = `${op.id}#${segIds[i]}`;
          addChild(p, edge, id, `${op.label}.${i + 1}`, op.id, "contorno", s.length, bps[i]!, s.side, op.ref);
          p = flanges.get(id)!;
          edge = "ponta";
        });
        return;
      }
      case "linha":
        return splitByLine(op);
      case "alivio": {
        if (!op.bends.length) return void err("NO_BEND", `${op.label}: escolha pelo menos uma dobra.`, { op: op.id });
        if (!(op.gap >= 0) || !Number.isFinite(op.gap)) return void err("RELIEF_GAP", `${op.label}: folga deve ser ≥ 0.`, { op: op.id });
        if (op.width !== undefined && !(op.width > 0)) return void err("RELIEF_W", `${op.label}: largura do alívio deve ser maior que zero.`, { op: op.id });
        if (op.depth !== undefined && !(op.depth > 0)) return void err("RELIEF_D", `${op.label}: profundidade do alívio deve ser maior que zero.`, { op: op.id });
        const list: WBend[] = [];
        for (const id of op.bends) {
          const b = bends.get(id);
          if (!b) return void err("REF_LOST", `${op.label}: referência perdida — a dobra ${id} não existe mais.`, { op: op.id, bends: [id] });
          if (!isPartial(b)) return void err("RELIEF_NOT_NEEDED", `${op.label}: ${b.label} vai de canto a canto da aresta — não há ponta de dobra dentro da aresta para aliviar.`, { op: op.id, bends: [id] });
          if (b.relief) return void err("RELIEF_DUP", `${op.label}: ${b.label} já tem o alívio ${b.relief.label}.`, { op: op.id, bends: [id] });
          list.push(b);
        }
        for (const b of list) b.relief = { op: op.id, label: op.label, kind: op.kind, gap: op.gap, ...(op.width !== undefined ? { width: op.width } : {}), ...(op.depth !== undefined ? { depth: op.depth } : {}) };
        return;
      }
      case "desdobrar":
      case "redobrar": {
        const un = op.t === "desdobrar";
        const what = un ? "desdobrar" : "redobrar";
        const list = op.bends.length ? op.bends : order.filter((id) => (un ? !bends.get(id)!.unfolded : bends.get(id)!.unfolded));
        if (!list.length) return void err(un ? "UNFOLD_NONE" : "REFOLD_NONE", `${op.label}: não há dobra para ${what}.`, { op: op.id });
        for (const id of list) {
          const b = bends.get(id);
          if (!b) return void err("REF_LOST", `${op.label}: referência perdida — a dobra ${id} não existe mais.`, { op: op.id, bends: [id] });
          if (un && b.unfolded) return void err("UNFOLD_TWICE", `${op.label}: ${b.label} já está desdobrada.`, { op: op.id, bends: [id] });
          if (!un && !b.unfolded) return void err("REFOLD_FOLDED", `${op.label}: ${b.label} não está desdobrada.`, { op: op.id, bends: [id] });
        }
        for (const id of list) bends.get(id)!.unfolded = un;
        return;
      }
      case "recorte_plano": {
        if (!op.loops.length) return void err("CUT_EMPTY", `${op.label}: o esboço não tem contorno fechado.`, { op: op.id });
        loopKeys(op.loops).forEach((key, i) => flatCuts.push({ op: op.id, label: op.label, key, loop: op.loops[i] }));
        return;
      }
      case "canto": {
        if (!op.corners.length) return void err("NO_CORNER", `${op.label}: escolha pelo menos um canto.`, { op: op.id });
        if (!(["aberto", "sobreposto", "encosto", "esquadria"] as const).includes(op.kind)) return void err("CORNER_KIND", `${op.label}: tipo de canto desconhecido (${String(op.kind)}).`, { op: op.id });
        if (!(op.gap >= 0) || !Number.isFinite(op.gap)) return void err("CORNER_GAP", `${op.label}: folga deve ser ≥ 0.`, { op: op.id });
        if ((op.kind === "encosto" || op.kind === "esquadria") && !(op.gap > 0))
          return void err(
            "CORNER_GAP",
            `${op.label}: ${op.kind === "encosto" ? "encosto" : "esquadria"} precisa de folga > 0 — com 0 as abas se tocam e viram uma peça só (a solda não é modelada).`,
            { op: op.id },
          );
        if ((op.relief ?? "retangular") === "redondo")
          return void err(
            "CORNER_ROUND",
            `${op.label}: alívio de canto redondo atravessa as regiões de dobra — a parede do furo na região dobrada não tem representação exata no núcleo atual (bloqueado, sem aproximação). Use o retangular (o vazio entre as faixas).`,
            { op: op.id },
          );
        const closer = op.closer ?? "a";
        if (closer !== "a" && closer !== "b") return void err("CORNER_KIND", `${op.label}: aba que fecha deve ser a ou b.`, { op: op.id });
        for (const id of op.corners) {
          // id «a»+«b»: procura a divisão em duas dobras existentes (ids podem conter '+')
          let pair: [WBend, WBend] | null = null;
          for (let i = id.indexOf("+"); i > 0; i = id.indexOf("+", i + 1)) {
            const a = bends.get(id.slice(0, i));
            const b = bends.get(id.slice(i + 1));
            if (a && b) pair = [a, b];
          }
          if (!pair) return void err("REF_LOST", `${op.label}: referência perdida — o canto ${id} não existe mais (uma das abas foi excluída).`, { op: op.id });
          const [a, b] = pair;
          if (a.parent !== b.parent) return void err("CORNER_PARENT", `${op.label}: ${a.label} e ${b.label} não saem da mesma aba-pai.`, { op: op.id, bends: [a.id, b.id] });
          if (a.kind !== "aba" || b.kind !== "aba")
            return void err("CORNER_ABA", `${op.label}: fechamento de canto só entre abas de borda (${a.kind !== "aba" ? a.label : b.label} não é).`, { op: op.id, bends: [a.id, b.id] });
          if (a.side !== b.side) return void err("CORNER_SIDE", `${op.label}: ${a.label} e ${b.label} dobram para lados opostos — não formam canto.`, { op: op.id, bends: [a.id, b.id] });
          const key = `${a.id}+${b.id}`;
          const had = cornerReq.get(key);
          if (had) return void err("CORNER_DUP", `${op.label}: o canto ${a.label} × ${b.label} já é tratado por ${had.label}.`, { op: op.id, bends: [a.id, b.id] });
          cornerReq.set(key, { op: op.id, label: op.label, kind: op.kind, gap: op.gap, closer, a: a.id, b: b.id, used: false });
        }
        return;
      }
      case "recorte": {
        const f = flanges.get(op.flange);
        if (!f) return void err("REF_LOST", `${op.label}: referência perdida — a aba ${op.flange} não existe mais.`, { op: op.id, flanges: [op.flange] });
        if (!op.loops.length) return void err("CUT_EMPTY", `${op.label}: o esboço não tem contorno fechado.`, { op: op.id });
        loopKeys(op.loops).forEach((key, i) => f.holes.push({ key: `${op.id}#${key}`, op: op.id, loop: op.loops[i] }));
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
      const used = bendsAt(f.id, e.key)[0];
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
  const outC: SolvedCorner[] = [];
  /** largura e profundidade efetivas do alívio (automático: w = T + g; d = SB + g, +w/2 no oblongo) */
  /** δ: quanto a linha de molde avança para fora da aresta escolhida (posição do material, ETAPA 2.2) */
  const deltaOf = (b: WBend): number => (b.position === "fora" ? T : b.position === "dobra_fora" ? setbackFor(b.ref, b.theta, b.R, T) : 0);
  /** recuo da linha de tangência para dentro da aresta escolhida: SB − δ (negativo = a pai cresce para fora) */
  const offOf = (b: WBend): number => setbackFor(b.ref, b.theta, b.R, T) - deltaOf(b);
  const reliefDims = (b: WBend): ReliefDims => {
    const r = b.relief!;
    // profundidade a partir da aresta escolhida: passa a linha de tangência (SB − δ) pela folga g
    const SB = offOf(b);
    const w = r.width ?? T + r.gap;
    const d = r.depth ?? (r.kind === "oblongo" ? SB + r.gap + w / 2 : SB + r.gap);
    return { kind: r.kind, w, d, bend: b.id };
  };
  const childrenOf = (fid: string) => order.map((id) => bends.get(id)!).filter((b) => b.parent === fid);
  /** raiz de filha com lado de canto (2.3): faixa [t0, t1] na aresta de molde e trechos livres além dela */
  const raizCfg = new Map<string, { t0: number; t1: number; e0: boolean; e1: boolean; SB: number }>();
  const pl = base.plane;
  const z0 = base.side === "baixo" ? -T : 0;
  const G0 = frameMat(v3(pl.o.x + pl.n.x * z0, pl.o.y + pl.n.y * z0, pl.o.z + pl.n.z * z0), pl.x, pl.y, pl.n);

  /** G: posição efetiva (estado dobrado/desdobrado); Gn: posição NOMINAL (tudo dobrado) — a geometria que define
   * a peça (cantos) usa Gn, para não mudar ao desdobrar */
  const visit = (fid: string, G: Mat, H: Mat, outline: OutlineEdge[], Gn: Mat = G): boolean => {
    const f = flanges.get(fid)!;
    // a raiz da filha recua o SB real (δ só desloca a linha de molde do lado da pai)
    const sbOf = (b: WBend, raiz = false) => (raiz ? setbackFor(b.ref, b.theta, b.R, T) : offOf(b));
    // trechos de cada aresta: livre (recuo 0) ou faixa de uma dobra (recuo SB); faixas parciais em ordem
    let overlapErr = false;
    const pieces = (e: OutlineEdge): EdgePiece[] => {
      const L = len2(sub2(e.b, e.a));
      const bs = bendsAt(fid, e.key);
      if (!bs.length) return [{ t0: 0, t1: L, off: 0, key: e.key }];
      // a raiz da filha é sempre a faixa inteira (a largura da filha já é a da faixa)
      const rc = e.key === "raiz" && f.parentBend ? raizCfg.get(fid) : undefined;
      if (rc) {
        // lados de canto: a faixa fica do tamanho da dobra; o que passa dela é borda livre na linha de tangência
        const L2 = len2(sub2(e.b, e.a));
        return [
          ...(rc.e0 ? [{ t0: 0, t1: rc.t0, off: rc.SB, key: "raiz:x0" }] : []),
          { t0: rc.t0, t1: rc.t1, off: rc.SB, key: e.key, bend: f.parentBend! },
          ...(rc.e1 ? [{ t0: rc.t1, t1: L2, off: rc.SB, key: "raiz:x1" }] : []),
        ];
      }
      const full = e.key === "raiz" && f.parentBend ? bends.get(f.parentBend)! : bs.find((b) => !isPartial(b));
      if (full) return [{ t0: 0, t1: L, off: sbOf(full, e.key === "raiz" && full.id === f.parentBend), key: e.key, bend: full.id }];
      const spans = bs.map((b) => ({ b, t0: b.o0!, t1: L - b.o1! })).sort((p, q) => p.t0 - q.t0);
      const out: EdgePiece[] = [];
      let t = 0;
      spans.forEach((sp, n) => {
        if (sp.t1 - sp.t0 <= dimAbs(L)) {
          err("SPAN_SHORT", `${sp.b.label}: os recuos (${fmt(sp.b.o0!)} + ${fmt(sp.b.o1!)} mm) não deixam faixa de dobra na aresta ${e.key} (${fmt(L)} mm).`, { op: sp.b.op, bends: [sp.b.id] });
          overlapErr = true;
          return;
        }
        if (sp.t0 < t - dimAbs(L)) {
          err("SPAN_OVERLAP", `${sp.b.label}: a faixa de dobra se sobrepõe a outra dobra na aresta ${e.key}.`, { op: sp.b.op, bends: [sp.b.id] });
          overlapErr = true;
          return;
        }
        if (sp.t0 > t + dimAbs(L)) out.push({ t0: t, t1: sp.t0, off: 0, key: e.key });
        out.push({ t0: sp.t0, t1: sp.t1, off: sbOf(sp.b), key: `${e.key}^${n + 1}`, bend: sp.b.id, ...(sp.b.relief ? { relief: reliefDims(sp.b) } : {}) });
        t = sp.t1;
      });
      if (t < L - dimAbs(L)) out.push({ t0: t, t1: L, off: 0, key: e.key });
      return out;
    };
    const flat = trimOutlinePieces(outline, pieces);
    if (overlapErr) return false;
    if (!flat.ok && flat.relief) {
      const b = bends.get(flat.relief)!;
      err("RELIEF_FIT", `${b.relief!.label}: o alívio de ${b.label} não cabe na ${f.label} (encosta em outra borda, furo ou dobra) — reduza a largura/profundidade ou aumente o recuo.`, {
        op: b.relief!.op,
        bends: [b.id],
        flanges: [f.id],
      });
      return false;
    }
    if (!flat.ok) {
      const pb = f.parentBend ? bends.get(f.parentBend) : undefined;
      const sbAt = (k: string) => Math.max(0, ...bendsAt(fid, k).map((b) => sbOf(b, k === "raiz" && b.id === f.parentBend)));
      const need = sbAt("raiz") + sbAt("ponta");
      if (f.shape.kind === "aba" && pb && f.shape.length <= need + numAbs(need)) {
        err(
          "FLANGE_SHORT",
          `${f.label}: ${fmt(f.shape.length)} mm é menor ou igual aos recuos das dobras adjacentes (${fmt(need)} mm). Aumente a aba ou reduza o raio.`,
          { op: f.op, flanges: [f.id] },
        );
      } else
        err("FLANGE_SMALL", `${f.label}: a aresta ${flat.edge} some com os recuos das dobras vizinhas — a aba/base é pequena demais para os raios ou os recuos das faixas.`, { op: f.op, flanges: [f.id] });
      return false;
    }
    // faixa que termina dentro da aresta: sem alívio, o material da pai encosta na dobra (risco de rasgo)
    const relieved = flat.relieved;
    for (const b of childrenOf(fid)) {
      if (!isPartial(b)) continue;
      const ends = relieved.get(b.id) ?? [];
      if (b.relief && !ends.length) {
        err(
          "RELIEF_NOT_NEEDED",
          (b.position ?? "dentro") !== "dentro" && offOf(b) <= 1e-12
            ? `${b.relief.label}: ${b.label} não recua a aba-pai (posição do material ${b.position === "fora" ? "por fora" : "dobra por fora"}) — não há material encostado na dobra para aliviar.`
            : `${b.relief.label}: as duas pontas de ${b.label} estão em cantos da aresta — não há onde aliviar.`,
          { op: b.relief.op, bends: [b.id] },
        );
        return false;
      }
      if (!b.relief && (flat.interior.get(b.id)?.length ?? 0) > 0) warn("NO_RELIEF", `${b.label}: a dobra termina dentro da aresta — sem alívio de dobra há risco de rasgo no canto.`, { op: b.op, bends: [b.id] });
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
    const area = edgesArea(flat.edges) - f.holes.reduce((a, h) => a + Math.abs(loopArea(h.loop)), 0);
    outF.push({ id: f.id, label: f.label, op: f.op, outline, flat: flat.edges, holes: f.holes, G, H, parentBend: f.parentBend, area });

    // 1) posição de cada filha (precisa de todas antes dos cantos: o lado de uma depende do plano da outra)
    const cfs = childrenOf(fid).map((b) => {
      const fe = flat.edges.find((e) => e.bend === b.id)!;
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
      // desdobrada: a filha na posição da planificação (P), NÃO θ = 0 na fórmula da dobra (que zeraria o BA)
      return { b, A, B, Lb, n, th, BA, SB, C, ax, Gc: compose(G, b.unfolded ? P : fold), Gn: compose(Gn, fold), Hc: compose(H, P) };
    });
    // 2) cantos: o lado de cada aba no canto = interseção com o plano da outra (fibra mais restritiva)
    type Line2 = { n: V2; c: number };
    // só cantos entre filhas desta aba (a raiz, ligação com a pai, não forma canto de abas irmãs)
    const sib = flat.corners.filter((c) => cfs.some((x) => x.b.id === c.a) && cfs.some((x) => x.b.id === c.b));
    const sides = new Map<string, { l0?: Line2; l1?: Line2 }>();
    const ext = new Map<string, { a: number; b: number }>();
    for (const c of sib) {
      const id = `${c.a}+${c.b}`;
      const req = cornerReq.get(id);
      if (req) req.used = true;
      if (!req || req.kind === "aberto") continue;
      const ca = cfs.find((x) => x.b.id === c.a)!;
      const cb = cfs.find((x) => x.b.id === c.b)!;
      /** faces da aba: normal para fora (da face interna para a externa) e as constantes dos dois planos */
      const facesOf = (x: (typeof cfs)[number]) => {
        const outerZ = x.b.side === "cima" ? 0 : T;
        const nW = applyDir(x.Gn, v3(0, 0, outerZ === 0 ? -1 : 1));
        const d = (z: number) => dot3(nW, apply(x.Gn, v3(0, 0, z)));
        return { n: nW, outer: d(outerZ), inner: d(T - outerZ) };
      };
      const Fa = facesOf(ca);
      const Fb = facesOf(cb);
      /** semiespaço m·p ≤ d (mundo) → reta no plano da aba x (local), na fibra mais restritiva (z = 0 ou T) */
      const toLocal = (x: (typeof cfs)[number], m: V3, d: number): Line2 | null => {
        const nl = v3(dot3(m, applyDir(x.Gn, v3(1, 0, 0))), dot3(m, applyDir(x.Gn, v3(0, 1, 0))), dot3(m, applyDir(x.Gn, v3(0, 0, 1))));
        const cl = d - dot3(m, apply(x.Gn, v3(0, 0, 0)));
        const L = Math.hypot(nl.x, nl.y);
        if (L < 1e-9) return null;
        const cc = Math.min(cl, cl - nl.z * T);
        return { n: v2(nl.x / L, nl.y / L), c: cc / L };
      };
      // folga medida ao longo da própria aba, perpendicular ao lado (como na bandeja 2D validada): recua o lado
      // g (ou g/2 na esquadria) na direção x local da aba
      const less = (l: Line2 | null, gg: number): Line2 | null => (l ? { n: l.n, c: l.c - gg * Math.abs(l.n.x) } : null);
      const g = req.gap;
      const [C0, N0, FC, FN] = req.closer === "a" ? [ca, cb, Fa, Fb] : [cb, ca, Fb, Fa];
      let lc: Line2 | null = null; // aba que fecha
      let ln: Line2 | null = null; // a outra
      if (req.kind === "sobreposto") lc = less(toLocal(C0, FN.n, FN.outer), g);
      else if (req.kind === "encosto") {
        lc = toLocal(C0, FN.n, FN.outer);
        ln = less(toLocal(N0, FC.n, FC.inner), g);
      } else {
        // esquadria: plano bissetor das faces externas (é também o das internas, mesma espessura); folga g/2 de cada lado
        const u = sub3(FN.n, FC.n);
        const U = len3(u);
        if (U < 1e-9) {
          err("CORNER_IMPOSSIBLE", `${req.label}: ${ca.b.label} e ${cb.b.label} são paralelas — não há plano bissetor.`, { op: req.op, bends: [c.a, c.b] });
          return false;
        }
        const uu = mul3(u, 1 / U);
        lc = less(toLocal(C0, uu, (FN.outer - FC.outer) / U), g / 2);
        ln = less(toLocal(N0, mul3(uu, -1), (FC.outer - FN.outer) / U), g / 2);
      }
      if ((req.kind !== "sobreposto" && !ln) || !lc) {
        err("CORNER_IMPOSSIBLE", `${req.label}: o plano de corte do canto ${ca.b.label} × ${cb.b.label} é paralelo à chapa — ângulos impossíveis para este canto.`, { op: req.op, bends: [c.a, c.b] });
        return false;
      }
      const put = (x: (typeof cfs)[number], l: Line2 | null) => {
        if (!l) return;
        const cur = sides.get(x.b.id) ?? {};
        if (x === ca) cur.l0 = l;
        else cur.l1 = l;
        sides.set(x.b.id, cur);
      };
      put(C0, lc);
      put(N0, ln);
      ext.set(id, { a: 0, b: 0 });
    }
    // 3) filhas: contorno (com os lados de canto) e visita
    const outlines = new Map<string, OutlineEdge[]>();
    for (const cf of cfs) {
      const { b, A, B, Lb, n, th, BA, SB, C, ax } = cf;
      let childOutline: OutlineEdge[];
      const child = flanges.get(b.child)!;
      if (child.shape.kind === "aba") {
        const Lc = child.shape.length;
        const sd = sides.get(b.id);
        const xAt = (l: Line2, y: number) => (l.c - l.n.y * y) / l.n.x;
        for (const [l, lado] of [[sd?.l0, 0], [sd?.l1, 1]] as const) {
          if (!l) continue;
          const corner = [...cornerReq.values()].find((r) => (lado === 0 ? r.a : r.b) === b.id && r.used && r.kind !== "aberto")!;
          // lado 0 guarda x ≥ x0(y) (normal para −x); lado 1 guarda x ≤ x1(y)
          const okDir = lado === 0 ? l.n.x < -1e-9 : l.n.x > 1e-9;
          const e = !okDir ? NaN : lado === 0 ? -xAt(l, SB) : xAt(l, SB) - Lb;
          if (!okDir || e < -dimAbs(Lb)) {
            err(
              okDir ? "CORNER_STRIP" : "CORNER_IMPOSSIBLE",
              okDir
                ? `${corner.label}: com ${corner.kind} o lado de ${b.label} entraria na faixa de dobra (${fmt(-e)} mm) — a dobra ficaria solta. Use outro tipo, mude a aba que fecha ou a folga.`
                : `${corner.label}: o plano da aba vizinha não corta ${b.label} pelo lado do canto — ângulos impossíveis para ${corner.kind}.`,
              { op: corner.op, bends: [corner.a, corner.b] },
            );
            return false;
          }
          const ex = ext.get(`${corner.a}+${corner.b}`)!;
          ext.set(`${corner.a}+${corner.b}`, lado === 0 ? { ...ex, a: Math.max(0, e) } : { ...ex, b: Math.max(0, e) });
        }
        const x0 = (y: number) => (sd?.l0 ? xAt(sd.l0, y) : 0);
        const x1 = (y: number) => (sd?.l1 ? xAt(sd.l1, y) : Lb);
        if (sd && !(x1(Lc) - x0(Lc) > dimAbs(Lc))) {
          const r = [...cornerReq.values()].find((q) => q.a === b.id || q.b === b.id)!;
          err("CORNER_IMPOSSIBLE", `${r.label}: os lados de ${b.label} se cruzam antes da ponta — a aba some no canto.`, { op: r.op, bends: [r.a, r.b] });
          return false;
        }
        childOutline = [
          { key: "raiz", a: v2(x0(0), 0), b: v2(x1(0), 0) },
          { key: "lado1", a: v2(x1(0), 0), b: v2(x1(Lc), Lc) },
          { key: "ponta", a: v2(x1(Lc), Lc), b: v2(x0(Lc), Lc) },
          { key: "lado0", a: v2(x0(Lc), Lc), b: v2(x0(0), 0) },
        ];
        if (sd) raizCfg.set(b.child, { t0: -x0(0), t1: Lb - x0(0), e0: -x0(SB) > dimAbs(Lb), e1: x1(SB) - Lb > dimAbs(Lb), SB });
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
        folded: !b.unfolded,
        effectiveDeg: b.unfolded ? 0 : b.theta,
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
        partial: (flat.interior.get(b.id)?.length ?? 0) > 0,
        position: b.position ?? "dentro",
        delta: deltaOf(b),
        axis: { p: apply(G, C), dir: applyDir(G, ax) },
        flatStart: strip(0),
        flatLine: strip(BA / 2),
        flatEnd: strip(BA),
        ...(b.relief && relieved.get(b.id)?.length
          ? { relief: { op: b.relief.op, kind: b.relief.kind, w: reliefDims(b).w, d: reliefDims(b).d, ends: relieved.get(b.id)! } }
          : {}),
      });
      outlines.set(b.child, childOutline);
    }
    // cantos detectados (aberto ou tratado), com o avanço de cada lado e o alívio retangular que sobra
    for (const c of sib) {
      const id = `${c.a}+${c.b}`;
      const req = cornerReq.get(id);
      const ba = cfs.find((x) => x.b.id === c.a)!.BA;
      const bb = cfs.find((x) => x.b.id === c.b)!.BA;
      outC.push({
        id,
        parent: fid,
        a: c.a,
        b: c.b,
        at: c.at,
        angleDeg: c.angleDeg,
        kind: req?.kind ?? "aberto",
        ...(req ? { op: req.op, gap: req.gap, closer: req.closer } : {}),
        ext: ext.get(id) ?? { a: 0, b: 0 },
        relief: { kind: "retangular", a: ba, b: bb },
      });
    }
    for (const cf of cfs) if (!visit(cf.b.child, cf.Gc, cf.Hc, outlines.get(cf.b.child)!, cf.Gn)) return false;
    return true;
  };

  const rootShape = flanges.get(base.id)!.shape;
  const ok = visit(base.id, G0, IDENTITY, rootShape.kind === "poly" ? rootShape.outline : []);
  if (ok)
    for (const r of cornerReq.values())
      if (!r.used)
        err("CORNER_LOST", `${r.label}: ${bends.get(r.a)!.label} e ${bends.get(r.b)!.label} não se encontram num canto (recuo no canto ou arestas não vizinhas).`, { op: r.op, bends: [r.a, r.b] });
  if (!ok || issues.some((i) => i.level === "error")) return fail();
  // ordem estável: abas e dobras na ordem de criação (base primeiro)
  const rank = new Map<string, number>([[base.id, -1], ...order.map((id, i) => [id, i] as [string, number])]);
  outF.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  outB.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  let FF: readonly SolvedFlange[] = outF;
  let BB: readonly SolvedBend[] = outB;
  if (flatCuts.length) {
    const r = applyFlatCuts(flatCuts, outF, outB, err);
    if (!r || issues.some((i) => i.level === "error")) return fail();
    FF = r.flanges;
    BB = r.bends;
  }
  const volume = FF.reduce((v, f) => v + f.area * T, 0) + BB.reduce((v, b) => v + bendVolume(b, T), 0);
  const flatArea = FF.reduce((v, f) => v + f.area, 0) + BB.reduce((v, b) => v + bendFlatArea(b), 0);
  return { ok: true, issues, T, root: base.id, flanges: FF, bends: BB, volume, flatArea, corners: outC };
}

/* ================================================================================================ */

/** Volume da região de dobra: θ·T·(R + T/2)·L; com recorte (2.4), Σ fatias (Δu·Δs / (R + K·T))·T·(R + T/2). */
export function bendVolume(b: SolvedBend, T: number): number {
  // desdobrada (2.5): região plana BA × L × T (fatias Δu·Δs·T)
  if (!b.folded) return b.cut ? bendFlatArea(b) * T : b.BA * b.L * T;
  if (!b.cut) return deg(b.deflectionDeg) * T * (b.R + T / 2) * b.L;
  const k = (T * (b.R + T / 2)) / (b.R + b.K * T);
  return b.cut.slabs.reduce((v, q) => v + q.mat.reduce((w, m) => w + (q.u1 - q.u0) * (m[1] - m[0]) * k, 0), 0);
}
/** Área planificada da região de dobra: BA·L; com recorte, Σ Δu·Δs das fatias de material. */
export function bendFlatArea(b: SolvedBend): number {
  if (!b.cut) return b.BA * b.L;
  return b.cut.slabs.reduce((v, q) => v + q.mat.reduce((w, m) => w + (q.u1 - q.u0) * (m[1] - m[0]), 0), 0);
}

/** Chaves dos laços: a chave estável quando existe; repetida ou ausente → posição (ordem estável). */
function loopKeys(loops: readonly Loop2[]): string[] {
  const seen = new Map<string, number>();
  return loops.map((l, i) => {
    const k = l.key ?? String(i + 1);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n > 1 ? `${k}~${n}` : k;
  });
}

export interface ReliefDims {
  kind: ReliefKind;
  /** largura w e profundidade d (a partir do vértice virtual, para dentro) */
  w: number;
  d: number;
  bend: string;
}
export interface EdgePiece {
  /** trecho da aresta de molde [t0, t1] a partir de a */
  t0: number;
  t1: number;
  /** recuo para dentro (SB da dobra; 0 = livre) */
  off: number;
  key: string;
  bend?: string;
  relief?: ReliefDims;
}
export type TrimResult =
  | {
      ok: true;
      edges: OutlineEdge[];
      interior: Map<string, ("inicio" | "fim")[]>;
      relieved: Map<string, ("inicio" | "fim")[]>;
      /** vértices onde duas faixas de dobra se encontram (a termina, b começa) */
      corners: { a: string; b: string; at: V2; angleDeg: number }[];
    }
  | { ok: false; edge: string; relief?: string };

/**
 * Região plana com faixas parciais (ETAPA 2.1a): cada aresta de molde é dividida em trechos com recuo próprio
 * (livre = 0; faixa de dobra = SB). Retas deslocadas consecutivas se cruzam (vértice); paralelas com recuos
 * diferentes ganham um DEGRAU perpendicular na fronteira do trecho (onde a dobra começa/termina dentro da
 * aresta). Com ALÍVIO (2.1b) o degrau vira o entalhe do alívio, do lado livre, do vértice virtual até a
 * profundidade d (retangular, oblongo com fundo semicircular, lágrima com bulbo de raio w).
 * Chaves: trecho livre = aresta; faixa n = «aresta»^n; degraus = «aresta»^n:p0 (entra) / :p1 (sai) ou
 * «aresta A»>«aresta B» entre arestas colineares; alívio = «faixa»:r0.i (início) / :r1.i (fim).
 */
export function trimOutlinePieces(outline: readonly OutlineEdge[], piecesOf: (e: OutlineEdge) => EdgePiece[]): TrimResult {
  type Ln = { p: V2; d: V2; n: V2; off: number; key: string; bend?: string; relief?: ReliefDims; m0: V2; m1: V2; edge: string };
  const lines: Ln[] = [];
  for (const e of outline) {
    const d = unit2(sub2(e.b, e.a));
    const n = right2(d);
    for (const pc of piecesOf(e)) {
      const m0 = add2(e.a, mul2(d, pc.t0));
      const m1 = add2(e.a, mul2(d, pc.t1));
      lines.push({ p: sub2(m0, mul2(n, pc.off)), d, n, off: pc.off, key: pc.key, ...(pc.bend ? { bend: pc.bend } : {}), ...(pc.relief ? { relief: pc.relief } : {}), m0, m1, edge: e.key });
    }
  }
  const N = lines.length;
  const interior = new Map<string, ("inicio" | "fim")[]>();
  const relieved = new Map<string, ("inicio" | "fim")[]>();
  const mark = (m: Map<string, ("inicio" | "fim")[]>, b: string, e: "inicio" | "fim") => m.set(b, [...(m.get(b) ?? []), e]);
  // entre a reta j e a j+1: primeiro e último ponto e o caminho entre eles (degrau ou alívio)
  type Joint = { first: V2; last: V2; path: OutlineEdge[] };
  const joints: Joint[] = [];
  const corners: { a: string; b: string; at: V2; angleDeg: number }[] = [];
  for (let j = 0; j < N; j++) {
    const L0 = lines[j];
    const L1 = lines[(j + 1) % N];
    const x = lineX(L0.p, L0.d, L1.p, L1.d);
    if (x) {
      joints.push({ first: x, last: x, path: [] });
      if (L0.bend && L1.bend && L0.bend !== L1.bend && L0.edge !== L1.edge) {
        // canto da pai: ângulo interno entre as arestas (sentido anti-horário)
        const ang = Math.PI - Math.atan2(cross2(L0.d, L1.d), dot2(L0.d, L1.d));
        corners.push({ a: L0.bend, b: L1.bend, at: x, angleDeg: (ang * 180) / Math.PI });
      }
      continue;
    }
    if (dot2(L0.d, L1.d) <= 0) return { ok: false, edge: L1.edge };
    if (Math.abs(L0.off - L1.off) < 1e-12) {
      const q = sub2(L0.m1, mul2(L0.n, L0.off));
      joints.push({ first: q, last: q, path: [] });
      continue;
    }
    // degrau: a dobra começa (livre → faixa) ou termina (faixa → livre) dentro da aresta. Com a posição do
    // material (2.2) a faixa pode recuar MENOS que o trecho livre (ou avançar para fora): degrau para fora, sem
    // material da pai encostado na dobra — não há ponta interna nem alívio.
    const spanIs1 = L1.bend !== undefined && (L0.bend === undefined || L1.off > L0.off);
    const enter = spanIs1;
    const span = spanIs1 ? L1 : L0;
    const other = spanIs1 ? L0 : L1;
    const inward = span.bend !== undefined && other.bend === undefined && span.off > other.off + 1e-12;
    if (inward) mark(interior, span.bend!, enter ? "inicio" : "fim");
    if (span.relief && inward) {
      const path = reliefPath(span, enter);
      if (!path) return { ok: false, edge: span.edge, relief: span.bend };
      mark(relieved, span.bend!, enter ? "inicio" : "fim");
      joints.push(path);
      continue;
    }
    const sameEdge = L0.edge === L1.edge;
    const stepKey = sameEdge ? (L1.bend ? `${L1.key}:p0` : `${L0.key}:p1`) : `${L0.edge}>${L1.edge}`;
    const p0 = sub2(L0.m1, mul2(L0.n, L0.off));
    const p1 = sub2(L1.m0, mul2(L1.n, L1.off));
    if (len2(sub2(p1, p0)) <= 1e-12) return { ok: false, edge: L1.edge };
    joints.push({ first: p0, last: p1, path: [{ key: stepKey, a: p0, b: p1 }] });
  }
  const edges: OutlineEdge[] = [];
  for (let j = 0; j < N; j++) {
    const prev = joints[(j + N - 1) % N];
    const next = joints[j];
    const Lj = lines[j];
    const a = prev.last;
    const b = next.first;
    const de = sub2(b, a);
    if (!(dot2(de, Lj.d) > 0) || len2(de) <= 1e-9 * Math.max(1, len2(sub2(Lj.m1, Lj.m0)))) return { ok: false, edge: Lj.edge, ...(Lj.relief || lines[(j + 1) % N].relief || lines[(j + N - 1) % N].relief ? { relief: (Lj.relief ?? lines[(j + 1) % N].relief ?? lines[(j + N - 1) % N].relief)!.bend } : {}) };
    edges.push({ key: Lj.key, a, b, ...(Lj.bend ? { bend: Lj.bend } : {}) });
    edges.push(...next.path);
  }
  const segs: Seg[] = edges.map(edgeSeg);
  if (selfIntersections(segs, true, 1e-9).length) {
    const rl = lines.find((l) => l.relief);
    return { ok: false, edge: outline[0].key, ...(rl ? { relief: rl.relief!.bend } : {}) };
  }
  return { ok: true, edges, interior, relieved, corners };
}

/**
 * Entalhe do alívio no degrau da faixa `span` (entrando = ponta inicial; saindo = ponta final). Coordenadas:
 * u ao longo da aresta (a partir da ponta da faixa, para o lado LIVRE é negativo no início e positivo no fim) e
 * profundidade para dentro a partir do vértice virtual. A parede do lado da dobra fica na própria ponta da faixa
 * (a região de dobra continua retangular); o entalhe passa a linha de tangência (profundidade SB) por g.
 */
function reliefPath(span: { d: V2; n: V2; off: number; key: string; m0: V2; m1: V2; relief?: ReliefDims }, enter: boolean): { first: V2; last: V2; path: OutlineEdge[] } | null {
  const r = span.relief!;
  const SB = span.off;
  const m = enter ? span.m0 : span.m1;
  const sgn = enter ? -1 : 1; // lado livre
  const P = (u: number, depth: number) => sub2(add2(m, mul2(span.d, u * sgn)), mul2(span.n, depth));
  const w = r.w;
  const d = r.d;
  const tag = `${span.key}:r${enter ? 0 : 1}`;
  let pts: { p: V2; arc?: { c: V2; via: V2 } }[];
  if (r.kind === "retangular") {
    if (!(d > SB + 1e-9)) return null;
    pts = [{ p: P(w, 0) }, { p: P(w, d) }, { p: P(0, d) }, { p: P(0, SB) }];
  } else if (r.kind === "oblongo") {
    const rr = w / 2;
    if (!(d - rr > SB + 1e-9)) return null;
    pts = [{ p: P(w, 0) }, { p: P(w, d - rr) }, { p: P(0, d - rr), arc: { c: P(rr, d - rr), via: P(rr, d) } }, { p: P(0, SB) }];
  } else {
    // lágrima: rasgo de largura w até a profundidade h = d, bulbo de raio w tangente à ponta da faixa
    const rb = w;
    const h = d;
    if (!(h > SB + 1e-9) || !(h - rb > 1e-9)) return null;
    // centro (u = w, h): a parede livre do rasgo passa pelo centro e encontra o bulbo no topo (h − w)
    pts = [{ p: P(w, 0) }, { p: P(w, h - rb) }, { p: P(0, h), arc: { c: P(rb, h), via: P(2 * rb, h) } }, { p: P(0, SB) }];
  }
  // no fim da faixa o percurso é o inverso (da faixa para o lado livre)
  const seq = enter ? pts : [...pts].reverse().map((q, i, arr) => ({ p: q.p, ...(i > 0 && arr[i - 1].arc ? { arc: arr[i - 1].arc } : {}) }));
  const path: OutlineEdge[] = [];
  for (let i = 0; i + 1 < seq.length; i++) {
    const a = seq[i].p;
    const b = seq[i + 1].p;
    const arc = seq[i + 1].arc;
    if (len2(sub2(b, a)) <= 1e-12) return null;
    if (arc) path.push({ key: `${tag}.${i}`, a, b, arc: { c: arc.c, sweep: sweepVia(arc.c, a, b, arc.via) } });
    else path.push({ key: `${tag}.${i}`, a, b });
  }
  return { first: seq[0].p, last: seq[seq.length - 1].p, path };
}

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
const pointInPoly = (p: V2, edges: readonly OutlineEdge[]): boolean => pointInEdges(p, edges);
/** null = dentro e sem tocar; "cross" = toca/cruza a borda; "out" = fora. */
function loopInside(l: Loop2, edges: readonly OutlineEdge[], tol: number): "cross" | "out" | null {
  const ls = toSegs(l);
  for (const e of edges) {
    const es = edgeSeg(e);
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
  // direção irracional para não passar por vértices em casos alinhados; comprimento limitado à caixa do laço
  // (um raio de 1e9 perde precisão na interseção com arcos e cria cruzamentos falsos)
  let m = 0;
  for (const s of segs) {
    const [q, r] = s.kind === "line" ? [s.a, 0] : [s.c, s.r];
    m = Math.max(m, Math.abs(q.x - p.x) + r, Math.abs(q.y - p.y) + r);
    if (s.kind === "line") m = Math.max(m, Math.abs(s.b.x - p.x), Math.abs(s.b.y - p.y));
  }
  const far = 4 * m + 1;
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
