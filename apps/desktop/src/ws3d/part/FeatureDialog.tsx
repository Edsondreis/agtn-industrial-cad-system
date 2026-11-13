import type { Model3D, NodeId } from "@agtn/model3d";
import { type AxisRef, type EdgeRef, type FaceRef, type FeatId, type Feature, type FeatureDraft, type FeatureStatus, type Frame, FEATURE_LABEL, type PlaneRef, type StdPlane, to3d, validateFeature } from "@agtn/solid";
import { useEffect, useMemo, useRef, useState } from "react";
import { NumField } from "../../ui/fields";
import { Icon } from "../../ui/Icons";
import type { Sel } from "../store";
import type { DragHandle } from "../viewport";
import { DRAFT_ID, PLANE_LABEL, axisLines, featureIcon, regionsOf, sketchesBefore, solidFeaturesBefore, withDraft } from "./partUi";

export type PickSlot = "edges" | "faces" | "plane" | "dir" | null;
type Draft = FeatureDraft;
type Of<K extends Draft["t"]> = Extract<Draft, { t: K }>;

export interface FeatureDialogProps {
  model: Model3D;
  body: NodeId;
  features: readonly Feature[];
  /** posição de inserção (nova) ou índice da operação em edição */
  at: number;
  editing: FeatId | null;
  initial: Draft;
  name: string;
  sel: readonly Sel[];
  /** escolha no viewport: filtro de seleção e soma de cliques */
  onPick: (slot: PickSlot) => void;
  identify: (kind: "face" | "edge", index: number) => Promise<FaceRef | EdgeRef>;
  preview: (features: Feature[]) => Promise<{ status: readonly FeatureStatus[]; ms: number } | null>;
  onOk: (draft: Draft, name: string) => string | null;
  onCancel: () => void;
  /** plano do esboço no mundo (para o manipulador de profundidade) */
  frameOf?: (sketch: FeatId) => Frame | null;
  handle?: (h: DragHandle | null) => void;
}

const Row = ({ k, children, title }: { k: string; children: React.ReactNode; title?: string }) => (
  <div className="p3-row edit" title={title}>
    <span className="k">{k}</span>
    <span className="v">{children}</span>
  </div>
);
const Mm = ({ v, set, unit = "mm", min }: { v: number; set: (x: number) => void; unit?: string; min?: number }) => (
  <span className="unit-in">
    <NumField value={v} onCommit={set} min={min} />
    <i>{unit}</i>
  </span>
);
const Check = ({ v, set, label }: { v: boolean; set: (x: boolean) => void; label: string }) => (
  <label className="fd-check">
    <input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} /> {label}
  </label>
);

/**
 * Painel de uma operação paramétrica (nova ou em edição): campos em mm, escolha de arestas/faces no viewport,
 * prévia real (OCCT) a cada alteração e mensagem de erro clara. Nada é gravado até "OK".
 */
export function FeatureDialog(p: FeatureDialogProps) {
  const [d, setD] = useState<Draft>(p.initial);
  const [name, setName] = useState(p.name);
  const [slot, setSlot] = useState<PickSlot>(null);
  const [state, setState] = useState<{ busy: boolean; error: string | null; warn: string | null; ms: number }>({ busy: false, error: null, warn: null, ms: 0 });
  const picked = useRef(new Map<string, FaceRef | EdgeRef>());
  const [pickRev, setPickRev] = useState(0);
  const set = <K extends Draft["t"]>(patch: Partial<Of<K>>) => setD((x) => ({ ...x, ...patch }) as Draft);
  const kind = d.t;
  const sketches = sketchesBefore(p.features, p.at);
  const sketchById = (id: string) => sketches.find((s) => s.id === id)?.sketch;

  // escolha inicial: arestas/faces exigem escolha; o painel já abre escolhendo
  useEffect(() => {
    if (kind === "fillet" || kind === "chamfer") setSlot("edges");
    else if (kind === "shell") setSlot("faces");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    p.onPick(slot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot]);
  useEffect(() => () => p.onPick(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------------------------ seleção no viewport → referências estáveis */
  const topo = p.sel.filter((s): s is Extract<Sel, { t: "topo" }> => s.t === "topo" && s.body === p.body);
  useEffect(() => {
    if (!slot) return;
    let dead = false;
    const run = async () => {
      if (slot === "edges" || slot === "faces") {
        const k = slot === "edges" ? "edge" : "face";
        const idx = topo.filter((s) => s.kind === k).map((s) => s.index);
        const keys = new Set(idx.map((i) => `${k}${i}`));
        const had = picked.current.size > 0;
        for (const key of [...picked.current.keys()]) if (!keys.has(key)) picked.current.delete(key);
        try {
          for (const i of idx) if (!picked.current.has(`${k}${i}`)) picked.current.set(`${k}${i}`, await p.identify(k, i));
        } catch (e) {
          if (!dead) setState((s) => ({ ...s, error: (e as Error).message }));
          return;
        }
        if (dead) return;
        const refs = [...picked.current.values()];
        if (idx.length || had) {
          if (kind === "fillet" || kind === "chamfer") set({ edges: refs as EdgeRef[] });
          if (kind === "shell") set({ faces: refs as FaceRef[] });
        }
        setPickRev((r) => r + 1);
      } else {
        const last = topo.at(-1);
        if (!last) return;
        try {
          if (slot === "plane" && last.kind === "face") {
            const face = (await p.identify("face", last.index)) as FaceRef;
            if (!dead) set<"mirror">({ plane: { t: "face", face, offset: 0 } });
          } else if (slot === "dir" && (last.kind === "edge" || last.kind === "face")) {
            const r = await p.identify(last.kind, last.index);
            if (!dead) set<"pattern">({ dir: last.kind === "edge" ? { t: "edge", edge: r as EdgeRef } : { t: "face", face: r as FaceRef } });
          } else return;
          if (!dead) setSlot(null);
        } catch (e) {
          if (!dead) setState((s) => ({ ...s, error: (e as Error).message }));
        }
      }
    };
    void run();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.sel, slot]);

  /* ------------------------------------------------ manipulador: seta de profundidade da extrusão */
  useEffect(() => {
    if (!p.handle) return;
    if (d.t !== "extrude" || d.through) return p.handle(null);
    const fr = p.frameOf?.(d.sketch);
    const s = sketchById(d.sketch);
    if (!fr || !s) return p.handle(null);
    const info = regionsOf(s);
    const reg = info.regions.find((r) => r.isDefault) ?? info.regions[0];
    if (!reg) return p.handle(null);
    const skf = sketches.find((x) => x.id === d.sketch);
    const intoMaterial = d.op === "cut" && skf?.plane.t === "face";
    const sign = d.reverse !== intoMaterial ? -1 : 1;
    p.handle({
      o: to3d(fr, reg.interior),
      d: { x: fr.n.x * sign, y: fr.n.y * sign, z: fr.n.z * sign },
      value: d.depth,
      scale: d.mode === "symmetric" ? 0.5 : 1,
      unit: "mm",
      onChange: (v) => set<"extrude">({ depth: v }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);
  useEffect(() => () => p.handle?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------------------------ prévia real (debounced) */
  const errs = validateFeature(d);
  const featId = p.editing ?? DRAFT_ID;
  useEffect(() => {
    if (errs.length) {
      void p.preview([]);
      setState((s) => ({ ...s, busy: false, error: errs[0], warn: null }));
      return;
    }
    let dead = false;
    setState((s) => ({ ...s, busy: true }));
    const t = setTimeout(() => {
      void p
        .preview(withDraft(p.features, p.at, p.editing, d, name))
        .then((r) => {
          if (dead || !r) return;
          const me = r.status.find((s) => s.id === featId);
          const later = r.status.filter((s) => s.id !== featId && (s.state === "error" || s.state === "dependency_error") && !p.features.find((f) => f.id === s.id && f.suppressed));
          const warns = [
            me?.state === "dependency_error" ? `${me.error} Os parâmetros podem ser salvos; ela será avaliada quando a origem for corrigida.` : null,
            me?.warning ?? null,
            later.length ? `Operações posteriores com erro: ${later.map((s) => p.features.find((f) => f.id === s.id)?.name ?? s.id).join(", ")}` : null,
          ].filter(Boolean);
          setState({
            busy: false,
            error: me?.state === "error" ? (me.error ?? "Falha na operação.") : null,
            warn: warns.length ? warns.join(" ") : null,
            ms: r.ms,
          });
        })
        .catch((e: Error) => !dead && setState({ busy: false, error: e.message, warn: null, ms: 0 }));
    }, 120);
    return () => {
      dead = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);

  const ok = () => {
    if (errs.length) return setState((s) => ({ ...s, error: errs[0] }));
    if (state.error) return;
    const e = p.onOk(d, name);
    if (e) setState((s) => ({ ...s, error: e }));
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        if (slot && slot !== "edges" && slot !== "faces") setSlot(null);
        else p.onCancel();
      } else if (e.key === "Enter" && t.tagName !== "INPUT" && t.tagName !== "SELECT") {
        e.stopImmediatePropagation();
        ok();
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  });

  const sketchSelect = (v: string, on: (id: string) => void, label = "Esboço") => (
    <Row k={label}>
      <select value={v} onChange={(e) => on(e.target.value)} data-field={label}>
        {!sketches.length && <option value="">— nenhum esboço —</option>}
        {sketches.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </Row>
  );
  const opSelect = (v: Draft & { op: string }, allowNew = true) => (
    <Row k="Resultado">
      <div className="fd-seg" role="radiogroup">
        {(["new", "join", "cut", "intersect"] as const)
          .filter((o) => allowNew || o !== "new")
          .map((o) => (
            <button key={o} className={v.op === o ? "on" : ""} onClick={() => set({ op: o } as never)} title={{ new: "Novo sólido", join: "Unir ao sólido", cut: "Cortar do sólido", intersect: "Manter a interseção" }[o]} data-op={o}>
              {{ new: "Novo", join: "Unir", cut: "Cortar", intersect: "Interseção" }[o]}
            </button>
          ))}
      </div>
    </Row>
  );
  const regionPick = (sk: string, regions: readonly number[] | null, on: (r: readonly number[] | null) => void) => {
    const s = sketchById(sk);
    if (!s) return null;
    const info = regionsOf(s);
    if (info.regions.length <= 1) return info.regions.length ? null : <div className="fd-note bad">O esboço não tem contorno fechado.</div>;
    const cur = new Set(regions ?? info.regions.filter((r) => r.isDefault).map((r) => r.index));
    return (
      <div className="fd-list">
        <div className="fd-list-h">
          Regiões do perfil
          <button className="lnk" onClick={() => on(null)}>
            padrão
          </button>
        </div>
        {info.regions.map((r) => (
          <label key={r.index} className="fd-check">
            <input
              type="checkbox"
              checked={cur.has(r.index)}
              onChange={(e) => {
                const x = new Set(cur);
                if (e.target.checked) x.add(r.index);
                else x.delete(r.index);
                on([...x].sort((a, b) => a - b));
              }}
            />
            Região {r.index + 1} · {r.area.toFixed(1).replace(".", ",")} mm²{r.holes ? ` · ${r.holes} furo(s)` : ""}
          </label>
        ))}
      </div>
    );
  };
  const targetsPick = (targets: readonly FeatId[] | null, on: (t: readonly FeatId[] | null) => void, allowWhole: boolean) => {
    const cands = solidFeaturesBefore(p.features, p.at).filter((f) => f.id !== p.editing);
    const cur = new Set(targets ?? []);
    return (
      <div className="fd-list">
        <div className="fd-list-h">Operações a repetir</div>
        {allowWhole && <Check v={targets === null} set={(v) => on(v ? null : [])} label="Corpo inteiro" />}
        {targets !== null &&
          cands.map((f) => (
            <label key={f.id} className="fd-check">
              <input
                type="checkbox"
                checked={cur.has(f.id)}
                onChange={(e) => {
                  const x = new Set(cur);
                  if (e.target.checked) x.add(f.id);
                  else x.delete(f.id);
                  on(cands.filter((c) => x.has(c.id)).map((c) => c.id));
                }}
              />
              <Icon name={featureIcon(f)} /> {f.name}
            </label>
          ))}
      </div>
    );
  };
  const pickBox = (what: "edges" | "faces", count: number, hint: string) => (
    <div className={`fd-pick${slot === what ? " on" : ""}`}>
      <button className="btn" onClick={() => setSlot(slot === what ? null : what)} data-testid="pick-toggle">
        <Icon name={what === "edges" ? "edge3d" : "face3d"} />
        {slot === what ? "Escolhendo…" : "Escolher"}
      </button>
      <span>
        <b data-testid="pick-count">{count}</b> {what === "edges" ? "aresta(s)" : "face(s)"}
        {pickRev >= 0 && picked.current.size === 0 && count > 0 ? " (salvas)" : ""}
      </span>
      {count > 0 && (
        <button
          className="lnk"
          onClick={() => {
            picked.current.clear();
            if (what === "edges") set({ edges: [] } as never);
            else set({ faces: [] } as never);
          }}
        >
          limpar
        </button>
      )}
      <div className="fd-hint">{hint}</div>
    </div>
  );

  const form = (() => {
    switch (d.t) {
      case "extrude":
        return (
          <>
            {sketchSelect(d.sketch, (v) => set<"extrude">({ sketch: v, regions: null }))}
            {regionPick(d.sketch, d.regions, (r) => set<"extrude">({ regions: r }))}
            <Row k="Sentido">
              <select value={d.mode} onChange={(e) => set<"extrude">({ mode: e.target.value as "one" })}>
                <option value="one">Um sentido</option>
                <option value="symmetric">Simétrico</option>
                <option value="two">Dois sentidos</option>
              </select>
            </Row>
            {d.op === "cut" && <Check v={d.through} set={(v) => set<"extrude">({ through: v })} label="Passante (através de tudo)" />}
            {!d.through && (
              <Row k={d.mode === "symmetric" ? "Total" : "Profundidade"}>
                <Mm v={d.depth} set={(v) => set<"extrude">({ depth: v })} />
              </Row>
            )}
            {d.mode === "two" && !d.through && (
              <Row k="2º sentido">
                <Mm v={d.depth2} set={(v) => set<"extrude">({ depth2: v })} />
              </Row>
            )}
            <Check v={d.reverse} set={(v) => set<"extrude">({ reverse: v })} label="Inverter sentido" />
            {opSelect(d)}
          </>
        );
      case "revolve": {
        const s = sketchById(d.sketch);
        return (
          <>
            {sketchSelect(d.sketch, (v) => set<"revolve">({ sketch: v, regions: null }))}
            {regionPick(d.sketch, d.regions, (r) => set<"revolve">({ regions: r }))}
            <Row k="Eixo">
              <select value={d.axis} onChange={(e) => set<"revolve">({ axis: e.target.value })}>
                {(s ? axisLines(s) : []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row k="Ângulo">
              <Mm v={d.angle} unit="°" set={(v) => set<"revolve">({ angle: v })} />
            </Row>
            {opSelect(d)}
          </>
        );
      }
      case "sweep":
        return (
          <>
            {sketchSelect(d.profile, (v) => set<"sweep">({ profile: v }), "Perfil")}
            {sketchSelect(d.path, (v) => set<"sweep">({ path: v }), "Trajetória")}
            <div className="fd-note">O perfil deve ser fechado; a trajetória é a cadeia de linhas/arcos do outro esboço.</div>
            {opSelect(d)}
          </>
        );
      case "loft": {
        const cur = d.sections;
        return (
          <>
            <div className="fd-list">
              <div className="fd-list-h">Seções (em ordem)</div>
              {sketches.map((s) => (
                <label key={s.id} className="fd-check">
                  <input
                    type="checkbox"
                    checked={cur.includes(s.id)}
                    onChange={(e) => set<"loft">({ sections: e.target.checked ? sketches.filter((x) => cur.includes(x.id) || x.id === s.id).map((x) => x.id) : cur.filter((x) => x !== s.id) })}
                  />
                  {s.name}
                  {cur.includes(s.id) && <em> #{cur.indexOf(s.id) + 1}</em>}
                </label>
              ))}
            </div>
            <Check v={d.ruled} set={(v) => set<"loft">({ ruled: v })} label="Faces retas entre seções (regrado)" />
            {opSelect(d)}
          </>
        );
      }
      case "fillet":
        return (
          <>
            {pickBox("edges", d.edges.length, "Clique nas arestas no modelo (clique de novo remove).")}
            <Row k="Raio">
              <Mm v={d.r} set={(v) => set<"fillet">({ r: v })} />
            </Row>
          </>
        );
      case "chamfer":
        return (
          <>
            {pickBox("edges", d.edges.length, "Clique nas arestas no modelo (clique de novo remove).")}
            <Row k="Distância">
              <Mm v={d.d} set={(v) => set<"chamfer">({ d: v })} />
            </Row>
          </>
        );
      case "shell":
        return (
          <>
            {pickBox("faces", d.faces.length, "Faces a remover (abertas). Sem faces = sólido oco fechado.")}
            <Row k="Espessura">
              <Mm v={d.thickness} set={(v) => set<"shell">({ thickness: v })} />
            </Row>
          </>
        );
      case "hole":
        return (
          <>
            {sketchSelect(d.sketch, (v) => set<"hole">({ sketch: v }), "Centros")}
            <div className="fd-note">Cada ponto ou círculo do esboço vira um furo.</div>
            <Row k="Diâmetro">
              <Mm v={d.d} set={(v) => set<"hole">({ d: v })} />
            </Row>
            <Check v={d.through} set={(v) => set<"hole">({ through: v })} label="Passante" />
            {!d.through && (
              <Row k="Profundidade">
                <Mm v={d.depth} set={(v) => set<"hole">({ depth: v })} />
              </Row>
            )}
            <Check v={d.reverse} set={(v) => set<"hole">({ reverse: v })} label="Inverter sentido" />
            <Check v={!!d.cbore} set={(v) => set<"hole">({ cbore: v ? { d: Math.round(d.d * 1.8), depth: 5 } : null, csink: null })} label="Rebaixo (cabeça cilíndrica)" />
            {d.cbore && (
              <>
                <Row k="Ø rebaixo">
                  <Mm v={d.cbore.d} set={(v) => set<"hole">({ cbore: { ...d.cbore!, d: v } })} />
                </Row>
                <Row k="Prof. rebaixo">
                  <Mm v={d.cbore.depth} set={(v) => set<"hole">({ cbore: { ...d.cbore!, depth: v } })} />
                </Row>
              </>
            )}
            <Check v={!!d.csink} set={(v) => set<"hole">({ csink: v ? { d: Math.round(d.d * 2), angle: 90 } : null, cbore: null })} label="Escareado (cabeça chata)" />
            {d.csink && (
              <>
                <Row k="Ø escareado">
                  <Mm v={d.csink.d} set={(v) => set<"hole">({ csink: { ...d.csink!, d: v } })} />
                </Row>
                <Row k="Ângulo">
                  <Mm v={d.csink.angle} unit="°" set={(v) => set<"hole">({ csink: { ...d.csink!, angle: v } })} />
                </Row>
              </>
            )}
          </>
        );
      case "mirror":
        return (
          <>
            <PlaneField plane={d.plane} onChange={(pl) => set<"mirror">({ plane: pl })} picking={slot === "plane"} onPick={() => setSlot(slot === "plane" ? null : "plane")} />
            {targetsPick(d.targets, (t) => set<"mirror">({ targets: t }), true)}
          </>
        );
      case "pattern":
        return (
          <>
            <Row k="Tipo">
              <div className="fd-seg">
                {(["linear", "circular"] as const).map((k) => (
                  <button key={k} className={d.kind === k ? "on" : ""} onClick={() => set<"pattern">({ kind: k, dir: k === "circular" ? { t: "axis", a: "Z" } : { t: "axis", a: "X" } })}>
                    {k === "linear" ? "Linear" : "Circular"}
                  </button>
                ))}
              </div>
            </Row>
            {targetsPick(d.targets, (t) => set<"pattern">({ targets: t ?? [] }), false)}
            <AxisField dir={d.dir} circular={d.kind === "circular"} onChange={(a) => set<"pattern">({ dir: a })} picking={slot === "dir"} onPick={() => setSlot(slot === "dir" ? null : "dir")} />
            <Row k="Quantidade">
              <Mm v={d.count} unit="un" set={(v) => set<"pattern">({ count: Math.round(v) })} />
            </Row>
            {d.kind === "linear" ? (
              <Row k="Passo">
                <Mm v={d.spacing} set={(v) => set<"pattern">({ spacing: v })} />
              </Row>
            ) : (
              <Row k="Ângulo total">
                <Mm v={d.angle} unit="°" set={(v) => set<"pattern">({ angle: v })} />
              </Row>
            )}
            <Check v={d.reverse} set={(v) => set<"pattern">({ reverse: v })} label="Inverter sentido" />
          </>
        );
      case "combine": {
        const others = Object.values(p.model.nodes).filter((n) => n.kind === "body" && n.id !== p.body);
        return (
          <>
            <Row k="Operação">
              <div className="fd-seg">
                {(["join", "cut", "intersect"] as const).map((o) => (
                  <button key={o} className={d.op === o ? "on" : ""} onClick={() => set<"combine">({ op: o })} data-op={o}>
                    {{ join: "União", cut: "Corte", intersect: "Interseção" }[o]}
                  </button>
                ))}
              </div>
            </Row>
            <div className="fd-list">
              <div className="fd-list-h">Corpos-ferramenta</div>
              {!others.length && <div className="fd-note">Não há outros corpos no modelo.</div>}
              {others.map((n) => (
                <label key={n.id} className="fd-check">
                  <input type="checkbox" checked={d.tools.includes(n.id)} onChange={(e) => set<"combine">({ tools: e.target.checked ? [...d.tools, n.id] : d.tools.filter((x) => x !== n.id) })} />
                  {n.name}
                </label>
              ))}
              <div className="fd-note">Os corpos-ferramenta ficam ocultos após a operação e continuam editáveis.</div>
            </div>
          </>
        );
      }
      default:
        return null;
    }
  })();

  const fake = useMemo(() => ({ ...(d as object), id: featId, name }) as Feature, [d, featId, name]);
  return (
    <div className="fd" role="dialog" aria-label={FEATURE_LABEL[kind]} onPointerDown={(e) => e.stopPropagation()} data-feature-dialog={kind}>
      <div className="fd-h">
        <Icon name={featureIcon(fake)} />
        <b>{p.editing ? `Editar ${FEATURE_LABEL[kind].toLowerCase()}` : FEATURE_LABEL[kind]}</b>
        <div className="spacer" />
        <button className="ibtn" title="Cancelar (Esc)" onClick={p.onCancel}>
          <Icon name="close" />
        </button>
      </div>
      <div className="fd-b">
        <Row k="Nome">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} spellCheck={false} data-field="name" />
        </Row>
        {form}
      </div>
      <div className={`fd-st${state.error ? " bad" : ""}`} data-testid="feature-status">
        {state.busy ? (
          <>
            <span className="spinner sm" /> Calculando prévia…
          </>
        ) : state.error ? (
          <>
            <Icon name="warn" /> {state.error}
          </>
        ) : (
          <>Prévia OK · {Math.round(state.ms)} ms</>
        )}
        {state.warn && !state.error && <div className="fd-warn">{state.warn}</div>}
      </div>
      <div className="fd-f">
        <button className="btn primary" onClick={ok} disabled={!!state.error || state.busy || errs.length > 0} data-testid="feature-ok">
          OK
        </button>
        <button className="btn" onClick={p.onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function PlaneField({ plane, onChange, picking, onPick }: { plane: PlaneRef; onChange: (p: PlaneRef) => void; picking: boolean; onPick: () => void }) {
  return (
    <>
      <Row k="Plano">
        <select
          value={plane.t === "std" ? plane.plane : "face"}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "face") onPick();
            else onChange({ t: "std", plane: v as StdPlane, offset: plane.offset });
          }}
        >
          {(["XY", "XZ", "YZ"] as const).map((k) => (
            <option key={k} value={k}>
              {PLANE_LABEL[k]}
            </option>
          ))}
          <option value="face">Face plana do modelo…</option>
        </select>
      </Row>
      <Row k="Deslocamento">
        <Mm v={plane.offset} set={(v) => onChange({ ...plane, offset: v })} />
      </Row>
      {(picking || plane.t === "face") && (
        <div className={`fd-pick${picking ? " on" : ""}`}>
          <button className="btn" onClick={onPick}>
            <Icon name="face3d" />
            {picking ? "Clique numa face plana…" : "Escolher outra face"}
          </button>
          {plane.t === "face" && !picking && <span>face escolhida</span>}
        </div>
      )}
    </>
  );
}

function AxisField({ dir, circular, onChange, picking, onPick }: { dir: AxisRef; circular: boolean; onChange: (a: AxisRef) => void; picking: boolean; onPick: () => void }) {
  return (
    <>
      <Row k={circular ? "Eixo" : "Direção"}>
        <select
          value={dir.t === "axis" ? dir.a : "pick"}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "pick") onPick();
            else onChange({ t: "axis", a: v as "X" });
          }}
        >
          <option value="X">Eixo X da peça</option>
          <option value="Y">Eixo Y da peça</option>
          <option value="Z">Eixo Z da peça</option>
          <option value="pick">{circular ? "Aresta reta ou face cilíndrica…" : "Aresta reta do modelo…"}</option>
        </select>
      </Row>
      {(picking || dir.t !== "axis") && (
        <div className={`fd-pick${picking ? " on" : ""}`}>
          <button className="btn" onClick={onPick}>
            <Icon name="edge3d" />
            {picking ? "Clique numa aresta ou face…" : "Escolher outra"}
          </button>
          {dir.t !== "axis" && !picking && <span>{dir.t === "edge" ? "aresta escolhida" : dir.t === "face" ? "eixo da face" : "linha do esboço"}</span>}
        </div>
      )}
    </>
  );
}
