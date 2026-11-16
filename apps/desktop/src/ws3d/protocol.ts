import type { Model3D, NodeId, StepScan } from "@agtn/model3d";
import type { FlatPattern, SheetMat } from "@agtn/sheetgraph";
import type { EdgeRef, FaceRef, Feature, FeatureStatus, Frame, GeometryCheck, MassProps, Measurement, SheetEdgeRef, StepNode, TopoInfo, TopoKind } from "@agtn/solid";

/** Peça de chapa: resumo do grafo resolvido (dados puros) para a interface. */
export interface SheetInfo {
  /** última operação de chapa válida */
  readonly feature: string;
  /** operações sólidas genéricas depois da chapa (planificação inválida) */
  readonly generic: readonly string[];
  readonly T: number;
  readonly volume: number;
  readonly flatArea: number;
  readonly flat: FlatPattern;
  readonly flanges: readonly { readonly id: string; readonly label: string; readonly area: number }[];
  /** cantos entre faixas de dobra vizinhas (ETAPA 2.2: detectados; tipo aplicado pela operação Canto, 2.3) */
  readonly corners: readonly { readonly id: string; readonly label: string; readonly angleDeg: number; readonly kind: string }[];
  /** sistema local da base (plano da planificação) → coordenadas locais da peça */
  readonly flatFrame: SheetMat;
  /** rótulos de proveniência por face do sólido exibido */
  readonly faceLabels: readonly (readonly string[])[];
  readonly ms: { readonly solve: number; readonly build: number };
}

/** Geometria de um corpo pronta para o viewport (arrays transferíveis, sem cópia). */
export interface BodyGeom {
  readonly id: NodeId;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  /** faixas por face B-Rep: [inícioTri, qtdTri, …] na ordem topológica do OCCT */
  readonly faces: Int32Array;
  /** pontos das arestas (XYZ) */
  readonly edgePoints: Float32Array;
  /** faixas por aresta: [inícioPonto, qtdPontos, …] na ordem topológica do OCCT */
  readonly edges: Int32Array;
  /** vértices exatos (XYZ) na ordem topológica */
  readonly vertices: Float64Array;
  readonly props: MassProps;
  readonly topo: { solids: number; faces: number; edges: number; vertices: number };
}

export interface SyncResult {
  readonly built: BodyGeom[];
  readonly removed: NodeId[];
  readonly errors: Record<NodeId, string>;
  readonly ms: number;
  /** estado de cada operação das peças regeneradas */
  readonly features: Record<NodeId, readonly FeatureStatus[]>;
  /** planos dos esboços (coordenadas locais da peça) */
  readonly frames: Record<NodeId, Readonly<Record<string, Frame>>>;
  readonly empty: NodeId[];
  /** peças com operação falhando: o sólido exibido é o último válido, antes desta operação */
  readonly partial: Record<NodeId, { readonly id: string; readonly name: string; readonly error: string }>;
  /** peças de chapa regeneradas */
  readonly sheets: Record<NodeId, SheetInfo>;
}

export interface PreviewResult {
  readonly geom: BodyGeom | null;
  readonly status: readonly FeatureStatus[];
  readonly frames: Readonly<Record<string, Frame>>;
  readonly ms: number;
  /** a prévia parou numa falha: a geometria é a do último sólido válido */
  readonly failed: { readonly id: string; readonly name: string; readonly error: string } | null;
  readonly sheet: SheetInfo | null;
}

export interface EngineStats {
  readonly wasmBytes: number;
  readonly liveShapes: number;
  readonly bodies: number;
}

export interface TopoRefMsg {
  readonly body: NodeId;
  readonly kind: TopoKind | "solid";
  readonly index: number;
}

/** Operações do worker (pedido → resposta). */
/** P-F5-01: o que foi normalizado no texto antes do leitor do OCCT (só ordem de laço / meia cônica; ver step-pole.ts). */
export interface StepRepair {
  readonly fixes: number;
  readonly halfConics: number;
  readonly poleFaces: number;
  readonly skipped: readonly string[];
}

export interface EngineApi {
  init(a: { wasm: ArrayBuffer }): { kernel: string; ms: number };
  /** `full`: descarta o cache e devolve a geometria de todos os corpos (viewport recém-criado). */
  sync(a: { model: Model3D; full?: boolean }): SyncResult;
  info(a: TopoRefMsg): TopoInfo;
  measure(a: { a: TopoRefMsg; b: TopoRefMsg }): Measurement;
  /** referência estável para a face/aresta nº `index` do corpo exibido */
  identify(a: { body: NodeId; kind: "face" | "edge"; index: number; model?: Model3D }): FaceRef | EdgeRef;
  /** prévia de uma peça com as operações em edição (não altera o documento) */
  preview(a: { model: Model3D; body: NodeId; features: readonly Feature[]; rollback: number | null }): PreviewResult;
  /** aresta do sólido de chapa exibido → aresta do grafo (aba + chave), com a posição da linha de molde */
  sheetEdge(a: { body: NodeId; index: number }): SheetEdgeRef & { readonly label: string; readonly bent: string | null };
  /** sólido PLANIFICADO (contorno × T, mesmo grafo) no lugar da base, com as linhas de dobra (XYZ, pares) */
  sheetFlat(a: { body: NodeId; model?: Model3D }): { readonly geom: BodyGeom; readonly bendLines: Float32Array; readonly regionLines: Float32Array };
  importStep(a: { text: string }): StepNode[];
  /** FASE 5 — abrir STEP como documento: cabeçalho/unidades (leitura própria) + árvore do OCCT, tudo no worker */
  openStep(a: { text: string }): { readonly scan: StepScan; readonly nodes: StepNode[]; readonly repair: StepRepair | null };
  /** verificação de geometria por corpo exibido (forma + arestas sobre as superfícies + volume coerente) — P-F5-01 */
  checkBodies(a: { ids: NodeId[] }): Record<NodeId, GeometryCheck>;
  exportStep(a: { model: Model3D; ids?: NodeId[] }): string;
  exportStl(a: { ids: NodeId[] }): Uint8Array;
  stats(a: Record<string, never>): EngineStats;
}

export type EngineOp = keyof EngineApi;
export interface EngineRequest<K extends EngineOp = EngineOp> {
  readonly id: number;
  readonly op: K;
  readonly args: Parameters<EngineApi[K]>[0];
}
export type EngineResponse =
  | { readonly id: number; readonly ok: true; readonly result: unknown }
  | {
      readonly id: number;
      readonly ok: false;
      readonly error: string;
      readonly details?: readonly string[];
      /** nome do erro original (F-06) e etapa ("init" na inicialização do OCCT) */
      readonly errorName?: string;
      readonly stage?: "init" | "sync";
    };
