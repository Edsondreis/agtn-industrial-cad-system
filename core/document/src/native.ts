import type { Entity, EntityType } from "@agtn/geometry";
import { type CadDocument, type DocSettings, DEFAULT_SETTINGS } from "./document";
import type { Layer } from "./layers";

/**
 * Formato nativo `.agtncad` — JSON UTF-8 versionado.
 * Preserva entidades (coordenadas float64 sem arredondamento), camadas, configurações,
 * unidade, camada atual e dados de módulos (`extras`, ex.: tabelas de fator K).
 */
export const AGTNCAD_FORMAT = "agtncad";
export const AGTNCAD_VERSION = 1;
export const AGTNCAD_EXTENSION = "agtncad";

export interface AgtnCadFile {
  format: typeof AGTNCAD_FORMAT;
  version: number;
  generator: string;
  savedAt: string;
  settings: DocSettings;
  currentLayer: string;
  layers: Layer[];
  entities: Entity[];
  extras: Record<string, unknown>;
}

export function serializeDocument(doc: CadDocument, generator = "AGTN CAD"): string {
  const file: AgtnCadFile = {
    format: AGTNCAD_FORMAT,
    version: AGTNCAD_VERSION,
    generator,
    savedAt: new Date().toISOString(),
    settings: doc.settings,
    currentLayer: doc.currentLayer,
    layers: doc.layers.slice(),
    entities: doc.all(),
    extras: { ...doc.extras },
  };
  // JSON.stringify preserva float64 com ida e volta exata (shortest round-trip).
  return JSON.stringify(file);
}

const KNOWN: EntityType[] = ["line", "circle", "arc", "polyline", "point", "text", "dimension"];
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPt = (v: unknown): boolean => !!v && typeof v === "object" && isNum((v as { x: unknown }).x) && isNum((v as { y: unknown }).y);

function validEntity(e: Record<string, unknown>): string | null {
  if (typeof e.id !== "string" || typeof e.layer !== "string") return "id/camada ausente";
  switch (e.type as EntityType) {
    case "line":
      return isPt(e.a) && isPt(e.b) ? null : "linha inválida";
    case "circle":
      return isPt(e.c) && isNum(e.r) && (e.r as number) > 0 ? null : "círculo inválido";
    case "arc":
      return isPt(e.c) && isNum(e.r) && isNum(e.a0) && isNum(e.a1) ? null : "arco inválido";
    case "polyline":
      return Array.isArray(e.pts) && e.pts.every(isPt) && Array.isArray(e.bulges) && (e.bulges as unknown[]).every(isNum)
        ? null
        : "polilinha inválida";
    case "point":
      return isPt(e.p) ? null : "ponto inválido";
    case "text":
      return isPt(e.p) && isNum(e.h) && typeof e.value === "string" ? null : "texto inválido";
    case "dimension":
      return isPt(e.p1) && isPt(e.p2) && isPt(e.loc) ? null : "cota inválida";
  }
  return "tipo desconhecido";
}

export interface LoadReport {
  loaded: number;
  skipped: { index: number; reason: string }[];
  warnings: string[];
}

/** Valida e carrega um arquivo `.agtncad` no documento. Lança erro se o arquivo não for reconhecido. */
export function deserializeInto(doc: CadDocument, text: string): LoadReport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Arquivo corrompido: JSON inválido.");
  }
  const f = raw as Partial<AgtnCadFile>;
  if (!f || f.format !== AGTNCAD_FORMAT) throw new Error("Arquivo não é um projeto AGTN CAD.");
  if (!isNum(f.version) || f.version > AGTNCAD_VERSION)
    throw new Error(`Versão de arquivo não suportada (${String(f.version)}). Atualize o AGTN CAD.`);
  const report: LoadReport = { loaded: 0, skipped: [], warnings: [] };
  const entities: Entity[] = [];
  const ids = new Set<string>();
  (f.entities ?? []).forEach((e, index) => {
    const rec = e as unknown as Record<string, unknown>;
    if (!KNOWN.includes(rec.type as EntityType)) {
      report.skipped.push({ index, reason: `tipo "${String(rec.type)}" desconhecido` });
      return;
    }
    const err = validEntity(rec);
    if (err) {
      report.skipped.push({ index, reason: err });
      return;
    }
    if (ids.has(e.id)) {
      report.skipped.push({ index, reason: "id duplicado" });
      return;
    }
    ids.add(e.id);
    entities.push({ ...e, color: e.color ?? null, lineweight: e.lineweight ?? null, linetype: e.linetype ?? null } as Entity);
  });
  report.loaded = entities.length;
  doc.load({
    entities,
    layers: Array.isArray(f.layers) ? f.layers : [],
    currentLayer: typeof f.currentLayer === "string" ? f.currentLayer : "0",
    settings: { ...DEFAULT_SETTINGS, ...(f.settings ?? {}) },
    extras: f.extras && typeof f.extras === "object" ? f.extras : {},
  });
  if (report.skipped.length) report.warnings.push(`${report.skipped.length} objeto(s) inválido(s) ignorado(s).`);
  return report;
}
