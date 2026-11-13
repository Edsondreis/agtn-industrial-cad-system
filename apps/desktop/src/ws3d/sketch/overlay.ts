import { type Constraint, type Id, type Pt, type Sketch, CONSTRAINT_LABEL, entityOf, isDimension, pointOf, roundRadius } from "@agtn/sketch";
import type { Frame } from "@agtn/solid";
import { BufferAttribute, BufferGeometry, Color, Group, LineBasicMaterial, LineDashedMaterial, LineSegments, Matrix4, Plane, Points, PointsMaterial, type Ray, Vector3 } from "three";
import type { EditorState, Hit, SketchEditor } from "./editor";

const COL = {
  full: new Color("#eef2f6"),
  under: new Color("#62a8ff"),
  cons: new Color("#e0983c"),
  sel: new Color("#ffc857"),
  hover: new Color("#9fd0ff"),
  bad: new Color("#ff6b6b"),
  axis: new Color("#5b6573"),
  rubber: new Color("#ffc857"),
};

const GLYPH: Partial<Record<Constraint["t"], string>> = {
  horizontal: "H",
  vertical: "V",
  parallel: "∥",
  perpendicular: "⊥",
  equal: "=",
  tangent: "T",
  concentric: "◎",
  fixed: "⚓",
  midpoint: "M",
  pointOnLine: "∈",
  pointOnCircle: "∈",
  coincident: "•",
};

/**
 * Desenho do esboço ativo no plano (three.js) + rótulos HTML de cotas e restrições.
 * Cores: azul = subdefinido, branco = definido, laranja tracejado = construção, amarelo = seleção, vermelho = conflito.
 */
export class SketchOverlay {
  readonly root = new Group();
  private readonly lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
  private readonly dashed = new LineSegments(new BufferGeometry(), new LineDashedMaterial({ color: COL.cons, dashSize: 3, gapSize: 2, depthTest: false, transparent: true }));
  private readonly axes = new LineSegments(new BufferGeometry(), new LineDashedMaterial({ color: COL.axis, dashSize: 6, gapSize: 4, depthTest: false, transparent: true, opacity: 0.8 }));
  private readonly rubber = new LineSegments(new BufferGeometry(), new LineDashedMaterial({ color: COL.rubber, dashSize: 2, gapSize: 1.5, depthTest: false }));
  private readonly pts = new Points(new BufferGeometry(), new PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, depthTest: false }));
  private labels: HTMLElement[] = [];
  private readonly m = new Matrix4();
  readonly plane: Plane;
  private unsub: () => void;

  constructor(
    readonly frame: Frame,
    readonly editor: SketchEditor,
    private readonly overlay: HTMLElement,
    private readonly redraw: () => void,
    private readonly wpp: () => number,
  ) {
    const { x, y, n, o } = frame;
    this.m.set(x.x, y.x, n.x, o.x, x.y, y.y, n.y, o.y, x.z, y.z, n.z, o.z, 0, 0, 0, 1);
    this.root.matrixAutoUpdate = false;
    this.root.matrix.copy(this.m);
    for (const o of [this.axes, this.lines, this.dashed, this.rubber, this.pts]) {
      o.renderOrder = 20;
      o.raycast = () => undefined;
      this.root.add(o);
    }
    this.plane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(n.x, n.y, n.z), new Vector3(o.x, o.y, o.z));
    this.unsub = editor.subscribe(() => this.rebuild());
    this.rebuild();
  }

  /** Raio do mouse → ponto do plano em coordenadas do esboço. */
  project(ray: Ray): Pt | null {
    const hit = ray.intersectPlane(this.plane, new Vector3());
    if (!hit) return null;
    const d = hit.sub(new Vector3(this.frame.o.x, this.frame.o.y, this.frame.o.z));
    return { x: d.dot(new Vector3(this.frame.x.x, this.frame.x.y, this.frame.x.z)), y: d.dot(new Vector3(this.frame.y.x, this.frame.y.y, this.frame.y.z)) };
  }
  toWorld(p: Pt): Vector3 {
    return new Vector3(p.x, p.y, 0).applyMatrix4(this.m);
  }

  /** O que está sob o cursor (tolerância em pixels convertida para mm). */
  hitTest(p: Pt, s: Sketch = this.editor.sketch): Hit {
    const tol = this.wpp();
    let best: { id: Id; d: number } | null = null;
    for (const q of [...Object.values(s.points), pointOf(s, "O")!]) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < 9 * tol && (!best || d < best.d)) best = { id: q.id, d };
    }
    if (best) {
      const q = pointOf(s, best.id)!;
      return { p: { x: q.x, y: q.y }, point: best.id };
    }
    let bestE: { id: Id; d: number } | null = null;
    for (const e of Object.values(s.entities)) {
      const d = distToEntity(s, e.id, p);
      if (d < 6 * tol && (!bestE || d < bestE.d)) bestE = { id: e.id, d };
    }
    if (!bestE) for (const id of ["AX", "AY"]) if (distToEntity(s, id, p) < 5 * tol) bestE = { id, d: 0 };
    return bestE ? { p, entity: bestE.id } : { p };
  }

  private rebuild() {
    const st = this.editor.getState();
    const s = st.sketch;
    const free = st.solve.freePoints;
    const conflicts = new Set(st.solve.conflicts);
    const bad = st.solve.status === "inconsistent" || st.solve.status === "unsolved";
    const sel = new Set(st.sel);
    const hov = st.cursor?.entity ?? st.cursor?.point ?? null;
    const pos: number[] = [];
    const col: number[] = [];
    const dpos: number[] = [];
    const push = (arr: number[], a: Pt, b: Pt) => arr.push(a.x, a.y, 0, b.x, b.y, 0);
    for (const e of Object.values(s.entities)) {
      const pts = e.t === "line" ? [e.p1, e.p2] : e.t === "arc" ? [e.c, e.p1, e.p2] : e.t === "circle" ? [e.c] : [e.p];
      const under = pts.some((p) => free.has(p)) || (e.t === "circle" && free.has(e.id));
      const c = sel.has(e.id) ? COL.sel : hov === e.id ? COL.hover : bad || conflicts.size ? COL.bad : under ? COL.under : COL.full;
      const segs = polyOf(s, e.id);
      for (const [a, b] of segs) {
        if (e.cons) push(dpos, a, b);
        else {
          push(pos, a, b);
          col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }
      }
    }
    setGeom(this.lines, pos, col);
    setGeom(this.dashed, dpos);
    this.dashed.computeLineDistances();
    // eixos de referência do esboço
    const L = Math.max(200, this.wpp() * 2000);
    setGeom(this.axes, [-L, 0, 0, L, 0, 0, 0, -L, 0, 0, L, 0]);
    this.axes.computeLineDistances();
    // pontos
    const pp: number[] = [];
    const pc: number[] = [];
    for (const p of [...Object.values(s.points), pointOf(s, "O")!]) {
      const c = sel.has(p.id) ? COL.sel : hov === p.id ? COL.hover : p.id === "O" ? COL.cons : free.has(p.id) ? COL.under : COL.full;
      pp.push(p.x, p.y, 0);
      pc.push(c.r, c.g, c.b);
    }
    setGeom(this.pts, pp, pc);
    // linha elástica da ferramenta
    setGeom(this.rubber, rubberOf(st));
    this.rubber.computeLineDistances();
    this.rebuildLabels(st);
    this.redraw();
  }

  /** Rótulos HTML das cotas e restrições. Os elementos são reaproveitados por id (o duplo clique sobrevive às atualizações). */
  private rebuildLabels(st: EditorState) {
    const s = st.sketch;
    const sel = new Set(st.sel);
    const conflicts = new Set([...st.solve.conflicts, ...st.solve.redundant]);
    const count = new Map<string, number>();
    const keep = new Map<string, HTMLElement>();
    const old = new Map(this.labels.map((el) => [el.dataset.constraint!, el]));
    for (const c of s.constraints) {
      const at = anchorOf(s, c);
      if (!at) continue;
      const dimension = isDimension(c);
      const g = dimension ? null : GLYPH[c.t];
      if (!dimension && (!g || c.t === "coincident")) continue;
      let el = old.get(c.id);
      if (!el) {
        el = document.createElement("div");
        el.dataset.constraint = c.id;
        const id = c.id;
        el.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const a = (el as unknown as { _at: Pt })._at;
          this.editor.click({ p: a, constraint: id }, ev.ctrlKey || ev.shiftKey);
        });
        if (dimension)
          el.addEventListener("dblclick", (ev) => {
            ev.stopPropagation();
            this.editor.editDimension(id);
          });
        this.overlay.appendChild(el);
      }
      if (dimension) {
        el.className = `sk-dim${sel.has(c.id) ? " sel" : ""}${conflicts.has(c.id) ? " bad" : ""}`;
        const v = c.v;
        el.textContent = c.t === "angle" ? `${fmt(v)}°` : c.t === "diameter" ? `Ø${fmt(v)}` : c.t === "radius" ? `R${fmt(v)}` : fmt(Math.abs(v));
        el.title = `${CONSTRAINT_LABEL[c.t]} — duplo clique para editar`;
      } else {
        const key = `${Math.round(at.x / (this.wpp() * 14))},${Math.round(at.y / (this.wpp() * 14))}`;
        const k = count.get(key) ?? 0;
        count.set(key, k + 1);
        el.className = `sk-glyph${sel.has(c.id) ? " sel" : ""}${conflicts.has(c.id) ? " bad" : ""}`;
        el.textContent = g!;
        el.title = `${CONSTRAINT_LABEL[c.t]} (${c.id}) — clique para selecionar, Delete apaga`;
        // deslocado da geometria para não cobrir a linha (clique na entidade continua livre)
        el.style.marginLeft = `${14 + k * 16}px`;
        el.style.marginTop = "-13px";
      }
      (el as unknown as { _at: Pt })._at = at;
      keep.set(c.id, el);
    }
    for (const [id, el] of old) if (!keep.has(id)) el.remove();
    this.labels = [...keep.values()];
  }

  /** Reposiciona rótulos HTML (a cada quadro em que a câmera muda). */
  place(toScreen: (p: Vector3) => { x: number; y: number }) {
    for (const el of this.labels) {
      const at = (el as unknown as { _at: Pt })._at;
      const s = toScreen(this.toWorld(at));
      el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
    }
  }

  /** Extensão do esboço (para enquadrar). */
  extent(): { c: Vector3; r: number } {
    const ps = Object.values(this.editor.sketch.points);
    if (!ps.length) return { c: this.toWorld({ x: 0, y: 0 }), r: 100 };
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of [...ps, { x: 0, y: 0 }]) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    for (const e of Object.values(this.editor.sketch.entities))
      if (e.t === "circle") {
        const c = pointOf(this.editor.sketch, e.c)!;
        x0 = Math.min(x0, c.x - e.r);
        x1 = Math.max(x1, c.x + e.r);
        y0 = Math.min(y0, c.y - e.r);
        y1 = Math.max(y1, c.y + e.r);
      }
    return { c: this.toWorld({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }), r: Math.max(20, Math.hypot(x1 - x0, y1 - y0) / 2) };
  }

  dispose() {
    this.unsub();
    for (const l of this.labels) l.remove();
    for (const o of [this.axes, this.lines, this.dashed, this.rubber, this.pts]) {
      o.geometry.dispose();
      (o.material as LineBasicMaterial).dispose();
    }
    this.root.removeFromParent();
  }
}

function setGeom(o: LineSegments | Points, pos: number[], col?: number[]) {
  o.geometry.dispose();
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  if (col) g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.computeBoundingSphere();
  o.geometry = g;
}

const fmt = (v: number) => (Math.round(v * 1000) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Segmentos (polilinha) de uma entidade para desenho. */
function polyOf(s: Sketch, id: Id): [Pt, Pt][] {
  const e = entityOf(s, id);
  if (!e) return [];
  const P = (pid: Id) => pointOf(s, pid)!;
  if (e.t === "line") return [[P(e.p1), P(e.p2)]];
  if (e.t === "point") return [];
  const c = P(e.c);
  const r = roundRadius(s, e);
  let a0 = 0;
  let sw = Math.PI * 2;
  if (e.t === "arc") {
    a0 = Math.atan2(P(e.p1).y - c.y, P(e.p1).x - c.x);
    sw = Math.atan2(P(e.p2).y - c.y, P(e.p2).x - c.x) - a0;
    while (sw <= 0) sw += Math.PI * 2;
  }
  const n = Math.max(8, Math.ceil(sw / (Math.PI / 48)));
  const out: [Pt, Pt][] = [];
  for (let i = 0; i < n; i++) {
    const t0 = a0 + (sw * i) / n;
    const t1 = a0 + (sw * (i + 1)) / n;
    out.push([
      { x: c.x + r * Math.cos(t0), y: c.y + r * Math.sin(t0) },
      { x: c.x + r * Math.cos(t1), y: c.y + r * Math.sin(t1) },
    ]);
  }
  return out;
}

function distToEntity(s: Sketch, id: Id, p: Pt): number {
  let best = Infinity;
  for (const [a, b] of polyOf(s, id)) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

/** Posição do rótulo de uma restrição/cota. */
function anchorOf(s: Sketch, c: Constraint): Pt | null {
  if ("at" in c && c.at) return c.at;
  const P = (id: Id) => pointOf(s, id);
  const mid = (id: Id): Pt | null => {
    const e = entityOf(s, id);
    if (!e) return null;
    if (e.t === "line") {
      const a = P(e.p1)!;
      const b = P(e.p2)!;
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    if (e.t === "point") return P(e.p) ?? null;
    const cc = P(e.c)!;
    return { x: cc.x + roundRadius(s, e) * 0.7071, y: cc.y + roundRadius(s, e) * 0.7071 };
  };
  switch (c.t) {
    case "horizontal":
    case "vertical":
    case "length":
      return mid(c.l);
    case "fixed":
    case "pointOnLine":
    case "pointOnCircle":
    case "midpoint":
      return P(c.p) ?? null;
    case "coincident":
      return P(c.a) ?? null;
    case "radius":
    case "diameter":
      return mid(c.c);
    case "distance":
    case "distanceX":
    case "distanceY": {
      const a = P(c.a);
      const b = P(c.b);
      return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
    }
    case "pointLineDistance":
      return P(c.p) ?? null;
    default:
      return mid(c.a);
  }
}

/** Pré-visualização da ferramenta (do último clique até o cursor). */
function rubberOf(st: EditorState): number[] {
  const cur = st.cursor?.p;
  if (!cur || !st.clicks.length) return [];
  const a = st.clicks[0].p;
  const seg = (p: Pt, q: Pt) => [p.x, p.y, 0, q.x, q.y, 0];
  switch (st.tool) {
    case "line":
      return seg(st.clicks[st.clicks.length - 1].p, cur);
    case "rect":
      return [...seg(a, { x: cur.x, y: a.y }), ...seg({ x: cur.x, y: a.y }, cur), ...seg(cur, { x: a.x, y: cur.y }), ...seg({ x: a.x, y: cur.y }, a)];
    case "circle": {
      const r = Math.hypot(cur.x - a.x, cur.y - a.y);
      const out: number[] = [];
      for (let i = 0; i < 64; i++) {
        const t0 = (i / 64) * Math.PI * 2;
        const t1 = ((i + 1) / 64) * Math.PI * 2;
        out.push(...seg({ x: a.x + r * Math.cos(t0), y: a.y + r * Math.sin(t0) }, { x: a.x + r * Math.cos(t1), y: a.y + r * Math.sin(t1) }));
      }
      return out;
    }
    case "arc":
      return st.clicks.length === 1 ? seg(a, cur) : [...seg(a, cur), ...seg(cur, st.clicks[1].p)];
    default:
      return [];
  }
}
