import {
  type Affine,
  type Entity,
  type PointRef,
  type Vec2,
  IDENTITY,
  compose,
  deg2rad,
  insunitsToMM,
  isConformal,
  makeEntity,
  mid,
  normAngle,
  rotation,
  transformEntity,
  translation,
  dist,
  TAU,
  TEXT_LINE_SPACING,
  type HatchLoop,
  type SplineGeom,
  type HatchPatternLine,
  clampedKnots,
  ellipsePoints,
  hatchPatternByName,
  interpolateSpline,
  patternLines,
  splinePoints,
  splineValid,
  transformEntityAffine,
} from "@agtn/geometry";
import { DEFAULT_LAYER, type Layer, linetypeByName } from "@agtn/document";
import { decodeDxfBytes, fromDxfText } from "./encoding";

/**
 * Leitor DXF ASCII (R12 até versões atuais).
 *
 * Entidades suportadas: LINE, CIRCLE, ARC, POINT, LWPOLYLINE, POLYLINE 2D (+VERTEX/SEQEND),
 * ELLIPSE, SPLINE, HATCH (contornos de polilinha, linha, arco, arco elíptico e spline; sólido,
 * degradê como sólido e padrões de linhas), TEXT, MTEXT (com quebras de linha), INSERT (blocos expandidos com transformação), DIMENSION
 * (linear/rotacionada, alinhada, raio e diâmetro como cotas nativas; demais tipos convertidos na
 * geometria do bloco da cota).
 * Entidades não suportadas são contadas e informadas no relatório — nunca simuladas.
 */

export interface DxfImportReport {
  version: string;
  encoding: string;
  /** fator aplicado para converter as coordenadas do arquivo em mm */
  unitFactor: number;
  unitSource: "INSUNITS" | "assumido";
  counts: Record<string, number>;
  unsupported: Record<string, number>;
  warnings: string[];
}

export interface DxfImportResult {
  layers: Layer[];
  entities: Entity[];
  report: DxfImportReport;
}

interface Pair {
  c: number;
  v: string;
}

function tokenize(text: string): Pair[] {
  const lines = text.split(/\r\n|\n|\r/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const c = Number.parseInt(lines[i].trim(), 10);
    if (Number.isNaN(c)) throw new Error(`DXF inválido: código de grupo ilegível na linha ${i + 1}.`);
    out.push({ c, v: lines[i + 1] });
  }
  return out;
}

/** Entidade bruta: tipo + lista de pares. */
interface RawEnt {
  type: string;
  pairs: Pair[];
  /** vértices (POLYLINE) */
  vertices?: RawEnt[];
}

interface RawBlock {
  name: string;
  base: Vec2;
  ents: RawEnt[];
}

const f = (r: RawEnt, code: number, def = 0): number => {
  const p = r.pairs.find((q) => q.c === code);
  if (!p) return def;
  const n = Number.parseFloat(p.v.trim());
  return Number.isFinite(n) ? n : def;
};
const s = (r: RawEnt, code: number, def = ""): string => {
  const p = r.pairs.find((q) => q.c === code);
  return p ? p.v.replace(/\s+$/, "") : def;
};
const has = (r: RawEnt, code: number) => r.pairs.some((q) => q.c === code);
const num = (v: string): number => {
  const n = Number.parseFloat(v.trim());
  return Number.isFinite(n) ? n : 0;
};

/** Espelho em X do OCS com extrusão (0,0,−1). */
const MIRROR_X: Affine = { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** Remove a formatação do MTEXT, mantendo as quebras de linha (\P → "\n") e frações empilhadas. */
export function mtextPlain(raw: string): string {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "\\" && i + 1 < raw.length) {
      const n = raw[i + 1];
      if (n === "P" || n === "X") {
        out += "\n";
        i += 2;
      } else if (n === "~") {
        out += " ";
        i += 2;
      } else if (n === "\\" || n === "{" || n === "}") {
        out += n;
        i += 2;
      } else if ("LlOoKkNn".includes(n)) {
        i += 2;
      } else if (n === "S") {
        const end = raw.indexOf(";", i);
        const body = raw.slice(i + 2, end < 0 ? raw.length : end);
        out += body.replace(/[#^]/g, "/").replace(/\/\/+/g, "/");
        i = end < 0 ? raw.length : end + 1;
      } else if (n === "U" && raw[i + 2] === "+") {
        out += String.fromCharCode(Number.parseInt(raw.slice(i + 3, i + 7), 16));
        i += 7;
      } else if (/[A-Za-z]/.test(n)) {
        const end = raw.indexOf(";", i);
        i = end < 0 ? raw.length : end + 1;
      } else {
        out += n;
        i += 2;
      }
    } else if (ch === "{" || ch === "}") i++;
    else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Lê os contornos e o padrão de uma HATCH percorrendo os códigos em ordem. */
function parseHatch(r: RawEnt, k: number, report: DxfImportReport): { loops: HatchLoop[]; solid: boolean; pattern: string; angle: number; scale: number; lines: HatchPatternLine[] } | null {
  const P = r.pairs;
  let i = 0;
  const find = (code: number, from: number) => {
    for (let j = from; j < P.length; j++) if (P[j].c === code) return j;
    return -1;
  };
  let pattern = "SOLID";
  let solid = false;
  const ip = find(91, 0);
  if (ip < 0) return null;
  for (let j = 0; j < ip; j++) {
    if (P[j].c === 2) pattern = P[j].v.trim();
    if (P[j].c === 70) solid = num(P[j].v) === 1;
  }
  const nPaths = num(P[ip].v);
  i = ip + 1;
  const loops: HatchLoop[] = [];
  const at = (code: number): number => {
    while (i < P.length && P[i].c !== code) i++;
    return i < P.length ? num(P[i++].v) : 0;
  };
  const pt = (cx: number, cy: number): Vec2 => ({ x: at(cx) * k, y: at(cy) * k });
  for (let pIdx = 0; pIdx < nPaths && i < P.length; pIdx++) {
    const flags = at(92);
    const pts: Vec2[] = [];
    const bulges: number[] = [];
    const pushPt = (q: Vec2, b = 0) => {
      const last = pts[pts.length - 1];
      if (last && Math.abs(last.x - q.x) < 1e-9 && Math.abs(last.y - q.y) < 1e-9) {
        bulges[bulges.length - 1] = b || bulges[bulges.length - 1];
        return;
      }
      pts.push(q);
      bulges.push(b);
    };
    if (flags & 2) {
      const hasBulge = at(72) !== 0;
      at(73);
      const nv = at(93);
      for (let v = 0; v < nv; v++) {
        const q = pt(10, 20);
        let b = 0;
        if (hasBulge && P[i]?.c === 42) b = num(P[i++].v);
        pts.push(q);
        bulges.push(b);
      }
    } else {
      const ne = at(93);
      for (let ei = 0; ei < ne && i < P.length; ei++) {
        const et = at(72);
        // cada aresta vira uma lista de pontos com bulge, do início ao fim
        let seg: { p: Vec2; b: number }[] = [];
        if (et === 1) {
          seg = [{ p: pt(10, 20), b: 0 }, { p: pt(11, 21), b: 0 }];
        } else if (et === 2) {
          const c = pt(10, 20);
          const rr = at(40) * k;
          let sa = deg2rad(at(50));
          let ea = deg2rad(at(51));
          const ccw = at(73) !== 0;
          if (!ccw) {
            sa = -sa;
            ea = -ea;
          }
          let sw = ccw ? normAngle(ea - sa) : -normAngle(sa - ea);
          if (Math.abs(sw) < 1e-12) sw = ccw ? TAU : -TAU;
          const p0 = { x: c.x + rr * Math.cos(sa), y: c.y + rr * Math.sin(sa) };
          if (Math.abs(sw) >= TAU - 1e-9) {
            const pm = { x: c.x + rr * Math.cos(sa + sw / 2), y: c.y + rr * Math.sin(sa + sw / 2) };
            const b = Math.tan(sw / 8);
            seg = [{ p: p0, b }, { p: pm, b }, { p: p0, b: 0 }];
          } else {
            const p1 = { x: c.x + rr * Math.cos(sa + sw), y: c.y + rr * Math.sin(sa + sw) };
            seg = [{ p: p0, b: Math.tan(sw / 4) }, { p: p1, b: 0 }];
          }
        } else if (et === 3) {
          const c = pt(10, 20);
          const major = pt(11, 21);
          const ratio = at(40);
          let sa = deg2rad(at(50));
          let ea = deg2rad(at(51));
          const ccw = at(73) !== 0;
          if (!ccw) {
            sa = -sa;
            ea = -ea;
          }
          // ângulos geométricos → parâmetros da elipse
          const par = (ang: number) => Math.atan2(Math.sin(ang) / Math.max(ratio, 1e-12), Math.cos(ang));
          const t0 = par(sa);
          let sw = ccw ? normAngle(par(ea) - t0) : -normAngle(t0 - par(ea));
          if (Math.abs(sw) < 1e-12) sw = ccw ? TAU : -TAU;
          const lo = Math.min(t0, t0 + sw);
          const ptsE = ellipsePoints({ c, major, ratio: Math.min(1, Math.max(1e-9, ratio)), t0: lo, t1: Math.abs(sw) >= TAU - 1e-9 ? lo + TAU : normAngle(lo + Math.abs(sw)) }, 2e-6);
          if (sw < 0) ptsE.reverse();
          seg = ptsE.map((q) => ({ p: q, b: 0 }));
        } else if (et === 4) {
          const degree = at(94);
          const rational = at(73) !== 0;
          at(74);
          const nk = at(95);
          const nc = at(96);
          const knots: number[] = [];
          for (let q = 0; q < nk; q++) knots.push(at(40));
          const ctrl: Vec2[] = [];
          const weights: number[] = [];
          for (let q = 0; q < nc; q++) {
            ctrl.push(pt(10, 20));
            if (rational && P[i]?.c === 42) weights.push(num(P[i++].v));
          }
          let fit: Vec2[] = [];
          if (P[i]?.c === 97) {
            const nf = num(P[i++].v);
            for (let q = 0; q < nf; q++) fit.push(pt(11, 21));
            if (P[i]?.c === 12) {
              pt(12, 22);
              pt(13, 23);
            }
          }
          const sp = { degree, ctrl, knots, weights: rational && weights.length === nc ? weights : null, closed: false };
          const curve = splineValid(sp) ? splinePoints(sp, 64) : fit.length >= 2 ? splinePoints(interpolateSpline(fit), 64) : ctrl;
          seg = curve.map((q) => ({ p: q, b: 0 }));
          fit = [];
        } else {
          report.warnings.push("HATCH com aresta de tipo desconhecido: contorno ignorado.");
          break;
        }
        if (!seg.length) continue;
        // encadeia: inverte a aresta se ela começa no fim
        const last = pts[pts.length - 1];
        if (last && dist(last, seg[0].p) > dist(last, seg[seg.length - 1].p) + 1e-9) {
          const rev = seg.slice().reverse();
          seg = rev.map((q, j) => ({ p: q.p, b: j + 1 < rev.length ? -rev[j + 1].b : 0 }));
        }
        seg.forEach((q, j) => (j + 1 < seg.length ? pushPt(q.p, q.b) : pushPt(q.p, 0)));
      }
      if (pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < 1e-9) {
        pts.pop();
        bulges.pop();
      }
    }
    // pula os objetos de contorno associados (97 + 330)
    if (P[i]?.c === 97) {
      const ns = num(P[i++].v);
      for (let q = 0; q < ns && P[i]?.c === 330; q++) i++;
    }
    if (pts.length >= 2) loops.push({ pts, bulges });
  }
  let angle = 0;
  let scale = 1;
  const lines: HatchPatternLine[] = [];
  const i52 = find(52, i);
  if (i52 >= 0) angle = deg2rad(num(P[i52].v));
  const i41 = find(41, i);
  if (i41 >= 0) scale = num(P[i41].v) || 1;
  const i78 = find(78, i);
  if (i78 >= 0 && !solid) {
    i = i78 + 1;
    const nl = num(P[i78].v);
    for (let l = 0; l < nl && i < P.length; l++) {
      const la = deg2rad(at(53));
      const base = { x: at(43) * k, y: at(44) * k };
      const offset = { x: at(45) * k, y: at(46) * k };
      const nd = at(79);
      const dashes: number[] = [];
      for (let d = 0; d < nd; d++) dashes.push(at(49) * k);
      lines.push({ angle: la, base, offset, dashes });
    }
  }
  if (find(450, 0) >= 0 && find(450, 0) < P.length && num(P[find(450, 0)].v) === 1) solid = true; // degradê → sólido
  if (!solid && !lines.length) {
    const def = hatchPatternByName(pattern);
    if (def && def.name !== "SOLID") lines.push(...patternLines(def, angle, scale * k));
    else solid = !def ? false : true;
  }
  return { loops, solid, pattern, angle, scale, lines };
}

function readEntitiesBlock(pairs: Pair[], start: number, endMarkers: string[]): { ents: RawEnt[]; next: number } {
  const ents: RawEnt[] = [];
  let i = start;
  let poly: RawEnt | null = null;
  while (i < pairs.length) {
    const p = pairs[i];
    if (p.c !== 0) {
      i++;
      continue;
    }
    const t = p.v.trim();
    if (endMarkers.includes(t)) return { ents, next: i };
    const rec: RawEnt = { type: t, pairs: [] };
    i++;
    while (i < pairs.length && pairs[i].c !== 0) rec.pairs.push(pairs[i++]);
    if (t === "POLYLINE") {
      rec.vertices = [];
      poly = rec;
      ents.push(rec);
    } else if (t === "VERTEX" && poly) poly.vertices!.push(rec);
    else if (t === "SEQEND") poly = null;
    else {
      poly = null;
      ents.push(rec);
    }
  }
  return { ents, next: i };
}

interface Ctx {
  unit: number;
  blocks: Map<string, RawBlock>;
  layers: Map<string, Layer>;
  report: DxfImportReport;
  out: Entity[];
}

const bump = (rec: Record<string, number>, k: string, n = 1) => (rec[k] = (rec[k] ?? 0) + n);

function style(r: RawEnt, inherit: { layer: string; color: number | null } | null) {
  let layer = s(r, 8, "0") || "0";
  let color: number | null = has(r, 62) ? f(r, 62) : null;
  if (color === 256) color = null;
  if (inherit) {
    if (layer === "0") layer = inherit.layer;
    if (color === 0 || color === null) color = color === 0 ? inherit.color : color;
  }
  if (color === 0) color = null;
  if (color !== null) color = Math.abs(Math.round(color)) || null;
  let lt: string | null = s(r, 6, "") || null;
  if (lt && (lt.toUpperCase() === "BYLAYER" || lt.toUpperCase() === "BYBLOCK")) lt = null;
  if (lt) lt = linetypeByName(lt).name;
  // 370: espessura em centésimos de mm (−1 camada, −2 bloco, −3 padrão)
  const lwRaw = has(r, 370) ? f(r, 370) : -1;
  return { layer, color, linetype: lt, lineweight: lwRaw >= 0 ? lwRaw / 100 : (null as number | null) };
}

/** OCS com extrusão (0,0,−1): espelho em X (caso comum em DXFs gerados por CAM). */
function ocsMirror(r: RawEnt): boolean {
  return has(r, 230) && f(r, 230, 1) < 0;
}

function emit(ctx: Ctx, e: Entity, m: Affine) {
  let ent = e;
  if (m !== IDENTITY) {
    if (!isConformal(m)) {
      const t = transformEntityAffine(e, m);
      if (!t) {
        bump(ctx.report.unsupported, `${e.type.toUpperCase()} em bloco com escala não uniforme`);
        return;
      }
      ent = t;
    } else ent = transformEntity(e, m);
  }
  if (!ctx.layers.has(ent.layer)) ctx.layers.set(ent.layer, { ...DEFAULT_LAYER, name: ent.layer });
  ctx.out.push(ent);
}

function convert(ctx: Ctx, r: RawEnt, m: Affine, inherit: { layer: string; color: number | null } | null, depth: number) {
  const st = style(r, inherit);
  const k = ctx.unit;
  const mir = ocsMirror(r);
  const P = (cx: number, cy: number): Vec2 => ({ x: (mir ? -f(r, cx) : f(r, cx)) * k, y: f(r, cy) * k });
  switch (r.type) {
    case "LINE": {
      const a = P(10, 20);
      const b = P(11, 21);
      if (dist(a, b) < 1e-12) {
        bump(ctx.report.unsupported, "LINE de comprimento zero");
        return;
      }
      emit(ctx, makeEntity({ type: "line", a, b }, st.layer, st), m);
      bump(ctx.report.counts, "LINE");
      return;
    }
    case "CIRCLE": {
      const rr = f(r, 40) * k;
      if (!(rr > 0)) return;
      emit(ctx, makeEntity({ type: "circle", c: P(10, 20), r: rr }, st.layer, st), m);
      bump(ctx.report.counts, "CIRCLE");
      return;
    }
    case "ARC": {
      const rr = f(r, 40) * k;
      if (!(rr > 0)) return;
      let a0 = deg2rad(f(r, 50));
      let a1 = deg2rad(f(r, 51));
      if (mir) [a0, a1] = [Math.PI - a1, Math.PI - a0];
      emit(ctx, makeEntity({ type: "arc", c: P(10, 20), r: rr, a0: normAngle(a0), a1: normAngle(a1) }, st.layer, st), m);
      bump(ctx.report.counts, "ARC");
      return;
    }
    case "POINT":
      emit(ctx, makeEntity({ type: "point", p: P(10, 20) }, st.layer, st), m);
      bump(ctx.report.counts, "POINT");
      return;
    case "LWPOLYLINE": {
      const pts: Vec2[] = [];
      const bulges: number[] = [];
      for (const p of r.pairs) {
        if (p.c === 10) {
          pts.push({ x: Number.parseFloat(p.v) * k * (mir ? -1 : 1), y: 0 });
          bulges.push(0);
        } else if (p.c === 20 && pts.length) pts[pts.length - 1] = { ...pts[pts.length - 1], y: Number.parseFloat(p.v) * k };
        else if (p.c === 42 && bulges.length) bulges[bulges.length - 1] = Number.parseFloat(p.v) * (mir ? -1 : 1);
      }
      const closed = (f(r, 70) & 1) === 1;
      if (pts.length < 2) return;
      if (has(r, 43) && f(r, 43) > 0) ctx.report.warnings.push("LWPOLYLINE com largura: largura ignorada (apenas geometria central).");
      emit(ctx, makeEntity({ type: "polyline", pts, bulges, closed }, st.layer, st), m);
      bump(ctx.report.counts, "LWPOLYLINE");
      return;
    }
    case "POLYLINE": {
      const flags = f(r, 70);
      if (flags & (16 | 64)) {
        bump(ctx.report.unsupported, "POLYLINE malha/poliface");
        return;
      }
      if (flags & 8) {
        const vs3 = (r.vertices ?? []).filter((v) => !(f(v, 70) & 16));
        if (vs3.some((v) => Math.abs(f(v, 30)) > 1e-9)) ctx.report.warnings.push("POLYLINE 3D projetada no plano XY (Z descartado).");
      }
      const vs = (r.vertices ?? []).filter((v) => !(f(v, 70) & 16)); // ignora pontos de controle de spline
      if (flags & 4) ctx.report.warnings.push("POLYLINE ajustada por spline: importados os vértices de ajuste.");
      const pts = vs.map((v) => ({ x: f(v, 10) * k * (mir ? -1 : 1), y: f(v, 20) * k }));
      const bulges = vs.map((v) => f(v, 42) * (mir ? -1 : 1));
      if (pts.length < 2) return;
      emit(ctx, makeEntity({ type: "polyline", pts, bulges, closed: (flags & 1) === 1 }, st.layer, st), m);
      bump(ctx.report.counts, "POLYLINE");
      return;
    }
    case "ELLIPSE": {
      const ratio = f(r, 40, 1);
      const major = { x: f(r, 11) * k, y: f(r, 21) * k };
      if (!(ratio > 0) || Math.hypot(major.x, major.y) < 1e-12) {
        bump(ctx.report.unsupported, "ELLIPSE inválida");
        return;
      }
      let t0 = f(r, 41, 0);
      let t1 = f(r, 42, TAU);
      if (Math.abs(t1 - t0) >= TAU - 1e-9 || Math.abs(t1 - t0) < 1e-12) {
        t0 = 0;
        t1 = TAU;
      } else {
        t0 = normAngle(t0);
        t1 = normAngle(t1);
      }
      let e: Entity = makeEntity({ type: "ellipse", c: { x: f(r, 10) * k, y: f(r, 20) * k }, major, ratio: Math.min(1, ratio), t0, t1 }, st.layer, st);
      if (mir) e = transformEntity(e, MIRROR_X);
      emit(ctx, e, m);
      bump(ctx.report.counts, "ELLIPSE");
      return;
    }
    case "SPLINE": {
      const flags = f(r, 70);
      const degree = f(r, 71, 3);
      const knots: number[] = [];
      const weights: number[] = [];
      const ctrl: Vec2[] = [];
      const fit: Vec2[] = [];
      for (const p of r.pairs) {
        if (p.c === 40) knots.push(num(p.v));
        else if (p.c === 41) weights.push(num(p.v));
        else if (p.c === 10) ctrl.push({ x: num(p.v) * k, y: 0 });
        else if (p.c === 20 && ctrl.length) ctrl[ctrl.length - 1] = { ...ctrl[ctrl.length - 1], y: num(p.v) * k };
        else if (p.c === 11) fit.push({ x: num(p.v) * k, y: 0 });
        else if (p.c === 21 && fit.length) fit[fit.length - 1] = { ...fit[fit.length - 1], y: num(p.v) * k };
      }
      const closed = (flags & 1) === 1;
      let geom: SplineGeom = {
        degree,
        ctrl,
        knots,
        weights: weights.length === ctrl.length && weights.some((w) => Math.abs(w - 1) > 1e-12) ? weights : null,
        closed,
        fit: fit.length ? fit : undefined,
      };
      if (!splineValid(geom)) {
        if (ctrl.length >= 2 && ctrl.length >= degree + 1 && !knots.length) geom = { ...geom, knots: clampedKnots(ctrl.length, degree) };
        else if (fit.length >= 2) geom = { ...interpolateSpline(fit, degree), closed };
        if (!splineValid(geom)) {
          bump(ctx.report.unsupported, "SPLINE inválido");
          return;
        }
      }
      let e: Entity = makeEntity({ type: "spline", ...geom }, st.layer, st);
      if (mir) e = transformEntity(e, MIRROR_X);
      emit(ctx, e, m);
      bump(ctx.report.counts, "SPLINE");
      return;
    }
    case "HATCH": {
      const h = parseHatch(r, k, ctx.report);
      if (!h || !h.loops.length) {
        bump(ctx.report.unsupported, "HATCH sem contorno");
        return;
      }
      let e: Entity = makeEntity(
        { type: "hatch", loops: h.loops, solid: h.solid, pattern: h.pattern, patternAngle: h.angle, patternScale: h.scale, lines: h.lines },
        st.layer,
        st,
      );
      if (mir) e = transformEntity(e, MIRROR_X);
      emit(ctx, e, m);
      bump(ctx.report.counts, "HATCH");
      return;
    }
    case "SOLID":
    case "TRACE": {
      // vértices na ordem 1-2-4-3 do DXF; triângulo quando 3 = 4
      const q = [P(10, 20), P(11, 21), P(13, 23), P(12, 22)];
      const pts = q.filter((p, j) => j === 0 || dist(p, q[j - 1]) > 1e-12);
      if (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < 1e-12) pts.pop();
      if (pts.length < 3) return;
      emit(
        ctx,
        makeEntity({ type: "hatch", loops: [{ pts, bulges: pts.map(() => 0) }], solid: true, pattern: "SOLID", patternAngle: 0, patternScale: 1, lines: [] }, st.layer, st),
        m,
      );
      bump(ctx.report.counts, r.type);
      return;
    }
    case "TEXT": {
      const value = fromDxfText(s(r, 1));
      const hal = f(r, 72);
      const useAlign = (hal !== 0 || f(r, 73) !== 0) && has(r, 11);
      const p = useAlign ? P(11, 21) : P(10, 20);
      const halign = (hal === 1 || hal === 4 ? 1 : hal === 2 ? 2 : 0) as 0 | 1 | 2;
      emit(
        ctx,
        makeEntity({ type: "text", p, h: f(r, 40, 2.5) * k, rot: deg2rad(f(r, 50)), value, halign }, st.layer, st),
        m,
      );
      bump(ctx.report.counts, "TEXT");
      return;
    }
    case "MTEXT": {
      const raw = r.pairs.filter((p) => p.c === 3 || p.c === 1).map((p) => p.v).join("");
      const value = fromDxfText(mtextPlain(raw)).replace(/\n+$/, "");
      const h = f(r, 40, 2.5) * k;
      const rot = has(r, 50) ? deg2rad(f(r, 50)) : Math.atan2(f(r, 21), f(r, 11, 1));
      // ponto de anexação 1..9 (linha: topo/meio/base; coluna: esq./centro/dir.) → base da 1ª linha
      const att = Math.min(9, Math.max(1, Math.round(f(r, 71, 1))));
      const col = (att - 1) % 3;
      const row = Math.floor((att - 1) / 3);
      const nLines = value.split("\n").length;
      const H = h + (nLines - 1) * h * TEXT_LINE_SPACING;
      const dy = row === 0 ? -h : row === 1 ? H / 2 - h : (nLines - 1) * h * TEXT_LINE_SPACING;
      const ins = P(10, 20);
      const p = { x: ins.x - Math.sin(rot) * dy, y: ins.y + Math.cos(rot) * dy };
      emit(ctx, makeEntity({ type: "text", p, h, rot, value, halign: col as 0 | 1 | 2 }, st.layer, st), m);
      bump(ctx.report.counts, "MTEXT");
      return;
    }
    case "INSERT": {
      if (depth > 16) {
        bump(ctx.report.unsupported, "INSERT aninhado além de 16 níveis");
        return;
      }
      const name = s(r, 2);
      const blk = ctx.blocks.get(name);
      if (!blk) {
        bump(ctx.report.unsupported, "INSERT de bloco inexistente");
        return;
      }
      if (f(r, 70, 1) > 1 || f(r, 71, 1) > 1) ctx.report.warnings.push(`INSERT em matriz (MINSERT) de "${name}": apenas a primeira ocorrência.`);
      const sx = has(r, 41) ? f(r, 41, 1) : 1;
      const sy = has(r, 42) ? f(r, 42, 1) : 1;
      const pos = P(10, 20);
      const rot = deg2rad(f(r, 50)) * (mir ? -1 : 1);
      const scaleM: Affine = { a: sx * (mir ? -1 : 1), b: 0, c: 0, d: sy, e: 0, f: 0 };
      const local = compose(
        translation(pos.x, pos.y),
        compose(rotation(rot), compose(scaleM, translation(-blk.base.x * k, -blk.base.y * k))),
      );
      const total = compose(m, local);
      const inh = { layer: st.layer, color: st.color };
      for (const be of blk.ents) convert(ctx, be, total, inh, depth + 1);
      bump(ctx.report.counts, "INSERT");
      return;
    }
    case "DIMENSION": {
      const type = f(r, 70) & 7;
      const txt = s(r, 1, "");
      const textOverride = txt === "" || txt === "<>" ? null : fromDxfText(txt);
      const assoc: { p1?: PointRef } | null = null;
      if (type === 0 || type === 1) {
        const e = makeEntity(
          {
            type: "dimension",
            kind: type === 0 ? "linear" : "aligned",
            p1: P(13, 23),
            p2: P(14, 24),
            loc: P(10, 20),
            rot: deg2rad(f(r, 50)),
            textOverride,
            assoc,
          },
          st.layer,
          st,
        );
        emit(ctx, e, m);
        bump(ctx.report.counts, "DIMENSION");
        return;
      }
      if (type === 3 || type === 4) {
        const p10 = P(10, 20);
        const p15 = P(15, 25);
        const c = type === 4 ? p10 : mid(p10, p15);
        const e = makeEntity(
          {
            type: "dimension",
            kind: type === 4 ? "radius" : "diameter",
            p1: c,
            p2: p15,
            loc: has(r, 11) ? P(11, 21) : p15,
            rot: 0,
            textOverride,
            assoc,
          },
          st.layer,
          st,
        );
        emit(ctx, e, m);
        bump(ctx.report.counts, "DIMENSION");
        return;
      }
      const blk = ctx.blocks.get(s(r, 2));
      if (blk) {
        for (const be of blk.ents) convert(ctx, be, m, { layer: st.layer, color: st.color }, depth + 1);
        bump(ctx.report.counts, "DIMENSION (convertida em geometria)");
      } else bump(ctx.report.unsupported, "DIMENSION angular/ordenada sem bloco");
      return;
    }
    case "LEADER": {
      const pts: Vec2[] = [];
      for (const p of r.pairs) {
        if (p.c === 10) pts.push({ x: num(p.v) * k * (mir ? -1 : 1), y: 0 });
        else if (p.c === 20 && pts.length) pts[pts.length - 1] = { ...pts[pts.length - 1], y: num(p.v) * k };
      }
      if (pts.length < 2) return;
      emit(ctx, makeEntity({ type: "polyline", pts, bulges: pts.map(() => 0), closed: false }, st.layer, st), m);
      // seta (triângulo fechado) na ponta, se o LEADER tiver seta (71 = 1)
      if (f(r, 71, 1) === 1) {
        const [a, b] = [pts[0], pts[1]];
        const L = dist(a, b);
        if (L > 1e-9) {
          const sz = Math.min(2.5 * k, L / 3);
          const ux = (b.x - a.x) / L;
          const uy = (b.y - a.y) / L;
          const base = { x: a.x + ux * sz, y: a.y + uy * sz };
          const w = sz / 6;
          const tri = [a, { x: base.x - uy * w, y: base.y + ux * w }, { x: base.x + uy * w, y: base.y - ux * w }];
          emit(ctx, makeEntity({ type: "hatch", loops: [{ pts: tri, bulges: [0, 0, 0] }], solid: true, pattern: "SOLID", patternAngle: 0, patternScale: 1, lines: [] }, st.layer, st), m);
        }
      }
      bump(ctx.report.counts, "LEADER");
      return;
    }
    case "ACAD_TABLE": {
      // a tabela traz um bloco anônimo (*T…) com a sua aparência: insere esse bloco
      const blk = ctx.blocks.get(s(r, 2));
      if (!blk) {
        bump(ctx.report.unsupported, "ACAD_TABLE sem bloco");
        return;
      }
      const pos = P(10, 20);
      const local = compose(translation(pos.x, pos.y), translation(-blk.base.x * k, -blk.base.y * k));
      for (const be of blk.ents) convert(ctx, be, compose(m, local), { layer: st.layer, color: st.color }, depth + 1);
      bump(ctx.report.counts, "ACAD_TABLE (convertida em geometria)");
      return;
    }
    case "VIEWPORT":
    case "ATTDEF":
    case "ATTRIB":
      return;
    default:
      bump(ctx.report.unsupported, r.type);
  }
}

/** Importa DXF ASCII. Aceita string (já decodificada) ou bytes (decodificação automática). */
export function readDxf(input: string | Uint8Array): DxfImportResult {
  let text: string;
  let encoding = "string";
  if (typeof input === "string") text = input;
  else ({ text, encoding } = decodeDxfBytes(input));
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const pairs = tokenize(text);
  const report: DxfImportReport = {
    version: "AC1009",
    encoding,
    unitFactor: 1,
    unitSource: "assumido",
    counts: {},
    unsupported: {},
    warnings: [],
  };
  const layers = new Map<string, Layer>();
  const blocks = new Map<string, RawBlock>();
  let entities: RawEnt[] = [];
  let insunits = 0;

  let i = 0;
  while (i < pairs.length) {
    const p = pairs[i];
    if (p.c === 0 && p.v.trim() === "SECTION") {
      const name = pairs[i + 1]?.v.trim();
      i += 2;
      if (name === "HEADER") {
        while (i < pairs.length && !(pairs[i].c === 0 && pairs[i].v.trim() === "ENDSEC")) {
          if (pairs[i].c === 9) {
            const v = pairs[i].v.trim();
            if (v === "$ACADVER") report.version = pairs[i + 1].v.trim();
            if (v === "$INSUNITS") insunits = Number.parseInt(pairs[i + 1].v.trim(), 10);
          }
          i++;
        }
      } else if (name === "TABLES") {
        while (i < pairs.length && !(pairs[i].c === 0 && pairs[i].v.trim() === "ENDSEC")) {
          if (pairs[i].c === 0 && pairs[i].v.trim() === "LAYER") {
            const rec: RawEnt = { type: "LAYER", pairs: [] };
            i++;
            while (i < pairs.length && pairs[i].c !== 0) rec.pairs.push(pairs[i++]);
            const lname = s(rec, 2).trim();
            if (!lname) continue;
            const col = f(rec, 62, 7);
            const flags = f(rec, 70);
            const lw = has(rec, 370) ? f(rec, 370) : -3;
            layers.set(lname, {
              name: lname,
              color: Math.abs(col) || 7,
              lineweight: lw >= 0 ? lw / 100 : DEFAULT_LAYER.lineweight,
              linetype: linetypeByName(s(rec, 6, "CONTINUOUS")).name,
              visible: col >= 0 && (flags & 1) === 0,
              locked: (flags & 4) === 4,
            });
            continue;
          }
          i++;
        }
      } else if (name === "BLOCKS") {
        while (i < pairs.length && !(pairs[i].c === 0 && pairs[i].v.trim() === "ENDSEC")) {
          if (pairs[i].c === 0 && pairs[i].v.trim() === "BLOCK") {
            const hdr: RawEnt = { type: "BLOCK", pairs: [] };
            i++;
            while (i < pairs.length && pairs[i].c !== 0) hdr.pairs.push(pairs[i++]);
            const res = readEntitiesBlock(pairs, i, ["ENDBLK"]);
            blocks.set(s(hdr, 2).trim(), { name: s(hdr, 2).trim(), base: { x: f(hdr, 10), y: f(hdr, 20) }, ents: res.ents });
            i = res.next + 1;
            while (i < pairs.length && pairs[i].c !== 0) i++;
            continue;
          }
          i++;
        }
      } else if (name === "ENTITIES") {
        const res = readEntitiesBlock(pairs, i, ["ENDSEC"]);
        entities = res.ents;
        i = res.next;
      } else {
        while (i < pairs.length && !(pairs[i].c === 0 && pairs[i].v.trim() === "ENDSEC")) i++;
      }
    }
    i++;
  }

  const factor = insunitsToMM(insunits);
  if (factor !== null) {
    report.unitFactor = factor;
    report.unitSource = "INSUNITS";
  } else {
    report.warnings.push("Arquivo sem unidade definida ($INSUNITS ausente ou 0): coordenadas interpretadas como milímetros.");
  }
  const ctx: Ctx = { unit: report.unitFactor, blocks, layers, report, out: [] };
  if (!layers.has("0")) layers.set("0", DEFAULT_LAYER);
  for (const r of entities) convert(ctx, r, IDENTITY, null, 0);
  report.warnings = [...new Set(report.warnings)];
  return { layers: [...layers.values()], entities: ctx.out, report };
}
