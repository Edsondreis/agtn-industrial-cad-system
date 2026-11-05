import type { Change, CadDocument, SelectionSet } from "@agtn/document";
import type { Entity, EntityGeom, PointRef, SnapCandidate, Vec2 } from "@agtn/geometry";
import { makeEntity } from "@agtn/geometry";

export interface PointEvent {
  /** ponto final (após snap, ortho, polar ou entrada numérica) */
  p: Vec2;
  /** posição bruta do cursor */
  raw: Vec2;
  snap: SnapCandidate | null;
  shift: boolean;
  /** veio da linha de comando */
  typed: boolean;
}

/** Serviços que o controlador CAD oferece às ferramentas. */
export interface ToolHost {
  readonly doc: CadDocument;
  readonly sel: SelectionSet;
  /** fator unidade do desenho → mm */
  readonly unitToMM: number;
  fmtLen(mm: number): string;
  fmtAng(rad: number): string;
  commit(label: string, changes: Change[]): void;
  message(text: string, level?: "info" | "warn" | "error" | "cmd"): void;
  refresh(): void;
  finish(): void;
  pick(p: Vec2, filter?: (e: Entity) => boolean): Entity | null;
  /** Nova entidade na camada atual, estilo POR CAMADA */
  create<G extends EntityGeom>(geom: G): Entity;
  pointRefFromSnap(snap: SnapCandidate | null, p: Vec2): PointRef | null;
  /** memória de valores entre execuções (ex.: distância de offset, raio de fillet) */
  memory: Map<string, number>;
  zoomExtents(): void;
  zoomWindow(a: Vec2, b: Vec2): void;
  zoomFactor(f: number): void;
}

export type PickMode = "point" | "entity" | "select";

/**
 * Ferramenta interativa (máquina de estados por etapas).
 * Toda alteração de geometria passa por `host.commit`, gerando uma transação desfazível.
 */
export abstract class Tool {
  abstract readonly id: string;
  abstract readonly title: string;
  /** ponto base para rubber band, ortho, polar e coordenadas relativas */
  base: Vec2 | null = null;
  /** força seleção por cruzamento (STRETCH) */
  forceCrossing = false;

  constructor(protected h: ToolHost) {}

  start(): void {}
  abstract prompt(): string;
  mode(): PickMode {
    return "point";
  }
  /** Quando true, o texto digitado inteiro é entregue a onText (ex.: conteúdo de TEXT). */
  wantsRawText(): boolean {
    return false;
  }
  onText(_raw: string): void {}
  onPoint(_ev: PointEvent): void {}
  onEntity(_e: Entity, _ev: PointEvent): void {}
  onNumber(_n: number): boolean {
    return false;
  }
  onWord(_w: string): boolean {
    return false;
  }
  onEnter(): void {
    this.h.finish();
  }
  onCancel(): void {
    this.h.finish();
  }
  /** Chamado ao fim de uma seleção por janela/clique enquanto mode() === "select" */
  onSelectionChanged(): void {}
  preview(_cursor: Vec2): Entity[] {
    return [];
  }
}

/** Ferramentas que operam sobre um conjunto de seleção (seleciona antes ou durante). */
export abstract class SelectionTool extends Tool {
  protected selecting = true;

  start(): void {
    if (this.h.sel.size > 0) {
      this.selecting = false;
      this.afterSelection();
    }
  }
  mode(): PickMode {
    return this.selecting ? "select" : this.stageMode();
  }
  protected stageMode(): PickMode {
    return "point";
  }
  protected selectPrompt(): string {
    return "Selecione objetos e pressione Enter";
  }
  prompt(): string {
    return this.selecting ? `${this.title}: ${this.selectPrompt()}` : `${this.title}: ${this.stagePrompt()}`;
  }
  protected abstract stagePrompt(): string;
  protected abstract afterSelection(): void;
  onEnter(): void {
    if (this.selecting) {
      if (!this.h.sel.size) {
        this.h.message("Nenhum objeto selecionado.", "warn");
        this.h.finish();
        return;
      }
      this.selecting = false;
      this.afterSelection();
      this.h.refresh();
      return;
    }
    this.stageEnter();
  }
  protected stageEnter(): void {
    this.h.finish();
  }
  protected selected(): Entity[] {
    return this.h.sel.entities().filter((e) => this.h.doc.isEditable(e));
  }
}

export const mk = makeEntity;
