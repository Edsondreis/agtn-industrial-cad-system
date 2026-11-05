import { normAngle } from "./angle";
import type { Entity } from "./entities";
import { type Vec2, angleOf, sub } from "./vec";

/**
 * Transformação afim 2D: x' = a·x + c·y + e ; y' = b·x + d·y + f.
 * O CAD só aplica transformações conformes (translação, rotação, escala uniforme, espelhamento),
 * o que mantém círculos como círculos.
 */
export interface Affine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export const applyPt = (m: Affine, p: Vec2): Vec2 => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });

/** m2 ∘ m1 (aplica m1 primeiro). */
export function compose(m2: Affine, m1: Affine): Affine {
  return {
    a: m2.a * m1.a + m2.c * m1.b,
    b: m2.b * m1.a + m2.d * m1.b,
    c: m2.a * m1.c + m2.c * m1.d,
    d: m2.b * m1.c + m2.d * m1.d,
    e: m2.a * m1.e + m2.c * m1.f + m2.e,
    f: m2.b * m1.e + m2.d * m1.f + m2.f,
  };
}

export const translation = (dx: number, dy: number): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: dx, f: dy });

export function rotation(ang: number, about: Vec2 = { x: 0, y: 0 }): Affine {
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);
  return {
    a: cs,
    b: sn,
    c: -sn,
    d: cs,
    e: about.x - cs * about.x + sn * about.y,
    f: about.y - sn * about.x - cs * about.y,
  };
}

export function scaling(s: number, about: Vec2 = { x: 0, y: 0 }): Affine {
  return { a: s, b: 0, c: 0, d: s, e: about.x * (1 - s), f: about.y * (1 - s) };
}

/** Espelhamento em relação à reta que passa por p1 e p2. */
export function mirrorLine(p1: Vec2, p2: Vec2): Affine {
  const th = angleOf(sub(p2, p1));
  const c2 = Math.cos(2 * th);
  const s2 = Math.sin(2 * th);
  const lin = { a: c2, b: s2, c: s2, d: -c2 };
  return {
    ...lin,
    e: p1.x - (lin.a * p1.x + lin.c * p1.y),
    f: p1.y - (lin.b * p1.x + lin.d * p1.y),
  };
}

export const det = (m: Affine): number => m.a * m.d - m.b * m.c;
/** Fator de escala linear (válido para transformações conformes). */
export const linearScale = (m: Affine): number => Math.sqrt(Math.abs(det(m)));
/** Rotação da transformação (ângulo da imagem do eixo X). */
export const rotationOf = (m: Affine): number => Math.atan2(m.b, m.a);

export function isConformal(m: Affine, tol = 1e-9): boolean {
  const sx = Math.hypot(m.a, m.b);
  const sy = Math.hypot(m.c, m.d);
  const orth = m.a * m.c + m.b * m.d;
  return Math.abs(sx - sy) <= tol * Math.max(1, sx) && Math.abs(orth) <= tol * Math.max(1, sx * sy);
}

/** Aplica a transformação preservando id, camada e estilo. */
export function transformEntity<E extends Entity>(e: E, m: Affine): E {
  if (!isConformal(m)) throw new Error("Transformação não conforme não suportada (escala não uniforme).");
  const mirrored = det(m) < 0;
  const s = linearScale(m);
  const p = (q: Vec2) => applyPt(m, q);
  const angMap = (ang: number, c: Vec2) => {
    const q = p({ x: c.x + Math.cos(ang), y: c.y + Math.sin(ang) });
    return angleOf(sub(q, p(c)));
  };
  switch (e.type) {
    case "line":
      return { ...e, a: p(e.a), b: p(e.b) };
    case "point":
      return { ...e, p: p(e.p) };
    case "circle":
      return { ...e, c: p(e.c), r: e.r * s };
    case "arc": {
      const n0 = normAngle(angMap(e.a0, e.c));
      const n1 = normAngle(angMap(e.a1, e.c));
      return mirrored ? { ...e, c: p(e.c), r: e.r * s, a0: n1, a1: n0 } : { ...e, c: p(e.c), r: e.r * s, a0: n0, a1: n1 };
    }
    case "polyline":
      return {
        ...e,
        pts: e.pts.map(p),
        bulges: mirrored ? e.bulges.map((b) => -b) : e.bulges.slice(),
      };
    case "text": {
      // Texto permanece legível no espelhamento (equivalente a MIRRTEXT = 0)
      const rot = mirrored ? e.rot : e.rot + rotationOf(m);
      return { ...e, p: p(e.p), h: e.h * s, rot: normAngle(rot) };
    }
    case "dimension":
      return {
        ...e,
        p1: p(e.p1),
        p2: p(e.p2),
        p3: e.p3 ? p(e.p3) : undefined,
        loc: p(e.loc),
        rot: e.kind === "linear" ? normAngle(mirrored ? -e.rot + 2 * rotationOf(m) : e.rot + rotationOf(m)) : e.rot,
      };
  }
  return e;
}
