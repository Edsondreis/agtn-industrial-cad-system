import { type FeatId, type Feature, type FeatureDraft, FEATURE_PREFIX, IDENTITY, featureRefs, validateFeature } from "@agtn/solid";
import { type BodyNode, type Model3D, type NodeId, addBody } from "./model";

/* Operações sobre a árvore de uma peça paramétrica (imutáveis; cada uma vira uma transação no documento). */

type Part = Extract<BodyNode["source"], { type: "part" }>;

export function partOf(m: Model3D, id: NodeId): { body: BodyNode; part: Part } {
  const b = m.nodes[id];
  if (!b || b.kind !== "body") throw new Error("Corpo não encontrado.");
  if (b.source.type !== "part") throw new Error("Este corpo não é uma peça paramétrica.");
  return { body: b, part: b.source };
}

function withPart(m: Model3D, id: NodeId, part: Part): Model3D {
  const b = m.nodes[id] as BodyNode;
  return { ...m, nodes: { ...m.nodes, [id]: { ...b, source: part } } };
}

export function newPart(m: Model3D, opts: { name?: string; parent?: NodeId | null } = {}): { model: Model3D; id: NodeId } {
  return addBody(m, { name: opts.name, parent: opts.parent ?? null, source: { type: "part", features: [], rollback: null } });
}

let fseq = 0;
const fprefix = Math.floor(Math.random() * 0xfffff).toString(36);
export const newFeatureId = (): FeatId => `f${fprefix}-${(++fseq).toString(36)}`;

export function nextFeatureName(features: readonly Feature[], kind: Feature["t"]): string {
  const base = FEATURE_PREFIX[kind];
  const used = new Set(features.map((f) => f.name));
  for (let i = 1; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}

/** Ids de operações que esta operação usa (esboços, alvos, faces/arestas de origem). */
export const featureDeps = featureRefs;

/** Operações que dependem (direta ou indiretamente) de `id`. */
export function dependentsOf(features: readonly Feature[], id: FeatId): FeatId[] {
  const out = new Set<FeatId>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of features) if (!out.has(f.id) && featureDeps(f).some((d) => out.has(d))) {
      out.add(f.id);
      grew = true;
    }
  }
  out.delete(id);
  return features.filter((f) => out.has(f.id)).map((f) => f.id);
}

/** Insere a operação na barra de recuo (se houver) ou no fim. */
export function addFeature(m: Model3D, bodyId: NodeId, draft: FeatureDraft, name?: string): { model: Model3D; id: FeatId; index: number } {
  const { part } = partOf(m, bodyId);
  const errs = validateFeature(draft);
  if (errs.length) throw new Error(errs[0]);
  const id = newFeatureId();
  const f = { ...(draft as object), id, name: name?.trim() || nextFeatureName(part.features, draft.t) } as Feature;
  const at = part.rollback ?? part.features.length;
  const features = [...part.features.slice(0, at), f, ...part.features.slice(at)];
  const rollback = part.rollback === null ? null : part.rollback + 1;
  return { model: withPart(m, bodyId, { ...part, features, rollback }), id, index: at };
}

/** Substitui os parâmetros (mesmo id e nome). */
export function updateFeature(m: Model3D, bodyId: NodeId, featId: FeatId, next: FeatureDraft): Model3D {
  const { part } = partOf(m, bodyId);
  const i = part.features.findIndex((f) => f.id === featId);
  if (i < 0) throw new Error("Operação não encontrada.");
  const errs = validateFeature(next);
  if (errs.length) throw new Error(errs[0]);
  const old = part.features[i];
  const f = { ...(next as object), id: old.id, name: old.name, suppressed: old.suppressed } as Feature;
  return withPart(m, bodyId, { ...part, features: part.features.map((x, k) => (k === i ? f : x)) });
}

export function renameFeature(m: Model3D, bodyId: NodeId, featId: FeatId, name: string): Model3D {
  const nm = name.trim();
  if (!nm) throw new Error("O nome não pode ficar vazio.");
  const { part } = partOf(m, bodyId);
  if (part.features.some((f) => f.name === nm && f.id !== featId)) throw new Error("Já existe uma operação com esse nome.");
  return withPart(m, bodyId, { ...part, features: part.features.map((f) => (f.id === featId ? { ...f, name: nm } : f)) });
}

export function setSuppressed(m: Model3D, bodyId: NodeId, featId: FeatId, suppressed: boolean): Model3D {
  const { part } = partOf(m, bodyId);
  return withPart(m, bodyId, { ...part, features: part.features.map((f) => (f.id === featId ? { ...f, suppressed: suppressed || undefined } : f)) });
}

/** Recua a peça até antes da operação `index` (null = tudo ativo). */
export function setRollback(m: Model3D, bodyId: NodeId, index: number | null): Model3D {
  const { part } = partOf(m, bodyId);
  const rb = index === null || index >= part.features.length ? null : Math.max(0, index);
  return withPart(m, bodyId, { ...part, rollback: rb });
}

/** Exclui a operação; com `cascade`, também as que dependem dela. Sem cascade e com dependentes → erro. */
export function removeFeature(m: Model3D, bodyId: NodeId, featId: FeatId, cascade: boolean): Model3D {
  const { part } = partOf(m, bodyId);
  const deps = dependentsOf(part.features, featId);
  if (deps.length && !cascade) {
    const names = deps.map((d) => part.features.find((f) => f.id === d)!.name).join(", ");
    throw new Error(`Usada por: ${names}.`);
  }
  const del = new Set([featId, ...deps]);
  const features = part.features.filter((f) => !del.has(f.id));
  const before = part.rollback === null ? null : part.features.slice(0, part.rollback).filter((f) => !del.has(f.id)).length;
  return withPart(m, bodyId, { ...part, features, rollback: before === null || before >= features.length ? null : before });
}

/** Converte uma primitiva em peça paramétrica (para receber arredondamento, furos…). */
export function convertToPart(m: Model3D, bodyId: NodeId): Model3D {
  const b = m.nodes[bodyId];
  if (!b || b.kind !== "body") throw new Error("Corpo não encontrado.");
  if (b.source.type === "part") return m;
  if (b.source.type !== "primitive") throw new Error("Sólido importado não tem histórico de operações — use-o como corpo de combinação.");
  const f = { id: newFeatureId(), name: "Base_1", t: "primitive", spec: b.source.spec, placement: IDENTITY } as Feature;
  return { ...m, nodes: { ...m.nodes, [bodyId]: { ...b, source: { type: "part", features: [f], rollback: null } } } };
}
