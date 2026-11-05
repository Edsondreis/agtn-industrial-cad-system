import {
  ACI_RGB,
  type DimStyle,
  type Entity,
  type Vec2,
  bulgeSeg,
  ccwSweep,
  dimensionGeometry,
} from "@agtn/geometry";
import { type Layer, linetypeByName } from "@agtn/document";
import type { Viewport } from "./view";

/** Paleta da interface (tema escuro grafite). */
export const THEME = {
  bg: "#14171b",
  gridMinor: "rgba(140,155,175,0.07)",
  gridMajor: "rgba(140,155,175,0.16)",
  axisX: "rgba(196,92,92,0.55)",
  axisY: "rgba(92,170,110,0.55)",
  accent: "#3d8bfd",
  accentSoft: "rgba(61,139,253,0.18)",
  select: "#5aa2ff",
  crossing: "rgba(80,200,120,0.14)",
  crossingStroke: "#50c878",
  windowFill: "rgba(61,139,253,0.12)",
  snap: "#f5c04a",
  preview: "#9fc6ff",
  tracking: "rgba(245,192,74,0.6)",
  cursor: "#cfd6df",
};

export function aciColor(i: number): string {
  if (i === 7) return "#e6e9ee"; // branco suavizado sobre fundo escuro
  const v = ACI_RGB[i] ?? 0xffffff;
  return `#${v.toString(16).padStart(6, "0")}`;
}

export interface RenderStyle {
  layers: ReadonlyMap<string, Layer>;
  ltScale: number;
  showLineweight: boolean;
  dimStyle: DimStyle;
}

const lwPx = (mm: number): number => Math.max(1, Math.min(8, mm * 3.78));

interface Resolved {
  color: string;
  width: number;
  dash: number[];
}

function resolve(e: Entity, st: RenderStyle, scale: number): Resolved {
  const l = st.layers.get(e.layer);
  const colorIdx = e.color ?? l?.color ?? 7;
  const lw = e.lineweight ?? l?.lineweight ?? 0.25;
  const ltName = e.linetype ?? l?.linetype ?? "CONTINUOUS";
  const pat = e.type === "text" || e.type === "dimension" ? [] : linetypeByName(ltName).pattern;
  let dash: number[] = [];
  if (pat.length) {
    const px = pat.map((v) => Math.max(Math.abs(v) * st.ltScale * scale, v === 0 ? 1.5 : 0));
    // padrão menor que ~2 px fica contínuo (evita "ruído" visual), sem alterar a geometria
    if (px.every((v) => v >= 1.5)) dash = px;
  }
  return { color: aciColor(colorIdx), width: st.showLineweight ? lwPx(lw) : 1, dash };
}

function addSegPath(path: Path2D, v: Viewport, a: Vec2, b: Vec2, bulge: number, first: boolean) {
  const sa = v.toScreen(a);
  if (first) path.moveTo(sa.x, sa.y);
  if (Math.abs(bulge) < 1e-12) {
    const sb = v.toScreen(b);
    path.lineTo(sb.x, sb.y);
    return;
  }
  const s = bulgeSeg(a, b, bulge);
  if (s.kind === "line") {
    const sb = v.toScreen(b);
    path.lineTo(sb.x, sb.y);
    return;
  }
  const c = v.toScreen(s.c);
  const r = s.r * v.scale;
  if (!s.rev) path.arc(c.x, c.y, r, -s.a0, -(s.a0 + s.sweep), true);
  else path.arc(c.x, c.y, r, -(s.a0 + s.sweep), -s.a0, false);
}

/** Constrói o traçado de uma entidade (exceto texto) em um Path2D. */
export function entityPath(path: Path2D, e: Entity, v: Viewport): void {
  switch (e.type) {
    case "line": {
      const a = v.toScreen(e.a);
      const b = v.toScreen(e.b);
      path.moveTo(a.x, a.y);
      path.lineTo(b.x, b.y);
      return;
    }
    case "circle": {
      const c = v.toScreen(e.c);
      path.moveTo(c.x + e.r * v.scale, c.y);
      path.arc(c.x, c.y, e.r * v.scale, 0, Math.PI * 2);
      return;
    }
    case "arc": {
      const c = v.toScreen(e.c);
      const r = e.r * v.scale;
      const sw = ccwSweep(e.a0, e.a1);
      path.moveTo(c.x + Math.cos(-e.a0) * r, c.y + Math.sin(-e.a0) * r);
      path.arc(c.x, c.y, r, -e.a0, -(e.a0 + sw), true);
      return;
    }
    case "polyline": {
      const n = e.pts.length;
      const segs = e.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) addSegPath(path, v, e.pts[i], e.pts[(i + 1) % n], e.bulges[i] ?? 0, i === 0);
      return;
    }
    case "point": {
      const p = v.toScreen(e.p);
      path.moveTo(p.x - 4, p.y);
      path.lineTo(p.x + 4, p.y);
      path.moveTo(p.x, p.y - 4);
      path.lineTo(p.x, p.y + 4);
      return;
    }
    default:
      return;
  }
}

export const TEXT_FONT = `"Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace`;

function drawText(ctx: CanvasRenderingContext2D, v: Viewport, p: Vec2, h: number, rot: number, value: string, halign: 0 | 1 | 2, color: string) {
  const px = h * v.scale;
  const s = v.toScreen(p);
  if (px < 1.2) {
    // texto ilegível no zoom atual: marca sua posição
    ctx.fillStyle = color;
    ctx.fillRect(s.x - 0.5, s.y - 0.5, 1, 1);
    return;
  }
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(-rot);
  ctx.font = `${px}px ${TEXT_FONT}`;
  ctx.textAlign = halign === 0 ? "left" : halign === 1 ? "center" : "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = color;
  ctx.fillText(value, 0, 0);
  ctx.restore();
}

export interface DrawOptions {
  /** substitui cor/espessura (ex.: destaque de seleção, pré-visualização) */
  override?: { color: string; width?: number; dash?: number[] };
}

/** Desenha entidades agrupando traçados por estilo (um stroke por grupo). */
export function drawEntities(ctx: CanvasRenderingContext2D, ents: Iterable<Entity>, v: Viewport, st: RenderStyle, opt: DrawOptions = {}): void {
  const groups = new Map<string, { r: Resolved; path: Path2D }>();
  const texts: Entity[] = [];
  const dims: { e: Entity; r: Resolved }[] = [];
  for (const e of ents) {
    const r0 = resolve(e, st, v.scale);
    const r: Resolved = opt.override ? { color: opt.override.color, width: opt.override.width ?? r0.width, dash: opt.override.dash ?? r0.dash } : r0;
    if (e.type === "text") {
      texts.push(e);
      continue;
    }
    if (e.type === "dimension") {
      dims.push({ e, r });
      continue;
    }
    const key = `${r.color}|${r.width}|${r.dash.join(",")}`;
    let g = groups.get(key);
    if (!g) {
      g = { r, path: new Path2D() };
      groups.set(key, g);
    }
    entityPath(g.path, e, v);
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const { r, path } of groups.values()) {
    ctx.strokeStyle = r.color;
    ctx.lineWidth = r.width;
    ctx.setLineDash(r.dash);
    ctx.stroke(path);
  }
  ctx.setLineDash([]);
  for (const { e, r } of dims) {
    if (e.type !== "dimension") continue;
    const g = dimensionGeometry(e, st.dimStyle);
    const path = new Path2D();
    for (const [a, b] of g.lines) {
      const sa = v.toScreen(a);
      const sb = v.toScreen(b);
      path.moveTo(sa.x, sa.y);
      path.lineTo(sb.x, sb.y);
    }
    for (const a of g.arcs) {
      const c = v.toScreen(a.c);
      const sw = ccwSweep(a.a0, a.a1);
      path.moveTo(c.x + Math.cos(-a.a0) * a.r * v.scale, c.y + Math.sin(-a.a0) * a.r * v.scale);
      path.arc(c.x, c.y, a.r * v.scale, -a.a0, -(a.a0 + sw), true);
    }
    ctx.strokeStyle = r.color;
    ctx.lineWidth = Math.max(1, r.width * 0.8);
    ctx.stroke(path);
    ctx.fillStyle = r.color;
    for (const s of g.solids) {
      ctx.beginPath();
      s.forEach((p, i) => {
        const q = v.toScreen(p);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.closePath();
      ctx.fill();
    }
    if (g.text.value) drawText(ctx, v, g.text.p, g.text.h, g.text.rot, g.text.value, 1, r.color);
  }
  for (const e of texts) {
    if (e.type !== "text") continue;
    const r = opt.override ? opt.override.color : resolve(e, st, v.scale).color;
    drawText(ctx, v, e.p, e.h, e.rot, e.value, e.halign, r);
  }
}

/** Passo de grade exibido: múltiplo 1-2-5 do espaçamento configurado, com no mínimo ~9 px. */
export function gridStep(base: number, scale: number): number {
  const b = base > 0 ? base : 10;
  const target = 9 / scale;
  if (b >= target) {
    let sp = b;
    while (sp * scale > 140) sp /= 10;
    return sp;
  }
  const pow = 10 ** Math.floor(Math.log10(target / b));
  for (const m of [1, 2, 5, 10]) if (b * pow * m >= target) return b * pow * m;
  return b * pow * 10;
}

/** Grade técnica adaptativa ao zoom + eixos X/Y. */
export function drawGrid(ctx: CanvasRenderingContext2D, v: Viewport, baseSpacing: number, showGrid: boolean): number {
  const box = v.worldBox();
  const sp = gridStep(baseSpacing, v.scale);
  if (showGrid) {
    const major = sp * 5;
    const drawSet = (step: number, color: string) => {
      const x0 = Math.ceil(box.minX / step) * step;
      const y0 = Math.ceil(box.minY / step) * step;
      const nx = (box.maxX - x0) / step;
      const ny = (box.maxY - y0) / step;
      if (nx > 600 || ny > 600) return;
      ctx.beginPath();
      for (let i = 0; i <= nx; i++) {
        const x = Math.round(v.toScreen({ x: x0 + i * step, y: 0 }).x) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, v.height);
      }
      for (let j = 0; j <= ny; j++) {
        const y = Math.round(v.toScreen({ x: 0, y: y0 + j * step }).y) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(v.width, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    drawSet(sp, THEME.gridMinor);
    drawSet(major, THEME.gridMajor);
  }
  const o = v.toScreen({ x: 0, y: 0 });
  ctx.lineWidth = 1;
  if (o.y >= 0 && o.y <= v.height) {
    ctx.strokeStyle = THEME.axisX;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(o.y) + 0.5);
    ctx.lineTo(v.width, Math.round(o.y) + 0.5);
    ctx.stroke();
  }
  if (o.x >= 0 && o.x <= v.width) {
    ctx.strokeStyle = THEME.axisY;
    ctx.beginPath();
    ctx.moveTo(Math.round(o.x) + 0.5, 0);
    ctx.lineTo(Math.round(o.x) + 0.5, v.height);
    ctx.stroke();
  }
  return sp;
}

/** Ícone do sistema de coordenadas (canto inferior esquerdo). */
export function drawUcsIcon(ctx: CanvasRenderingContext2D, v: Viewport) {
  const x = 18;
  const y = v.height - 18;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = THEME.axisX;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 34, y);
  ctx.stroke();
  ctx.strokeStyle = THEME.axisY;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 34);
  ctx.stroke();
  ctx.font = `10px ${TEXT_FONT}`;
  ctx.fillStyle = "#8a94a3";
  ctx.fillText("X", x + 38, y + 4);
  ctx.fillText("Y", x - 3, y - 39);
}
