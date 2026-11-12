import { type SolidKernel, type StepNode, matrixToPlacement, placementMatrix } from "@agtn/solid";
import { type Model3D, type NodeId, addBody, addGroup, childrenOf } from "./model";
import { base64ToBytes, bytesToBase64 } from "./persist";

const hex = (c: readonly [number, number, number]) =>
  `#${c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("")}`;

/**
 * Insere a árvore lida de um STEP no modelo: conjuntos viram conjuntos, peças viram corpos exatos (BREP),
 * com nomes, cores e posições relativas preservados. Retorna os ids de primeiro nível criados.
 */
export function insertStepTree(m: Model3D, nodes: readonly StepNode[], fileName: string, parent: NodeId | null = null): { model: Model3D; ids: NodeId[] } {
  let out = m;
  const ids: NodeId[] = [];
  const put = (n: StepNode, into: NodeId | null): NodeId => {
    const placement = matrixToPlacement(n.matrix);
    if (n.brep) {
      const r = addBody(out, { name: n.name, parent: into, placement, color: n.color ? hex(n.color) : undefined, source: { type: "brep", data: bytesToBase64(n.brep), origin: fileName } });
      out = r.model;
      return r.id;
    }
    const g = addGroup(out, { name: n.name, parent: into, placement });
    out = g.model;
    for (const c of n.children ?? []) put(c, g.id);
    return g.id;
  };
  // conjunto raiz sem nome próprio (ou o "AGTN" gravado por nós) recebe o nome do arquivo
  const base = fileName.replace(/\.(step|stp)$/i, "");
  for (const n of nodes) ids.push(put(n.children && (!n.name || n.name === "AGTN" || n.name === "Conjunto") ? { ...n, name: base } : n, parent));
  return { model: out, ids };
}

/** Monta a árvore STEP (nomes e posições relativas) dos nós escolhidos (padrão: tudo visível na raiz). */
export function modelToStepTree(k: SolidKernel, m: Model3D, ids: readonly NodeId[] = childrenOf(m, null), partBrep?: (id: NodeId) => Uint8Array | null): StepNode[] {
  const conv = (id: NodeId): StepNode | null => {
    const n = m.nodes[id];
    if (!n || !n.visible) return null;
    const matrix = placementMatrix(n.placement);
    if (n.kind === "group") {
      const children = n.children.map(conv).filter((c): c is StepNode => !!c);
      return children.length ? { name: n.name, matrix, children } : null;
    }
    let brep: Uint8Array;
    if (n.source.type === "brep") brep = base64ToBytes(n.source.data);
    else if (n.source.type === "part") {
      const b = partBrep?.(n.id);
      if (!b) return null;
      brep = b;
    } else {
      const s = k.primitive(n.source.spec);
      try {
        brep = k.toBrep(s);
      } finally {
        k.release(s);
      }
    }
    const c = n.color.match(/^#(..)(..)(..)$/)!;
    return { name: n.name, matrix, brep, color: [parseInt(c[1], 16) / 255, parseInt(c[2], 16) / 255, parseInt(c[3], 16) / 255] };
  };
  return ids.map(conv).filter((x): x is StepNode => !!x);
}
