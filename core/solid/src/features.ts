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
    /* ------------------------------------------------------------------ chapa (FASE 4 · ETAPA 1) */
    /** base de chapa: contorno fechado do esboço (só retas) + furos; padrões da peça */
    | {
        readonly t: "sheetBase";
        readonly sketch: FeatId;
        readonly T: number;
        /** raio interno padrão */
        readonly R: number;
        /** fator K padrão; null = tabela material × processo × T × R/T */
        readonly K: number | null;
        readonly material: string;
        readonly process: string;
        readonly ref: SheetRef;
        /** material para o lado da normal do esboço ("cima") ou o contrário */
        readonly side: SheetSide;
      }
    /** aba lateral: uma aba por aresta inteira (canto aberto automático) */
    | {
        readonly t: "sheetFlange";
        readonly edges: readonly SheetEdgeRef[];
        readonly length: number;
        /** θ = ângulo de dobra (deflexão); α = 180° − θ só na interface */
        readonly deflectionDeg: number;
        readonly R: number | null;
        readonly K: number | null;
        readonly side: SheetSide;
        readonly ref: SheetRef;
      }
    /** flange de contorno: perfil aberto de seção constante (tabela de segmentos) ao longo de UMA aresta reta */
    | {
        readonly t: "sheetContour";
        readonly edge: SheetEdgeRef;
        readonly segments: readonly { readonly length: number; readonly deflectionDeg: number; readonly side: SheetSide; readonly R: number | null; readonly K: number | null }[];
        readonly ref: SheetRef;
      }
    /** dobra por linha do esboço (linha = centro da região de dobra na planificação) */
    | {
        readonly t: "sheetBendLine";
        readonly sketch: FeatId;
        readonly line: string;
        readonly flange: string;
        readonly deflectionDeg: number;
        readonly R: number | null;
        readonly K: number | null;
        /** "cima" = para o lado da normal do esboço */
        readonly side: SheetSide;
        readonly ref: SheetRef;
        /** lado que fica fixo, olhando a linha de p1 para p2 com a normal do esboço para quem olha */
        readonly fixed: "esq" | "dir";
      }
    /** recorte/furo passante numa aba plana (contornos fechados do esboço sobre a face da aba) */
    | { readonly t: "sheetCut"; readonly sketch: FeatId; readonly flange: string }
  );

export type SheetRef = "externa" | "interna";
export type SheetSide = "cima" | "baixo";
/** Aresta de chapa por id semântico (aba + chave da aresta), nunca índice do OCCT. */
export interface SheetEdgeRef {
  readonly flange: string;
  readonly edge: string;
  /**
   * Posição da aresta (linha de molde, mundo) quando foi escolhida. Só usada se o id sumir (linha apagada e
   * redesenhada): aceita UMA aresta da mesma aba exatamente na mesma reta, com aviso; duas → ambígua.
   */
  readonly hint?: { readonly a: Vec3; readonly b: Vec3 };
}
export const SHEET_KINDS = ["sheetBase", "sheetFlange", "sheetContour", "sheetBendLine", "sheetCut"] as const;
export type SheetFeature = Extract<Feature, { t: (typeof SHEET_KINDS)[number] }>;
export const isSheetFeature = (f: { t: string }): f is SheetFeature => (SHEET_KINDS as readonly string[]).includes(f.t);
/** Operação que criou a aba (o id da aba começa pelo id da operação: base, «op»@…, «op»#n, «op»~…). */
export const sheetFlangeOwner = (flange: string): FeatId => flange.split(/[@#~]/)[0];

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
  sheetBase: "Base de chapa",
  sheetFlange: "Aba lateral",
  sheetContour: "Flange de contorno",
  sheetBendLine: "Dobra",
  sheetCut: "Recorte de chapa",
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
  sheetBase: "Chapa",
  sheetFlange: "Aba",
  sheetContour: "Flange",
  sheetBendLine: "Dobra",
  sheetCut: "Recorte",
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
    case "sheetBase":
      pos(f.T, "Espessura");
      if (!(f.R >= 0)) e.push("Raio interno deve ser ≥ 0.");
      kOk(f.K);
      break;
    case "sheetFlange":
      pos(f.length, "Comprimento da aba");
      bendOk(f.deflectionDeg, f.R, f.K);
      if (!f.edges.length) e.push("Escolha pelo menos uma aresta.");
      break;
    case "sheetContour":
      if (!f.segments.length) e.push("O perfil precisa de pelo menos um segmento.");
      f.segments.forEach((sg, i) => {
        if (!(sg.length > 0)) e.push(`Segmento ${i + 1}: comprimento deve ser maior que zero.`);
        bendOk(sg.deflectionDeg, sg.R, sg.K);
      });
      break;
    case "sheetBendLine":
      bendOk(f.deflectionDeg, f.R, f.K);
      break;
  }
  return e;
  function kOk(K: number | null) {
    if (K !== null && !(K >= 0 && K <= 1)) e.push("Fator K deve estar entre 0 e 1.");
  }
  function bendOk(th: number, R: number | null, K: number | null) {
    if (!(th > 0 && th < 180)) e.push("Ângulo de dobra (deflexão θ) deve estar entre 0° e 180° (exclusivo).");
    if (R !== null && !(R >= 0)) e.push("Raio interno deve ser ≥ 0.");
    kOk(K);
  }
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
    case "sheetBase":
      out.add(f.sketch);
      break;
    case "sheetFlange":
      f.edges.forEach((e) => out.add(sheetFlangeOwner(e.flange)));
      break;
    case "sheetContour":
      out.add(sheetFlangeOwner(f.edge.flange));
      break;
    case "sheetBendLine":
      out.add(f.sketch);
      out.add(sheetFlangeOwner(f.flange));
      break;
    case "sheetCut":
      out.add(f.sketch);
      out.add(sheetFlangeOwner(f.flange));
      break;
  }
  return [...out];
}
