/** Utilitários angulares. Ângulos internos SEMPRE em radianos; sentido positivo = anti-horário (CCW). */
export const TAU = Math.PI * 2;
export const ANG_EPS = 1e-10;

export const deg2rad = (d: number): number => (d * Math.PI) / 180;
export const rad2deg = (r: number): number => (r * 180) / Math.PI;

/** Normaliza para [0, 2π). */
export function normAngle(a: number): number {
  let r = a % TAU;
  if (r < 0) r += TAU;
  if (r >= TAU - ANG_EPS) r = 0;
  return r;
}

/** Varredura CCW de a0 até a1, em (0, 2π]. Ângulos iguais representam volta completa. */
export function ccwSweep(a0: number, a1: number): number {
  const s = normAngle(a1 - a0);
  return s < ANG_EPS ? TAU : s;
}

/** Verifica se o ângulo `a` está dentro da varredura CCW que começa em a0 com extensão `sweep`. */
export function angleWithin(a: number, a0: number, sweep: number, eps = 1e-9): boolean {
  if (sweep >= TAU - eps) return true;
  const d = normAngle(a - a0);
  return d <= sweep + eps || d >= TAU - eps;
}

/** Parâmetro (0..sweep) de um ângulo relativo ao início do arco. */
export function angleParam(a: number, a0: number): number {
  return normAngle(a - a0);
}
