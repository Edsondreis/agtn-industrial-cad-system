import "./ws3d.css";
import {
  type Model3D,
  type NodeId,
  addBody,
  addGroup,
  bodies,
  commitModel,
  duplicate,
  getModel,
  groupNodes,
  insertStepTree,
  isShown,
  remove,
  rename,
  setColor,
  setMaterial,
  setPlacement,
  setPrimitive,
  setVisible,
  addFeature,
  convertToPart,
  newPart,
  nextFeatureName,
  removeFeature,
  renameFeature,
  setRollback,
  setSuppressed,
  updateFeature,
} from "@agtn/model3d";
import { emptySketch } from "@agtn/sketch";
import {
  type FaceRef,
  type FeatId,
  type Feature,
  type FeatureDraft,
  type FeatureKind,
  type FeatureStatus,
  type Frame,
  type PlaneRef,
  type PrimitiveKind,
  type PrimitiveSpec,
  type StdPlane,
  FEATURE_LABEL,
  PRIMITIVE_LABEL,
} from "@agtn/solid";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CadController } from "../cad/controller";
import { baseName, pickAndRead, pickSavePath, writeBytes, writeText } from "../platform/platform";
import { Icon } from "../ui/Icons";
import { toast } from "../ui/toast";
import { type CamState, STD_VIEWS, type StdView, initialCam } from "./camera";
import { engine } from "./engine";
import { DEFAULT_SPECS, PrimitiveDialog } from "./PrimitiveDialog";
import { Props3D } from "./Props3D";
import type { EngineStats, SyncResult, TopoRefMsg } from "./protocol";
import { type DisplayMode, FILTER_LABEL, type PickFilter, type Sel, Ws3dStore } from "./store";
import { Tree3D } from "./Tree3D";
import { ViewCube } from "./ViewCube";
import { type FeatAction } from "./Tree3D";
import { FeatureDialog, type PickSlot } from "./part/FeatureDialog";
import { FeatureProps } from "./part/FeatureProps";
import { DRAFT_ID, type PartSource, PLANE_LABEL, defaultDraft, isPart, partSrc, sketchesBefore, stdFrame, withDraft, worldFrame } from "./part/partUi";
import { SketchEditor } from "./sketch/editor";
import { DimInput, SketchBar } from "./sketch/SketchBar";
import { Viewport3D, fmt } from "./viewport";

const PRIMS: [PrimitiveKind, string, string][] = [
  ["box", "box3d", "Caixa"],
  ["cylinder", "cyl3d", "Cilindro"],
  ["sphere", "sphere3d", "Esfera"],
  ["cone", "cone3d", "Cone"],
  ["torus", "torus3d", "Toro"],
  ["plane", "plane3d", "Plano"],
  ["tube", "tube3d", "Tubo"],
  ["profile", "beam3d", "Perfil"],
];
const MODES: [DisplayMode, string, string][] = [
  ["sombreado-arestas", "shadedEdges", "Sombreado com arestas"],
  ["sombreado", "shaded", "Sombreado"],
  ["arame", "wire", "Estrutura de arame"],
];
const FILTERS: [PickFilter, string][] = [
  ["auto", "pick"],
  ["corpo", "cube3d"],
  ["face", "face3d"],
  ["aresta", "edge3d"],
  ["vertice", "vertex"],
];

type EngineState = { s: "off" } | { s: "loading" } | { s: "ready"; kernel: string; ms: number } | { s: "error"; msg: string };

/** Esboço em edição: plano, editor e a peça de destino (null = nova peça ao concluir). */
interface SketchSess {
  body: NodeId | null;
  feat: FeatId | null;
  plane: PlaneRef;
  editor: SketchEditor;
  name: string;
  /** primitiva convertida em peça só ao concluir (mesmos ids de referência) */
  base: PartSource | null;
}
/** Operação em edição no painel. */
interface FeatSess {
  body: NodeId;
  editing: FeatId | null;
  at: number;
  initial: FeatureDraft;
  name: string;
  key: number;
}
type Tab = "modelar" | "corpos";

const withSource = (m: Model3D, id: NodeId, source: PartSource): Model3D => ({ ...m, nodes: { ...m.nodes, [id]: { ...(m.nodes[id] as Extract<Model3D["nodes"][string], { kind: "body" }>), source } } });

const SOLID_OPS: [FeatureKind, string, string, string][] = [
  ["extrude", "extrude3d", "Extrusão", "Extrusão de esboço (unir, cortar, interseção)"],
  ["revolve", "revolve3d", "Revolução", "Revolução de esboço em torno de uma linha"],
  ["sweep", "sweep3d", "Varredura", "Perfil ao longo de uma trajetória (sweep)"],
  ["loft", "loft3d", "Loft", "Transição entre seções de esboços"],
  ["hole", "hole3d", "Furo", "Furos nos pontos/círculos de um esboço (passante, rebaixo, escareado)"],
];
const MOD_OPS: [FeatureKind, string, string, string][] = [
  ["fillet", "fillet3d", "Arredondar", "Arredondamento (fillet) de arestas"],
  ["chamfer", "chamfer3d", "Chanfro", "Chanfro de arestas"],
  ["shell", "shell3d", "Casca", "Casca: remove faces e deixa parede"],
];

const topoMsg = (s: Sel): TopoRefMsg | null => (s.t === "topo" ? { body: s.body, kind: s.kind, index: s.index } : null);

/**
 * Área de trabalho AGTN 3D: faixa de ferramentas, árvore de componentes, viewport, propriedades e status.
 * O modelo vive no CadDocument (Undo/Redo e .agtncad); o motor OCCT roda num worker.
 */
export function Workspace3D({ ctl }: { ctl: CadController }) {
  const doc = ctl.doc;
  const store = useMemo(() => new Ws3dStore(), []);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [model, setModel] = useState<Model3D>(() => getModel(doc));
  const [eng, setEng] = useState<EngineState>({ s: "off" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { kind: "create"; prim: PrimitiveKind } | { kind: "featPrim"; body: NodeId; feat: FeatId; spec: PrimitiveSpec }>(null);
  const [fstat, setFstat] = useState<Record<NodeId, readonly FeatureStatus[]>>({});
  /** peças cuja árvore tem falha: o viewport mostra o último sólido válido — a interface diz isso */
  const [partial, setPartial] = useState<SyncResult["partial"]>({});
  const [frames, setFrames] = useState<Record<NodeId, Readonly<Record<string, Frame>>>>({});
  const [fsel, setFsel] = useState<{ body: NodeId; id: FeatId } | null>(null);
  const [sk, setSk] = useState<SketchSess | null>(null);
  const [fd, setFd] = useState<FeatSess | null>(null);
  const [planeAsk, setPlaneAsk] = useState<{ body: NodeId | null; offset: number } | null>(null);
  const [tab, setTab] = useState<Tab>("modelar");
  const [cam, setCam] = useState<CamState>(initialCam);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [syncMs, setSyncMs] = useState(0);
  const [, setGeomRev] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const vp = useRef<Viewport3D | null>(null);
  const firstFit = useRef(true);
  /** o viewport desta montagem ainda não recebeu nenhuma geometria → o próximo sync é completo */
  const needFull = useRef(true);
  const fdRef = useRef<FeatSess | null>(null);
  fdRef.current = fd;
  const skRef = useRef<SketchSess | null>(null);
  skRef.current = sk;
  const fstatRef = useRef(fstat);
  fstatRef.current = fstat;
  const prevFilter = useRef<PickFilter>("auto");
  const featErrs = useRef(new Set<string>());

  /** Modelo exibido: ao editar uma operação, a peça aparece recuada até ela (as referências vêm desse estado). */
  const display = useMemo(() => {
    let m = model;
    if (sk?.base && sk.body && !isPart(m, sk.body)) m = withSource(m, sk.body, sk.base);
    const edit = sk?.feat && sk.body ? { body: sk.body, id: sk.feat } : fd?.editing ? { body: fd.body, id: fd.editing } : null;
    if (!edit || !isPart(m, edit.body)) return m;
    const i = partSrc(m, edit.body)!.features.findIndex((f) => f.id === edit.id);
    return i < 0 ? m : setRollback(m, edit.body, i);
  }, [model, sk, fd]);
  const displayRef = useRef(display);
  displayRef.current = display;

  /* ------------------------------------------------ documento → modelo (inclusive Undo/Redo) */
  useEffect(() => doc.subscribe(() => setModel(getModel(doc))), [doc]);

  /* ------------------------------------------------ viewport */
  useEffect(() => {
    if (!host.current) return;
    const v = new Viewport3D(host.current, store);
    vp.current = v;
    const off = v.onCamera((c) => setCam(c));
    // gancho para os testes de ponta a ponta (só em desenvolvimento ou com a flag de teste)
    if (import.meta.env.DEV || localStorage.getItem("agtn.e2e") === "1") (window as unknown as { __agtn3d?: unknown }).__agtn3d = {
        vp: v,
        store,
        doc,
        model: () => getModel(doc),
        sketch: () => skRef.current?.editor ?? null,
        status: () => fstatRef.current,
      };
    return () => {
      off();
      v.dispose();
      vp.current = null;
    };
  }, [store]);

  /* ------------------------------------------------ motor */
  useEffect(() => {
    let dead = false;
    setEng({ s: "loading" });
    engine()
      .start()
      .then((r) => !dead && setEng({ s: "ready", kernel: r.kernel, ms: engine().initMs }))
      .catch((e: Error) => !dead && setEng({ s: "error", msg: e.message }));
    return () => {
      dead = true;
      // fora da área 3D o motor é liberado após 2 min (memória para o 2D/CNC); voltar reinicia em ~0,5 s
      const ms = Number(localStorage.getItem("agtn.engineIdleMs")) || 120_000;
      engine().releaseLater(ms);
    };
  }, []);

  // modelo → motor → viewport (regeneração incremental, coalescida).
  // Resultados NUNCA são descartados: cada um traz geometria que o worker não reenviará.
  useEffect(() => {
    if (eng.s !== "ready") return;
    vp.current?.applyModel(display);
    const full = needFull.current;
    void engine()
      .sync(display, full)
      .then((r) => {
        const v = vp.current;
        if (!r || !v) return;
        needFull.current = false;
        const latest = displayRef.current;
        v.applySync(r);
        v.applyModel(latest);
        setErrors(r.errors);
        setFstat((prev) => {
          const next = { ...prev, ...r.features };
          for (const id of r.removed) delete next[id];
          return next;
        });
        setPartial(r.partial);
        setFrames((prev) => {
          const next = { ...prev, ...r.frames };
          for (const id of r.removed) delete next[id];
          return next;
        });
        // avisa uma vez cada operação que passou a falhar (nunca troca de face/aresta em silêncio)
        for (const [bid, list] of Object.entries(r.features)) {
          const feats = partSrc(latest, bid)?.features ?? [];
          const now = new Set(list.filter((x) => x.state === "error").map((x) => `${bid}:${x.id}:${x.error ?? ""}`));
          for (const k of [...featErrs.current]) if (k.startsWith(`${bid}:`) && !now.has(k)) featErrs.current.delete(k);
          for (const st of list) {
            const key = `${bid}:${st.id}:${st.error ?? ""}`;
            if (st.state === "error" && !featErrs.current.has(key)) {
              featErrs.current.add(key);
              toast(`${latest.nodes[bid]?.name ?? "Peça"} › ${feats.find((f) => f.id === st.id)?.name ?? st.id}: ${st.error}`, "error");
            }
          }
        }
        setSyncMs(r.ms);
        setGeomRev((x) => x + 1);
        const errs = Object.entries(r.errors);
        if (errs.length) toast(`${latest.nodes[errs[0][0]]?.name ?? "Corpo"}: ${errs[0][1]}`, "error");
        if (firstFit.current && v.hasBodies()) {
          firstFit.current = false;
          v.fit();
        }
        void engine().call("stats", {}).then(setStats).catch(() => undefined);
      })
      .catch((e: Error) => toast(`Motor 3D: ${e.message}`, "error"));
  }, [display, eng.s, doc]);

  // seleção → informação exata / medição (sempre pelo kernel)
  useEffect(() => {
    if (eng.s !== "ready") return;
    const s = snap.sel;
    let dead = false;
    if (s.length === 1 && s[0].t === "topo" && !snap.measuring) {
      const t = topoMsg(s[0])!;
      void engine()
        .call("info", t)
        .then((info) => !dead && store.set({ info: { sel: s[0], info } }))
        .catch((e: Error) => toast(e.message, "error"));
    } else if (s.length === 2) {
      const ref = (x: Sel): TopoRefMsg | null => {
        if (x.t === "topo") return topoMsg(x);
        return model.nodes[x.id]?.kind === "body" ? { body: x.id, kind: "solid", index: 0 } : null;
      };
      const a = ref(s[0]);
      const b = ref(s[1]);
      if (!a || !b) {
        if (snap.measuring) toast("Conjuntos não são medidos diretamente — escolha corpos, faces, arestas ou vértices.", "warn");
        return;
      }
      void engine()
        .call("measure", { a, b })
        .then((m) => !dead && store.set({ measure: { a: s[0], b: s[1], m } }))
        .catch((e: Error) => toast(e.message, "error"));
    }
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.sel, snap.measuring, eng.s]);

  /* ------------------------------------------------ edição (sempre transação no documento) */
  const commit = useCallback(
    (label: string, f: (m: Model3D) => Model3D) => {
      try {
        commitModel(doc, label, f(getModel(doc)));
        return null;
      } catch (e) {
        const msg = (e as Error).message;
        toast(msg, "error");
        return msg;
      }
    },
    [doc],
  );
  const selectedNodes = () => store.nodes.filter((id) => model.nodes[id]);
  const targetGroup = (): NodeId | null => {
    const n = selectedNodes().map((id) => model.nodes[id]);
    if (n.length === 1) return n[0].kind === "group" ? n[0].id : n[0].parent;
    return null;
  };

  const create = (kind: PrimitiveKind) => setDialog({ kind: "create", prim: kind });
  const newGroup = () => {
    let id: NodeId = "";
    commit("Novo conjunto", (m) => {
      const r = addGroup(m, { parent: targetGroup() });
      id = r.id;
      return r.model;
    });
    if (id) store.pick({ t: "node", id }, false);
  };
  const groupSel = () => {
    const ids = selectedNodes();
    if (!ids.length) return toast("Selecione na árvore os itens a agrupar.", "warn");
    let id: NodeId = "";
    if (!commit("Agrupar", (m) => {
      const r = groupNodes(m, ids);
      id = r.id;
      return r.model;
    }))
      store.pick({ t: "node", id }, false);
  };
  const dup = () => {
    const ids = selectedNodes();
    if (ids.length !== 1) return toast("Selecione um item para duplicar.", "warn");
    let id: NodeId = "";
    const n = model.nodes[ids[0]];
    const g = vp.current?.geom(ids[0]);
    const dx = g ? Math.ceil((g.props.bbox.max.x - g.props.bbox.min.x) * 1.2) : 100;
    if (!commit(`Duplicar ${n.name}`, (m) => {
      const r = duplicate(m, ids[0], { x: n.kind === "body" ? dx : 0, y: n.kind === "group" ? 500 : 0, z: 0 });
      id = r.id;
      return r.model;
    }))
      store.pick({ t: "node", id }, false);
  };
  const del = () => {
    const ids = selectedNodes();
    if (!ids.length) return;
    const names = ids.map((id) => model.nodes[id]?.name).join(", ");
    if (!commit(ids.length === 1 ? `Excluir ${names}` : `Excluir ${ids.length} itens`, (m) => remove(m, ids))) {
      store.set({ sel: [], measure: null, info: null, hover: null });
      toast(`Excluído: ${names} (Ctrl+Z desfaz)`, "ok");
    }
  };
  const hideSel = (v: boolean) => {
    const ids = selectedNodes();
    if (ids.length) commit(v ? "Exibir" : "Ocultar", (m) => setVisible(m, ids, v));
  };
  const showAll = () => {
    const hidden = Object.values(model.nodes).filter((n) => !n.visible).map((n) => n.id);
    if (hidden.length) commit("Exibir tudo", (m) => setVisible(m, hidden, true));
  };

  /* ------------------------------------------------ peça paramétrica: esboços e operações */

  /** Peça ativa: corpo selecionado (peça ou primitiva) ou a única peça do modelo. */
  const activeBody = (): NodeId | null => {
    if (fsel && model.nodes[fsel.body]) return fsel.body;
    for (const x of snap.sel) {
      const id = x.t === "node" ? x.id : x.body;
      const n = model.nodes[id];
      if (n?.kind === "body" && (n.source.type === "part" || n.source.type === "primitive")) return id;
    }
    const parts = bodies(model).filter((b) => b.source.type === "part");
    return parts.length === 1 ? parts[0].id : null;
  };
  /** Prepara a fonte "peça" de um corpo (primitiva → peça com Base_1), sem gravar. */
  const prepared = (m: Model3D, id: NodeId | null): { m: Model3D; base: PartSource | null } => {
    if (!id || isPart(m, id)) return { m, base: null };
    const conv = convertToPart(m, id);
    const base = partSrc(conv, id)!;
    return { m: conv, base };
  };

  /** Plano do esboço em coordenadas do mundo (faces: resolvido pelo kernel com a referência estável). */
  const frameFor = async (m: Model3D, body: NodeId | null, plane: PlaneRef, featId: FeatId | null): Promise<Frame> => {
    if (plane.t === "std") return worldFrame(m, body, stdFrame(plane.plane, plane.offset));
    if (!body) throw new Error("Face sem corpo.");
    const part = partSrc(m, body)!;
    const at = featId ? part.features.findIndex((f) => f.id === featId) : (part.rollback ?? part.features.length);
    const feats = withDraft(part.features, at, featId, { t: "sketch", plane, sketch: emptySketch() }, "tmp");
    const r = await engine().call("preview", { model: m, body, features: feats, rollback: at + 1 });
    const id = featId ?? DRAFT_ID;
    const local = r.frames[id];
    if (!local) throw new Error(r.status.find((x) => x.id === id)?.error ?? "Não foi possível obter o plano da face.");
    return worldFrame(m, body, local);
  };

  const openSketch = async (body: NodeId | null, plane: PlaneRef, featId: FeatId | null, sketch = emptySketch(), name?: string, prep?: { m: Model3D; base: PartSource | null }) => {
    const v = vp.current;
    if (!v) return;
    const { m, base } = prep ?? prepared(featId ? displayRef.current : getModel(doc), body);
    try {
      const frame = await frameFor(m, body, plane, featId);
      const editor = new SketchEditor(sketch);
      const part = body ? partSrc(m, body) : null;
      const nm = name ?? nextFeatureName(part?.features ?? [], "sketch");
      setFd(null);
      setPlaneAsk(null);
      store.set({ sel: [], hover: null, info: null, measure: null, measuring: false });
      setSk({ body, feat: featId, plane, editor, name: nm, base });
      v.setSketch(frame, editor);
    } catch (e) {
      toast(`Esboço: ${(e as Error).message}`, "error");
    }
  };

  const startSketch = async () => {
    if (sk) return;
    const face = snap.sel.find((x): x is Extract<Sel, { t: "topo" }> => x.t === "topo" && x.kind === "face");
    if (face) {
      const n = model.nodes[face.body];
      if (n?.kind !== "body" || n.source.type === "brep") return toast("Esboço em face: use uma peça paramétrica ou primitiva (sólido importado não tem histórico).", "warn");
      const prep = prepared(model, face.body);
      try {
        const ref = (await engine().call("identify", { body: face.body, kind: "face", index: face.index, model: prep.m })) as FaceRef;
        await openSketch(face.body, { t: "face", face: ref, offset: 0 }, null, emptySketch(), undefined, prep);
      } catch (e) {
        toast(`Esboço na face: ${(e as Error).message}`, "error");
      }
      return;
    }
    setPlaneAsk({ body: activeBody(), offset: 0 });
  };

  const closeSketch = () => {
    vp.current?.setSketch(null);
    setSk(null);
  };
  const finishSketch = () => {
    const s = sk;
    if (!s) return;
    const sketch = s.editor.sketch;
    let body = s.body;
    let id: FeatId | null = s.feat;
    const err = commit(s.feat ? `Editar ${s.name}` : `Novo esboço ${s.name}`, (m) => {
      let mm = m;
      if (!body) {
        const r = newPart(mm, { parent: null });
        mm = r.model;
        body = r.id;
      } else if (!isPart(mm, body)) {
        if (!s.base) throw new Error("O corpo não é uma peça paramétrica.");
        mm = withSource(mm, body, s.base);
      }
      if (s.feat) return updateFeature(mm, body, s.feat, { t: "sketch", plane: s.plane, sketch });
      const r = addFeature(mm, body, { t: "sketch", plane: s.plane, sketch }, s.name);
      id = r.id;
      return r.model;
    });
    if (err) return;
    closeSketch();
    if (body && id) {
      store.pick({ t: "node", id: body }, false);
      setFsel({ body, id });
    }
    if (!s.body && bodies(getModel(doc)).length === 1) firstFit.current = true;
    toast(s.feat ? `${s.name} atualizado — a peça foi regenerada.` : `${s.name} concluído. Use Extrusão, Revolução ou Furo.`, "ok");
  };

  const closeFeature = () => {
    vp.current?.setPreview(null, null);
    store.set({ multi: false, filter: prevFilter.current, sel: [] });
    setFd(null);
  };
  const openFeature = (kind: FeatureKind, opts: { op?: "join" | "cut" | "intersect"; circular?: boolean } = {}) => {
    if (sk) return;
    let body = activeBody();
    if (!body) {
      if (kind === "combine") return toast("Selecione o corpo que recebe a operação.", "warn");
      return toast("Crie um esboço primeiro — a peça nasce do esboço (ou selecione uma primitiva).", "warn");
    }
    if (!isPart(model, body)) {
      const n = model.nodes[body];
      if (n?.kind !== "body" || n.source.type !== "primitive") return toast("Esta operação exige uma peça paramétrica.", "warn");
      if (commit(`Converter ${n.name} em peça`, (m) => convertToPart(m, body!))) return;
    }
    const m = getModel(doc);
    const part = partSrc(m, body)!;
    const at = part.rollback ?? part.features.length;
    const selSketch = fsel && fsel.body === body ? part.features.find((f) => f.id === fsel.id && f.t === "sketch")?.id : undefined;
    let initial = defaultDraft(kind, part.features, at, { sketch: selSketch, op: opts.op });
    if (!initial) return;
    if (initial.t === "pattern" && opts.circular) initial = { ...initial, kind: "circular", dir: { t: "axis", a: "Z" } };
    if ((kind === "extrude" || kind === "revolve" || kind === "hole") && !sketchesBefore(part.features, at).length) return toast(`${FEATURE_LABEL[kind]}: crie um esboço antes.`, "warn");
    if ((kind === "sweep" || kind === "loft") && sketchesBefore(part.features, at).length < 2) return toast(`${FEATURE_LABEL[kind]} precisa de dois esboços.`, "warn");
    prevFilter.current = store.snap.filter === "aresta" || store.snap.filter === "face" ? "auto" : store.snap.filter;
    setFsel(null);
    // pré-seleção: só arestas/faces da própria peça seguem para a operação
    const b0 = body;
    store.set({ sel: store.snap.sel.filter((x) => x.t === "topo" && x.body === b0), info: null, measure: null });
    setFd({ body, editing: null, at, initial, name: nextFeatureName(part.features, kind), key: Date.now() });
  };
  const editFeature = (body: NodeId, id: FeatId) => {
    const part = partSrc(model, body);
    const i = part?.features.findIndex((f) => f.id === id) ?? -1;
    if (!part || i < 0) return;
    const f = part.features[i];
    if (f.t === "sketch") return void openSketch(body, f.plane, f.id, f.sketch, f.name);
    if (f.t === "primitive") return setDialog({ kind: "featPrim", body, feat: f.id, spec: f.spec });
    const { id: _i, name: _n, suppressed: _s, ...draft } = f;
    void _i;
    void _n;
    void _s;
    prevFilter.current = store.snap.filter === "aresta" || store.snap.filter === "face" ? "auto" : store.snap.filter;
    store.set({ sel: [] });
    setFd({ body, editing: id, at: i, initial: draft as FeatureDraft, name: f.name, key: Date.now() });
  };
  const featureAct = (body: NodeId, id: FeatId, a: FeatAction) => {
    const part = partSrc(model, body);
    const i = part?.features.findIndex((f) => f.id === id) ?? -1;
    if (!part || i < 0) return;
    const f = part.features[i];
    if (a === "edit") return editFeature(body, id);
    if (a === "suppress") return void commit(f.suppressed ? `Reativar ${f.name}` : `Suprimir ${f.name}`, (m) => setSuppressed(m, body, id, !f.suppressed));
    if (a === "rollback") return void commit(part.rollback === i ? "Avançar ao fim" : `Recuar até ${f.name}`, (m) => setRollback(m, body, part.rollback === i ? null : i));
    if (a === "delete") return deleteFeature(body, id, false);
  };
  const deleteFeature = (body: NodeId, id: FeatId, cascade: boolean) => {
    const f = partSrc(model, body)?.features.find((x) => x.id === id);
    if (!f) return;
    if (!commit(cascade ? `Excluir ${f.name} e dependentes` : `Excluir ${f.name}`, (m) => removeFeature(m, body, id, cascade))) {
      setFsel(null);
      toast(`Excluído: ${f.name} (Ctrl+Z desfaz)`, "ok");
    }
  };

  /** Prévia real da operação em edição (o documento não muda). */
  const runPreview = async (features: Feature[]) => {
    const s = fdRef.current;
    const v = vp.current;
    if (!s || !v) return null;
    if (!features.length) {
      v.setPreview(null, null);
      return null;
    }
    const part = partSrc(getModel(doc), s.body);
    if (!part) return null;
    const rb = s.editing ? part.rollback : part.rollback === null ? null : part.rollback + 1;
    const r = await engine().call("preview", { model: getModel(doc), body: s.body, features, rollback: rb });
    if (fdRef.current?.key !== s.key) return null;
    v.setPreview(s.body, r.geom, "replace");
    return r;
  };
  const featureOk = (draft: FeatureDraft, name: string): string | null => {
    const s = fd;
    if (!s) return null;
    let id: FeatId | null = s.editing;
    const old = s.editing ? partSrc(model, s.body)?.features.find((f) => f.id === s.editing) : undefined;
    const err = commit(s.editing ? `Editar ${old?.name ?? name}` : `${FEATURE_LABEL[draft.t]} ${name}`, (m) => {
      let mm: Model3D;
      if (s.editing) {
        mm = updateFeature(m, s.body, s.editing, draft);
        if (old && name.trim() && name !== old.name) mm = renameFeature(mm, s.body, s.editing, name);
      } else {
        const r = addFeature(m, s.body, draft, name);
        id = r.id;
        mm = r.model;
      }
      if (draft.t === "combine") mm = setVisible(mm, draft.tools, false);
      return mm;
    });
    if (err) return err;
    const body = s.body;
    closeFeature();
    store.pick({ t: "node", id: body }, false);
    if (id) setFsel({ body, id });
    return null;
  };
  const onPick = (slot: PickSlot) => {
    if (!fdRef.current) return;
    const filter: PickFilter = slot === "edges" ? "aresta" : slot === "faces" || slot === "plane" ? "face" : slot === "dir" ? "auto" : prevFilter.current;
    store.set({ filter, multi: slot === "edges" || slot === "faces" });
  };

  // a seleção saiu da peça → a operação deixa de estar selecionada
  useEffect(() => {
    if (fsel && !snap.sel.some((x) => (x.t === "node" ? x.id : x.body) === fsel.body)) setFsel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.sel]);

  const importStep = async () => {
    const f = await pickAndRead("step");
    if (!f) return;
    setBusy(`Importando ${f.name}…`);
    try {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(f.bytes);
      if (!/^\s*ISO-10303-21/.test(text)) throw new Error("O arquivo não é um STEP (ISO-10303-21).");
      const nodes = await engine().call("importStep", { text });
      let ids: NodeId[] = [];
      commit(`Importar ${f.name}`, (m) => {
        const r = insertStepTree(m, nodes, f.name, null);
        ids = r.ids;
        return r.model;
      });
      const count = nodes.reduce(function c(a: number, n: (typeof nodes)[number]): number {
        return a + (n.brep ? 1 : 0) + (n.children ?? []).reduce(c, 0);
      }, 0);
      toast(`${f.name}: ${count} sólido(s) importado(s) com nomes e estrutura.`, "ok");
      firstFit.current = true;
      if (ids.length) store.pick({ t: "node", id: ids[0] }, false);
    } catch (e) {
      toast(`Falha ao importar STEP: ${(e as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  };
  const exportStep = async () => {
    if (!bodies(model).length) return toast("Não há corpos para exportar.", "warn");
    const ids = selectedNodes();
    const path = await pickSavePath("step", "modelo.step");
    if (!path) return;
    setBusy("Exportando STEP…");
    try {
      const text = await engine().call("exportStep", { model, ids: ids.length ? ids : undefined });
      await writeText(path, text);
      toast(`STEP gravado: ${baseName(path)}${ids.length ? " (seleção)" : ""}`, "ok");
    } catch (e) {
      toast(`Falha ao exportar STEP: ${(e as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  };
  const exportStl = async () => {
    const chosen = new Set(selectedNodes().flatMap((id) => bodies({ ...model, roots: [id] }).map((b) => b.id)));
    const ids = bodies(model)
      .filter((b) => (chosen.size ? chosen.has(b.id) : isShown(model, b.id)))
      .map((b) => b.id);
    if (!ids.length) return toast("Não há corpos visíveis para exportar.", "warn");
    const path = await pickSavePath("stl", "modelo.stl");
    if (!path) return;
    try {
      const bytes = await engine().call("exportStl", { ids });
      await writeBytes(path, bytes);
      toast(`STL gravado: ${baseName(path)} (malha triangulada — não é sólido CAD)`, "ok");
    } catch (e) {
      toast(`Falha ao exportar STL: ${(e as Error).message}`, "error");
    }
  };

  const toggleMeasure = () => {
    const on = !store.snap.measuring;
    store.set({ measuring: on, sel: [], measure: null, info: null, filter: on && store.snap.filter === "corpo" ? "auto" : store.snap.filter });
  };

  /* ------------------------------------------------ teclado (só quando a área 3D está ativa) */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (dialog || document.querySelector(".modal-bg")) return;
      if (sk || fd) return; // o esboço e o painel da operação tratam o próprio teclado
      if (planeAsk) {
        if (e.key === "Escape") setPlaneAsk(null);
        return;
      }
      if (fsel && e.key === "Delete") return deleteFeature(fsel.body, fsel.id, false);
      const v = vp.current;
      if (!v) return;
      const k = e.key;
      if (e.ctrlKey || e.metaKey) {
        if (k.toLowerCase() === "d") {
          e.preventDefault();
          dup();
        }
        if (k.toLowerCase() === "g") {
          e.preventDefault();
          groupSel();
        }
        return;
      }
      const views = Object.entries(STD_VIEWS).find(([, s]) => s.key === k);
      if (views && !e.altKey) return void v.view(views[0] as StdView);
      switch (k) {
        case "f":
        case "F":
          return v.fit(e.shiftKey);
        case "Home":
          return v.view("iso");
        case "Escape":
          if (store.snap.measuring) store.set({ measuring: false });
          store.set({ sel: [], measure: null, info: null });
          return;
        case "Delete":
          return del();
        case "h":
        case "H":
          return e.shiftKey ? showAll() : hideSel(false);
        case "m":
        case "M":
          return toggleMeasure();
        case "g":
        case "G":
          return store.set({ grid: !store.snap.grid });
        case "p":
        case "P":
          return store.set({ ortho: !store.snap.ortho });
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const sel1 = snap.sel.length === 1 ? snap.sel[0] : null;
  const nodeSelected = snap.sel.some((s) => s.t === "node");
  const v = vp.current;
  const engineLabel =
    eng.s === "ready" ? `${eng.kernel} · pronto em ${Math.round(eng.ms)} ms` : eng.s === "loading" ? "Iniciando motor 3D…" : eng.s === "error" ? "Motor 3D com erro" : "—";

  return (
    <div className="ws3d">
      {/* ------------------------------ faixa de ferramentas ------------------------------ */}
      {sk ? (
        <SketchBar editor={sk.editor} name={sk.name} onFinish={finishSketch} onCancel={closeSketch} onNormal={() => vp.current?.sketchNormal()} />
      ) : (
      <div className="rb" role="toolbar" aria-label="Ferramentas 3D">
        <div className="rb-tabs" role="tablist">
          <button role="tab" className={tab === "modelar" ? "on" : ""} aria-selected={tab === "modelar"} onClick={() => setTab("modelar")} data-tab="modelar">
            Modelar
          </button>
          <button role="tab" className={tab === "corpos" ? "on" : ""} aria-selected={tab === "corpos"} onClick={() => setTab("corpos")} data-tab="corpos">
            Corpos
          </button>
        </div>
        {tab === "modelar" ? (
          <>
            <div className="rb-grp">
              <div className="rb-btns">
                <button className="rb-btn" title="Novo esboço 2D — num plano XY/XZ/YZ ou na face plana selecionada" onClick={() => void startSketch()} disabled={eng.s !== "ready"} data-op="sketch">
                  <Icon name="sketch3d" />
                  <span>Esboço</span>
                </button>
              </div>
              <div className="rb-cap">ESBOÇO</div>
            </div>
            <div className="rb-grp">
              <div className="rb-btns">
                {SOLID_OPS.map(([k, ic, lb, tip]) => (
                  <button key={k} className="rb-btn" title={tip} onClick={() => openFeature(k)} disabled={eng.s !== "ready"} data-op={k}>
                    <Icon name={ic} />
                    <span>{lb}</span>
                  </button>
                ))}
              </div>
              <div className="rb-cap">CRIAR SÓLIDO</div>
            </div>
            <div className="rb-grp">
              <div className="rb-btns">
                {MOD_OPS.map(([k, ic, lb, tip]) => (
                  <button key={k} className="rb-btn" title={tip} onClick={() => openFeature(k)} disabled={eng.s !== "ready"} data-op={k}>
                    <Icon name={ic} />
                    <span>{lb}</span>
                  </button>
                ))}
              </div>
              <div className="rb-cap">MODIFICAR</div>
            </div>
            <div className="rb-grp">
              <div className="rb-btns">
                <button className="rb-btn" title="Espelhar operações ou o corpo inteiro" onClick={() => openFeature("mirror")} disabled={eng.s !== "ready"} data-op="mirror">
                  <Icon name="mirror3d" />
                  <span>Espelhar</span>
                </button>
                <button className="rb-btn" title="Padrão linear de operações" onClick={() => openFeature("pattern")} disabled={eng.s !== "ready"} data-op="pattern">
                  <Icon name="patlin3d" />
                  <span>Linear</span>
                </button>
                <button className="rb-btn" title="Padrão circular de operações" onClick={() => openFeature("pattern", { circular: true })} disabled={eng.s !== "ready"} data-op="patternc">
                  <Icon name="patcir3d" />
                  <span>Circular</span>
                </button>
              </div>
              <div className="rb-cap">PADRÕES</div>
            </div>
            <div className="rb-grp">
              <div className="rb-btns">
                {(
                  [
                    ["join", "union3d", "União"],
                    ["cut", "cut3d", "Corte"],
                    ["intersect", "intersect3d", "Interseção"],
                  ] as const
                ).map(([op, ic, lb]) => (
                  <button key={op} className="rb-btn" title={`${lb} com outros corpos (booleana editável)`} onClick={() => openFeature("combine", { op })} disabled={eng.s !== "ready"} data-op={`combine-${op}`}>
                    <Icon name={ic} />
                    <span>{lb}</span>
                  </button>
                ))}
              </div>
              <div className="rb-cap">COMBINAR CORPOS</div>
            </div>
          </>
        ) : (
          <>
        <div className="rb-grp">
          <div className="rb-btns">
            {PRIMS.map(([k, ic, lb]) => (
              <button key={k} className="rb-btn" title={`${PRIMITIVE_LABEL[k]} paramétrico`} onClick={() => create(k)} disabled={eng.s !== "ready"} data-prim={k}>
                <Icon name={ic} />
                <span>{lb}</span>
              </button>
            ))}
          </div>
          <div className="rb-cap">CRIAR</div>
        </div>
        <div className="rb-grp">
          <div className="rb-btns">
            <button className="rb-btn" title="Novo conjunto (montagem/subconjunto)" onClick={newGroup}>
              <Icon name="group3d" />
              <span>Conjunto</span>
            </button>
            <button className="rb-btn" title="Agrupar a seleção num conjunto (Ctrl+G)" onClick={groupSel} disabled={!nodeSelected}>
              <Icon name="layers" />
              <span>Agrupar</span>
            </button>
            <button className="rb-btn" title="Duplicar (Ctrl+D)" onClick={dup} disabled={!nodeSelected}>
              <Icon name="dup3d" />
              <span>Duplicar</span>
            </button>
            <button className="rb-btn" title="Excluir (Delete)" onClick={del} disabled={!nodeSelected}>
              <Icon name="trash" />
              <span>Excluir</span>
            </button>
          </div>
          <div className="rb-cap">MONTAGEM</div>
        </div>
        <div className="rb-grp">
          <div className="rb-btns">
            <button className="rb-btn" title="Importar STEP (.step/.stp) com montagem e nomes" onClick={() => void importStep()} disabled={eng.s !== "ready"}>
              <Icon name="stepIn" />
              <span>Importar</span>
            </button>
            <button className="rb-btn" title="Exportar STEP (sólidos exatos, AP214, mm)" onClick={() => void exportStep()} disabled={eng.s !== "ready"}>
              <Icon name="stepOut" />
              <span>STEP</span>
            </button>
            <button className="rb-btn" title="Exportar STL (malha para impressão 3D)" onClick={() => void exportStl()} disabled={eng.s !== "ready"}>
              <Icon name="export" />
              <span>STL</span>
            </button>
          </div>
          <div className="rb-cap">ARQUIVO 3D</div>
        </div>
          </>
        )}
        <div className="rb-grp">
          <div className="rb-btns">
            <button className={`rb-btn${snap.measuring ? " on" : ""}`} title="Medir distância, ângulo, comprimento (M)" onClick={toggleMeasure} aria-pressed={snap.measuring}>
              <Icon name="measure3d" />
              <span>Medir</span>
            </button>
            <div className="rb-seg" role="radiogroup" aria-label="Filtro de seleção">
              {FILTERS.map(([f, ic]) => (
                <button key={f} className={snap.filter === f ? "on" : ""} title={`Selecionar: ${FILTER_LABEL[f]}`} aria-checked={snap.filter === f} role="radio" onClick={() => store.set({ filter: f, sel: [], measure: null, info: null })}>
                  <Icon name={ic} />
                </button>
              ))}
            </div>
          </div>
          <div className="rb-cap">INSPECIONAR</div>
        </div>
        <div className="rb-grp">
          <div className="rb-btns">
            <div className="rb-seg" role="radiogroup" aria-label="Modo de exibição">
              {MODES.map(([m, ic, lb]) => (
                <button key={m} className={snap.mode === m ? "on" : ""} title={lb} role="radio" aria-checked={snap.mode === m} onClick={() => store.set({ mode: m })}>
                  <Icon name={ic} />
                </button>
              ))}
            </div>
            <button className={`rb-ibtn${snap.grid ? " on" : ""}`} title="Grade (G)" onClick={() => store.set({ grid: !snap.grid })}>
              <Icon name="grid3d" />
            </button>
            <button className={`rb-ibtn${snap.ortho ? "" : " on"}`} title={snap.ortho ? "Projeção ortográfica — clique para perspectiva (P)" : "Perspectiva — clique para ortográfica (P)"} onClick={() => store.set({ ortho: !snap.ortho })}>
              <Icon name="persp" />
            </button>
            <button className="rb-ibtn" title="Enquadrar tudo (F) · seleção (Shift+F)" onClick={() => v?.fit()}>
              <Icon name="fit3d" />
            </button>
          </div>
          <div className="rb-cap">EXIBIR</div>
        </div>
        {tab === "corpos" && (
        <div className="rb-grp views">
          <div className="rb-btns">
            {(Object.entries(STD_VIEWS) as [StdView, (typeof STD_VIEWS)[StdView]][]).map(([k, s]) => (
              <button key={k} className={`rb-view${snap.view === k ? " on" : ""}`} title={`${s.label} (${s.key})`} onClick={() => v?.view(k)}>
                {s.short}
              </button>
            ))}
          </div>
          <div className="rb-cap">VISTAS</div>
        </div>
        )}
      </div>
      )}

      {/* ------------------------------ corpo ------------------------------ */}
      <div className="w3">
        <aside className="w3-left">
          <div className="panel-h">
            Componentes
            <div className="spacer" />
            <button className="ibtn" title="Exibir tudo (Shift+H)" onClick={showAll}>
              <Icon name="eye" />
            </button>
            <button className="ibtn" title="Novo conjunto" onClick={newGroup}>
              <Icon name="plus" />
            </button>
          </div>
          <Tree3D
            model={display}
            sel={snap.sel}
            hover={snap.hover}
            errors={errors}
            onSelect={(id, add) => {
              setFsel(null); // clicar no corpo mostra o corpo (não a última operação)
              store.pick({ t: "node", id }, add);
            }}
            onHover={(id) => store.set({ hover: id ? { t: "node", id } : null })}
            onRename={(id, nm) => commit("Renomear", (m) => rename(m, id, nm))}
            onVisible={(id, vis) => commit(vis ? "Exibir" : "Ocultar", (m) => setVisible(m, [id], vis))}
            onFocus={(id) => {
              store.pick({ t: "node", id }, false);
              requestAnimationFrame(() => vp.current?.fit(true));
            }}
            status={fstat}
            fsel={fsel}
            onFeature={(body, id) => {
              if (sk || fd) return;
              store.pick({ t: "node", id: body }, false);
              setFsel({ body, id });
            }}
            onFeatureAct={(body, id, a) => !sk && !fd && featureAct(body, id, a)}
            onRollbackEnd={(body) => commit("Avançar ao fim", (m) => setRollback(m, body, null))}
          />
        </aside>

        <section className="w3-view">
          <div className="v3-host" ref={host} />
          <ViewCube cam={cam} onDir={(d) => v?.viewDir(d)} onHome={() => v?.view("iso")} onRoll={(d) => v?.roll(d)} />
          {snap.measuring && <div className="v3-banner">MEDIR · clique em dois elementos · Esc sai</div>}
          {!sk && !fd && Object.keys(partial).some((id) => display.nodes[id]?.visible !== false) && (
            <div className="v3-partial" role="status" data-testid="partial-banner">
              {Object.entries(partial)
                .filter(([id]) => display.nodes[id])
                .map(([id, f]) => (
                  <button
                    key={id}
                    onClick={() => {
                      store.pick({ t: "node", id }, false);
                      setFsel({ body: id, id: f.id });
                    }}
                    title={f.error}
                  >
                    <Icon name="warn" /> <b>{display.nodes[id].name}</b> · {f.name} falhou — exibindo o último sólido válido; operações seguintes não avaliadas
                  </button>
                ))}
            </div>
          )}
          {sk && <DimInput editor={sk.editor} place={(p) => vp.current?.sketchScreen(p) ?? null} />}
          {fd && partSrc(model, fd.body) && (
            <FeatureDialog
              key={fd.key}
              model={model}
              body={fd.body}
              features={partSrc(model, fd.body)!.features}
              at={fd.at}
              editing={fd.editing}
              initial={fd.initial}
              name={fd.name}
              sel={snap.sel}
              onPick={onPick}
              identify={(kind, index) => engine().call("identify", { body: fd.body, kind, index, model: isPart(displayRef.current, fd.body) ? displayRef.current : getModel(doc) })}
              preview={runPreview}
              onOk={featureOk}
              onCancel={closeFeature}
              frameOf={(id) => {
                const f = frames[fd.body]?.[id];
                return f ? worldFrame(model, fd.body, f) : null;
              }}
              handle={(h) => vp.current?.setHandle(h)}
            />
          )}
          {planeAsk && (
            <div className="plane-ask" role="dialog" aria-label="Plano do esboço" onPointerDown={(e) => e.stopPropagation()}>
              <div className="fd-h">
                <Icon name="sketch3d" />
                <b>Novo esboço</b>
                <div className="spacer" />
                <button className="ibtn" title="Cancelar (Esc)" onClick={() => setPlaneAsk(null)}>
                  <Icon name="close" />
                </button>
              </div>
              <div className="fd-b">
                <div className="pa-planes">
                  {(["XY", "XZ", "YZ"] as StdPlane[]).map((pl) => (
                    <button key={pl} className="pa-btn" onClick={() => void openSketch(planeAsk.body, { t: "std", plane: pl, offset: planeAsk.offset }, null)} data-plane={pl}>
                      <b>{pl}</b>
                      <span>{PLANE_LABEL[pl].replace(/^Plano \w+ /, "")}</span>
                    </button>
                  ))}
                </div>
                <div className="p3-row edit">
                  <span className="k">Deslocamento</span>
                  <span className="v unit-in">
                    <input
                      defaultValue="0"
                      onChange={(e) => {
                        const v = Number(e.target.value.replace(",", "."));
                        if (Number.isFinite(v)) setPlaneAsk({ ...planeAsk, offset: v });
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                    <i>mm</i>
                  </span>
                </div>
                <div className="p3-row edit">
                  <span className="k">Destino</span>
                  <span className="v">
                    <select value={planeAsk.body ?? ""} onChange={(e) => setPlaneAsk({ ...planeAsk, body: e.target.value || null })} data-field="destino">
                      <option value="">Nova peça</option>
                      {bodies(model)
                        .filter((b) => b.source.type === "part" || b.source.type === "primitive")
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                    </select>
                  </span>
                </div>
                <div className="fd-note">Para desenhar numa face plana: feche, selecione a face e clique em Esboço.</div>
              </div>
            </div>
          )}
          {eng.s === "loading" && (
            <div className="v3-center">
              <span className="spinner" /> Iniciando o motor geométrico 3D (OCCT)…
            </div>
          )}
          {eng.s === "error" && (
            <div className="v3-center err">
              <b>Não foi possível iniciar o motor 3D.</b>
              <span>{eng.msg}</span>
              <span className="note">O desenho 2D continua funcionando normalmente.</span>
            </div>
          )}
          {eng.s === "ready" && !bodies(model).length && !sk && !planeAsk && !fd && (
            <div className="v3-empty">
              <Icon name="cube3d" />
              <b>AGTN 3D</b>
              <span>Crie uma peça paramétrica ou importe um STEP.</span>
              <div>
                <button className="btn primary" onClick={() => create("box")}>
                  Nova caixa
                </button>
                <button className="btn" onClick={() => create("profile")}>
                  Perfil estrutural
                </button>
                <button className="btn" onClick={() => void importStep()}>
                  Importar STEP
                </button>
              </div>
            </div>
          )}
          {busy && (
            <div className="busy">
              <div className="busy-card">
                <span className="spinner" />
                {busy}
              </div>
            </div>
          )}
          <div className="v3-help">
            {sk
              ? "Esq.: desenhar/selecionar · arrastar ponto: mover · Meio/Dir.: arrastar vista · Roda: zoom · Esc: selecionar · duplo clique na cota: editar"
              : fd
                ? "Clique no modelo para escolher · Enter: OK · Esc: cancelar"
                : "Esq.: girar/selecionar · Meio/Dir.: arrastar · Roda: zoom · Duplo clique: corpo/enquadrar"}
          </div>
        </section>

        <aside className="w3-right">
          <div className="panel-h">{fsel ? "Operação" : "Propriedades"}</div>
          <div className="w3-props">
            {fsel && partSrc(model, fsel.body)?.features.some((f) => f.id === fsel.id) ? (
              (() => {
                const part = partSrc(model, fsel.body)!;
                const i = part.features.findIndex((f) => f.id === fsel.id);
                return (
                  <FeatureProps
                    features={part.features}
                    feature={part.features[i]}
                    index={i}
                    rollback={part.rollback}
                    status={fstat[fsel.body]?.find((x) => x.id === fsel.id)}
                    onRename={(nm) => commit("Renomear operação", (m) => renameFeature(m, fsel.body, fsel.id, nm))}
                    onAct={(a) => featureAct(fsel.body, fsel.id, a)}
                    onDelete={(c) => deleteFeature(fsel.body, fsel.id, c)}
                  />
                );
              })()
            ) : (
            <Props3D
              model={model}
              snap={snap}
              geom={(id) => vp.current?.geom(id)}
              partial={(id) => partial[id]}
              act={{
                rename: (id, nm) => commit("Renomear", (m) => rename(m, id, nm)),
                placement: (id, p) => commit("Mover", (m) => setPlacement(m, id, p)),
                color: (id, c) => commit("Cor", (m) => setColor(m, [id], c)),
                material: (id, mt) => commit("Material", (m) => setMaterial(m, [id], mt)),
                spec: (id, sp) => commit("Editar parâmetros", (m) => setPrimitive(m, id, sp)),
              }}
            />
            )}
          </div>
        </aside>
      </div>

      {/* ------------------------------ status ------------------------------ */}
      <div className="st3">
        <span className={`st3-dot ${eng.s}`} />
        <span title="Motor geométrico B-Rep">{engineLabel}</span>
        <span className="sep" />
        <span>{bodies(model).length} corpo(s)</span>
        <span>{fmt(v?.triangleCount() ?? 0, 0)} triângulos</span>
        {syncMs > 0 && <span title="Tempo da última regeneração">regen {fmt(syncMs, 0)} ms</span>}
        {stats && <span title="Memória do motor WebAssembly · formas vivas no kernel">motor {fmt(stats.wasmBytes / 1048576, 0)} MB · {stats.liveShapes} formas</span>}
        <span className="sep" />
        <span>{snap.view ? STD_VIEWS[snap.view as StdView].label : "Vista livre"}</span>
        <span>{snap.ortho ? "Ortográfica" : "Perspectiva"}</span>
        <span>Seleção: {FILTER_LABEL[snap.filter].split(" ")[0]}</span>
        {sel1 && <span className="st3-sel">{sel1.t === "node" ? model.nodes[sel1.id]?.name : `${sel1.kind === "face" ? "Face" : sel1.kind === "edge" ? "Aresta" : "Vértice"} ${sel1.index + 1}`}</span>}
        <div className="spacer" />
        <span className="mono" title="Ponto da peça sob o cursor (mm)">
          {snap.cursor ? `X ${fmt(snap.cursor.x, 2)}  Y ${fmt(snap.cursor.y, 2)}  Z ${fmt(snap.cursor.z, 2)}` : "X —  Y —  Z —"}
        </span>
        <span>mm</span>
      </div>

      {dialog?.kind === "featPrim" && (
        <PrimitiveDialog
          title="Editar primitiva base"
          submitLabel="Aplicar"
          initial={dialog.spec}
          onClose={() => setDialog(null)}
          onSubmit={(r) => {
            const d = dialog;
            const err = commit("Editar primitiva base", (m) => updateFeature(m, d.body, d.feat, { t: "primitive", spec: r.spec, placement: { origin: r.origin, rot: r.rot } }));
            if (err) return err;
            setDialog(null);
            return null;
          }}
        />
      )}
      {dialog?.kind === "create" && (
        <PrimitiveDialog
          title={`Novo ${PRIMITIVE_LABEL[dialog.prim].toLowerCase()}`}
          submitLabel="Criar"
          initial={DEFAULT_SPECS[dialog.prim] as PrimitiveSpec}
          onClose={() => setDialog(null)}
          onSubmit={(r) => {
            let id: NodeId = "";
            const err = commit(`Criar ${PRIMITIVE_LABEL[r.spec.kind].toLowerCase()}`, (m) => {
              const x = addBody(m, { name: r.name, parent: targetGroup(), placement: { origin: r.origin, rot: r.rot }, source: { type: "primitive", spec: r.spec } });
              id = x.id;
              return x.model;
            });
            if (err) return err;
            setDialog(null);
            store.pick({ t: "node", id }, false);
            if (bodies(getModel(doc)).length === 1) firstFit.current = true;
            return null;
          }}
        />
      )}
    </div>
  );
}

export default Workspace3D;
