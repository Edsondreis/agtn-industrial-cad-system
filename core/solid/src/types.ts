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
