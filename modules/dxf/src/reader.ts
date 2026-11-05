import {
  type Affine,
  type Entity,
  type PointRef,
  type Vec2,
  IDENTITY,
  applyPt,
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
} from "@agtn/geometry";
import { DEFAULT_LAYER, type Layer, linetypeByName } from "@agtn/document";
import { decodeDxfBytes, fromDxfText } from "./encoding";

/**
 * Leitor DXF ASCII (R12 até versões atuais).
 *
 * Entidades suportadas: LINE, CIRCLE, ARC, POINT, LWPOLYLINE, POLYLINE 2D (+VERTEX/SEQEND),
 * TEXT, MTEXT (texto simples), INSERT (blocos expandidos com transformação), DIMENSION
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
  return { layer, color, linetype: lt, lineweight: null as number | null };
}

/** OCS com extrusão (0,0,−1): espelho em X (caso comum em DXFs gerados por CAM). */
function ocsMirror(r: RawEnt): boolean {
  return has(r, 230) && f(r, 230, 1) < 0;
}

function emit(ctx: Ctx, e: Entity, m: Affine) {
  let ent = e;
  if (m !== IDENTITY) {
    if (!isConformal(m)) {
      if (e.type === "line") ent = { ...e, a: applyPt(m, e.a), b: applyPt(m, e.b) };
      else if (e.type === "point") ent = { ...e, p: applyPt(m, e.p) };
      else if (e.type === "polyline" && e.bulges.every((b) => b === 0)) ent = { ...e, pts: e.pts.map((p) => applyPt(m, p)) };
      else {
        bump(ctx.report.unsupported, `${e.type.toUpperCase()} em bloco com escala não uniforme`);
        return;
      }
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
      if (flags & (8 | 16 | 64)) {
        bump(ctx.report.unsupported, flags & 8 ? "POLYLINE 3D" : "POLYLINE malha/poliface");
        return;
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
      const value = fromDxfText(raw)
        .replace(/\\P/g, " ")
        .replace(/\\[A-Za-z][^;]*;/g, "")
        .replace(/[{}]/g, "");
      const rot = has(r, 50) ? deg2rad(f(r, 50)) : Math.atan2(f(r, 21), f(r, 11, 1));
      emit(ctx, makeEntity({ type: "text", p: P(10, 20), h: f(r, 40, 2.5) * k, rot, value, halign: 0 }, st.layer, st), m);
      bump(ctx.report.counts, "MTEXT");
      ctx.report.warnings.push("MTEXT importado como texto simples (formatação descartada).");
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
