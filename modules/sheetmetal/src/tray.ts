import { type DimensionEntity, type Entity, type Vec2, makeEntity } from "@agtn/geometry";
import type { Issue } from "./engine";
import { autoDimScale, fmtMM } from "./output";

/**
 * BANDEJA — caixa aberta com abas de 90° nas bordas do fundo, planificada com o recorte de canto pronto.
 *
 *   BA = (π/2)·(R + K·T)      recuo s = R + T (da face externa ao início da dobra)
 *   fundo plano  a = A − Σ recuos (O, L)      b = B − Σ recuos (S, N)
 *   reto da aba  f = H − s                    (H externa; interna → H + T)
 *
 * Fundo no plano XY: A = comprimento (X), B = largura (Y).
 * Abas: S (inferior) e N (superior) ficam nas bordas do lado A; O (esquerda) e L (direita) nas bordas do lado B.
 *
 * Canto (onde duas abas se encontram) — as abas que "fecham" o canto (lado A ou lado B) avançam além da borda do
 * fundo; as outras param na borda:
 *   - sobreposto: avança s − folga (chega à face externa da vizinha — cobre a ponta dela);
 *   - encosto:    avança R − folga (chega à face interna da vizinha — fica entre as duas);
 *   - aberto:     ninguém avança (canto aberto).
 * O avanço não entra na região de dobra (a dobra vai só de borda a borda do fundo): o recorte avanço × BA no canto
 * é o alívio da dobra, gerado automaticamente.
 */
export type TraySide = "S" | "N" | "O" | "L";
export type TrayCorner = "sobreposto" | "encosto" | "aberto";

export const TRAY_SIDES: readonly TraySide[] = ["S", "N", "O", "L"];
export const TRAY_SIDE_LABEL: Record<TraySide, string> = {
  S: "Aba inferior (A)",
  N: "Aba superior (A)",
  O: "Aba esquerda (B)",
  L: "Aba direita (B)",
};
export const TRAY_CORNER_LABEL: Record<TrayCorner, string> = {
  sobreposto: "Sobreposto",
  encosto: "Encosto",
  aberto: "Aberto",
};

export interface TrayInput {
  /** Comprimento (X), mm */
  A: number;
  /** Largura (Y), mm */
  B: number;
  /** Altura de cada aba (0 = borda sem aba) */
  flanges: Record<TraySide, number>;
  /** Referência de A, B e alturas */
  ref: "externa" | "interna";
  T: number;
  /** Raio interno */
  R: number;
  K: number;
  corner: TrayCorner;
  /** Abas que fecham o canto: as do lado A (S/N) ou as do lado B (O/L) */
  overlap: "A" | "B";
  /** Folga de solda descontada do avanço no canto (mm) */
  gap: number;
}

export interface TrayBend {
  side: TraySide;
  /** Número da dobra na ordem sugerida (1…) */
  n: number;
  /** Linha de dobra (centro da região de dobra) */
  line: [Vec2, Vec2];
  /** Limites da região de dobra (tangências): lado do fundo e lado da aba */
  start: [Vec2, Vec2];
  end: [Vec2, Vec2];
  /** Altura externa / interna da aba e reto da aba */
  heightExt: number;
  heightInt: number;
  flat: number;
  /** Avanço da aba no canto, em cada ponta */
  ext: [number, number];
}

export interface TrayResult {
  ok: boolean;
  issues: Issue[];
  input: TrayInput;
  BA: number;
  OSB: number;
  BD: number;
  /** Medidas externas equivalentes */
  Aext: number;
  Bext: number;
  /** Fundo plano (entre tangências) */
  base: { a: number; b: number };
  /** Contorno de corte, anti-horário, origem no canto inferior esquerdo da chapa */
  contour: Vec2[];
  bends: TrayBend[];
  /** Retângulo envolvente da chapa planificada */
  blank: { w: number; h: number };
  /** Área líquida (mm²) e comprimento de corte (mm) */
  area: number;
  cutLength: number;
  /** Ordem de dobra sugerida */
  order: TraySide[];
}

const EPS = 1e-9;
type Rect = readonly [number, number, number, number];

export function solveTray(inp: TrayInput): TrayResult {
  const issues: Issue[] = [];
  const err = (code: string, message: string) => issues.push({ level: "error", code, message });
  const warn = (code: string, message: string) => issues.push({ level: "warning", code, message });
  const fin = Number.isFinite;
  const { A, B, T, R, K } = inp;
  const has = (s: TraySide) => fin(inp.flanges[s]) && inp.flanges[s] > EPS;

  if (!fin(A) || A <= 0) err("A", "Comprimento A deve ser maior que zero.");
  if (!fin(B) || B <= 0) err("B", "Largura B deve ser maior que zero.");
  if (!fin(T) || T <= 0) err("T", "Espessura deve ser maior que zero.");
  if (!fin(R) || R < 0) err("R", "Raio interno não pode ser negativo.");
  if (!fin(K) || K < 0 || K > 1) err("K", "Fator K deve estar entre 0 e 1.");
  if (!fin(inp.gap) || inp.gap < 0) err("GAP", "Folga não pode ser negativa.");
  for (const s of TRAY_SIDES) if (!fin(inp.flanges[s]) || inp.flanges[s] < 0) err("H", `${TRAY_SIDE_LABEL[s]}: altura inválida.`);
  if (!TRAY_SIDES.some(has)) err("NONE", "Informe ao menos uma aba.");

  const BA = (Math.PI / 2) * (R + K * T);
  const s = R + T;
  const OSB = s;
  const BD = 2 * OSB - BA;
  const ext = inp.ref === "externa";
  const nX = (has("O") ? 1 : 0) + (has("L") ? 1 : 0);
  const nY = (has("S") ? 1 : 0) + (has("N") ? 1 : 0);
  const Aext = ext ? A : A + nX * T;
  const Bext = ext ? B : B + nY * T;
  const a = Aext - nX * s;
  const b = Bext - nY * s;
  const hExt: Record<TraySide, number> = { S: 0, N: 0, O: 0, L: 0 };
  const flat: Record<TraySide, number> = { S: 0, N: 0, O: 0, L: 0 };
  for (const sd of TRAY_SIDES) {
    if (!has(sd)) continue;
    hExt[sd] = ext ? inp.flanges[sd] : inp.flanges[sd] + T;
    flat[sd] = hExt[sd] - s;
    if (fin(flat[sd]) && flat[sd] <= EPS && fin(s))
      err("H_MIN", `${TRAY_SIDE_LABEL[sd]}: altura ${fmtMM(inp.flanges[sd])} não passa do raio — mínimo ${fmtMM(ext ? s : R)} (${ext ? "R + T" : "R"}).`);
  }
  if (!issues.some((i) => i.level === "error") && (a <= EPS || b <= EPS)) err("BASE", "Fundo resultante menor ou igual a zero: confira A, B e o raio.");

  const covers = (sd: TraySide) => (inp.overlap === "A" ? sd === "S" || sd === "N" : sd === "O" || sd === "L");
  const reach = inp.corner === "sobreposto" ? s : inp.corner === "encosto" ? R : 0;
  const adv = (sd: TraySide, nb: TraySide): number => (has(sd) && has(nb) && covers(sd) && inp.corner !== "aberto" ? Math.max(0, reach - inp.gap) : 0);
  const ok0 = !issues.some((i) => i.level === "error");
  if (ok0 && inp.corner !== "aberto" && inp.gap > reach + EPS)
    warn("GAP_BIG", `Folga ${fmtMM(inp.gap)} maior que o avanço do canto (${fmtMM(reach)}): as abas não avançam.`);
  if (ok0 && R / T < 0.5) warn("R_SMALL", `Raio interno ${fmtMM(R)} pequeno para a espessura (R/T = ${fmtMM(R / T, 2)}): risco de trinca no canto.`);
  if (ok0 && (K < 0.2 || K > 0.5)) warn("K_UNUSUAL", `K = ${K} está fora da faixa usual (0,20–0,50).`);
  if (ok0 && inp.corner !== "aberto" && TRAY_SIDES.filter(has).length > 1 && !TRAY_SIDES.some((sd) => has(sd) && covers(sd)))
    warn("NO_COVER", `Nenhuma aba do lado ${inp.overlap} para fechar o canto: canto fica aberto.`);

  const order: TraySide[] = inp.corner === "aberto" ? TRAY_SIDES.filter(has) : [...TRAY_SIDES.filter((x) => has(x) && !covers(x)), ...TRAY_SIDES.filter((x) => has(x) && covers(x))];

  const empty: TrayResult = {
    ok: false, issues, input: inp, BA, OSB, BD, Aext, Bext, base: { a, b }, contour: [], bends: [], blank: { w: 0, h: 0 }, area: 0, cutLength: 0, order,
  };
  if (issues.some((i) => i.level === "error")) return empty;

  // Retângulos (coordenadas com o fundo em [0,a]×[0,b]).
  const rects: Rect[] = [[0, 0, a, b]];
  const raw: { side: TraySide; line: [Vec2, Vec2]; start: [Vec2, Vec2]; end: [Vec2, Vec2]; ext: [number, number] }[] = [];
  const V = (x: number, y: number): Vec2 => ({ x, y });
  if (has("S")) {
    const e: [number, number] = [adv("S", "O"), adv("S", "L")];
    rects.push([0, -BA, a, 0], [-e[0], -BA - flat.S, a + e[1], -BA]);
    raw.push({ side: "S", line: [V(0, -BA / 2), V(a, -BA / 2)], start: [V(0, 0), V(a, 0)], end: [V(0, -BA), V(a, -BA)], ext: e });
  }
  if (has("N")) {
    const e: [number, number] = [adv("N", "O"), adv("N", "L")];
    rects.push([0, b, a, b + BA], [-e[0], b + BA, a + e[1], b + BA + flat.N]);
    raw.push({ side: "N", line: [V(0, b + BA / 2), V(a, b + BA / 2)], start: [V(0, b), V(a, b)], end: [V(0, b + BA), V(a, b + BA)], ext: e });
  }
  if (has("O")) {
    const e: [number, number] = [adv("O", "S"), adv("O", "N")];
    rects.push([-BA, 0, 0, b], [-BA - flat.O, -e[0], -BA, b + e[1]]);
    raw.push({ side: "O", line: [V(-BA / 2, 0), V(-BA / 2, b)], start: [V(0, 0), V(0, b)], end: [V(-BA, 0), V(-BA, b)], ext: e });
  }
  if (has("L")) {
    const e: [number, number] = [adv("L", "S"), adv("L", "N")];
    rects.push([a, 0, a + BA, b], [a + BA, -e[0], a + BA + flat.L, b + e[1]]);
    raw.push({ side: "L", line: [V(a + BA / 2, 0), V(a + BA / 2, b)], start: [V(a, 0), V(a, b)], end: [V(a + BA, 0), V(a + BA, b)], ext: e });
  }
  // Avanço maior que a aba vizinha cruza a outra aba na chapa plana.
  for (const r of raw)
    for (const [k, nb] of (r.side === "S" || r.side === "N" ? (["O", "L"] as const) : (["S", "N"] as const)).entries())
      if (r.ext[k] > BA + flat[nb] + EPS) warn("ADV_BIG", `${TRAY_SIDE_LABEL[r.side]}: avanço no canto maior que a ${TRAY_SIDE_LABEL[nb].toLowerCase()}.`);

  const c0 = rectUnionOutline(rects);
  let mx = Infinity, my = Infinity, Mx = -Infinity, My = -Infinity;
  for (const p of c0) {
    mx = Math.min(mx, p.x); my = Math.min(my, p.y);
    Mx = Math.max(Mx, p.x); My = Math.max(My, p.y);
  }
  const sh = (p: Vec2): Vec2 => ({ x: p.x - mx, y: p.y - my });
  const pair = (q: [Vec2, Vec2]): [Vec2, Vec2] => [sh(q[0]), sh(q[1])];
  const contour = c0.map(sh);
  const bends: TrayBend[] = order.map((sd, i) => {
    const r = raw.find((x) => x.side === sd)!;
    return { side: sd, n: i + 1, line: pair(r.line), start: pair(r.start), end: pair(r.end), heightExt: hExt[sd], heightInt: hExt[sd] - T, flat: flat[sd], ext: r.ext };
  });
  let area = 0, per = 0;
  for (let i = 0; i < contour.length; i++) {
    const p = contour[i], q = contour[(i + 1) % contour.length];
    area += p.x * q.y - q.x * p.y;
    per += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return { ...empty, ok: true, contour, bends, blank: { w: Mx - mx, h: My - my }, area: Math.abs(area) / 2, cutLength: per };
}

/**
 * União de retângulos alinhados aos eixos → contorno externo anti-horário, sem vértices colineares.
 * Grade das coordenadas únicas; arestas de borda orientadas com o interior à esquerda.
 */
export function rectUnionOutline(rects: readonly Rect[]): Vec2[] {
  const uniq = (v: number[]) => {
    v.sort((p, q) => p - q);
    const o: number[] = [];
    for (const x of v) if (!o.length || x - o[o.length - 1] > 1e-7) o.push(x);
    return o;
  };
  const xs = uniq(rects.flatMap((r) => [r[0], r[2]]));
  const ys = uniq(rects.flatMap((r) => [r[1], r[3]]));
  const nx = xs.length - 1, ny = ys.length - 1;
  if (nx < 1 || ny < 1) return [];
  const cov = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const cy = (ys[j] + ys[j + 1]) / 2;
    for (let i = 0; i < nx; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      cov[j * nx + i] = rects.some((r) => cx > r[0] && cx < r[2] && cy > r[1] && cy < r[3]) ? 1 : 0;
    }
  }
  const cell = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && cov[j * nx + i] === 1;
  const next = new Map<number, number>();
  const key = (i: number, j: number) => j * (nx + 1) + i;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (!cell(i, j)) continue;
      if (!cell(i, j - 1)) next.set(key(i, j), key(i + 1, j));
      if (!cell(i + 1, j)) next.set(key(i + 1, j), key(i + 1, j + 1));
      if (!cell(i, j + 1)) next.set(key(i + 1, j + 1), key(i, j + 1));
      if (!cell(i - 1, j)) next.set(key(i, j + 1), key(i, j));
    }
  if (!next.size) return [];
  // laço externo: começa no vértice mais à esquerda e mais baixo
  let start = Infinity;
  for (const k of next.keys()) {
    const i = k % (nx + 1), j = Math.floor(k / (nx + 1));
    const si = start % (nx + 1), sj = Math.floor(start / (nx + 1));
    if (start === Infinity || i < si || (i === si && j < sj)) start = k;
  }
  const loop: number[] = [];
  let cur = start;
  let guard = next.size + 1;
  do {
    loop.push(cur);
    const n = next.get(cur);
    if (n === undefined) throw new Error("rectUnionOutline: contorno aberto");
    cur = n;
  } while (cur !== start && --guard > 0);
  const P = (k: number) => [k % (nx + 1), Math.floor(k / (nx + 1))] as const;
  const out: Vec2[] = [];
  for (let m = 0; m < loop.length; m++) {
    const [pi, pj] = P(loop[(m + loop.length - 1) % loop.length]);
    const [ci, cj] = P(loop[m]);
    const [qi, qj] = P(loop[(m + 1) % loop.length]);
    if ((pi === ci && ci === qi) || (pj === cj && cj === qj)) continue;
    out.push({ x: xs[ci], y: ys[cj] });
  }
  return out;
}

/* ----------------------------------------------------------------------------------------------- */
/*                                        Saída (entidades)                                         */
/* ----------------------------------------------------------------------------------------------- */

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

/** Planificação: contorno de corte com recortes de canto, linhas de dobra, regiões, marcação e cotas. */
export function trayFlatEntities(r: TrayResult, o: TrayFlatOptions = {}): Entity[] {
  if (!r.ok) return [];
  const O = o.origin ?? { x: 0, y: 0 };
  const mv = (p: Vec2): Vec2 => ({ x: O.x + p.x, y: O.y + p.y });
  const P = (x: number, y: number): Vec2 => mv({ x, y });
  const { w: W, h: H } = r.blank;
  const sc = autoDimScale(Math.max(W, H));
  const out: Entity[] = [
    makeEntity({ type: "polyline", pts: r.contour.map(mv), bulges: r.contour.map(() => 0), closed: true }, "CONTORNO_CORTE"),
  ];
  for (const b of r.bends) {
    out.push(makeEntity({ type: "line", a: mv(b.line[0]), b: mv(b.line[1]) }, "LINHAS_DOBRA"));
    if (o.bendRegions ?? true)
      for (const q of [b.start, b.end]) out.push(makeEntity({ type: "line", a: mv(q[0]), b: mv(q[1]) }, "REGIAO_DOBRA"));
  }
  if (o.notes ?? true) {
    const mh = Math.min(o.markHeight ?? 5, r.base.a / 30, r.base.b / 30);
    const R = r.input.R;
    for (const b of r.bends) {
      const value = `D${b.n} CIMA 90,0° RI${fmtMM(R)}`;
      const [p, q] = b.line;
      const horiz = Math.abs(p.y - q.y) < 1e-9;
      const half = r.BA / 2;
      // texto no fundo, junto à linha de dobra, a partir de 10 mm do início
      if (horiz) {
        const up = b.side === "S";
        const y = up ? p.y + half + mh * 0.6 : p.y - half - mh * 1.6;
        out.push(makeEntity({ type: "text", p: P(p.x + 10, y), h: mh, rot: 0, value, halign: 0 }, "MARCACAO"));
      } else {
        const right = b.side === "O";
        const x = right ? p.x + half + mh * 1.6 : p.x - half - mh * 0.6;
        out.push(makeEntity({ type: "text", p: P(x, p.y + 10), h: mh, rot: Math.PI / 2, value, halign: 0 }, "MARCACAO"));
      }
    }
    if (o.title) out.push(makeEntity({ type: "text", p: P(0, -2.5 * sc * 6 - 8 * sc), h: 3 * sc, rot: 0, value: o.title, halign: 0 }, "ANOTACOES"));
  }
  if (o.dims ?? true) {
    const g = 8 * sc;
    out.push(dim(P(0, 0), P(W, 0), P(0, -g * 2), 0, sc));
    out.push(dim(P(W, 0), P(W, H), P(W + g * 2, 0), Math.PI / 2, sc));
    // cadeias entre bordas e linhas de dobra (batente da dobradeira)
    const xs = [0, ...r.bends.filter((b) => b.side === "O" || b.side === "L").map((b) => b.line[0].x), W].sort((p, q) => p - q);
    const ys = [0, ...r.bends.filter((b) => b.side === "S" || b.side === "N").map((b) => b.line[0].y), H].sort((p, q) => p - q);
    if (xs.length > 2) for (let i = 0; i + 1 < xs.length; i++) out.push(dim(P(xs[i], 0), P(xs[i + 1], 0), P(0, -g), 0, sc));
    if (ys.length > 2) for (let i = 0; i + 1 < ys.length; i++) out.push(dim(P(W, ys[i]), P(W, ys[i + 1]), P(W + g, 0), Math.PI / 2, sc));
  }
  return out;
}

/** Seção de um "U" (ou L / chapa) com raios: abas esquerda/direita de altura externa hl/hr (0 = sem aba). */
function uSection(len: number, hl: number, hr: number, T: number, R: number, O: Vec2): Entity {
  const s = R + T;
  const q = Math.tan(Math.PI / 8);
  const pts: Vec2[] = [];
  const bul: number[] = [];
  const v = (x: number, y: number, bulge = 0) => {
    pts.push({ x: O.x + x, y: O.y + y });
    bul.push(bulge);
  };
  // face externa, da ponta da aba esquerda até a ponta da direita
  if (hl > 0) {
    v(0, hl);
    if (R + T > 0) v(0, s, q);
    v(s, 0);
  } else v(0, 0);
  if (hr > 0) {
    v(len - s, 0, q);
    v(len, s);
    v(len, hr);
    v(len - T, hr);
    v(len - T, s, -q);
    v(len - s, T);
  } else {
    v(len, 0);
    v(len, T);
  }
  if (hl > 0) {
    v(s, T, -q);
    v(T, s);
    v(T, hl);
  } else v(0, T);
  // remove pontos coincidentes (R = 0 gera arcos nulos na face interna)
  const P: Vec2[] = [], B: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const n = pts[(i + 1) % pts.length];
    if (Math.hypot(n.x - pts[i].x, n.y - pts[i].y) < 1e-9) continue;
    P.push(pts[i]);
    B.push(bul[i]);
  }
  return makeEntity({ type: "polyline", pts: P, bulges: B, closed: true }, "SECAO_PERFIL");
}

/**
 * Vista da bandeja dobrada: planta (paredes e região de dobra, mostrando o tipo de canto),
 * seção ao longo de A (abaixo) e seção ao longo de B (à direita), com cotas externas.
 */
export function trayViewEntities(r: TrayResult): Entity[] {
  if (!r.ok) return [];
  const { T, R } = r.input;
  const s = R + T;
  const A = r.Aext, B = r.Bext;
  const h = (sd: TraySide) => r.bends.find((b) => b.side === sd)?.heightExt ?? 0;
  const e = (sd: TraySide) => r.bends.find((b) => b.side === sd)?.ext ?? [0, 0];
  const has = (sd: TraySide) => h(sd) > 0;
  const sc = autoDimScale(Math.max(A, B) * 1.4);
  const g = 8 * sc;
  const out: Entity[] = [];
  const rect = (x0: number, y0: number, x1: number, y1: number, layer: string, linetype?: string) =>
    out.push(
      makeEntity(
        { type: "polyline", pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], bulges: [0, 0, 0, 0], closed: true },
        layer,
        linetype ? { linetype } : undefined,
      ),
    );
  // planta: paredes (espessura T) com o comprimento real de cada aba
  const x0 = has("O") ? s : 0, x1 = has("L") ? A - s : A;
  const y0 = has("S") ? s : 0, y1 = has("N") ? B - s : B;
  if (has("S")) rect(x0 - e("S")[0], 0, x1 + e("S")[1], T, "SECAO_PERFIL");
  if (has("N")) rect(x0 - e("N")[0], B - T, x1 + e("N")[1], B, "SECAO_PERFIL");
  if (has("O")) rect(0, y0 - e("O")[0], T, y1 + e("O")[1], "SECAO_PERFIL");
  if (has("L")) rect(A - T, y0 - e("L")[0], A, y1 + e("L")[1], "SECAO_PERFIL");
  rect(x0, y0, x1, y1, "REGIAO_DOBRA", "HIDDEN");
  out.push(dim({ x: 0, y: 0 }, { x: A, y: 0 }, { x: 0, y: -g }, 0, sc, "<> EXT", 4));
  out.push(dim({ x: 0, y: 0 }, { x: 0, y: B }, { x: -g, y: 0 }, Math.PI / 2, sc, "<> EXT", 4));
  const lab = (p: Vec2, v: string) => out.push(makeEntity({ type: "text", p, h: 2.5 * sc, rot: 0, value: v, halign: 1 }, "ANOTACOES"));
  lab({ x: A / 2, y: B / 2 }, `PLANTA — CANTO ${TRAY_CORNER_LABEL[r.input.corner].toUpperCase()}`);

  // seção ao longo de A (abas O e L), abaixo da planta
  const hA = Math.max(h("O"), h("L"), T);
  const oA = { x: 0, y: -g * 3 - hA };
  out.push(uSection(A, h("O"), h("L"), T, R, oA));
  lab({ x: A / 2, y: oA.y - g * 2.4 }, "SEÇÃO AO LONGO DE A");
  for (const [sd, x, side] of [["O", 0, -1], ["L", A, 1]] as const)
    if (has(sd)) out.push(dim({ x, y: oA.y }, { x, y: oA.y + h(sd) }, { x: x + side * g, y: oA.y }, Math.PI / 2, sc, "<> EXT", 4));

  // seção ao longo de B (abas S e N), à direita da planta, desenhada em pé
  const hB = Math.max(h("S"), h("N"), T);
  const sec = uSection(B, h("S"), h("N"), T, R, { x: 0, y: 0 });
  const ox = A + g * 3 + hB;
  if (sec.type === "polyline") {
    // gira 90° (x,y) → (ox − y, x): a base fica vertical, abas para a esquerda
    out.push(makeEntity({ type: "polyline", pts: sec.pts.map((p) => ({ x: ox - p.y, y: p.x })), bulges: sec.bulges.slice(), closed: true }, "SECAO_PERFIL"));
  }
  lab({ x: ox - hB / 2, y: B + g * 2.4 }, "SEÇÃO AO LONGO DE B");
  for (const [sd, y, side] of [["S", 0, -1], ["N", B, 1]] as const)
    if (has(sd)) out.push(dim({ x: ox, y }, { x: ox - h(sd), y }, { x: ox, y: y + side * g }, 0, sc, "<> EXT", 4));
  return out;
}
