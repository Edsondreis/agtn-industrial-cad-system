/**
 * Tipos do motor de sólidos do AGTN 3D.
 *
 * - Unidade interna: milímetro (igual ao 2D). Ângulos de API: graus (entrada do usuário); internamente radianos.
 * - Eixos: X para a direita, Y para o fundo, Z para cima (convenção de modelagem mecânica).
 * - Nada aqui depende do kernel concreto (OCCT): o resto do sistema só enxerga `SolidRef`.
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const ORIGIN: Vec3 = v3(0, 0, 0);

export interface BBox3 {
  readonly min: Vec3;
  readonly max: Vec3;
}

/**
 * Posicionamento de um corpo: rotação (graus, eixos fixos, ordem X → Y → Z) seguida de translação.
 * Representação editável pelo usuário e serializável sem perda.
 */
export interface Placement {
  readonly origin: Vec3;
  readonly rot: Vec3;
}

export const IDENTITY: Placement = { origin: ORIGIN, rot: ORIGIN };

/** Referência opaca a um shape vivo no kernel (não é persistida). */
export type SolidRef = number & { readonly __solidRef: unique symbol };

export type ShapeKind = "solid" | "shell" | "face" | "wire" | "edge" | "vertex" | "compound" | "compsolid";

/** Propriedades de massa calculadas pela geometria exata (não pela malha). */
export interface MassProps {
  /** mm³ */
  readonly volume: number;
  /** mm² */
  readonly area: number;
  /** centro de massa (densidade uniforme) */
  readonly centroid: Vec3;
  readonly bbox: BBox3;
}

/** Grupo de triângulos/pontos pertencente a uma face/aresta topológica. `id` é estável enquanto o shape não muda. */
export interface TopoRange {
  readonly start: number;
  readonly count: number;
  readonly id: number;
}

/** Malha de visualização (nunca usada para cálculo). */
export interface MeshBuffers {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  /** faixas de triângulos por face B-Rep (start/count em triângulos) */
  readonly faces: readonly TopoRange[];
}

/** Arestas amostradas para desenho de contorno (start/count em pontos XYZ). */
export interface EdgeBuffers {
  readonly points: Float32Array;
  readonly edges: readonly TopoRange[];
}

export interface TessellationQuality {
  /** desvio máximo de corda (mm) */
  readonly linear: number;
  /** desvio angular máximo (rad) */
  readonly angular: number;
}

export const QUALITY_VIEW: TessellationQuality = { linear: 0.1, angular: 0.35 };

/** Erro do motor de sólidos com mensagem para o usuário (pt-BR) e código estável para a IA/testes. */
export class SolidError extends Error {
  constructor(
    readonly code: "INVALID_PARAMS" | "KERNEL" | "BOOLEAN" | "IO" | "NOT_READY",
    message: string,
    readonly details: readonly string[] = [],
  ) {
    super(message);
    this.name = "SolidError";
  }
}

export type TopoKind = "face" | "edge" | "vertex";

/** Elemento topológico: corpo + tipo + índice na ordem de exploração do OCCT (mesma ordem da malha). */
export interface TopoSel {
  readonly ref: SolidRef;
  /** "solid" = o corpo inteiro */
  readonly kind: TopoKind | "solid";
  readonly index: number;
}

/** Informação exata de uma face (superfície do B-Rep, com o posicionamento aplicado). */
export interface FaceInfo {
  readonly kind: "face";
  /** plane | cylinder | cone | sphere | torus | bspline | … */
  readonly surface: string;
  /** mm² */
  readonly area: number;
  /** centroide da superfície */
  readonly center: Vec3;
  /** plano: normal; cilindro/cone/toro: eixo */
  readonly normal?: Vec3;
  readonly axis?: Vec3;
  readonly axisPoint?: Vec3;
  /** cilindro/esfera: raio; cone: raio de referência; toro: raio maior */
  readonly radius?: number;
  readonly minorRadius?: number;
  /** cone: semiângulo (graus) */
  readonly semiAngle?: number;
}

export interface EdgeInfo {
  readonly kind: "edge";
  /** line | circle | ellipse | bspline | … */
  readonly curve: string;
  /** mm (comprimento exato da curva) */
  readonly length: number;
  readonly start: Vec3;
  readonly end: Vec3;
  readonly closed: boolean;
  readonly direction?: Vec3;
  readonly center?: Vec3;
  readonly radius?: number;
  readonly axis?: Vec3;
}

export interface VertexInfo {
  readonly kind: "vertex";
  readonly point: Vec3;
}

export type TopoInfo = FaceInfo | EdgeInfo | VertexInfo;

/** Resultado de medição entre dois elementos (distância mínima exata pelo kernel). */
export interface Measurement {
  /** distância mínima (mm); 0 = se tocam */
  readonly distance: number;
  /** pontos mais próximos, quando determináveis exatamente */
  readonly pa?: Vec3;
  readonly pb?: Vec3;
  /** componentes ΔX ΔY ΔZ entre pa e pb */
  readonly delta?: Vec3;
  /** ângulo entre faces planas / arestas retas (graus, 0–90 para retas, 0–180 para normais) */
  readonly angle?: number;
  /** faces planas paralelas: distância entre os planos */
  readonly planeGap?: number;
}

/** Árvore de montagem lida/gravada em STEP. Corpos em BREP binário, posições relativas ao pai (matriz 3×4). */
export interface StepNode {
  readonly name: string;
  readonly matrix: readonly number[];
  readonly children?: readonly StepNode[];
  readonly brep?: Uint8Array;
  readonly color?: readonly [number, number, number];
}
