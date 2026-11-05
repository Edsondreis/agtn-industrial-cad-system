import type { Change, Layer } from "@agtn/document";
import { type Entity, entityBox, formatNumber } from "@agtn/geometry";
import { PARTS, type PartDef, buildPart, defaultParams } from "@agtn/parts";
import { MATERIALS, type MaterialId, SM_LAYERS, materialById } from "@agtn/sheetmetal";
import { useEffect, useMemo, useState } from "react";
import type { CadController } from "../cad/controller";
import { textsToGeometry } from "../lasertext/fonts";
import { PreviewCanvas } from "../sheetmetal/PreviewCanvas";
import { NumField } from "../ui/fields";

const LAYERS: Layer[] = SM_LAYERS.map((l) => ({ name: l.name, color: l.color, lineweight: l.lineweight, linetype: l.linetype, visible: true, locked: false }));
const f2 = (v: number, p = 2) => formatNumber(v, p, ",");

export interface PartsProps {
  ctl: CadController;
  onInsert: (ents: Entity[], layerChanges: () => Change[], label: string, ref: { x: number; y: number }, refLabel: string) => void;
  onExportDxf: (ents: Entity[], layers: Layer[], filter: string[], name: string) => void;
}

/** Biblioteca de chapas pré-definidas (flanges, bolachas, chapas, suportes, gabaritos). */
export function PartsWorkspace({ ctl, onInsert, onExportDxf }: PartsProps) {
  const [def, setDef] = useState<PartDef>(PARTS[0]);
  const [vals, setVals] = useState<Record<string, Record<string, number>>>({});
  const [T, setT] = useState(6.35);
  const [mat, setMat] = useState<MaterialId>("aco_carbono");
  const [qty, setQty] = useState(1);
  const [withDims, setWithDims] = useState(true);
  const params = useMemo(() => vals[def.id] ?? defaultParams(def), [vals, def]);
  const res = useMemo(() => buildPart(def, params), [def, params]);
  const shown = useMemo(() => (withDims ? res.entities : res.entities.filter((e) => e.layer !== "COTAS" && e.layer !== "ANOTACOES")), [res, withDims]);
  const [prepared, setPrepared] = useState<Entity[]>(shown);
  useEffect(() => {
    let alive = true;
    textsToGeometry(shown).then((g) => alive && setPrepared(g)).catch(() => alive && setPrepared(shown));
    return () => {
      alive = false;
    };
  }, [shown]);
  const weight = (res.area * T * materialById(mat).density) / 1e6;
  const cats = [...new Set(PARTS.map((p) => p.category))];
  const layerChanges = (): Change[] => {
    const out: Change[] = [];
    let n = ctl.doc.layers.length;
    for (const l of LAYERS) if (!ctl.doc.layer(l.name)) out.push({ kind: "layer-add", layer: l, index: n++ });
    return out;
  };
  const cutBox = res.ok ? entityBox(res.entities.find((e) => e.layer === "CONTORNO_CORTE")!) : null;
  const centered = cutBox ? Math.abs(cutBox.minX + cutBox.maxX) < 1e-6 && Math.abs(cutBox.minY + cutBox.maxY) < 1e-6 : false;
  const ref = cutBox ? (centered ? { x: 0, y: 0 } : { x: cutBox.minX, y: cutBox.minY }) : { x: 0, y: 0 };
  const name = `${def.name.split(" (")[0]} ${def.params.map((p) => String(params[p.key]).replace(".", ",")).join("x")}`;

  return (
    <div className="sm">
      <div className="sm-left">
        {cats.map((c) => (
          <div key={c} className="sm-sec">
            <h4>{c}</h4>
            {PARTS.filter((p) => p.category === c).map((p) => (
              <button key={p.id} className={`part-item${p.id === def.id ? " on" : ""}`} onClick={() => setDef(p)} title={p.description}>
                {p.name}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="sm-center" style={{ gridTemplateRows: "1fr" }}>
        <PreviewCanvas entities={prepared} layers={LAYERS} label={`${def.name} — geometria de corte`} />
      </div>
      <div className="sm-right">
        <div className="sm-sec">
          <h4>{def.name}</h4>
          <div className="note" style={{ marginBottom: 8 }}>
            {def.description}
          </div>
          {def.params.map((p) => (
            <div key={p.key} className="sm-row" title={p.hint}>
              <span className="k">
                {p.label}
                {p.kind === "len" ? " (mm)" : p.kind === "angle" ? " (°)" : ""}
              </span>
              <NumField
                value={params[p.key]}
                digits={p.kind === "count" ? 0 : 3}
                min={p.min}
                onCommit={(v) => setVals((s) => ({ ...s, [def.id]: { ...params, [p.key]: p.kind === "count" ? Math.round(v) : v } }))}
              />
            </div>
          ))}
          <button className="btn" style={{ width: "100%" }} onClick={() => setVals((s) => ({ ...s, [def.id]: defaultParams(def) }))}>
            Valores padrão
          </button>
        </div>
        <div className="sm-sec">
          <h4>Material</h4>
          <div className="sm-row">
            <span className="k">Material</span>
            <select value={mat} onChange={(e) => setMat(e.target.value as MaterialId)}>
              {MATERIALS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm-row">
            <span className="k">Espessura (mm)</span>
            <NumField value={T} min={0.1} onCommit={setT} />
          </div>
          <div className="sm-row">
            <span className="k">Quantidade</span>
            <NumField value={qty} digits={0} min={1} onCommit={(v) => setQty(Math.max(1, Math.round(v)))} />
          </div>
        </div>
        <div className="sm-sec">
          <h4>Resultado</h4>
          {res.ok ? (
            <div className="res">
              <span className="k">Dimensões</span>
              <span className="v">
                {f2(res.width)} × {f2(res.height)}
              </span>
              <span className="k">Área líquida</span>
              <span className="v">{f2(res.area / 100, 2)} cm²</span>
              <span className="k">Peso unitário</span>
              <span className="v">{f2(weight, 3)} kg</span>
              <span className="k">Peso total ({qty} pç)</span>
              <span className="v">{f2(weight * qty, 3)} kg</span>
              <span className="k">Comprimento de corte</span>
              <span className="v">{f2(res.cutLength / 1000, 3)} m</span>
              <span className="k">Perfurações (furos internos)</span>
              <span className="v">{res.pierces}</span>
            </div>
          ) : null}
          {res.issues.map((i, k) => (
            <div key={k} className={i.level === "error" ? "errbox" : "warnbox"}>
              {i.message}
            </div>
          ))}
          <label className="chk" style={{ marginTop: 6 }}>
            <input type="checkbox" checked={withDims} onChange={(e) => setWithDims(e.target.checked)} /> Incluir cotas e anotações
          </label>
          <button
            className="btn primary"
            style={{ width: "100%", marginTop: 8 }}
            disabled={!res.ok}
            onClick={() => onInsert(prepared, layerChanges, def.name.split(" (")[0], ref, centered ? "centro da peça" : "canto inferior esquerdo")}
          >
            Inserir no desenho
          </button>
          <button
            className="btn"
            style={{ width: "100%", marginTop: 6 }}
            disabled={!res.ok}
            onClick={() => onExportDxf(prepared, LAYERS, ["CONTORNO_CORTE", "MARCACAO"], `${name.replace(/[^\w\-x,]+/g, "_")}.dxf`)}
          >
            Exportar DXF de corte (CONTORNO_CORTE + MARCACAO)
          </button>
        </div>
      </div>
    </div>
  );
}
