import type { CadDocument, Change } from "@agtn/document";
import { IDENTITY, type Placement, type PrimitiveSpec, validatePrimitive } from "@agtn/solid";
import { type BodyNode, type GroupNode, MATERIALS, MODEL3D_KEY, MODEL3D_VERSION, type Model3D, type Node3D, type NodeId, emptyModel } from "./model";

/* ----------------------------------------------------------------------------- base64 (navegador, worker e Node) */

export function bytesToBase64(b: Uint8Array): string {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode(...b.subarray(i, i + CH));
  return btoa(s);
}
export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ----------------------------------------------------------------------------- validação de arquivo */

export interface ParseReport {
  model: Model3D;
  warnings: string[];
}

/**
 * Campos desconhecidos (gravados por uma versão mais nova) são PRESERVADOS e devolvidos iguais ao salvar —
 * no modelo, em cada nó e na fonte do corpo. Os campos conhecidos continuam validados e têm prioridade.
 */
const NODE_KEYS = new Set(["id", "name", "parent", "visible", "placement", "kind", "children", "source", "color", "material"]);
const SOURCE_KEYS: Record<string, Set<string>> = {
  primitive: new Set(["type", "spec"]),
  part: new Set(["type", "features", "rollback"]),
  brep: new Set(["type", "data", "origin"]),
};
const MODEL_KEYS = new Set(["version", "nodes", "roots"]);
function unknownKeys(o: Record<string, unknown>, known: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (!known.has(k) && v !== undefined) out[k] = v;
  return out;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const vec = (v: unknown) => !!v && typeof v === "object" && num((v as Record<string, unknown>).x) && num((v as Record<string, unknown>).y) && num((v as Record<string, unknown>).z);
const placementOk = (p: unknown): p is Placement => !!p && typeof p === "object" && vec((p as Placement).origin) && vec((p as Placement).rot);

/**
 * Lê o modelo 3D gravado no `.agtncad`, validando cada nó. Nós inválidos são descartados com aviso;
 * referências quebradas são consertadas. Nunca lança para dados ruins — lança só para versão futura.
 */
export function parseModel3D(raw: unknown): ParseReport {
  const warnings: string[] = [];
  if (raw === undefined || raw === null) return { model: emptyModel(), warnings };
  const r = raw as Partial<Model3D>;
  if (typeof r !== "object" || !r.nodes || typeof r.nodes !== "object" || !Array.isArray(r.roots)) {
    return { model: emptyModel(), warnings: ["Dados 3D do arquivo ilegíveis — modelo 3D ignorado."] };
  }
  if (num(r.version) && r.version > MODEL3D_VERSION) throw new Error(`Modelo 3D em versão mais nova (${r.version}). Atualize o AGTN Industrial CAD.`);
  const nodes: Record<NodeId, Node3D> = {};
  for (const [id, n0] of Object.entries(r.nodes)) {
    const n = n0 as unknown as Record<string, unknown>;
    if (!n || typeof n !== "object" || n.id !== id || typeof n.name !== "string") {
      warnings.push(`Objeto 3D "${id}" inválido ignorado.`);
      continue;
    }
    const placement = placementOk(n.placement) ? n.placement : IDENTITY;
    const base = { ...unknownKeys(n, NODE_KEYS), id, name: n.name, parent: typeof n.parent === "string" ? n.parent : null, visible: n.visible !== false, placement };
    if (n.kind === "group") {
      nodes[id] = { ...base, kind: "group", children: Array.isArray(n.children) ? (n.children as unknown[]).filter((c): c is string => typeof c === "string") : [] } satisfies GroupNode;
    } else if (n.kind === "body") {
      const src = n.source as Record<string, unknown> | undefined;
      let source: BodyNode["source"] | null = null;
      if (src?.type === "primitive" && src.spec && typeof src.spec === "object") {
        const errs = validatePrimitive(src.spec as PrimitiveSpec);
        if (!errs.length) source = { ...unknownKeys(src, SOURCE_KEYS.primitive), type: "primitive", spec: src.spec as PrimitiveSpec } as BodyNode["source"];
        else warnings.push(`"${n.name}": ${errs[0]}`);
      } else if (src?.type === "part" && Array.isArray(src.features)) {
        const feats = (src.features as unknown[]).filter((f): f is Record<string, unknown> => !!f && typeof f === "object" && typeof (f as { id?: unknown }).id === "string" && typeof (f as { t?: unknown }).t === "string" && typeof (f as { name?: unknown }).name === "string");
        if (feats.length !== src.features.length) warnings.push(`"${n.name}": ${src.features.length - feats.length} operação(ões) ilegível(is) ignorada(s).`);
        // ids duplicados (arquivo editado à mão/corrompido): a 2ª ocorrência ganha id novo; referências ficam na 1ª
        const used = new Set<string>();
        for (let i = 0; i < feats.length; i++) {
          let fid = feats[i].id as string;
          if (!used.has(fid)) {
            used.add(fid);
            continue;
          }
          let k2 = 2;
          while (used.has(`${fid}~${k2}`)) k2++;
          warnings.push(`"${n.name}": operação "${feats[i].name}" tinha id duplicado (${fid}) — renomeado para ${fid}~${k2}.`);
          fid = `${fid}~${k2}`;
          used.add(fid);
          feats[i] = { ...feats[i], id: fid };
        }
        const rb = typeof src.rollback === "number" && src.rollback >= 0 ? Math.min(src.rollback, feats.length) : null;
        source = { ...unknownKeys(src, SOURCE_KEYS.part), type: "part", features: feats as unknown as BodyNode["source"] extends { features: infer F } ? F : never, rollback: rb } as BodyNode["source"];
      } else if (src?.type === "brep" && typeof src.data === "string" && src.data.length > 0) {
        source = { ...unknownKeys(src, SOURCE_KEYS.brep), type: "brep", data: src.data, origin: typeof src.origin === "string" ? src.origin : "importado" } as BodyNode["source"];
      }
      if (!source) {
        warnings.push(`Corpo "${n.name}" sem geometria válida ignorado.`);
        continue;
      }
      nodes[id] = {
        ...base,
        kind: "body",
        source,
        color: typeof n.color === "string" && /^#[0-9a-f]{6}$/i.test(n.color) ? n.color : "#9aa7b6",
        material: typeof n.material === "string" && n.material in MATERIALS ? (n.material as BodyNode["material"]) : "aco_carbono",
      };
    } else warnings.push(`Objeto 3D "${n.name}" de tipo desconhecido ignorado.`);
  }
  // consistência pai ↔ filhos (e sem ciclos): reconstrói a partir das listas de filhos
  const seen = new Set<NodeId>();
  const fixed: Record<NodeId, Node3D> = {};
  const visit = (id: NodeId, parent: NodeId | null): boolean => {
    const n = nodes[id];
    if (!n || seen.has(id)) return false;
    seen.add(id);
    if (n.kind === "group") {
      const kids = n.children.filter((c) => visit(c, id));
      fixed[id] = { ...n, parent, children: kids };
    } else fixed[id] = { ...n, parent };
    return true;
  };
  const roots = (r.roots as unknown[]).filter((x): x is string => typeof x === "string").filter((id) => visit(id, null));
  // nós órfãos (válidos mas não alcançáveis) voltam para a raiz em vez de sumirem
  for (const id of Object.keys(nodes)) {
    if (!seen.has(id) && visit(id, null)) {
      roots.push(id);
      warnings.push(`"${nodes[id].name}" estava sem conjunto e foi colocado na raiz.`);
    }
  }
  return { model: { ...unknownKeys(r as Record<string, unknown>, MODEL_KEYS), version: MODEL3D_VERSION, nodes: fixed, roots } as Model3D, warnings };
}

/* ----------------------------------------------------------------------------- integração com o CadDocument */

const cache = new WeakMap<object, Model3D>();

/** Modelo 3D atual do documento (validado; leitura em cache por referência). */
export function getModel(doc: CadDocument): Model3D {
  const raw = doc.extras[MODEL3D_KEY];
  if (raw === undefined) return EMPTY;
  if (typeof raw !== "object" || raw === null) return EMPTY;
  const hit = cache.get(raw);
  if (hit) return hit;
  const { model } = parseModel3D(raw);
  cache.set(raw, model);
  cache.set(model, model);
  return model;
}
const EMPTY = emptyModel();

/** Grava o novo modelo como UMA transação desfazível. Sem mudança → nada. */
export function commitModel(doc: CadDocument, label: string, next: Model3D): boolean {
  const before = doc.extras[MODEL3D_KEY];
  const prev = getModel(doc);
  if (next === prev) return false;
  cache.set(next, next);
  const change: Change = { kind: "extra", key: MODEL3D_KEY, before, after: next };
  doc.commit(label, [change]);
  return true;
}

/** Valida o modelo de um arquivo recém-aberto e devolve os avisos (para o relatório de abertura). */
export function checkLoadedModel(doc: CadDocument): string[] {
  const raw = doc.extras[MODEL3D_KEY];
  if (raw === undefined) return [];
  const rep = parseModel3D(raw);
  cache.set(raw as object, rep.model);
  return rep.warnings;
}
