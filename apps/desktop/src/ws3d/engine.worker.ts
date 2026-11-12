/// <reference lib="webworker" />
/**
 * Worker do motor 3D: todo cálculo B-Rep (OCCT/WASM) acontece aqui, fora da thread da interface,
 * para a navegação do viewport nunca travar durante uma regeneração.
 */
import { BodyCache, type Model3D, modelToStepTree, partOf, worldMatrix } from "@agtn/model3d";
import { OcctSolidKernel, PartEvaluator, SolidError, type SolidRef, invertRigid } from "@agtn/solid";
import type { BodyGeom, EngineApi, EngineRequest, EngineResponse, TopoRefMsg } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

let kernel: OcctSolidKernel | null = null;
let cache: BodyCache | null = null;
let parts: PartEvaluator | null = null;
/** avaliador separado para prévias (não mexe no cache do que está exibido) */
let previewParts: PartEvaluator | null = null;
let lastModel: Model3D | null = null;

const K = () => {
  if (!kernel || !cache) throw new SolidError("NOT_READY", "Motor 3D ainda não iniciado.");
  return { k: kernel, c: cache };
};

function refOf(t: TopoRefMsg): SolidRef {
  const r = K().c.get(t.body);
  if (r === undefined) throw new SolidError("INVALID_PARAMS", "Corpo não encontrado (talvez tenha sido apagado).");
  return r;
}

function geomOf(id: string, ref: SolidRef): BodyGeom {
  const { k } = K();
  const mesh = k.mesh(ref);
  const ed = k.edges(ref);
  const faces = new Int32Array(mesh.faces.length * 2);
  mesh.faces.forEach((f, i) => {
    faces[i * 2] = f.start;
    faces[i * 2 + 1] = f.count;
  });
  const edges = new Int32Array(ed.edges.length * 2);
  ed.edges.forEach((e, i) => {
    edges[i * 2] = e.start;
    edges[i * 2 + 1] = e.count;
  });
  return {
    id,
    positions: mesh.positions,
    normals: mesh.normals,
    indices: mesh.indices,
    faces,
    edgePoints: ed.points,
    edges,
    vertices: k.vertexPoints(ref),
    props: k.props(ref),
    topo: k.topology(ref),
  };
}

/** Operações síncronas (o `init`, assíncrono, é tratado no onmessage). */
const api: Omit<EngineApi, "init"> = {
  sync({ model, full }) {
    const { c } = K();
    if (full) c.clear();
    const t0 = performance.now();
    lastModel = model;
    const r = c.sync(model);
    const built = r.built.map((id) => geomOf(id, c.get(id)!));
    return { built, removed: r.removed, errors: r.errors, ms: performance.now() - t0, features: r.features, frames: r.frames, empty: r.empty };
  },
  identify({ body, kind, index }) {
    if (!lastModel || !parts) throw new SolidError("NOT_READY", "Modelo ainda não sincronizado.");
    const { part } = partOf(lastModel, body);
    const at = (part.rollback ?? part.features.length) - 1;
    return kind === "face" ? parts.identifyFace(body, part.features, at, index) : parts.identifyEdge(body, part.features, at, index);
  },
  preview({ model, body, features, rollback }) {
    const { k, c } = K();
    const t0 = performance.now();
    const world = worldMatrix(model, body);
    const inv = invertRigid(world);
    const tmp: SolidRef[] = [];
    try {
      const res = previewParts!.evaluate(body, features, {
        rollback,
        external: (id) => {
          const t = c.get(id);
          if (t === undefined) return null;
          const local = k.transform(t, inv);
          tmp.push(local);
          return { sig: String(t), shape: local as unknown as never };
        },
      });
      let geom = null;
      if (res.shape !== null) {
        const w = k.transform(res.shape as unknown as SolidRef, world);
        tmp.push(w);
        geom = geomOf(body, w);
      }
      return { geom, status: res.status, frames: res.frames, ms: performance.now() - t0 };
    } finally {
      for (const t of tmp) k.release(t);
    }
  },
  info(t) {
    if (t.kind === "solid") throw new SolidError("INVALID_PARAMS", "Use as propriedades do corpo.");
    return K().k.info(refOf(t), t.kind, t.index);
  },
  measure({ a, b }) {
    return K().k.measure({ ref: refOf(a), kind: a.kind, index: a.index }, { ref: refOf(b), kind: b.kind, index: b.index });
  },
  importStep({ text }) {
    return K().k.importStepTree(text);
  },
  exportStep({ model, ids }) {
    const { k } = K();
    const { c } = K();
    const tree = modelToStepTree(k, model, ids, (id) => {
      const w = c.get(id);
      if (w === undefined) return null;
      const local = k.transform(w, invertRigid(worldMatrix(model, id)));
      try {
        return k.toBrep(local);
      } finally {
        k.release(local);
      }
    });
    if (!tree.length) throw new SolidError("INVALID_PARAMS", "Nada visível para exportar.");
    return k.exportStepTree(tree);
  },
  exportStl({ ids }) {
    const { k, c } = K();
    const parts = ids.map((id) => c.get(id)).filter((r): r is SolidRef => r !== undefined).map((r) => k.toStl(r));
    if (!parts.length) throw new SolidError("INVALID_PARAMS", "Nenhum corpo para exportar.");
    // concatena STL binários: cabeçalho de 80 bytes + contagem + triângulos de 50 bytes
    const tris = parts.reduce((a, p) => a + new DataView(p.buffer, p.byteOffset).getUint32(80, true), 0);
    const out = new Uint8Array(84 + tris * 50);
    const head = new TextEncoder().encode("AGTN Industrial CAD - STL (malha, mm)");
    out.set(head.subarray(0, 80));
    new DataView(out.buffer).setUint32(80, tris, true);
    let off = 84;
    for (const p of parts) {
      const body = p.subarray(84);
      out.set(body, off);
      off += body.length;
    }
    return out;
  },
  stats() {
    const { k, c } = K();
    return { wasmBytes: k.wasmMemoryBytes, liveShapes: k.liveShapes, bodies: c.ids().length };
  },
};

function transferables(v: unknown, out: Transferable[] = [], depth = 0): Transferable[] {
  if (depth > 6 || !v || typeof v !== "object") return out;
  if (ArrayBuffer.isView(v)) {
    if (!out.includes(v.buffer)) out.push(v.buffer as ArrayBuffer);
    return out;
  }
  for (const x of Array.isArray(v) ? v : Object.values(v)) transferables(x, out, depth + 1);
  return out;
}

self.onmessage = async (ev: MessageEvent<EngineRequest>) => {
  const { id, op, args } = ev.data;
  let res: EngineResponse;
  try {
    let result: unknown;
    if (op === "init") {
      const t0 = performance.now();
      kernel?.dispose();
      kernel = await OcctSolidKernel.create({ wasm: (args as { wasm: ArrayBuffer }).wasm });
      parts = new PartEvaluator(kernel);
      previewParts = new PartEvaluator(kernel);
      cache = new BodyCache(kernel, parts);
      result = { kernel: kernel.name, ms: performance.now() - t0 };
    } else {
      result = (api[op as Exclude<typeof op, "init">] as (a: unknown) => unknown)(args);
    }
    res = { id, ok: true, result };
    self.postMessage(res, transferables(result));
    return;
  } catch (e) {
    const err = e as Error & { details?: string[] };
    res = { id, ok: false, error: err.message || String(e), details: err.details };
  }
  self.postMessage(res);
};
