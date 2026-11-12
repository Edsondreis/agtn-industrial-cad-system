/**
 * Esboço 2D paramétrico do AGTN 3D.
 *
 * - Coordenadas no plano do esboço, em mm. Ângulos de cota em graus.
 * - Pontos são as variáveis do solver; linhas/arcos/círculos referenciam pontos (topologia explícita:
 *   duas linhas que compartilham um ponto estão realmente conectadas).
 * - Pontos e eixos de referência embutidos (origem O, eixos AX/AY) são fixos e não podem ser apagados.
 * - Imutável: toda edição devolve um novo `Sketch` (Undo/Redo pelo documento).
 */
export type Id = string;

export interface SPoint {
  readonly id: Id;
  readonly x: number;
  readonly y: number;
}

export type SEntity =
  | { readonly id: Id; readonly t: "line"; readonly p1: Id; readonly p2: Id; readonly cons?: boolean }
  | { readonly id: Id; readonly t: "circle"; readonly c: Id; readonly r: number; readonly cons?: boolean }
  /** arco anti-horário de p1 até p2 em torno de c */
  | { readonly id: Id; readonly t: "arc"; readonly c: Id; readonly p1: Id; readonly p2: Id; readonly cons?: boolean }
  /** ponto isolado (centro de furo, referência) */
  | { readonly id: Id; readonly t: "point"; readonly p: Id; readonly cons?: boolean };

export type EntityKind = SEntity["t"];

/** Restrições geométricas e dimensionais. Dimensões guardam `v` (mm ou graus) e a posição do texto `at`. */
export type Constraint =
  | { readonly id: Id; readonly t: "coincident"; readonly a: Id; readonly b: Id }
  | { readonly id: Id; readonly t: "pointOnLine"; readonly p: Id; readonly l: Id }
  | { readonly id: Id; readonly t: "pointOnCircle"; readonly p: Id; readonly c: Id }
  | { readonly id: Id; readonly t: "midpoint"; readonly p: Id; readonly l: Id }
  | { readonly id: Id; readonly t: "horizontal"; readonly l: Id }
  | { readonly id: Id; readonly t: "vertical"; readonly l: Id }
  | { readonly id: Id; readonly t: "parallel"; readonly a: Id; readonly b: Id }
  | { readonly id: Id; readonly t: "perpendicular"; readonly a: Id; readonly b: Id }
  /** linha × círculo/arco ou círculo/arco × círculo/arco (`inner` = tangência interna) */
  | { readonly id: Id; readonly t: "tangent"; readonly a: Id; readonly b: Id; readonly inner?: boolean }
  | { readonly id: Id; readonly t: "concentric"; readonly a: Id; readonly b: Id }
  /** linhas: mesmo comprimento; círculos/arcos: mesmo raio */
  | { readonly id: Id; readonly t: "equal"; readonly a: Id; readonly b: Id }
  | { readonly id: Id; readonly t: "fixed"; readonly p: Id; readonly x: number; readonly y: number }
  | { readonly id: Id; readonly t: "distance"; readonly a: Id; readonly b: Id; readonly v: number; readonly at?: Pt }
  | { readonly id: Id; readonly t: "distanceX"; readonly a: Id; readonly b: Id; readonly v: number; readonly at?: Pt }
  | { readonly id: Id; readonly t: "distanceY"; readonly a: Id; readonly b: Id; readonly v: number; readonly at?: Pt }
  | { readonly id: Id; readonly t: "pointLineDistance"; readonly p: Id; readonly l: Id; readonly v: number; readonly at?: Pt }
  | { readonly id: Id; readonly t: "length"; readonly l: Id; readonly v: number; readonly at?: Pt }
  | { readonly id: Id; readonly t: "radius"; readonly c: Id; readonly v: number; readonly at?: Pt }
  | { readonly id: Id; readonly t: "diameter"; readonly c: Id; readonly v: number; readonly at?: Pt }
  /** ângulo entre duas linhas (0–180°) */
  | { readonly id: Id; readonly t: "angle"; readonly a: Id; readonly b: Id; readonly v: number; readonly at?: Pt };

export type ConstraintKind = Constraint["t"];
export type DimensionKind = Extract<Constraint, { v: number }>["t"];
export const DIMENSION_KINDS: readonly DimensionKind[] = ["distance", "distanceX", "distanceY", "pointLineDistance", "length", "radius", "diameter", "angle"];
export const isDimension = (c: Constraint): c is Extract<Constraint, { v: number }> => (DIMENSION_KINDS as readonly string[]).includes(c.t);

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export interface Sketch {
  readonly points: Readonly<Record<Id, SPoint>>;
  readonly entities: Readonly<Record<Id, SEntity>>;
  readonly constraints: readonly Constraint[];
  /** contador para ids legíveis (L1, C2, P7…) */
  readonly seq: number;
}

/** Pontos e eixos embutidos (fixos, fora das variáveis do solver). */
export const ORIGIN = "O";
export const AXIS_X = "AX";
export const AXIS_Y = "AY";
export const BUILTIN_POINTS: Readonly<Record<Id, SPoint>> = {
  O: { id: "O", x: 0, y: 0 },
  _X: { id: "_X", x: 1, y: 0 },
  _Y: { id: "_Y", x: 0, y: 1 },
};
export const BUILTIN_ENTITIES: Readonly<Record<Id, SEntity>> = {
  AX: { id: "AX", t: "line", p1: "O", p2: "_X", cons: true },
  AY: { id: "AY", t: "line", p1: "O", p2: "_Y", cons: true },
};
export const isBuiltin = (id: Id) => id in BUILTIN_POINTS || id in BUILTIN_ENTITIES;

export const emptySketch = (): Sketch => ({ points: {}, entities: {}, constraints: [], seq: 0 });

export const CONSTRAINT_LABEL: Record<ConstraintKind, string> = {
  coincident: "Coincidente",
  pointOnLine: "Ponto sobre linha",
  pointOnCircle: "Ponto sobre círculo",
  midpoint: "Ponto médio",
  horizontal: "Horizontal",
  vertical: "Vertical",
  parallel: "Paralelas",
  perpendicular: "Perpendiculares",
  tangent: "Tangente",
  concentric: "Concêntricos",
  equal: "Iguais",
  fixed: "Fixo",
  distance: "Distância",
  distanceX: "Distância horizontal",
  distanceY: "Distância vertical",
  pointLineDistance: "Distância ponto–linha",
  length: "Comprimento",
  radius: "Raio",
  diameter: "Diâmetro",
  angle: "Ângulo",
};

/** Ponto (embutido ou do esboço). */
export function pointOf(s: Sketch, id: Id): SPoint | undefined {
  return s.points[id] ?? BUILTIN_POINTS[id];
}
export function entityOf(s: Sketch, id: Id): SEntity | undefined {
  return s.entities[id] ?? BUILTIN_ENTITIES[id];
}

/** Pontos usados por uma entidade. */
export function entityPoints(e: SEntity): Id[] {
  switch (e.t) {
    case "line":
      return [e.p1, e.p2];
    case "circle":
      return [e.c];
    case "arc":
      return [e.c, e.p1, e.p2];
    case "point":
      return [e.p];
  }
}

/** Ids referenciados por uma restrição (pontos e entidades). */
export function constraintRefs(c: Constraint): Id[] {
  switch (c.t) {
    case "coincident":
    case "distance":
    case "distanceX":
    case "distanceY":
      return [c.a, c.b];
    case "pointOnLine":
    case "midpoint":
    case "pointLineDistance":
      return [c.p, c.l];
    case "pointOnCircle":
      return [c.p, c.c];
    case "horizontal":
    case "vertical":
    case "length":
      return [c.l];
    case "radius":
    case "diameter":
      return [c.c];
    case "fixed":
      return [c.p];
    default:
      return [c.a, c.b];
  }
}
