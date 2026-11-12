import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments } from "three";
import type { CamState } from "./camera";

/** Passo "redondo" da grade (1, 2, 5 × 10ⁿ mm) para ~`cells` divisões na altura da vista. */
export function gridStep(viewHeight: number, cells = 24): number {
  const raw = viewHeight / cells;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}

/**
 * Grade técnica no plano XY (Z = 0) com linhas principais a cada 5 divisões e eixos X (vermelho) / Y (verde),
 * mais o eixo Z (azul). Adapta o passo ao zoom e acompanha o alvo da câmera; nunca passa de ~600 linhas.
 */
export class Grid3D {
  readonly root = new Group();
  private minor = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0x8a96a5, transparent: true, opacity: 0.13, depthWrite: false }));
  private major = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0x9fb0c2, transparent: true, opacity: 0.3, depthWrite: false }));
  private axes = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
  private key = "";
  step = 10;

  constructor() {
    this.minor.renderOrder = -2;
    this.major.renderOrder = -1;
    this.root.add(this.minor, this.major, this.axes);
    this.minor.raycast = () => undefined;
    this.major.raycast = () => undefined;
    this.axes.raycast = () => undefined;
  }

  update(c: CamState, aspect: number) {
    const step = gridStep(c.height);
    const half = Math.ceil((Math.max(c.height * Math.max(aspect, 1), c.height) * 1.6) / step / 5) * 5 * step;
    const cx = Math.round(c.target.x / (step * 5)) * step * 5;
    const cy = Math.round(c.target.y / (step * 5)) * step * 5;
    const key = `${step}|${half}|${cx}|${cy}`;
    if (key === this.key) return;
    this.key = key;
    this.step = step;
    const minor: number[] = [];
    const major: number[] = [];
    const n = Math.round(half / step);
    for (let i = -n; i <= n; i++) {
      const x = cx + i * step;
      const y = cy + i * step;
      const isMajor = Math.round(x / step) % 5 === 0;
      const isMajorY = Math.round(y / step) % 5 === 0;
      if (Math.abs(x) > 1e-9) (isMajor ? major : minor).push(x, cy - half, 0, x, cy + half, 0);
      if (Math.abs(y) > 1e-9) (isMajorY ? major : minor).push(cx - half, y, 0, cx + half, y, 0);
    }
    set(this.minor, minor);
    set(this.major, major);
    // eixos passam pela origem e cobrem a grade
    const L = half + Math.max(Math.abs(cx), Math.abs(cy));
    const zl = half * 0.35;
    const ax = new Float32Array([-L, 0, 0, L, 0, 0, 0, -L, 0, 0, L, 0, 0, 0, 0, 0, 0, zl]);
    const col = new Float32Array([0.85, 0.3, 0.3, 0.85, 0.3, 0.3, 0.35, 0.75, 0.4, 0.35, 0.75, 0.4, 0.3, 0.55, 0.95, 0.3, 0.55, 0.95]);
    this.axes.geometry.setAttribute("position", new BufferAttribute(ax, 3));
    this.axes.geometry.setAttribute("color", new BufferAttribute(col, 3));
    this.axes.geometry.computeBoundingSphere();
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }

  dispose() {
    for (const l of [this.minor, this.major, this.axes]) {
      l.geometry.dispose();
      (l.material as LineBasicMaterial).dispose();
    }
  }
}

function set(l: LineSegments, pts: number[]) {
  l.geometry.dispose();
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
  g.computeBoundingSphere();
  l.geometry = g;
}
