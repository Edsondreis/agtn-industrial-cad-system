import { type BBox, formatNumber } from "@agtn/geometry";
import {
  DEFAULT_PLOT,
  PAPERS,
  PLOT_SCALES,
  type PlotPage,
  type PlotSettings,
  layoutPlot,
  plotToSvg,
  scaleLabel,
} from "@agtn/plot";
import { useMemo, useState } from "react";
import type { CadController } from "../cad/controller";
import { Modal } from "./Dialogs";

const KEY = "agtncad.plot.v1";

export function loadPlotSettings(): PlotSettings {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Partial<PlotSettings>) : {};
    return { ...DEFAULT_PLOT, ...p, area: p.area === "display" ? "display" : "extents", window: null };
  } catch {
    return { ...DEFAULT_PLOT };
  }
}
function savePlotSettings(s: PlotSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, window: null, area: s.area === "window" ? "extents" : s.area }));
  } catch {
    /* ignore */
  }
}

/**
 * PLOTAR — imprimir ou salvar PDF.
 * A pré-visualização é o mesmo SVG que vai para a impressora; o PDF usa as mesmas primitivas.
 */
export function PlotDialog({
  ctl,
  initial,
  onClose,
  onPickWindow,
  onPdf,
  onPrint,
}: {
  ctl: CadController;
  initial: PlotSettings;
  onClose: () => void;
  /** fecha a janela, pede os dois cantos no desenho e reabre com a área escolhida */
  onPickWindow: (s: PlotSettings) => void;
  onPdf: (page: PlotPage, s: PlotSettings) => void;
  onPrint: (page: PlotPage, s: PlotSettings) => void;
}) {
  const [s, setS] = useState<PlotSettings>(initial);
  const set = (p: Partial<PlotSettings>) => setS((old) => ({ ...old, ...p }));
  const displayBox = (): BBox => ctl.view.worldBox();

  const result = useMemo(() => {
    try {
      const st = s.area === "display" ? { ...s, window: displayBox() } : s;
      const page = layoutPlot(
        { entities: ctl.doc.all(), layers: ctl.doc.layers, dimStyle: ctl.doc.settings.dimStyle, ltScale: ctl.doc.settings.ltScale },
        st,
      );
      return { page, svg: plotToSvg(page, { background: "#ffffff" }), error: null as string | null };
    } catch (e) {
      return { page: null, svg: "", error: e instanceof Error ? e.message : String(e) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, ctl]);

  const go = (fn: (p: PlotPage, s: PlotSettings) => void) => {
    if (!result.page) return;
    savePlotSettings(s);
    fn(result.page, s);
  };
  const scaleSel = s.scale === "fit" ? "fit" : (PLOT_SCALES.find((x) => Math.abs(x.value - (s.scale as number)) < 1e-12)?.label ?? "custom");
  const [custom, setCustom] = useState(s.scale === "fit" ? "1:1" : scaleLabel(s.scale));
  const parseScale = (txt: string): number | null => {
    const m = /^\s*([\d.,]+)\s*[:/]\s*([\d.,]+)\s*$/.exec(txt);
    if (!m) return null;
    const a = Number(m[1].replace(",", "."));
    const b = Number(m[2].replace(",", "."));
    return a > 0 && b > 0 ? a / b : null;
  };
  const p = result.page;
  const fits = p ? p.clip.maxX - p.clip.minX >= (p.area.maxX - p.area.minX) * p.scale - 1e-6 && p.clip.maxY - p.clip.minY >= (p.area.maxY - p.area.minY) * p.scale - 1e-6 : true;

  return (
    <Modal
      title="Imprimir / PDF"
      width={860}
      onClose={onClose}
      footer={
        <>
          <span className="note" style={{ marginRight: "auto" }}>
            {p ? `Escala ${scaleLabel(p.scale)} · ${p.count} objeto(s)${fits ? "" : " · parte do desenho fica fora da folha"}` : ""}
          </span>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" disabled={!p} onClick={() => go(onPdf)}>
            Salvar PDF…
          </button>
          <button className="btn primary" disabled={!p} onClick={() => go(onPrint)}>
            Imprimir…
          </button>
        </>
      }
    >
      <div className="plot-grid">
        <div className="plot-form">
          <div className="sm-row" style={{ gridTemplateColumns: "110px 1fr" }}>
            <span className="k">Folha</span>
            <select value={s.paper} onChange={(e) => set({ paper: e.target.value as PlotSettings["paper"] })}>
              {PAPERS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
            <span className="k">Orientação</span>
            <div className="seg">
              <button className={s.landscape ? "on" : ""} onClick={() => set({ landscape: true })}>
                Paisagem
              </button>
              <button className={!s.landscape ? "on" : ""} onClick={() => set({ landscape: false })}>
                Retrato
              </button>
            </div>
            <span className="k">O que imprimir</span>
            <div className="seg">
              <button className={s.area === "extents" ? "on" : ""} onClick={() => set({ area: "extents", window: null })} title="Todo o desenho">
                Tudo
              </button>
              <button className={s.area === "display" ? "on" : ""} onClick={() => set({ area: "display" })} title="O que está aparecendo na tela">
                Tela
              </button>
              <button className={s.area === "window" ? "on" : ""} onClick={() => onPickWindow(s)} title="Escolher dois cantos no desenho">
                Janela…
              </button>
            </div>
            <span className="k">Escala</span>
            <select
              value={scaleSel}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "fit") set({ scale: "fit" });
                else if (v === "custom") set({ scale: parseScale(custom) ?? 1 });
                else set({ scale: PLOT_SCALES.find((x) => x.label === v)!.value });
              }}
            >
              <option value="fit">Ajustar à folha</option>
              {PLOT_SCALES.map((x) => (
                <option key={x.label} value={x.label}>
                  {x.label}
                </option>
              ))}
              <option value="custom">Outra…</option>
            </select>
            {scaleSel === "custom" && (
              <>
                <span className="k">Escala (papel:desenho)</span>
                <input
                  value={custom}
                  onChange={(e) => {
                    setCustom(e.target.value);
                    const v = parseScale(e.target.value);
                    if (v) set({ scale: v });
                  }}
                  placeholder="ex.: 1:15"
                />
              </>
            )}
            <span className="k">Posição</span>
            <label className="chk">
              <input type="checkbox" checked={s.center} onChange={(e) => set({ center: e.target.checked })} />
              Centralizar na folha
            </label>
            <span className="k">Margem (mm)</span>
            <input type="number" min={0} max={40} step={1} value={s.margin} onChange={(e) => set({ margin: Math.max(0, Number(e.target.value) || 0) })} />
            <span className="k">Cores</span>
            <select value={s.color} onChange={(e) => set({ color: e.target.value as PlotSettings["color"] })}>
              <option value="mono">Preto (monocromático)</option>
              <option value="gray">Tons de cinza</option>
              <option value="color">Colorido (cores das camadas)</option>
            </select>
            <span className="k">Espessuras</span>
            <label className="chk">
              <input type="checkbox" checked={s.lineweights} onChange={(e) => set({ lineweights: e.target.checked })} />
              Usar espessura das camadas
            </label>
          </div>
          {s.area === "window" && s.window && (
            <p className="note">
              Janela: {formatNumber(s.window.maxX - s.window.minX, 1, ",")} × {formatNumber(s.window.maxY - s.window.minY, 1, ",")} mm do desenho.
            </p>
          )}
          <p className="note">Camadas ocultas não saem. Texto em Helvetica. O PDF é vetorial (linhas nítidas em qualquer zoom).</p>
        </div>
        <div className="plot-preview">
          {result.error ? (
            <div className="empty">{result.error}</div>
          ) : (
            <img alt="Pré-visualização da folha" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`} />
          )}
        </div>
      </div>
    </Modal>
  );
}
