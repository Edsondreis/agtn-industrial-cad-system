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
