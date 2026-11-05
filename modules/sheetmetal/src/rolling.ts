import { type Entity, type Vec2, TAU, makeEntity } from "@agtn/geometry";
import type { Issue } from "./engine";
import { fmtMM } from "./output";

/**
 * CALANDRAGEM — desenvolvimento de chapa calandrada (cilindro completo ou segmento).
 *
 *   Ri = raio interno · Re = Ri + T · Rn = Ri + K·T (eixo neutro)
 *   Desenvolvido = θ · Rn   (θ em radianos; volta completa θ = 2π → π·(Di + 2·K·T))
 *
 * K da calandragem: com R/T grande o eixo neutro tende ao meio da espessura (K ≈ 0,5).
 * O valor padrão 0,50 é ESTIMATIVA DE PARTIDA, configurável.
 * Como a calandra não marca linhas na chapa, a planificação leva a informação como MARCAÇÃO
 * (texto na camada MARCACAO, convertido em geometria para o laser pela aplicação).
 */
export type RollRef = "externo" | "interno";

export interface RollingInput {
  /** Diâmetro informado (mm) */
  diameter: number;
  ref: RollRef;
  T: number;
  /** Largura da chapa = altura do cilindro (mm) */
  width: number;
  /** Ângulo calandrado (°): 360 = volta completa */
  angleDeg: number;
  K: number;
}

export interface RollingResult {
  ok: boolean;
  issues: Issue[];
  input: RollingInput;
  Ri: number;
  Re: number;
  Rn: number;
  developed: number;
  /** corda e flecha externas (segmento < 360°) */
  chordOuter: number;
  sagittaOuter: number;
  /** linhas da marcação */
  marking: string[];
}

export function solveRolling(inp: RollingInput): RollingResult {
  const issues: Issue[] = [];
  const err = (code: string, message: string) => issues.push({ level: "error", code, message });
  const warn = (code: string, message: string) => issues.push({ level: "warning", code, message });
  const fin = Number.isFinite;
  if (!fin(inp.T) || inp.T <= 0) err("T", "Espessura deve ser maior que zero.");
  if (!fin(inp.width) || inp.width <= 0) err("WIDTH", "Largura deve ser maior que zero.");
  if (!fin(inp.diameter) || inp.diameter <= 0) err("D", "Diâmetro deve ser maior que zero.");
  if (!fin(inp.angleDeg) || inp.angleDeg <= 0 || inp.angleDeg > 360) err("ANGLE", "Ângulo calandrado deve estar entre 0° e 360°.");
  if (!fin(inp.K) || inp.K < 0 || inp.K > 1) err("K", "Fator K deve estar entre 0 e 1.");
  const Ri = inp.ref === "interno" ? inp.diameter / 2 : inp.diameter / 2 - inp.T;
  if (fin(Ri) && Ri <= 0 && !issues.some((i) => i.level === "error")) err("RI", "Diâmetro externo menor ou igual a duas espessuras: raio interno inválido.");
  const Re = Ri + inp.T;
  const Rn = Ri + inp.K * inp.T;
  const th = (inp.angleDeg * Math.PI) / 180;
  const ok = !issues.some((i) => i.level === "error");
  if (ok && Ri / inp.T < 5)
    warn("RT_SMALL", `Raio interno ${fmtMM(Ri)} mm é pequeno para a espessura (R/T = ${fmtMM(Ri / inp.T, 2)}): confira a capacidade da calandra.`);
  if (ok && inp.angleDeg >= 359.999)
    warn("PREBEND", "Volta completa: considere pré-dobrar as extremidades (zona plana da calandra) e a folga de solda do fechamento.");
  if (ok && (inp.K < 0.3 || inp.K > 0.5)) warn("K_UNUSUAL", `K = ${inp.K} fora da faixa usual de calandragem (0,30–0,50).`);
  const developed = ok ? th * Rn : NaN;
  const full = inp.angleDeg >= 359.999;
  const chordOuter = full ? 0 : 2 * Re * Math.sin(th / 2);
  const sagittaOuter = full ? 0 : Re * (1 - Math.cos(th / 2));
  const refR = inp.ref === "interno" ? Ri : Re;
  const marking = ok
    ? [
        `CALANDRAR RAIO ${inp.ref === "interno" ? "INTERNO" : "EXTERNO"} R${fmtMM(refR)}`,
        `RI ${fmtMM(Ri)}  RE ${fmtMM(Re)}  ØI ${fmtMM(2 * Ri)}  ØE ${fmtMM(2 * Re)}`,
        `${full ? "VOLTA COMPLETA 360°" : `ÂNGULO ${fmtMM(inp.angleDeg, 1)}°  CORDA EXT ${fmtMM(chordOuter)}`}  T${fmtMM(inp.T)}  DES ${fmtMM(developed)}`,
      ]
    : [];
  return { ok, issues, input: inp, Ri, Re, Rn, developed, chordOuter, sagittaOuter, marking };
}

export interface RollingFlatOptions {
  origin?: Vec2;
  dims?: boolean;
  /** altura do texto de marcação (mm) */
  markHeight?: number;
}

/** Planificação: retângulo desenvolvido × largura + marcação + cotas. */
export function rollingFlatEntities(r: RollingResult, o: RollingFlatOptions = {}): Entity[] {
  if (!r.ok) return [];
  const O = o.origin ?? { x: 0, y: 0 };
  const L = r.developed;
  const W = r.input.width;
  const P = (x: number, y: number): Vec2 => ({ x: O.x + x, y: O.y + y });
  const out: Entity[] = [
    makeEntity({ type: "polyline", pts: [P(0, 0), P(L, 0), P(L, W), P(0, W)], bulges: [0, 0, 0, 0], closed: true }, "CONTORNO_CORTE"),
  ];
  const h = Math.min(o.markHeight ?? 5, W / (r.marking.length * 2.2));
  const gap = h * 1.8;
  const y0 = W / 2 + ((r.marking.length - 1) * gap) / 2;
  r.marking.forEach((line, i) => {
    out.push(makeEntity({ type: "text", p: P(L / 2, y0 - i * gap - h / 2), h, rot: 0, value: line, halign: 1 }, "MARCACAO"));
  });
  if (o.dims ?? true) {
    const sc = Math.max(1, L / 45 / 2.5 > 1 ? Math.ceil(L / 45 / 2.5) : 1);
    const g = 8 * sc;
    out.push(
      makeEntity({ type: "dimension", kind: "linear", p1: P(0, 0), p2: P(L, 0), loc: P(0, -g), rot: 0, textOverride: null, dimScale: sc, assoc: null }, "COTAS"),
      makeEntity({ type: "dimension", kind: "linear", p1: P(L, 0), p2: P(L, W), loc: P(L + g, 0), rot: Math.PI / 2, textOverride: null, dimScale: sc, assoc: null }, "COTAS"),
    );
  }
  return out;
}

/** Vista da peça calandrada (anel ou segmento) com cotas de diâmetro/raio. */
export function rollingSectionEntities(r: RollingResult): Entity[] {
  if (!r.ok) return [];
  const th = (r.input.angleDeg * Math.PI) / 180;
  const full = r.input.angleDeg >= 359.999;
  const c = { x: 0, y: 0 };
  const out: Entity[] = [];
  const sc = Math.max(1, Math.ceil((2 * r.Re) / 45 / 2.5));
  if (full) {
    out.push(makeEntity({ type: "circle", c, r: r.Re }, "SECAO_PERFIL"), makeEntity({ type: "circle", c, r: r.Ri }, "SECAO_PERFIL"));
    out.push(makeEntity({ type: "circle", c, r: r.Rn }, "CENTROS"));
  } else {
    // segmento simétrico em torno do eixo Y (abertura para baixo)
    const a0 = Math.PI / 2 - th / 2;
    const a1 = Math.PI / 2 + th / 2;
    const pt = (R: number, a: number): Vec2 => ({ x: Math.cos(a) * R, y: Math.sin(a) * R });
    const q = Math.tan(th / 4);
    out.push(
      makeEntity(
        { type: "polyline", pts: [pt(r.Re, a0), pt(r.Re, a1), pt(r.Ri, a1), pt(r.Ri, a0)], bulges: [q, 0, -q, 0], closed: true },
        "SECAO_PERFIL",
      ),
      makeEntity({ type: "arc", c, r: r.Rn, a0, a1 }, "CENTROS"),
    );
  }
  const dir = full ? Math.PI / 4 : Math.PI / 2;
  const u = { x: Math.cos(dir), y: Math.sin(dir) };
  out.push(
    makeEntity(
      { type: "dimension", kind: "diameter", p1: c, p2: { x: u.x * r.Re, y: u.y * r.Re }, loc: { x: u.x * r.Re * 1.15, y: u.y * r.Re * 1.15 }, rot: 0, textOverride: "<> EXT", dimScale: sc, assoc: null },
      "COTAS",
      { color: 4 },
    ),
    makeEntity(
      { type: "dimension", kind: "radius", p1: c, p2: { x: -u.x * r.Ri, y: u.y * r.Ri }, loc: { x: -u.x * r.Ri * 0.6, y: u.y * r.Ri * 0.6 }, rot: 0, textOverride: "<> INT", dimScale: sc, assoc: null },
      "COTAS",
      { color: 30 },
    ),
  );
  return out;
}

export const rollingCircumference = (R: number): number => TAU * R;
