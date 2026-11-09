import {
  type DimensionEntity,
  type Entity,
  type Vec2,
  entityBox,
  entityLength,
  lineCircleParams,
  lineSeg,
  makeEntity,
  polylineSignedArea,
  selfIntersections,
  transformEntity,
  translation,
} from "@agtn/geometry";
import { type BendDir, type FlangeInput, type Issue, type SolveResult, solveProfile } from "./engine";
import { autoDimScale, fmtMM, sectionEntities } from "./output";
import { flangeFaces } from "./profiles";

/**
 * BANDEJA / BANDEJA ENRIJECIDA — caixa aberta com abas nas bordas do fundo (e, na enrijecida, pestana/retorno
 * na ponta de cada aba), planificada com o recorte de canto pronto para o laser.
 *
 * GEOMETRIA (convenções do módulo: medidas até o vértice virtual, BA = θ·(R + K·T))
 *   SB(θ) = (R+T)·tan(θ/2) externo  ·  R·tan(θ/2) interno
 *   fundo plano   a = A − Σ SB(θ1)                          (por borda com aba)
 *   reto da aba   f = H − SB(θ1) − SB(θ2)  (sem pestana: H − SB(θ1))
 *   reto pestana  p = P − SB(θ2)
 *   H = comprimento da aba ao longo da parede (igual aos perfis; em 90° é a altura); com pestana para fora a
 *   medida externa da aba é "de fora a fora" (igual ao Z). Tudo idêntico ao motor de perfis (`solveProfile`).
 *
 * Fundo no plano XY: A = comprimento (X), B = largura (Y). Bordas: S (inferior) e N (superior) no lado A;
 * O (esquerda) e L (direita) no lado B.
 *
 * CANTO — a ponta de cada faixa (aba, pestana) é definida por uma regra no espaço da peça dobrada, aplicada
 * em cada posição do desenvolvimento (por isso funciona com qualquer ângulo):
 *   sobreposto  a aba do lado que fecha vai até a face externa da vizinha (− folga); a outra para na borda;
 *   encosto     a que fecha vai até a face externa da vizinha; a outra vai até a face interna da que fecha
 *               (− folga) — canto fechado;
 *   esquadria   cada aba é cortada no plano bissetor do canto (meia-esquadria, com a fibra mais interna,
 *               folga dividida entre as duas) — o canto certo para abas inclinadas;
 *   aberto      as abas param na borda do fundo.
 * Pestanas: se as duas vizinhas têm pestana, sempre em esquadria (senão se cruzariam); se só uma tem,
 * a pestana para dentro vai até a face interna da aba vizinha e a para fora até a face externa.
 * As regiões de dobra vão sempre de borda a borda da faixa anterior: o recorte que sobra é o alívio
 * retangular. Opcional: furo de alívio redondo no cruzamento das linhas de dobra de cada canto.
 */
export type TraySide = "S" | "N" | "O" | "L";
export type TrayCorner = "sobreposto" | "encosto" | "esquadria" | "aberto";
export type TrayLipDir = "dentro" | "fora";
export type TrayRelief = "retangular" | "redondo";

export const TRAY_SIDES: readonly TraySide[] = ["S", "N", "O", "L"];
export const TRAY_SIDE_LABEL: Record<TraySide, string> = {
  S: "Aba inferior (A)",
  N: "Aba superior (A)",
  O: "Aba esquerda (B)",
  L: "Aba direita (B)",
};
export const TRAY_SIDE_SHORT: Record<TraySide, string> = { S: "inf.", N: "sup.", O: "esq.", L: "dir." };
export const TRAY_CORNER_LABEL: Record<TrayCorner, string> = {
  sobreposto: "Sobreposto",
  encosto: "Encosto",
  esquadria: "Esquadria",
  aberto: "Aberto",
};

export interface TrayInput {
  /** Comprimento (X), mm */
  A: number;
  /** Largura (Y), mm */
  B: number;
  /** Comprimento de cada aba (0 = borda sem aba) */
  flanges: Record<TraySide, number>;
  /** Referência de A, B, abas e pestanas */
  ref: "externa" | "interna";
  T: number;
  /** Raio interno (todas as dobras) */
  R: number;
  K: number;
  /** θ das abas (padrão 90°) */
  angleDeg?: number;
  /** Pestana (retorno) de cada aba; 0 = sem pestana. Só vale onde há aba. */
  lips?: Record<TraySide, number>;
  /** θ da pestana (padrão 90°) */
  lipAngleDeg?: number;
  /** Pestana para dentro (enrijecida, padrão) ou para fora (aba de fixação) */
  lipDir?: TrayLipDir;
  corner: TrayCorner;
  /** Abas que fecham o canto (sobreposto/encosto): as do lado A (S/N) ou as do lado B (O/L) */
  overlap: "A" | "B";
  /** Folga de solda no canto (mm) */
  gap: number;
  relief?: TrayRelief;
  /** Diâmetro do furo de alívio (null/0 = automático) */
  reliefD?: number | null;
}

export type TrayBendKind = "aba" | "pestana";

export interface TrayBend {
  side: TraySide;
  kind: TrayBendKind;
  /** Número na ordem de dobra sugerida (1…) */
  n: number;
  thetaDeg: number;
  /** Sentido na planificação (CIMA = face interna voltada para quem olha a chapa) */
  sense: "CIMA" | "BAIXO";
  BA: number;
  /** Linha de dobra (centro da região) e limites da região */
  line: [Vec2, Vec2];
  start: [Vec2, Vec2];
  end: [Vec2, Vec2];
}

export interface TraySideResult {
  side: TraySide;
  /** Comprimento informado da aba e da pestana */
  H: number;
  P: number;
  /** Retos (desenvolvimento) */
  flat: number;
  lipFlat: number;
  /** Altura vertical externa da aba dobrada (do fundo ao ponto mais alto) */
  heightVert: number;
  /** Quanto a aba passa da borda do fundo em cada ponta (no início e no fim da parede) */
  ext: [number, number];
  /** Faixas do desenvolvimento (v a partir da borda do fundo) com o avanço em cada ponta */
  bands: Band[];
}

export interface TrayResult {
  ok: boolean;
  issues: Issue[];
  input: TrayInput;
  theta: number;
  lipTheta: number;
  hasLips: boolean;
  BA: number;
  BA2: number;
  OSB: number;
  BD: number;
  /** Medidas externas (vértice virtual) do fundo */
  Aext: number;
  Bext: number;
  /** Fundo plano (entre tangências) */
  base: { a: number; b: number };
  sides: TraySideResult[];
  /** Contorno de corte, anti-horário (bulges ≠ 0 só nos furos de alívio redondos) */
  contour: Vec2[];
  bulges: number[];
  bends: TrayBend[];
  reliefD: number;
  blank: { w: number; h: number };
  area: number;
  cutLength: number;
  /** Ordem de dobra sugerida (lado + tipo) */
  order: { side: TraySide; kind: TrayBendKind }[];
  /** Plantas (projeção de cada faixa) e seções do motor de perfis, para a vista */
  plan: { side: TraySide; poly: Vec2[] }[];
  sections: { X: SolveResult | null; Y: SolveResult | null };
}

const EPS = 1e-9;
const d2r = (d: number) => (d * Math.PI) / 180;
const rot = (v: Vec2, a: number): Vec2 => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
const add = (p: Vec2, q: Vec2): Vec2 => ({ x: p.x + q.x, y: p.y + q.y });
const mul = (p: Vec2, k: number): Vec2 => ({ x: p.x * k, y: p.y * k });
const near = (p: Vec2, q: Vec2, t = 1e-9) => Math.abs(p.x - q.x) < t && Math.abs(p.y - q.y) < t;

/* ------------------------------------------------------------------------------------------------ */
/*                       Seção de uma borda: caminho fibra a fibra (u, z)                            */
/* ------------------------------------------------------------------------------------------------ */
/*  u = distância horizontal para dentro, a partir do vértice virtual externo do fundo nessa borda;   */
/*  z = altura a partir da face de baixo do fundo; v = posição no desenvolvimento a partir da borda   */
/*  do fundo (início da dobra 1); t = profundidade a partir da face de DENTRO da bandeja (0…T).        */

interface PathSeg {
  v0: number;
  v1: number;
  /** ponto da face de dentro e direções no início do trecho */
  p: Vec2;
  d: Vec2;
  n: Vec2;
  arc?: { c: Vec2; sign: number; rn: number };
}

function buildPath(T: number, R: number, K: number, th1: number, fw: number, th2: number, s2: number, fl: number, SB1: number): PathSeg[] {
  const segs: PathSeg[] = [];
  let p: Vec2 = { x: SB1, y: T };
  let d: Vec2 = { x: -1, y: 0 };
  let n: Vec2 = { x: 0, y: -1 };
  let v = 0;
  const rn = R + K * T;
  const line = (L: number) => {
    segs.push({ v0: v, v1: v + L, p, d, n });
    p = add(p, mul(d, L));
    v += L;
  };
  const bend = (th: number, sign: number) => {
    const left = { x: -d.y, y: d.x };
    const side = mul(left, sign);
    const innerIsTray = side.x * n.x + side.y * n.y < 0;
    const c = add(innerIsTray ? p : add(p, mul(n, T)), mul(side, R));
    segs.push({ v0: v, v1: v + th * rn, p, d, n, arc: { c, sign, rn } });
    p = add(c, rot({ x: p.x - c.x, y: p.y - c.y }, sign * th));
    d = rot(d, sign * th);
    n = rot(n, sign * th);
    v += th * rn;
  };
  bend(th1, -1);
  line(fw);
  if (fl > EPS) {
    bend(th2, s2);
    line(fl);
  }
  return segs;
}

function pathPoint(segs: PathSeg[], v: number, t: number): Vec2 {
  let s = segs[segs.length - 1];
  for (const g of segs)
    if (v <= g.v1 + 1e-12) {
      s = g;
      break;
    }
  const q = add(s.p, mul(s.n, t));
  if (!s.arc) return add(q, mul(s.d, v - s.v0));
  const phi = (v - s.v0) / s.arc.rn;
  const c = s.arc.c;
  return add(c, rot({ x: q.x - c.x, y: q.y - c.y }, s.arc.sign * phi));
}

/* ------------------------------------------------------------------------------------------------ */

export interface Band {
  kind: "dobra1" | "aba" | "dobra2" | "pestana";
  v0: number;
  v1: number;
  /** avanço além da borda do fundo, na ponta inicial e final da faixa (em v0 e v1) */
  s0: number;
  s1: number;
  e0: number;
  e1: number;
}

const NEXT: Record<TraySide, TraySide> = { S: "L", L: "N", N: "O", O: "S" };
const PREV: Record<TraySide, TraySide> = { S: "O", L: "S", N: "L", O: "N" };

export function solveTray(inp: TrayInput): TrayResult {
  const issues: Issue[] = [];
  const err = (code: string, message: string) => issues.push({ level: "error", code, message });
  const warn = (code: string, message: string) => issues.push({ level: "warning", code, message });
  const fin = Number.isFinite;
  const { A, B, T, R, K } = inp;
  const th1Deg = inp.angleDeg ?? 90;
  const th2Deg = inp.lipAngleDeg ?? 90;
  const lipIn = (inp.lipDir ?? "dentro") === "dentro";
  const lipsIn = inp.lips ?? { S: 0, N: 0, O: 0, L: 0 };
  const has = (s: TraySide) => fin(inp.flanges[s]) && inp.flanges[s] > EPS;
  const hasLip = (s: TraySide) => has(s) && fin(lipsIn[s]) && lipsIn[s] > EPS;
  const ext = inp.ref === "externa";
  const gap = inp.gap ?? 0;

  if (!fin(A) || A <= 0) err("A", "Comprimento A deve ser maior que zero.");
  if (!fin(B) || B <= 0) err("B", "Largura B deve ser maior que zero.");
  if (!fin(T) || T <= 0) err("T", "Espessura deve ser maior que zero.");
  if (!fin(R) || R < 0) err("R", "Raio interno não pode ser negativo.");
  if (!fin(K) || K < 0 || K > 1) err("K", "Fator K deve estar entre 0 e 1.");
  if (!fin(gap) || gap < 0) err("GAP", "Folga não pode ser negativa.");
  if (!fin(th1Deg) || th1Deg <= 0 || th1Deg >= 180) err("ANGLE", "Ângulo das abas deve estar entre 0° e 180°.");
  if (!fin(th2Deg) || th2Deg <= 0 || th2Deg >= 180) err("LIP_ANGLE", "Ângulo da pestana deve estar entre 0° e 180°.");
  for (const s of TRAY_SIDES) {
    if (!fin(inp.flanges[s]) || inp.flanges[s] < 0) err("H", `${TRAY_SIDE_LABEL[s]}: comprimento inválido.`);
    if (!fin(lipsIn[s]) || lipsIn[s] < 0) err("P", `Pestana ${TRAY_SIDE_SHORT[s]}: comprimento inválido.`);
  }
  if (!TRAY_SIDES.some(has)) err("NONE", "Informe ao menos uma aba.");

  const th1 = d2r(th1Deg);
  const th2 = d2r(th2Deg);
  const rn = R + K * T;
  const BA = th1 * rn;
  const BA2 = th2 * rn;
  const OSB1 = (R + T) * Math.tan(th1 / 2);
  const ISB1 = R * Math.tan(th1 / 2);
  const OSB2 = (R + T) * Math.tan(th2 / 2);
  const ISB2 = R * Math.tan(th2 / 2);
  const SB1 = ext ? OSB1 : ISB1;
  const SB2 = ext ? OSB2 : ISB2;
  const BD = 2 * OSB1 - BA;
  const nX = (has("O") ? 1 : 0) + (has("L") ? 1 : 0);
  const nY = (has("S") ? 1 : 0) + (has("N") ? 1 : 0);
  const a = A - nX * SB1;
  const b = B - nY * SB1;
  const Aext = a + nX * OSB1;
  const Bext = b + nY * OSB1;
  const hasLips = TRAY_SIDES.some(hasLip);
  const fw: Record<TraySide, number> = { S: 0, N: 0, O: 0, L: 0 };
  const fl: Record<TraySide, number> = { S: 0, N: 0, O: 0, L: 0 };
  for (const s of TRAY_SIDES) {
    if (!has(s)) continue;
    fw[s] = inp.flanges[s] - SB1 - (hasLip(s) ? SB2 : 0);
    if (fin(fw[s]) && fw[s] <= EPS)
      err("H_MIN", `${TRAY_SIDE_LABEL[s]}: ${fmtMM(inp.flanges[s])} não passa do raio — mínimo ${fmtMM(SB1 + (hasLip(s) ? SB2 : 0))}.`);
    if (hasLip(s)) {
      fl[s] = lipsIn[s] - SB2;
      if (fin(fl[s]) && fl[s] <= EPS) err("P_MIN", `Pestana ${TRAY_SIDE_SHORT[s]}: ${fmtMM(lipsIn[s])} não passa do raio — mínimo ${fmtMM(SB2)}.`);
    }
  }
  if (!issues.some((i) => i.level === "error") && (a <= EPS || b <= EPS)) err("BASE", "Fundo resultante menor ou igual a zero: confira A, B e o raio.");

  const covers = (s: TraySide) => (inp.overlap === "A" ? s === "S" || s === "N" : s === "O" || s === "L");
  const corner = inp.corner;
  const order: { side: TraySide; kind: TrayBendKind }[] = [
    ...TRAY_SIDES.filter(hasLip).map((side) => ({ side, kind: "pestana" as const })),
    ...(corner === "sobreposto" || corner === "encosto"
      ? [...TRAY_SIDES.filter((x) => has(x) && !covers(x)), ...TRAY_SIDES.filter((x) => has(x) && covers(x))]
      : TRAY_SIDES.filter(has)
    ).map((side) => ({ side, kind: "aba" as const })),
  ];
  const relief = inp.relief ?? "retangular";
  const autoD = Math.ceil((Math.SQRT2 * BA + T) * 2) / 2;
  const reliefD = inp.reliefD && inp.reliefD > 0 ? inp.reliefD : autoD;

  const empty: TrayResult = {
    ok: false, issues, input: inp, theta: th1Deg, lipTheta: th2Deg, hasLips, BA, BA2, OSB: OSB1, BD, Aext, Bext, base: { a, b },
    sides: [], contour: [], bulges: [], bends: [], reliefD, blank: { w: 0, h: 0 }, area: 0, cutLength: 0, order, plan: [],
    sections: { X: null, Y: null },
  };
  if (issues.some((i) => i.level === "error")) return empty;

  const ok0 = true;
  if (ok0 && R / T < 0.5) warn("R_SMALL", `Raio interno ${fmtMM(R)} pequeno para a espessura (R/T = ${fmtMM(R / T, 2)}): risco de trinca no canto.`);
  if (ok0 && (K < 0.2 || K > 0.5)) warn("K_UNUSUAL", `K = ${K} está fora da faixa usual (0,20–0,50).`);
  if (th1Deg > 90 + 1e-9 && (corner === "aberto" || corner === "sobreposto"))
    warn("LEAN_IN", `Abas inclinadas para dentro (θ ${fmtMM(th1Deg, 1)}°) com canto ${TRAY_CORNER_LABEL[corner].toLowerCase()}: as abas podem se tocar no canto — prefira esquadria.`);
  if (Math.abs(th1Deg - 90) > 1e-9 && corner === "sobreposto")
    warn("SLOPE_LAP", "Canto sobreposto com aba inclinada: a fresta no canto varia com a altura. Para canto fechado use encosto ou esquadria.");

  /* ---- caminhos de seção por borda ---- */
  const s2 = lipIn ? -1 : 1;
  const paths: Partial<Record<TraySide, PathSeg[]>> = {};
  for (const s of TRAY_SIDES) if (has(s)) paths[s] = buildPath(T, R, K, th1, fw[s], th2, s2, hasLip(s) ? fl[s] : 0, OSB1);
  const fibers = (s: TraySide, v: number) => [pathPoint(paths[s]!, v, 0), pathPoint(paths[s]!, v, T)];
  // linhas (estendidas) das faces da parede da vizinha, em função da altura z (mesmo θ1 em todas)
  const cot1 = Math.cos(th1) / Math.sin(th1);
  const outerN = (z: number) => -z * cot1;
  const innerN = (z: number) => T / Math.sin(th1) - z * cot1;
  const maxOf = (pts: Vec2[], f: (p: Vec2) => number) => Math.max(...pts.map(f));

  /** X mínimo (na coordenada u da vizinha nb) para a faixa `kind` da borda s, nos pontos pts */
  const rule = (s: TraySide, nb: TraySide, kind: Band["kind"], pts: Vec2[]): number => {
    if (kind === "dobra1") return OSB1;
    const wall = (): number => {
      switch (corner) {
        case "aberto":
          return OSB1;
        case "sobreposto":
          return covers(s) ? maxOf(pts, (p) => outerN(p.y)) + gap : OSB1;
        case "encosto":
          return covers(s) ? maxOf(pts, (p) => outerN(p.y)) : maxOf(pts, (p) => innerN(p.y)) + gap;
        case "esquadria":
          return maxOf(pts, (p) => p.x) + gap / 2;
      }
    };
    const lip = (): number => {
      let x: number;
      if (hasLip(nb)) x = maxOf(pts, (p) => p.x) + gap / 2;
      else x = lipIn ? maxOf(pts, (p) => innerN(p.y)) + gap : maxOf(pts, (p) => outerN(p.y));
      return corner === "aberto" ? Math.max(x, OSB1) : x;
    };
    if (kind === "aba") return wall();
    if (kind === "pestana") return lip();
    return Math.max(wall(), lip());
  };

  const bandsOf = (s: TraySide): Band[] => {
    const bands: Band[] = [];
    const v1 = BA, v2 = BA + fw[s], v3 = v2 + BA2, v4 = v3 + fl[s];
    const spans: [Band["kind"], number, number][] = [["dobra1", 0, v1], ["aba", v1, v2]];
    if (hasLip(s)) spans.push(["dobra2", v2, v3], ["pestana", v3, v4]);
    const advAt = (nb: TraySide, kind: Band["kind"], v0: number, vv1: number): [number, number] => {
      if (!has(nb)) return [0, 0];
      if (kind === "dobra2") {
        let m = -Infinity;
        for (let k = 0; k <= 8; k++) m = Math.max(m, rule(s, nb, kind, fibers(s, v0 + ((vv1 - v0) * k) / 8)));
        return [OSB1 - m, OSB1 - m];
      }
      return [OSB1 - rule(s, nb, kind, fibers(s, v0)), OSB1 - rule(s, nb, kind, fibers(s, vv1))];
    };
    for (const [kind, v0, vv1] of spans) {
      const [s0, s1] = advAt(PREV[s], kind, v0, vv1);
      const [e0, e1] = advAt(NEXT[s], kind, v0, vv1);
      bands.push({ kind, v0, v1: vv1, s0, s1, e0, e1 });
    }
    // pestana: a região de dobra 2 não pode passar da aba (senão a dobra fica solta) nem da pestana
    const iB2 = bands.findIndex((x) => x.kind === "dobra2");
    if (iB2 > 0) {
      const w = bands[iB2 - 1], l = bands[iB2 + 1], g = bands[iB2];
      const sMin = Math.min(g.s0, w.s1, l.s0), eMin = Math.min(g.e0, w.e1, l.e0);
      bands[iB2] = { ...g, s0: sMin, s1: sMin, e0: eMin, e1: eMin };
    }
    return bands;
  };

  /* ---- montagem do contorno (faixas em coordenadas locais → chapa) ---- */
  const lenOf = (s: TraySide) => (s === "S" || s === "N" ? a : b);
  const toFlat = (s: TraySide, x: number, v: number): Vec2 => {
    switch (s) {
      case "S":
        return { x, y: -v };
      case "L":
        return { x: a + v, y: x };
      case "N":
        return { x: a - x, y: b + v };
      case "O":
        return { x: -v, y: b - x };
    }
  };
  const allBands: Partial<Record<TraySide, Band[]>> = {};
  const raw: Vec2[] = [];
  for (const s of ["S", "L", "N", "O"] as TraySide[]) {
    const L = lenOf(s);
    if (!has(s)) {
      raw.push(toFlat(s, 0, 0), toFlat(s, L, 0));
      continue;
    }
    const bands = bandsOf(s);
    allBands[s] = bands;
    const loc: Vec2[] = [{ x: 0, y: 0 }];
    for (const g of bands) loc.push({ x: -g.s0, y: g.v0 }, { x: -g.s1, y: g.v1 });
    for (let i = bands.length - 1; i >= 0; i--) loc.push({ x: L + bands[i].e1, y: bands[i].v1 }, { x: L + bands[i].e0, y: bands[i].v0 });
    loc.push({ x: L, y: 0 });
    for (const p of loc) raw.push(toFlat(s, p.x, p.y));
  }
  // remove repetidos e colineares
  let pts: Vec2[] = [];
  for (const p of raw) if (!pts.length || !near(pts[pts.length - 1], p, 1e-9)) pts.push(p);
  if (pts.length > 1 && near(pts[0], pts[pts.length - 1], 1e-9)) pts.pop();
  const clean = (q: Vec2[]): Vec2[] => {
    let changed = true;
    let r = q;
    while (changed && r.length > 3) {
      changed = false;
      const o: Vec2[] = [];
      for (let i = 0; i < r.length; i++) {
        const p0 = r[(i + r.length - 1) % r.length], p1 = r[i], p2 = r[(i + 1) % r.length];
        const cr = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
        const back = (p1.x - p0.x) * (p2.x - p1.x) + (p1.y - p0.y) * (p2.y - p1.y);
        if (Math.abs(cr) < 1e-9 && back >= 0) {
          changed = true;
          continue;
        }
        o.push(p1);
      }
      r = o;
    }
    return r;
  };
  pts = clean(pts);

  const segs = pts.map((p, i) => lineSeg(p, pts[(i + 1) % pts.length]));
  if (selfIntersections(segs, true).length)
    err("OVERLAP", "Na chapa plana as abas/pestanas se sobrepõem no canto: reduza a pestana, mude o tipo de canto ou aumente a folga.");
  if (issues.some((i) => i.level === "error")) return empty;

  /* ---- furos de alívio redondos ---- */
  let bulges = pts.map(() => 0);
  if (relief === "redondo") {
    if (reliefD / 2 <= (BA / 2) * Math.SQRT2 + 1e-9)
      warn("RELIEF_SMALL", `Furo de alívio Ø${fmtMM(reliefD)} não alcança o canto do fundo (mínimo Ø${fmtMM(Math.SQRT2 * BA, 2)}).`);
    const h = BA / 2;
    const centers: [TraySide, TraySide, Vec2][] = [
      ["S", "O", { x: -h, y: -h }],
      ["S", "L", { x: a + h, y: -h }],
      ["N", "L", { x: a + h, y: b + h }],
      ["N", "O", { x: -h, y: b + h }],
    ];
    for (const [p, q, c] of centers)
      if (has(p) && has(q)) {
        const r = subtractCircle(pts, bulges, c, reliefD / 2);
        pts = r.pts;
        bulges = r.bulges;
      }
  }

  /* ---- envelope, origem no canto inferior esquerdo ---- */
  const poly = makeEntity({ type: "polyline", pts, bulges, closed: true }, "0");
  const box = entityBox(poly);
  const sh = (p: Vec2): Vec2 => ({ x: p.x - box.minX, y: p.y - box.minY });
  const contour = pts.map(sh);
  const area = Math.abs(polylineSignedArea(contour, bulges));
  const cutLength = entityLength(poly);

  /* ---- linhas de dobra ---- */
  const nOf = (side: TraySide, kind: TrayBendKind) => order.findIndex((o) => o.side === side && o.kind === kind) + 1;
  const bends: TrayBend[] = [];
  for (const s of TRAY_SIDES) {
    const bands = allBands[s];
    if (!bands) continue;
    const L = lenOf(s);
    const seg = (g: Band, v: number): [Vec2, Vec2] => [sh(toFlat(s, -g.s0, v)), sh(toFlat(s, L + g.e0, v))];
    const b1 = bands[0];
    bends.push({ side: s, kind: "aba", n: nOf(s, "aba"), thetaDeg: th1Deg, sense: "CIMA", BA, line: seg(b1, BA / 2), start: seg(b1, 0), end: seg(b1, BA) });
    const b2 = bands.find((g) => g.kind === "dobra2");
    if (b2)
      bends.push({
        side: s, kind: "pestana", n: nOf(s, "pestana"), thetaDeg: th2Deg, sense: lipIn ? "CIMA" : "BAIXO", BA: BA2,
        line: seg(b2, (b2.v0 + b2.v1) / 2), start: seg(b2, b2.v0), end: seg(b2, b2.v1),
      });
  }
  bends.sort((p, q) => p.n - q.n);

  /* ---- resumo por borda ---- */
  const sides: TraySideResult[] = TRAY_SIDES.filter(has).map((s) => {
    const bands = allBands[s]!;
    const vEnd = bands[bands.length - 1].v1;
    let hz = 0;
    for (let k = 0; k <= 40; k++) for (const p of fibers(s, (vEnd * k) / 40)) hz = Math.max(hz, p.y);
    const w = bands[1];
    return { side: s, H: inp.flanges[s], P: hasLip(s) ? lipsIn[s] : 0, flat: fw[s], lipFlat: fl[s], heightVert: hz, ext: [Math.max(w.s0, w.s1), Math.max(w.e0, w.e1)], bands };
  });

  /* ---- planta: projeção de cada faixa (fibras de dentro e de fora) ---- */
  const off = (nb: TraySide) => (has(nb) ? OSB1 : 0);
  const toPlan = (s: TraySide, along: number, u: number): Vec2 => {
    switch (s) {
      case "S":
        return { x: along, y: u };
      case "L":
        return { x: Aext - u, y: along };
      case "N":
        return { x: Aext - along, y: Bext - u };
      case "O":
        return { x: u, y: Bext - along };
    }
  };
  const plan: { side: TraySide; poly: Vec2[] }[] = [];
  for (const s of TRAY_SIDES) {
    const bands = allBands[s];
    if (!bands) continue;
    const L = lenOf(s);
    const o0 = off(PREV[s]);
    for (const g of bands) {
      if (g.kind === "dobra1") continue;
      const cloud: Vec2[] = [];
      for (let k = 0; k <= 4; k++) {
        const f = k / 4;
        const v = g.v0 + (g.v1 - g.v0) * f;
        const xs = -(g.s0 + (g.s1 - g.s0) * f) + o0, xe = L + g.e0 + (g.e1 - g.e0) * f + o0;
        for (const p of fibers(s, v)) cloud.push(toPlan(s, xs, p.x), toPlan(s, xe, p.x));
      }
      plan.push({ side: s, poly: convexHull(cloud) });
    }
  }

  /* ---- seções pelo motor de perfis (vista e conferência) ---- */
  const section = (first: TraySide, last: TraySide, len: number, other: number): SolveResult | null => {
    const fls: { label: string; length: number }[] = [];
    const dirs: BendDir[] = [];
    const bnd: { label: string; angleDeg: number }[] = [];
    const lipDirBend: BendDir = lipIn ? "left" : "right";
    if (hasLip(first)) {
      fls.push({ label: `Pestana ${TRAY_SIDE_SHORT[first]}`, length: lipsIn[first] });
      dirs.push(lipDirBend);
      bnd.push({ label: `Dobra pestana ${TRAY_SIDE_SHORT[first]}`, angleDeg: th2Deg });
    }
    if (has(first)) {
      fls.push({ label: `Aba ${TRAY_SIDE_SHORT[first]}`, length: inp.flanges[first] });
      dirs.push("left");
      bnd.push({ label: `Dobra aba ${TRAY_SIDE_SHORT[first]}`, angleDeg: th1Deg });
    }
    fls.push({ label: "Fundo", length: len });
    if (has(last)) {
      dirs.push("left");
      bnd.push({ label: `Dobra aba ${TRAY_SIDE_SHORT[last]}`, angleDeg: th1Deg });
      fls.push({ label: `Aba ${TRAY_SIDE_SHORT[last]}`, length: inp.flanges[last] });
    }
    if (hasLip(last)) {
      dirs.push(lipDirBend);
      bnd.push({ label: `Dobra pestana ${TRAY_SIDE_SHORT[last]}`, angleDeg: th2Deg });
      fls.push({ label: `Pestana ${TRAY_SIDE_SHORT[last]}`, length: lipsIn[last] });
    }
    const flanges: FlangeInput[] = fls.map((f, i) => {
      const [face, faceEnd] = flangeFaces(inp.ref, i, dirs);
      return { ...f, face, faceEnd };
    });
    let start = 0;
    if (has(first)) start = -th1;
    if (hasLip(first)) start += lipIn ? -th2 : th2;
    try {
      return solveProfile({
        T,
        partLength: other,
        startAngle: start,
        flanges,
        bends: bnd.map((x, j) => ({ ...x, R, K, dir: dirs[j] })),
      });
    } catch {
      return null;
    }
  };
  const sections = { X: section("O", "L", A, B), Y: section("S", "N", B, A) };

  return { ...empty, ok: true, sides, contour, bulges, bends, blank: { w: box.maxX - box.minX, h: box.maxY - box.minY }, area, cutLength, plan, sections };
}

/* ------------------------------------------------------------------------------------------------ */
/*                                      utilitários geométricos                                     */
/* ------------------------------------------------------------------------------------------------ */

function convexHull(p: Vec2[]): Vec2[] {
  const q = [...p].sort((u, w) => u.x - w.x || u.y - w.y);
  const cr = (o: Vec2, u: Vec2, w: Vec2) => (u.x - o.x) * (w.y - o.y) - (u.y - o.y) * (w.x - o.x);
  const lo: Vec2[] = [];
  for (const x of q) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], x) <= 1e-12) lo.pop();
    lo.push(x);
  }
  const up: Vec2[] = [];
  for (let i = q.length - 1; i >= 0; i--) {
    const x = q[i];
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], x) <= 1e-12) up.pop();
    up.push(x);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/**
 * Contorno anti-horário menos um disco (furo de alívio que corta a borda): os trechos dentro do círculo
 * são trocados pelo arco do círculo (bulge negativo, sentido horário). Arestas com bulge passam intactas.
 */
export function subtractCircle(pts: Vec2[], bulges: number[], c: Vec2, r: number): { pts: Vec2[]; bulges: number[] } {
  const n = pts.length;
  const inside = (p: Vec2) => Math.hypot(p.x - c.x, p.y - c.y) < r - 1e-9;
  const k0 = pts.findIndex((p) => !inside(p));
  if (k0 < 0) return { pts, bulges };
  const out: { p: Vec2; b: number }[] = [];
  let isIn = false;
  let entry: Vec2 | null = null;
  let entryIdx = -1;
  const ang = (p: Vec2) => Math.atan2(p.y - c.y, p.x - c.x);
  for (let m = 0; m < n; m++) {
    const i = (k0 + m) % n;
    const p = pts[i], q = pts[(i + 1) % n], bi = bulges[i] ?? 0;
    if (!isIn) out.push({ p, b: bi });
    if (Math.abs(bi) > 1e-12) continue;
    const ts = lineCircleParams(p, q, c, r).filter((t) => t > 1e-9 && t < 1 - 1e-9);
    for (const t of ts) {
      const X = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
      if (!isIn) {
        out[out.length - 1].b = 0;
        entry = X;
        entryIdx = out.length;
        out.push({ p: X, b: 0 });
        isIn = true;
      } else {
        let sweep = ang(X) - ang(entry!);
        while (sweep > 1e-12) sweep -= 2 * Math.PI;
        while (sweep <= -2 * Math.PI) sweep += 2 * Math.PI;
        out[entryIdx].b = Math.tan(sweep / 4);
        out.push({ p: X, b: 0 });
        isIn = false;
      }
    }
  }
  const o = out.filter((x, i) => i === 0 || !near(x.p, out[i - 1].p, 1e-9));
  return { pts: o.map((x) => x.p), bulges: o.map((x) => x.b) };
}

/* ------------------------------------------------------------------------------------------------ */
/*                                        Saída (entidades)                                         */
/* ------------------------------------------------------------------------------------------------ */

const dim = (p1: Vec2, p2: Vec2, loc: Vec2, rot: number, sc: number, text: string | null = null, color: number | null = null): DimensionEntity =>
  makeEntity({ type: "dimension", kind: "linear", p1, p2, loc, rot, textOverride: text, dimScale: sc, assoc: null }, "COTAS", { color }) as DimensionEntity;

export interface TrayFlatOptions {
  origin?: Vec2;
  dims?: boolean;
  notes?: boolean;
  bendRegions?: boolean;
  title?: string;
  markHeight?: number;
}

/** Normal (na chapa) que aponta da borda para o fundo. */
const INWARD: Record<TraySide, Vec2> = { S: { x: 0, y: 1 }, N: { x: 0, y: -1 }, O: { x: 1, y: 0 }, L: { x: -1, y: 0 } };

/** Planificação: contorno de corte com recortes de canto, linhas de dobra, regiões, marcação e cotas. */
export function trayFlatEntities(r: TrayResult, o: TrayFlatOptions = {}): Entity[] {
  if (!r.ok) return [];
  const O = o.origin ?? { x: 0, y: 0 };
  const mv = (p: Vec2): Vec2 => ({ x: O.x + p.x, y: O.y + p.y });
  const { w: W, h: H } = r.blank;
  const sc = autoDimScale(Math.max(W, H));
  const out: Entity[] = [makeEntity({ type: "polyline", pts: r.contour.map(mv), bulges: r.bulges.slice(), closed: true }, "CONTORNO_CORTE")];
  for (const b of r.bends) {
    out.push(makeEntity({ type: "line", a: mv(b.line[0]), b: mv(b.line[1]) }, "LINHAS_DOBRA"));
    if (o.bendRegions ?? true) for (const q of [b.start, b.end]) out.push(makeEntity({ type: "line", a: mv(q[0]), b: mv(q[1]) }, "REGIAO_DOBRA"));
  }
  if (o.notes ?? true) {
    const R = r.input.R;
    const mh1 = Math.min(o.markHeight ?? 5, r.base.a / 30, r.base.b / 30);
    for (const b of r.bends) {
      const side = r.sides.find((s) => s.side === b.side)!;
      const mh = b.kind === "aba" ? mh1 : Math.min(o.markHeight ?? 5, side.flat / 1.8);
      if (mh < 0.5) continue;
      const value = `D${b.n} ${b.sense} ${fmtMM(b.thetaDeg, 1)}° RI${fmtMM(R)}`;
      // texto legível (0° ou 90°), do lado de dentro da linha (fundo / aba), a 10 mm do início da linha
      const dir = b.side === "S" || b.side === "N" ? 0 : Math.PI / 2;
      const u = { x: Math.cos(dir), y: Math.sin(dir) };
      const up = { x: -u.y, y: u.x };
      const nIn = INWARD[b.side];
      const k = b.BA / 2 + mh * 0.6 + (up.x * nIn.x + up.y * nIn.y > 0 ? 0 : mh);
      const [q0, q1] = b.line;
      const st = q0.x * u.x + q0.y * u.y <= q1.x * u.x + q1.y * u.y ? q0 : q1;
      const p0 = { x: st.x + u.x * 10 + nIn.x * k, y: st.y + u.y * 10 + nIn.y * k };
      out.push(makeEntity({ type: "text", p: mv(p0), h: mh, rot: dir, value, halign: 0 }, "MARCACAO"));
    }
    if (o.title) out.push(makeEntity({ type: "text", p: mv({ x: 0, y: -2.5 * sc * 6 - 8 * sc }), h: 3 * sc, rot: 0, value: o.title, halign: 0 }, "ANOTACOES"));
  }
  if (o.dims ?? true) {
    const g = 8 * sc;
    const P = (x: number, y: number) => mv({ x, y });
    out.push(dim(P(0, 0), P(W, 0), P(0, -g * 2), 0, sc));
    out.push(dim(P(W, 0), P(W, H), P(W + g * 2, 0), Math.PI / 2, sc));
    const uniq = (v: number[]) => v.sort((p, q) => p - q).filter((x, i, s) => i === 0 || x - s[i - 1] > 1e-6);
    const xs = uniq([0, ...r.bends.filter((b) => b.side === "O" || b.side === "L").map((b) => b.line[0].x), W]);
    const ys = uniq([0, ...r.bends.filter((b) => b.side === "S" || b.side === "N").map((b) => b.line[0].y), H]);
    if (xs.length > 2) for (let i = 0; i + 1 < xs.length; i++) out.push(dim(P(xs[i], 0), P(xs[i + 1], 0), P(0, -g), 0, sc));
    if (ys.length > 2) for (let i = 0; i + 1 < ys.length; i++) out.push(dim(P(W, ys[i]), P(W, ys[i + 1]), P(W + g, 0), Math.PI / 2, sc));
  }
  return out;
}

/**
 * Vista da bandeja dobrada: planta (projeção de abas e pestanas, mostra o canto) e, abaixo, as seções ao
 * longo de A e de B desenhadas pelo motor de perfis (com cotas EXT/INT).
 */
export function trayViewEntities(r: TrayResult): Entity[] {
  if (!r.ok) return [];
  const A = r.Aext, B = r.Bext;
  const sc = autoDimScale(Math.max(A, B) * 1.4);
  const g = 8 * sc;
  const out: Entity[] = [];
  for (const p of r.plan) out.push(makeEntity({ type: "polyline", pts: p.poly, bulges: p.poly.map(() => 0), closed: true }, "SECAO_PERFIL"));
  const has = (s: TraySide) => r.sides.some((x) => x.side === s);
  const x0 = has("O") ? r.OSB : 0, x1 = has("L") ? A - r.OSB : A;
  const y0 = has("S") ? r.OSB : 0, y1 = has("N") ? B - r.OSB : B;
  out.push(
    makeEntity(
      { type: "polyline", pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], bulges: [0, 0, 0, 0], closed: true },
      "REGIAO_DOBRA",
      { linetype: "HIDDEN" },
    ),
  );
  out.push(dim({ x: 0, y: 0 }, { x: A, y: 0 }, { x: 0, y: -g }, 0, sc, "<> EXT", 4));
  out.push(dim({ x: 0, y: 0 }, { x: 0, y: B }, { x: -g, y: 0 }, Math.PI / 2, sc, "<> EXT", 4));
  const lab = (p: Vec2, v: string) => out.push(makeEntity({ type: "text", p, h: 2.5 * sc, rot: 0, value: v, halign: 1 }, "ANOTACOES"));
  lab({ x: A / 2, y: B / 2 }, `PLANTA — CANTO ${TRAY_CORNER_LABEL[r.input.corner].toUpperCase()}`);
  // seções abaixo da planta, lado a lado
  let x = 0;
  const yTop = -g * 3;
  for (const [res, name] of [
    [r.sections.X, "SEÇÃO AO LONGO DE A"],
    [r.sections.Y, "SEÇÃO AO LONGO DE B"],
  ] as const) {
    if (!res?.ok) continue;
    const ents = sectionEntities(res, { dimScale: sc, neutral: false });
    const bx = ents.map(entityBox).reduce((p, q) => ({ minX: Math.min(p.minX, q.minX), minY: Math.min(p.minY, q.minY), maxX: Math.max(p.maxX, q.maxX), maxY: Math.max(p.maxY, q.maxY) }));
    const m = translation(x - bx.minX, yTop - bx.maxY);
    for (const e of ents) out.push(transformEntity(e, m));
    lab({ x: x + (bx.maxX - bx.minX) / 2, y: yTop - (bx.maxY - bx.minY) - g * 1.5 }, name);
    x += bx.maxX - bx.minX + g * 3;
  }
  return out;
}
