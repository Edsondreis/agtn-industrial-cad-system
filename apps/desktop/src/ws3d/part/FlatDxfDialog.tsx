import { type FlatDxfReport, flatToDxf, validateFlatDxf } from "@agtn/sheetgraph";
import { dxfBytes } from "@agtn/dxf";
import { useState } from "react";
import { loadPrefs } from "../../app/prefs";
import { pickSavePath, writeBytes } from "../../platform/platform";
import { Modal } from "../../ui/Dialogs";
import { toast } from "../../ui/toast";
import type { SheetInfo } from "../protocol";

/**
 * DXF da planificação (ETAPA 2.6): direto do grafo (sem passar pelo DESENHO), R2000 padrão (Preferências) ou R12;
 * níveis de conteúdo por camada. O arquivo é RELIDO e conferido antes de gravar; falha = não grava.
 */
export function FlatDxfDialog({ info, name, onClose }: { info: SheetInfo; name: string; onClose: () => void }) {
  const [version, setVersion] = useState(loadPrefs().sheetDxfVersion);
  const [bends, setBends] = useState(true);
  const [marks, setMarks] = useState(true);
  const [regions, setRegions] = useState(false);
  const [reference, setReference] = useState(false);
  const [rep, setRep] = useState<FlatDxfReport | null>(null);
  const T = String(Number(info.T.toFixed(3))).replace(".", ",");
  const go = async () => {
    const o = { version, bends, marks, regions, reference, title: `${name} · chapa ${T} mm` };
    let txt: string;
    try {
      txt = flatToDxf(info.flat, o);
    } catch (e) {
      return toast(`DXF: ${(e as Error).message}`, "error");
    }
    const r = validateFlatDxf(txt, info.flat, o);
    setRep(r);
    if (!r.ok) return toast(`DXF da planificação reprovado na conferência: ${r.checks.filter((c) => !c.ok).map((c) => c.name).join("; ")}`, "error");
    const p = await pickSavePath("dxf", `${name}_planificacao.dxf`);
    if (!p) return;
    const path = /\.dxf$/i.test(p) ? p : `${p}.dxf`;
    await writeBytes(path, dxfBytes(txt));
    toast(`DXF ${version === "R2000" ? "2000" : "R12"} da planificação gravado e conferido (${r.checks.length} verificações).`, "ok");
  };
  const Ck = ({ v, set, k, label }: { v: boolean; set: (x: boolean) => void; k: string; label: string }) => (
    <label className="fd-check" data-dxf={k}>
      <input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} /> {label}
    </label>
  );
  return (
    <Modal
      title="DXF da planificação"
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Fechar
          </button>
          <button className="btn primary" onClick={() => void go()} data-testid="flat-dxf-go">
            Exportar
          </button>
        </>
      }
    >
      <div className="p3-row edit">
        <span className="k">Versão</span>
        <span className="v">
          <select value={version} onChange={(e) => setVersion(e.target.value as "R12" | "R2000")} data-field="dxfVersion">
            <option value="R2000">DXF 2000 ($INSUNITS = mm)</option>
            <option value="R12">DXF R12 (compatível)</option>
          </select>
        </span>
      </div>
      <div className="fd-list">
        <div className="fd-list-h">Conteúdo (CUT_OUTER / CUT_INNER sempre)</div>
        <Ck v={bends} set={setBends} k="bends" label="Linhas de dobra (BEND_UP / BEND_DOWN)" />
        <Ck v={marks} set={setMarks} k="marks" label="Marcação D1 CIMA 90° (BEND_MARK)" />
        <Ck v={regions} set={setRegions} k="regions" label="Limites da região de dobra (BEND_REGION)" />
        <Ck v={reference} set={setReference} k="reference" label="Referência: título e blank (REFERENCE)" />
      </div>
      {rep && (
        <div className="fd-list" data-testid="flat-dxf-report">
          <div className="fd-list-h">{rep.ok ? "Conferência: OK" : "Conferência: FALHOU"}</div>
          {rep.checks.map((c) => (
            <div key={c.name} className={c.ok ? "fd-note" : "fd-err"} title={c.detail}>
              {c.ok ? "✓" : "✗"} {c.name}
            </div>
          ))}
        </div>
      )}
      <div className="fd-note">Escala 1:1 em mm, origem no canto do blank. O DXF 2D do DESENHO não muda.</div>
    </Modal>
  );
}
