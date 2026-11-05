import type { Entity, EntityId, EntityType } from "@agtn/geometry";
import type { CadDocument } from "./document";

/** Conjunto de seleção, independente da interface. */
export class SelectionSet {
  private ids = new Set<EntityId>();
  private listeners = new Set<() => void>();

  constructor(private readonly doc: CadDocument) {
    doc.subscribe(() => this.prune());
  }

  get size(): number {
    return this.ids.size;
  }
  has(id: EntityId): boolean {
    return this.ids.has(id);
  }
  list(): EntityId[] {
    return [...this.ids];
  }
  entities(): Entity[] {
    return this.list()
      .map((id) => this.doc.get(id))
      .filter((e): e is Entity => !!e);
  }

  set(ids: Iterable<EntityId>): void {
    this.ids = new Set(ids);
    this.emit();
  }
  add(ids: Iterable<EntityId>): void {
    for (const id of ids) this.ids.add(id);
    this.emit();
  }
  remove(ids: Iterable<EntityId>): void {
    for (const id of ids) this.ids.delete(id);
    this.emit();
  }
  toggle(id: EntityId): void {
    if (this.ids.has(id)) this.ids.delete(id);
    else this.ids.add(id);
    this.emit();
  }
  clear(): void {
    if (!this.ids.size) return;
    this.ids.clear();
    this.emit();
  }

  /** Seleciona todos os objetos editáveis de determinados tipos. */
  selectByType(types: EntityType[], additive = false): void {
    const ids = this.doc
      .all()
      .filter((e) => types.includes(e.type) && this.doc.isEditable(e))
      .map((e) => e.id);
    if (additive) this.add(ids);
    else this.set(ids);
  }

  selectAll(): void {
    this.set(
      this.doc
        .all()
        .filter((e) => this.doc.isEditable(e))
        .map((e) => e.id),
    );
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private prune() {
    let changed = false;
    for (const id of this.ids) {
      const e = this.doc.get(id);
      if (!e || !this.doc.isEditable(e)) {
        this.ids.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }
  private emit() {
    for (const l of this.listeners) l();
  }
}
