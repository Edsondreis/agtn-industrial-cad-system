import * as opentype from "opentype.js";
import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from "polygon-clipping";
import { type Entity, makeEntity } from "@agtn/geometry";

/**
 * TEXTO PARA CORTE A LASER — converte texto em GEOMETRIA (polilinhas fechadas), nunca em entidade TEXT,
 * para que o CAM/laser entenda como contorno de corte.
 *
 * Modos:
 *  - VAZADO: as letras são furos na chapa. "Ilhas" (miolo do O, A, B, R...) cairiam da chapa; o motor
 *    detecta cada ilha e cria PONTES (estilo stencil) que a mantêm presa, preservando a tipografia.
 *  - EMENDADO: as letras formam UMA peça. Os glifos são unidos (fontes cursivas ou espaçamento negativo) e,
 *    opcionalmente, apoiados numa barra de ligação; o motor informa quantas peças soltas restaram.
 *  - MARCAÇÃO: contorno das letras para gravação (camada MARCACAO), sem pontes.
 *
 * Curvas Bézier da fonte são aproximadas por segmentos com erro máximo `tolerance` (padrão 0,01 mm).
 */
export type LaserTextMode = "vazado" | "emendado" | "marcacao";

export interface LaserTextOptions {
  text: string;
  /** Altura das maiúsculas (mm) */
  height: number;
  /** Espaçamento extra entre letras (mm; negativo aproxima) */
  spacing: number;
  /** Entrelinhas (× altura) */
  lineSpacing: number;
  align: "left" | "center" | "right";
  mode: LaserTextMode;
  /** Largura das pontes no modo vazado (mm) */
  bridgeWidth: number;
  /** Barra de ligação inferior no modo emendado */
  joinBar: boolean;
  barHeight: number;
  /** Placa retangular ao redor (modo vazado): margem em mm (0 = sem placa) */
  plateMargin: number;
  plateRadius: number;
  /** Espessura da chapa para verificação de traço/ponte (mm) */
  thickness: number;
  tolerance: number;
}

export const DEFAULT_LASER_TEXT: LaserTextOptions = {
  text: "AGTN",
  height: 50,
  spacing: 0,
  lineSpacing: 1.5,
  align: "left",
  mode: "vazado",
  bridgeWidth: 3,
  joinBar: false,
  barHeight: 6,
  plateMargin: 0,
  plateRadius: 0,
  thickness: 3,
  tolerance: 0.01,
};

export interface LaserTextResult {
  ok: boolean;
  /** regiões das letras (após pontes/união) */
  regions: MultiPolygon;
  entities: Entity[];
  bridges: number;
  /** ilhas que ainda cairiam (deve ser 0 no vazado) */
  islandsLeft: number;
  /** peças separadas (emendado) */
  pieces: number;
  /** traço estimado mais fino (mm) */
  thinnestStroke: number;
  width: number;
  heightTotal: number;
  /** comprimento total de corte (mm) */
  cutLength: number;
  warnings: string[];
  missingGlyphs: string[];
}

export const parseFont = (buf: ArrayBuffer): opentype.Font => opentype.parse(buf);

/* ------------------------------ achatamento ------------------------------ */
type Pt = [number, number];

function flattenPath(path: opentype.Path, tol: number): Pt[][] {
  const rings: Pt[][] = [];
  let cur: Pt[] = [];
  let last: Pt = [0, 0];
  const push = (p: Pt) => {
    const q = cur[cur.length - 1];
    if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-9) cur.push(p);
  };
  const close = () => {
    if (cur.length >= 3) rings.push(cur);
    cur = [];
  };
  for (const c of path.commands) {
    switch (c.type) {
      case "M":
        close();
        last = [c.x, -c.y];
        push(last);
        break;
      case "L":
        last = [c.x, -c.y];
        push(last);
        break;
      case "Q": {
        const p0 = last;
        const p1: Pt = [c.x1, -c.y1];
        const p2: Pt = [c.x, -c.y];
        const d = distToChord(p1, p0, p2);
        const n = Math.max(2, Math.min(64, Math.ceil(Math.sqrt(d / (4 * tol)) * 1.5)));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const a = (1 - t) * (1 - t);
          const b = 2 * (1 - t) * t;
          const e = t * t;
          push([a * p0[0] + b * p1[0] + e * p2[0], a * p0[1] + b * p1[1] + e * p2[1]]);
        }
        last = p2;
        break;
      }
      case "C": {
        const p0 = last;
        const p1: Pt = [c.x1, -c.y1];
        const p2: Pt = [c.x2, -c.y2];
        const p3: Pt = [c.x, -c.y];
        const d = Math.max(distToChord(p1, p0, p3), distToChord(p2, p0, p3));
        const n = Math.max(2, Math.min(96, Math.ceil(Math.sqrt((3 * d) / (4 * tol)))));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          const a = u * u * u;
          const b = 3 * u * u * t;
          const e = 3 * u * t * t;
          const f = t * t * t;
          push([a * p0[0] + b * p1[0] + e * p2[0] + f * p3[0], a * p0[1] + b * p1[1] + e * p2[1] + f * p3[1]]);
        }
        last = p3;
        break;
      }
      case "Z":
        close();
        break;
    }
  }
  close();
  // remove fechamento duplicado
  return rings.map((r) => {
    const a = r[0];
    const b = r[r.length - 1];
    return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9 ? r.slice(0, -1) : r;
  });
}

function distToChord(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  if (L < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L;
}

export const ringArea = (r: readonly Pt[]): number => {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return s / 2;
};
const ringPerimeter = (r: readonly Pt[]): number => {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += Math.hypot(r[i][0] - r[j][0], r[i][1] - r[j][1]);
  return s;
};
const closeRing = (r: Pt[]): Ring => (r.length ? [...r, r[0]] : r) as Ring;
const openRing = (r: Ring): Pt[] => {
  const a = r[0];
  const b = r[r.length - 1];
  return (a && b && a[0] === b[0] && a[1] === b[1] ? r.slice(0, -1) : r.slice()) as Pt[];
};

/** Região de um glifo pela regra de preenchimento não-zero (contornos externos − contornos internos). */
function glyphRegion(rings: Pt[][]): MultiPolygon {
  if (!rings.length) return [];
  let maxA = 0;
  let sign = 1;
  for (const r of rings) {
    const a = ringArea(r);
    if (Math.abs(a) > maxA) {
      maxA = Math.abs(a);
      sign = Math.sign(a) || 1;
    }
  }
  const outers: Polygon[] = [];
  const inners: Polygon[] = [];
  for (const r of rings) {
    if (Math.abs(ringArea(r)) < 1e-9) continue;
    (Math.sign(ringArea(r)) === sign ? outers : inners).push([closeRing(r)]);
  }
  if (!outers.length) return [];
  const u = polygonClipping.union(outers[0], ...outers.slice(1));
  return inners.length ? polygonClipping.difference(u, ...inners) : u;
}

function bboxOf(rings: readonly Ring[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rings)
    for (const [x, y] of r) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  return [x0, y0, x1, y1];
}

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => [
  [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ],
];

const holeCount = (mp: MultiPolygon): number => mp.reduce((n, p) => n + p.length - 1, 0);

/** Pontes stencil: cada ilha recebe uma ponte vertical (ou horizontal, se necessário) que a liga à chapa. */
function addBridges(mp: MultiPolygon, w: number): { mp: MultiPolygon; bridges: number } {
  let cur = mp;
  let bridges = 0;
  for (let iter = 0; iter < 400; iter++) {
    const polyIdx = cur.findIndex((p) => p.length > 1);
    if (polyIdx < 0) break;
    const poly = cur[polyIdx];
    const hole = poly[1];
    const [hx0, hy0, hx1, hy1] = bboxOf([hole]);
    const [ox0, oy0, ox1, oy1] = bboxOf([poly[0]]);
    const before = holeCount(cur);
    const tries: Polygon[] = [
      rect((hx0 + hx1) / 2 - w / 2, oy0 - 1, (hx0 + hx1) / 2 + w / 2, oy1 + 1),
      rect(ox0 - 1, (hy0 + hy1) / 2 - w / 2, ox1 + 1, (hy0 + hy1) / 2 + w / 2),
      rect(hx0 + (hx1 - hx0) * 0.3 - w / 2, oy0 - 1, hx0 + (hx1 - hx0) * 0.3 + w / 2, oy1 + 1),
    ];
    let done = false;
    for (const bar of tries) {
      const next = polygonClipping.difference(cur, bar);
      if (holeCount(next) < before) {
        cur = next;
        bridges++;
        done = true;
        break;
      }
    }
    if (!done) break;
  }
  return { mp: cur, bridges };
}

/** Gera a geometria de corte do texto. Origem: linha de base da primeira linha, alinhamento em x = 0. */
export function buildLaserText(font: opentype.Font, opt: LaserTextOptions): LaserTextResult {
  const warnings: string[] = [];
  const missing = new Set<string>();
  const empty: LaserTextResult = {
    ok: false,
    regions: [],
    entities: [],
    bridges: 0,
    islandsLeft: 0,
    pieces: 0,
    thinnestStroke: 0,
    width: 0,
    heightTotal: 0,
    cutLength: 0,
    warnings,
    missingGlyphs: [],
  };
  if (!opt.text.trim()) return { ...empty, warnings: ["Digite o texto."] };
  if (!(opt.height > 0)) return { ...empty, warnings: ["Altura deve ser maior que zero."] };

  // escala: altura das maiúsculas
  const os2 = (font.tables as { os2?: { sCapHeight?: number } }).os2;
  let capUnits = os2?.sCapHeight ?? 0;
  if (!capUnits) {
    const H = font.charToGlyph("H").getBoundingBox();
    capUnits = H.y2 - H.y1 || font.unitsPerEm * 0.7;
  }
  const fontSize = (opt.height * font.unitsPerEm) / capUnits;
  const scale = fontSize / font.unitsPerEm;

  const lines = opt.text.replace(/\r/g, "").split("\n");
  let all: MultiPolygon = [];
  const glyphStats: { area: number; per: number }[] = [];
  const lineGeoms: MultiPolygon[] = [];
  lines.forEach((line, li) => {
    const y = -li * opt.height * opt.lineSpacing;
    const glyphs = font.stringToGlyphs(line);
    let x = 0;
    const lineParts: MultiPolygon[] = [];
    glyphs.forEach((g, gi) => {
      if (g.index === 0 && line[gi] && line[gi] !== " ") missing.add(line[gi]);
      const p = g.getPath(x, 0, fontSize);
      const rings = flattenPath(p, opt.tolerance).map((r) => r.map(([px, py]) => [px, py + y] as Pt));
      const reg = glyphRegion(rings);
      if (reg.length) {
        lineParts.push(reg);
        let a = 0;
        let per = 0;
        for (const poly of reg)
          for (const r of poly) {
            a += Math.abs(ringArea(openRing(r))) * (r === poly[0] ? 1 : -1);
            per += ringPerimeter(openRing(r));
          }
        glyphStats.push({ area: a, per });
      }
      x += (g.advanceWidth ?? 0) * scale + opt.spacing;
      const nxt = glyphs[gi + 1];
      if (nxt) x += font.getKerningValue(g, nxt) * scale;
    });
    // alinhamento
    let lg: MultiPolygon = lineParts.length ? polygonClipping.union(lineParts[0], ...lineParts.slice(1)) : [];
    if (lg.length && opt.align !== "left") {
      const [x0, , x1] = bboxOf(lg.flatMap((pp) => pp));
      const dx = opt.align === "center" ? -(x0 + x1) / 2 : -x1;
      lg = lg.map((pp) => pp.map((r) => r.map(([a, b]) => [a + dx, b] as [number, number])));
    }
    lineGeoms.push(lg);
  });
  if (missing.size) warnings.push(`Caracteres sem desenho nesta fonte: ${[...missing].join(" ")}`);
  const nonEmpty = lineGeoms.filter((g) => g.length);
  if (!nonEmpty.length) return { ...empty, warnings };
  all = polygonClipping.union(nonEmpty[0], ...nonEmpty.slice(1));

  let bridges = 0;
  let entitiesRings: { ring: Ring; layer: string }[] = [];
  let [bx0, by0, bx1, by1] = bboxOf(all.flatMap((p) => p));

  if (opt.mode === "emendado") {
    if (opt.joinBar) {
      const pad = opt.height * 0.08;
      const bar = rect(bx0 - pad, -opt.barHeight, bx1 + pad, opt.height * 0.12);
      all = polygonClipping.union(all, bar);
    }
    [bx0, by0, bx1, by1] = bboxOf(all.flatMap((p) => p));
    entitiesRings = all.flatMap((p) => p.map((ring) => ({ ring, layer: "CONTORNO_CORTE" })));
  } else if (opt.mode === "vazado") {
    if (!(opt.bridgeWidth > 0)) warnings.push("Largura de ponte deve ser maior que zero.");
    else {
      const r = addBridges(all, opt.bridgeWidth);
      all = r.mp;
      bridges = r.bridges;
    }
    entitiesRings = all.flatMap((p) => p.map((ring) => ({ ring, layer: "CONTORNO_CORTE" })));
    if (opt.plateMargin > 0) {
      const m = opt.plateMargin;
      const px0 = bx0 - m;
      const py0 = by0 - m;
      const px1 = bx1 + m;
      const py1 = by1 + m;
      entitiesRings.unshift({ ring: rect(px0, py0, px1, py1)[0], layer: "CONTORNO_CORTE" });
      [bx0, by0, bx1, by1] = [px0, py0, px1, py1];
    }
  } else {
    entitiesRings = all.flatMap((p) => p.map((ring) => ({ ring, layer: "MARCACAO" })));
  }

  // verificação de fabricação
  const thinnest = glyphStats.length ? Math.min(...glyphStats.filter((g) => g.per > 0).map((g) => (2 * g.area) / g.per)) : 0;
  if (opt.mode !== "marcacao" && opt.thickness > 0) {
    if (thinnest < opt.thickness)
      warnings.push(
        `Traço estimado de ${thinnest.toFixed(2).replace(".", ",")} mm é menor que a espessura (${opt.thickness} mm): aumente a altura do texto ou use fonte mais grossa.`,
      );
    if (opt.mode === "vazado" && bridges > 0 && opt.bridgeWidth < opt.thickness * 0.8)
      warnings.push(`Ponte de ${opt.bridgeWidth} mm é estreita para chapa de ${opt.thickness} mm (recomendado ≥ ${(opt.thickness * 0.8).toFixed(1).replace(".", ",")} mm).`);
  }
  const islandsLeft = opt.mode === "vazado" ? holeCount(all) : 0;
  if (islandsLeft) warnings.push(`${islandsLeft} ilha(s) ainda soltas — revise o texto ou aumente as pontes.`);
  const pieces = all.length;
  if (opt.mode === "emendado" && pieces > 1)
    warnings.push(`${pieces} peças separadas: use espaçamento negativo, fonte cursiva ou a barra de ligação para formar uma peça só.`);

  // rotação/arredondamento da placa não aplicados ao texto; entidades
  const entities: Entity[] = [];
  let cutLength = 0;
  for (const { ring, layer } of entitiesRings) {
    const pts = openRing(ring).map(([x, y]) => ({ x, y }));
    if (pts.length < 3) continue;
    cutLength += ringPerimeter(openRing(ring));
    if (layer === "CONTORNO_CORTE" && opt.mode === "vazado" && opt.plateMargin > 0 && opt.plateRadius > 0 && ring === entitiesRings[0].ring) {
      entities.push(roundedRect(bx0, by0, bx1, by1, opt.plateRadius, layer));
      continue;
    }
    entities.push(makeEntity({ type: "polyline", pts, bulges: pts.map(() => 0), closed: true }, layer));
  }
  return {
    ok: entities.length > 0,
    regions: all,
    entities,
    bridges,
    islandsLeft,
    pieces,
    thinnestStroke: thinnest,
    width: bx1 - bx0,
    heightTotal: by1 - by0,
    cutLength,
    warnings,
    missingGlyphs: [...missing],
  };
}

function roundedRect(x0: number, y0: number, x1: number, y1: number, r0: number, layer: string): Entity {
  const r = Math.min(r0, (x1 - x0) / 2, (y1 - y0) / 2);
  const q = Math.tan(Math.PI / 8);
  const pts = [
    { x: x0 + r, y: y0 },
    { x: x1 - r, y: y0 },
    { x: x1, y: y0 + r },
    { x: x1, y: y1 - r },
    { x: x1 - r, y: y1 },
    { x: x0 + r, y: y1 },
    { x: x0, y: y1 - r },
    { x: x0, y: y0 + r },
  ];
  return makeEntity({ type: "polyline", pts, bulges: [0, q, 0, q, 0, q, 0, q], closed: true }, layer);
}
