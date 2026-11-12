import type { NodeId } from "@agtn/model3d";
import type { Measurement, TopoInfo, TopoKind } from "@agtn/solid";

/** Elemento escolhido: um nó da árvore (corpo/conjunto) ou um elemento topológico real de um corpo. */
export type Sel = { readonly t: "node"; readonly id: NodeId } | { readonly t: "topo"; readonly body: NodeId; readonly kind: TopoKind; readonly index: number };

export const selKey = (s: Sel) => (s.t === "node" ? `n:${s.id}` : `${s.kind}:${s.body}:${s.index}`);
export const sameSel = (a: Sel | null, b: Sel | null) => !!a && !!b && selKey(a) === selKey(b);

export type DisplayMode = "sombreado-arestas" | "sombreado" | "arame";
export type PickFilter = "auto" | "corpo" | "face" | "aresta" | "vertice";

export const FILTER_LABEL: Record<PickFilter, string> = {
  auto: "Inteligente (vértice › aresta › face)",
  corpo: "Corpos",
  face: "Faces",
  aresta: "Arestas",
  vertice: "Vértices",
};
export const KIND_LABEL: Record<TopoKind | "solid", string> = { face: "Face", edge: "Aresta", vertex: "Vértice", solid: "Corpo" };

export interface Ws3dSnapshot {
  readonly sel: readonly Sel[];
  readonly hover: Sel | null;
  /** ponto da superfície sob o cursor (mm) */
  readonly cursor: { x: number; y: number; z: number } | null;
  readonly filter: PickFilter;
  readonly mode: DisplayMode;
  readonly grid: boolean;
  readonly ortho: boolean;
  readonly measuring: boolean;
  readonly measure: { readonly a: Sel; readonly b: Sel; readonly m: Measurement } | null;
  /** informação exata do último elemento topológico selecionado */
  readonly info: { readonly sel: Sel; readonly info: TopoInfo } | null;
  readonly view: string | null;
}

/** Estado observável da área 3D (React lê via useSyncExternalStore; o viewport assina mudanças). */
export class Ws3dStore {
  private s: Ws3dSnapshot = {
    sel: [],
    hover: null,
    cursor: null,
    filter: "auto",
    mode: "sombreado-arestas",
    grid: true,
    ortho: true,
    measuring: false,
    measure: null,
    info: null,
    view: null,
  };
  private subs = new Set<() => void>();

  get snap(): Ws3dSnapshot {
    return this.s;
  }
  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => void this.subs.delete(fn);
  };
  getSnapshot = () => this.s;

  set(p: Partial<Ws3dSnapshot>) {
    let changed = false;
    for (const k of Object.keys(p) as (keyof Ws3dSnapshot)[]) if (this.s[k] !== p[k]) changed = true;
    if (!changed) return;
    this.s = { ...this.s, ...p };
    for (const f of this.subs) f();
  }

  /** Clique: substitui a seleção; com Ctrl/Shift alterna o item. */
  pick(s: Sel | null, additive: boolean) {
    if (!s && this.s.measuring) return; // clique no vazio não perde a medição em andamento
    if (!s) {
      if (!additive) this.set({ sel: [], info: null, measure: null });
      return;
    }
    const has = this.s.sel.some((x) => sameSel(x, s));
    // no modo medir cada clique acumula (1º e 2º elementos)
    if (this.s.measuring) additive = true;
    let sel: Sel[];
    if (additive) sel = has ? this.s.sel.filter((x) => !sameSel(x, s)) : [...this.s.sel, s];
    else sel = [s];
    // no modo medir guarda só os dois últimos
    if (this.s.measuring && sel.length > 2) sel = sel.slice(-2);
    this.set({ sel, measure: null, info: null });
  }

  /** Corpos/conjuntos selecionados (nós). */
  get nodes(): NodeId[] {
    return this.s.sel.filter((x): x is Extract<Sel, { t: "node" }> => x.t === "node").map((x) => x.id);
  }
}
