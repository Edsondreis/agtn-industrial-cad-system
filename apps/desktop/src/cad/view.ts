import type { BBox, Vec2 } from "@agtn/geometry";

/**
 * Viewport 2D: centro em coordenadas de mundo (mm) + escala (pixels por mm).
 * A geometria nunca é alterada pelo zoom; só a projeção para a tela.
 */
export class Viewport {
  cx = 0;
  cy = 0;
  /** pixels CSS por mm */
  scale = 2;
  width = 800;
  height = 600;

  static readonly MIN_SCALE = 1e-6;
  static readonly MAX_SCALE = 1e6;

  toScreen(p: Vec2): Vec2 {
    return { x: (p.x - this.cx) * this.scale + this.width / 2, y: this.height / 2 - (p.y - this.cy) * this.scale };
  }
  toWorld(s: Vec2): Vec2 {
    return { x: (s.x - this.width / 2) / this.scale + this.cx, y: (this.height / 2 - s.y) / this.scale + this.cy };
  }
  /** Caixa visível em coordenadas de mundo. */
  worldBox(margin = 0): BBox {
    const hw = this.width / 2 / this.scale + margin;
    const hh = this.height / 2 / this.scale + margin;
    return { minX: this.cx - hw, minY: this.cy - hh, maxX: this.cx + hw, maxY: this.cy + hh };
  }
  /** Zoom mantendo fixo o ponto de tela `s`. */
  zoomAt(s: Vec2, factor: number): void {
    const before = this.toWorld(s);
    this.scale = Math.min(Viewport.MAX_SCALE, Math.max(Viewport.MIN_SCALE, this.scale * factor));
    const after = this.toWorld(s);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }
  panPixels(dx: number, dy: number): void {
    this.cx -= dx / this.scale;
    this.cy += dy / this.scale;
  }
  fit(box: BBox, padding = 0.08): void {
    const w = Math.max(box.maxX - box.minX, 1e-6);
    const h = Math.max(box.maxY - box.minY, 1e-6);
    this.cx = (box.minX + box.maxX) / 2;
    this.cy = (box.minY + box.maxY) / 2;
    const sx = this.width / (w * (1 + padding * 2));
    const sy = this.height / (h * (1 + padding * 2));
    this.scale = Math.min(Viewport.MAX_SCALE, Math.max(Viewport.MIN_SCALE, Math.min(sx, sy)));
  }
}
