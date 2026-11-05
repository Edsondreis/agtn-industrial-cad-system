import type { Change, Layer } from "@agtn/document";
import {
  DIM_COLOR_EXT,
  DIM_COLOR_INT,
  type DimRef,
  MATERIALS,
  type MaterialId,
  PROCESS_LABEL,
  PROFILE_DEFS,
  type BendProcess,
  type ProfileKind,
  type ProfileParams,
  type RollRef,
  SM_LAYERS,
  SOURCE_LABEL,
  type SolveResult,
  buildProfileInput,
  flatPatternEntities,
  fmtMM,
  lookupK,
  materialById,
  rollingFlatEntities,
  rollingSectionEntities,
  sectionEntities,
  solveProfile,
  solveRolling,
} from "@agtn/sheetmetal";
import { type Entity, formatNumber } from "@agtn/geometry";
import { useEffect, useMemo, useState } from "react";
import type { CadController } from "../cad/controller";
import { aciColor } from "../cad/renderer";
import { textsToGeometry } from "../lasertext/fonts";
import { MeasureField, MeasureLegend } from "../ui/MeasureField";
import { Icon } from "../ui/Icons";
import { useCtl } from "../ui/hooks";
import { CalibrationDialog, KTablesDialog } from "./KTables";
import { PreviewCanvas } from "./PreviewCanvas";
import { readSM, writeSM } from "./state";

const SM_LAYER_DEFS: Layer[] = SM_LAYERS.map((l) => ({ name: l.name, color: l.color, lineweight: l.lineweight, linetype: l.linetype, visible: true, locked: false }));
type Kind = ProfileKind | "CALANDRA";

const defaultsFor = (kind: ProfileKind, fab?: ProfileParams["fab"]): ProfileParams => ({
  ...PROFILE_DEFS[kind].defaults(),
  fab: fab ?? { material: "aco_carbono", process: "ar", toolName: "", vOpening: null, punchRadius: null, kTableId: "padrao-agtn" },
});

interface Config {
  angleMode: "dobra" | "interno";
  advancedRefs: boolean;
  kMode: "manual" | "tabela";
  kRoll: number;
  markGeom: boolean;
  markHeight: number;
  dims: boolean;
  notes: boolean;
  regions: boolean;
  exportLayers: string[];
}
let savedConfig: Config = {
  angleMode: "dobra",
  advancedRefs: false,
  kMode: "tabela",
  kRoll: 0.5,
  markGeom: true,
  markHeight: 5,
  dims: true,
  notes: true,
  regions: true,
  exportLayers: SM_LAYERS.filter((l) => l.exportDefault).map((l) => l.name),
};

export interface SheetMetalProps {
  ctl: CadController;
  onInsert: (ents: Entity[], layerChanges: () => Change[], label: string) => void;
  onExportDxf: (ents: Entity[], layers: Layer[], layerFilter: string[], name: string) => void;
}

/** Área PLANIFICAÇÃO — AGTN SHEET METAL (dobra e calandra). */
export function SheetMetalWorkspace({ ctl, onInsert, onExportDxf }: SheetMetalProps) {
  useCtl(ctl, "state");
  const sm = readSM(ctl.doc);
  const [kind, setKind] = useState<Kind>("L");
  const [params, setParams] = useState<ProfileParams>(() => defaultsFor("L"));
  const [roll, setRoll] = useState({ diameter: 1000, ref: "externo" as RollRef, T: 6.35, width: 1000, angleDeg: 360 });
  const [tab, setTab] = useState<"peca" | "config">("peca");
  const [cfg, setCfgState] = useState<Config>(savedConfig);
  const setCfg = (p: Partial<Config>) =>
    setCfgState((s) => {
      savedConfig = { ...s, ...p };
      return savedConfig;
    });
  const [dlg, setDlg] = useState<null | "k" | "cal">(null);
  const isRoll = kind === "CALANDRA";
  const def = PROFILE_DEFS[params.kind];
  const table = sm.kTables.find((t) => t.id === params.fab.kTableId) ?? sm.kTables[0];

  const effective: ProfileParams = useMemo(() => {
    if (cfg.kMode === "manual") return params;
    return {
      ...params,
      bends: params.bends.map((b) => {
        const rule = lookupK(table, { material: params.fab.material, process: params.fab.process, T: params.T, R: b.R });
        return rule ? { ...b, K: rule.k, kSource: rule.source, kRuleId: rule.id } : { ...b, kSource: "manual", kRuleId: null };
      }),
    };
  }, [params, cfg.kMode, table]);
  const missingRule = !isRoll && cfg.kMode === "tabela" && effective.bends.some((b) => b.kRuleId === null);

  const result: SolveResult | null = useMemo(() => {
    if (isRoll) return null;
    try {
      return solveProfile(buildProfileInput(effective));
    } catch {
      return null;
    }
  }, [effective, isRoll]);
  const rollRes = useMemo(() => solveRolling({ ...roll, K: cfg.kRoll }), [roll, cfg.kRoll]);

  const title = isRoll
    ? `CALANDRA Ø${fmtMM(roll.diameter, 1)} ${roll.ref === "externo" ? "EXT" : "INT"} #${fmtMM(roll.T, 2)} x ${fmtMM(roll.width, 0)}`
    : `PERFIL ${params.kind.replace("_", " ")} ${params.dims.map((d) => fmtMM(d.value, 1)).join("x")} #${fmtMM(params.T, 2)}`;
  const flatRaw = useMemo(() => {
    if (isRoll) return rollingFlatEntities(rollRes, { dims: cfg.dims, markHeight: cfg.markHeight });
    return result?.ok ? flatPatternEntities(result, { dims: cfg.dims, notes: cfg.notes, bendRegions: cfg.regions, title, markHeight: cfg.markHeight }) : [];
  }, [isRoll, rollRes, result, cfg.dims, cfg.notes, cfg.regions, cfg.markHeight, title]);
  const section = useMemo(() => (isRoll ? rollingSectionEntities(rollRes) : result?.section ? sectionEntities(result) : []), [isRoll, rollRes, result]);
  const [flat, setFlat] = useState<Entity[]>(flatRaw);
  useEffect(() => {
    if (!cfg.markGeom) {
      setFlat(flatRaw);
      return;
    }
    let alive = true;
    textsToGeometry(flatRaw)
      .then((g) => alive && setFlat(g))
      .catch(() => alive && setFlat(flatRaw));
    return () => {
      alive = false;
    };
  }, [flatRaw, cfg.markGeom]);

  const set = (p: Partial<ProfileParams>) => setParams((s) => ({ ...s, ...p }));
  const setFab = (p: Partial<ProfileParams["fab"]>) => setParams((s) => ({ ...s, fab: { ...s.fab, ...p } }));
  const setDim = (i: number, p: Partial<ProfileParams["dims"][number]>) => setParams((s) => ({ ...s, dims: s.dims.map((d, k) => (k === i ? { ...d, ...p } : d)) }));
  const setBend = (j: number, p: Partial<ProfileParams["bends"][number]>) =>
    setParams((s) => ({ ...s, bends: s.bends.map((b, k) => (k === j ? { ...b, ...p, kSource: p.K !== undefined ? "manual" : b.kSource } : b)) }));
  const setAllRefs = (ref: DimRef) => setParams((s) => ({ ...s, dims: s.dims.map((d) => ({ ...d, ref })) }));
  const globalRef: DimRef | "misto" = params.dims.every((d) => d.ref === params.dims[0].ref) ? params.dims[0].ref : "misto";
  const pickKind = (k: Kind) => {
    setKind(k);
    if (k !== "CALANDRA") setParams(defaultsFor(k, params.fab));
  };

  const layerChanges = (): Change[] => {
    const out: Change[] = [];
    let n = ctl.doc.layers.length;
    for (const l of SM_LAYER_DEFS) if (!ctl.doc.layer(l.name)) out.push({ kind: "layer-add", layer: l, index: n++ });
    return out;
  };
  const density = materialById(params.fab.material).density;
  const okNow = isRoll ? rollRes.ok : !!result?.ok;
  const devLen = isRoll ? rollRes.developed : result?.developedLength ?? 0;
  const width = isRoll ? roll.width : params.partLength;
  const T = isRoll ? roll.T : params.T;
  const weightKg = okNow ? (devLen * width * T * density) / 1e6 : 0;
  const issues = isRoll ? rollRes.issues : result?.issues ?? [];
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const bendIssue = (j: number) => result?.issues.some((i) => i.ref?.bend === j && i.level === "error");
  const flangeIssue = (i: number) => result?.issues.some((x) => x.ref?.flange === i && x.level === "error");

  const materialRow = (
    <div className="sm-row">
      <span className="k">Material</span>
      <select value={params.fab.material} onChange={(e) => setFab({ material: e.target.value as MaterialId })}>
        {MATERIALS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  );

  /* ------------------------------------ PEÇA ------------------------------------ */
  const pecaTab = (
    <>
      <div className="sm-sec">
        <h4>Tipo</h4>
        <div className="profile-pick" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          {([...(Object.keys(PROFILE_DEFS) as ProfileKind[]), "CALANDRA"] as Kind[]).map((k) => (
            <button key={k} className={kind === k ? "on" : ""} onClick={() => pickKind(k)} title={k === "CALANDRA" ? "Chapa calandrada (cilindro ou segmento)" : PROFILE_DEFS[k as ProfileKind].description}>
              <Icon name={k === "L" ? "profL" : k === "U" ? "profU" : k === "CALANDRA" ? "roll" : "profC"} />
              {k === "U_ENRIJECIDO" ? "U enrij." : k === "CALANDRA" ? "Calandra" : `Perfil ${k}`}
            </button>
          ))}
        </div>
      </div>

      {isRoll ? (
        <div className="sm-sec">
          <h4>Calandra (mm)</h4>
          <div className="seg full" style={{ marginBottom: 10 }}>
            <button className={roll.ref === "externo" ? "on" : ""} onClick={() => setRoll({ ...roll, ref: "externo" })}>
              Diâmetro externo
            </button>
            <button className={roll.ref === "interno" ? "on" : ""} onClick={() => setRoll({ ...roll, ref: "interno" })}>
              Diâmetro interno
            </button>
          </div>
          <MeasureField
            label="Diâmetro"
            kind={roll.ref === "externo" ? "ext" : "int"}
            tag={roll.ref === "externo" ? "ØE" : "ØI"}
            value={roll.diameter}
            min={0}
            onCommit={(v) => setRoll({ ...roll, diameter: v })}
            onTagClick={() => setRoll({ ...roll, ref: roll.ref === "externo" ? "interno" : "externo" })}
          />
          <MeasureField label="Espessura" kind="thk" value={roll.T} min={0} onCommit={(v) => setRoll({ ...roll, T: v })} />
          <MeasureField label="Largura (altura do cilindro)" kind="len" value={roll.width} min={0} onCommit={(v) => setRoll({ ...roll, width: v })} />
          <MeasureField label="Ângulo calandrado" kind="ang" unit="°" digits={2} value={roll.angleDeg} min={0} onCommit={(v) => setRoll({ ...roll, angleDeg: v })} />
          <div className="note" style={{ marginBottom: 6 }}>360° = volta completa · menor que 360° = segmento.</div>
          {materialRow}
        </div>
      ) : (
        <>
          <div className="sm-sec">
            <h4>Medidas (mm)</h4>
            <div style={{ marginBottom: 8 }}>
              <div className="seg">
                <button className={globalRef === "externa" ? "on" : ""} onClick={() => setAllRefs("externa")}>
                  Externas
                </button>
                <button className={globalRef === "interna" ? "on" : ""} onClick={() => setAllRefs("interna")}>
                  Internas
                </button>
              </div>
              {globalRef === "misto" && <span className="note" style={{ marginLeft: 8, color: "var(--warn)" }}>Referência mista</span>}
            </div>
            {params.dims.map((d, i) => (
              <MeasureField
                key={i}
                label={def.flangeLabels[i]}
                kind={d.ref === "externa" ? "ext" : "int"}
                value={d.value}
                min={0}
                bad={flangeIssue(i)}
                onCommit={(v) => setDim(i, { value: v })}
                onTagClick={cfg.advancedRefs ? () => setDim(i, { ref: (d.ref === "externa" ? "interna" : "externa") as DimRef }) : undefined}
              />
            ))}
            <MeasureField label="Espessura" kind="thk" value={params.T} min={0} onCommit={(v) => set({ T: v })} />
            <MeasureField label="Comprimento" kind="len" value={params.partLength} min={0} onCommit={(v) => set({ partLength: v })} />
            {materialRow}
          </div>
          <div className="sm-sec">
            <h4>Dobras</h4>
            {effective.bends.map((b, j) => (
              <div key={j} className="bend-card" style={bendIssue(j) ? { borderColor: "var(--err)" } : undefined}>
                <div className="t" style={{ fontSize: 11 }}>{def.bendLabels[j]}</div>
                <MeasureField
                  label={cfg.angleMode === "dobra" ? "Ângulo de dobra" : "Ângulo interno"}
                  kind="ang"
                  tag={cfg.angleMode === "dobra" ? "θ" : "α"}
                  unit="°"
                  digits={2}
                  title={cfg.angleMode === "dobra" ? "θ = mudança de direção da chapa (L reto = 90°)" : "α = ângulo entre as abas = 180° − θ"}
                  value={cfg.angleMode === "dobra" ? b.angleDeg : 180 - b.angleDeg}
                  onCommit={(v) => setBend(j, { angleDeg: cfg.angleMode === "dobra" ? v : 180 - v })}
                />
                <MeasureField label="Raio interno" kind="rad" tag="Ri" value={b.R} min={0} onCommit={(v) => setBend(j, { R: v })} />
              </div>
            ))}
            {params.bends.length > 1 && (
              <button className="btn" style={{ width: "100%", marginTop: 8 }} onClick={() => setParams((s) => ({ ...s, bends: s.bends.map((b) => ({ ...s.bends[0], kRuleId: b.kRuleId })) }))}>
                Todas iguais à Dobra 1
              </button>
            )}
            {missingRule && <div className="errbox">Sem fator K na tabela para este material/espessura/raio. Veja CONFIGURAÇÕES.</div>}
            <MeasureLegend kinds={["ext", "int", "thk", "ang", "rad"]} />
          </div>
        </>
      )}
    </>
  );

  /* -------------------------------- CONFIGURAÇÕES -------------------------------- */
  const configTab = (
    <>
      <div className="sm-sec">
        <h4>Dobra</h4>
        <div className="sm-row">
          <span className="k">Ângulo informado</span>
          <div className="seg">
            <button className={cfg.angleMode === "dobra" ? "on" : ""} onClick={() => setCfg({ angleMode: "dobra" })} title="θ = mudança de direção da chapa (L reto = 90°)">
              Dobra θ
            </button>
            <button className={cfg.angleMode === "interno" ? "on" : ""} onClick={() => setCfg({ angleMode: "interno" })} title="α = ângulo entre abas = 180° − θ">
              Interno α
            </button>
          </div>
        </div>
        <label className="chk">
          <input type="checkbox" checked={cfg.advancedRefs} onChange={(e) => setCfg({ advancedRefs: e.target.checked })} />
          Referência externa/interna por dimensão
        </label>
        <div className="sm-row" style={{ marginTop: 6 }}>
          <span className="k">Fator K</span>
          <div className="seg">
            <button className={cfg.kMode === "tabela" ? "on" : ""} onClick={() => setCfg({ kMode: "tabela" })}>
              Tabela
            </button>
            <button className={cfg.kMode === "manual" ? "on" : ""} onClick={() => setCfg({ kMode: "manual" })}>
              Manual
            </button>
          </div>
        </div>
        {cfg.kMode === "manual" && !isRoll && (
          <div>
            {params.bends.map((b, j) => (
              <MeasureField key={j} label={def.bendLabels[j]} kind="k" unit="" digits={4} value={b.K} min={0} onCommit={(v) => setBend(j, { K: v })} />
            ))}
          </div>
        )}
        <div className="sm-row">
          <span className="k">Tabela de K</span>
          <select value={table.id} onChange={(e) => setFab({ kTableId: e.target.value })}>
            {sm.kTables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => setDlg("k")}>
            Editar tabelas de K…
          </button>
          <button className="btn" style={{ flex: 1 }} onClick={() => setDlg("cal")}>
            Calibração…
          </button>
        </div>
      </div>
      <div className="sm-sec">
        <h4>Processo e ferramental</h4>
        <div className="sm-row">
          <span className="k">Processo</span>
          <select value={params.fab.process} onChange={(e) => setFab({ process: e.target.value as BendProcess })}>
            {(Object.keys(PROCESS_LABEL) as BendProcess[]).map((p) => (
              <option key={p} value={p}>
                {PROCESS_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="sm-row">
          <span className="k">Ferramenta</span>
          <input value={params.fab.toolName} placeholder="ex.: punção 88° R1" onChange={(e) => setFab({ toolName: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
        </div>
        <MeasureField label="Abertura da matriz" kind="len" tag="V" value={params.fab.vOpening ?? NaN} min={0} onCommit={(v) => setFab({ vOpening: v || null })} />
        <MeasureField label="Raio do punção" kind="rad" tag="Rp" value={params.fab.punchRadius ?? NaN} min={0} onCommit={(v) => setFab({ punchRadius: v || null })} />
      </div>
      <div className="sm-sec">
        <h4>Calandra</h4>
        <MeasureField label="Fator K da calandra" kind="k" unit="" digits={3} value={cfg.kRoll} min={0} onCommit={(v) => setCfg({ kRoll: v })} />
        <div className="note">0,50 = estimativa de partida (eixo neutro no meio da espessura).</div>
      </div>
      <div className="sm-sec">
        <h4>Saída</h4>
        <label className="chk">
          <input type="checkbox" checked={cfg.markGeom} onChange={(e) => setCfg({ markGeom: e.target.checked })} /> Marcação como geometria (para o laser)
        </label>
        <MeasureField label="Altura da marcação" kind="len" tag="H" value={cfg.markHeight} min={1} onCommit={(v) => setCfg({ markHeight: v })} />
        <label className="chk">
          <input type="checkbox" checked={cfg.notes} onChange={(e) => setCfg({ notes: e.target.checked })} /> Marcação das dobras
        </label>
        <label className="chk">
          <input type="checkbox" checked={cfg.dims} onChange={(e) => setCfg({ dims: e.target.checked })} /> Cotas de fabricação
        </label>
        <label className="chk">
          <input type="checkbox" checked={cfg.regions} onChange={(e) => setCfg({ regions: e.target.checked })} /> Limites da região de dobra
        </label>
        <h4 style={{ marginTop: 10 }}>Camadas exportadas no DXF</h4>
        {SM_LAYERS.filter((l) => l.name !== "SECAO_PERFIL").map((l) => (
          <label key={l.name} className="chk" title={l.description}>
            <input
              type="checkbox"
              checked={cfg.exportLayers.includes(l.name)}
              onChange={(e) => setCfg({ exportLayers: e.target.checked ? [...cfg.exportLayers, l.name] : cfg.exportLayers.filter((x) => x !== l.name) })}
            />
            <span className="swatch" style={{ background: aciColor(l.color), width: 10, height: 10 }} />
            <span className="mono">{l.name}</span>
          </label>
        ))}
      </div>
      {!isRoll && (
        <div className="sm-sec">
          <h4>Configurações salvas no projeto</h4>
          <button
            className="btn"
            style={{ width: "100%" }}
            onClick={() => {
              const name = `${title} — ${new Date().toLocaleString("pt-BR")}`;
              writeSM(ctl.doc, { ...sm, presets: [...sm.presets, { name, params: effective }] }, "Salvar configuração de dobra");
              ctl.message(`Configuração salva no projeto: ${name}`);
            }}
          >
            Salvar configuração atual
          </button>
          {sm.presets.length > 0 && (
            <select
              style={{ width: "100%", marginTop: 6, height: 24, background: "var(--bg-3)", border: "1px solid var(--line-2)" }}
              value=""
              onChange={(e) => {
                const p = sm.presets[Number(e.target.value)];
                if (p) {
                  setKind(p.params.kind);
                  setParams(structuredClone(p.params));
                  setTab("peca");
                }
              }}
            >
              <option value="">Carregar configuração salva…</option>
              {sm.presets.map((p, i) => (
                <option key={i} value={i}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </>
  );

  return (
    <div className="sm">
      <div className="sm-left">
        <div className="sm-tabs">
          <button className={tab === "peca" ? "on" : ""} onClick={() => setTab("peca")}>
            PEÇA
          </button>
          <button className={tab === "config" ? "on" : ""} onClick={() => setTab("config")}>
            CONFIGURAÇÕES
          </button>
        </div>
        {tab === "peca" ? pecaTab : configTab}
      </div>

      <div className="sm-center">
        <PreviewCanvas
          entities={section}
          layers={SM_LAYER_DEFS}
          label={isRoll ? "Peça calandrada — vista" : "Perfil dobrado — seção transversal"}
          legend={
            <>
              <span>
                <i style={{ background: aciColor(DIM_COLOR_EXT) }} />
                externa
              </span>
              <span>
                <i style={{ background: aciColor(DIM_COLOR_INT) }} />
                interna
              </span>
              <span>
                <i style={{ background: aciColor(6) }} />
                eixo neutro
              </span>
            </>
          }
        />
        <PreviewCanvas
          entities={flat}
          layers={SM_LAYER_DEFS}
          label="Planificação — desenvolvimento plano"
          legend={
            <>
              <span>
                <i style={{ background: aciColor(7) }} />
                corte
              </span>
              {!isRoll && (
                <span>
                  <i style={{ background: aciColor(1) }} />
                  dobra
                </span>
              )}
              <span>
                <i style={{ background: aciColor(3) }} />
                marcação
              </span>
            </>
          }
        />
      </div>

      <div className="sm-right">
        <div className="sm-sec">
          <h4>Desenvolvimento</h4>
          {!okNow ? (
            <div className="errbox">Não foi possível calcular. Corrija os itens abaixo.</div>
          ) : (
            <>
            <div className="result-big" title="Comprimento da chapa plana a cortar">
              <span className="k">Desenvolvido</span>
              <span>
                <span className="v">{fmtMM(devLen, 3)}</span>
                <span className="u">mm</span>
              </span>
            </div>
            <div className="res">
              <span className="k">Largura</span>
              <span className="v">{fmtMM(width, 3)}</span>
              <span className="k">Blank</span>
              <span className="v">
                {fmtMM(devLen, 2)} × {fmtMM(width, 2)} × {fmtMM(T, 2)}
              </span>
              <span className="k">Peso teórico</span>
              <span className="v">{formatNumber(weightKg, 3, ",")} kg</span>
              <span className="k">Comprimento de corte</span>
              <span className="v">{formatNumber((2 * (devLen + width)) / 1000, 3, ",")} m</span>
            </div>
            </>
          )}
          {errors.map((i, k) => (
            <div key={k} className="errbox">
              {i.message}
            </div>
          ))}
          {warnings.map((i, k) => (
            <div key={k} className="warnbox">
              {i.message}
            </div>
          ))}
        </div>

        {isRoll && rollRes.ok && (
          <div className="sm-sec">
            <h4>Calandragem</h4>
            <div className="res">
              <span className="k">Raio interno Ri</span>
              <span className="v">{fmtMM(rollRes.Ri, 3)}</span>
              <span className="k">Raio externo Re</span>
              <span className="v">{fmtMM(rollRes.Re, 3)}</span>
              <span className="k">Raio neutro (K {fmtMM(cfg.kRoll, 2)})</span>
              <span className="v">{fmtMM(rollRes.Rn, 3)}</span>
              <span className="k">Ø interno / externo</span>
              <span className="v">
                {fmtMM(2 * rollRes.Ri, 2)} / {fmtMM(2 * rollRes.Re, 2)}
              </span>
              {roll.angleDeg < 360 && (
                <>
                  <span className="k">Corda / flecha externa</span>
                  <span className="v">
                    {fmtMM(rollRes.chordOuter, 2)} / {fmtMM(rollRes.sagittaOuter, 2)}
                  </span>
                </>
              )}
            </div>
            <h4 style={{ marginTop: 10 }}>Marcação na chapa</h4>
            {rollRes.marking.map((m) => (
              <div key={m} className="mono" style={{ fontSize: 11, color: "#7fe0a0" }}>
                {m}
              </div>
            ))}
          </div>
        )}

        {!isRoll && result?.ok && (
          <div className="sm-sec">
            <h4>Dobras</h4>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Dobra</th>
                  <th style={{ textAlign: "right" }}>θ</th>
                  <th style={{ textAlign: "right" }}>R</th>
                  <th style={{ textAlign: "right" }}>K</th>
                  <th style={{ textAlign: "right" }}>BD</th>
                  <th style={{ textAlign: "right" }}>Linha</th>
                </tr>
              </thead>
              <tbody>
                {result.bends.map((b, j) => (
                  <tr key={j} title={`BA ${fmtMM(b.BA, 4)} · OSB ${fmtMM(b.OSB, 4)} · ISB ${fmtMM(b.ISB, 4)} · K ${SOURCE_LABEL[effective.bends[j].kSource]}`}>
                    <td>D{j + 1}</td>
                    <td className="num">{fmtMM(b.thetaDeg, 1)}°</td>
                    <td className="num">{fmtMM(b.R, 2)}</td>
                    <td className="num" style={{ color: effective.bends[j].kSource === "calibrado" ? "var(--ok)" : effective.bends[j].kSource === "estimado" ? "var(--warn)" : undefined }}>
                      {fmtMM(b.K, 3)}
                    </td>
                    <td className="num">{fmtMM(b.BD, 3)}</td>
                    <td className="num">{fmtMM(b.xLine, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="tbl" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Aba</th>
                  <th style={{ textAlign: "right" }}>Externa</th>
                  <th style={{ textAlign: "right" }}>Interna</th>
                  <th style={{ textAlign: "right" }}>Reto</th>
                </tr>
              </thead>
              <tbody>
                {result.flanges.map((f) => (
                  <tr key={f.index}>
                    <td>{f.label}</td>
                    <td className="num">{fmtMM(f.lengthB, 2)}</td>
                    <td className="num">{fmtMM(f.lengthA, 2)}</td>
                    <td className="num">{fmtMM(f.flat, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="note" style={{ marginTop: 4 }}>
              K em laranja = estimativa; verde = calibrado. Passe o mouse para BA/OSB/ISB.
            </div>
          </div>
        )}

        {okNow && (
          <div className="sm-sec">
            <button className="btn primary" style={{ width: "100%" }} onClick={() => onInsert(flat, layerChanges, isRoll ? "Planificação da calandra" : "Planificação")}>
              Inserir planificação no desenho
            </button>
            <button
              className="btn"
              style={{ width: "100%", marginTop: 6 }}
              onClick={async () => onInsert(cfg.markGeom ? await textsToGeometry(section) : section, layerChanges, isRoll ? "Vista da calandra" : "Seção do perfil")}
            >
              {isRoll ? "Inserir vista no desenho" : "Inserir seção no desenho"}
            </button>
            <button
              className="btn"
              style={{ width: "100%", marginTop: 6 }}
              disabled={!cfg.exportLayers.length}
              onClick={() => onExportDxf(flat, SM_LAYER_DEFS, cfg.exportLayers, `${title.replace(/[^\w\-x#,]+/g, "_")}.dxf`)}
            >
              Exportar DXF (R12, mm)
            </button>
            <div className="note" style={{ marginTop: 4 }}>
              DXF: {cfg.exportLayers.join(", ")}
            </div>
          </div>
        )}
      </div>
      {dlg === "k" && <KTablesDialog ctl={ctl} onClose={() => setDlg(null)} />}
      {dlg === "cal" && <CalibrationDialog ctl={ctl} tableId={table.id} defaults={effective} onClose={() => setDlg(null)} />}
    </div>
  );
}
