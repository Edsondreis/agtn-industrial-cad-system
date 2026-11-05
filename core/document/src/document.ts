import RBush from "rbush";
import {
  type BBox,
  type DimStyle,
  type DimensionEntity,
  type Entity,
  type EntityId,
  type LengthUnit,
  type PointRef,
  type Vec2,
  DEFAULT_DIMSTYLE,
  add,
  angleOf,
  boxContainsBox,
  boxContainsPoint,
  boxOverlaps,
  ccwSweep,
  dist,
  distToEntity,
  entityBox,
  entitySegs,
  fromAngle,
  lineSeg,
  segSeg,
  segStart,
  sub,
} from "@agtn/geometry";
import { DEFAULT_LAYER, type Layer } from "./layers";

export interface DocSettings {
  units: LengthUnit;
  gridSpacing: number;
  snapSpacing: number;
  dimStyle: DimStyle;
  /** Escala global de tipos de linha */
  ltScale: number;
  textHeight: number;
}

export const DEFAULT_SETTINGS: DocSettings = {
  units: "mm",
  gridSpacing: 10,
  snapSpacing: 5,
  dimStyle: DEFAULT_DIMSTYLE,
  ltScale: 1,
  textHeight: 2.5,
};

/** Alterações atômicas reversíveis. */
export type Change =
  | { kind: "add"; e: Entity }
  | { kind: "remove"; e: Entity }
  | { kind: "update"; before: Entity; after: Entity }
  | { kind: "layer-add"; layer: Layer; index: number }
  | { kind: "layer-remove"; layer: Layer; index: number }
  | { kind: "layer-update"; before: Layer; after: Layer }
  | { kind: "current-layer"; before: string; after: string }
  | { kind: "settings"; before: DocSettings; after: DocSettings }
  | { kind: "extra"; key: string; before: unknown; after: unknown };

export interface Transaction {
  readonly label: string;
  readonly changes: readonly Change[];
}

interface IndexItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: EntityId;
}

export type DocEvent = { type: "change"; tx: Transaction | null; source: "commit" | "undo" | "redo" | "load" };

/**
 * Documento CAD: entidades, camadas, configurações, dados de módulos (extras),
 * índice espacial (R-tree) e pilhas de Undo/Redo baseadas em transações.
 */
export class CadDocument {
  private readonly ents = new Map<EntityId, Entity>();
  /** Ordem de desenho: número de sequência por id (mantido após exclusão para que o Undo restaure a posição). */
  private readonly seq = new Map<EntityId, number>();
  private seqCounter = 0;
  private orderCache: Entity[] | null = null;
  private readonly index = new RBush<IndexItem>(16);
  private readonly indexItems = new Map<EntityId, IndexItem>();
  private readonly dims = new Set<EntityId>();
  private _layers: Layer[] = [DEFAULT_LAYER];
  private _current = "0";
  private _settings: DocSettings = structuredClone(DEFAULT_SETTINGS);
  private _extras: Record<string, unknown> = {};
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  private _revision = 0;
  private savedRevision = 0;
  private listeners = new Set<(ev: DocEvent) => void>();
  readonly maxUndo: number;

  constructor(opts: { maxUndo?: number } = {}) {
    this.maxUndo = opts.maxUndo ?? 500;
  }

  /* ----------------------------- leitura ----------------------------- */
  get revision(): number {
    return this._revision;
  }
  get dirty(): boolean {
    return this._revision !== this.savedRevision;
  }
  markSaved(): void {
    this.savedRevision = this._revision;
    this.emit({ type: "change", tx: null, source: "load" });
  }
  get layers(): readonly Layer[] {
    return this._layers;
  }
  get currentLayer(): string {
    return this._current;
  }
  get settings(): DocSettings {
    return this._settings;
  }
  get extras(): Readonly<Record<string, unknown>> {
    return this._extras;
  }
  get size(): number {
    return this.ents.size;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  get(id: EntityId): Entity | undefined {
    return this.ents.get(id);
  }
  has(id: EntityId): boolean {
    return this.ents.has(id);
  }
  layer(name: string): Layer | undefined {
    return this._layers.find((l) => l.name === name);
  }

  /** Entidades em ordem de criação (ordem de desenho). */
  all(): Entity[] {
    if (!this.orderCache) {
      const list = [...this.ents.values()];
      list.sort((a, b) => (this.seq.get(a.id) ?? 0) - (this.seq.get(b.id) ?? 0));
      this.orderCache = list;
    }
    return this.orderCache.slice();
  }

  isEditable(e: Entity): boolean {
    const l = this.layer(e.layer);
    return !!l && l.visible && !l.locked;
  }
  isVisible(e: Entity): boolean {
    const l = this.layer(e.layer);
    return !l || l.visible;
  }

  /** Extensão total do desenho (camadas visíveis). */
  extents(): BBox | null {
    if (!this.ents.size) return null;
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const it of this.indexItems.values()) {
      const e = this.ents.get(it.id)!;
      if (!this.isVisible(e)) continue;
      b.minX = Math.min(b.minX, it.minX);
      b.minY = Math.min(b.minY, it.minY);
      b.maxX = Math.max(b.maxX, it.maxX);
      b.maxY = Math.max(b.maxY, it.maxY);
    }
    return Number.isFinite(b.minX) ? b : null;
  }

  /** Consulta espacial (caixa). */
  query(box: BBox, opts: { visibleOnly?: boolean; editableOnly?: boolean } = {}): Entity[] {
    const out: Entity[] = [];
    for (const it of this.index.search(box)) {
      const e = this.ents.get(it.id);
      if (!e) continue;
      if (opts.editableOnly && !this.isEditable(e)) continue;
      if ((opts.visibleOnly ?? true) && !this.isVisible(e)) continue;
      out.push(e);
    }
    return out;
  }

  /** Entidade mais próxima do ponto dentro da tolerância (mm). */
  hitTest(p: Vec2, tol: number, filter?: (e: Entity) => boolean): Entity | null {
    const cands = this.query({ minX: p.x - tol, minY: p.y - tol, maxX: p.x + tol, maxY: p.y + tol }, { editableOnly: true });
    let best: Entity | null = null;
    let bd = Infinity;
    for (const e of cands) {
      if (filter && !filter(e)) continue;
      const d = distToEntity(p, e);
      if (d <= tol && d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /**
   * Seleção por janela (crossing = false: objeto totalmente contido)
   * ou por cruzamento (crossing = true: objeto contido ou que cruza a borda).
   */
  selectBox(box: BBox, crossing: boolean): Entity[] {
    const cands = this.query(box, { editableOnly: true });
    if (!crossing) return cands.filter((e) => boxContainsBox(box, entityBox(e)));
    const edges = [
      lineSeg({ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }),
      lineSeg({ x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }),
      lineSeg({ x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }),
      lineSeg({ x: box.minX, y: box.maxY }, { x: box.minX, y: box.minY }),
    ];
    return cands.filter((e) => {
      const eb = entityBox(e);
      if (boxContainsBox(box, eb)) return true;
      if (!boxOverlaps(box, eb)) return false;
      const segs = entitySegs(e);
      if (!segs.length) return true; // texto, ponto, cota: caixa basta
      for (const s of segs) {
        if (boxContainsPoint(box, segStart(s))) return true;
        for (const ed of edges) if (segSeg(s, ed).length) return true;
      }
      return false;
    });
  }

  /* ----------------------------- escrita ----------------------------- */

  subscribe(fn: (ev: DocEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(ev: DocEvent) {
    for (const l of this.listeners) l(ev);
  }

  /** Aplica um conjunto de alterações como uma única operação desfazível. */
  commit(label: string, changes: Change[]): Transaction | null {
    if (!changes.length) return null;
    for (const c of changes) this.applyChange(c, false);
    const assoc = this.associativeUpdates(changes);
    for (const c of assoc) this.applyChange(c, false);
    const tx: Transaction = { label, changes: [...changes, ...assoc] };
    this.undoStack.push(tx);
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
    this.redoStack = [];
    this._revision++;
    this.emit({ type: "change", tx, source: "commit" });
    return tx;
  }

  undo(): Transaction | null {
    const tx = this.undoStack.pop();
    if (!tx) return null;
    for (let i = tx.changes.length - 1; i >= 0; i--) this.applyChange(tx.changes[i], true);
    this.redoStack.push(tx);
    this._revision++;
    this.emit({ type: "change", tx, source: "undo" });
    return tx;
  }

  redo(): Transaction | null {
    const tx = this.redoStack.pop();
    if (!tx) return null;
    for (const c of tx.changes) this.applyChange(c, false);
    this.undoStack.push(tx);
    this._revision++;
    this.emit({ type: "change", tx, source: "redo" });
    return tx;
  }

  clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  private indexPut(e: Entity) {
    const old = this.indexItems.get(e.id);
    if (old) this.index.remove(old);
    const b = entityBox(e);
    const it: IndexItem = { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY, id: e.id };
    this.index.insert(it);
    this.indexItems.set(e.id, it);
  }
  private indexDel(id: EntityId) {
    const old = this.indexItems.get(id);
    if (old) this.index.remove(old);
    this.indexItems.delete(id);
  }

  private putEntity(e: Entity, isNew: boolean) {
    if (isNew && !this.seq.has(e.id)) this.seq.set(e.id, ++this.seqCounter);
    this.ents.set(e.id, e);
    this.orderCache = null;
    this.indexPut(e);
    if (e.type === "dimension") this.dims.add(e.id);
  }
  private delEntity(id: EntityId) {
    this.ents.delete(id);
    this.indexDel(id);
    this.dims.delete(id);
    this.orderCache = null;
  }

  private applyChange(c: Change, inverse: boolean) {
    switch (c.kind) {
      case "add":
        if (inverse) this.delEntity(c.e.id);
        else this.putEntity(c.e, true);
        return;
      case "remove":
        if (inverse) this.putEntity(c.e, true);
        else this.delEntity(c.e.id);
        return;
      case "update":
        this.putEntity(inverse ? c.before : c.after, false);
        return;
      case "layer-add":
        if (inverse) this._layers = this._layers.filter((l) => l.name !== c.layer.name);
        else {
          const ls = this._layers.slice();
          ls.splice(Math.min(c.index, ls.length), 0, c.layer);
          this._layers = ls;
        }
        return;
      case "layer-remove":
        if (inverse) {
          const ls = this._layers.slice();
          ls.splice(Math.min(c.index, ls.length), 0, c.layer);
          this._layers = ls;
        } else this._layers = this._layers.filter((l) => l.name !== c.layer.name);
        return;
      case "layer-update": {
        const from = inverse ? c.after : c.before;
        const to = inverse ? c.before : c.after;
        this._layers = this._layers.map((l) => (l.name === from.name ? to : l));
        if (this._current === from.name) this._current = to.name;
        return;
      }
      case "current-layer":
        this._current = inverse ? c.before : c.after;
        return;
      case "settings":
        this._settings = inverse ? c.before : c.after;
        return;
      case "extra":
        this._extras = { ...this._extras, [c.key]: inverse ? c.before : c.after };
        return;
    }
  }

  /** Atualiza cotas associadas a entidades alteradas/removidas na transação. */
  private associativeUpdates(changes: Change[]): Change[] {
    if (!this.dims.size) return [];
    const touched = new Set<EntityId>();
    for (const c of changes) {
      if (c.kind === "update") touched.add(c.after.id);
      else if (c.kind === "remove") touched.add(c.e.id);
    }
    if (!touched.size) return [];
    const out: Change[] = [];
    for (const did of this.dims) {
      if (touched.has(did)) continue; // a própria cota foi editada
      const d = this.ents.get(did) as DimensionEntity | undefined;
      if (!d || !d.assoc) continue;
      const refs = [d.assoc.p1?.id, d.assoc.p2?.id, d.assoc.p3?.id, d.assoc.circle].filter(Boolean) as string[];
      if (!refs.some((r) => touched.has(r))) continue;
      const next = recomputeDimension(d, (id) => this.ents.get(id));
      if (next !== d) out.push({ kind: "update", before: d, after: next });
    }
    return out;
  }

  /* ---------------------- utilitários de alteração ---------------------- */

  addChanges(list: Entity[]): Change[] {
    return list.map((e) => ({ kind: "add", e }));
  }
  removeChanges(ids: Iterable<EntityId>): Change[] {
    const out: Change[] = [];
    for (const id of ids) {
      const e = this.ents.get(id);
      if (e) out.push({ kind: "remove", e });
    }
    return out;
  }
  updateChanges(list: Entity[]): Change[] {
    const out: Change[] = [];
    for (const after of list) {
      const before = this.ents.get(after.id);
      if (before && before !== after) out.push({ kind: "update", before, after });
    }
    return out;
  }

  layerAddChange(layer: Layer): Change {
    if (this.layer(layer.name)) throw new Error(`Camada "${layer.name}" já existe.`);
    return { kind: "layer-add", layer, index: this._layers.length };
  }

  /** Renomeia camada atualizando todas as entidades que a usam. */
  layerRenameChanges(oldName: string, newName: string): Change[] {
    const l = this.layer(oldName);
    if (!l) throw new Error("Camada inexistente.");
    if (oldName === "0") throw new Error('A camada "0" não pode ser renomeada.');
    if (this.layer(newName)) throw new Error(`Camada "${newName}" já existe.`);
    const out: Change[] = [{ kind: "layer-update", before: l, after: { ...l, name: newName } }];
    for (const e of this.ents.values())
      if (e.layer === oldName) out.push({ kind: "update", before: e, after: { ...e, layer: newName } });
    return out;
  }

  layerRemoveChanges(name: string): Change[] {
    if (name === "0") throw new Error('A camada "0" não pode ser excluída.');
    if (name === this._current) throw new Error("Não é possível excluir a camada atual.");
    const idx = this._layers.findIndex((l) => l.name === name);
    if (idx < 0) throw new Error("Camada inexistente.");
    for (const e of this.ents.values()) if (e.layer === name) throw new Error("A camada contém objetos. Mova-os antes de excluir.");
    return [{ kind: "layer-remove", layer: this._layers[idx], index: idx }];
  }

  layerUpdateChange(name: string, patch: Partial<Omit<Layer, "name">>): Change {
    const l = this.layer(name);
    if (!l) throw new Error("Camada inexistente.");
    return { kind: "layer-update", before: l, after: { ...l, ...patch } };
  }

  setCurrentLayerChange(name: string): Change {
    if (!this.layer(name)) throw new Error("Camada inexistente.");
    return { kind: "current-layer", before: this._current, after: name };
  }

  settingsChange(patch: Partial<DocSettings>): Change {
    return { kind: "settings", before: this._settings, after: { ...this._settings, ...patch } };
  }

  extraChange(key: string, value: unknown): Change {
    return { kind: "extra", key, before: this._extras[key], after: value };
  }

  /** Substitui todo o conteúdo (abrir arquivo / novo desenho). Limpa histórico. */
  load(data: {
    entities: Entity[];
    layers: Layer[];
    currentLayer: string;
    settings: DocSettings;
    extras?: Record<string, unknown>;
  }): void {
    this.ents.clear();
    this.seq.clear();
    this.seqCounter = 0;
    this.orderCache = null;
    this.index.clear();
    this.indexItems.clear();
    this.dims.clear();
    this._layers = data.layers.length ? data.layers.slice() : [DEFAULT_LAYER];
    if (!this._layers.some((l) => l.name === "0")) this._layers.unshift(DEFAULT_LAYER);
    this._current = this._layers.some((l) => l.name === data.currentLayer) ? data.currentLayer : "0";
    this._settings = { ...DEFAULT_SETTINGS, ...data.settings, dimStyle: { ...DEFAULT_DIMSTYLE, ...data.settings?.dimStyle } };
    this._extras = { ...(data.extras ?? {}) };
    // carga em lote no índice espacial (bulk load)
    const items: IndexItem[] = [];
    for (const e of data.entities) {
      if (!this._layers.some((l) => l.name === e.layer)) {
        this._layers.push({ ...DEFAULT_LAYER, name: e.layer });
      }
      this.ents.set(e.id, e);
      this.seq.set(e.id, ++this.seqCounter);
      if (e.type === "dimension") this.dims.add(e.id);
      const b = entityBox(e);
      const it = { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY, id: e.id };
      items.push(it);
      this.indexItems.set(e.id, it);
    }
    this.index.load(items);
    this.clearHistory();
    this._revision++;
    this.savedRevision = this._revision;
    this.emit({ type: "change", tx: null, source: "load" });
  }

  reset(): void {
    this.load({ entities: [], layers: [DEFAULT_LAYER], currentLayer: "0", settings: structuredClone(DEFAULT_SETTINGS) });
  }
}

/** Resolve um ponto característico de uma entidade. */
export function resolvePointRef(e: Entity, key: string): Vec2 | null {
  switch (e.type) {
    case "line":
      return key === "a" ? e.a : key === "b" ? e.b : null;
    case "circle":
      return key === "c" ? e.c : null;
    case "arc":
      if (key === "c") return e.c;
      if (key === "s") return add(e.c, fromAngle(e.a0, e.r));
      if (key === "e") return add(e.c, fromAngle(e.a0 + ccwSweep(e.a0, e.a1), e.r));
      return null;
    case "polyline": {
      if (!key.startsWith("v:")) return null;
      const i = Number(key.slice(2));
      return e.pts[i] ?? null;
    }
    case "point":
      return e.p;
    default:
      return null;
  }
}

/** Encontra a referência associativa de um ponto clicado/snapado sobre uma entidade. */
export function findPointRef(e: Entity, p: Vec2, tol = 1e-6): PointRef | null {
  const keys: string[] =
    e.type === "line"
      ? ["a", "b"]
      : e.type === "arc"
        ? ["s", "e", "c"]
        : e.type === "circle"
          ? ["c"]
          : e.type === "polyline"
            ? e.pts.map((_, i) => `v:${i}`)
            : e.type === "point"
              ? ["p"]
              : [];
  for (const k of keys) {
    const q = resolvePointRef(e, k);
    if (q && dist(p, q) <= tol) return { id: e.id, key: k };
  }
  return null;
}

/** Recalcula uma cota associativa a partir das entidades referenciadas. */
export function recomputeDimension(d: DimensionEntity, lookup: (id: EntityId) => Entity | undefined): DimensionEntity {
  if (!d.assoc) return d;
  const a = d.assoc;
  if ((d.kind === "radius" || d.kind === "diameter") && a.circle) {
    const c = lookup(a.circle);
    if (!c || (c.type !== "circle" && c.type !== "arc")) return { ...d, assoc: null };
    const dir = angleOf(sub(d.p2, d.p1));
    const p1 = c.c;
    const p2 = add(c.c, fromAngle(dir, c.r));
    const shift = sub(p1, d.p1);
    return { ...d, p1, p2, loc: add(d.loc, shift) };
  }
  let p1 = d.p1;
  let p2 = d.p2;
  let p3 = d.p3;
  let broken = false;
  const res = (r?: PointRef) => {
    if (!r) return undefined;
    const e = lookup(r.id);
    const q = e ? resolvePointRef(e, r.key) : null;
    if (!q) broken = true;
    return q ?? undefined;
  };
  p1 = res(a.p1) ?? p1;
  p2 = res(a.p2) ?? p2;
  if (a.p3) p3 = res(a.p3) ?? p3;
  if (broken) return { ...d, p1, p2, p3, assoc: null };
  if (p1 === d.p1 && p2 === d.p2 && p3 === d.p3) return d;
  // desloca a posição da linha de cota junto com o deslocamento médio dos pontos de origem
  const shift = { x: (p1.x - d.p1.x + p2.x - d.p2.x) / 2, y: (p1.y - d.p1.y + p2.y - d.p2.y) / 2 };
  return { ...d, p1, p2, p3, loc: add(d.loc, shift) };
}
