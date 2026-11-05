/**
 * Fórmulas fundamentais de dobra de chapas.
 *
 * CONVENÇÃO ANGULAR (obrigatória em todo o módulo):
 *   θ  = ÂNGULO DE DOBRA = alteração de direção da chapa (deflexão), 0 < θ < 180°.
 *        Chapa plana → θ = 0. Dobra em "L" reto → θ = 90°.
 *   α  = ÂNGULO INTERNO DA PEÇA = ângulo incluído entre as abas = 180° − θ.
 *        Um "L" reto tem α = 90°; uma dobra aberta de θ = 45° tem α = 135°.
 *   Todas as fórmulas abaixo usam θ (em radianos). Use `includedToBend` para converter.
 *
 * Grandezas (mm):
 *   T  = espessura; R = raio interno; K = fator K (posição do eixo neutro / T, a partir da face interna).
 *   BA  (bend allowance)  = θ · (R + K·T)          — comprimento do eixo neutro no arco.
 *   OSB (outside setback) = (R + T) · tan(θ/2)     — da tangência até o vértice virtual externo.
 *   ISB (inside setback)  = R · tan(θ/2)           — da tangência até o vértice virtual interno.
 *   BD  (bend deduction)  = 2·OSB − BA             — desconto aplicado às dimensões EXTERNAS.
 *   BDi (inside deduction)= 2·ISB − BA             — desconto equivalente para dimensões INTERNAS.
 *
 * Nenhum valor é arredondado aqui: o arredondamento é feito só na apresentação.
 */
export const deg = (d: number): number => (d * Math.PI) / 180;
export const toDeg = (r: number): number => (r * 180) / Math.PI;

export const includedToBend = (alphaDeg: number): number => 180 - alphaDeg;
export const bendToIncluded = (thetaDeg: number): number => 180 - thetaDeg;

export function bendAllowance(thetaRad: number, R: number, K: number, T: number): number {
  return thetaRad * (R + K * T);
}
export function outsideSetback(thetaRad: number, R: number, T: number): number {
  return (R + T) * Math.tan(thetaRad / 2);
}
export function insideSetback(thetaRad: number, R: number): number {
  return R * Math.tan(thetaRad / 2);
}
export function bendDeduction(thetaRad: number, R: number, K: number, T: number): number {
  return 2 * outsideSetback(thetaRad, R, T) - bendAllowance(thetaRad, R, K, T);
}
export function insideBendDeduction(thetaRad: number, R: number, K: number, T: number): number {
  return 2 * insideSetback(thetaRad, R) - bendAllowance(thetaRad, R, K, T);
}
/** Raio do eixo neutro. */
export const neutralRadius = (R: number, K: number, T: number): number => R + K * T;

/**
 * Fator K a partir de um BA conhecido: K = (BA/θ − R)/T.
 */
export function kFromBendAllowance(BA: number, thetaRad: number, R: number, T: number): number {
  return (BA / thetaRad - R) / T;
}

/**
 * Calibração por ensaio de dobra em "L":
 * uma tira de comprimento plano `blank` é dobrada em θ; medem-se as abas EXTERNAS `a` e `b`
 * (até o vértice virtual externo). Então BD_obs = a + b − blank, BA_obs = 2·OSB − BD_obs.
 */
export function calibrateFromLTest(input: {
  blank: number;
  outerA: number;
  outerB: number;
  thetaDeg: number;
  R: number;
  T: number;
}): { BD: number; BA: number; K: number } {
  const th = deg(input.thetaDeg);
  const BD = input.outerA + input.outerB - input.blank;
  const BA = 2 * outsideSetback(th, input.R, input.T) - BD;
  return { BD, BA, K: kFromBendAllowance(BA, th, input.R, input.T) };
}
