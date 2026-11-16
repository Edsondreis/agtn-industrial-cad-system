/**
 * Documento STEP aberto para visualização (FASE 5).
 *
 * Abrir um .step/.stp NÃO altera o projeto .agtncad: o arquivo vira um modelo 3D próprio, só de leitura,
 * mantido em memória enquanto a aba estiver aberta. Cada sólido continua sendo B-rep (BREP binário do OCCT
 * em base64, `source: brep`), não uma malha: volume, área e caixa vêm da geometria exata; a malha serve só
 * para desenhar.
 */
import type { BBox3, GeometryCheck, MassProps, StepNode } from "@agtn/solid";
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
  /** verificação completa (forma + arestas sobre as superfícies + volume coerente) — P-F5-01 */
  readonly check?: GeometryCheck;
}

/**
 * Classificação de uma medida (P-F5-01 §1.6). Só "exato" pode ser apresentado como resultado de engenharia.
 *  - exato: B-rep aprovado na verificação completa; volume/área/caixa do B-rep.
 *  - aproximado: valor derivado da malha de exibição (triangulação). No documento STEP nenhuma medida é desse tipo:
 *    a malha só desenha. O rótulo existe para deixar isso explícito na interface.
 *  - invalido: geometria reprovada (forma, aresta fora da superfície ou volume incoerente): o número do motor existe,
 *    mas NÃO é confiável e não é mostrado como medida.
 *  - nao_calculavel: não há volume a calcular (casca/superfície aberta) ou o motor não devolveu valor finito.
 *  - nao_verificado: a verificação ainda não rodou ou não conseguiu medir tudo.
 */
export type MeasureGrade = "exato" | "aproximado" | "invalido" | "nao_calculavel" | "nao_verificado";
export const MEASURE_GRADE_LABEL: Record<MeasureGrade, string> = {
  exato: "exato (B-rep verificado)",
  aproximado: "aproximado (malha)",
  invalido: "inválido — não apto para engenharia/fabricação",
  nao_calculavel: "não calculável",
  nao_verificado: "não verificado",
};

/** Classe do VOLUME de um corpo. */
export function gradeBody(b: BodyFacts): MeasureGrade {
  if (b.valid === false || (b.check && (!b.check.shapeValid || b.check.faces.length > 0 || !b.check.volumeOk))) return "invalido";
  if (b.topo.solids === 0 || !Number.isFinite(b.props.volume) || !(Math.abs(b.props.volume) > 0)) return "nao_calculavel";
  if (!b.check || b.check.unmeasured > 0 || !b.check.ok) return "nao_verificado";
  return "exato";
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
  /** corpos reprovados pelo verificador: medidas podem estar erradas */
  readonly invalid: number;
  /** contagem por classe de medida (P-F5-01 §1.6) */
  readonly grades: Readonly<Record<MeasureGrade, number>>;
  /** pior classe entre os corpos: só "exato" permite mostrar volume/área como resultado */
  readonly grade: MeasureGrade;
  /** mm³ — soma só dos corpos "exato" */
  readonly volumeExact: number;
}

const GRADE_ORDER: readonly MeasureGrade[] = ["invalido", "nao_calculavel", "nao_verificado", "aproximado", "exato"];

export function summarize(list: readonly BodyFacts[]): StepSummary {
  let solids = 0, faces = 0, edges = 0, vertices = 0, volume = 0, area = 0, open = 0, invalid = 0, volumeExact = 0;
  const grades: Record<MeasureGrade, number> = { exato: 0, aproximado: 0, invalido: 0, nao_calculavel: 0, nao_verificado: 0 };
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
    const g = gradeBody(b);
    grades[g]++;
    if (g === "invalido") invalid++;
    if (g === "exato") volumeExact += b.props.volume;
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
    grades,
    grade: list.length ? GRADE_ORDER.find((g) => grades[g] > 0)! : "nao_calculavel",
    volumeExact,
  };
}
