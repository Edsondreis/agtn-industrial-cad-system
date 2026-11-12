import type { Placement, Vec3 } from "./types";

const RAD = Math.PI / 180;

/**
 * Matriz afim 3×4 (row-major: r00 r01 r02 tx · r10 r11 r12 ty · r20 r21 r22 tz) do Placement.
 * Rotação em eixos fixos na ordem X → Y → Z (R = Rz·Ry·Rx), depois translação.
 */
export function placementMatrix(p: Placement): number[] {
  const [cx, sx] = [Math.cos(p.rot.x * RAD), Math.sin(p.rot.x * RAD)];
  const [cy, sy] = [Math.cos(p.rot.y * RAD), Math.sin(p.rot.y * RAD)];
  const [cz, sz] = [Math.cos(p.rot.z * RAD), Math.sin(p.rot.z * RAD)];
  // Rz·Ry·Rx
  const r00 = cz * cy;
  const r01 = cz * sy * sx - sz * cx;
  const r02 = cz * sy * cx + sz * sx;
  const r10 = sz * cy;
  const r11 = sz * sy * sx + cz * cx;
  const r12 = sz * sy * cx - cz * sx;
  const r20 = -sy;
  const r21 = cy * sx;
  const r22 = cy * cx;
  const snap = (v: number) => (Math.abs(v) < 1e-15 ? 0 : v);
  return [r00, r01, r02, p.origin.x, r10, r11, r12, p.origin.y, r20, r21, r22, p.origin.z].map(snap);
}

export function isIdentity(p: Placement): boolean {
  const o = p.origin;
  const r = p.rot;
  return o.x === 0 && o.y === 0 && o.z === 0 && r.x === 0 && r.y === 0 && r.z === 0;
}

/** Aplica o Placement a um ponto (mesma matriz enviada ao kernel). */
export function applyPlacement(p: Placement, v: Vec3): Vec3 {
  const m = placementMatrix(p);
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z + m[3],
    y: m[4] * v.x + m[5] * v.y + m[6] * v.z + m[7],
    z: m[8] * v.x + m[9] * v.y + m[10] * v.z + m[11],
  };
}

export type Matrix34 = readonly number[];
export const MATRIX_IDENTITY: Matrix34 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** a ∘ b (aplica b, depois a). Matrizes 3×4 row-major. */
export function composeMatrix(a: Matrix34, b: Matrix34): number[] {
  const r = new Array<number>(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) r[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j];
    r[i * 4 + 3] = a[i * 4] * b[3] + a[i * 4 + 1] * b[7] + a[i * 4 + 2] * b[11] + a[i * 4 + 3];
  }
  return r;
}

export function applyMatrix(m: Matrix34, v: Vec3): Vec3 {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z + m[3],
    y: m[4] * v.x + m[5] * v.y + m[6] * v.z + m[7],
    z: m[8] * v.x + m[9] * v.y + m[10] * v.z + m[11],
  };
}

/** Inversa de uma transformação rígida (rotação + translação). */
export function invertRigid(m: Matrix34): number[] {
  // Rᵀ e −Rᵀ·t
  const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0];
  r[3] = -(r[0] * m[3] + r[1] * m[7] + r[2] * m[11]);
  r[7] = -(r[4] * m[3] + r[5] * m[7] + r[6] * m[11]);
  r[11] = -(r[8] * m[3] + r[9] * m[7] + r[10] * m[11]);
  return r;
}

/**
 * Decompõe uma matriz rígida em Placement (rotação X→Y→Z em graus + origem). Inversa de `placementMatrix`.
 * Valores arredondados a 1e-9 para não gerar "89,9999999°" vindos de STEP.
 */
export function matrixToPlacement(m: Matrix34): Placement {
  const DEG = 180 / Math.PI;
  const clean = (v: number) => {
    const r = Math.round(v * 1e9) / 1e9;
    return Object.is(r, -0) ? 0 : r;
  };
  const sy = Math.max(-1, Math.min(1, -m[8]));
  const y = Math.asin(sy);
  let x: number;
  let z: number;
  if (Math.abs(Math.cos(y)) > 1e-9) {
    x = Math.atan2(m[9], m[10]);
    z = Math.atan2(m[4], m[0]);
  } else {
    // trava de cardan: fixa Z = 0
    z = 0;
    x = Math.atan2(-m[6], m[5]);
  }
  return {
    origin: { x: clean(m[3]), y: clean(m[7]), z: clean(m[11]) },
    rot: { x: clean(x * DEG), y: clean(y * DEG), z: clean(z * DEG) },
  };
}
