/** Camadas do desenho. */
export interface Layer {
  readonly name: string;
  /** Cor ACI 1..255 */
  readonly color: number;
  /** Espessura em mm (valores padrão ISO: 0,13 / 0,18 / 0,25 / 0,35 / 0,50 / 0,70 ...) */
  readonly lineweight: number;
  readonly linetype: string;
  readonly visible: boolean;
  readonly locked: boolean;
}

export const LINEWEIGHTS_MM = [0.0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1.0, 1.06, 1.2, 1.4, 1.58, 2.0, 2.11];

/** Tipos de linha suportados (padrões em mm, positivo = traço, negativo = espaço, 0 = ponto). */
export interface Linetype {
  readonly name: string;
  readonly description: string;
  readonly pattern: readonly number[];
}

export const LINETYPES: readonly Linetype[] = [
  { name: "CONTINUOUS", description: "Contínua ________", pattern: [] },
  { name: "DASHED", description: "Tracejada __ __ __", pattern: [6, -3] },
  { name: "HIDDEN", description: "Oculta _ _ _ _", pattern: [3, -1.5] },
  { name: "CENTER", description: "Centro ___ _ ___", pattern: [12, -3, 3, -3] },
  { name: "PHANTOM", description: "Fantasma ___ _ _ ___", pattern: [12, -3, 3, -3, 3, -3] },
  { name: "DOT", description: "Pontilhada . . . .", pattern: [0, -2] },
];

export const linetypeByName = (n: string): Linetype =>
  LINETYPES.find((l) => l.name === n.toUpperCase()) ?? LINETYPES[0];

export const DEFAULT_LAYER: Layer = {
  name: "0",
  color: 7,
  lineweight: 0.25,
  linetype: "CONTINUOUS",
  visible: true,
  locked: false,
};

/** Validação de nome compatível com DXF R12 (A–Z, 0–9, $ - _ ; até 31 caracteres). */
export function validateLayerName(name: string): string | null {
  const n = name.trim();
  if (!n) return "Nome vazio.";
  if (n.length > 31) return "Máximo de 31 caracteres (compatibilidade DXF R12).";
  if (!/^[A-Za-z0-9_$\-]+$/.test(n)) return "Use apenas letras sem acento, números, $, - e _ (compatibilidade DXF R12).";
  return null;
}
