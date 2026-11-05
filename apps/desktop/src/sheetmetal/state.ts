import type { CadDocument } from "@agtn/document";
import {
  type CalibrationRecord,
  type KTable,
  type ProfileParams,
  defaultKTable,
} from "@agtn/sheetmetal";

/** Dados do módulo de chapas preservados no projeto (.agtncad → extras.sheetmetal). */
export interface SheetMetalData {
  version: 1;
  kTables: KTable[];
  calibrations: CalibrationRecord[];
  /** Configurações de dobra salvas pelo usuário (presets) */
  presets: { name: string; params: ProfileParams }[];
}

export const SM_KEY = "sheetmetal";

export function readSM(doc: CadDocument): SheetMetalData {
  const raw = doc.extras[SM_KEY] as Partial<SheetMetalData> | undefined;
  const tables = raw?.kTables?.length ? raw.kTables : [defaultKTable()];
  return { version: 1, kTables: tables, calibrations: raw?.calibrations ?? [], presets: raw?.presets ?? [] };
}

export function writeSM(doc: CadDocument, data: SheetMetalData, label: string) {
  doc.commit(label, [doc.extraChange(SM_KEY, structuredClone(data))]);
}
