import type { Mat, V2, V3 } from "./math";
import type { ValueSource } from "../materials";
import type { IssueLevel } from "../engine";

/**
 * MODELO DA PEÇA DE CHAPA 3D (grafo paramétrico) — fonte única do sólido dobrado e da planificação.
 *
 * Aba (SheetFlange) = polígono plano no seu sistema LOCAL (x, y, z): o contorno é a LINHA DE MOLDE (projeção,
 *   ao longo de z, do vértice virtual de cada aresta dobrada); material de z = 0 (face A) a z = T (face B).
 * Dobra (SheetBend) = liga a aba-pai à aba-filha por uma aresta reta do contorno da pai.
 *
 * CONVENÇÃO ANGULAR (a mesma de `bend.ts`, auditada na FASE 4):
 *   deflectionDeg = θ = ÂNGULO DE DOBRA (deflexão; 0 = plano; "L" reto = 90°) — o ÚNICO valor guardado.
 *   includedDeg   = α = ÂNGULO INTERNO = 180° − θ — só derivado, para exibir.
 *   Nenhum campo se chama apenas "angle".
 *
 * SENTIDO: `side` = "cima" dobra para o +z LOCAL da aba-pai (a face B, z = T, fica por dentro da dobra);
 *   "baixo" dobra para −z (a face A fica por dentro). Numa cadeia (flange de contorno), "cima" repetido dobra
 *   sempre no mesmo sentido de giro.
 *
 * REFERÊNCIA DE MEDIDA (`ref`), por dobra: "externa" = vértice virtual da face de FORA da dobra; "interna" =
 *   da face de DENTRO. Vale para a posição da aresta da pai e para o início da aba-filha (como `solveProfile`,
 *   cota por face em cada ponta). Recuo SB = (R+T)·tan(θ/2) (externa) ou R·tan(θ/2) (interna).
 *
 * IDS SEMÂNTICOS (estáveis; nunca índice do OCCT):
 *   aba-base = id da operação; arestas da base = id da linha do esboço ("L3"; "L3.1", "L3.2" se a linha
 *   formar mais de um trecho do contorno);
 *   aba lateral = `«operação»@«abaPai»/«aresta»`; arestas: "raiz", "lado0", "ponta", "lado1";
 *   flange de contorno = `«operação»#1`, `#2`… (cada segmento é uma aba; a seguinte nasce na "ponta");
 *   dobra por linha = parte móvel `«operação»~«abaDividida»`, arestas originais + "raiz"; a parte fixa ganha
 *   a aresta `dobra:«operação»`.
 *   A dobra tem o MESMO id da aba-filha.
 */
export type SheetRef = "externa" | "interna";
export type BendSide = "cima" | "baixo";

export interface SheetDefaults {
  readonly T: number;
  readonly R: number;
  readonly K: number;
  readonly kSource: ValueSource;
  readonly ref: SheetRef;
}

/** Trecho de laço fechado (furo/recorte) no sistema local da aba. */
export type LoopSeg =
  | { readonly t: "line"; readonly a: V2; readonly b: V2 }
  /** arco de a até b com centro c; sweep com sinal (+ = anti-horário) */
  | { readonly t: "arc"; readonly c: V2; readonly r: number; readonly a: V2; readonly b: V2; readonly sweep: number }
  | { readonly t: "circle"; readonly c: V2; readonly r: number };
export interface Loop2 {
  readonly segs: readonly LoopSeg[];
  /** chave estável do laço (entidades do esboço que o formam, ETAPA 2.0); sem chave = posição */
  readonly key?: string;
}

export interface OutlineEdge {
  readonly key: string;
  readonly a: V2;
  readonly b: V2;
  /** região plana: trecho da linha de tangência desta dobra (faixa parcial da ETAPA 2) */
  readonly bend?: string;
}

export interface EdgeRef {
  readonly flange: string;
  readonly edge: string;
  /** chave usada no id da aba-filha (a original, quando a aresta foi recuperada por geometria) */
  readonly idKey?: string;
}

export interface SheetBendParams {
  readonly deflectionDeg: number;
  /** vazio = padrão da peça */
  readonly R?: number;
  readonly K?: number;
  readonly kSource?: ValueSource;
}

/** Base de chapa: contorno fechado (só trechos retos, anti-horário) + furos, no plano do esboço. */
export interface SheetBaseSpec {
  readonly id: string;
  readonly label: string;
  readonly defaults: SheetDefaults;
  /** sistema do esboço: origem e eixos (o contorno está em x, y deste sistema) */
  readonly plane: { readonly o: V3; readonly x: V3; readonly y: V3; readonly n: V3 };
  /** material para +n ("cima") ou −n ("baixo") do plano do esboço */
  readonly side: BendSide;
  readonly outline: readonly OutlineEdge[];
  readonly holes: readonly Loop2[];
}

export type SheetOp =
  /** Aba lateral: uma aba por aresta inteira (canto aberto automático com as vizinhas). */
  | {
      readonly t: "aba";
      readonly id: string;
      readonly label: string;
      readonly edges: readonly EdgeRef[];
      /** comprimento da aba até o vértice virtual (na referência `ref`) */
      readonly length: number;
      /**
       * Recuos (ETAPA 2.1a), mm, medidos na aresta de molde da pai a partir do início (a) e do fim (b): a faixa de
       * dobra vai de `offsetStart` a L − `offsetEnd`. Ausentes/zero = aresta inteira (canto a canto, ETAPA 1).
       */
      readonly offsetStart?: number;
      readonly offsetEnd?: number;
      readonly bend: SheetBendParams;
      readonly side: BendSide;
      readonly ref: SheetRef;
    }
  /** Flange de contorno (ETAPA 1): perfil aberto de seção constante ao longo de UMA aresta reta. */
  | {
      readonly t: "contorno";
      readonly id: string;
      readonly label: string;
      readonly edge: EdgeRef;
      /** cada segmento: dobra antes dele (em relação ao segmento anterior/aba-pai) + comprimento */
      readonly segments: readonly { readonly id?: string; readonly length: number; readonly bend: SheetBendParams; readonly side: BendSide }[];
      readonly ref: SheetRef;
    }
  /** Dobra por linha: divide uma aba plana pela linha de dobra (centro da região, na planificação). */
  | {
      readonly t: "linha";
      readonly id: string;
      readonly label: string;
      readonly flange: string;
      /** linha no sistema local da aba (x, y) */
      readonly a: V2;
      readonly b: V2;
      /** lado que fica fixo, olhando de a para b */
      readonly fixed: "esq" | "dir";
      readonly bend: SheetBendParams;
      readonly side: BendSide;
      readonly ref: SheetRef;
    }
  /** Recorte / furo passante numa aba plana (laços no sistema local da aba). */
  | { readonly t: "recorte"; readonly id: string; readonly label: string; readonly flange: string; readonly loops: readonly Loop2[] };

export interface SheetSpec {
  readonly base: SheetBaseSpec;
  readonly ops: readonly SheetOp[];
}

export interface SheetIssue {
  readonly level: IssueLevel;
  readonly code: string;
  readonly message: string;
  /** operação, abas e dobras envolvidas */
  readonly op?: string;
  readonly flanges?: readonly string[];
  readonly bends?: readonly string[];
}

/* ----------------------------------------------------------------------------------------- resultado */

export interface SolvedHole {
  readonly key: string;
  readonly op: string;
  readonly loop: Loop2;
}

export interface SolvedFlange {
  readonly id: string;
  readonly label: string;
  readonly op: string;
  /** contorno de molde (local) */
  readonly outline: readonly OutlineEdge[];
  /** região plana real (local, anti-horária): molde recuado de SB em cada aresta dobrada; key = aresta de origem */
  readonly flat: readonly OutlineEdge[];
  readonly holes: readonly SolvedHole[];
  /** local → mundo (peça dobrada) */
  readonly G: Mat;
  /** local → plano da planificação (sistema local da base; z = 0 nas duas faces planificadas) */
  readonly H: Mat;
  /** dobra que liga à pai (null = base) */
  readonly parentBend: string | null;
  /** área da região plana menos furos (mm²) */
  readonly area: number;
}

export interface SolvedBend {
  readonly id: string;
  readonly label: string;
  readonly op: string;
  readonly kind: "aba" | "contorno" | "linha";
  readonly parent: string;
  readonly edge: string;
  readonly child: string;
  readonly deflectionDeg: number;
  readonly includedDeg: number;
  readonly R: number;
  readonly K: number;
  readonly kSource: ValueSource;
  readonly side: BendSide;
  readonly ref: SheetRef;
  readonly T: number;
  /** fórmulas de bend.ts */
  readonly BA: number;
  readonly OSB: number;
  readonly ISB: number;
  readonly BD: number;
  /** recuo usado na referência desta dobra */
  readonly SB: number;
  /** trecho da aresta recuada da pai (linha de tangência), local da pai */
  readonly tangent: readonly [V2, V2];
  /** comprimento da dobra (ao longo da aresta) */
  readonly L: number;
  /** eixo da dobra (mundo): ponto e direção unitária; giro de +θ em torno de `dir` leva a pai à filha */
  readonly axis: { readonly p: V3; readonly dir: V3 };
  /** normal da face de dentro e de fora no início do arco (mundo) */
  /** planificação (sistema da base): início, linha (centro) e fim da região de dobra */
  readonly flatStart: readonly [V2, V2];
  readonly flatLine: readonly [V2, V2];
  readonly flatEnd: readonly [V2, V2];
}

export interface SheetSolved {
  readonly ok: boolean;
  readonly issues: readonly SheetIssue[];
  readonly T: number;
  readonly root: string;
  readonly flanges: readonly SolvedFlange[];
  readonly bends: readonly SolvedBend[];
  /** V = Σ A_i·T + Σ θ·T·(R + T/2)·L (mm³) */
  readonly volume: number;
  /** área da planificação = Σ A_i + Σ BA·L (mm²) */
  readonly flatArea: number;
}
