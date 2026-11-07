import {
  ACI_RGB,
  type BBox,
  type DimStyle,
  type Entity,
  type Vec2,
  DEFAULT_DIMSTYLE,
  TEXT_LINE_SPACING,
  boxOverlaps,
  boxUnion,
  ccwSweep,
  curvePoints,
  dimensionGeometry,
  emptyBox,
  entityBox,
  entitySegs,
  hatchLoopPolygon,
  hatchPatternSegments,
  segEnd,
  segStart,
  type Seg,
} from "@agtn/geometry";
import { type Layer, linetypeByName } from "@agtn/document";

/**
 * Plotagem (impressão / PDF) do desenho em uma folha.
 *
 * `layoutPlot` converte as entidades em primitivas de papel (milímetros, origem no canto inferior
 * esquerdo da folha, Y para cima): traços, preenchimentos e textos. Os escritores de PDF e SVG
 * só desenham essas primitivas — o que sai no PDF é exatamente o que sai na impressora.
 */

export type PaperId = "A4" | "A3" | "A2" | "A1" | "A0" | "CARTA" | "OFICIO";

/** Folhas em retrato (largura × altura, mm). */
export const PAPERS: readonly { id: PaperId; label: string; w: number; h: number }[] = [
  { id: "A4", label: "A4 (210 × 297)", w: 210, h: 297 },
  { id: "A3", label: "A3 (297 × 420)", w: 297, h: 420 },
  { id: "A2", label: "A2 (420 × 594)", w: 420, h: 594 },
  { id: "A1", label: "A1 (594 × 841)", w: 594, h: 841 },
  { id: "A0", label: "A0 (841 × 1189)", w: 841, h: 1189 },
  { id: "CARTA", label: "Carta (216 × 279)", w: 215.9, h: 279.4 },
  { id: "OFICIO", label: "Ofício (216 × 356)", w: 215.9, h: 355.6 },
];

/** Escalas usuais de desenho técnico: papel : desenho. */
export const PLOT_SCALES: readonly { label: string; value: number }[] = [
  { label: "5:1", value: 5 },
  { label: "2:1", value: 2 },
  { label: "1:1", value: 1 },
  { label: "1:2", value: 1 / 2 },
  { label: "1:2,5", value: 1 / 2.5 },
  { label: "1:5", value: 1 / 5 },
  { label: "1:10", value: 1 / 10 },
  { label: "1:20", value: 1 / 20 },
  { label: "1:25", value: 1 / 25 },
  { label: "1:50", value: 1 / 50 },
  { label: "1:75", value: 1 / 75 },
  { label: "1:100", value: 1 / 100 },
  { label: "1:200", value: 1 / 200 },
];

export type PlotColor = "color" | "mono" | "gray";

export interface PlotSettings {
  paper: PaperId;
  landscape: boolean;
  /** extensão do desenho, uma janela escolhida ou a área visível na tela */
  area: "extents" | "window" | "display";
  /** caixa (mm do desenho) para area = "window" | "display" */
  window?: BBox | null;
  /** papel/desenho (1:10 → 0,1) ou "fit" para ajustar à folha */
  scale: number | "fit";
  center: boolean;
  /** margem não imprimível, mm */
  margin: number;
  color: PlotColor;
  /** usa a espessura de linha de camadas/objetos (senão tudo fino, 0,18 mm) */
  lineweights: boolean;
}

export const DEFAULT_PLOT: PlotSettings = {
  paper: "A4",
  landscape: true,
  area: "extents",
  window: null,
  scale: "fit",
  center: true,
  margin: 10,
  color: "mono",
  lineweights: true,
};

export interface PlotInput {
  entities: readonly Entity[];
  layers: readonly Layer[];
  dimStyle?: DimStyle;
  /** escala global de tipo de linha (LTSCALE) */
  ltScale?: number;
}

export type RGB = readonly [number, number, number];

export interface PlotPath {
  pts: Vec2[];
  closed: boolean;
}
export interface PlotStroke {
  paths: PlotPath[];
  rgb: RGB;
  /** espessura no papel, mm */
  width: number;
  /** traços no papel, mm (vazio = contínuo; 0 = ponto) */
  dash: number[];
}
export interface PlotFill {
  polys: Vec2[][];
  rgb: RGB;
}
export interface PlotText {
  p: Vec2;
  /** altura das maiúsculas no papel, mm */
  h: number;
  rot: number;
  value: string;
  halign: 0 | 1 | 2;
  rgb: RGB;
}

export interface PlotPage {
  /** folha, mm */
  w: number;
  h: number;
  /** recorte (área plotada) no papel */
  clip: BBox;
  strokes: PlotStroke[];
  fills: PlotFill[];
  texts: PlotText[];
  /** papel/desenho efetivo */
  scale: number;
  /** área do desenho plotada (mm do desenho) */
  area: BBox;
  /** objetos plotados */
  count: number;
}

export function paperSize(s: Pick<PlotSettings, "paper" | "landscape">): { w: number; h: number } {
  const p = PAPERS.find((x) => x.id === s.paper) ?? PAPERS[0];
  return s.landscape ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

/** Texto amigável da escala (ex.: 1:7,35 ou 2:1). */
export function scaleLabel(s: number): string {
  const fmt = (v: number) => (Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : v.toFixed(2).replace(".", ",").replace(/,?0+$/, ""));
  return s >= 1 ? `${fmt(s)}:1` : `1:${fmt(1 / s)}`;
}

function aciRgb(i: number, mode: PlotColor): RGB {
  if (mode === "mono") return [0, 0, 0];
  const v = i === 7 ? 0 : (ACI_RGB[i] ?? 0);
  const rgb: RGB = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  if (mode === "gray") {
    // cores claras viram cinza mais escuro para não sumirem no papel branco
    const l = Math.round(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]);
    const g = Math.round(l * 0.7);
    return [g, g, g];
  }
  return rgb;
}

/** Pontos de um segmento com erro de corda ≤ tol (unidades do desenho). */
function segPoints(s: Seg, tol: number, out: Vec2[]) {
  if (!out.length) out.push(segStart(s));
  if (s.kind === "line") {
    out.push(s.b);
    return;
  }
  const step = s.r > tol ? 2 * Math.acos(Math.max(-1, 1 - tol / s.r)) : s.sweep;
  const n = Math.max(2, Math.min(4096, Math.ceil(s.sweep / Math.max(step, 1e-6))));
  for (let i = 1; i <= n; i++) {
    const t = s.rev ? s.sweep * (1 - i / n) : (s.sweep * i) / n;
    out.push({ x: s.c.x + Math.cos(s.a0 + t) * s.r, y: s.c.y + Math.sin(s.a0 + t) * s.r });
  }
  // garante o ponto final exato do percurso
  out[out.length - 1] = segEnd(s);
}

export function plotExtents(input: PlotInput): BBox {
  const vis = visibleEntities(input);
  let b = emptyBox();
  for (const e of vis) b = boxUnion(b, entityBox(e));
  return b;
}

function visibleEntities(input: PlotInput): Entity[] {
  const hidden = new Set(input.layers.filter((l) => !l.visible).map((l) => l.name));
  return input.entities.filter((e) => !hidden.has(e.layer));
}

/** Monta a folha. Lança erro se não houver nada para plotar. */
export function layoutPlot(input: PlotInput, settings: PlotSettings): PlotPage {
  const st = input.dimStyle ?? DEFAULT_DIMSTYLE;
  const ents = visibleEntities(input);
  const { w, h } = paperSize(settings);
  const m = Math.max(0, Math.min(settings.margin, Math.min(w, h) / 2 - 5));
  const pw = w - 2 * m;
  const ph = h - 2 * m;
  let area: BBox;
  if (settings.area === "extents" || !settings.window) {
    area = emptyBox();
    for (const e of ents) area = boxUnion(area, entityBox(e));
  } else area = { ...settings.window };
  if (!(area.maxX >= area.minX) || !Number.isFinite(area.minX)) throw new Error("Nada para imprimir: o desenho está vazio (ou só tem camadas ocultas).");
  // área degenerada (um ponto, uma linha horizontal…) ganha um mínimo para a escala não explodir
  const aw = Math.max(area.maxX - area.minX, 1e-6);
  const ah = Math.max(area.maxY - area.minY, 1e-6);
  const scale = settings.scale === "fit" ? Math.min(pw / aw, ph / ah) : settings.scale;
  if (!(scale > 0) || !Number.isFinite(scale)) throw new Error("Escala de impressão inválida.");
  let ox: number;
  let oy: number;
  if (settings.center) {
    ox = w / 2 - ((area.minX + area.maxX) / 2) * scale;
    oy = h / 2 - ((area.minY + area.maxY) / 2) * scale;
  } else {
    ox = m - area.minX * scale;
    oy = m - area.minY * scale;
  }
  const T = (p: Vec2): Vec2 => ({ x: p.x * scale + ox, y: p.y * scale + oy });
  const clip: BBox = {
    minX: Math.max(m, area.minX * scale + ox),
    minY: Math.max(m, area.minY * scale + oy),
    maxX: Math.min(w - m, area.maxX * scale + ox),
    maxY: Math.min(h - m, area.maxY * scale + oy),
  };
  // tolerância de corda: 0,01 mm no papel
  const tol = 0.01 / scale;
  const layers = new Map(input.layers.map((l) => [l.name, l]));
  const ltScale = input.ltScale ?? 1;

  const groups = new Map<string, PlotStroke>();
  const fills: PlotFill[] = [];
  const texts: PlotText[] = [];
  const stroke = (rgb: RGB, width: number, dash: number[]) => {
    const key = `${rgb.join(",")}|${width}|${dash.join(",")}`;
    let g = groups.get(key);
    if (!g) {
      g = { paths: [], rgb, width, dash };
      groups.set(key, g);
    }
    return g;
  };
  let count = 0;
  const view = area;
  for (const e of ents) {
    if (!boxOverlaps(entityBox(e), view)) continue;
    count++;
    const l = layers.get(e.layer);
    const rgb = aciRgb(e.color ?? l?.color ?? 7, settings.color);
    const lw = settings.lineweights ? Math.max(0.05, e.lineweight ?? l?.lineweight ?? 0.25) : 0.18;
    const ltName = e.linetype ?? l?.linetype ?? "CONTINUOUS";
    const pat = e.type === "text" || e.type === "dimension" || e.type === "hatch" ? [] : linetypeByName(ltName).pattern;
    const dash = pat.map((v) => (v === 0 ? 0 : Math.max(0.25, Math.abs(v) * ltScale * scale)));
    switch (e.type) {
      case "text":
        texts.push({ p: T(e.p), h: e.h * scale, rot: e.rot, value: e.value, halign: e.halign, rgb });
        break;
      case "point":
        stroke(rgb, Math.max(lw, 0.35), []).paths.push({ pts: [T(e.p), T(e.p)], closed: false });
        break;
      case "dimension": {
        const g = dimensionGeometry(e, st);
        const s = stroke(rgb, Math.min(lw, 0.25), []);
        for (const [a, b] of g.lines) s.paths.push({ pts: [T(a), T(b)], closed: false });
        for (const a of g.arcs) {
          const pts: Vec2[] = [];
          segPoints({ kind: "arc", c: a.c, r: a.r, a0: a.a0, sweep: ccwSweep(a.a0, a.a1), rev: false }, tol, pts);
          s.paths.push({ pts: pts.map(T), closed: false });
        }
        for (const sol of g.solids) fills.push({ polys: [sol.map(T)], rgb });
        if (g.text.value) texts.push({ p: T(g.text.p), h: g.text.h * scale, rot: g.text.rot, value: g.text.value, halign: 1, rgb });
        break;
      }
      case "hatch": {
        const polys = e.loops.map(hatchLoopPolygon);
        if (e.solid) fills.push({ polys: polys.map((p) => p.map(T)), rgb });
        else {
          const s = stroke(rgb, Math.min(lw, 0.18), []);
          for (const [a, b] of hatchPatternSegments(polys, e.lines).segs) s.paths.push({ pts: [T(a), T(b)], closed: false });
        }
        break;
      }
      case "ellipse":
      case "spline": {
        const pts = curvePoints(e).map(T);
        if (pts.length > 1) stroke(rgb, lw, dash).paths.push({ pts, closed: false });
        break;
      }
      default: {
        const segs = entitySegs(e);
        if (!segs.length) break;
        const pts: Vec2[] = [];
        for (const s of segs) segPoints(s, tol, pts);
        const closed = e.type === "circle" || (e.type === "polyline" && e.closed);
        if (closed && pts.length > 2) pts.pop();
        stroke(rgb, lw, dash).paths.push({ pts: pts.map(T), closed });
      }
    }
  }
  return { w, h, clip, strokes: [...groups.values()], fills, texts, scale, area, count };
}

/** Altura da maiúscula da Helvetica em relação ao corpo da fonte (AFM: 718/1000). */
export const CAP_HEIGHT = 0.718;

/** Linhas de um texto de várias linhas, com o deslocamento de cada uma (mm, para baixo). */
export function textLines(t: Pick<PlotText, "value" | "h">): { line: string; dy: number }[] {
  return t.value.split("\n").map((line, i) => ({ line, dy: i * t.h * TEXT_LINE_SPACING }));
}
