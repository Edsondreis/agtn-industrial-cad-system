/// <reference lib="webworker" />
/**
 * Worker do motor 3D: todo cálculo B-Rep (OCCT/WASM) acontece aqui, fora da thread da interface,
 * para a navegação do viewport nunca travar durante uma regeneração.
 */
import { BodyCache, type Model3D, modelToStepTree, partOf, worldMatrix } from "@agtn/model3d";
import { type SheetState, createSheetBackend, edgeFromFaces } from "@agtn/sheet3d";
import { type Loop2, flatPattern, genericOpReason, sheetMath as SM } from "@agtn/sheetgraph";
import { OcctSolidKernel, PartEvaluator, type PartResult, SolidError, type SolidRef, invertRigid } from "@agtn/solid";
import type { ShapeHandle } from "occt-wasm";
import type { BodyGeom, EngineApi, EngineRequest, EngineResponse, SheetInfo, TopoRefMsg } from "./protocol";

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

/** Resumo serializável da chapa para a interface (planificação lida do MESMO grafo). */
function sheetInfo(sh: NonNullable<PartResult["sheet"]>): SheetInfo {
  const st = sh.state as SheetState;
  const sv = st.solved;
  const reason = genericOpReason(sh.generic);
  const root = sv.flanges.find((f) => f.id === sv.root)!;
  return {
    feature: sh.feature,
    generic: sh.generic,
    T: sv.T,
    volume: sv.volume,
    flatArea: sv.flatArea,
    flat: flatPattern(sv, reason ? [reason] : []),
    flanges: sv.flanges.map((f) => ({ id: f.id, label: f.label, area: f.area })),
    corners: (sv.corners ?? []).map((c) => ({ id: c.id, label: `${sv.bends.find((b) => b.id === c.a)?.label ?? c.a} × ${sv.bends.find((b) => b.id === c.b)?.label ?? c.b}`, angleDeg: c.angleDeg, kind: c.kind })),
    flatFrame: root.G,
    faceLabels: st.faceLabels,
    ms: st.ms,
  };
}
const sheetsOf = (r: Record<string, NonNullable<PartResult["sheet"]>>) => Object.fromEntries(Object.entries(r).map(([id, sh]) => [id, sheetInfo(sh)]));

/** Operações síncronas (o `init`, assíncrono, é tratado no onmessage). */
const api: Omit<EngineApi, "init"> = {
  sync({ model, full }) {
    const { c } = K();
    if (full) c.clear();
    const t0 = performance.now();
    lastModel = model;
    const r = c.sync(model);
    const built = r.built.map((id) => geomOf(id, c.get(id)!));
    return { built, removed: r.removed, errors: r.errors, ms: performance.now() - t0, features: r.features, frames: r.frames, empty: r.empty, partial: r.partial, sheets: sheetsOf(r.sheets) };
  },
  identify({ body, kind, index, model }) {
    const m = model ?? lastModel;
    if (!m || !parts) throw new SolidError("NOT_READY", "Modelo ainda não sincronizado.");
    const { part } = partOf(m, body);
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
          const tb = model.nodes[id];
          if (!tb) return null;
          const bad = c.partialOf(id);
          const t = c.get(id);
          // mesma regra da regeneração: ferramenta com erro não entra com o último sólido válido
          if (bad) return { sig: `${t ?? "∅"}`, shape: null, error: `${tb.name} › ${bad.name} falhou` };
          if (t === undefined) return { sig: "∅", shape: null, error: `${tb.name} não tem sólido` };
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
      return { geom, status: res.status, frames: res.frames, ms: performance.now() - t0, failed: res.failed, sheet: res.sheet ? sheetInfo(res.sheet) : null };
    } finally {
      for (const t of tmp) k.release(t);
    }
  },
  sheetEdge({ body, index }) {
    const { k, c } = K();
    const sh = c.sheetOf(body);
    if (!sh) throw new SolidError("INVALID_PARAMS", "Este corpo não é uma peça de chapa.");
    if (sh.generic.length) throw new SolidError("INVALID_PARAMS", `A peça tem operações sólidas depois da chapa (${sh.generic.join(", ")}) — arestas de chapa não podem mais ser escolhidas.`);
    const st = sh.state as SheetState;
    const raw = k.raw;
    const ref = refOf({ body, kind: "edge", index }) as unknown as ShapeHandle;
    const tmp: ShapeHandle[] = [];
    const T = <H extends ShapeHandle>(h: H) => (tmp.push(h), h);
    try {
      const edges = raw.getSubShapes(ref, "edge").map(T);
      const e = edges[index];
      if (!e) throw new SolidError("INVALID_PARAMS", "Aresta não encontrada.");
      const faces = raw.getSubShapes(ref, "face").map(T);
      const owners = faces.map((f, i) => [f, i] as const).filter(([f]) => raw.getSubShapes(f, "edge").map(T).some((x) => raw.isSame(x, e)));
      if (owners.length !== 2) throw new SolidError("INVALID_PARAMS", "Escolha uma aresta de borda de uma aba.");
      const r = edgeFromFaces(st.faceLabels[owners[0][1]] ?? [], st.faceLabels[owners[1][1]] ?? []);
      if (r === "ambigua") throw new SolidError("INVALID_PARAMS", "Aresta ambígua — escolha a aresta na borda da face da aba.");
      if (!r) throw new SolidError("INVALID_PARAMS", "Essa aresta não é borda de aba (escolha a aresta na ponta ou no lado de uma face plana da chapa).");
      if (r.edge.includes("^") || r.edge.includes(">"))
        throw new SolidError("INVALID_PARAMS", "Essa aresta é a linha de tangência ou o degrau de uma dobra parcial — escolha uma borda livre da aba.");
      const fl = st.solved.flanges.find((f) => f.id === r.flange)!;
      const ol = fl.outline.find((x) => x.key === r.edge);
      const bent = st.solved.bends.find((b) => b.parent === r.flange && b.edge === r.edge)?.label ?? null;
      const hint = ol ? { a: SM.apply(fl.G, SM.v3(ol.a.x, ol.a.y, 0)), b: SM.apply(fl.G, SM.v3(ol.b.x, ol.b.y, 0)) } : undefined;
      return { flange: r.flange, edge: r.edge, ...(hint ? { hint } : {}), label: `${fl.label} · ${r.edge}`, bent };
    } finally {
      for (const h of tmp)
        try {
          raw.release(h);
        } catch {
          /* */
        }
    }
  },
  sheetFlat({ body, model }) {
    const { k, c } = K();
    const sh = c.sheetOf(body);
    if (!sh) throw new SolidError("INVALID_PARAMS", "Este corpo não é uma peça de chapa.");
    const info = sheetInfo(sh);
    const fp = info.flat;
    if (fp.state !== "valida") throw new SolidError("INVALID_PARAMS", `Planificação inválida: ${fp.reasons.join(" ")}`);
    const m = model ?? lastModel;
    if (!m) throw new SolidError("NOT_READY", "Modelo ainda não sincronizado.");
    const W = SM.compose(worldMatrix(m, body) as number[], info.flatFrame);
    const raw = k.raw;
    const tmp: ShapeHandle[] = [];
    const T = <H extends ShapeHandle>(h: H) => (tmp.push(h), h);
    const P = (p: { x: number; y: number }, z = 0) => SM.apply(W, SM.v3(p.x, p.y, z));
    try {
      // contorno com bulges (arcos dos alívios): arco pelo ponto médio exato
      const wireOf = (pts: readonly { x: number; y: number }[], bulges: readonly number[] = []) =>
        T(
          raw.makeWire(
            pts.map((p, i) => {
              const q = pts[(i + 1) % pts.length];
              const bu = bulges[i] ?? 0;
              if (Math.abs(bu) < 1e-15) return T(raw.makeLineEdge(P(p), P(q)));
              // ponto médio do arco: sagita = bulge · corda/2, à DIREITA do percurso se bulge > 0 (anti-horário)
              const mx = (p.x + q.x) / 2;
              const my = (p.y + q.y) / 2;
              const dx = q.x - p.x;
              const dy = q.y - p.y;
              const s = (bu * Math.hypot(dx, dy)) / 2;
              const L = Math.hypot(dx, dy);
              const mid = { x: mx + (dy / L) * s, y: my - (dx / L) * s };
              return T(raw.makeArcEdge(P(p), P(mid), P(q)));
            }),
          ),
        );
      const loopWire = (l: Loop2) =>
        T(
          raw.makeWire(
            l.segs.map((sg) => {
              if (sg.t === "line") return T(raw.makeLineEdge(P(sg.a), P(sg.b)));
              if (sg.t === "circle") return T(raw.makeCircleEdge(P(sg.c), SM.applyDir(W, SM.v3(0, 0, 1)), sg.r));
              const a0 = Math.atan2(sg.a.y - sg.c.y, sg.a.x - sg.c.x) + sg.sweep / 2;
              return T(raw.makeArcEdge(P(sg.a), P({ x: sg.c.x + sg.r * Math.cos(a0), y: sg.c.y + sg.r * Math.sin(a0) }), P(sg.b)));
            }),
          ),
        );
      const outer = fp.cut[0];
      let face = T(raw.makeFace(wireOf(outer, fp.cutBulges[0])));
      const inner = [...fp.cut.slice(1).map((l, i) => wireOf(l, fp.cutBulges[i + 1])), ...fp.holes.map(loopWire)];
      if (inner.length) face = T(raw.addHolesInFace(face, inner));
      const z = SM.applyDir(W, SM.v3(0, 0, info.T));
      const solid = raw.extrude(face, z.x, z.y, z.z);
      const vol = raw.getVolume(solid);
      if (Math.abs(vol - info.T * fp.area) > 1e-9 * Math.max(1, vol)) {
        raw.release(solid);
        throw new SolidError("KERNEL", `Planificação: volume ${vol} ≠ T × área ${info.T * fp.area}.`);
      }
      const ref = solid as unknown as SolidRef;
      try {
        const geom = geomOf(body, ref);
        const seg = (arr: number[], s: readonly [{ x: number; y: number }, { x: number; y: number }]) => {
          for (const q of s) {
            const p = P(q, info.T * 1.001);
            arr.push(p.x, p.y, p.z);
          }
        };
        const bl: number[] = [];
        const rl: number[] = [];
        for (const b of fp.bends) {
          seg(bl, b.line);
          seg(rl, b.start);
          seg(rl, b.end);
        }
        return { geom, bendLines: new Float32Array(bl), regionLines: new Float32Array(rl) };
      } finally {
        k.release(ref);
      }
    } finally {
      for (const h of tmp)
        try {
          raw.release(h);
        } catch {
          /* */
        }
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
      parts = new PartEvaluator(kernel, createSheetBackend());
      previewParts = new PartEvaluator(kernel, createSheetBackend());
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
    res = { id, ok: false, error: err.message || String(e), details: err.details, errorName: err.name, stage: op === "init" ? "init" : "sync" };
  }
  self.postMessage(res);
};
