import {
  type DimStyle,
  type Entity,
  DEFAULT_DIMSTYLE,
  boxUnion,
  ccwSweep,
  dimensionGeometry,
  emptyBox,
  entityBox,
  normAngle,
  rad2deg,
} from "@agtn/geometry";
import { type Layer, LINETYPES } from "@agtn/document";
import { encodeCp1252, toDxfText } from "./encoding";

/**
 * Escritor DXF R12 (AC1009), ASCII, Windows-1252.
 *
 * Escolha do R12: é a versão lida por praticamente todo software CAD/CAM (AutoCAD, DraftSight,
 * BricsCAD, LibreCAD, CAMs de corte laser/plasma/dobra). Limitações documentadas:
 *  - R12 não armazena unidades ($INSUNITS é R2000+): coordenadas exportadas em mm.
 *  - R12 não armazena espessura de linha (lineweight): a espessura fica apenas no AGTN CAD.
 *  - Polilinhas exportadas como POLYLINE/VERTEX/SEQEND (LWPOLYLINE é R14+), com bulges preservados.
 *  - Cotas são exportadas "explodidas" (LINE/SOLID/ARC/TEXT na camada da cota) para aparência idêntica
 *    em qualquer leitor; a associatividade não é exportada.
 */
export interface DxfWriteInput {
  layers: readonly Layer[];
  entities: readonly Entity[];
  dimStyle?: DimStyle;
}

export interface DxfWriteOptions {
  /** Exporta apenas estas camadas (padrão: todas) */
  layerFilter?: readonly string[];
  /** Inclui camadas ocultas (padrão: true; o estado oculto é preservado como cor negativa) */
  includeHidden?: boolean;
}

/** Formata número com precisão total de ida-e-volta, sem notação científica. */
export function num(v: number): string {
  if (!Number.isFinite(v)) throw new Error("Coordenada não finita na exportação DXF.");
  if (v === 0 || Object.is(v, -0)) return "0.0";
  let s = String(v);
  if (/e/i.test(s)) {
    s = v.toFixed(20).replace(/0+$/, "");
    if (s.endsWith(".")) s += "0";
    return s;
  }
  if (!s.includes(".")) s += ".0";
  return s;
}

class Out {
  private parts: string[] = [];
  g(code: number, value: string | number) {
    this.parts.push(String(code).padStart(3, " "), "\r\n", typeof value === "number" ? num(value) : value, "\r\n");
  }
  i(code: number, value: number) {
    this.parts.push(String(code).padStart(3, " "), "\r\n", String(Math.trunc(value)).padStart(6, " "), "\r\n");
  }
  toString() {
    return this.parts.join("");
  }
}

export function writeDxfR12(input: DxfWriteInput, opts: DxfWriteOptions = {}): string {
  const st = input.dimStyle ?? DEFAULT_DIMSTYLE;
  const filter = opts.layerFilter ? new Set(opts.layerFilter) : null;
  const layers = input.layers.filter((l) => (!filter || filter.has(l.name) || l.name === "0") && (opts.includeHidden ?? true ? true : l.visible));
  const layerSet = new Set(layers.map((l) => l.name));
  const ents = input.entities.filter((e) => layerSet.has(e.layer) && (!filter || filter.has(e.layer)));

  let box = emptyBox();
  for (const e of ents) box = boxUnion(box, entityBox(e));
  if (!Number.isFinite(box.minX)) box = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  const o = new Out();
  // HEADER
  o.g(0, "SECTION");
  o.g(2, "HEADER");
  o.g(9, "$ACADVER");
  o.g(1, "AC1009");
  o.g(9, "$DWGCODEPAGE");
  o.g(3, "ANSI_1252");
  o.g(9, "$INSBASE");
  o.g(10, 0);
  o.g(20, 0);
  o.g(30, 0);
  o.g(9, "$EXTMIN");
  o.g(10, box.minX);
  o.g(20, box.minY);
  o.g(30, 0);
  o.g(9, "$EXTMAX");
  o.g(10, box.maxX);
  o.g(20, box.maxY);
  o.g(30, 0);
  o.g(9, "$LUNITS");
  o.i(70, 2);
  o.g(9, "$LUPREC");
  o.i(70, 4);
  o.g(9, "$TEXTSTYLE");
  o.g(7, "STANDARD");
  o.g(9, "$CLAYER");
  o.g(8, "0");
  o.g(0, "ENDSEC");

  // TABLES
  o.g(0, "SECTION");
  o.g(2, "TABLES");
  const usedLt = new Set<string>(["CONTINUOUS"]);
  for (const l of layers) usedLt.add(l.linetype.toUpperCase());
  for (const e of ents) if (e.linetype) usedLt.add(e.linetype.toUpperCase());
  const lts = LINETYPES.filter((l) => usedLt.has(l.name));
  o.g(0, "TABLE");
  o.g(2, "LTYPE");
  o.i(70, lts.length);
  for (const lt of lts) {
    o.g(0, "LTYPE");
    o.g(2, lt.name);
    o.i(70, 0);
    o.g(3, lt.description.replace(/[^\x20-\x7e]/g, "-"));
    o.i(72, 65);
    o.i(73, lt.pattern.length);
    o.g(40, lt.pattern.reduce((s, v) => s + Math.abs(v), 0));
    for (const p of lt.pattern) o.g(49, p);
  }
  o.g(0, "ENDTAB");
  o.g(0, "TABLE");
  o.g(2, "LAYER");
  o.i(70, layers.length);
  for (const l of layers) {
    o.g(0, "LAYER");
    o.g(2, l.name);
    o.i(70, l.locked ? 4 : 0);
    const c = Math.max(1, Math.min(255, Math.round(l.color)));
    o.i(62, l.visible ? c : -c);
    o.g(6, l.linetype.toUpperCase());
  }
  o.g(0, "ENDTAB");
  o.g(0, "TABLE");
  o.g(2, "STYLE");
  o.i(70, 1);
  o.g(0, "STYLE");
  o.g(2, "STANDARD");
  o.i(70, 0);
  o.g(40, 0);
  o.g(41, 1);
  o.g(50, 0);
  o.i(71, 0);
  o.g(42, 2.5);
  o.g(3, "txt");
  o.g(4, "");
  o.g(0, "ENDTAB");
  o.g(0, "ENDSEC");

  o.g(0, "SECTION");
  o.g(2, "BLOCKS");
  o.g(0, "ENDSEC");

  // ENTITIES
  o.g(0, "SECTION");
  o.g(2, "ENTITIES");
  for (const e of ents) writeEntity(o, e, st);
  o.g(0, "ENDSEC");
  o.g(0, "EOF");
  return o.toString();
}

function common(o: Out, e: Pick<Entity, "layer" | "color" | "linetype">) {
  o.g(8, e.layer);
  if (e.linetype) o.g(6, e.linetype.toUpperCase());
  if (e.color != null) o.i(62, e.color);
}

function writeEntity(o: Out, e: Entity, st: DimStyle) {
  switch (e.type) {
    case "line":
      o.g(0, "LINE");
      common(o, e);
      o.g(10, e.a.x);
      o.g(20, e.a.y);
      o.g(30, 0);
      o.g(11, e.b.x);
      o.g(21, e.b.y);
      o.g(31, 0);
      return;
    case "circle":
      o.g(0, "CIRCLE");
      common(o, e);
      o.g(10, e.c.x);
      o.g(20, e.c.y);
      o.g(30, 0);
      o.g(40, e.r);
      return;
    case "arc": {
      const sw = ccwSweep(e.a0, e.a1);
      o.g(0, "ARC");
      common(o, e);
      o.g(10, e.c.x);
      o.g(20, e.c.y);
      o.g(30, 0);
      o.g(40, e.r);
      o.g(50, rad2deg(normAngle(e.a0)));
      o.g(51, rad2deg(normAngle(e.a0 + sw)));
      return;
    }
    case "point":
      o.g(0, "POINT");
      common(o, e);
      o.g(10, e.p.x);
      o.g(20, e.p.y);
      o.g(30, 0);
      return;
    case "polyline": {
      o.g(0, "POLYLINE");
      common(o, e);
      o.i(66, 1);
      o.g(10, 0);
      o.g(20, 0);
      o.g(30, 0);
      o.i(70, e.closed ? 1 : 0);
      e.pts.forEach((p, i) => {
        o.g(0, "VERTEX");
        o.g(8, e.layer);
        o.g(10, p.x);
        o.g(20, p.y);
        o.g(30, 0);
        const b = e.bulges[i] ?? 0;
        if (b !== 0) o.g(42, b);
      });
      o.g(0, "SEQEND");
      o.g(8, e.layer);
      return;
    }
    case "text":
      writeText(o, e, e.p, e.h, e.rot, e.value, e.halign);
      return;
    case "dimension": {
      const g = dimensionGeometry(e, st);
      const base = { layer: e.layer, color: e.color, linetype: null };
      for (const [a, b] of g.lines) {
        o.g(0, "LINE");
        common(o, base);
        o.g(10, a.x);
        o.g(20, a.y);
        o.g(30, 0);
        o.g(11, b.x);
        o.g(21, b.y);
        o.g(31, 0);
      }
      for (const s of g.solids) {
        o.g(0, "SOLID");
        common(o, base);
        const [p1, p2, p3] = s;
        const p4 = s[3] ?? p3;
        o.g(10, p1.x);
        o.g(20, p1.y);
        o.g(30, 0);
        o.g(11, p2.x);
        o.g(21, p2.y);
        o.g(31, 0);
        o.g(12, p3.x);
        o.g(22, p3.y);
        o.g(32, 0);
        o.g(13, p4.x);
        o.g(23, p4.y);
        o.g(33, 0);
      }
      for (const a of g.arcs) {
        o.g(0, "ARC");
        common(o, base);
        o.g(10, a.c.x);
        o.g(20, a.c.y);
        o.g(30, 0);
        o.g(40, a.r);
        o.g(50, rad2deg(normAngle(a.a0)));
        o.g(51, rad2deg(normAngle(a.a1)));
      }
      if (g.text.value) writeText(o, base, g.text.p, g.text.h, g.text.rot, g.text.value, 1);
      return;
    }
  }
}

function writeText(
  o: Out,
  base: Pick<Entity, "layer" | "color" | "linetype">,
  p: { x: number; y: number },
  h: number,
  rot: number,
  value: string,
  halign: 0 | 1 | 2,
) {
  o.g(0, "TEXT");
  common(o, base);
  o.g(10, p.x);
  o.g(20, p.y);
  o.g(30, 0);
  o.g(40, h);
  o.g(1, toDxfText(value));
  if (rot !== 0) o.g(50, rad2deg(normAngle(rot)));
  o.g(7, "STANDARD");
  if (halign !== 0) {
    o.i(72, halign);
    o.g(11, p.x);
    o.g(21, p.y);
    o.g(31, 0);
  }
}

/** Gera os bytes do arquivo (Windows-1252). */
export function dxfBytes(text: string): Uint8Array {
  return encodeCp1252(text);
}
