import { normAngle, rad2deg, TAU } from "./angle";
import type { DimensionEntity } from "./entities";
import { type Vec2, add, angleOf, dist, dot, fromAngle, mid, mul, norm, perpL, sub } from "./vec";

/** Estilo de cota (valores em mm de papel/modelo). */
export interface DimStyle {
  textHeight: number;
  precision: number;
  arrowSize: number;
  arrowType: "closed" | "open" | "tick";
  /** afastamento da linha auxiliar em relação ao ponto de origem */
  extOffset: number;
  /** prolongamento da linha auxiliar além da linha de cota */
  extBeyond: number;
  /** distância do texto à linha de cota */
  textGap: number;
  decimalSeparator: "," | ".";
  /** fator de conversão mm → unidade exibida (ex.: 0,1 para cm) */
  unitFactor: number;
  suffix: string;
  anglePrecision: number;
}

export const DEFAULT_DIMSTYLE: DimStyle = {
  textHeight: 2.5,
  precision: 2,
  arrowSize: 2.5,
  arrowType: "closed",
  extOffset: 1,
  extBeyond: 1.25,
  textGap: 1,
  decimalSeparator: ",",
  unitFactor: 1,
  suffix: "",
  anglePrecision: 1,
};

export interface DimGeometry {
  lines: [Vec2, Vec2][];
  /** Polígonos preenchidos (setas fechadas) */
  solids: Vec2[][];
  arcs: { c: Vec2; r: number; a0: number; a1: number }[];
  text: { p: Vec2; h: number; rot: number; value: string };
  /** valor medido (mm ou graus para angular) */
  measured: number;
}

export function formatNumber(v: number, precision: number, sep: "," | "."): string {
  let s = v.toFixed(Math.max(0, Math.min(8, precision)));
  if (s === "-0" || /^-0[.,]0+$/.test(s)) s = s.slice(1);
  return sep === "," ? s.replace(".", ",") : s;
}

/** Valor medido real (independente de texto sobrescrito). */
export function dimensionValue(d: DimensionEntity): number {
  switch (d.kind) {
    case "aligned":
      return dist(d.p1, d.p2);
    case "linear":
      return Math.abs(dot(sub(d.p2, d.p1), fromAngle(d.rot)));
    case "radius":
      return dist(d.p1, d.p2);
    case "diameter":
      return 2 * dist(d.p1, d.p2);
    case "angular": {
      if (!d.p3) return 0;
      return rad2deg(angularSweep(d).sweep);
    }
  }
}

function angularSweep(d: DimensionEntity): { a0: number; sweep: number } {
  const a2 = angleOf(sub(d.p2, d.p1));
  const a3 = angleOf(sub(d.p3!, d.p1));
  const al = angleOf(sub(d.loc, d.p1));
  // escolhe o setor (a2→a3 ou a3→a2, CCW) que contém o ponto de posição
  const s23 = normAngle(a3 - a2);
  const inside23 = normAngle(al - a2) <= s23;
  return inside23 ? { a0: normAngle(a2), sweep: s23 } : { a0: normAngle(a3), sweep: TAU - s23 };
}

function readable(rot: number): number {
  const r = normAngle(rot);
  return r > Math.PI / 2 + 1e-9 && r <= (3 * Math.PI) / 2 + 1e-9 ? normAngle(r + Math.PI) : r;
}

function arrow(tip: Vec2, dirInto: Vec2, st: DimStyle, out: DimGeometry) {
  // dirInto: direção do corpo da seta (da ponta para trás)
  const u = norm(dirInto);
  const n = perpL(u);
  const back = add(tip, mul(u, st.arrowSize));
  if (st.arrowType === "tick") {
    const t = st.arrowSize / 2;
    const dd = norm(add(u, n));
    out.lines.push([add(tip, mul(dd, -t)), add(tip, mul(dd, t))]);
    return;
  }
  const w = st.arrowSize / 6;
  const p1 = add(back, mul(n, w));
  const p2 = add(back, mul(n, -w));
  if (st.arrowType === "open") {
    out.lines.push([tip, p1], [tip, p2]);
  } else out.solids.push([tip, p1, p2]);
}

/** Gera a geometria de apresentação de uma cota (linhas, setas, texto). */
export function dimensionGeometry(d: DimensionEntity, style: DimStyle = DEFAULT_DIMSTYLE): DimGeometry {
  const k = d.dimScale && d.dimScale > 0 ? d.dimScale : 1;
  const st: DimStyle =
    k === 1
      ? style
      : {
          ...style,
          textHeight: style.textHeight * k,
          arrowSize: style.arrowSize * k,
          extOffset: style.extOffset * k,
          extBeyond: style.extBeyond * k,
          textGap: style.textGap * k,
        };
  const measured = dimensionValue(d);
  const out: DimGeometry = {
    lines: [],
    solids: [],
    arcs: [],
    text: { p: d.loc, h: st.textHeight, rot: 0, value: "" },
    measured,
  };
  const fmt = (v: number) => formatNumber(v * st.unitFactor, st.precision, st.decimalSeparator) + st.suffix;
  const label = (auto: string) => (d.textOverride != null && d.textOverride !== "" ? d.textOverride.replace("<>", auto) : auto);

  if (d.kind === "aligned" || d.kind === "linear") {
    const dir = d.kind === "linear" ? fromAngle(d.rot) : norm(sub(d.p2, d.p1));
    if (Math.hypot(dir.x, dir.y) < 1e-12) return out;
    const n = perpL(dir);
    const q1 = add(d.p1, mul(n, dot(sub(d.loc, d.p1), n)));
    const q2 = add(d.p2, mul(n, dot(sub(d.loc, d.p2), n)));
    const ext = (p: Vec2, q: Vec2) => {
      const v = sub(q, p);
      const L = Math.hypot(v.x, v.y);
      if (L < 1e-12) return;
      const u = mul(v, 1 / L);
      const start = L > st.extOffset ? add(p, mul(u, st.extOffset)) : p;
      out.lines.push([start, add(q, mul(u, st.extBeyond))]);
    };
    ext(d.p1, q1);
    ext(d.p2, q2);
    out.lines.push([q1, q2]);
    const dl = dist(q1, q2);
    if (dl > 1e-12) {
      const u = norm(sub(q2, q1));
      const inside = dl >= st.arrowSize * 2.2;
      if (inside) {
        arrow(q1, u, st, out);
        arrow(q2, mul(u, -1), st, out);
      } else {
        arrow(q1, mul(u, -1), st, out);
        arrow(q2, u, st, out);
        out.lines.push([q1, add(q1, mul(u, -st.arrowSize * 2))], [q2, add(q2, mul(u, st.arrowSize * 2))]);
      }
    }
    const rot = readable(angleOf(dir));
    const up = perpL(fromAngle(rot));
    out.text = { p: add(mid(q1, q2), mul(up, st.textGap)), h: st.textHeight, rot, value: label(fmt(measured)) };
    return out;
  }
  if (d.kind === "radius" || d.kind === "diameter") {
    const r = dist(d.p1, d.p2);
    if (r < 1e-12) return out;
    const u = norm(sub(d.p2, d.p1));
    const prefix = d.kind === "radius" ? "R" : "Ø";
    const locDist = dist(d.loc, d.p1);
    if (d.kind === "radius") {
      out.lines.push([d.p1, d.p2]);
      arrow(d.p2, mul(u, -1), st, out);
    } else {
      const opp = sub(d.p1, mul(u, r));
      out.lines.push([opp, d.p2]);
      arrow(d.p2, mul(u, -1), st, out);
      arrow(opp, u, st, out);
    }
    if (locDist > r) out.lines.push([d.p2, d.loc]);
    const rot = readable(angleOf(u));
    out.text = {
      p: add(d.loc, mul(perpL(fromAngle(rot)), st.textGap)),
      h: st.textHeight,
      rot,
      value: label(prefix + fmt(d.kind === "radius" ? r : 2 * r)),
    };
    return out;
  }
  // angular
  if (!d.p3) return out;
  const { a0, sweep } = angularSweep(d);
  const R = dist(d.loc, d.p1);
  out.arcs.push({ c: d.p1, r: R, a0, a1: normAngle(a0 + sweep) });
  const e0 = add(d.p1, fromAngle(a0, R));
  const e1 = add(d.p1, fromAngle(a0 + sweep, R));
  for (const [ang, endPt] of [
    [a0, e0],
    [a0 + sweep, e1],
  ] as const) {
    const ray = fromAngle(ang);
    const src = [d.p2, d.p3].reduce((best, p) =>
      Math.abs(normAngle(angleOf(sub(p, d.p1)) - ang)) < Math.abs(normAngle(angleOf(sub(best, d.p1)) - ang)) ? p : best,
    );
    const ds = dist(src, d.p1);
    if (ds < R) out.lines.push([add(d.p1, mul(ray, ds + st.extOffset)), add(endPt, mul(ray, st.extBeyond))]);
  }
  const t0 = perpL(fromAngle(a0));
  const t1 = mul(perpL(fromAngle(a0 + sweep)), -1);
  if (R * sweep > st.arrowSize * 2.2) {
    arrow(e0, t0, st, out);
    arrow(e1, t1, st, out);
  }
  const am = a0 + sweep / 2;
  const rot = readable(am - Math.PI / 2);
  out.text = {
    p: add(d.p1, fromAngle(am, R + st.textGap)),
    h: st.textHeight,
    rot,
    value: label(formatNumber(rad2deg(sweep), st.anglePrecision, st.decimalSeparator) + "°"),
  };
  return out;
}
