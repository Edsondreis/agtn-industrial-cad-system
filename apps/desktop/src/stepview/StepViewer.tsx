import "../ws3d/ws3d.css";
import "./stepview.css";
import {
  DISPLAY_UNITS,
  type DisplayUnit,
  MEASURE_GRADE_LABEL,
  type Model3D,
  type NodeId,
  STEP_MAX_BYTES,
  STEP_PHASE_LABEL,
  type StepPhase,
  type StepScan,
  type StepSummary,
  childrenOf,
  fmtLen,
  stepTreeToModel,
  gradeBody,
  summarize,
} from "@agtn/model3d";
import type { GeometryCheck, StepNode, TopoInfo } from "@agtn/solid";
import type { StepRepair } from "../ws3d/protocol";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Engine, EngineError } from "../ws3d/engine";
import { STD_VIEWS, type StdView } from "../ws3d/camera";
import { type DisplayMode, Ws3dStore } from "../ws3d/store";
import { Viewport3D } from "../ws3d/viewport";
import { ViewCube } from "../ws3d/ViewCube";
import { Icon } from "../ui/Icons";

/** Arquivo STEP aberto como documento próprio (somente leitura; o .agtncad não é tocado). */
export interface StepFile {
  readonly name: string;
  readonly path: string | null;
  readonly bytes: Uint8Array;
}

const ROT_Y_UP = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0];
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** Ganchos de teste (WebView2/E2E), só com a flag de teste ou em desenvolvimento. */
interface StepHook {
  phase: StepPhase;
  error: string | null;
  scan: StepScan | null;
  summary: StepSummary | null;
  repair: StepRepair | null;
  checks: Record<NodeId, GeometryCheck>;
  ms: Partial<Record<StepPhase, number>>;
  triangles: number;
  invalid: string[];
}

function fmtN(n: number) {
  return n.toLocaleString("pt-BR");
}

export function StepViewer({ file, onClose }: { file: StepFile; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const vp = useRef<Viewport3D | null>(null);
  const eng = useRef<Engine | null>(null);
  const store = useMemo(() => new Ws3dStore(), []);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [cam, setCam] = useState(() => null as Viewport3D["camera"] | null);
  const [phase, setPhase] = useState<StepPhase>("carregando");
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [scan, setScan] = useState<StepScan | null>(null);
  const [nodes, setNodes] = useState<StepNode[] | null>(null);
  const [yUp, setYUp] = useState(false);
  const [model, setModel] = useState<Model3D | null>(null);
  const [summary, setSummary] = useState<StepSummary | null>(null);
  const [invalid, setInvalid] = useState<string[]>([]);
  const [checks, setChecks] = useState<Record<NodeId, GeometryCheck>>({});
  const [repair, setRepair] = useState<StepRepair | null>(null);
  const [unit, setUnit] = useState<DisplayUnit>("mm");
  const [info, setInfo] = useState<TopoInfo | null>(null);
  const ms = useRef<Partial<Record<StepPhase, number>>>({});
  const hook = useRef<StepHook | null>(null);

  /* viewport + motor próprios deste documento: liberados ao fechar */
  useEffect(() => {
    if (!host.current) return;
    const v = new Viewport3D(host.current, store);
    v.setOrtho(false);
    store.set({ grid: false, ortho: false });
    vp.current = v;
    setCam(v.camera);
    v.onCamera((c) => setCam(c));
    const e = new Engine();
    eng.current = e;
    return () => {
      v.dispose();
      vp.current = null;
      e.dispose();
      eng.current = null;
    };
  }, [store]);

  /* leitura: texto → cabeçalho/unidades + árvore B-rep (no worker) */
  useEffect(() => {
    let dead = false;
    const t0 = performance.now();
    void (async () => {
      try {
        setPhase("carregando");
        if (file.bytes.length === 0) throw new Error("Arquivo STEP vazio.");
        if (file.bytes.length > STEP_MAX_BYTES) throw new Error(`Arquivo STEP muito grande (${(file.bytes.length / 1048576).toFixed(0)} MB; limite ${STEP_MAX_BYTES / 1048576} MB).`);
        const text = new TextDecoder("utf-8", { fatal: false }).decode(file.bytes);
        if (!/^﻿?\s*ISO-10303-21\s*;/.test(text.slice(0, 4096))) throw new Error("O arquivo não é um STEP válido (cabeçalho ISO-10303-21 ausente).");
        ms.current.carregando = performance.now() - t0;
        await new Promise((r) => setTimeout(r, 0));
        if (dead || !eng.current) return;
        setPhase("interpretando");
        const t1 = performance.now();
        const r = await eng.current.call("openStep", { text });
        if (dead) return;
        ms.current.interpretando = performance.now() - t1;
        setScan(r.scan);
        setRepair(r.repair);
        if (r.scan.length && r.scan.length.name in DISPLAY_UNITS) setUnit(r.scan.length.name as DisplayUnit);
        setNodes(r.nodes);
      } catch (e) {
        if (dead) return;
        setPhase("falha");
        setError(e instanceof Error ? e.message : String(e));
        if (e instanceof EngineError) setDetails(e.details.join("\n"));
      }
    })();
    return () => {
      dead = true;
    };
  }, [file]);

  /* árvore → modelo do documento (com a opção eixo Y para cima, só exibição) */
  useEffect(() => {
    if (!nodes) return;
    const tree = [{ name: file.name.replace(/\.(step|stp)$/i, ""), matrix: yUp ? ROT_Y_UP : IDENT, children: nodes }];
    setModel(stepTreeToModel(nodes.length === 1 && !yUp ? nodes : tree, file.name).model);
  }, [nodes, yUp, file.name]);

  /* modelo → motor → viewport */
  useEffect(() => {
    const v = vp.current;
    const e = eng.current;
    if (!model || !v || !e) return;
    let dead = false;
    void (async () => {
      try {
        setPhase("gerando");
        const t2 = performance.now();
        v.applyModel(model);
        const r = await e.sync(model, true);
        if (dead || !r) return;
        v.applySync(r);
        v.applyModel(model);
        const ids = r.built.map((g) => g.id);
        const ck = await e.call("checkBodies", { ids });
        if (dead) return;
        const facts = r.built.map((g) => ({ props: g.props, topo: g.topo, valid: ck[g.id]?.shapeValid, check: ck[g.id] }));
        setChecks(ck);
        // corpo que não é "exato" nem "não calculável" (casca) fica marcado: medida não apta para engenharia
        setInvalid(r.built.filter((_g, i) => gradeBody(facts[i]) === "invalido" || gradeBody(facts[i]) === "nao_verificado").map((g) => g.id));
        const sum = summarize(facts);
        setSummary(sum);
        const errs = Object.entries(r.errors);
        if (!r.built.length) throw new Error(errs.length ? errs.map(([, m]) => m).join("; ") : "O arquivo STEP não contém geometria exibível.");
        ms.current.gerando = performance.now() - t2;
        v.view("iso");
        v.fit();
        setPhase("pronto");
        if (errs.length) setDetails(errs.map(([id, m]) => `${model.nodes[id]?.name ?? id}: ${m}`).join("\n"));
      } catch (err) {
        if (dead) return;
        setPhase("falha");
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      dead = true;
    };
  }, [model]);

  /* informação exata do elemento selecionado (face/aresta/vértice do B-rep) */
  useEffect(() => {
    const last = snap.sel[snap.sel.length - 1];
    if (!last || last.t !== "topo" || !eng.current) {
      setInfo(null);
      return;
    }
    let dead = false;
    void eng.current
      .call("info", { body: last.body, kind: last.kind, index: last.index })
      .then((i) => !dead && setInfo(i))
      .catch(() => !dead && setInfo(null));
    return () => {
      dead = true;
    };
  }, [snap.sel]);

  /* gancho de teste */
  useEffect(() => {
    if (!(import.meta.env.DEV || localStorage.getItem("agtn.e2e") === "1")) return;
    hook.current = { phase, error, scan, summary, ms: ms.current, triangles: vp.current?.triangleCount() ?? 0, invalid, repair, checks };
    (window as unknown as { __agtnStep?: unknown }).__agtnStep = {
      ...hook.current,
      view: (s: StdView) => vp.current?.view(s),
      fit: () => vp.current?.fit(),
      mode: (m: DisplayMode) => store.set({ mode: m }),
      yUp: (b: boolean) => setYUp(b),
      cam: () => vp.current?.camera,
      clientOf: (x: number, y: number, z: number) => vp.current?.clientOf(x, y, z),
      sel: () => store.snap.sel,
    };
  }, [phase, error, scan, summary, invalid, repair, checks, store]);
  // ao fechar, o gancho não pode segurar a árvore/modelo (BREP) do documento na memória
  useEffect(() => () => void delete (window as unknown as { __agtnStep?: unknown }).__agtnStep, []);

  const v = vp.current;
  const fileUnit = scan?.length ? `${scan.length.name}${scan.length.name === "mm" ? "" : ` (1 ${scan.length.name} = ${fmtN(scan.length.toMm)} mm)`}` : "desconhecida";
  const box = summary?.bbox;
  // caixa só é medida de engenharia quando nenhum corpo está reprovado/não verificado
  const trusted = !!summary && (summary.grade === "exato" || summary.grade === "nao_calculavel");
  const sel = snap.sel[snap.sel.length - 1];
  const tree = model ? flatTree(model) : [];

  return (
    <div className="ws3d stepdoc" data-testid="step-viewer">
      <div className="rb">
        <div className="rb-grp">
          <div className="rb-btns">
            <div className="sv-title" title={file.path ?? file.name}>
              <b>{file.name}</b>
              <span className="sv-ro">somente leitura</span>
            </div>
          </div>
          <div className="rb-cap">DOCUMENTO STEP</div>
        </div>
        <div className="rb-grp">
          <div className="rb-btns">
            {(Object.keys(STD_VIEWS) as StdView[]).map((k) => (
              <button key={k} className={`rb-view${snap.view === k ? " on" : ""}`} title={`${STD_VIEWS[k].label} (${STD_VIEWS[k].key})`} onClick={() => v?.view(k)}>
                {STD_VIEWS[k].short}
              </button>
            ))}
            <button className="rb-view" title="Enquadrar tudo" onClick={() => v?.fit()} data-testid="step-fit">
              Ajustar
            </button>
          </div>
          <div className="rb-cap">VISTAS</div>
        </div>
        <div className="rb-grp">
          <div className="rb-btns">
            <div className="rb-seg">
              {(
                [
                  ["sombreado-arestas", "Sólido + arestas"],
                  ["sombreado", "Sólido"],
                  ["arame", "Arame"],
                ] as const
              ).map(([m, l]) => (
                <button key={m} className={snap.mode === m ? "on" : ""} onClick={() => store.set({ mode: m })}>
                  {l}
                </button>
              ))}
            </div>
            <label className="sv-chk" title="Arquivos de CAD com eixo Y vertical: gira o modelo 90° em X só na exibição">
              <input type="checkbox" checked={yUp} onChange={(e) => setYUp(e.target.checked)} /> Y para cima
            </label>
            <label className="sv-chk" title="Projeção ortográfica ou perspectiva">
              <input type="checkbox" checked={snap.ortho} onChange={(e) => (store.set({ ortho: e.target.checked }), v?.setOrtho(e.target.checked))} /> Ortográfica
            </label>
          </div>
          <div className="rb-cap">EXIBIÇÃO</div>
        </div>
        <div className="rb-grp">
          <div className="rb-btns">
            <select value={unit} onChange={(e) => setUnit(e.target.value as DisplayUnit)} title="Unidade de exibição das medidas (a geometria não é alterada)" data-testid="step-unit">
              {(Object.keys(DISPLAY_UNITS) as DisplayUnit[]).map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div className="rb-cap">UNIDADE</div>
        </div>
        <div className="spacer" />
        <div className="rb-grp">
          <div className="rb-btns">
            <button className="rb-btn" onClick={onClose} title="Fechar o documento STEP e liberar a memória do motor" data-testid="step-close">
              <Icon name="close" />
              Fechar
            </button>
          </div>
          <div className="rb-cap">ARQUIVO</div>
        </div>
      </div>

      <div className="w3">
        <aside className="w3-left">
          <div className="panel-h">Estrutura</div>
          <div className="t3">
            {tree.map(({ id, depth }) => {
              const n = model!.nodes[id];
              const on = snap.sel.some((s) => s.t === "node" && s.id === id);
              return (
                <div key={id} className={`t3-row${on ? " on" : ""}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => store.pick({ t: "node", id }, false)}>
                  <span className="t3-ico">
                    <Icon name={n.kind === "group" ? "group3d" : "box3d"} />
                  </span>
                  <span className="t3-name" title={n.name}>
                    {n.name}
                  </span>
                  {invalid.includes(id) && <span className="t3-err" title="Geometria inválida (verificador do OCCT)">!</span>}
                </div>
              );
            })}
            {!tree.length && <div className="t3-empty">{phase === "falha" ? "Nenhuma geometria lida." : "Lendo…"}</div>}
          </div>
        </aside>

        <section className="w3-view">
          <div className="v3-host" ref={host} />
          {cam && <ViewCube cam={cam} onDir={(d) => v?.viewDir(d)} onHome={() => v?.view("iso")} onRoll={(d) => v?.roll(d)} />}
          {phase !== "pronto" && phase !== "falha" && (
            <div className="v3-center" role="status" data-testid="step-phase">
              <span className="spinner" />
              {STEP_PHASE_LABEL[phase]}…
            </div>
          )}
          {phase === "falha" && (
            <div className="v3-center sv-fail" role="alert" data-testid="step-error">
              <b>{STEP_PHASE_LABEL.falha}</b>
              <span>{error}</span>
              {details && <pre className="v3-diag">{details}</pre>}
            </div>
          )}
          {phase === "pronto" && invalid.length > 0 && (
            <div className="v3-partial" role="status" data-testid="step-invalid">
              <span>
                <Icon name="warn" /> {invalid.length} corpo(s) com geometria NÃO validada: medidas não aptas para uso em engenharia ou fabricação. Ver “Informações”.
              </span>
            </div>
          )}
          <div className="v3-help">Arrastar: girar · Botão do meio/Shift: deslocar · Roda: zoom · Clique: selecionar</div>
        </section>

        <aside className="w3-right">
          <div className="panel-h">Informações</div>
          <div className="w3-props sv-info">
            <Row k="Estado">
              <span data-testid="step-state">{STEP_PHASE_LABEL[phase]}</span>
            </Row>
            <Row k="Unidade do arquivo">
              <span data-testid="step-file-unit">{fileUnit}</span>
            </Row>
            <Row k="Exibição">em {unit} (convertido; geometria interna em mm)</Row>
            {scan && (
              <>
                <Row k="Protocolo">{scan.protocol ?? "—"}</Row>
                <Row k="Origem">{scan.originatingSystem || scan.preprocessor || "—"}</Row>
                <Row k="Entidades">{fmtN(scan.entities)}</Row>
              </>
            )}
            {summary && (
              <>
                <div className="prim-h">Geometria (B-rep)</div>
                <Row k="Corpos">{fmtN(summary.bodies)}</Row>
                <Row k="Sólidos">
                  <span data-testid="step-solids">{fmtN(summary.solids)}</span>
                </Row>
                <Row k="Faces / arestas">
                  {fmtN(summary.faces)} / {fmtN(summary.edges)}
                </Row>
                <Row k="Vértices">{fmtN(summary.vertices)}</Row>
                <Row k="Medidas">
                  <span className={`sv-grade sv-grade-${summary.grade}`} data-testid="step-grade">
                    {MEASURE_GRADE_LABEL[summary.grade]}
                  </span>
                </Row>
                <Row k="Volume">
                  <span data-testid="step-volume">
                    {summary.grade === "exato"
                      ? fmtLen(summary.volume, unit, 3)
                      : summary.grade === "nao_calculavel"
                        ? "não calculável"
                        : summary.grades.exato > 0
                          ? `${fmtLen(summary.volumeExact, unit, 3)} (parcial: só ${summary.grades.exato} corpo(s) verificado(s))`
                          : "não confiável"}
                  </span>
                </Row>
                <Row k="Área">{summary.grade === "exato" || summary.grade === "nao_calculavel" ? fmtLen(summary.area, unit, 2) : "não confiável"}</Row>
                {box && (
                  <>
                    <Row k="Dimensões X">{trusted ? fmtLen(box.max.x - box.min.x, unit) : "não confiável"}</Row>
                    <Row k="Dimensões Y">{trusted ? fmtLen(box.max.y - box.min.y, unit) : "não confiável"}</Row>
                    <Row k="Dimensões Z">{trusted ? fmtLen(box.max.z - box.min.z, unit) : "não confiável"}</Row>
                  </>
                )}
                {summary.open > 0 && <div className="sv-warn">{summary.open} corpo(s) sem volume (casca ou superfície aberta).</div>}
                {invalid.length > 0 && (
                  <div className="sv-warn" data-testid="step-bad-faces">
                    <b>Geometria não validada — não usar para engenharia/fabricação:</b>
                    {invalid.map((id) => {
                      const c = checks[id];
                      const nm = model?.nodes[id]?.name ?? id;
                      if (!c) return <div key={id}>{nm}: não verificado.</div>;
                      return (
                        <div key={id}>
                          {nm}:{!c.shapeValid && " forma reprovada pelo verificador do motor;"}
                          {!c.volumeOk && " volume incoerente com a área (superfície sobreposta ou sólido do avesso);"}
                          {c.unmeasured > 0 && ` ${c.unmeasured} ponto(s) não medidos;`}
                          {c.faces.map((f) => (
                            <span key={f.index}>
                              {" "}
                              face nº {f.index + 1} ({f.surface}): {f.reason === "invalida" ? `inválida, área ${fmtLen(f.area, unit, 2)}` : `aresta fora da superfície, desvio ${fmtLen(f.deviation ?? NaN, unit)}`};
                            </span>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="sv-note">
                  Volume, área e caixa vêm do B-rep; só são mostrados como resultado quando o corpo passa na verificação (forma do motor + arestas sobre as superfícies + volume coerente). A imagem é uma malha aproximada só para exibição. O documento não é editável.
                </div>
              </>
            )}
            {sel && sel.t === "topo" && info && (
              <>
                <div className="prim-h">Seleção</div>
                <TopoRows info={info} unit={unit} />
              </>
            )}
            {repair && (repair.fixes > 0 || repair.halfConics > 0 || repair.skipped.length > 0) && (
              <>
                <div className="prim-h">Leitura corrigida (P-F5-01)</div>
                <div className="sv-note" data-testid="step-repair">
                  {repair.fixes > 0 && `${repair.fixes} laço(s) de face de revolução com polo começados pelo polo antes da leitura (só a ordem cíclica do laço). `}
                  {repair.halfConics > 0 && `${repair.halfConics} face(s) de revolução fechada(s) lida(s) com a geratriz recortada à meia cônica (mesma superfície). `}
                  Nenhuma coordenada ou curva do arquivo foi alterada; o arquivo em disco não é modificado.
                </div>
                {repair.skipped.map((w, i) => (
                  <div key={i} className="sv-warn">
                    {w}
                  </div>
                ))}
              </>
            )}
            {scan && scan.warnings.length > 0 && (
              <>
                <div className="prim-h">Avisos</div>
                {scan.warnings.map((w, i) => (
                  <div key={i} className="sv-warn">
                    {w}
                  </div>
                ))}
              </>
            )}
          </div>
        </aside>
      </div>

      <div className="st3">
        <span className="st3-dot" />
        <span>{STEP_PHASE_LABEL[phase]}</span>
        {ms.current.interpretando !== undefined && <span>leitura {Math.round(ms.current.interpretando)} ms</span>}
        {ms.current.gerando !== undefined && <span>visualização {Math.round(ms.current.gerando)} ms</span>}
        <span>{file.name}</span>
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="p3-row">
      <span className="p3-k">{k}</span>
      <span className="p3-v">{children}</span>
    </div>
  );
}

function TopoRows({ info, unit }: { info: TopoInfo; unit: DisplayUnit }) {
  const p = (v: { x: number; y: number; z: number }) => `${fmtLen(v.x, unit)}; ${fmtLen(v.y, unit)}; ${fmtLen(v.z, unit)}`;
  if (info.kind === "vertex") return <Row k="Vértice">{p(info.point)}</Row>;
  if (info.kind === "edge")
    return (
      <>
        <Row k="Aresta">{info.curve}</Row>
        <Row k="Comprimento">{fmtLen(info.length, unit)}</Row>
        {info.radius !== undefined && <Row k="Raio">{fmtLen(info.radius, unit)}</Row>}
      </>
    );
  return (
    <>
      <Row k="Face">{info.surface}</Row>
      <Row k="Área">{fmtLen(info.area, unit, 2)}</Row>
      {info.radius !== undefined && <Row k="Raio">{fmtLen(info.radius, unit)}</Row>}
    </>
  );
}

/** Nós em ordem de árvore com profundidade (para a lista de estrutura). */
function flatTree(m: Model3D): { id: NodeId; depth: number }[] {
  const out: { id: NodeId; depth: number }[] = [];
  const walk = (ids: readonly NodeId[], depth: number) => {
    for (const id of ids) {
      const n = m.nodes[id];
      if (!n || depth > 64) continue;
      out.push({ id, depth });
      if (n.kind === "group") walk(n.children, depth + 1);
    }
  };
  walk(childrenOf(m, null), 0);
  return out;
}
