import {
  type Vec2,
  add,
  fromAngle,
  lineLine,
  mul,
  perpL,
  perpR,
  polylineSegs,
  selfIntersections,
  dist,
  makeEntity,
  type PolylineEntity,
} from "@agtn/geometry";
import {
  bendAllowance,
  bendDeduction,
  bendToIncluded,
  deg,
  insideBendDeduction,
  insideSetback,
  neutralRadius,
  outsideSetback,
} from "./bend";

/**
 * SheetMetalEngine — modelo geométrico de perfis dobrados de seção constante.
 *
 * MODELO
 *  O perfil é uma sequência de trechos retos (abas) unidos por arcos de dobra.
 *  Percorrendo o perfil do início ao fim:
 *   - FACE A = face à ESQUERDA do sentido de percurso; o material fica à direita da face A, com espessura T.
 *   - FACE B = face à direita (offset de T).
 *   - Dobra "left" (anti-horária): a face A fica do lado de DENTRO (raio R); a face B por fora (raio R+T).
 *   - Dobra "right" (horária): o inverso.
 *  Cada aba é informada pelo comprimento medido em UMA face (A ou B), da extremidade livre ou do
 *  vértice virtual (interseção das linhas da face — "mold line") até o vértice virtual seguinte.
 *  Assim "dimensão interna/externa" é sempre uma conversão explícita para a face correspondente.
 *
 * DESENVOLVIMENTO
 *  reto_i = L_i − Σ (recuo em cada extremidade dobrada), recuo = r_face · tan(θ/2),
 *  r_face = R (face interna da dobra) ou R+T (face externa).
 *  L_desenvolvido = Σ reto_i + Σ BA_j, BA_j = θ_j (R_j + K_j T).
 *  Cada dobra tem seus próprios θ, R e K — nunca uma compensação única para o perfil.
 */

export type Face = "A" | "B";
export type BendDir = "left" | "right";

export interface FlangeInput {
  label: string;
  /** Comprimento medido na face indicada, até os vértices virtuais (mm). */
  length: number;
  /** face medida na ponta inicial da aba */
  face: Face;
  /**
   * Face medida na ponta final (padrão = `face`). Diferente quando a aba liga dobras de sentidos
   * opostos e a cota é "de fora a fora" (ex.: alma do perfil Z): o comprimento é a projeção, na
   * direção da aba, entre o vértice virtual da face inicial e o da face final.
   */
  faceEnd?: Face;
}

export interface BendInput {
  label: string;
  /** θ: ângulo de dobra (deflexão), graus, 0 < θ < 180 */
  angleDeg: number;
  /** Raio interno (mm) */
  R: number;
  K: number;
  dir: BendDir;
}

export interface ProfileInput {
  T: number;
  flanges: FlangeInput[];
  bends: BendInput[];
  /** Direção (rad) da primeira aba no desenho da seção */
  startAngle: number;
  /** Comprimento do perfil (dimensão ao longo da linha de dobra) */
  partLength: number;
}

export type IssueLevel = "error" | "warning";
export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  /** índice de aba ou dobra relacionado */
  ref?: { flange?: number; bend?: number };
}

export interface BendResult {
  index: number;
  label: string;
  thetaDeg: number;
  includedDeg: number;
  R: number;
  K: number;
  T: number;
  dir: BendDir;
  BA: number;
  OSB: number;
  ISB: number;
  BD: number;
  BDi: number;
  neutralR: number;
  /** Posição na planificação (mm a partir da borda inicial) */
  xStart: number;
  xEnd: number;
  /** Linha de dobra = centro da região de dobra */
  xLine: number;
  /** Geometria na seção */
  center: Vec2;
  /** ângulo inicial do arco (CCW) e varredura, para desenho do eixo neutro */
  arcA0: number;
  arcSweep: number;
}

export interface FlangeResult {
  index: number;
  label: string;
  inputLength: number;
  face: Face;
  faceEnd: Face;
  /** Trecho reto (igual em todas as fibras) */
  flat: number;
  /** Comprimento até vértices virtuais na face A e na face B */
  lengthA: number;
  lengthB: number;
  /** Medida externa e interna (faces de fora / de dentro de cada dobra vizinha, por ponta) */
  lengthExt: number;
  lengthInt: number;
  xStart: number;
  xEnd: number;
}

export interface SectionGeometry {
  /** Contorno fechado da seção (polilinha com bulges) */
  contour: { pts: Vec2[]; bulges: number[] };
  /** Polilinha dos vértices virtuais da face A (início, vértices, fim) */
  moldA: Vec2[];
  moldB: Vec2[];
  /** Pontos de tangência (início/fim de cada arco) na face A e B */
  tangentsA: [Vec2, Vec2][];
  tangentsB: [Vec2, Vec2][];
}

export interface SolveResult {
  ok: boolean;
  issues: Issue[];
  T: number;
  partLength: number;
  developedLength: number;
  bends: BendResult[];
  flanges: FlangeResult[];
  section: SectionGeometry | null;
}

const MIN_THETA = 1e-6;

export function validateInput(inp: ProfileInput): Issue[] {
  const iss: Issue[] = [];
  const err = (code: string, message: string, ref?: Issue["ref"]) => iss.push({ level: "error", code, message, ref });
  const warn = (code: string, message: string, ref?: Issue["ref"]) => iss.push({ level: "warning", code, message, ref });
  const finite = (v: number) => Number.isFinite(v);
  if (!finite(inp.T) || inp.T <= 0) err("T", "Espessura deve ser maior que zero.");
  if (!finite(inp.partLength) || inp.partLength <= 0) err("PART_LENGTH", "Comprimento do perfil deve ser maior que zero.");
  if (inp.flanges.length !== inp.bends.length + 1) err("TOPOLOGY", "Número de abas deve ser o número de dobras + 1.");
  inp.flanges.forEach((f, i) => {
    if (!finite(f.length) || f.length <= 0) err("FLANGE_LEN", `${f.label}: comprimento deve ser maior que zero.`, { flange: i });
  });
  inp.bends.forEach((b, j) => {
    if (!finite(b.angleDeg) || b.angleDeg <= MIN_THETA || b.angleDeg >= 180)
      err("ANGLE", `${b.label}: ângulo de dobra deve estar entre 0° e 180° (exclusivo).`, { bend: j });
    else if (b.angleDeg > 150)
      warn("ANGLE_HIGH", `${b.label}: dobra de ${b.angleDeg}° — o vértice virtual fica distante; confira a referência dimensional.`, { bend: j });
    if (!finite(b.R) || b.R < 0) err("RADIUS", `${b.label}: raio interno deve ser ≥ 0.`, { bend: j });
    if (!finite(b.K) || b.K < 0 || b.K > 1) err("K_RANGE", `${b.label}: fator K deve estar entre 0 e 1.`, { bend: j });
    else if (b.K < 0.2 || b.K > 0.5)
      warn("K_UNUSUAL", `${b.label}: K = ${b.K} está fora da faixa usual (0,20–0,50).`, { bend: j });
    if (finite(b.R) && inp.T > 0 && b.R === 0)
      warn("R_ZERO", `${b.label}: raio interno zero — dobra viva; o resultado depende fortemente do processo.`, { bend: j });
  });
  return iss;
}

/** Raio da face na dobra: face interna → R; externa → R+T. */
function faceRadius(face: Face, b: BendInput, T: number): number {
  const inside = (b.dir === "left" && face === "A") || (b.dir === "right" && face === "B");
  return inside ? b.R : b.R + T;
}

/** Converte o comprimento de uma aba entre faces (ex.: externa ↔ interna). */
export function convertFlangeLength(
  length: number,
  from: Face,
  to: Face,
  adjacent: BendInput[],
  T: number,
): number {
  if (from === to) return length;
  let L = length;
  for (const b of adjacent) {
    const t = Math.tan(deg(b.angleDeg) / 2);
    L += (faceRadius(to, b, T) - faceRadius(from, b, T)) * t;
  }
  return L;
}

/** Resolve o perfil: desenvolvimento, compensações, geometria da seção e posições de dobra. */
export function solveProfile(inp: ProfileInput): SolveResult {
  const issues = validateInput(inp);
  const empty: SolveResult = {
    ok: false,
    issues,
    T: inp.T,
    partLength: inp.partLength,
    developedLength: NaN,
    bends: [],
    flanges: [],
    section: null,
  };
  if (issues.some((i) => i.level === "error")) return empty;
  const T = inp.T;
  const nB = inp.bends.length;

  // 1) trechos retos
  const flats: number[] = inp.flanges.map((f, i) => {
    let L = f.length;
    if (i > 0) L -= faceRadius(f.face, inp.bends[i - 1], T) * Math.tan(deg(inp.bends[i - 1].angleDeg) / 2);
    if (i < nB) L -= faceRadius(f.faceEnd ?? f.face, inp.bends[i], T) * Math.tan(deg(inp.bends[i].angleDeg) / 2);
    return L;
  });
  flats.forEach((fl, i) => {
    const f = inp.flanges[i];
    if (fl < -1e-9)
      issues.push({
        level: "error",
        code: "FLANGE_SHORT",
        message: `${f.label}: ${fmt(f.length)} mm é menor que os recuos das dobras adjacentes (${fmt(f.length - fl)} mm). Aumente a aba ou reduza o raio.`,
        ref: { flange: i },
      });
    else if (fl < 1e-9 && fl > -1e-9)
      issues.push({ level: "warning", code: "FLANGE_ZERO", message: `${f.label}: trecho reto nulo (a aba é só a região de dobra).`, ref: { flange: i } });
  });
  if (issues.some((i) => i.level === "error")) return { ...empty, issues };

  // 2) dobras
  const bends: BendResult[] = [];
  let x = 0;
  const flanges: FlangeResult[] = [];
  // direções
  const dirs: number[] = [inp.startAngle];
  inp.bends.forEach((b, j) => dirs.push(dirs[j] + (b.dir === "left" ? 1 : -1) * deg(b.angleDeg)));

  // comprimentos até vértices virtuais em cada face
  const moldLen = (i: number, face: Face) => {
    let L = flats[i];
    if (i > 0) L += faceRadius(face, inp.bends[i - 1], T) * Math.tan(deg(inp.bends[i - 1].angleDeg) / 2);
    if (i < nB) L += faceRadius(face, inp.bends[i], T) * Math.tan(deg(inp.bends[i].angleDeg) / 2);
    return L;
  };

  // medida externa/interna por ponta: externa = face de fora da dobra vizinha (left → B, right → A)
  const refLen = (i: number, ext: boolean) => {
    const at = (b: BendInput): Face => ((b.dir === "left") === ext ? "B" : "A");
    let L = flats[i];
    if (i > 0) L += faceRadius(at(inp.bends[i - 1]), inp.bends[i - 1], T) * Math.tan(deg(inp.bends[i - 1].angleDeg) / 2);
    if (i < nB) L += faceRadius(at(inp.bends[i]), inp.bends[i], T) * Math.tan(deg(inp.bends[i].angleDeg) / 2);
    return L;
  };

  // 3) geometria da seção (face A pelos vértices virtuais)
  const u = (i: number) => fromAngle(dirs[i]);
  const V: Vec2[] = [{ x: 0, y: 0 }];
  for (let i = 0; i <= nB; i++) V.push(add(V[i], mul(u(i), moldLen(i, "A"))));
  const tangentsA: [Vec2, Vec2][] = [];
  const tangentsB: [Vec2, Vec2][] = [];

  for (let i = 0; i <= nB; i++) {
    const f = inp.flanges[i];
    flanges.push({
      index: i,
      label: f.label,
      inputLength: f.length,
      face: f.face,
      faceEnd: f.faceEnd ?? f.face,
      flat: Math.max(0, flats[i]),
      lengthA: moldLen(i, "A"),
      lengthB: moldLen(i, "B"),
      lengthExt: refLen(i, true),
      lengthInt: refLen(i, false),
      xStart: x,
      xEnd: x + Math.max(0, flats[i]),
    });
    x += Math.max(0, flats[i]);
    if (i < nB) {
      const b = inp.bends[i];
      const th = deg(b.angleDeg);
      const BA = bendAllowance(th, b.R, b.K, T);
      const rA = faceRadius("A", b, T);
      const vtx = V[i + 1];
      const t = rA * Math.tan(th / 2);
      const P1 = add(vtx, mul(u(i), -t));
      const P2 = add(vtx, mul(u(i + 1), t));
      const nrm = b.dir === "left" ? perpL(u(i)) : perpR(u(i));
      const C = add(P1, mul(nrm, rA));
      const Q1 = add(P1, mul(perpR(u(i)), T));
      const Q2 = add(P2, mul(perpR(u(i + 1)), T));
      tangentsA.push([P1, P2]);
      tangentsB.push([Q1, Q2]);
      // arco do eixo neutro: CCW de a0 com varredura θ
      const a0 = b.dir === "left" ? dirs[i] - Math.PI / 2 : dirs[i + 1] + Math.PI / 2;
      bends.push({
        index: i,
        label: b.label,
        thetaDeg: b.angleDeg,
        includedDeg: bendToIncluded(b.angleDeg),
        R: b.R,
        K: b.K,
        T,
        dir: b.dir,
        BA,
        OSB: outsideSetback(th, b.R, T),
        ISB: insideSetback(th, b.R),
        BD: bendDeduction(th, b.R, b.K, T),
        BDi: insideBendDeduction(th, b.R, b.K, T),
        neutralR: neutralRadius(b.R, b.K, T),
        xStart: x,
        xEnd: x + BA,
        xLine: x + BA / 2,
        center: C,
        arcA0: a0,
        arcSweep: th,
      });
      x += BA;
    }
  }
  const developedLength = x;

  // face B: vértices virtuais = interseção das linhas deslocadas
  const offLine = (i: number) => {
    const n = mul(perpR(u(i)), T);
    return [add(V[i], n), add(V[i + 1], n)] as const;
  };
  const W: Vec2[] = [offLine(0)[0]];
  for (let j = 0; j < nB; j++) {
    const [a1, a2] = offLine(j);
    const [b1, b2] = offLine(j + 1);
    const h = lineLine(a1, a2, b1, b2);
    W.push(h ? h.p : a2);
  }
  W.push(offLine(nB)[1]);

  // contorno fechado: face A → tampa → face B (reverso) → tampa
  const pts: Vec2[] = [];
  const bulges: number[] = [];
  const push = (p: Vec2, b: number) => {
    pts.push(p);
    bulges.push(b);
  };
  push(V[0], 0);
  inp.bends.forEach((b, j) => {
    const q = Math.tan(deg(b.angleDeg) / 4);
    push(tangentsA[j][0], b.dir === "left" ? q : -q);
    push(tangentsA[j][1], 0);
  });
  push(V[nB + 1], 0);
  push(W[nB + 1], 0);
  for (let j = nB - 1; j >= 0; j--) {
    const b = inp.bends[j];
    const q = Math.tan(deg(b.angleDeg) / 4);
    push(tangentsB[j][1], b.dir === "left" ? -q : q);
    push(tangentsB[j][0], 0);
  }
  push(add(V[0], mul(perpR(u(0)), T)), 0);
  // remove pontos coincidentes (raio nulo ou trecho reto nulo)
  for (let k = pts.length - 1; k >= 0; k--) {
    const nx = (k + 1) % pts.length;
    if (pts.length > 2 && dist(pts[k], pts[nx]) < 1e-9) {
      pts.splice(k, 1);
      bulges.splice(k, 1);
    }
  }
  const section: SectionGeometry = { contour: { pts, bulges }, moldA: V, moldB: W, tangentsA, tangentsB };

  // autointerseção (abas que se cruzam/encostam)
  const poly = makeEntity({ type: "polyline", pts, bulges, closed: true }, "0") as PolylineEntity;
  const si = selfIntersections(polylineSegs(poly), true, 1e-7);
  if (si.length)
    issues.push({
      level: "error",
      code: "SELF_INTERSECTION",
      message: "A seção se autointercepta: abas se cruzam ou se sobrepõem com as dimensões/ângulos informados.",
    });

  return {
    ok: !issues.some((i) => i.level === "error"),
    issues,
    T,
    partLength: inp.partLength,
    developedLength,
    bends,
    flanges,
    section,
  };
}

const fmt = (v: number) => v.toFixed(3).replace(".", ",");
