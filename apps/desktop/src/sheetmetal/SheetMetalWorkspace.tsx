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
  SM_LAYERS,
  SOURCE_LABEL,
  type SolveResult,
  buildProfileInput,
  flatPatternEntities,
  fmtMM,
  lookupK,
  materialById,
  sectionEntities,
  solveProfile,
} from "@agtn/sheetmetal";
import { type Entity, formatNumber } from "@agtn/geometry";
import { useMemo, useState } from "react";
import type { CadController } from "../cad/controller";
import { aciColor } from "../cad/renderer";
import { NumField } from "../ui/fields";
import { Icon } from "../ui/Icons";
import { useCtl } from "../ui/hooks";
import { CalibrationDialog, KTablesDialog } from "./KTables";
import { PreviewCanvas } from "./PreviewCanvas";
import { readSM, writeSM } from "./state";

const SM_LAYER_DEFS: Layer[] = SM_LAYERS.map((l) => ({ name: l.name, color: l.color, lineweight: l.lineweight, linetype: l.linetype, visible: true, locked: false }));

const defaultsFor = (kind: ProfileKind, fab?: ProfileParams["fab"]): ProfileParams => ({
  ...PROFILE_DEFS[kind].defaults(),
  fab: fab ?? { material: "aco_carbono", process: "ar", toolName: "", vOpening: null, punchRadius: null, kTableId: "padrao-agtn" },
});

export interface SheetMetalProps {
  ctl: CadController;
  onInsert: (ents: Entity[], layerChanges: () => Change[], label: string) => void;
  onExportDxf: (ents: Entity[], layers: Layer[], layerFilter: string[], name: string) => void;
}

/** Área PLANIFICAÇÃO — AGTN SHEET METAL. */
export function SheetMetalWorkspace({ ctl, onInsert, onExportDxf }: SheetMetalProps) {
  useCtl(ctl, "state");
  const sm = readSM(ctl.doc);
  const [params, setParams] = useState<ProfileParams>(() => defaultsFor("L"));
  const [angleMode, setAngleMode] = useState<"dobra" | "interno">("dobra");
  const [advancedRefs, setAdvancedRefs] = useState(false);
  const [kMode, setKMode] = useState<"manual" | "tabela">("manual");
  const [dlg, setDlg] = useState<null | "k" | "cal">(null);
  const [exportLayers, setExportLayers] = useState<Set<string>>(new Set(SM_LAYERS.filter((l) => l.exportDefault).map((l) => l.name)));
  const [opts, setOpts] = useState({ dims: true, notes: true, regions: true });
  const def = PROFILE_DEFS[params.kind];
  const table = sm.kTables.find((t) => t.id === params.fab.kTableId) ?? sm.kTables[0];

  // K a partir da tabela (por dobra: material, processo, espessura e R/T)
  const effective: ProfileParams = useMemo(() => {
    if (kMode === "manual") return params;
    return {
      ...params,
      bends: params.bends.map((b) => {
        const rule = lookupK(table, { material: params.fab.material, process: params.fab.process, T: params.T, R: b.R });
        return rule ? { ...b, K: rule.k, kSource: rule.source, kRuleId: rule.id } : { ...b, kSource: "manual", kRuleId: null };
      }),
    };
  }, [params, kMode, table]);
  const missingRule = kMode === "tabela" && effective.bends.some((b) => b.kRuleId === null);

  const result: SolveResult | null = useMemo(() => {
    try {
      return solveProfile(buildProfileInput(effective));
    } catch {
      return null;
    }
  }, [effective]);

  const title = `PERFIL ${params.kind.replace("_", " ")} ${params.dims.map((d) => fmtMM(d.value, 1)).join("x")} #${fmtMM(params.T, 2)}`;
  const flat = useMemo(
    () => (result?.ok ? flatPatternEntities(result, { dims: opts.dims, notes: opts.notes, bendRegions: opts.regions, title }) : []),
    [result, opts, title],
  );
  const section = useMemo(() => (result?.section ? sectionEntities(result) : []), [result]);

  const set = (p: Partial<ProfileParams>) => setParams((s) => ({ ...s, ...p }));
  const setDim = (i: number, p: Partial<ProfileParams["dims"][number]>) =>
    setParams((s) => ({ ...s, dims: s.dims.map((d, k) => (k === i ? { ...d, ...p } : d)) }));
  const setBend = (j: number, p: Partial<ProfileParams["bends"][number]>) =>
    setParams((s) => ({ ...s, bends: s.bends.map((b, k) => (k === j ? { ...b, ...p, kSource: p.K !== undefined ? "manual" : b.kSource } : b)) }));
  const setAllRefs = (ref: DimRef) => setParams((s) => ({ ...s, dims: s.dims.map((d) => ({ ...d, ref })) }));
  const globalRef: DimRef | "misto" = params.dims.every((d) => d.ref === params.dims[0].ref) ? params.dims[0].ref : "misto";

  const layerChanges = (): Change[] => {
    const out: Change[] = [];
    let n = ctl.doc.layers.length;
    for (const l of SM_LAYER_DEFS) if (!ctl.doc.layer(l.name)) out.push({ kind: "layer-add", layer: l, index: n++ });
    return out;
  };
  const weightKg = result?.ok ? (result.developedLength * result.partLength * result.T * materialById(params.fab.material).density) / 1e6 : 0;
  const errors = result?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = result?.issues.filter((i) => i.level === "warning") ?? [];
  const bendIssue = (j: number) => result?.issues.some((i) => i.ref?.bend === j && i.level === "error");
  const flangeIssue = (i: number) => result?.issues.some((x) => x.ref?.flange === i && x.level === "error");

  return (
    <div className="sm">
      {/* ------------------------------ PAINEL ESQUERDO ------------------------------ */}
      <div className="sm-left">
        <div className="sm-sec">
          <h4>Tipo de perfil</h4>
          <div className="profile-pick">
            {(Object.keys(PROFILE_DEFS) as ProfileKind[]).map((k) => (
              <button key={k} className={params.kind === k ? "on" : ""} onClick={() => setParams(defaultsFor(k, params.fab))} title={PROFILE_DEFS[k].description}>
                <Icon name={k === "L" ? "profL" : k === "U" ? "profU" : "profC"} />
                {k === "U_ENRIJECIDO" ? "U enrijecido" : `Perfil ${k}`}
              </button>
            ))}
          </div>
          <div className="note" style={{ marginTop: 6 }}>
            {def.description} Próximos: Z, C, cartola, ômega.
          </div>
        </div>

        <div className="sm-sec">
          <h4>Referência das dimensões</h4>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div className="seg">
              <button className={globalRef === "externa" ? "on" : ""} onClick={() => setAllRefs("externa")}>
                Externas
              </button>
              <button className={globalRef === "interna" ? "on" : ""} onClick={() => setAllRefs("interna")}>
                Internas
              </button>
            </div>
            <label className="chk">
              <input type="checkbox" checked={advancedRefs} onChange={(e) => setAdvancedRefs(e.target.checked)} />
              Por dimensão
            </label>
          </div>
          <div className="note" style={{ marginTop: 4 }}>
            Medidas até o vértice virtual (interseção das faces). {globalRef === "misto" && <b style={{ color: "var(--warn)" }}>Referência mista.</b>}
          </div>
        </div>

        <div className="sm-sec">
          <h4>Dimensões (mm)</h4>
          <div className="sm-grid">
            {params.dims.map((d, i) => (
              <span key={i} style={{ display: "contents" }}>
                <span className="k">{def.flangeLabels[i]}</span>
                <NumField className={flangeIssue(i) ? "bad" : ""} value={d.value} min={0} onCommit={(v) => setDim(i, { value: v })} />
                {advancedRefs ? (
                  <select value={d.ref} onChange={(e) => setDim(i, { ref: e.target.value as DimRef })}>
                    <option value="externa">Externa</option>
                    <option value="interna">Interna</option>
                  </select>
                ) : (
                  <span className="note" style={{ color: d.ref === "externa" ? aciColor(DIM_COLOR_EXT) : aciColor(DIM_COLOR_INT) }}>
                    {d.ref === "externa" ? "EXT" : "INT"}
                  </span>
                )}
              </span>
            ))}
            <span className="k">Espessura T</span>
            <NumField value={params.T} min={0} onCommit={(v) => set({ T: v })} />
            <span />
            <span className="k">Comprimento do perfil</span>
            <NumField value={params.partLength} min={0} onCommit={(v) => set({ partLength: v })} />
            <span className="note">ao longo da dobra</span>
          </div>
        </div>

        <div className="sm-sec">
          <h4>Dobras</h4>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
            <span className="note">Ângulo informado:</span>
            <div className="seg">
              <button className={angleMode === "dobra" ? "on" : ""} onClick={() => setAngleMode("dobra")} title="θ = quanto a chapa muda de direção (L reto = 90°)">
                De dobra θ
              </button>
              <button className={angleMode === "interno" ? "on" : ""} onClick={() => setAngleMode("interno")} title="α = ângulo entre as abas = 180° − θ">
                Interno α
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <span className="note">Fator K:</span>
            <div className="seg">
              <button className={kMode === "manual" ? "on" : ""} onClick={() => setKMode("manual")}>
                Manual
              </button>
              <button className={kMode === "tabela" ? "on" : ""} onClick={() => setKMode("tabela")}>
                Tabela
              </button>
            </div>
          </div>
          {effective.bends.map((b, j) => (
            <div key={j} className="bend-card" style={bendIssue(j) ? { borderColor: "var(--err)" } : undefined}>
              <div className="t">{def.bendLabels[j]}</div>
              <div className="sm-grid">
                <span className="k">{angleMode === "dobra" ? "Ângulo θ (°)" : "Ângulo α (°)"}</span>
                <NumField
                  value={angleMode === "dobra" ? b.angleDeg : 180 - b.angleDeg}
                  onCommit={(v) => setBend(j, { angleDeg: angleMode === "dobra" ? v : 180 - v })}
                />
                <span className="note">{angleMode === "dobra" ? `α = ${fmtMM(180 - b.angleDeg, 1)}°` : `θ = ${fmtMM(b.angleDeg, 1)}°`}</span>
                <span className="k">Raio interno R</span>
                <NumField value={b.R} min={0} onCommit={(v) => setBend(j, { R: v })} />
                <span className="note">R/T {params.T > 0 ? fmtMM(b.R / params.T, 2) : "—"}</span>
                <span className="k">Fator K</span>
                <NumField value={b.K} digits={4} min={0} disabled={kMode === "tabela"} onCommit={(v) => setBend(j, { K: v })} />
                <span className={`src-tag ${b.kSource}`} title={SOURCE_LABEL[b.kSource]}>
                  {SOURCE_LABEL[b.kSource].split(" ")[0]}
                </span>
              </div>
            </div>
          ))}
          {params.bends.length > 1 && (
            <button
              className="btn"
              style={{ width: "100%" }}
              title="Copia ângulo, raio e K da primeira dobra para as demais"
              onClick={() => setParams((s) => ({ ...s, bends: s.bends.map((b) => ({ ...s.bends[0], kRuleId: b.kRuleId })) }))}
            >
              Dobras simétricas (copiar Dobra 1)
            </button>
          )}
          {missingRule && <div className="errbox">Sem regra na tabela para este material/processo/espessura/R. Edite a tabela ou use K manual.</div>}
        </div>

        <div className="sm-sec">
          <h4>Fabricação</h4>
          <div className="sm-row">
            <span className="k">Material</span>
            <select value={params.fab.material} onChange={(e) => set({ fab: { ...params.fab, material: e.target.value as MaterialId } })}>
              {MATERIALS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm-row">
            <span className="k">Processo</span>
            <select value={params.fab.process} onChange={(e) => set({ fab: { ...params.fab, process: e.target.value as BendProcess } })}>
              {(Object.keys(PROCESS_LABEL) as BendProcess[]).map((p) => (
                <option key={p} value={p}>
                  {PROCESS_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="sm-row">
            <span className="k">Ferramenta</span>
            <input value={params.fab.toolName} placeholder="ex.: punção 88° R1" onChange={(e) => set({ fab: { ...params.fab, toolName: e.target.value } })} onKeyDown={(e) => e.stopPropagation()} />
          </div>
          <div className="sm-row">
            <span className="k">Abertura V (mm)</span>
            <NumField value={params.fab.vOpening ?? NaN} min={0} onCommit={(v) => set({ fab: { ...params.fab, vOpening: v || null } })} />
          </div>
          <div className="sm-row">
            <span className="k">Raio do punção (mm)</span>
            <NumField value={params.fab.punchRadius ?? NaN} min={0} onCommit={(v) => set({ fab: { ...params.fab, punchRadius: v || null } })} />
          </div>
          <div className="sm-row">
            <span className="k">Tabela de K</span>
            <select value={table.id} onChange={(e) => set({ fab: { ...params.fab, kTableId: e.target.value } })}>
              {sm.kTables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button className="btn" style={{ flex: 1 }} onClick={() => setDlg("k")}>
              Tabelas de K…
            </button>
            <button className="btn" style={{ flex: 1 }} onClick={() => setDlg("cal")}>
              Calibração…
            </button>
          </div>
          {params.fab.vOpening && result?.ok && result.flanges.some((f) => f.flat + 1e-9 < params.fab.vOpening! / 2) && (
            <div className="warnbox">Aba com trecho reto menor que V/2: pode não apoiar nos ombros da matriz (estimativa — confirme com o ferramental).</div>
          )}
        </div>
      </div>

      {/* --------------------------------- CENTRO --------------------------------- */}
      <div className="sm-center">
        <PreviewCanvas
          entities={section}
          layers={SM_LAYER_DEFS}
          label="Perfil dobrado — seção transversal"
          legend={
            <>
              <span>
                <i style={{ background: aciColor(DIM_COLOR_EXT) }} />
                cota externa
              </span>
              <span>
                <i style={{ background: aciColor(DIM_COLOR_INT) }} />
                cota interna
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
              <span>
                <i style={{ background: aciColor(1) }} />
                linha de dobra
              </span>
              <span>
                <i style={{ background: aciColor(8) }} />
                região de dobra
              </span>
            </>
          }
        />
      </div>

      {/* ------------------------------ PAINEL DIREITO ------------------------------ */}
      <div className="sm-right">
        <div className="sm-sec">
          <h4>Desenvolvimento</h4>
          {!result || !result.ok ? (
            <div className="errbox">Não foi possível calcular. Corrija os itens abaixo.</div>
          ) : (
            <div className="res">
              <span className="k">Comprimento desenvolvido</span>
              <span className="v big">{fmtMM(result.developedLength, 3)}</span>
              <span className="k">Largura (comprimento do perfil)</span>
              <span className="v">{fmtMM(result.partLength, 3)}</span>
              <span className="k">Blank</span>
              <span className="v">
                {fmtMM(result.developedLength, 2)} × {fmtMM(result.partLength, 2)} × {fmtMM(result.T, 2)}
              </span>
              <span className="k">Peso teórico ({materialById(params.fab.material).name})</span>
              <span className="v">{formatNumber(weightKg, 3, ",")} kg</span>
            </div>
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

        {result?.ok && (
          <>
            <div className="sm-sec">
              <h4>Compensações por dobra</h4>
              {result.bends.map((b, j) => (
                <div key={j} className="bend-card">
                  <div className="t" style={{ display: "flex", justifyContent: "space-between" }}>
                    {b.label}
                    <span className={`src-tag ${effective.bends[j].kSource}`}>K {SOURCE_LABEL[effective.bends[j].kSource].toLowerCase()}</span>
                  </div>
                  <div className="res">
                    <span className="k">θ dobra / α interno</span>
                    <span className="v">
                      {fmtMM(b.thetaDeg, 2)}° / {fmtMM(b.includedDeg, 2)}°
                    </span>
                    <span className="k">R interno / K / T</span>
                    <span className="v">
                      {fmtMM(b.R, 3)} / {fmtMM(b.K, 4)} / {fmtMM(b.T, 2)}
                    </span>
                    <span className="k">Bend allowance (BA)</span>
                    <span className="v">{fmtMM(b.BA, 4)}</span>
                    <span className="k">Outside setback (OSB)</span>
                    <span className="v">{fmtMM(b.OSB, 4)}</span>
                    <span className="k">Inside setback (ISB)</span>
                    <span className="v">{fmtMM(b.ISB, 4)}</span>
                    <span className="k">Bend deduction (BD, ext.)</span>
                    <span className="v">{fmtMM(b.BD, 4)}</span>
                    <span className="k">Linha de dobra (da borda)</span>
                    <span className="v">{fmtMM(b.xLine, 3)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="sm-sec">
              <h4>Abas</h4>
              <table className="tbl">
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
                      <td className="num">{fmtMM(f.lengthB, 3)}</td>
                      <td className="num">{fmtMM(f.lengthA, 3)}</td>
                      <td className="num">{fmtMM(f.flat, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="note" style={{ marginTop: 4 }}>
                Linha de dobra = centro da região de dobra. Sentido “CIMA” = face interna voltada para o observador na planificação.
              </div>
            </div>
            <div className="sm-sec">
              <h4>Gerar</h4>
              <label className="chk">
                <input type="checkbox" checked={opts.dims} onChange={(e) => setOpts({ ...opts, dims: e.target.checked })} /> Cotas de fabricação
              </label>
              <label className="chk">
                <input type="checkbox" checked={opts.notes} onChange={(e) => setOpts({ ...opts, notes: e.target.checked })} /> Anotações de dobra
              </label>
              <label className="chk">
                <input type="checkbox" checked={opts.regions} onChange={(e) => setOpts({ ...opts, regions: e.target.checked })} /> Limites da região de dobra
              </label>
              <button className="btn primary" style={{ width: "100%", marginTop: 8 }} onClick={() => onInsert(flat, layerChanges, "Planificação")}>
                Inserir planificação no desenho
              </button>
              <button className="btn" style={{ width: "100%", marginTop: 6 }} onClick={() => onInsert(section, layerChanges, "Seção do perfil")}>
                Inserir seção no desenho
              </button>
              <h4 style={{ marginTop: 12 }}>Exportar DXF da planificação</h4>
              {SM_LAYERS.filter((l) => l.name !== "SECAO_PERFIL").map((l) => (
                <label key={l.name} className="chk" title={l.description}>
                  <input
                    type="checkbox"
                    checked={exportLayers.has(l.name)}
                    onChange={(e) => {
                      const s = new Set(exportLayers);
                      if (e.target.checked) s.add(l.name);
                      else s.delete(l.name);
                      setExportLayers(s);
                    }}
                  />
                  <span className="swatch" style={{ background: aciColor(l.color), width: 10, height: 10 }} />
                  <span className="mono">{l.name}</span>
                </label>
              ))}
              <button
                className="btn"
                style={{ width: "100%", marginTop: 6 }}
                disabled={!exportLayers.size}
                onClick={() => onExportDxf(flat, SM_LAYER_DEFS, [...exportLayers], `${title.replace(/[^\w\-x#,]+/g, "_")}.dxf`)}
              >
                Exportar DXF (R12, mm)
              </button>
              <button
                className="btn"
                style={{ width: "100%", marginTop: 6 }}
                title="Salva os parâmetros no projeto (.agtncad)"
                onClick={() => {
                  const name = `${title} — ${new Date().toLocaleString("pt-BR")}`;
                  writeSM(ctl.doc, { ...sm, presets: [...sm.presets, { name, params: effective }] }, "Salvar configuração de dobra");
                  ctl.message(`Configuração salva no projeto: ${name}`);
                }}
              >
                Salvar configuração no projeto
              </button>
              {sm.presets.length > 0 && (
                <select
                  style={{ width: "100%", marginTop: 6, height: 24, background: "var(--bg-3)", border: "1px solid var(--line-2)" }}
                  value=""
                  onChange={(e) => {
                    const p = sm.presets[Number(e.target.value)];
                    if (p) setParams(structuredClone(p.params));
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
          </>
        )}
      </div>
      {dlg === "k" && <KTablesDialog ctl={ctl} onClose={() => setDlg(null)} />}
      {dlg === "cal" && <CalibrationDialog ctl={ctl} tableId={table.id} defaults={effective} onClose={() => setDlg(null)} />}
    </div>
  );
}
