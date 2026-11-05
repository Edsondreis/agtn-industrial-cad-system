import {
  type BendProcess,
  type CalibrationRecord,
  type KRule,
  type KTable,
  MATERIALS,
  type MaterialId,
  PROCESS_LABEL,
  type ProfileParams,
  SOURCE_LABEL,
  type ValueSource,
  calibrateFromLTest,
  defaultKTable,
  fmtMM,
} from "@agtn/sheetmetal";
import { newId } from "@agtn/geometry";
import { useState } from "react";
import type { CadController } from "../cad/controller";
import { Modal } from "../ui/Dialogs";
import { NumField } from "../ui/fields";
import { Icon } from "../ui/Icons";
import { readSM, writeSM } from "./state";

/** Editor das tabelas de fator K (salvas no projeto). */
export function KTablesDialog({ ctl, onClose }: { ctl: CadController; onClose: () => void }) {
  const sm = readSM(ctl.doc);
  const [tables, setTables] = useState<KTable[]>(() => structuredClone(sm.kTables));
  const [sel, setSel] = useState(tables[0]?.id ?? "");
  const t = tables.find((x) => x.id === sel) ?? tables[0];
  const upd = (fn: (t: KTable) => KTable) => setTables((ts) => ts.map((x) => (x.id === t.id ? fn(x) : x)));
  const updRule = (i: number, p: Partial<KRule>) => upd((x) => ({ ...x, rules: x.rules.map((r, k) => (k === i ? { ...r, ...p } : r)) }));
  const save = () => {
    writeSM(ctl.doc, { ...sm, kTables: tables }, "Editar tabelas de fator K");
    ctl.message("Tabelas de fator K salvas no projeto.");
    onClose();
  };
  return (
    <Modal
      title="Tabelas de fator K"
      onClose={onClose}
      width={900}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" onClick={save}>
            Salvar no projeto
          </button>
        </>
      }
    >
      <div className="warnbox">
        Valores “Estimativa de partida” são referências empíricas para dobra no ar — <b>não são valores certificados</b>. Substitua por valores calibrados em ensaio na sua dobradeira.
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
        <select value={t?.id} onChange={(e) => setSel(e.target.value)} style={{ height: 26, minWidth: 260, background: "var(--bg-3)", border: "1px solid var(--line-2)" }}>
          {tables.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <input
          value={t?.name ?? ""}
          onChange={(e) => upd((x) => ({ ...x, name: e.target.value }))}
          onKeyDown={(e) => e.stopPropagation()}
          style={{ height: 26, flex: 1, background: "var(--bg-3)", border: "1px solid var(--line-2)", padding: "0 6px" }}
          title="Nome da tabela"
        />
        <button
          className="btn"
          onClick={() => {
            const c: KTable = { ...structuredClone(t), id: newId(), name: `${t.name} (cópia AGTN)`, builtIn: false };
            setTables((ts) => [...ts, c]);
            setSel(c.id);
          }}
        >
          Duplicar
        </button>
        <button
          className="btn"
          onClick={() => {
            const c: KTable = { id: newId(), name: "Nova tabela", builtIn: false, rules: [] };
            setTables((ts) => [...ts, c]);
            setSel(c.id);
          }}
        >
          Nova
        </button>
        <button className="btn" title="Restaura a tabela padrão de estimativas" onClick={() => upd((x) => (x.builtIn ? { ...defaultKTable() } : x))} disabled={!t?.builtIn}>
          Restaurar padrão
        </button>
        <button
          className="btn"
          disabled={tables.length < 2}
          onClick={() => {
            const rest = tables.filter((x) => x.id !== t.id);
            setTables(rest);
            setSel(rest[0].id);
          }}
        >
          Excluir
        </button>
      </div>
      {t && (
        <table className="tbl">
          <thead>
            <tr>
              <th>Material</th>
              <th>Processo</th>
              <th>T mín</th>
              <th>T máx</th>
              <th>R/T mín</th>
              <th>R/T máx</th>
              <th>K</th>
              <th>Origem</th>
              <th>Observação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {t.rules.map((r, i) => (
              <tr key={r.id}>
                <td>
                  <select value={r.material} onChange={(e) => updRule(i, { material: e.target.value as MaterialId })}>
                    {MATERIALS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={r.process} onChange={(e) => updRule(i, { process: e.target.value as BendProcess })}>
                    {(Object.keys(PROCESS_LABEL) as BendProcess[]).map((p) => (
                      <option key={p} value={p}>
                        {PROCESS_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ width: 70 }}>
                  <NumField value={r.tMin} min={0} onCommit={(v) => updRule(i, { tMin: v })} />
                </td>
                <td style={{ width: 70 }}>
                  <NumField value={r.tMax} min={0} onCommit={(v) => updRule(i, { tMax: v })} />
                </td>
                <td style={{ width: 70 }}>
                  <NumField value={r.rtMin} min={0} onCommit={(v) => updRule(i, { rtMin: v })} />
                </td>
                <td style={{ width: 70 }}>
                  <NumField value={r.rtMax} min={0} onCommit={(v) => updRule(i, { rtMax: v })} />
                </td>
                <td style={{ width: 70 }}>
                  <NumField value={r.k} min={0} onCommit={(v) => updRule(i, { k: v, source: r.source === "estimado" ? "manual" : r.source })} />
                </td>
                <td>
                  <select value={r.source} onChange={(e) => updRule(i, { source: e.target.value as ValueSource })}>
                    {(Object.keys(SOURCE_LABEL) as ValueSource[]).map((s) => (
                      <option key={s} value={s}>
                        {SOURCE_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input value={r.note ?? ""} onChange={(e) => updRule(i, { note: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
                </td>
                <td>
                  <button className="tog" onClick={() => upd((x) => ({ ...x, rules: x.rules.filter((_, k) => k !== i) }))}>
                    <Icon name="trash" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button
        className="btn"
        style={{ marginTop: 8 }}
        onClick={() =>
          upd((x) => ({
            ...x,
            rules: [...x.rules, { id: newId(), material: "aco_carbono", process: "ar", tMin: 0, tMax: 1000, rtMin: 0, rtMax: 1e9, k: 0.43, source: "manual", note: "" }],
          }))
        }
      >
        Adicionar regra
      </button>
      <p className="note">Prioridade de seleção: calibrado → informado manualmente → estimativa → teórico; depois a faixa mais específica.</p>
    </Modal>
  );
}

/** Registro de ensaios de dobra e criação de regras calibradas. */
export function CalibrationDialog({ ctl, tableId, defaults, onClose }: { ctl: CadController; tableId: string; defaults: ProfileParams; onClose: () => void }) {
  const sm = readSM(ctl.doc);
  const blank = (): CalibrationRecord => ({
    id: newId(),
    date: new Date().toISOString().slice(0, 10),
    material: defaults.fab.material,
    process: defaults.fab.process,
    nominalThickness: defaults.T,
    measuredThickness: null,
    toolName: defaults.fab.toolName,
    vOpening: defaults.fab.vOpening,
    punchRadius: defaults.fab.punchRadius,
    programmedAngleDeg: 90,
    measuredAngleDeg: 90,
    innerRadius: defaults.bends[0]?.R ?? defaults.T,
    blankLength: 0,
    outerA: 0,
    outerB: 0,
    result: null,
    note: "",
  });
  const [r, setR] = useState<CalibrationRecord>(blank);
  const T = r.measuredThickness ?? r.nominalThickness;
  const valid = r.blankLength > 0 && r.outerA > 0 && r.outerB > 0 && T > 0 && r.measuredAngleDeg > 0 && r.measuredAngleDeg < 180;
  const res = valid ? calibrateFromLTest({ blank: r.blankLength, outerA: r.outerA, outerB: r.outerB, thetaDeg: r.measuredAngleDeg, R: r.innerRadius, T }) : null;
  const plausible = res && res.K > 0 && res.K < 1;

  const save = (createRule: boolean) => {
    if (!res) return;
    const rec = { ...r, result: res };
    const tables = sm.kTables.map((t) => {
      if (!createRule || t.id !== tableId) return t;
      const rt = r.innerRadius / T;
      const rule: KRule = {
        id: newId(),
        material: r.material,
        process: r.process,
        tMin: r.nominalThickness * 0.95,
        tMax: r.nominalThickness * 1.05,
        rtMin: rt * 0.9,
        rtMax: rt * 1.1,
        k: res.K,
        source: "calibrado",
        vOpening: r.vOpening,
        punchRadius: r.punchRadius,
        note: `Ensaio ${r.date}${r.toolName ? ` — ${r.toolName}` : ""}${r.vOpening ? ` V${r.vOpening}` : ""}`,
      };
      return { ...t, rules: [...t.rules, rule] };
    });
    writeSM(ctl.doc, { ...sm, kTables: tables, calibrations: [...sm.calibrations, rec] }, createRule ? "Calibração: nova regra de K" : "Registrar ensaio de dobra");
    ctl.message(createRule ? `Regra calibrada K = ${fmtMM(res.K, 4)} adicionada à tabela.` : "Ensaio registrado no projeto.");
    setR(blank());
  };
  const num = (label: string, key: keyof CalibrationRecord, hint?: string) => (
    <>
      <span className="k">{label}</span>
      <NumField value={(r[key] as number | null) ?? NaN} min={0} onCommit={(v) => setR({ ...r, [key]: v })} />
      <span className="note">{hint}</span>
    </>
  );
  return (
    <Modal title="Calibração de dobra por ensaio" onClose={onClose} width={820} footer={<button className="btn" onClick={onClose}>Fechar</button>}>
      <p className="note">
        Ensaio em “L”: corte uma tira com comprimento plano conhecido, dobre e meça as abas <b>externas</b> até o vértice virtual. O sistema calcula BD, BA e K observados.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="sm-grid">
          <span className="k">Material</span>
          <select value={r.material} onChange={(e) => setR({ ...r, material: e.target.value as MaterialId })}>
            {MATERIALS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <span />
          <span className="k">Processo</span>
          <select value={r.process} onChange={(e) => setR({ ...r, process: e.target.value as BendProcess })}>
            {(Object.keys(PROCESS_LABEL) as BendProcess[]).map((p) => (
              <option key={p} value={p}>
                {PROCESS_LABEL[p]}
              </option>
            ))}
          </select>
          <span />
          {num("Espessura nominal", "nominalThickness", "mm")}
          {num("Espessura medida", "measuredThickness", "opcional")}
          <span className="k">Ferramenta</span>
          <input value={r.toolName} onChange={(e) => setR({ ...r, toolName: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          <span />
          {num("Abertura V", "vOpening", "mm")}
          {num("Raio do punção", "punchRadius", "mm")}
        </div>
        <div className="sm-grid">
          {num("Ângulo programado θ", "programmedAngleDeg", "°")}
          {num("Ângulo medido θ", "measuredAngleDeg", "° (deflexão)")}
          {num("Raio interno", "innerRadius", "medido/adotado")}
          {num("Comprimento antes", "blankLength", "mm (plano)")}
          {num("Aba externa A", "outerA", "mm (depois)")}
          {num("Aba externa B", "outerB", "mm (depois)")}
          <span className="k">Observação</span>
          <input value={r.note} onChange={(e) => setR({ ...r, note: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          <span />
        </div>
      </div>
      {res && (
        <div className={plausible ? "okbox" : "errbox"} style={{ marginTop: 10 }}>
          BD observado = <b className="mono">{fmtMM(res.BD, 4)}</b> · BA observado = <b className="mono">{fmtMM(res.BA, 4)}</b> · K observado ={" "}
          <b className="mono">{fmtMM(res.K, 4)}</b>
          {!plausible && " — fora de 0..1: confira as medições."}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn" disabled={!res} onClick={() => save(false)}>
          Registrar ensaio
        </button>
        <button className="btn primary" disabled={!plausible} onClick={() => save(true)}>
          Registrar e criar regra calibrada na tabela atual
        </button>
      </div>
      {sm.calibrations.length > 0 && (
        <>
          <h4>Ensaios registrados neste projeto</h4>
          <table className="tbl">
            <thead>
              <tr>
                <th>Data</th>
                <th>Material</th>
                <th>T</th>
                <th>V</th>
                <th>θ med.</th>
                <th>R</th>
                <th>BD</th>
                <th>K</th>
              </tr>
            </thead>
            <tbody>
              {sm.calibrations.map((c) => (
                <tr key={c.id}>
                  <td>{c.date}</td>
                  <td>{MATERIALS.find((m) => m.id === c.material)?.name}</td>
                  <td className="num">{fmtMM(c.measuredThickness ?? c.nominalThickness, 2)}</td>
                  <td className="num">{c.vOpening ?? "—"}</td>
                  <td className="num">{fmtMM(c.measuredAngleDeg, 2)}</td>
                  <td className="num">{fmtMM(c.innerRadius, 2)}</td>
                  <td className="num">{c.result ? fmtMM(c.result.BD, 3) : "—"}</td>
                  <td className="num">{c.result ? fmtMM(c.result.K, 4) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}
