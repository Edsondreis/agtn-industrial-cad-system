import type { Change, Layer } from "@agtn/document";
import { MATERIALS, PROCESS_LABEL, SM_LAYERS, SOURCE_LABEL, type BendProcess, type ValueSource } from "@agtn/sheetmetal";

/** Opções da chapa (tabela de materiais e processos do módulo de chapa — a mesma do 2D). */
export const MATERIAL_OPTIONS: readonly [string, string][] = MATERIALS.map((m) => [m.id, m.name]);
export const BEND_PROCESS_OPTIONS: readonly [string, string][] = (Object.keys(PROCESS_LABEL) as BendProcess[]).map((k) => [k, PROCESS_LABEL[k]]);
export const kSourceLabel = (s: ValueSource) => SOURCE_LABEL[s];

/** Camadas de fabricação que faltam no desenho (as mesmas do AGTN SHEET METAL 2D). */
export function sheetLayerChanges(has: (name: string) => boolean, count: number): Change[] {
  const out: Change[] = [];
  let n = count;
  for (const l of SM_LAYERS)
    if (!has(l.name)) out.push({ kind: "layer-add", layer: { name: l.name, color: l.color, lineweight: l.lineweight, linetype: l.linetype, visible: true, locked: false } as Layer, index: n++ });
  return out;
}
