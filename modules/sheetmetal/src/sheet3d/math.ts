/**
 * Álgebra mínima da chapa 3D (TypeScript puro, sem OCCT).
 *
 * Mat = transformação rígida 3×4 em linhas: [r00 r01 r02 tx, r10 r11 r12 ty, r20 r21 r22 tz]
 * (mesmo formato que `OcctKernel.transform` recebe). p' = R·p + t.
 */
export interface V2 {
  readonly x: number;
  readonly y: number;
}
export interface V3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export type Mat = readonly number[];

export const v2 = (x: number, y: number): V2 => ({ x, y });
export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });

export const add2 = (a: V2, b: V2): V2 => v2(a.x + b.x, a.y + b.y);
export const sub2 = (a: V2, b: V2): V2 => v2(a.x - b.x, a.y - b.y);
export const mul2 = (a: V2, k: number): V2 => v2(a.x * k, a.y * k);
export const dot2 = (a: V2, b: V2): number => a.x * b.x + a.y * b.y;
export const cross2 = (a: V2, b: V2): number => a.x * b.y - a.y * b.x;
export const len2 = (a: V2): number => Math.hypot(a.x, a.y);
export const unit2 = (a: V2): V2 => mul2(a, 1 / len2(a));
/** perpendicular à direita (horário) — normal para FORA de um contorno anti-horário */
export const right2 = (a: V2): V2 => v2(a.y, -a.x);

export const add3 = (a: V3, b: V3): V3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub3 = (a: V3, b: V3): V3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul3 = (a: V3, k: number): V3 => v3(a.x * k, a.y * k, a.z * k);
export const dot3 = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross3 = (a: V3, b: V3): V3 => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const len3 = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const unit3 = (a: V3): V3 => mul3(a, 1 / len3(a));

export const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** Matriz a partir de origem e eixos (colunas = eixos locais em coordenadas do pai). */
export function frameMat(o: V3, x: V3, y: V3, z: V3): Mat {
  return [x.x, y.x, z.x, o.x, x.y, y.y, z.y, o.y, x.z, y.z, z.z, o.z];
}
export function compose(a: Mat, b: Mat): Mat {
  // (a ∘ b)(p) = a(b(p))
  const r: number[] = new Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) r[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j];
    r[i * 4 + 3] = a[i * 4] * b[3] + a[i * 4 + 1] * b[7] + a[i * 4 + 2] * b[11] + a[i * 4 + 3];
  }
  return r;
}
export const apply = (m: Mat, p: V3): V3 =>
  v3(m[0] * p.x + m[1] * p.y + m[2] * p.z + m[3], m[4] * p.x + m[5] * p.y + m[6] * p.z + m[7], m[8] * p.x + m[9] * p.y + m[10] * p.z + m[11]);
export const applyDir = (m: Mat, d: V3): V3 => v3(m[0] * d.x + m[1] * d.y + m[2] * d.z, m[4] * d.x + m[5] * d.y + m[6] * d.z, m[8] * d.x + m[9] * d.y + m[10] * d.z);
export const apply2 = (m: Mat, p: V2): V2 => {
  const q = apply(m, v3(p.x, p.y, 0));
  return v2(q.x, q.y);
};
export function invert(m: Mat): Mat {
  // rígida: R⁻¹ = Rᵀ, t' = −Rᵀ t
  const t = v3(m[3], m[7], m[11]);
  const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0];
  const it = applyDir(r, t);
  r[3] = -it.x;
  r[7] = -it.y;
  r[11] = -it.z;
  return r;
}
export const translation = (d: V3): Mat => [1, 0, 0, d.x, 0, 1, 0, d.y, 0, 0, 1, d.z];
/** Rotação de `ang` (rad, regra da mão direita) em torno do eixo que passa por `p` com direção unitária `u`. */
export function rotation(p: V3, u: V3, ang: number): Mat {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const C = 1 - c;
  const { x, y, z } = u;
  const R = [
    c + x * x * C, x * y * C - z * s, x * z * C + y * s, 0,
    y * x * C + z * s, c + y * y * C, y * z * C - x * s, 0,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C, 0,
  ];
  // p' = R(q − p) + p
  const rp = applyDir(R, p);
  R[3] = p.x - rp.x;
  R[7] = p.y - rp.y;
  R[11] = p.z - rp.z;
  return R;
}
export const origin = (m: Mat): V3 => v3(m[3], m[7], m[11]);
export const axisX = (m: Mat): V3 => v3(m[0], m[4], m[8]);
export const axisY = (m: Mat): V3 => v3(m[1], m[5], m[9]);
export const axisZ = (m: Mat): V3 => v3(m[2], m[6], m[10]);

/** Área com sinal (positiva = anti-horário). */
export function polyArea(p: readonly V2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) a += cross2(p[i], p[(i + 1) % p.length]);
  return a / 2;
}
/** Interseção das retas (p + t·d) e (q + s·e); null se paralelas. */
export function lineX(p: V2, d: V2, q: V2, e: V2, eps = 1e-14): V2 | null {
  const den = cross2(d, e);
  if (Math.abs(den) < eps * len2(d) * len2(e)) return null;
  const t = cross2(sub2(q, p), e) / den;
  return add2(p, mul2(d, t));
}
