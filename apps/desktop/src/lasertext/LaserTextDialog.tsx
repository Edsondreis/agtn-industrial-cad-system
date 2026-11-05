import type { Layer } from "@agtn/document";
import { type LaserTextOptions, type LaserTextResult, DEFAULT_LASER_TEXT, LASER_FONTS, buildLaserText, fontById } from "@agtn/lasertext";
import { SM_LAYERS } from "@agtn/sheetmetal";
import { formatNumber } from "@agtn/geometry";
import { useEffect, useState } from "react";
import { Modal } from "../ui/Dialogs";
import { MeasureField } from "../ui/MeasureField";
import { PreviewCanvas } from "../sheetmetal/PreviewCanvas";
import { loadLaserFont } from "./fonts";

const LAYERS: Layer[] = SM_LAYERS.map((l) => ({ name: l.name, color: l.color, lineweight: l.lineweight, linetype: l.linetype, visible: true, locked: false }));
const f2 = (v: number) => formatNumber(v, 2, ",");

let last: LaserTextOptions & { fontId: string } = { ...DEFAULT_LASER_TEXT, fontId: "black-ops-one" };

/** Texto para corte a laser: gera ELEMENTOS (contornos fechados), não entidade de texto. */
export function LaserTextDialog({
  onClose,
  onInsert,
  onExport,
}: {
  onClose: () => void;
  onInsert: (r: LaserTextResult, label: string) => void;
  onExport: (r: LaserTextResult, name: string) => void;
}) {
  const [o, setO] = useState(last);
  const [res, setRes] = useState<LaserTextResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<typeof o>) => setO((s) => ({ ...s, ...p }));
  useEffect(() => {
    last = o;
    let alive = true;
    const t = setTimeout(() => {
      loadLaserFont(o.fontId)
        .then((font) => {
          if (!alive) return;
          try {
            setRes(buildLaserText(font, o));
            setErr(null);
          } catch (e) {
            setErr(`Falha ao gerar geometria: ${String(e)}`);
          }
        })
        .catch((e) => alive && setErr(String(e)));
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [o]);
  const font = fontById(o.fontId);
  const label = `texto "${o.text.split("\n")[0].slice(0, 20)}"`;

  return (
    <Modal
      title="Texto para corte a laser"
      onClose={onClose}
      width={1120}
      footer={
        <>
          <span className="note" style={{ marginRight: "auto" }}>
            Sai como contornos fechados na camada {o.mode === "marcacao" ? "MARCACAO" : "CONTORNO_CORTE"} — a máquina lê como corte, não como texto.
          </span>
          <button className="btn" onClick={onClose}>
            Fechar
          </button>
          <button className="btn" disabled={!res?.ok} onClick={() => res && onExport(res, `${o.text.split("\n")[0].replace(/[^\w-]+/g, "_") || "texto"}.dxf`)}>
            Exportar DXF
          </button>
          <button className="btn primary" disabled={!res?.ok} onClick={() => res && onInsert(res, label)}>
            Inserir no desenho
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 14, minHeight: 480 }}>
        <div>
          <div className="sm-row" style={{ gridTemplateColumns: "1fr" }}>
            <textarea
              value={o.text}
              rows={3}
              spellCheck={false}
              onChange={(e) => set({ text: e.target.value })}
              onKeyDown={(e) => e.stopPropagation()}
              style={{ width: "100%", background: "var(--bg-3)", border: "1px solid var(--line-2)", padding: 6, fontSize: 14, resize: "vertical" }}
            />
          </div>
          <div style={{ marginBottom: 4 }}>
            <div className="seg">
              {(["vazado", "emendado", "marcacao"] as const).map((m) => (
                <button key={m} className={o.mode === m ? "on" : ""} onClick={() => set({ mode: m })}>
                  {m === "vazado" ? "Vazado" : m === "emendado" ? "Emendado" : "Marcação"}
                </button>
              ))}
            </div>
          </div>
          <div className="note" style={{ margin: "2px 0 8px" }}>
            {o.mode === "vazado" && "Letras viram furos na chapa. Miolos (O, A, B, R, 8…) ganham pontes automáticas para não cair."}
            {o.mode === "emendado" && "Letras formam uma peça só. Use fonte cursiva, espaçamento negativo ou a barra de ligação."}
            {o.mode === "marcacao" && "Contorno das letras para gravação (camada MARCACAO)."}
          </div>
          <div className="sm-row">
            <span className="k">Fonte</span>
            <select value={o.fontId} onChange={(e) => set({ fontId: e.target.value })}>
              {(["stencil", "industrial", "script"] as const).map((k) => (
                <optgroup key={k} label={k === "stencil" ? "Stencil (pontes próprias)" : k === "industrial" ? "Industriais" : "Cursivas (emendado)"}>
                  {LASER_FONTS.filter((f) => f.kind === k).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="note" style={{ marginBottom: 8 }}>
            {font.note}
            {font.best !== o.mode && o.mode !== "marcacao" && <b style={{ color: "var(--warn)" }}> Recomendada para {font.best}.</b>}
          </div>
          <MeasureField label="Altura das maiúsculas" kind="len" tag="H" unit="mm" value={o.height} min={0.5} onCommit={(v) => set({ height: v })} />
          <MeasureField label="Espaçamento" kind="len" tag="+" unit="mm" value={o.spacing} onCommit={(v) => set({ spacing: v })} />
          <MeasureField label="Entrelinhas" kind="len" tag="×" unit="× H" value={o.lineSpacing} min={0.8} onCommit={(v) => set({ lineSpacing: v })} />
          <div className="sm-row">
            <span className="k">Alinhamento</span>
            <select value={o.align} onChange={(e) => set({ align: e.target.value as typeof o.align })}>
              <option value="left">Esquerda</option>
              <option value="center">Centro</option>
              <option value="right">Direita</option>
            </select>
          </div>
          {o.mode === "vazado" && (
            <>
              <MeasureField label="Largura da ponte" kind="len" tag="P" unit="mm" value={o.bridgeWidth} min={0.1} onCommit={(v) => set({ bridgeWidth: v })} />
              <MeasureField label="Margem da placa" kind="len" tag="M" unit="mm" value={o.plateMargin} min={0} onCommit={(v) => set({ plateMargin: v })} />
              <MeasureField label="Raio da placa" kind="rad" tag="R" unit="mm" value={o.plateRadius} min={0} onCommit={(v) => set({ plateRadius: v })} />
            </>
          )}
          {o.mode === "emendado" && (
            <>
              <label className="chk">
                <input type="checkbox" checked={o.joinBar} onChange={(e) => set({ joinBar: e.target.checked })} /> Barra de ligação inferior
              </label>
              {o.joinBar && (
                <MeasureField label="Altura da barra" kind="len" tag="B" unit="mm" value={o.barHeight} min={0.5} onCommit={(v) => set({ barHeight: v })} />
              )}
            </>
          )}
          <MeasureField label="Espessura da chapa" kind="thk" tag="T" unit="mm" value={o.thickness} min={0} onCommit={(v) => set({ thickness: v })} />
        </div>
        <div style={{ display: "grid", gridTemplateRows: "1fr auto", minHeight: 0 }}>
          <div style={{ position: "relative", border: "1px solid var(--line)", minHeight: 380, display: "grid" }}>
            <PreviewCanvas entities={res?.entities ?? []} layers={LAYERS} label="Pré-visualização — geometria de corte" />
          </div>
          <div style={{ paddingTop: 8 }}>
            {err && <div className="errbox">{err}</div>}
            {res && (
              <div className="res" style={{ gridTemplateColumns: "repeat(4, auto 1fr)", columnGap: 14 }}>
                <span className="k">Tamanho</span>
                <span className="v">
                  {f2(res.width)} × {f2(res.heightTotal)}
                </span>
                <span className="k">Pontes</span>
                <span className="v">{res.bridges}</span>
                <span className="k">{o.mode === "emendado" ? "Peças" : "Ilhas soltas"}</span>
                <span className="v" style={{ color: (o.mode === "emendado" ? res.pieces > 1 : res.islandsLeft > 0) ? "var(--warn)" : "var(--ok)" }}>
                  {o.mode === "emendado" ? res.pieces : res.islandsLeft}
                </span>
                <span className="k">Corte</span>
                <span className="v">{f2(res.cutLength)} mm</span>
              </div>
            )}
            {res?.warnings.map((w) => (
              <div key={w} className="warnbox">
                {w}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
