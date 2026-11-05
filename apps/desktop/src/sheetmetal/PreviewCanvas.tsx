import type { Layer } from "@agtn/document";
import { DEFAULT_DIMSTYLE, type Entity, boxUnion, emptyBox, entityBox, dimensionGeometry, boxAddPoint } from "@agtn/geometry";
import { useEffect, useRef } from "react";
import { THEME, drawEntities, drawGrid } from "../cad/renderer";
import { Viewport } from "../cad/view";

/** Visualização técnica de geometria real (seção ou planificação), com zoom/pan e ajuste automático. */
export function PreviewCanvas({ entities, layers, label, legend }: { entities: Entity[]; layers: readonly Layer[]; label: string; legend?: React.ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const view = useRef(new Viewport());
  const ents = useRef(entities);
  const fitted = useRef(false);
  const draw = useRef<() => void>(() => {});

  const fit = () => {
    let b = emptyBox();
    for (const e of ents.current) {
      if (e.type === "dimension") {
        const g = dimensionGeometry(e, DEFAULT_DIMSTYLE);
        for (const [p, q] of g.lines) {
          boxAddPoint(b, p);
          boxAddPoint(b, q);
        }
        boxAddPoint(b, g.text.p);
      } else b = boxUnion(b, entityBox(e));
    }
    if (Number.isFinite(b.minX)) view.current.fit(b, 0.06);
  };

  useEffect(() => {
    const w = wrap.current!;
    const c = cv.current!;
    const v = view.current;
    let raf = 0;
    draw.current = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const dpr = window.devicePixelRatio || 1;
        const ctx = c.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = THEME.bg;
        ctx.fillRect(0, 0, v.width, v.height);
        drawGrid(ctx, v, 10, true);
        drawEntities(ctx, ents.current, v, {
          layers: new Map(layers.map((l) => [l.name, l])),
          ltScale: 1,
          showLineweight: true,
          dimStyle: DEFAULT_DIMSTYLE,
        });
      });
    };
    const ro = new ResizeObserver(() => {
      const r = w.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      v.width = Math.max(1, Math.floor(r.width));
      v.height = Math.max(1, Math.floor(r.height));
      c.width = Math.round(v.width * dpr);
      c.height = Math.round(v.height * dpr);
      c.style.width = `${v.width}px`;
      c.style.height = `${v.height}px`;
      fit();
      draw.current();
    });
    ro.observe(w);
    let drag: { x: number; y: number } | null = null;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = w.getBoundingClientRect();
      v.zoomAt({ x: e.clientX - r.left, y: e.clientY - r.top }, Math.exp(-e.deltaY * 0.0015));
      draw.current();
    };
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY };
      w.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      v.panPixels(e.clientX - drag.x, e.clientY - drag.y);
      drag = { x: e.clientX, y: e.clientY };
      draw.current();
    };
    const up = () => (drag = null);
    const dbl = () => {
      fit();
      draw.current();
    };
    w.addEventListener("wheel", wheel, { passive: false });
    w.addEventListener("pointerdown", down);
    w.addEventListener("pointermove", move);
    w.addEventListener("pointerup", up);
    w.addEventListener("dblclick", dbl);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      w.removeEventListener("wheel", wheel);
      w.removeEventListener("pointerdown", down);
      w.removeEventListener("pointermove", move);
      w.removeEventListener("pointerup", up);
      w.removeEventListener("dblclick", dbl);
    };
  }, [layers]);

  useEffect(() => {
    ents.current = entities;
    if (!fitted.current || entities.length) {
      fit();
      fitted.current = true;
    }
    draw.current();
  }, [entities]);

  return (
    <div className="sm-view" ref={wrap} title="Roda: zoom · arrastar: mover · duplo clique: ajustar">
      <canvas ref={cv} />
      <div className="canvas-tag">{label}</div>
      {legend && <div className="legend">{legend}</div>}
    </div>
  );
}
