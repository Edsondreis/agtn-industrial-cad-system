import {
  type DimStyle,
  type Entity,
  DEFAULT_DIMSTYLE,
  TEXT_LINE_SPACING,
  boxUnion,
  ccwSweep,
  dimensionGeometry,
  emptyBox,
  entityBox,
  isFullEllipse,
  normAngle,
  rad2deg,
} from "@agtn/geometry";
import { LINETYPES, LINEWEIGHTS_MM } from "@agtn/document";
import { encodeCp1252 } from "./encoding";
import { type DxfWriteInput, type DxfWriteOptions, num } from "./writer";

/**
 * Escritor DXF R2000 (AC1015), ASCII, Windows-1252.
 *
 * Diferente do R12, guarda tudo que o AGTN CAD tem de forma nativa:
 *  - ELLIPSE, SPLINE (NURBS), HATCH (contornos com arcos, sólida ou padrão), LWPOLYLINE, MTEXT;
 *  - unidade do desenho ($INSUNITS = mm) e espessura de linha (370) em camadas e objetos.
 * Estrutura completa exigida pelo AutoCAD 2000+: handles, BLOCK_RECORD, *Model_Space/*Paper_Space,
 * dicionário raiz, layouts e estilo de plotagem "Normal". Cotas continuam "explodidas" (aparência
 * idêntica em qualquer leitor). Caracteres fora do Windows-1252 vão como \U+XXXX.
 */
export function writeDxf2000(input: DxfWriteInput, opts: DxfWriteOptions = {}): string {
  const st = input.dimStyle ?? DEFAULT_DIMSTYLE;
  const filter = opts.layerFilter ? new Set(opts.layerFilter) : null;
  const layers = input.layers.filter((l) => (!filter || filter.has(l.name) || l.name === "0") && ((opts.includeHidden ?? true) ? true : l.visible));
  if (!layers.some((l) => l.name === "0")) layers.unshift({ name: "0", color: 7, lineweight: 0.25, linetype: "CONTINUOUS", visible: true, locked: false });
  const layerSet = new Set(layers.map((l) => l.name));
  const ents = input.entities.filter((e) => layerSet.has(e.layer) && (!filter || filter.has(e.layer)));

  let box = emptyBox();
  for (const e of ents) box = boxUnion(box, entityBox(e));
  if (!Number.isFinite(box.minX)) box = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  let next = 1;
  const H = () => (next++).toString(16).toUpperCase();

  // handles fixos das tabelas/objetos (reservados antes para referências cruzadas)
  const h = {
    tVport: H(),
    tLtype: H(),
    tLayer: H(),
    tStyle: H(),
    tView: H(),
    tUcs: H(),
    tAppid: H(),
    tDimstyle: H(),
    tBlockRec: H(),
    root: H(),
    group: H(),
    layoutDict: H(),
    mlineDict: H(),
    plotStyleDict: H(),
    plotStyleNormal: H(),
    brModel: H(),
    brPaper: H(),
    layoutModel: H(),
    layoutPaper: H(),
    mlineStd: H(),
  };

  const usedLt = new Set<string>(["CONTINUOUS"]);
  for (const l of layers) usedLt.add(l.linetype.toUpperCase());
  for (const e of ents) if (e.linetype) usedLt.add(e.linetype.toUpperCase());
  const lts = LINETYPES.filter((l) => usedLt.has(l.name) && l.name !== "CONTINUOUS");

  const body = new Out();
  // ENTIDADES primeiro (para saber o $HANDSEED final)
  const ew = new EntWriter(body, H, h.brModel, st);
  for (const e of ents) ew.write(e);

  const o = new Out();
  o.g(0, "SECTION");
  o.g(2, "CLASSES");
  o.g(0, "ENDSEC");

  // TABLES
  o.g(0, "SECTION");
  o.g(2, "TABLES");
  const table = (name: string, handle: string, count: number, extra?: () => void) => {
    o.g(0, "TABLE");
    o.g(2, name);
    o.g(5, handle);
    o.g(330, "0");
    o.g(100, "AcDbSymbolTable");
    o.i(70, count);
    extra?.();
  };
  const rec = (type: string, owner: string, sub: string, handleCode = 5) => {
    o.g(0, type);
    o.g(handleCode, H());
    o.g(330, owner);
    o.g(100, "AcDbSymbolTableRecord");
    o.g(100, sub);
  };

  // VPORT *Active enquadrado na extensão do desenho (abre já com zoom no desenho)
  table("VPORT", h.tVport, 1);
  rec("VPORT", h.tVport, "AcDbViewportTableRecord");
  o.g(2, "*Active");
  o.i(70, 0);
  o.p2(10, 0, 0);
  o.p2(11, 1, 1);
  o.p2(12, (box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
  o.p2(13, 0, 0);
  o.p2(14, 10, 10);
  o.p2(15, 10, 10);
  o.p3(16, 0, 0, 1);
  o.p3(17, 0, 0, 0);
  o.g(40, Math.max(1, (box.maxY - box.minY) * 1.1, ((box.maxX - box.minX) * 1.1) / 1.6));
  o.g(41, 1.6);
  o.g(42, 50);
  o.g(43, 0);
  o.g(44, 0);
  o.g(50, 0);
  o.g(51, 0);
  o.i(71, 0);
  o.i(72, 1000);
  o.i(73, 1);
  o.i(74, 3);
  o.i(75, 0);
  o.i(76, 0);
  o.i(77, 0);
  o.i(78, 0);
  o.g(0, "ENDTAB");

  table("LTYPE", h.tLtype, 3 + lts.length);
  for (const [name, desc] of [
    ["ByBlock", ""],
    ["ByLayer", ""],
    ["Continuous", "Solid line"],
  ]) {
    rec("LTYPE", h.tLtype, "AcDbLinetypeTableRecord");
    o.g(2, name);
    o.i(70, 0);
    o.g(3, desc);
    o.i(72, 65);
    o.i(73, 0);
    o.g(40, 0);
  }
  for (const lt of lts) {
    rec("LTYPE", h.tLtype, "AcDbLinetypeTableRecord");
    o.g(2, lt.name);
    o.i(70, 0);
    o.g(3, lt.description.replace(/[^\x20-\x7e]/g, "-"));
    o.i(72, 65);
    o.i(73, lt.pattern.length);
    o.g(40, lt.pattern.reduce((s, v) => s + Math.abs(v), 0));
    for (const p of lt.pattern) {
      o.g(49, p);
      o.i(74, 0);
    }
  }
  o.g(0, "ENDTAB");

  table("LAYER", h.tLayer, layers.length);
  for (const l of layers) {
    rec("LAYER", h.tLayer, "AcDbLayerTableRecord");
    o.g(2, l.name);
    o.i(70, l.locked ? 4 : 0);
    const c = Math.max(1, Math.min(255, Math.round(l.color)));
    o.i(62, l.visible ? c : -c);
    o.g(6, ltName(l.linetype));
    o.i(370, lw100(l.lineweight));
    o.g(390, h.plotStyleNormal);
  }
  o.g(0, "ENDTAB");

  table("STYLE", h.tStyle, 1);
  rec("STYLE", h.tStyle, "AcDbTextStyleTableRecord");
  o.g(2, "Standard");
  o.i(70, 0);
  o.g(40, 0);
  o.g(41, 1);
  o.g(50, 0);
  o.i(71, 0);
  o.g(42, 2.5);
  o.g(3, "txt");
  o.g(4, "");
  o.g(0, "ENDTAB");

  table("VIEW", h.tView, 0);
  o.g(0, "ENDTAB");
  table("UCS", h.tUcs, 0);
  o.g(0, "ENDTAB");

  table("APPID", h.tAppid, 1);
  rec("APPID", h.tAppid, "AcDbRegAppTableRecord");
  o.g(2, "ACAD");
  o.i(70, 0);
  o.g(0, "ENDTAB");

  table("DIMSTYLE", h.tDimstyle, 1, () => o.g(100, "AcDbDimStyleTable"));
  rec("DIMSTYLE", h.tDimstyle, "AcDbDimStyleTableRecord", 105);
  o.g(2, "Standard");
  o.i(70, 0);
  o.g(41, st.arrowSize);
  o.g(42, st.extOffset);
  o.g(44, st.extBeyond);
  o.g(140, st.textHeight);
  o.g(147, st.textGap);
  o.i(77, 1);
  o.i(271, 2);
  o.i(278, 44);
  o.g(0, "ENDTAB");

  table("BLOCK_RECORD", h.tBlockRec, 2);
  for (const [handle, name, layout] of [
    [h.brModel, "*Model_Space", h.layoutModel],
    [h.brPaper, "*Paper_Space", h.layoutPaper],
  ]) {
    o.g(0, "BLOCK_RECORD");
    o.g(5, handle);
    o.g(330, h.tBlockRec);
    o.g(100, "AcDbSymbolTableRecord");
    o.g(100, "AcDbBlockTableRecord");
    o.g(2, name);
    o.g(340, layout);
  }
  o.g(0, "ENDTAB");
  o.g(0, "ENDSEC");

  // BLOCKS
  o.g(0, "SECTION");
  o.g(2, "BLOCKS");
  for (const [owner, name] of [
    [h.brModel, "*Model_Space"],
    [h.brPaper, "*Paper_Space"],
  ]) {
    o.g(0, "BLOCK");
    o.g(5, H());
    o.g(330, owner);
    o.g(100, "AcDbEntity");
    if (name === "*Paper_Space") o.i(67, 1);
    o.g(8, "0");
    o.g(100, "AcDbBlockBegin");
    o.g(2, name);
    o.i(70, 0);
    o.p3(10, 0, 0);
    o.g(3, name);
    o.g(1, "");
    o.g(0, "ENDBLK");
    o.g(5, H());
    o.g(330, owner);
    o.g(100, "AcDbEntity");
    if (name === "*Paper_Space") o.i(67, 1);
    o.g(8, "0");
    o.g(100, "AcDbBlockEnd");
  }
  o.g(0, "ENDSEC");

  o.g(0, "SECTION");
  o.g(2, "ENTITIES");
  o.raw(body.toString());
  o.g(0, "ENDSEC");

  // OBJECTS
  o.g(0, "SECTION");
  o.g(2, "OBJECTS");
  const dict = (handle: string, owner: string, entries: [string, string][]) => {
    o.g(0, "DICTIONARY");
    o.g(5, handle);
    o.g(330, owner);
    o.g(100, "AcDbDictionary");
    o.i(281, 1);
    for (const [k, v] of entries) {
      o.g(3, k);
      o.g(350, v);
    }
  };
  dict(h.root, "0", [
    ["ACAD_GROUP", h.group],
    ["ACAD_LAYOUT", h.layoutDict],
    ["ACAD_MLINESTYLE", h.mlineDict],
    ["ACAD_PLOTSTYLENAME", h.plotStyleDict],
  ]);
  dict(h.group, h.root, []);
  dict(h.layoutDict, h.root, [
    ["Model", h.layoutModel],
    ["Layout1", h.layoutPaper],
  ]);
  dict(h.mlineDict, h.root, [["Standard", h.mlineStd]]);
  o.g(0, "ACDBDICTIONARYWDFLT");
  o.g(5, h.plotStyleDict);
  o.g(330, h.root);
  o.g(100, "AcDbDictionary");
  o.i(281, 1);
  o.g(3, "Normal");
  o.g(350, h.plotStyleNormal);
  o.g(100, "AcDbDictionaryWithDefault");
  o.g(340, h.plotStyleNormal);
  o.g(0, "ACDBPLACEHOLDER");
  o.g(5, h.plotStyleNormal);
  o.g(330, h.plotStyleDict);
  o.g(0, "MLINESTYLE");
  o.g(5, h.mlineStd);
  o.g(330, h.mlineDict);
  o.g(100, "AcDbMlineStyle");
  o.g(2, "Standard");
  o.i(70, 0);
  o.g(3, "");
  o.i(62, 256);
  o.g(51, 90);
  o.g(52, 90);
  o.i(71, 2);
  o.g(49, 0.5);
  o.i(62, 256);
  o.g(6, "BYLAYER");
  o.g(49, -0.5);
  o.i(62, 256);
  o.g(6, "BYLAYER");
  for (const [handle, name, tab, br] of [
    [h.layoutModel, "Model", 0, h.brModel],
    [h.layoutPaper, "Layout1", 1, h.brPaper],
  ] as const) {
    o.g(0, "LAYOUT");
    o.g(5, handle);
    o.g(330, h.layoutDict);
    o.g(100, "AcDbPlotSettings");
    o.g(1, "");
    o.g(4, "A3");
    o.g(6, "");
    o.g(40, 7.5);
    o.g(41, 20);
    o.g(42, 7.5);
    o.g(43, 20);
    o.g(44, 420);
    o.g(45, 297);
    o.g(46, 0);
    o.g(47, 0);
    o.g(48, 0);
    o.g(49, 0);
    o.g(140, 0);
    o.g(141, 0);
    o.g(142, 1);
    o.g(143, 1);
    o.i(70, tab === 0 ? 1024 : 0);
    o.i(72, 1);
    o.i(73, 0);
    o.i(74, 5);
    o.g(7, "");
    o.i(75, 16);
    o.i(76, 0);
    o.i(77, 2);
    o.i(78, 300);
    o.g(147, 1);
    o.g(148, 0);
    o.g(149, 0);
    o.g(100, "AcDbLayout");
    o.g(1, name);
    o.i(70, 1);
    o.i(71, tab);
    o.p2(10, 0, 0);
    o.p2(11, 420, 297);
    o.p3(12, 0, 0);
    o.p3(14, box.minX, box.minY);
    o.p3(15, box.maxX, box.maxY);
    o.g(146, 0);
    o.p3(13, 0, 0);
    o.p3(16, 1, 0);
    o.p3(17, 0, 1);
    o.i(76, 1);
    o.g(330, br);
  }
  o.g(0, "ENDSEC");
  o.g(0, "EOF");
  // HEADER (gravado por último para o $HANDSEED incluir todos os handles)
  const hd = new Out();
  hd.g(0, "SECTION");
  hd.g(2, "HEADER");
  hd.g(9, "$ACADVER");
  hd.g(1, "AC1015");
  hd.g(9, "$ACADMAINTVER");
  hd.i(70, 6);
  hd.g(9, "$DWGCODEPAGE");
  hd.g(3, "ANSI_1252");
  hd.g(9, "$INSBASE");
  hd.p3(10, 0, 0);
  hd.g(9, "$EXTMIN");
  hd.p3(10, box.minX, box.minY);
  hd.g(9, "$EXTMAX");
  hd.p3(10, box.maxX, box.maxY);
  hd.g(9, "$LIMMIN");
  hd.p2(10, 0, 0);
  hd.g(9, "$LIMMAX");
  hd.p2(10, 420, 297);
  hd.g(9, "$LTSCALE");
  hd.g(40, 1);
  hd.g(9, "$TEXTSTYLE");
  hd.g(7, "Standard");
  hd.g(9, "$CLAYER");
  hd.g(8, "0");
  hd.g(9, "$CELTYPE");
  hd.g(6, "ByLayer");
  hd.g(9, "$DIMSTYLE");
  hd.g(2, "Standard");
  hd.g(9, "$LUNITS");
  hd.i(70, 2);
  hd.g(9, "$LUPREC");
  hd.i(70, 4);
  hd.g(9, "$AUNITS");
  hd.i(70, 0);
  hd.g(9, "$AUPREC");
  hd.i(70, 2);
  hd.g(9, "$HANDSEED");
  hd.g(5, next.toString(16).toUpperCase());
  hd.g(9, "$MEASUREMENT");
  hd.i(70, 1);
  hd.g(9, "$INSUNITS");
  hd.i(70, 4);
  hd.g(9, "$LWDISPLAY");
  hd.i(290, 0);
  hd.g(9, "$PSTYLEMODE");
  hd.i(290, 1);
  hd.g(0, "ENDSEC");

  return hd.toString() + o.toString();
}

const ltName = (n: string | null | undefined): string => {
  if (!n) return "ByLayer";
  const up = n.toUpperCase();
  return up === "CONTINUOUS" ? "Continuous" : up;
};

/** Espessura em centésimos de mm, arredondada para o valor padrão do AutoCAD mais próximo. */
function lw100(mm: number): number {
  let best = LINEWEIGHTS_MM[0];
  for (const w of LINEWEIGHTS_MM) if (Math.abs(w - mm) < Math.abs(best - mm)) best = w;
  return Math.round(best * 100);
}

/** Texto para DXF 2000 (Windows-1252): símbolos técnicos em códigos de controle e o resto em \U+XXXX. */
export function toDxfText2000(s: string, mtext = false): string {
  let t = s.replace(/°/g, "%%d").replace(/[ØⰞ⌀]/g, "%%c").replace(/±/g, "%%p");
  if (mtext) t = t.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\P");
  else t = t.replace(/[\r\n]+/g, " ");
  let out = "";
  for (const ch of t) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80 || encodeCp1252(ch)[0] !== 0x3f) out += ch;
    else if (c <= 0xffff) out += `\\U+${c.toString(16).toUpperCase().padStart(4, "0")}`;
    else out += "?";
  }
  return out;
}

class Out {
  private parts: string[] = [];
  g(code: number, value: string | number) {
    this.parts.push(String(code).padStart(3, " "), "\r\n", typeof value === "number" ? num(value) : value, "\r\n");
  }
  i(code: number, value: number) {
    this.parts.push(String(code).padStart(3, " "), "\r\n", String(Math.trunc(value)).padStart(6, " "), "\r\n");
  }
  p2(code: number, x: number, y: number) {
    this.g(code, x);
    this.g(code + 10, y);
  }
  p3(code: number, x: number, y: number, z = 0) {
    this.g(code, x);
    this.g(code + 10, y);
    this.g(code + 20, z);
  }
  raw(s: string) {
    this.parts.push(s);
  }
  toString() {
    return this.parts.join("");
  }
}

type Style = Pick<Entity, "layer" | "color" | "linetype" | "lineweight">;

class EntWriter {
  constructor(
    private o: Out,
    private H: () => string,
    private owner: string,
    private st: DimStyle,
  ) {}

  private head(type: string, e: Style, sub: string) {
    const o = this.o;
    o.g(0, type);
    o.g(5, this.H());
    o.g(330, this.owner);
    o.g(100, "AcDbEntity");
    o.g(8, e.layer);
    if (e.linetype) o.g(6, ltName(e.linetype));
    if (e.color != null) o.i(62, e.color);
    if (e.lineweight != null) o.i(370, lw100(e.lineweight));
    o.g(100, sub);
  }

  write(e: Entity) {
    const o = this.o;
    switch (e.type) {
      case "line":
        this.head("LINE", e, "AcDbLine");
        o.p3(10, e.a.x, e.a.y);
        o.p3(11, e.b.x, e.b.y);
        return;
      case "circle":
        this.head("CIRCLE", e, "AcDbCircle");
        o.p3(10, e.c.x, e.c.y);
        o.g(40, e.r);
        return;
      case "arc": {
        const sw = ccwSweep(e.a0, e.a1);
        this.head("ARC", e, "AcDbCircle");
        o.p3(10, e.c.x, e.c.y);
        o.g(40, e.r);
        o.g(100, "AcDbArc");
        o.g(50, rad2deg(normAngle(e.a0)));
        o.g(51, rad2deg(normAngle(e.a0 + sw)));
        return;
      }
      case "point":
        this.head("POINT", e, "AcDbPoint");
        o.p3(10, e.p.x, e.p.y);
        return;
      case "polyline":
        this.lwpoly(e, e.pts, e.bulges, e.closed);
        return;
      case "text":
        this.text(e, e.p, e.h, e.rot, e.value, e.halign);
        return;
      case "ellipse": {
        this.head("ELLIPSE", e, "AcDbEllipse");
        o.p3(10, e.c.x, e.c.y);
        o.p3(11, e.major.x, e.major.y);
        o.p3(210, 0, 0, 1);
        o.g(40, e.ratio);
        if (isFullEllipse(e)) {
          o.g(41, 0);
          o.g(42, Math.PI * 2);
        } else {
          const t0 = normAngle(e.t0);
          let t1 = normAngle(e.t1);
          if (t1 <= t0) t1 += Math.PI * 2;
          o.g(41, t0);
          o.g(42, t1);
        }
        return;
      }
      case "spline": {
        const rational = !!e.weights && e.weights.some((w) => Math.abs(w - 1) > 1e-12);
        this.head("SPLINE", e, "AcDbSpline");
        o.p3(210, 0, 0, 1);
        o.i(70, 8 | (e.closed ? 1 : 0) | (rational ? 4 : 0));
        o.i(71, e.degree);
        o.i(72, e.knots.length);
        o.i(73, e.ctrl.length);
        o.i(74, 0);
        o.g(42, 1e-10);
        o.g(43, 1e-10);
        for (const k of e.knots) o.g(40, k);
        if (rational) for (const w of e.weights!) o.g(41, w);
        for (const p of e.ctrl) o.p3(10, p.x, p.y);
        return;
      }
      case "hatch": {
        this.head("HATCH", e, "AcDbHatch");
        o.p3(10, 0, 0);
        o.p3(210, 0, 0, 1);
        o.g(2, e.solid ? "SOLID" : e.pattern.toUpperCase() || "USER");
        o.i(70, e.solid ? 1 : 0);
        o.i(71, 0);
        o.i(91, e.loops.length);
        e.loops.forEach((l, i) => {
          const hasBulge = l.bulges.some((b) => Math.abs(b) > 1e-15);
          o.i(92, i === 0 ? 3 : 2);
          o.i(72, hasBulge ? 1 : 0);
          o.i(73, 1);
          o.i(93, l.pts.length);
          l.pts.forEach((p, j) => {
            o.p2(10, p.x, p.y);
            if (hasBulge) o.g(42, l.bulges[j] ?? 0);
          });
          o.i(97, 0);
        });
        o.i(75, 0);
        o.i(76, 1);
        if (!e.solid) {
          o.g(52, rad2deg(normAngle(e.patternAngle)));
          o.g(41, e.patternScale || 1);
          o.i(77, 0);
          o.i(78, e.lines.length);
          for (const ln of e.lines) {
            o.g(53, rad2deg(normAngle(ln.angle)));
            o.g(43, ln.base.x);
            o.g(44, ln.base.y);
            o.g(45, ln.offset.x);
            o.g(46, ln.offset.y);
            o.i(79, ln.dashes.length);
            for (const d of ln.dashes) o.g(49, d);
          }
        }
        o.i(98, 0);
        return;
      }
      case "dimension": {
        const g = dimensionGeometry(e, this.st);
        const base: Style = { layer: e.layer, color: e.color, linetype: null, lineweight: e.lineweight };
        for (const [a, b] of g.lines) {
          this.head("LINE", base, "AcDbLine");
          o.p3(10, a.x, a.y);
          o.p3(11, b.x, b.y);
        }
        for (const s of g.solids) {
          const [p1, p2, p3] = s;
          const p4 = s[3] ?? p3;
          this.head("SOLID", base, "AcDbTrace");
          o.p3(10, p1.x, p1.y);
          o.p3(11, p2.x, p2.y);
          o.p3(12, p3.x, p3.y);
          o.p3(13, p4.x, p4.y);
        }
        for (const a of g.arcs) {
          this.head("ARC", base, "AcDbCircle");
          o.p3(10, a.c.x, a.c.y);
          o.g(40, a.r);
          o.g(100, "AcDbArc");
          o.g(50, rad2deg(normAngle(a.a0)));
          o.g(51, rad2deg(normAngle(a.a1)));
        }
        if (g.text.value) this.text(base, g.text.p, g.text.h, g.text.rot, g.text.value, 1);
        return;
      }
    }
  }

  private lwpoly(e: Style, pts: readonly { x: number; y: number }[], bulges: readonly number[], closed: boolean) {
    const o = this.o;
    this.head("LWPOLYLINE", e, "AcDbPolyline");
    o.i(90, pts.length);
    o.i(70, closed ? 1 : 0);
    o.g(43, 0);
    pts.forEach((p, i) => {
      o.p2(10, p.x, p.y);
      const b = bulges[i] ?? 0;
      if (b !== 0) o.g(42, b);
    });
  }

  private text(e: Style, p: { x: number; y: number }, h: number, rot: number, value: string, halign: 0 | 1 | 2) {
    const o = this.o;
    if (value.includes("\n")) {
      // várias linhas → MTEXT ancorado no topo; a base da 1ª linha fica em p (uma altura abaixo do topo)
      this.head("MTEXT", e, "AcDbMText");
      const top = { x: p.x - Math.sin(rot) * h, y: p.y + Math.cos(rot) * h };
      o.p3(10, top.x, top.y);
      o.g(40, h);
      o.g(41, 0);
      o.i(71, 1 + halign);
      o.i(72, 1);
      o.g(1, toDxfText2000(value, true));
      o.g(7, "Standard");
      o.p3(11, Math.cos(rot), Math.sin(rot));
      o.g(44, TEXT_LINE_SPACING / 1.6667);
      o.i(73, 2);
      return;
    }
    this.head("TEXT", e, "AcDbText");
    o.p3(10, p.x, p.y);
    o.g(40, h);
    o.g(1, toDxfText2000(value));
    if (rot !== 0) o.g(50, rad2deg(normAngle(rot)));
    o.g(7, "Standard");
    if (halign !== 0) {
      o.i(72, halign);
      o.p3(11, p.x, p.y);
    }
    o.g(100, "AcDbText");
  }
}
