/**
 * Vetores 2D em precisão dupla (IEEE-754 float64).
 * Todas as coordenadas do AGTN CAD são armazenadas em milímetros, sem arredondamento.
 */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** Tolerância geométrica padrão (mm). Usada apenas para comparações, nunca para arredondar. */
export const EPS = 1e-9;
/** Tolerância para coincidência de pontos em operações de edição (mm). */
export const POINT_TOL = 1e-6;

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const ORIGIN: Vec2 = Object.freeze({ x: 0, y: 0 });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const len2 = (a: Vec2): number => a.x * a.x + a.y * a.y;
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const neg = (a: Vec2): Vec2 => ({ x: -a.x, y: -a.y });
/** Normal à esquerda (rotação +90°). */
export const perpL = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
/** Normal à direita (rotação −90°). */
export const perpR = (a: Vec2): Vec2 => ({ x: a.y, y: -a.x });
export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x);
export const fromAngle = (ang: number, r = 1): Vec2 => ({ x: Math.cos(ang) * r, y: Math.sin(ang) * r });
export const polar = (origin: Vec2, ang: number, r: number): Vec2 => ({
  x: origin.x + Math.cos(ang) * r,
  y: origin.y + Math.sin(ang) * r,
});

export function norm(a: Vec2): Vec2 {
  const l = len(a);
  if (l < EPS) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

export function rotateAbout(p: Vec2, c: Vec2, ang: number): Vec2 {
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
}

export const samePoint = (a: Vec2, b: Vec2, tol = POINT_TOL): boolean => dist(a, b) <= tol;
