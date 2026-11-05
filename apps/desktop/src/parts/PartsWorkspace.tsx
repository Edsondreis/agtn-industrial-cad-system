import type { Change, Layer } from "@agtn/document";
import { type Entity, entityBox, formatNumber } from "@agtn/geometry";
import { PARTS, type PartDef, buildPart, defaultParams } from "@agtn/parts";
import { MATERIALS, type MaterialId, SM_LAYERS, materialById } from "@agtn/sheetmetal";
import { useEffect, useMemo, useState } from "react";
import type { CadController } from "../cad/controller";
import { textsToGeometry } from "../lasertext/fonts";
import { PreviewCanvas } from "../sheetmetal/PreviewCanvas";
import { MeasureField, type MeasureKind } from "../ui/MeasureField";
import type { ParamDef } from "@agtn/parts";

function kindOf(p: ParamDef): { kind: MeasureKind; tag: string; unit: string } {
  if (p.kind === "angle") return { kind: "ang", tag: "∠", unit: "°" };
  if (p.kind === "count") return { kind: "len", tag: "Nº", unit: "" };
  if (p.label.startsWith("Ø")) return { kind: "len", tag: "Ø", unit: "mm" };
  if (/raio/i.test(p.label)) return { kind: "rad", tag: "R", unit: "mm" };
  return { kind: "len", tag: "L", unit: "mm" };
}

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
                <PartGlyph id={p.id} />
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
          {def.params.map((p) => {
            const k = kindOf(p);
            return (
              <MeasureField
                key={p.key}
                label={p.label}
                kind={k.kind}
                tag={k.tag}
                unit={k.unit}
                title={p.hint}
                value={params[p.key]}
                digits={p.kind === "count" ? 0 : 3}
                min={p.min}
                onCommit={(v) => setVals((s) => ({ ...s, [def.id]: { ...params, [p.key]: p.kind === "count" ? Math.round(v) : v } }))}
              />
            );
          })}
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
          <MeasureField label="Espessura" kind="thk" value={T} min={0.1} onCommit={setT} />
          <MeasureField label="Quantidade" kind="len" tag="Qtd" unit="pç" digits={0} value={qty} min={1} onCommit={(v) => setQty(Math.max(1, Math.round(v)))} />
        </div>
        <div className="sm-sec">
          <h4>Resultado</h4>
          {res.ok ? (
            <>
            <div className="result-big">
              <span className="k">Peso total</span>
              <span>
                <span className="v">{f2(weight * qty, 3)}</span>
                <span className="u">kg</span>
              </span>
            </div>
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
            </>
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

/** Miniatura técnica de cada peça (mesmo traço dos ícones da interface). */
function PartGlyph({ id }: { id: string }) {
  const d: Record<string, string> = {
    flange: "M12 3a9 9 0 1 0 0.01 0z M12 8.5a3.5 3.5 0 1 0 0.01 0z M12 4.6v.8 M12 18.6v.8 M4.6 12h.8 M18.6 12h.8",
    bolacha: "M12 3a9 9 0 1 0 0.01 0z M12 8a4 4 0 1 0 0.01 0z",
    setor: "M5 16a9 9 0 0 1 14 0 M8 18a5 5 0 0 1 8 0 M5 16l3 2 M19 16l-3 2",
    "chapa-base": "M3 6h18v12H3z M6 9h.01 M18 9h.01 M6 15h.01 M18 15h.01",
    "chapa-oblongo": "M3 6h18v12H3z M7 12h3 M14 12h3",
    poligono: "M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 9.5a2.5 2.5 0 1 0 0.01 0z",
    cartela: "M4 20V4l16 16z M4 15l5 5",
    olhal: "M5 20h14 M5 20l2-9a5 5 0 0 1 10 0l2 9 M12 7.5a2.5 2.5 0 1 0 0.01 0z",
    "boca-de-lobo": "M3 19h18 M3 19V8c3 0 4.5 4 9 4s6-4 9-4v11",
  };
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: "var(--text-dim)" }}>
      <path d={d[id] ?? "M4 4h16v16H4z"} />
    </svg>
  );
}
