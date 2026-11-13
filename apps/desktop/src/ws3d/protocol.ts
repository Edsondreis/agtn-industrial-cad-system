import type { Model3D, NodeId } from "@agtn/model3d";
import type { EdgeRef, FaceRef, Feature, FeatureStatus, Frame, MassProps, Measurement, StepNode, TopoInfo, TopoKind } from "@agtn/solid";

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
}

export interface PreviewResult {
  readonly geom: BodyGeom | null;
  readonly status: readonly FeatureStatus[];
  readonly frames: Readonly<Record<string, Frame>>;
  readonly ms: number;
  /** a prévia parou numa falha: a geometria é a do último sólido válido */
  readonly failed: { readonly id: string; readonly name: string; readonly error: string } | null;
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
  importStep(a: { text: string }): StepNode[];
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
  | { readonly id: number; readonly ok: false; readonly error: string; readonly details?: readonly string[] };
