import type { Sketch } from "@agtn/sketch";
import type { PrimitiveSpec } from "./primitives";
import type { Placement, Vec3 } from "./types";

/**
 * Operações (features) de uma peça paramétrica. A peça é a lista ordenada; cada operação lê o sólido resultante
 * das anteriores. Tudo no sistema de coordenadas LOCAL da peça (o posicionamento do corpo é aplicado no fim).
 */
export type FeatId = string;
export type StdPlane = "XY" | "XZ" | "YZ";
export type BoolOp = "new" | "join" | "cut" | "intersect";

/**
 * Referência a uma face, estável sob edição de parâmetros:
 * - `anchor`: face gerada por uma operação conhecida (topo/fundo/lateral de extrusão gerada pela linha L3,
 *   face +Z de uma caixa…) — recalculada a partir dos parâmetros ATUAIS da operação de origem;
 * - `seed`: superfície capturada (plano/cilindro) + ponto — para faces de fillet, shell, STEP etc.
 * Se a referência não puder ser resolvida, a operação falha com erro explícito (nunca troca de face).
 */
export type FaceRef =
  | { readonly t: "anchor"; readonly feat: FeatId; readonly role: "start" | "end" | "side" | "prim" | "hole"; readonly key: string; readonly seed: Vec3 }
  | { readonly t: "seed"; readonly surf: string; readonly p: Vec3; readonly n?: Vec3; readonly axis?: Vec3; readonly r?: number };

/** Aresta = interseção de duas faces referenciadas (+ ponto para desempatar). */
export interface EdgeRef {
  readonly a: FaceRef;
  readonly b: FaceRef;
  readonly seed: Vec3;
}

export type PlaneRef = { readonly t: "std"; readonly plane: StdPlane; readonly offset: number } | { readonly t: "face"; readonly face: FaceRef; readonly offset: number };

export type AxisRef =
  | { readonly t: "axis"; readonly a: "X" | "Y" | "Z" }
  /** linha de um esboço (inclui os eixos AX/AY do esboço) */
  | { readonly t: "sketchLine"; readonly sketch: FeatId; readonly line: string }
  | { readonly t: "edge"; readonly edge: EdgeRef }
  /** eixo de face cilíndrica/cônica */
  | { readonly t: "face"; readonly face: FaceRef };

interface Base {
  readonly id: FeatId;
  readonly name: string;
  readonly suppressed?: boolean;
}

export type Feature = Base &
  (
    | { readonly t: "primitive"; readonly spec: PrimitiveSpec; readonly placement: Placement }
    | { readonly t: "sketch"; readonly plane: PlaneRef; readonly sketch: Sketch }
    | {
        readonly t: "extrude";
        readonly sketch: FeatId;
        /** índices de regiões do perfil; null = padrão (externas com seus furos) */
        readonly regions: readonly number[] | null;
        readonly depth: number;
        /** "one" = um sentido; "symmetric" = metade para cada lado; "two" = depth e depth2 */
        readonly mode: "one" | "symmetric" | "two";
        readonly depth2: number;
        readonly reverse: boolean;
        /** passante (corte através de tudo) */
        readonly through: boolean;
        readonly op: BoolOp;
      }
    | { readonly t: "revolve"; readonly sketch: FeatId; readonly regions: readonly number[] | null; readonly axis: string; readonly angle: number; readonly op: BoolOp }
    | { readonly t: "sweep"; readonly profile: FeatId; readonly path: FeatId; readonly op: BoolOp }
    | { readonly t: "loft"; readonly sections: readonly FeatId[]; readonly ruled: boolean; readonly op: BoolOp }
    | { readonly t: "fillet"; readonly edges: readonly EdgeRef[]; readonly r: number }
    | { readonly t: "chamfer"; readonly edges: readonly EdgeRef[]; readonly d: number }
    /** casca: remove as faces e deixa parede `thickness` para dentro */
    | { readonly t: "shell"; readonly faces: readonly FaceRef[]; readonly thickness: number }
    /** furos nos pontos/centros de círculo do esboço, furando contra a normal do plano do esboço */
    | {
        readonly t: "hole";
        readonly sketch: FeatId;
        readonly d: number;
        readonly depth: number;
        readonly through: boolean;
        readonly reverse: boolean;
        readonly cbore: { readonly d: number; readonly depth: number } | null;
        readonly csink: { readonly d: number; readonly angle: number } | null;
      }
    /** espelha as operações-alvo (ou o corpo inteiro, `targets` = null) */
    | { readonly t: "mirror"; readonly plane: PlaneRef; readonly targets: readonly FeatId[] | null }
    | {
        readonly t: "pattern";
        readonly kind: "linear" | "circular";
        readonly targets: readonly FeatId[];
        readonly dir: AxisRef;
        readonly count: number;
        /** linear: passo (mm) */
        readonly spacing: number;
        /** circular: ângulo total (°); 360 = volta completa */
        readonly angle: number;
        readonly reverse: boolean;
      }
    /** booleana com outros corpos do modelo (ids de nós) */
    | { readonly t: "combine"; readonly op: "join" | "cut" | "intersect"; readonly tools: readonly string[] }
  );

export type FeatureKind = Feature["t"];
type NoBase<F> = F extends Feature ? Omit<F, "id" | "name"> : never;
export type FeatureDraft = NoBase<Feature>;

export const FEATURE_LABEL: Record<FeatureKind, string> = {
  primitive: "Primitiva",
  sketch: "Esboço",
  extrude: "Extrusão",
  revolve: "Revolução",
  sweep: "Varredura",
  loft: "Loft",
  fillet: "Arredondamento",
  chamfer: "Chanfro",
  shell: "Casca",
  hole: "Furo",
  mirror: "Espelhamento",
  pattern: "Padrão",
  combine: "Combinar corpos",
};

/** Prefixos dos nomes automáticos (estilo da árvore: Sketch_Base, Extrude_1…). */
export const FEATURE_PREFIX: Record<FeatureKind, string> = {
  primitive: "Base",
  sketch: "Esboço",
  extrude: "Extrusão",
  revolve: "Revolução",
  sweep: "Varredura",
  loft: "Loft",
  fillet: "Arredondar",
  chamfer: "Chanfro",
  shell: "Casca",
  hole: "Furo",
  mirror: "Espelho",
  pattern: "Padrão",
  combine: "Combinar",
};

export const opLabel = (op: BoolOp) => ({ new: "Novo sólido", join: "Unir", cut: "Cortar", intersect: "Interseção" })[op];

/** Validação dos parâmetros numéricos (antes de chamar o kernel). Mensagens para o usuário. */
export function validateFeature(f: FeatureDraft): string[] {
  const e: string[] = [];
  const pos = (v: number, name: string) => {
    if (!Number.isFinite(v) || v <= 0) e.push(`${name} deve ser maior que zero.`);
  };
  switch (f.t) {
    case "extrude":
      if (!f.through) pos(f.depth, "Profundidade");
      if (f.mode === "two" && !f.through) pos(f.depth2, "Profundidade do 2º sentido");
      if (f.through && f.op !== "cut") e.push("Passante só se aplica a corte.");
      break;
    case "revolve":
      if (!(f.angle > 0 && f.angle <= 360)) e.push("O ângulo de revolução deve estar entre 0 e 360°.");
      break;
    case "fillet":
      pos(f.r, "Raio");
      if (!f.edges.length) e.push("Escolha pelo menos uma aresta.");
      break;
    case "chamfer":
      pos(f.d, "Distância do chanfro");
      if (!f.edges.length) e.push("Escolha pelo menos uma aresta.");
      break;
    case "shell":
      pos(f.thickness, "Espessura da parede");
      break;
    case "hole":
      pos(f.d, "Diâmetro");
      if (!f.through) pos(f.depth, "Profundidade");
      if (f.cbore) {
        pos(f.cbore.depth, "Profundidade do rebaixo");
        if (!(f.cbore.d > f.d)) e.push("O rebaixo deve ser maior que o furo.");
      }
      if (f.csink) {
        if (!(f.csink.d > f.d)) e.push("O escareado deve ser maior que o furo.");
        if (!(f.csink.angle > 0 && f.csink.angle < 180)) e.push("Ângulo do escareado entre 0 e 180°.");
      }
      break;
    case "pattern":
      if (!Number.isInteger(f.count) || f.count < 2 || f.count > 500) e.push("Quantidade entre 2 e 500.");
      if (f.kind === "linear") pos(f.spacing, "Espaçamento");
      else if (!(f.angle > 0 && f.angle <= 360)) e.push("Ângulo total entre 0 e 360°.");
      if (!f.targets.length) e.push("Escolha as operações a repetir.");
      break;
    case "loft":
      if (f.sections.length < 2) e.push("O loft precisa de pelo menos 2 esboços.");
      break;
    case "combine":
      if (!f.tools.length) e.push("Escolha os corpos-ferramenta.");
      break;
  }
  return e;
}

/** Ids de operações que esta operação usa (esboços, alvos, faces/arestas de origem). */
export function featureRefs(f: Feature): FeatId[] {
  const out = new Set<FeatId>();
  const face = (r: FaceRef) => r.t === "anchor" && out.add(r.feat);
  const edge = (e: EdgeRef) => {
    face(e.a);
    face(e.b);
  };
  const plane = (p: PlaneRef) => p.t === "face" && face(p.face);
  const axis = (a: AxisRef) => (a.t === "sketchLine" ? out.add(a.sketch) : a.t === "edge" ? edge(a.edge) : a.t === "face" ? face(a.face) : undefined);
  switch (f.t) {
    case "sketch":
      plane(f.plane);
      break;
    case "extrude":
    case "revolve":
    case "hole":
      out.add(f.sketch);
      break;
    case "sweep":
      out.add(f.profile);
      out.add(f.path);
      break;
    case "loft":
      f.sections.forEach((s) => out.add(s));
      break;
    case "fillet":
    case "chamfer":
      f.edges.forEach(edge);
      break;
    case "shell":
      f.faces.forEach(face);
      break;
    case "mirror":
      plane(f.plane);
      f.targets?.forEach((t) => out.add(t));
      break;
    case "pattern":
      f.targets.forEach((t) => out.add(t));
      axis(f.dir);
      break;
  }
  return [...out];
}
