import { useEffect, useRef } from "react";
import type { CadController } from "../cad/controller";

/** Prancheta CAD: duas camadas de canvas (desenho + sobreposição interativa). */
export function CanvasView({ ctl, focusCommand }: { ctl: CadController; focusCommand: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const w = wrap.current!;
    ctl.attach(main.current!, over.current!);
    const ro = new ResizeObserver(() => {
      const r = w.getBoundingClientRect();
      ctl.resize(Math.max(1, Math.floor(r.width)), Math.max(1, Math.floor(r.height)), window.devicePixelRatio || 1);
    });
    ro.observe(w);
    const pos = (e: MouseEvent) => {
      const r = w.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      w.setPointerCapture(e.pointerId);
      if (e.button === 1) e.preventDefault();
      ctl.pointerDown(pos(e), e.button, e.shiftKey);
      focusCommand();
    };
    const move = (e: PointerEvent) => ctl.pointerMove(pos(e), e.shiftKey);
    const up = (e: PointerEvent) => {
      w.releasePointerCapture(e.pointerId);
      ctl.pointerUp(pos(e), e.button, e.shiftKey);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      ctl.wheel(pos(e), dy);
    };
    const dbl = (e: MouseEvent) => {
      if (e.button === 1) ctl.zoomExtents();
    };
    const aux = (e: MouseEvent) => {
      // duplo clique do botão do meio = zoom extensão (convenção CAD)
      if (e.button === 1 && e.detail === 2) ctl.zoomExtents();
    };
    const ctx = (e: Event) => e.preventDefault();
    const leave = () => ctl.pointerLeave();
    w.addEventListener("pointerdown", down);
    w.addEventListener("pointermove", move);
    w.addEventListener("pointerup", up);
    w.addEventListener("wheel", wheel, { passive: false });
    w.addEventListener("dblclick", dbl);
    w.addEventListener("auxclick", aux);
    w.addEventListener("contextmenu", ctx);
    w.addEventListener("pointerleave", leave);
    return () => {
      ro.disconnect();
      w.removeEventListener("pointerdown", down);
      w.removeEventListener("pointermove", move);
      w.removeEventListener("pointerup", up);
      w.removeEventListener("wheel", wheel);
      w.removeEventListener("dblclick", dbl);
      w.removeEventListener("auxclick", aux);
      w.removeEventListener("contextmenu", ctx);
      w.removeEventListener("pointerleave", leave);
      ctl.detach();
    };
  }, [ctl, focusCommand]);

  return (
    <div className="canvas-wrap" ref={wrap}>
      <canvas ref={main} />
      <canvas ref={over} />
      <div className="canvas-tag">Modelo · Vista superior · mm reais</div>
    </div>
  );
}
