import { type LengthUnit, UNIT_LABEL, formatNumber } from "@agtn/geometry";
import { useState } from "react";
import type { CadController } from "../cad/controller";
import { SNAP_LABEL, type SnapKind } from "@agtn/geometry";
import { useCtl } from "./hooks";

const OSNAP_MODES: SnapKind[] = ["endpoint", "midpoint", "center", "intersection", "quadrant", "perpendicular", "tangent", "nearest", "node"];

function Coords({ ctl }: { ctl: CadController }) {
  useCtl(ctl, "cursor");
  const p = ctl.cursor.p;
  const u = ctl.unitToMM;
  return (
    <div className="coords" title="Coordenadas do cursor (com snap/ortho/polar aplicados)">
      X {formatNumber(p.x / u, 4, ",").padStart(12, " ")} &nbsp; Y {formatNumber(p.y / u, 4, ",").padStart(12, " ")}
    </div>
  );
}

export function StatusBar({ ctl }: { ctl: CadController }) {
  useCtl(ctl, "state");
  const [osnapMenu, setOsnapMenu] = useState(false);
  const d = ctl.draft;
  const units = ctl.doc.settings.units;
  const btn = (key: "gridSnap" | "grid" | "ortho" | "polar" | "osnap" | "lwt", label: string, title: string) => (
    <button className={`st-btn${d[key] ? " on" : ""}`} title={title} onClick={() => ctl.toggle(key)}>
      {label}
    </button>
  );
  const pxPerMM = ctl.view.scale;
  return (
    <div className="status">
      <Coords ctl={ctl} />
      <div className="st-sep" />
      <select
        value={units}
        title="Unidade do desenho (armazenamento interno sempre em mm)"
        onChange={(e) => ctl.commit("Unidade do desenho", [ctl.doc.settingsChange({ units: e.target.value as LengthUnit })])}
      >
        {(Object.keys(UNIT_LABEL) as LengthUnit[]).map((u) => (
          <option key={u} value={u}>
            {UNIT_LABEL[u]} ({u})
          </option>
        ))}
      </select>
      <div className="st-sep" />
      {btn("gridSnap", "SNAP", `Snap à grade (F9) — passo ${ctl.fmtLen(ctl.doc.settings.snapSpacing)}`)}
      {btn("grid", "GRADE", "Grade (F7)")}
      {btn("ortho", "ORTHO", "Modo ortogonal (F8)")}
      {btn("polar", `POLAR ${d.polarStep}°`, "Rastreamento polar (F10)")}
      <div style={{ position: "relative", display: "inline-flex" }}>
        {btn("osnap", "OSNAP", "Snap a objetos (F3) — clique direito para modos")}
        <button className="st-btn" title="Modos de snap" onClick={() => setOsnapMenu((v) => !v)}>
          ▾
        </button>
        {osnapMenu && (
          <div className="dropdown" style={{ bottom: "100%", top: "auto", left: 0 }} onMouseLeave={() => setOsnapMenu(false)}>
            {OSNAP_MODES.map((m) => (
              <button key={m} onClick={() => ctl.setDraft({ snapModes: { ...d.snapModes, [m]: !d.snapModes[m] } })}>
                <span className="check">{d.snapModes[m] ? "✓" : ""}</span>
                {SNAP_LABEL[m]}
              </button>
            ))}
            <hr />
            {[5, 10, 15, 30, 45, 90].map((a) => (
              <button key={a} onClick={() => ctl.setDraft({ polarStep: a })}>
                <span className="check">{d.polarStep === a ? "✓" : ""}</span>
                Incremento polar {a}°
              </button>
            ))}
          </div>
        )}
      </div>
      {btn("lwt", "ESPESSURA", "Exibir espessura de linha")}
      <div className="st-sep" />
      <span className="tabchip" title="Espaço de modelo (layouts de impressão: próxima fase)">MODELO</span>
      <div className="spacer" />
      <span className="st-txt" title="Escala de visualização">
        Zoom 1 mm = {formatNumber(pxPerMM, pxPerMM < 1 ? 4 : 2, ",")} px
      </span>
      <span className="st-txt">{ctl.doc.size} objetos</span>
      <span className="st-txt">{ctl.sel.size ? `${ctl.sel.size} selecionado(s)` : ""}</span>
    </div>
  );
}
