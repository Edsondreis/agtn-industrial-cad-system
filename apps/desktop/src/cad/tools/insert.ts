import type { Change } from "@agtn/document";
import { type Entity, type Vec2, newId, transformEntity, translation } from "@agtn/geometry";
import { Tool, type ToolHost } from "./base";

/** Inserção de geometria gerada (ex.: planificação) acompanhando o cursor até o clique. */
export class InsertTool extends Tool {
  readonly id = "INSERT";
  readonly title = "INSERIR";
  constructor(
    h: ToolHost,
    private readonly ents: Entity[],
    private readonly layerChanges: () => Change[],
    private readonly label: string,
    private readonly ref: Vec2,
  ) {
    super(h);
  }
  prompt(): string {
    return `INSERIR ${this.label.toUpperCase()}: Ponto de inserção (canto inferior esquerdo) — Esc cancela`;
  }
  private placed(p: Vec2): Entity[] {
    const m = translation(p.x - this.ref.x, p.y - this.ref.y);
    return this.ents.map((e) => transformEntity(e, m));
  }
  onPoint(ev: { p: Vec2 }): void {
    const list = this.placed(ev.p).map((e) => ({ ...e, id: newId() }) as Entity);
    this.h.commit(`Inserir ${this.label}`, [...this.layerChanges(), ...this.h.doc.addChanges(list)]);
    this.h.sel.set(list.map((e) => e.id));
    this.h.message(`${this.label} inserida com ${list.length} objeto(s).`);
    this.h.finish();
  }
  preview(c: Vec2): Entity[] {
    return this.placed(c);
  }
}
