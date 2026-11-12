import {
  IDENTITY,
  MATRIX_IDENTITY,
  type Matrix34,
  type Placement,
  type PrimitiveSpec,
  composeMatrix,
  describePrimitive,
  placementMatrix,
  validatePrimitive,
} from "@agtn/solid";

/**
 * Documento 3D do AGTN: árvore de conjuntos (montagens/subconjuntos) e corpos.
 *
 * - Guardado em `CadDocument.extras["agtn3d"]` → entra no Undo/Redo e no `.agtncad` sem mudar o formato 2D.
 * - Imutável: toda operação devolve um novo `Model3D` (objetos não alterados são compartilhados).
 * - Posições: cada nó tem Placement relativo ao pai; a posição no mundo é a composição pai → filho.
 * - Corpos guardam a DEFINIÇÃO (primitiva paramétrica ou BREP importado), nunca malha.
 */
export const MODEL3D_KEY = "agtn3d";
export const MODEL3D_VERSION = 1;

export type NodeId = string;

export type BodySource =
  /** primitiva paramétrica (regenerável a partir dos parâmetros) */
  | { readonly type: "primitive"; readonly spec: PrimitiveSpec }
  /** sólido exato importado (BREP binário do OCCT em base64) */
  | { readonly type: "brep"; readonly data: string; readonly origin: string };

interface NodeBase {
  readonly id: NodeId;
  readonly name: string;
  readonly parent: NodeId | null;
  readonly visible: boolean;
  readonly placement: Placement;
}

export interface GroupNode extends NodeBase {
  readonly kind: "group";
  readonly children: readonly NodeId[];
}

export interface BodyNode extends NodeBase {
  readonly kind: "body";
  readonly source: BodySource;
  /** cor de exibição #rrggbb */
  readonly color: string;
  readonly material: MaterialId;
}

export type Node3D = GroupNode | BodyNode;

export interface Model3D {
  readonly version: typeof MODEL3D_VERSION;
  readonly nodes: Readonly<Record<NodeId, Node3D>>;
  readonly roots: readonly NodeId[];
}

/* ----------------------------------------------------------------------------- materiais */

export type MaterialId = "aco_carbono" | "aco_inox" | "aluminio" | "latao" | "cobre" | "nenhum";

/** Densidades (g/cm³) de referência para peso teórico. */
export const MATERIALS: Record<MaterialId, { label: string; density: number }> = {
  aco_carbono: { label: "Aço carbono", density: 7.85 },
  aco_inox: { label: "Aço inox", density: 7.93 },
  aluminio: { label: "Alumínio", density: 2.7 },
  latao: { label: "Latão", density: 8.5 },
  cobre: { label: "Cobre", density: 8.96 },
  nenhum: { label: "Sem material", density: 0 },
};

/** Massa em kg a partir do volume em mm³. */
export const massKg = (volumeMm3: number, m: MaterialId) => volumeMm3 * MATERIALS[m].density * 1e-6;

/** Cores padrão alternadas para corpos novos (metálicos discretos, legíveis no fundo escuro). */
export const BODY_COLORS = ["#9aa7b6", "#7f9fc4", "#b8a07a", "#8fb39a", "#b58f8f", "#a39cc4", "#c2b48a", "#86aeb5"];

/* ----------------------------------------------------------------------------- consulta */

export const emptyModel = (): Model3D => ({ version: MODEL3D_VERSION, nodes: {}, roots: [] });

export function childrenOf(m: Model3D, parent: NodeId | null): readonly NodeId[] {
  if (parent === null) return m.roots;
  const n = m.nodes[parent];
  return n?.kind === "group" ? n.children : [];
}

/** Matriz no mundo (composição dos Placement de todos os ancestrais). */
export function worldMatrix(m: Model3D, id: NodeId): number[] {
  const chain: Node3D[] = [];
  for (let n: Node3D | undefined = m.nodes[id]; n; n = n.parent ? m.nodes[n.parent] : undefined) chain.unshift(n);
  let acc: Matrix34 = MATRIX_IDENTITY;
  for (const n of chain) acc = composeMatrix(acc, placementMatrix(n.placement));
  return [...acc];
}

/** Visível de fato = ele e todos os ancestrais visíveis. */
export function isShown(m: Model3D, id: NodeId): boolean {
  for (let n: Node3D | undefined = m.nodes[id]; n; n = n.parent ? m.nodes[n.parent] : undefined) if (!n.visible) return false;
  return true;
}

/** Todos os descendentes (pré-ordem), incluindo o próprio nó. */
export function subtree(m: Model3D, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const walk = (x: NodeId) => {
    const n = m.nodes[x];
    if (!n) return;
    out.push(x);
    if (n.kind === "group") n.children.forEach(walk);
  };
  walk(id);
  return out;
}

export function bodies(m: Model3D): BodyNode[] {
  const out: BodyNode[] = [];
  const walk = (ids: readonly NodeId[]) => {
    for (const id of ids) {
      const n = m.nodes[id];
      if (!n) continue;
      if (n.kind === "body") out.push(n);
      else walk(n.children);
    }
  };
  walk(m.roots);
  return out;
}

export function isAncestor(m: Model3D, anc: NodeId, id: NodeId): boolean {
  for (let n: Node3D | undefined = m.nodes[id]; n; n = n.parent ? m.nodes[n.parent] : undefined) if (n.id === anc) return true;
  return false;
}

/** Caminho "Conjunto › Subconjunto › Peça" para relatórios e IA. */
export function pathOf(m: Model3D, id: NodeId): string {
  const names: string[] = [];
  for (let n: Node3D | undefined = m.nodes[id]; n; n = n.parent ? m.nodes[n.parent] : undefined) names.unshift(n.name);
  return names.join(" › ");
}

/* ----------------------------------------------------------------------------- edição */

let seq = 0;
const prefix = Math.floor(Math.random() * 0xfffff).toString(36);
export const newNodeId = (): NodeId => `n${prefix}-${(++seq).toString(36)}`;

/** Próximo nome livre: "Caixa 1", "Caixa 2"… */
export function nextName(m: Model3D, base: string): string {
  const used = new Set(Object.values(m.nodes).map((n) => n.name));
  for (let i = 1; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}

function withNode(m: Model3D, n: Node3D): Model3D {
  return { ...m, nodes: { ...m.nodes, [n.id]: n } };
}

function insertChild(m: Model3D, parent: NodeId | null, id: NodeId, index?: number): Model3D {
  const list = [...childrenOf(m, parent)];
  list.splice(index ?? list.length, 0, id);
  if (parent === null) return { ...m, roots: list };
  const p = m.nodes[parent];
  if (p?.kind !== "group") throw new Error("O destino não é um conjunto.");
  return withNode(m, { ...p, children: list });
}

function detach(m: Model3D, id: NodeId): Model3D {
  const n = m.nodes[id];
  if (!n) return m;
  if (n.parent === null) return { ...m, roots: m.roots.filter((x) => x !== id) };
  const p = m.nodes[n.parent];
  if (p?.kind !== "group") return m;
  return withNode(m, { ...p, children: p.children.filter((x) => x !== id) });
}

export interface NewBody {
  name?: string;
  source: BodySource;
  placement?: Placement;
  color?: string;
  material?: MaterialId;
  parent?: NodeId | null;
  id?: NodeId;
}

export function sourceLabel(s: BodySource): string {
  return s.type === "primitive" ? describePrimitive(s.spec) : `Sólido importado (${s.origin})`;
}

export function addBody(m: Model3D, b: NewBody): { model: Model3D; id: NodeId } {
  if (b.source.type === "primitive") {
    const errs = validatePrimitive(b.source.spec);
    if (errs.length) throw new Error(errs[0]);
  }
  const parent = b.parent ?? null;
  if (parent !== null && m.nodes[parent]?.kind !== "group") throw new Error("Conjunto de destino não existe.");
  const id = b.id ?? newNodeId();
  const count = bodies(m).length;
  const base = b.source.type === "primitive" ? describePrimitive(b.source.spec).split(" ")[0] : "Corpo";
  const node: BodyNode = {
    kind: "body",
    id,
    name: b.name?.trim() || nextName(m, base),
    parent,
    visible: true,
    placement: b.placement ?? IDENTITY,
    source: b.source,
    color: b.color ?? BODY_COLORS[count % BODY_COLORS.length],
    material: b.material ?? "aco_carbono",
  };
  return { model: insertChild(withNode(m, node), parent, id), id };
}

export function addGroup(m: Model3D, opts: { name?: string; parent?: NodeId | null; placement?: Placement; id?: NodeId } = {}): { model: Model3D; id: NodeId } {
  const parent = opts.parent ?? null;
  if (parent !== null && m.nodes[parent]?.kind !== "group") throw new Error("Conjunto de destino não existe.");
  const id = opts.id ?? newNodeId();
  const node: GroupNode = {
    kind: "group",
    id,
    name: opts.name?.trim() || nextName(m, "Conjunto"),
    parent,
    visible: true,
    placement: opts.placement ?? IDENTITY,
    children: [],
  };
  return { model: insertChild(withNode(m, node), parent, id), id };
}

function patch<N extends Node3D>(m: Model3D, id: NodeId, f: (n: N) => N): Model3D {
  const n = m.nodes[id] as N | undefined;
  if (!n) throw new Error("Objeto não encontrado.");
  return withNode(m, f(n));
}

export function rename(m: Model3D, id: NodeId, name: string): Model3D {
  const nm = name.trim();
  if (!nm) throw new Error("O nome não pode ficar vazio.");
  if (nm.length > 120) throw new Error("Nome longo demais (máximo 120 caracteres).");
  return patch(m, id, (n) => ({ ...n, name: nm }));
}

export function setVisible(m: Model3D, ids: readonly NodeId[], visible: boolean): Model3D {
  let out = m;
  for (const id of ids) out = patch(out, id, (n) => ({ ...n, visible }));
  return out;
}

export function setPlacement(m: Model3D, id: NodeId, placement: Placement): Model3D {
  const vals = [placement.origin.x, placement.origin.y, placement.origin.z, placement.rot.x, placement.rot.y, placement.rot.z];
  if (!vals.every(Number.isFinite)) throw new Error("Posição inválida.");
  return patch(m, id, (n) => ({ ...n, placement }));
}

export function setColor(m: Model3D, ids: readonly NodeId[], color: string): Model3D {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Cor inválida.");
  let out = m;
  for (const id of ids) if (m.nodes[id]?.kind === "body") out = patch<BodyNode>(out, id, (n) => ({ ...n, color }));
  return out;
}

export function setMaterial(m: Model3D, ids: readonly NodeId[], material: MaterialId): Model3D {
  if (!(material in MATERIALS)) throw new Error("Material desconhecido.");
  let out = m;
  for (const id of ids) if (m.nodes[id]?.kind === "body") out = patch<BodyNode>(out, id, (n) => ({ ...n, material }));
  return out;
}

/** Altera os parâmetros de uma primitiva (regenera o sólido). */
export function setPrimitive(m: Model3D, id: NodeId, spec: PrimitiveSpec): Model3D {
  const errs = validatePrimitive(spec);
  if (errs.length) throw new Error(errs[0]);
  return patch<BodyNode>(m, id, (n) => {
    if (n.kind !== "body" || n.source.type !== "primitive") throw new Error("Este corpo não é uma primitiva paramétrica.");
    return { ...n, source: { type: "primitive", spec } };
  });
}

/** Remove nós e todos os descendentes. */
export function remove(m: Model3D, ids: readonly NodeId[]): Model3D {
  let out = m;
  for (const id of ids) {
    if (!out.nodes[id]) continue;
    const all = subtree(out, id);
    out = detach(out, id);
    const nodes = { ...out.nodes };
    for (const x of all) delete nodes[x];
    out = { ...out, nodes };
  }
  return out;
}

/** Move um nó para outro conjunto (ou para a raiz), mantendo a posição relativa. Impede ciclos. */
export function reparent(m: Model3D, id: NodeId, parent: NodeId | null, index?: number): Model3D {
  const n = m.nodes[id];
  if (!n) throw new Error("Objeto não encontrado.");
  if (parent !== null) {
    if (m.nodes[parent]?.kind !== "group") throw new Error("O destino não é um conjunto.");
    if (isAncestor(m, id, parent)) throw new Error("Um conjunto não pode ser movido para dentro dele mesmo.");
  }
  let out = detach(m, id);
  out = withNode(out, { ...out.nodes[id], parent });
  return insertChild(out, parent, id, index);
}

/** Agrupa nós (mesmo pai) num novo conjunto. */
export function groupNodes(m: Model3D, ids: readonly NodeId[], name?: string): { model: Model3D; id: NodeId } {
  if (!ids.length) throw new Error("Selecione pelo menos um objeto.");
  const parent = m.nodes[ids[0]]?.parent ?? null;
  if (ids.some((x) => (m.nodes[x]?.parent ?? null) !== parent)) throw new Error("Só é possível agrupar objetos do mesmo nível.");
  const pos = childrenOf(m, parent).indexOf(ids[0]);
  const g = addGroup(m, { name, parent });
  let out = reparent(g.model, g.id, parent, pos);
  for (const x of ids) out = reparent(out, x, g.id);
  return { model: out, id: g.id };
}

/** Copia um nó (e sua subárvore) com novos ids, no mesmo pai, deslocada por `offset`. */
export function duplicate(m: Model3D, id: NodeId, offset = { x: 0, y: 0, z: 0 }): { model: Model3D; id: NodeId } {
  const src = m.nodes[id];
  if (!src) throw new Error("Objeto não encontrado.");
  const map = new Map<NodeId, NodeId>();
  for (const x of subtree(m, id)) map.set(x, newNodeId());
  const nodes: Record<NodeId, Node3D> = { ...m.nodes };
  for (const [oldId, nid] of map) {
    const o = m.nodes[oldId];
    const parent = oldId === id ? o.parent : map.get(o.parent!)!;
    const base = { ...o, id: nid, parent };
    nodes[nid] = o.kind === "group" ? ({ ...base, children: o.children.map((c) => map.get(c)!) } as GroupNode) : (base as BodyNode);
  }
  const nid = map.get(id)!;
  const copy = nodes[nid];
  nodes[nid] = {
    ...copy,
    name: nextName(m, src.name.replace(/\s+\d+$/, "")),
    placement: { ...copy.placement, origin: { x: copy.placement.origin.x + offset.x, y: copy.placement.origin.y + offset.y, z: copy.placement.origin.z + offset.z } },
  };
  const out = insertChild({ ...m, nodes }, src.parent, nid, childrenOf(m, src.parent).indexOf(id) + 1);
  return { model: out, id: nid };
}
