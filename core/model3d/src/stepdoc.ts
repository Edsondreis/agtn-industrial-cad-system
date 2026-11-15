/**
 * Documento STEP aberto para visualização (FASE 5).
 *
 * Abrir um .step/.stp NÃO altera o projeto .agtncad: o arquivo vira um modelo 3D próprio, só de leitura,
 * mantido em memória enquanto a aba estiver aberta. Cada sólido continua sendo B-rep (BREP binário do OCCT
 * em base64, `source: brep`), não uma malha: volume, área e caixa vêm da geometria exata; a malha serve só
 * para desenhar.
 */
import type { BBox3, MassProps, StepNode } from "@agtn/solid";
import { insertStepTree } from "./step";
import { type Model3D, type NodeId, emptyModel } from "./model";
import { type StepScan, scanStep } from "./stepinfo";

/** Limite de tamanho aceito para abrir (texto). Acima disso a leitura é recusada com mensagem clara. */
export const STEP_MAX_BYTES = 200 * 1024 * 1024;

export type StepPhase = "carregando" | "interpretando" | "gerando" | "pronto" | "falha";
export const STEP_PHASE_LABEL: Record<StepPhase, string> = {
  carregando: "Carregando arquivo",
  interpretando: "Interpretando geometria",
  gerando: "Gerando visualização",
  pronto: "Arquivo pronto",
  falha: "Falha na leitura",
};

/** Verificação barata antes de chamar o motor: tamanho, assinatura e integridade do texto. */
export function precheckStep(text: string, bytes: number): { ok: true; scan: StepScan } | { ok: false; error: string; scan: StepScan | null } {
  if (bytes === 0 || !text.trim()) return { ok: false, error: "Arquivo STEP vazio.", scan: null };
  if (bytes > STEP_MAX_BYTES) return { ok: false, error: `Arquivo STEP muito grande (${(bytes / 1048576).toFixed(0)} MB; limite ${STEP_MAX_BYTES / 1048576} MB).`, scan: null };
  const scan = scanStep(text);
  if (!scan.valid) return { ok: false, error: "O arquivo não é um STEP válido (cabeçalho ISO-10303-21 ausente).", scan };
  if (scan.entities === 0) return { ok: false, error: "O arquivo STEP não contém entidades (seção DATA vazia ou ausente).", scan };
  return { ok: true, scan };
}

export interface StepDocument {
  readonly model: Model3D;
  readonly roots: readonly NodeId[];
}

/** Árvore do OCCT (nomes, cores, matrizes, BREP) → modelo 3D próprio do documento. */
export function stepTreeToModel(nodes: readonly StepNode[], fileName: string): StepDocument {
  const r = insertStepTree(emptyModel(), nodes, fileName);
  return { model: r.model, roots: r.ids };
}

export interface BodyFacts {
  readonly props: MassProps;
  readonly topo: { readonly solids: number; readonly faces: number; readonly edges: number; readonly vertices: number };
  /** resultado do verificador de forma do OCCT (BRepCheck); undefined = não verificado */
  readonly valid?: boolean;
}

export interface StepSummary {
  readonly bodies: number;
  readonly solids: number;
  readonly faces: number;
  readonly edges: number;
  readonly vertices: number;
  /** mm³ — soma dos sólidos (B-rep exato) */
  readonly volume: number;
  /** mm² */
  readonly area: number;
  readonly bbox: BBox3 | null;
  /** corpos sem volume (cascas/superfícies abertas) */
  readonly open: number;
  /** corpos reprovados pelo verificador de forma: medidas podem estar erradas */
  readonly invalid: number;
}

export function summarize(list: readonly BodyFacts[]): StepSummary {
  let solids = 0, faces = 0, edges = 0, vertices = 0, volume = 0, area = 0, open = 0, invalid = 0;
  let min: [number, number, number] | null = null;
  let max: [number, number, number] = [0, 0, 0];
  for (const b of list) {
    solids += b.topo.solids;
    faces += b.topo.faces;
    edges += b.topo.edges;
    vertices += b.topo.vertices;
    volume += b.props.volume;
    area += b.props.area;
    if (b.topo.solids === 0 || !(Math.abs(b.props.volume) > 0)) open++;
    if (b.valid === false) invalid++;
    const { min: a, max: z } = b.props.bbox;
    if (![a.x, a.y, a.z, z.x, z.y, z.z].every(Number.isFinite)) continue;
    if (!min) {
      min = [a.x, a.y, a.z];
      max = [z.x, z.y, z.z];
    } else {
      min = [Math.min(min[0], a.x), Math.min(min[1], a.y), Math.min(min[2], a.z)];
      max = [Math.max(max[0], z.x), Math.max(max[1], z.y), Math.max(max[2], z.z)];
    }
  }
  return {
    bodies: list.length,
    solids,
    faces,
    edges,
    vertices,
    volume,
    area,
    bbox: min ? { min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } } : null,
    open,
    invalid,
  };
}
