import { angleWithin } from "./angle";
import type { Entity } from "./entities";
import { type Seg, arcEnd, arcStart, entitySegs } from "./segments";
import type { Vec2 } from "./vec";

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const emptyBox = (): BBox => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
export const isEmptyBox = (b: BBox): boolean => b.minX > b.maxX || b.minY > b.maxY;

export function boxAddPoint(b: BBox, p: Vec2): BBox {
  if (p.x < b.minX) b.minX = p.x;
  if (p.y < b.minY) b.minY = p.y;
  if (p.x > b.maxX) b.maxX = p.x;
  if (p.y > b.maxY) b.maxY = p.y;
  return b;
}

export function boxUnion(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function boxFromPoints(a: Vec2, b: Vec2): BBox {
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

export const boxContainsBox = (outer: BBox, inner: BBox): boolean =>
  inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;

export const boxOverlaps = (a: BBox, b: BBox): boolean =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

export const boxContainsPoint = (b: BBox, p: Vec2): boolean =>
  p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

/** Caixa exata de um segmento (arcos consideram os quadrantes cruzados). */
export function segBox(s: Seg, b: BBox = emptyBox()): BBox {
  if (s.kind === "line") {
    boxAddPoint(b, s.a);
    boxAddPoint(b, s.b);
    return b;
  }
  boxAddPoint(b, arcStart(s));
  boxAddPoint(b, arcEnd(s));
  const quads = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  for (const q of quads) {
    if (angleWithin(q, s.a0, s.sweep, 0)) {
      boxAddPoint(b, { x: s.c.x + Math.cos(q) * s.r, y: s.c.y + Math.sin(q) * s.r });
    }
  }
  return b;
}

/** Estimativa de largura do texto (fonte técnica monoespaçada ≈ 0,7·h por caractere). */
export const TEXT_WIDTH_FACTOR = 0.7;

export function textCorners(p: Vec2, h: number, rot: number, value: string, halign: 0 | 1 | 2): Vec2[] {
  const lines = value.split("\n");
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const w = Math.max(1, longest) * h * TEXT_WIDTH_FACTOR;
  const below = (lines.length - 1) * h * TEXT_LINE_SPACING;
  const x0 = halign === 0 ? 0 : halign === 1 ? -w / 2 : -w;
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const loc = [
    { x: x0, y: -below },
    { x: x0 + w, y: -below },
    { x: x0 + w, y: h },
    { x: x0, y: h },
  ];
  return loc.map((q) => ({ x: p.x + q.x * cs - q.y * sn, y: p.y + q.x * sn + q.y * cs }));
}

/** Espaçamento entre linhas de texto (múltiplo da altura), igual ao padrão do MTEXT. */
export const TEXT_LINE_SPACING = 1.6667;

export function entityBox(e: Entity): BBox {
  const b = emptyBox();
  switch (e.type) {
    case "point":
      return boxAddPoint(b, e.p);
    case "text":
      for (const c of textCorners(e.p, e.h, e.rot, e.value, e.halign)) boxAddPoint(b, c);
      return b;
    case "dimension":
      boxAddPoint(b, e.p1);
      boxAddPoint(b, e.p2);
      if (e.p3) boxAddPoint(b, e.p3);
      boxAddPoint(b, e.loc);
      return b;
    default:
      for (const s of entitySegs(e)) segBox(s, b);
      return b;
  }
}
