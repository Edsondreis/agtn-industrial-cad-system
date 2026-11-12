import type { PrimitiveSpec } from "./primitives";
import type { EdgeBuffers, MassProps, MeshBuffers, Placement, ShapeKind, SolidRef, TessellationQuality } from "./types";

/**
 * Contrato do motor de sólidos B-Rep. A UI, o documento 3D e a IA só conhecem esta interface;
 * a implementação atual é OCCT 8 em WebAssembly (`OcctSolidKernel`), substituível por um kernel nativo.
 *
 * Toda operação devolve um shape NOVO (os de entrada continuam válidos). Quem cria libera com `release`.
 * Erros sempre como `SolidError` com mensagem em pt-BR.
 */
export interface SolidKernel {
  readonly name: string;

  /** Cria a primitiva (valida os parâmetros antes) e aplica o posicionamento. */
  primitive(spec: PrimitiveSpec, placement?: Placement): SolidRef;
  /** Novo shape com o posicionamento aplicado (rotação X→Y→Z, depois translação). */
  place(ref: SolidRef, placement: Placement): SolidRef;
  /** Cópia independente. */
  copy(ref: SolidRef): SolidRef;

  fuse(a: SolidRef, b: SolidRef): SolidRef;
  cut(a: SolidRef, b: SolidRef): SolidRef;
  common(a: SolidRef, b: SolidRef): SolidRef;

  kind(ref: SolidRef): ShapeKind;
  isValid(ref: SolidRef): boolean;
  /** Volume, área, centro de massa e caixa a partir da geometria exata. */
  props(ref: SolidRef): MassProps;
  /** Contagem topológica (faces, arestas, vértices, sólidos). */
  topology(ref: SolidRef): { solids: number; faces: number; edges: number; vertices: number };

  /** Malha para visualização, com faixas por face B-Rep (para seleção de face). */
  mesh(ref: SolidRef, quality?: TessellationQuality): MeshBuffers;
  /** Arestas amostradas, com faixas por aresta B-Rep (para contorno e seleção de aresta). */
  edges(ref: SolidRef, quality?: TessellationQuality): EdgeBuffers;

  /** STEP AP214 (texto). */
  toStep(ref: SolidRef): string;
  fromStep(data: string | Uint8Array): SolidRef;
  /** BREP binário do OCCT (persistência exata de corpos importados). */
  toBrep(ref: SolidRef): Uint8Array;
  fromBrep(data: Uint8Array): SolidRef;

  release(ref: SolidRef): void;
  /** Libera tudo e o próprio kernel. */
  dispose(): void;
}
