import { TAU, ccwSweep, normAngle } from "./angle";
import { type Vec2, add, cross, dist, dot, len, mul, perpL, sub } from "./vec";

/**
 * Curvas "modernas" do DXF/DWG: elipse, spline (NURBS) e hachura.
 *
 * Todas são guardadas com a definição exata (como no DXF) e aproximadas por pontos apenas para
 * desenhar, medir, selecionar e capturar (snap). A aproximação usa tolerância de corda relativa ao
 * tamanho da curva, o que mantém o erro abaixo de 0,05 % do raio em qualquer zoom.
 */

// ---------------------------------------------------------------------------------------------
// Elipse
// ---------------------------------------------------------------------------------------------

/** Elipse ou arco elíptico: P(t) = c + major·cos t + minor·sin t, minor = perpL(major)·ratio. */
export interface EllipseGeom {
  readonly c: Vec2;
  /** Vetor do centro até a extremidade do eixo maior. */
  readonly major: Vec2;
  /** Eixo menor / eixo maior, (0, 1]. */
  readonly ratio: number;
  /** Parâmetros inicial e final (rad), percorridos no sentido anti-horário. t0 = 0, t1 = 2π = elipse completa. */
  readonly t0: number;
  readonly t1: number;
}

export const isFullEllipse = (e: Pick<EllipseGeom, "t0" | "t1">): boolean => Math.abs(e.t1 - e.t0) >= TAU - 1e-9;

export function ellipseSweep(e: Pick<EllipseGeom, "t0" | "t1">): number {
  return isFullEllipse(e) ? TAU : ccwSweep(e.t0, e.t1);
}

export const ellipseMinor = (e: Pick<EllipseGeom, "major" | "ratio">): Vec2 => mul(perpL(e.major), e.ratio);

export function ellipsePoint(e: EllipseGeom, t: number): Vec2 {
  const mn = ellipseMinor(e);
  const ct = Math.cos(t);
  const st = Math.sin(t);
  return { x: e.c.x + e.major.x * ct + mn.x * st, y: e.c.y + e.major.y * ct + mn.y * st };
}

/** Pontos da elipse com erro de corda ≤ `relTol`·eixo maior. */
export function ellipsePoints(e: EllipseGeom, relTol = 5e-5): Vec2[] {
  const sweep = ellipseSweep(e);
  const step = 2 * Math.sqrt(2 * relTol);
  const n = Math.max(8, Math.min(2048, Math.ceil(sweep / step)));
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) out.push(ellipsePoint(e, e.t0 + (sweep * i) / n));
  if (isFullEllipse(e)) out[n] = out[0];
  return out;
}

/**
 * Elipse a partir de dois semidiâmetros conjugados quaisquer: P(t) = c + p·cos t + q·sin t.
 * Converte para eixos principais e reajusta os parâmetros. É o que permite aplicar QUALQUER
 * transformação afim (inclusive escala não uniforme de blocos) a círculos, arcos e elipses.
 */
export function ellipseFromConjugate(c: Vec2, p: Vec2, q: Vec2, t0: number, t1: number): EllipseGeom | null {
  const full = Math.abs(t1 - t0) >= TAU - 1e-9;
  const sweep = full ? TAU : ccwSweep(t0, t1);
  const pq = dot(p, q);
  const pp = dot(p, p);
  const qq = dot(q, q);
  const ts = 0.5 * Math.atan2(2 * pq, pp - qq);
  // P(t) = c + A cos(t − ts) + B sin(t − ts)
  let A = add(mul(p, Math.cos(ts)), mul(q, Math.sin(ts)));
  let B = add(mul(p, -Math.sin(ts)), mul(q, Math.cos(ts)));
  let shift = ts; // u = t − shift
  if (len(B) > len(A)) {
    // u = v + π/2 → A cos u + B sin u = B cos v − A sin v
    const nA = B;
    const nB = mul(A, -1);
    A = nA;
    B = nB;
    shift += Math.PI / 2;
  }
  const a = len(A);
  const b = len(B);
  if (!(a > 1e-12)) return null;
  const ratio = Math.min(1, b / a);
  if (cross(A, B) >= 0) {
    if (full) return { c, major: A, ratio, t0: 0, t1: TAU };
    const n0 = normAngle(t0 - shift);
    return { c, major: A, ratio, t0: n0, t1: normAngle(n0 + sweep) };
  }
  // orientação invertida (espelhamento): w = −u
  if (full) return { c, major: A, ratio, t0: 0, t1: TAU };
  const w1 = normAngle(-(t0 - shift));
  const w0 = normAngle(w1 - sweep);
  return { c, major: A, ratio, t0: w0, t1: normAngle(w0 + sweep) };
}

// ---------------------------------------------------------------------------------------------
// Spline (B-spline / NURBS)
// ---------------------------------------------------------------------------------------------

export interface SplineGeom {
  readonly degree: number;
  readonly ctrl: readonly Vec2[];
  readonly knots: readonly number[];
  /** Pesos racionais (NURBS). `null` = todos 1. */
  readonly weights: readonly number[] | null;
  readonly closed: boolean;
  /** Pontos de ajuste originais (só informativo). */
  readonly fit?: readonly Vec2[];
}

/** Vetor de nós uniforme "clamped" para n pontos de controle e grau p. */
export function clampedKnots(n: number, p: number): number[] {
  const m = n + p + 1;
  const out: number[] = [];
  const inner = n - p;
  for (let i = 0; i < m; i++) {
    if (i <= p) out.push(0);
    else if (i >= n) out.push(inner);
    else out.push(i - p);
  }
  return out;
}

export function splineValid(s: SplineGeom): boolean {
  const n = s.ctrl.length;
  const p = s.degree;
  if (!(p >= 1 && p <= 11) || n < p + 1) return false;
  if (s.knots.length !== n + p + 1) return false;
  for (let i = 1; i < s.knots.length; i++) if (!(s.knots[i] >= s.knots[i - 1])) return false;
  if (s.weights && (s.weights.length !== n || s.weights.some((w) => !(w > 0)))) return false;
  return s.knots[n] > s.knots[p];
}

function findSpan(n: number, p: number, u: number, U: readonly number[]): number {
  if (u >= U[n]) {
    let k = n - 1;
    while (k > p && U[k] >= U[n]) k--;
    return k;
  }
  if (u <= U[p]) {
    let k = p;
    while (k < n - 1 && U[k + 1] <= U[p]) k++;
    return k;
  }
  let lo = p;
  let hi = n;
  let mid = (lo + hi) >> 1;
  while (u < U[mid] || u >= U[mid + 1]) {
    if (u < U[mid]) hi = mid;
    else lo = mid;
    mid = (lo + hi) >> 1;
  }
  return mid;
}

/** Avalia o spline no parâmetro u (algoritmo de de Boor em coordenadas homogêneas). */
export function splinePoint(s: SplineGeom, u: number): Vec2 {
  const p = s.degree;
  const n = s.ctrl.length;
  const U = s.knots;
  const k = findSpan(n, p, u, U);
  const d: { x: number; y: number; w: number }[] = [];
  for (let j = 0; j <= p; j++) {
    const P = s.ctrl[j + k - p];
    const w = s.weights ? s.weights[j + k - p] : 1;
    d.push({ x: P.x * w, y: P.y * w, w });
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = j + k - p;
      const den = U[i + p - r + 1] - U[i];
      const a = den === 0 ? 0 : (u - U[i]) / den;
      d[j] = {
        x: (1 - a) * d[j - 1].x + a * d[j].x,
        y: (1 - a) * d[j - 1].y + a * d[j].y,
        w: (1 - a) * d[j - 1].w + a * d[j].w,
      };
    }
  }
  const r = d[p];
  return { x: r.x / r.w, y: r.y / r.w };
}

export const splineDomain = (s: SplineGeom): [number, number] => [s.knots[s.degree], s.knots[s.ctrl.length]];

/** Pontos do spline: amostragem por vão de nós, proporcional ao comprimento do polígono de controle. */
export function splinePoints(s: SplineGeom, segsPerSpan = 24): Vec2[] {
  if (!splineValid(s)) return s.ctrl.slice();
  const p = s.degree;
  const n = s.ctrl.length;
  const U = s.knots;
  const out: Vec2[] = [];
  if (p === 1 && !s.weights) {
    for (let i = 0; i < n; i++) out.push(s.ctrl[i]);
    return out;
  }
  for (let i = p; i < n; i++) {
    const a = U[i];
    const b = U[i + 1];
    if (!(b > a)) continue;
    let poly = 0;
    for (let j = i - p; j < i; j++) poly += dist(s.ctrl[j], s.ctrl[j + 1]);
    const k = Math.max(4, Math.min(256, Math.round(segsPerSpan * Math.min(4, 1 + poly / Math.max(1e-9, polyScale(s))))));
    for (let t = out.length ? 1 : 0; t <= k; t++) out.push(splinePoint(s, a + ((b - a) * t) / k));
  }
  return out;
}

function polyScale(s: SplineGeom): number {
  let total = 0;
  for (let i = 0; i + 1 < s.ctrl.length; i++) total += dist(s.ctrl[i], s.ctrl[i + 1]);
  return total / Math.max(1, s.ctrl.length - 1);
}

/**
 * Spline cúbico que passa pelos pontos dados, pelo mesmo método do AutoCAD/BricsCAD quando o
 * arquivo traz só pontos de ajuste: parametrização por corda, nós "naturais" (os próprios
 * parâmetros) e derivada segunda nula nas pontas (NURBS Book, eq. 3.9/3.10).
 */
export function interpolateSpline(fit: readonly Vec2[], _degree = 3): SplineGeom {
  const pts = fit.filter((q, i) => i === 0 || dist(q, fit[i - 1]) > 1e-12);
  const n = pts.length - 1;
  if (n < 1) return { degree: 1, ctrl: pts.slice(), knots: [0, 0, 1, 1].slice(0, pts.length + 2), weights: null, closed: false, fit };
  if (n === 1 || n > 800) return { degree: 1, ctrl: pts, knots: clampedKnots(pts.length, 1), weights: null, closed: false, fit };
  const p = 3;
  let total = 0;
  const t = [0];
  for (let i = 1; i <= n; i++) {
    total += dist(pts[i], pts[i - 1]);
    t.push(total);
  }
  for (let i = 0; i <= n; i++) t[i] /= total;
  t[n] = 1;
  const U = [0, 0, 0, 0, ...t.slice(1, n), 1, 1, 1, 1];
  const cnt = n + 3;
  const rows: number[][] = t.map((u) => basisRow(cnt, p, u, U));
  const up1 = U[p + 1];
  const up2 = U[p + 2];
  const f1 = (p * (p - 1)) / up1;
  const r1 = new Array<number>(cnt).fill(0);
  r1[0] = f1 / up1;
  r1[1] = (-f1 * (up1 + up2)) / (up1 * up2);
  r1[2] = f1 / up2;
  const m = U.length - 1;
  const ump1 = U[m - p - 1];
  const ump2 = U[m - p - 2];
  const f2 = (p * (p - 1)) / (1 - ump1);
  const r2 = new Array<number>(cnt).fill(0);
  r2[cnt - 3] = f2 / (1 - ump2);
  r2[cnt - 2] = (-f2 * (2 - ump1 - ump2)) / (1 - ump1) / (1 - ump2);
  r2[cnt - 1] = f2 / (1 - ump1);
  rows.splice(1, 0, r1);
  rows.splice(rows.length - 1, 0, r2);
  const rx = pts.map((q) => q.x);
  const ry = pts.map((q) => q.y);
  rx.splice(1, 0, 0);
  ry.splice(1, 0, 0);
  rx.splice(rx.length - 1, 0, 0);
  ry.splice(ry.length - 1, 0, 0);
  const sol = solve(rows, [rx, ry]);
  if (!sol) return { degree: 1, ctrl: pts, knots: clampedKnots(pts.length, 1), weights: null, closed: false, fit };
  return { degree: p, ctrl: sol[0].map((x, i) => ({ x, y: sol[1][i] })), knots: U, weights: null, closed: false, fit };
}

function basisRow(n: number, p: number, u: number, U: readonly number[]): number[] {
  const row = new Array<number>(n).fill(0);
  const k = findSpan(n, p, u, U);
  const N = new Array<number>(p + 1).fill(0);
  const left = new Array<number>(p + 1).fill(0);
  const right = new Array<number>(p + 1).fill(0);
  N[0] = 1;
  for (let j = 1; j <= p; j++) {
    left[j] = u - U[k + 1 - j];
    right[j] = U[k + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const den = right[r + 1] + left[j - r];
      const tmp = den === 0 ? 0 : N[r] / den;
      N[r] = saved + right[r + 1] * tmp;
      saved = left[j - r] * tmp;
    }
    N[j] = saved;
  }
  for (let j = 0; j <= p; j++) row[k - p + j] = N[j];
  return row;
}

/** Eliminação de Gauss com pivotamento parcial para várias colunas do lado direito. */
function solve(A0: number[][], rhs0: number[][]): number[][] | null {
  const n = A0.length;
  const A = A0.map((r) => r.slice());
  const rhs = rhs0.map((r) => r.slice());
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-14) return null;
    if (piv !== c) {
      [A[piv], A[c]] = [A[c], A[piv]];
      for (const b of rhs) [b[piv], b[c]] = [b[c], b[piv]];
    }
    for (let r = c + 1; r < n; r++) {
      const fct = A[r][c] / A[c][c];
      if (fct === 0) continue;
      for (let k = c; k < n; k++) A[r][k] -= fct * A[c][k];
      for (const b of rhs) b[r] -= fct * b[c];
    }
  }
  return rhs.map((b) => {
    const x = new Array<number>(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let s = b[r];
      for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
      x[r] = s / A[r][r];
    }
    return x;
  });
}

// ---------------------------------------------------------------------------------------------
// Hachura
// ---------------------------------------------------------------------------------------------

/** Contorno fechado de hachura (polilinha com bulges; arestas elípticas/spline já aproximadas). */
export interface HatchLoop {
  readonly pts: readonly Vec2[];
  readonly bulges: readonly number[];
}

/** Família de linhas do padrão, já em coordenadas do desenho (ângulo/escala aplicados). */
export interface HatchPatternLine {
  /** direção das linhas (rad) */
  readonly angle: number;
  /** ponto por onde passa a linha k = 0 */
  readonly base: Vec2;
  /** deslocamento de uma linha para a próxima */
  readonly offset: Vec2;
  /** traços: + traço, − espaço, 0 ponto. Vazio = linha contínua. */
  readonly dashes: readonly number[];
}

export interface HatchPatternDef {
  readonly name: string;
  readonly label: string;
  /** [ângulo°, x0, y0, dx, dy, ...traços] em mm (acadiso.pat) */
  readonly lines: readonly (readonly number[])[];
}

/** Padrões mais usados em desenho mecânico/caldeiraria (valores do acadiso.pat, em mm). */
export const HATCH_PATTERNS: readonly HatchPatternDef[] = [
  { name: "SOLID", label: "Sólido", lines: [] },
  { name: "ANSI31", label: "ANSI31 — aço / corte geral (45°)", lines: [[45, 0, 0, 0, 3.175]] },
  { name: "ANSI32", label: "ANSI32 — aço", lines: [[45, 0, 0, 0, 9.525], [45, 4.49013, 0, 0, 9.525]] },
  { name: "ANSI37", label: "ANSI37 — cruzada (chumbo/borracha)", lines: [[45, 0, 0, 0, 3.175], [135, 0, 0, 0, 3.175]] },
  { name: "ANSI33", label: "ANSI33 — bronze/latão", lines: [[45, 0, 0, 0, 6.35], [45, 4.49013, 0, 0, 6.35, 3.175, -1.5875]] },
  { name: "NET", label: "NET — grade", lines: [[0, 0, 0, 0, 3.175], [90, 0, 0, 0, 3.175]] },
  { name: "LINE", label: "LINE — linhas horizontais", lines: [[0, 0, 0, 0, 3.175]] },
  { name: "DASH", label: "DASH — tracejado", lines: [[0, 0, 0, 3.175, 3.175, 3.175, -3.175]] },
  { name: "STEEL", label: "STEEL — aço (linhas duplas)", lines: [[45, 0, 0, 0, 3.175], [45, 0, 1.5875, 0, 3.175]] },
];

export function hatchPatternByName(name: string): HatchPatternDef | undefined {
  const up = name.toUpperCase();
  return HATCH_PATTERNS.find((p) => p.name === up);
}

/** Converte a definição .pat em famílias de linhas no desenho, com ângulo (rad) e escala do padrão. */
export function patternLines(def: HatchPatternDef, angle: number, scale: number): HatchPatternLine[] {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const rot = (x: number, y: number, c: number, s: number): Vec2 => ({ x: x * c - y * s, y: x * s + y * c });
  return def.lines.map((l) => {
    const la = (l[0] * Math.PI) / 180 + angle;
    const base = rot(l[1] * scale, l[2] * scale, ca, sa);
    const offset = rot(l[3] * scale, l[4] * scale, Math.cos(la), Math.sin(la));
    return { angle: la, base, offset, dashes: l.slice(5).map((d) => d * scale) };
  });
}

/** Aproxima um contorno de hachura por polígono. */
export function hatchLoopPolygon(loop: HatchLoop): Vec2[] {
  const out: Vec2[] = [];
  const n = loop.pts.length;
  for (let i = 0; i < n; i++) {
    const a = loop.pts[i];
    const b = loop.pts[(i + 1) % n];
    out.push(a);
    const bulge = loop.bulges[i] ?? 0;
    if (Math.abs(bulge) > 1e-12) {
      const th = 4 * Math.atan(bulge);
      const c = dist(a, b);
      if (c < 1e-12) continue;
      const r = c / (2 * Math.abs(Math.sin(th / 2)));
      const k = Math.max(2, Math.min(256, Math.ceil(Math.abs(th) / (2 * Math.sqrt(2 * Math.min(0.5, 2e-4 * Math.max(1, r)) / Math.max(r, 1e-9))))));
      // centro do arco
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const d = { x: (b.x - a.x) / c, y: (b.y - a.y) / c };
      const off = (c / 2) * ((1 - bulge * bulge) / (2 * bulge));
      const ctr = add(m, mul(perpL(d), off));
      const a0 = Math.atan2(a.y - ctr.y, a.x - ctr.x);
      for (let j = 1; j < k; j++) {
        const t = a0 + (th * j) / k;
        out.push({ x: ctr.x + r * Math.cos(t), y: ctr.y + r * Math.sin(t) });
      }
    }
  }
  return out;
}

/** Área com sinal de um polígono. */
export function polygonArea(poly: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return a / 2;
}

function inPoly(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Ponto dentro da área hachurada (regra par-ímpar, como o AutoCAD no estilo "normal"). */
export function pointInHatch(p: Vec2, polys: readonly (readonly Vec2[])[]): boolean {
  let inside = false;
  for (const poly of polys) if (inPoly(p, poly)) inside = !inside;
  return inside;
}

/** Área exata (com sinal) de um contorno com arcos por bulge. */
export function loopArea(l: HatchLoop): number {
  let a = 0;
  const n = l.pts.length;
  for (let i = 0; i < n; i++) {
    const p = l.pts[i];
    const q = l.pts[(i + 1) % n];
    a += (p.x * q.y - q.x * p.y) / 2;
    const b = l.bulges[i] ?? 0;
    if (Math.abs(b) > 1e-12) {
      const c = dist(p, q);
      const th = 4 * Math.atan(Math.abs(b));
      const r = (c * (1 + b * b)) / (4 * Math.abs(b));
      a += Math.sign(b) * ((r * r) / 2) * (th - Math.sin(th));
    }
  }
  return a;
}

/**
 * Área líquida (contornos internos descontados pela regra par-ímpar).
 * Com `loops`, a área de cada contorno é exata (arcos incluídos); os polígonos só decidem o aninhamento.
 */
export function hatchArea(polys: readonly (readonly Vec2[])[], loops?: readonly HatchLoop[]): number {
  let total = 0;
  polys.forEach((poly, i) => {
    if (poly.length < 2) return;
    const probe = poly[0];
    let depth = 0;
    polys.forEach((other, j) => {
      if (i !== j && other.length >= 3 && inPoly(probe, other)) depth++;
    });
    const a = loops ? Math.abs(loopArea(loops[i])) : Math.abs(polygonArea(poly));
    total += (depth % 2 === 0 ? 1 : -1) * a;
  });
  return Math.max(0, total);
}

export interface PatternSegments {
  readonly segs: [Vec2, Vec2][];
  /** true quando o padrão é denso demais e foi limitado */
  readonly truncated: boolean;
}

/**
 * Gera os traços do padrão recortados pelos contornos (regra par-ímpar).
 * `maxSegs` limita o resultado (padrão minúsculo numa área enorme não trava o programa).
 */
export function hatchPatternSegments(
  polys: readonly (readonly Vec2[])[],
  lines: readonly HatchPatternLine[],
  maxSegs = 60000,
): PatternSegments {
  const segs: [Vec2, Vec2][] = [];
  let truncated = false;
  const edges: [Vec2, Vec2][] = [];
  for (const poly of polys) for (let i = 0; i < poly.length; i++) edges.push([poly[i], poly[(i + 1) % poly.length]]);
  if (!edges.length) return { segs, truncated };
  for (const fam of lines) {
    const d = { x: Math.cos(fam.angle), y: Math.sin(fam.angle) };
    const nrm = perpL(d);
    const h = dot(fam.offset, nrm);
    if (Math.abs(h) < 1e-9) continue;
    let kmin = Infinity;
    let kmax = -Infinity;
    for (const [a] of edges) {
      const k = dot(sub(a, fam.base), nrm) / h;
      if (k < kmin) kmin = k;
      if (k > kmax) kmax = k;
    }
    const k0 = Math.ceil(kmin);
    const k1 = Math.floor(kmax);
    if (k1 - k0 > 200000) {
      truncated = true;
      continue;
    }
    const total = fam.dashes.reduce((s, v) => s + Math.abs(v), 0);
    for (let k = k0; k <= k1; k++) {
      const origin = add(fam.base, mul(fam.offset, k));
      const lv = dot(origin, nrm);
      const ts: number[] = [];
      for (const [a, b] of edges) {
        const da = dot(a, nrm) - lv;
        const db = dot(b, nrm) - lv;
        if (da > 0 === db > 0) continue; // regra semiaberta: vértice sobre a linha conta uma vez
        if (da === db) continue;
        const t = da / (da - db);
        const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        ts.push(dot(sub(q, origin), d));
      }
      if (ts.length < 2) continue;
      ts.sort((x, y) => x - y);
      for (let i = 0; i + 1 < ts.length; i += 2) {
        const s0 = ts[i];
        const s1 = ts[i + 1];
        if (s1 - s0 < 1e-9) continue;
        if (!fam.dashes.length || !(total > 1e-9)) {
          segs.push([add(origin, mul(d, s0)), add(origin, mul(d, s1))]);
        } else {
          // o padrão de traços começa em `origin` (que já inclui o deslocamento da linha k)
          let start = Math.floor(s0 / total) * total;
          let guard = 0;
          while (start < s1 && guard++ < 100000) {
            let pos = start;
            for (const dash of fam.dashes) {
              const lenD = Math.abs(dash);
              if (dash >= 0) {
                const a0 = Math.max(pos, s0);
                const a1 = Math.min(pos + lenD, s1);
                if (dash === 0 ? pos >= s0 && pos <= s1 : a1 > a0) segs.push([add(origin, mul(d, dash === 0 ? pos : a0)), add(origin, mul(d, dash === 0 ? pos : a1))]);
              }
              pos += lenD;
            }
            start += total;
            if (segs.length > maxSegs) break;
          }
        }
        if (segs.length > maxSegs) {
          truncated = true;
          return { segs, truncated };
        }
      }
    }
  }
  return { segs, truncated };
}
