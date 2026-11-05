/**
 * Unidades. O armazenamento interno é SEMPRE em milímetros;
 * a unidade do documento afeta apenas exibição e entrada de valores.
 */
export type LengthUnit = "mm" | "cm" | "m";

export const UNIT_TO_MM: Record<LengthUnit, number> = { mm: 1, cm: 10, m: 1000 };
export const UNIT_LABEL: Record<LengthUnit, string> = { mm: "Milímetros", cm: "Centímetros", m: "Metros" };

export const toMM = (v: number, u: LengthUnit): number => v * UNIT_TO_MM[u];
export const fromMM = (v: number, u: LengthUnit): number => v / UNIT_TO_MM[u];

/** Código $INSUNITS do DXF (4 = mm, 5 = cm, 6 = m). */
export const DXF_INSUNITS: Record<LengthUnit, number> = { mm: 4, cm: 5, m: 6 };

/** Fator para converter valores do DXF (código $INSUNITS) para mm. `null` = desconhecido/sem unidade. */
export function insunitsToMM(code: number): number | null {
  switch (code) {
    case 1:
      return 25.4; // polegadas
    case 2:
      return 304.8; // pés
    case 4:
      return 1;
    case 5:
      return 10;
    case 6:
      return 1000;
    case 7:
      return 1e6; // km
    case 8:
      return 25.4e-6; // micropolegadas
    case 9:
      return 0.0254; // mils
    case 10:
      return 914.4; // jardas
    case 13:
      return 1e-3; // mícrons
    case 14:
      return 100; // decímetros
    default:
      return null;
  }
}
