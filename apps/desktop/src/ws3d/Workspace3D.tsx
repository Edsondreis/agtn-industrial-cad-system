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
} from "@agtn/model3d";
import { type PrimitiveKind, type PrimitiveSpec, PRIMITIVE_LABEL } from "@agtn/solid";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CadController } from "../cad/controller";
import { baseName, pickAndRead, pickSavePath, writeBytes, writeText } from "../platform/platform";
import { Icon } from "../ui/Icons";
import { toast } from "../ui/toast";
import { type CamState, STD_VIEWS, type StdView, initialCam } from "./camera";
import { engine } from "./engine";
import { DEFAULT_SPECS, PrimitiveDialog } from "./PrimitiveDialog";
import { Props3D } from "./Props3D";
import type { EngineStats, TopoRefMsg } from "./protocol";
import { type DisplayMode, FILTER_LABEL, type PickFilter, type Sel, Ws3dStore } from "./store";
import { Tree3D } from "./Tree3D";
import { ViewCube } from "./ViewCube";
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
  const [dialog, setDialog] = useState<null | { kind: "create"; prim: PrimitiveKind }>(null);
  const [cam, setCam] = useState<CamState>(initialCam);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [syncMs, setSyncMs] = useState(0);
  const [, setGeomRev] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const vp = useRef<Viewport3D | null>(null);
  const firstFit = useRef(true);
  /** o viewport desta montagem ainda não recebeu nenhuma geometria → o próximo sync é completo */
  const needFull = useRef(true);

  /* ------------------------------------------------ documento → modelo (inclusive Undo/Redo) */
  useEffect(() => doc.subscribe(() => setModel(getModel(doc))), [doc]);

  /* ------------------------------------------------ viewport */
  useEffect(() => {
    if (!host.current) return;
    const v = new Viewport3D(host.current, store);
    vp.current = v;
    const off = v.onCamera((c) => setCam(c));
    // gancho para os testes de ponta a ponta (só em desenvolvimento ou com a flag de teste)
    if (import.meta.env.DEV || localStorage.getItem("agtn.e2e") === "1") (window as unknown as { __agtn3d?: unknown }).__agtn3d = { vp: v, store, doc };
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
    };
  }, []);

  // modelo → motor → viewport (regeneração incremental, coalescida).
  // Resultados NUNCA são descartados: cada um traz geometria que o worker não reenviará.
  useEffect(() => {
    if (eng.s !== "ready") return;
    vp.current?.applyModel(model);
    const full = needFull.current;
    void engine()
      .sync(model, full)
      .then((r) => {
        const v = vp.current;
        if (!r || !v) return;
        needFull.current = false;
        const latest = getModel(doc);
        v.applySync(r);
        v.applyModel(latest);
        setErrors(r.errors);
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
  }, [model, eng.s, doc]);

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
      <div className="rb" role="toolbar" aria-label="Ferramentas 3D">
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
      </div>

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
            model={model}
            sel={snap.sel}
            hover={snap.hover}
            errors={errors}
            onSelect={(id, add) => store.pick({ t: "node", id }, add)}
            onHover={(id) => store.set({ hover: id ? { t: "node", id } : null })}
            onRename={(id, nm) => commit("Renomear", (m) => rename(m, id, nm))}
            onVisible={(id, vis) => commit(vis ? "Exibir" : "Ocultar", (m) => setVisible(m, [id], vis))}
            onFocus={(id) => {
              store.pick({ t: "node", id }, false);
              requestAnimationFrame(() => vp.current?.fit(true));
            }}
          />
        </aside>

        <section className="w3-view">
          <div className="v3-host" ref={host} />
          <ViewCube cam={cam} onDir={(d) => v?.viewDir(d)} onHome={() => v?.view("iso")} onRoll={(d) => v?.roll(d)} />
          {snap.measuring && <div className="v3-banner">MEDIR · clique em dois elementos · Esc sai</div>}
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
          {eng.s === "ready" && !bodies(model).length && (
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
          <div className="v3-help">Esq.: girar/selecionar · Meio/Dir.: arrastar · Roda: zoom · Duplo clique: corpo/enquadrar</div>
        </section>

        <aside className="w3-right">
          <div className="panel-h">Propriedades</div>
          <div className="w3-props">
            <Props3D
              model={model}
              snap={snap}
              geom={(id) => vp.current?.geom(id)}
              act={{
                rename: (id, nm) => commit("Renomear", (m) => rename(m, id, nm)),
                placement: (id, p) => commit("Mover", (m) => setPlacement(m, id, p)),
                color: (id, c) => commit("Cor", (m) => setColor(m, [id], c)),
                material: (id, mt) => commit("Material", (m) => setMaterial(m, [id], mt)),
                spec: (id, sp) => commit("Editar parâmetros", (m) => setPrimitive(m, id, sp)),
              }}
            />
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
