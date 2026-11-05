import type { Vec2 } from "./vec";

/**
 * Modelo de entidades 2D do AGTN CAD.
 *
 * - Coordenadas em milímetros (float64).
 * - Ângulos em radianos, CCW.
 * - `color`: índice ACI 1..255; `null` = POR CAMADA (BYLAYER).
 * - `lineweight`: mm; `null` = POR CAMADA.
 * - `linetype`: nome do tipo de linha; `null` = POR CAMADA.
 *
 * As entidades são imutáveis: toda edição gera um novo objeto com o mesmo `id`,
 * o que permite Undo/Redo por troca de estados (before/after).
 */
export type EntityId = string;

export interface EntityBase {
  readonly id: EntityId;
  readonly layer: string;
  readonly color: number | null;
  readonly lineweight: number | null;
  readonly linetype: string | null;
}

export interface LineEntity extends EntityBase {
  readonly type: "line";
  readonly a: Vec2;
  readonly b: Vec2;
}

export interface CircleEntity extends EntityBase {
  readonly type: "circle";
  readonly c: Vec2;
  readonly r: number;
}

/** Arco CCW de a0 até a1. */
export interface ArcEntity extends EntityBase {
  readonly type: "arc";
  readonly c: Vec2;
  readonly r: number;
  readonly a0: number;
  readonly a1: number;
}

/**
 * Polilinha 2D com bulges (compatível com LWPOLYLINE do DXF).
 * bulges[i] define o segmento pts[i] → pts[i+1] (ou → pts[0] no fechamento).
 * bulge = tan(θ/4), θ = ângulo incluído com sinal (positivo = CCW).
 */
export interface PolylineEntity extends EntityBase {
  readonly type: "polyline";
  readonly pts: readonly Vec2[];
  readonly bulges: readonly number[];
  readonly closed: boolean;
}

export interface PointEntity extends EntityBase {
  readonly type: "point";
  readonly p: Vec2;
}

export interface TextEntity extends EntityBase {
  readonly type: "text";
  readonly p: Vec2;
  readonly h: number;
  readonly rot: number;
  readonly value: string;
  /** Alinhamento horizontal: 0 esquerda, 1 centro, 2 direita */
  readonly halign: 0 | 1 | 2;
}

/** Referência associativa a um ponto característico de outra entidade. */
export interface PointRef {
  readonly id: EntityId;
  /** "a" | "b" (linha), "c" (centro), "s"/"e" (início/fim de arco), "v:<i>" (vértice de polilinha) */
  readonly key: string;
}

export type DimensionKind = "aligned" | "linear" | "radius" | "diameter" | "angular";

export interface DimensionEntity extends EntityBase {
  readonly type: "dimension";
  readonly kind: DimensionKind;
  /** aligned/linear: pontos de origem das linhas auxiliares. radius/diameter: p1 = centro, p2 = ponto no círculo.
   *  angular: p1 = vértice, p2/p3 = pontos nos dois lados. */
  readonly p1: Vec2;
  readonly p2: Vec2;
  readonly p3?: Vec2;
  /** Ponto que define a posição da linha de cota (ou do texto em radius/diameter). */
  readonly loc: Vec2;
  /** linear: ângulo de rotação da cota (0 = horizontal, π/2 = vertical). */
  readonly rot: number;
  /** Texto fixo (substitui o valor medido). `null` = valor medido. */
  readonly textOverride: string | null;
  /** Escala da cota (multiplica altura do texto, setas e afastamentos do estilo). Ausente = 1. */
  readonly dimScale?: number;
  readonly assoc: { readonly p1?: PointRef; readonly p2?: PointRef; readonly p3?: PointRef; readonly circle?: EntityId } | null;
}

export type Entity =
  | LineEntity
  | CircleEntity
  | ArcEntity
  | PolylineEntity
  | PointEntity
  | TextEntity
  | DimensionEntity;

export type EntityType = Entity["type"];

export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  line: "Linha",
  circle: "Círculo",
  arc: "Arco",
  polyline: "Polilinha",
  point: "Ponto",
  text: "Texto",
  dimension: "Cota",
};

/** Props de estilo padrão (tudo POR CAMADA). */
export const BYLAYER = { color: null, lineweight: null, linetype: null } as const;

let idCounter = 0;
const idPrefix = Math.floor(Math.random() * 0xffffff).toString(36);
/** Gera ids únicos por sessão; ids carregados de arquivo são preservados. */
export function newId(): EntityId {
  idCounter += 1;
  return `${idPrefix}-${idCounter.toString(36)}`;
}

type Distribute<T> = T extends Entity ? Omit<T, "id" | "layer" | "color" | "lineweight" | "linetype"> : never;
export type EntityGeom = Distribute<Entity>;

export function makeEntity<G extends EntityGeom>(
  geom: G,
  layer: string,
  style: Partial<Pick<EntityBase, "color" | "lineweight" | "linetype">> = {},
  id: EntityId = newId(),
): Extract<Entity, { type: G["type"] }> {
  return {
    ...geom,
    id,
    layer,
    color: style.color ?? null,
    lineweight: style.lineweight ?? null,
    linetype: style.linetype ?? null,
  } as unknown as Extract<Entity, { type: G["type"] }>;
}
