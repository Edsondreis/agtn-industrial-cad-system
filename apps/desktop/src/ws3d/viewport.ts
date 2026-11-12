import { type Model3D, type NodeId, isShown, subtree } from "@agtn/model3d";
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  type Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Sphere,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { LineMaterial, LineMaterial as LineMat } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import {
  type CamState,
  FOV_DEG,
  type StdView,
  eyeOf,
  fitSphere,
  initialCam,
  lerpCam,
  matchStdView,
  orbit,
  pan,
  stdView,
  viewFromDir,
  worldPerPixel,
  zoomAt,
} from "./camera";
import { Grid3D } from "./grid";
import type { Frame } from "@agtn/solid";
import type { SketchEditor } from "./sketch/editor";
import { SketchOverlay } from "./sketch/overlay";
import type { BodyGeom, SyncResult } from "./protocol";
import { type Sel, type Ws3dStore, sameSel, selKey } from "./store";
import { ACCENT, BodyVisual, HOVER, disposeOverlay } from "./visuals";

const DRAG_PX = 4;
const EDGE_PX = 6;
const VERTEX_PX = 9;

export interface PickHit {
  readonly sel: Sel | null;
  readonly point: Vector3 | null;
}

/**
 * Viewport 3D do AGTN: renderização sob demanda (só redesenha quando algo muda), navegação CAD,
 * seleção de face/aresta/vértice/corpo pelos índices topológicos reais do OCCT, destaques e medição.
 */
export class Viewport3D {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly ortho = new OrthographicCamera(-1, 1, 1, -1, 0.01, 1e7);
  private readonly persp = new PerspectiveCamera(FOV_DEG, 1, 0.1, 1e7);
  private readonly headlight = new DirectionalLight(0xffffff, 1.05);
  private readonly grid = new Grid3D();
  private readonly ray = new Raycaster();
  private readonly overlay: HTMLDivElement;
  private readonly bodies = new Map<NodeId, BodyVisual>();
  private model: Model3D | null = null;
  private highlights: (Mesh | LineSegments2)[] = [];
  private marks: { el: HTMLDivElement; p: Vector3 }[] = [];
  private cam: CamState = initialCam();
  private anim: { from: CamState; to: CamState; t0: number; ms: number } | null = null;
  private w = 1;
  private h = 1;
  private dirty = true;
  private raf = 0;
  private hoverQueued: { x: number; y: number } | null = null;
  private drag: { button: number; x: number; y: number; lx: number; ly: number; moved: boolean; mode: "orbit" | "pan"; pivot: Vector3 } | null = null;
  private camListeners = new Set<(c: CamState) => void>();
  private readonly ro: ResizeObserver;
  private disposed = false;
  private sceneSphere = new Sphere(new Vector3(), 200);
  private sketchOv: SketchOverlay | null = null;
  private sketchDrag: string | null = null;
  private preSketch: CamState | null = null;
  private preview: { body: NodeId; visual: BodyVisual; mode: "replace" | "ghost" } | null = null;
  frameMs = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly store: Ws3dStore,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = "v3-canvas";
    this.renderer.domElement.tabIndex = 0;
    host.appendChild(this.renderer.domElement);
    this.overlay = document.createElement("div");
    this.overlay.className = "v3-overlay";
    host.appendChild(this.overlay);

    this.scene.add(new AmbientLight(0xffffff, 0.42));
    this.scene.add(new HemisphereLight(0xdfe8f3, 0x2a2f36, 0.55));
    this.scene.add(this.headlight, this.headlight.target);
    this.scene.add(this.grid.root);

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointerleave", this.onLeave);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("dblclick", this.onDbl);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("auxclick", (e) => e.button === 1 && e.preventDefault());
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.unsub = store.subscribe(() => this.onStore());
    this.loop();
  }
  private unsub: () => void;

  /* ------------------------------------------------------------------ estado da câmera */

  get camera(): CamState {
    return this.cam;
  }
  onCamera(fn: (c: CamState) => void) {
    this.camListeners.add(fn);
    fn(this.cam);
    return () => void this.camListeners.delete(fn);
  }
  private setCam(c: CamState, notify = true) {
    this.cam = c;
    this.dirty = true;
    if (notify) for (const f of this.camListeners) f(c);
  }
  animateTo(to: CamState, ms = 320) {
    const rm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (rm || ms <= 0) {
      this.anim = null;
      this.setCam(to);
      return;
    }
    this.anim = { from: this.cam, to, t0: performance.now(), ms };
    this.dirty = true;
  }
  view(v: StdView) {
    this.animateTo(this.fitted(stdView(v, this.cam)));
  }
  viewDir(d: [number, number, number]) {
    this.animateTo(this.fitted(viewFromDir(d, this.cam)));
  }
  /** Gira a vista em torno da direção de observação (botões do ViewCube). */
  roll(deg: number) {
    const up = this.cam.up.clone().applyAxisAngle(this.cam.dir, (deg * Math.PI) / 180).normalize();
    this.animateTo({ ...this.cam, up });
  }
  setOrtho(ortho: boolean) {
    this.setCam({ ...this.cam, ortho });
  }
  /** Enquadra tudo o que está visível (ou a seleção). */
  fit(selectionOnly = false) {
    this.animateTo(this.fitted(this.cam, selectionOnly));
  }
  private fitted(c: CamState, selectionOnly = false): CamState {
    const s = selectionOnly ? this.selectionSphere() : null;
    const sp = s ?? this.visibleSphere();
    if (!sp) return { ...c, target: new Vector3(), height: 400 };
    return fitSphere(c, sp.center, sp.radius, this.w / this.h);
  }
  private visibleSphere(): Sphere | null {
    const box = new Box3();
    let any = false;
    for (const b of this.bodies.values()) {
      if (!b.root.visible) continue;
      box.union(new Box3().setFromCenterAndSize(b.sphere.center, new Vector3(1, 1, 1).multiplyScalar(b.sphere.radius * 2)));
      any = true;
    }
    if (!any) return null;
    // esfera mais justa: caixas reais dos corpos
    const tight = new Box3();
    for (const b of this.bodies.values()) if (b.root.visible) tight.union(boxOf(b.geom));
    return tight.getBoundingSphere(new Sphere());
  }
  private selectionSphere(): Sphere | null {
    const box = new Box3();
    let any = false;
    for (const s of this.store.snap.sel) {
      if (s.t === "node") {
        for (const id of this.model ? subtree(this.model, s.id) : []) {
          const b = this.bodies.get(id);
          if (b?.root.visible) {
            box.union(boxOf(b.geom));
            any = true;
          }
        }
      } else {
        const b = this.bodies.get(s.body);
        if (!b) continue;
        if (s.kind === "vertex") box.expandByPoint(b.vertex(s.index));
        else box.union(boxOf(b.geom));
        any = true;
      }
    }
    if (!any) return null;
    const sp = box.getBoundingSphere(new Sphere());
    sp.radius = Math.max(sp.radius, 5);
    return sp;
  }

  /* ------------------------------------------------------------------ modelo e corpos */

  applySync(r: SyncResult) {
    for (const id of r.removed) this.removeBody(id);
    for (const g of r.built) {
      this.removeBody(g.id);
      const v = new BodyVisual(g);
      v.setMode(this.store.snap.mode);
      if (this.sketchOv) v.setGhost(true);
      this.bodies.set(g.id, v);
      this.scene.add(v.root);
    }
    // corpos com erro de regeneração não ficam com geometria velha
    for (const id of Object.keys(r.errors)) this.removeBody(id);
    if (this.model) this.applyModel(this.model);
    this.updateSceneSphere();
    this.onStore();
  }
  private removeBody(id: NodeId) {
    const v = this.bodies.get(id);
    if (!v) return;
    this.scene.remove(v.root);
    v.dispose();
    this.bodies.delete(id);
    this.dirty = true;
  }
  applyModel(m: Model3D) {
    this.model = m;
    for (const [id, v] of this.bodies) {
      const n = m.nodes[id];
      if (!n || n.kind !== "body") continue;
      v.root.visible = isShown(m, id);
      v.setColor(n.color);
    }
    this.onStore();
    this.dirty = true;
  }
  private updateSceneSphere() {
    this.sceneSphere = this.visibleSphere() ?? new Sphere(new Vector3(), 200);
  }
  hasBodies() {
    return this.bodies.size > 0;
  }
  geom(id: NodeId): BodyGeom | undefined {
    return this.bodies.get(id)?.geom;
  }
  triangleCount(): number {
    let n = 0;
    for (const b of this.bodies.values()) n += b.geom.indices.length / 3;
    return n;
  }

  /* ------------------------------------------------------------------ destaques */

  private onStore() {
    const s = this.store.snap;
    for (const b of this.bodies.values()) b.setMode(s.mode);
    this.grid.visible = s.grid;
    if (this.cam.ortho !== s.ortho) this.setCam({ ...this.cam, ortho: s.ortho });
    // limpa destaques anteriores
    for (const o of this.highlights) {
      o.parent?.remove(o);
      disposeOverlay(o);
    }
    this.highlights = [];
    for (const mk of this.marks) mk.el.remove();
    this.marks = [];
    const selBodies = new Set<NodeId>();
    for (const x of s.sel) if (x.t === "node" && this.model) for (const id of subtree(this.model, x.id)) selBodies.add(id);
    const hoverBodies = new Set<NodeId>();
    if (s.hover?.t === "node" && this.model) for (const id of subtree(this.model, s.hover.id)) hoverBodies.add(id);
    for (const [id, b] of this.bodies) b.setState(selBodies.has(id), hoverBodies.has(id));
    for (const x of s.sel) this.addTopoHighlight(x, ACCENT, false);
    if (s.hover && !s.sel.some((x) => sameSel(x, s.hover))) this.addTopoHighlight(s.hover, HOVER, true);
    if (s.measure?.m.pa && s.measure.m.pb) {
      const a = new Vector3(s.measure.m.pa.x, s.measure.m.pa.y, s.measure.m.pa.z);
      const b = new Vector3(s.measure.m.pb.x, s.measure.m.pb.y, s.measure.m.pb.z);
      const g = new LineSegmentsGeometry().setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
      const mat = new LineMat({ color: 0xffc857, linewidth: 2, dashed: false, depthTest: false, transparent: true });
      mat.resolution.set(this.w, this.h);
      const l = new LineSegments2(g, mat);
      l.renderOrder = 10;
      this.scene.add(l);
      this.highlights.push(l);
      this.mark(a, "v3-mark meas");
      this.mark(b, "v3-mark meas");
      const lbl = this.mark(a.clone().lerp(b, 0.5), "v3-label");
      lbl.textContent = `${fmt(s.measure.m.distance)} mm`;
    }
    this.dirty = true;
  }
  private mark(p: Vector3, cls: string): HTMLDivElement {
    const el = document.createElement("div");
    el.className = cls;
    this.overlay.appendChild(el);
    this.marks.push({ el, p });
    return el;
  }
  private addTopoHighlight(x: Sel, color: Color, hover: boolean) {
    if (x.t !== "topo") return;
    const b = this.bodies.get(x.body);
    if (!b || !b.root.visible) return;
    if (x.kind === "face") {
      const o = b.faceOverlay(x.index, color, hover ? 0.32 : 0.5);
      if (o) {
        b.root.add(o);
        this.highlights.push(o);
      }
    } else if (x.kind === "edge") {
      const o = b.edgeOverlay(x.index, color, hover ? 3 : 3.5, this.w, this.h);
      if (o) {
        b.root.add(o);
        this.highlights.push(o);
      }
    } else {
      this.mark(b.vertex(x.index), hover ? "v3-mark hover" : "v3-mark sel");
    }
  }

  /* ------------------------------------------------------------------ seleção (picking) */

  private ndc(px: number, py: number) {
    return new Vector2((px / this.w) * 2 - 1, -(py / this.h) * 2 + 1);
  }
  private toScreen(p: Vector3): { x: number; y: number; z: number } {
    const v = p.clone().project(this.activeCamera());
    return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h, z: v.z };
  }

  /* ------------------------------------------------------------------ esboço */

  /** Ativa o modo esboço: plano em coordenadas do MUNDO, editor com a lógica das ferramentas. */
  setSketch(frame: Frame | null, editor?: SketchEditor) {
    const was = !!this.sketchOv;
    this.sketchOv?.dispose();
    this.sketchOv = null;
    this.sketchDrag = null;
    for (const b of this.bodies.values()) b.setGhost(!!frame);
    // ao sair do esboço volta à vista anterior (orientação de trabalho do usuário)
    if (!frame && was && this.preSketch) {
      this.animateTo(this.preSketch);
      this.preSketch = null;
    }
    if (frame && editor) {
      if (!was) this.preSketch = { ...this.cam, target: this.cam.target.clone(), dir: this.cam.dir.clone(), up: this.cam.up.clone() };
      this.sketchOv = new SketchOverlay(frame, editor, this.overlay, () => (this.dirty = true), () => worldPerPixel(this.cam, this.h));
      this.scene.add(this.sketchOv.root);
      const ext = this.sketchOv.extent();
      const to: CamState = { ...this.cam, dir: new Vector3(frame.n.x, frame.n.y, frame.n.z).normalize(), up: new Vector3(frame.y.x, frame.y.y, frame.y.z).normalize(), ortho: true };
      this.animateTo(fitSphere(to, ext.c, Math.max(ext.r, this.cam.height / 4), this.w / this.h));
    }
    this.dirty = true;
  }
  get sketching() {
    return !!this.sketchOv;
  }
  /** Olha o esboço de frente (botão "Normal ao esboço"). */
  sketchNormal() {
    const ov = this.sketchOv;
    if (!ov) return;
    const f = ov.frame;
    const ext = ov.extent();
    this.animateTo(fitSphere({ ...this.cam, dir: new Vector3(f.n.x, f.n.y, f.n.z), up: new Vector3(f.y.x, f.y.y, f.y.z) }, ext.c, ext.r, this.w / this.h));
  }
  /** Ponto do esboço (mm) → pixel no viewport (campo de cota junto ao cursor). */
  sketchScreen(p: { x: number; y: number }): { x: number; y: number } | null {
    const ov = this.sketchOv;
    if (!ov) return null;
    this.syncCamera();
    const s = this.toScreen(ov.toWorld(p));
    return { x: s.x, y: s.y };
  }
  private sketchHit(px: number, py: number) {
    const ov = this.sketchOv!;
    this.ray.setFromCamera(this.ndc(px, py), this.activeCamera());
    const p = ov.project(this.ray.ray);
    return p ? ov.hitTest(p) : null;
  }

  /* ------------------------------------------------------------------ prévia de operação */

  /** Mostra a prévia de uma peça: "replace" substitui o corpo; "ghost" sobrepõe translúcido. */
  setPreview(body: NodeId | null, geom: BodyGeom | null, mode: "replace" | "ghost" = "replace") {
    if (this.preview) {
      this.scene.remove(this.preview.visual.root);
      this.preview.visual.dispose();
      const orig = this.bodies.get(this.preview.body);
      if (orig && this.model) orig.root.visible = isShown(this.model, this.preview.body);
      this.preview = null;
    }
    if (body && geom) {
      const v = new BodyVisual(geom);
      v.setColor("#7fb6f0");
      v.setMode(this.store.snap.mode);
      v.mesh.raycast = () => undefined;
      v.edges.raycast = () => undefined;
      if (mode === "ghost") v.setGhost(true, 0.45);
      else {
        const orig = this.bodies.get(body);
        if (orig) orig.root.visible = false;
      }
      this.scene.add(v.root);
      this.preview = { body, visual: v, mode };
    }
    this.dirty = true;
  }

  /** Posição na janela (clientX/Y) de um ponto do mundo — usado pelos testes de ponta a ponta. */
  clientOf(x: number, y: number, z: number): { x: number; y: number } {
    this.syncCamera();
    const s = this.toScreen(new Vector3(x, y, z));
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  }
  get animating() {
    return !!this.anim;
  }

  /** Elemento sob o cursor conforme o filtro. Retorna também o ponto 3D da superfície (para o status e o pivô). */
  pickAt(px: number, py: number): PickHit {
    const filter = this.store.snap.filter;
    const camera = this.activeCamera();
    this.ray.setFromCamera(this.ndc(px, py), camera);
    const wpp = worldPerPixel(this.cam, this.h);
    // o corpo substituído pela prévia continua selecionável (escolha de arestas/faces durante a operação)
    const visible = [...this.bodies.values()].filter((b) => b.root.visible || (this.preview?.mode === "replace" && this.preview.body === b.id));
    const shaded = this.store.snap.mode !== "arame";

    // 1) face mais próxima
    let face: { b: BodyVisual; tri: number; point: Vector3; distance: number } | null = null;
    if (shaded) {
      const hits = this.ray.intersectObjects(visible.map((b) => b.mesh), false);
      const h = hits.find((x) => x.faceIndex !== undefined && x.faceIndex !== null);
      if (h) face = { b: this.bodies.get(h.object.userData.body as string)!, tri: h.faceIndex!, point: h.point.clone(), distance: h.distance };
    }
    const tolDepth = (face ? 12 * wpp : Infinity) + 1e-6 * this.sceneSphere.radius;
    const occluded = (p: Vector3) => {
      if (!face) return false;
      const t = p.clone().sub(this.ray.ray.origin).dot(this.ray.ray.direction);
      return t > face.distance + tolDepth;
    };

    // 2) vértice mais próximo na tela
    let vert: { b: BodyVisual; i: number; d: number; p: Vector3 } | null = null;
    if (filter === "auto" || filter === "vertice") {
      for (const b of visible) {
        for (let i = 0; i < b.vertexCount; i++) {
          const p = b.vertex(i);
          const s = this.toScreen(p);
          const d = Math.hypot(s.x - px, s.y - py);
          if (d <= VERTEX_PX && (!vert || d < vert.d) && s.z <= 1 && !occluded(p)) vert = { b, i, d, p };
        }
      }
    }
    // 3) aresta mais próxima na tela
    let edge: { b: BodyVisual; e: number; d: number; p: Vector3 } | null = null;
    if (filter === "auto" || filter === "aresta" || (!shaded && filter !== "vertice")) {
      this.ray.params.Line = { threshold: EDGE_PX * wpp * 1.5 };
      const hits = this.ray.intersectObjects(visible.filter((b) => b.edges.visible || shaded).map((b) => b.edges), false);
      for (const h of hits) {
        const p = h.point.clone();
        const s = this.toScreen(p);
        const d = Math.hypot(s.x - px, s.y - py);
        if (d > EDGE_PX || occluded(p)) continue;
        const b = this.bodies.get(h.object.userData.body as string)!;
        const seg = Math.floor((h.index ?? 0) / 2);
        const e = b.segEdge[seg];
        if (e === undefined) continue;
        if (!edge || d < edge.d) edge = { b, e, d, p };
      }
    }
    const pt = face?.point ?? vert?.p ?? edge?.p ?? null;
    const topo = (b: BodyVisual, kind: "face" | "edge" | "vertex", index: number): Sel => ({ t: "topo", body: b.id, kind, index });
    const bodyOf = (b: BodyVisual): Sel => ({ t: "node", id: b.id });
    switch (filter) {
      case "vertice":
        return { sel: vert ? topo(vert.b, "vertex", vert.i) : null, point: pt };
      case "aresta":
        return { sel: edge ? topo(edge.b, "edge", edge.e) : null, point: pt };
      case "face":
        return { sel: face ? topo(face.b, "face", face.b.faceOfTriangle(face.tri)) : null, point: pt };
      case "corpo": {
        const b = face?.b ?? edge?.b ?? vert?.b;
        return { sel: b ? bodyOf(b) : null, point: pt };
      }
      default:
        if (vert) return { sel: topo(vert.b, "vertex", vert.i), point: pt };
        if (edge) return { sel: topo(edge.b, "edge", edge.e), point: pt };
        if (face) return { sel: topo(face.b, "face", face.b.faceOfTriangle(face.tri)), point: pt };
        return { sel: null, point: null };
    }
  }

  /* ------------------------------------------------------------------ entrada */

  private local(e: PointerEvent | WheelEvent | MouseEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private onDown = (e: PointerEvent) => {
    this.renderer.domElement.focus({ preventScroll: true });
    const p = this.local(e);
    if (this.sketchOv && e.button === 0) {
      const hit = this.sketchHit(p.x, p.y);
      const ed = this.sketchOv.editor;
      if (hit?.point && ed.currentTool === "select" && ed.beginDrag(hit.point)) {
        this.sketchDrag = hit.point;
        this.renderer.domElement.setPointerCapture(e.pointerId);
        this.drag = { button: 0, x: p.x, y: p.y, lx: p.x, ly: p.y, moved: false, mode: "pan", pivot: this.cam.target.clone() };
        return;
      }
    }
    const orbitBtn = e.button === 0 || (e.button === 1 && e.shiftKey);
    const panBtn = (e.button === 1 && !e.shiftKey) || e.button === 2;
    if (!orbitBtn && !panBtn) return;
    if (e.button === 1) e.preventDefault();
    this.renderer.domElement.setPointerCapture(e.pointerId);
    // pivô da órbita: ponto da peça sob o cursor; senão, o alvo da câmera
    const hit = orbitBtn ? this.pickAt(p.x, p.y).point : null;
    this.anim = null;
    this.drag = { button: e.button, x: p.x, y: p.y, lx: p.x, ly: p.y, moved: false, mode: orbitBtn ? "orbit" : "pan", pivot: hit ?? this.cam.target.clone() };
  };
  private onMove = (e: PointerEvent) => {
    const p = this.local(e);
    const d = this.drag;
    if (d && this.sketchDrag && this.sketchOv) {
      if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) < DRAG_PX) return;
      d.moved = true;
      this.ray.setFromCamera(this.ndc(p.x, p.y), this.activeCamera());
      const q = this.sketchOv.project(this.ray.ray);
      if (q) this.sketchOv.editor.dragTo(this.sketchDrag, q);
      return;
    }
    if (d) {
      if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) < DRAG_PX) return;
      if (!d.moved) {
        d.moved = true;
        this.renderer.domElement.classList.add(d.mode === "orbit" ? "orbiting" : "panning");
        this.store.set({ hover: null });
      }
      const dx = p.x - d.lx;
      const dy = p.y - d.ly;
      d.lx = p.x;
      d.ly = p.y;
      this.setCam(d.mode === "orbit" ? orbit(this.cam, dx, dy, d.pivot) : pan(this.cam, dx, dy, this.h));
      return;
    }
    this.hoverQueued = p;
  };
  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    this.drag = null;
    this.renderer.domElement.classList.remove("orbiting", "panning");
    if (this.renderer.domElement.hasPointerCapture(e.pointerId)) this.renderer.domElement.releasePointerCapture(e.pointerId);
    const p = this.local(e);
    if (this.sketchOv) {
      const ed = this.sketchOv.editor;
      if (this.sketchDrag) {
        const wasMoved = !!d?.moved;
        this.sketchDrag = null;
        ed.endDrag();
        if (wasMoved) return;
      }
      if (!d || d.moved || d.button !== 0) return;
      const hit = this.sketchHit(p.x, p.y);
      if (hit) ed.click(hit, e.ctrlKey || e.shiftKey || e.metaKey);
      return;
    }
    if (!d || d.moved || d.button !== 0) return;
    const hit = this.pickAt(p.x, p.y);
    this.store.pick(hit.sel, e.ctrlKey || e.shiftKey || e.metaKey);
  };
  private onLeave = () => {
    if (!this.drag) this.store.set({ hover: null, cursor: null });
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.anim = null;
    const p = this.local(e);
    const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const factor = Math.exp(Math.max(-1, Math.min(1, step / 400)));
    this.setCam(zoomAt(this.cam, factor, this.ndc(p.x, p.y), this.w / this.h));
  };
  private onDbl = (e: MouseEvent) => {
    if (this.sketchOv) return;
    // duplo clique em elemento seleciona o corpo inteiro; no vazio, enquadra tudo
    const p = this.local(e);
    const hit = this.pickAt(p.x, p.y);
    if (hit.sel?.t === "topo") this.store.pick({ t: "node", id: hit.sel.body }, e.ctrlKey || e.shiftKey);
    else if (!hit.sel) this.fit();
  };

  private doHover() {
    const q = this.hoverQueued;
    this.hoverQueued = null;
    if (!q || this.drag) return;
    if (this.sketchOv) {
      const h = this.sketchHit(q.x, q.y);
      this.sketchOv.editor.hover(h);
      this.store.set({ cursor: h ? (() => { const w = this.sketchOv!.toWorld(h.p); return { x: w.x, y: w.y, z: w.z }; })() : null });
      this.renderer.domElement.style.cursor = "crosshair";
      return;
    }
    const hit = this.pickAt(q.x, q.y);
    const cur = this.store.snap.hover;
    const changed = !(hit.sel === null && cur === null) && !(hit.sel && cur && selKey(hit.sel) === selKey(cur));
    this.store.set({
      hover: changed ? hit.sel : cur,
      cursor: hit.point ? { x: hit.point.x, y: hit.point.y, z: hit.point.z } : null,
    });
    this.renderer.domElement.style.cursor = hit.sel ? "pointer" : "default";
  }

  /* ------------------------------------------------------------------ renderização */

  private activeCamera() {
    return this.cam.ortho ? this.ortho : this.persp;
  }
  private resize() {
    const r = this.host.getBoundingClientRect();
    this.w = Math.max(1, Math.floor(r.width));
    this.h = Math.max(1, Math.floor(r.height));
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(this.w, this.h, false);
    for (const o of this.highlights) if (o instanceof LineSegments2) (o.material as LineMaterial).resolution.set(this.w, this.h);
    this.dirty = true;
    for (const f of this.camListeners) f(this.cam);
  }
  private syncCamera() {
    const c = this.cam;
    const aspect = this.w / this.h;
    const eye = eyeOf(c, this.sceneSphere.radius + this.sceneSphere.center.distanceTo(c.target));
    const dist = eye.distanceTo(c.target);
    const R = this.sceneSphere.radius + this.sceneSphere.center.distanceTo(c.target) + c.height;
    for (const cam of [this.ortho, this.persp]) {
      cam.position.copy(eye);
      cam.up.copy(c.up);
      cam.lookAt(c.target);
    }
    this.ortho.left = (-c.height * aspect) / 2;
    this.ortho.right = (c.height * aspect) / 2;
    this.ortho.top = c.height / 2;
    this.ortho.bottom = -c.height / 2;
    this.ortho.near = Math.max(1e-3, dist - R * 2);
    this.ortho.far = dist + R * 2;
    this.ortho.updateProjectionMatrix();
    this.persp.aspect = aspect;
    this.persp.near = Math.max(dist / 2000, 0.01);
    this.persp.far = dist + R * 4;
    this.persp.updateProjectionMatrix();
    // luz "de cabeça" vinda de cima e da esquerda do observador
    const r = new Vector3().crossVectors(c.up, c.dir).normalize();
    this.headlight.position.copy(eye).addScaledVector(c.up, dist * 0.6).addScaledVector(r, -dist * 0.4);
    this.headlight.target.position.copy(c.target);
    this.grid.update(c, aspect);
  }
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.hoverQueued) this.doHover();
    if (this.anim) {
      const t = Math.min(1, (performance.now() - this.anim.t0) / this.anim.ms);
      const c = lerpCam(this.anim.from, this.anim.to, t);
      if (t >= 1) this.anim = null;
      this.setCam(c);
    }
    if (!this.dirty) return;
    this.dirty = false;
    const t0 = performance.now();
    this.syncCamera();
    this.renderer.render(this.scene, this.activeCamera());
    this.sketchOv?.place((p) => this.toScreen(p));
    for (const m of this.marks) {
      const s = this.toScreen(m.p);
      m.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
      m.el.style.display = s.z > 1 ? "none" : "";
    }
    this.frameMs = performance.now() - t0;
    this.store.set({ view: matchStdView(this.cam) });
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.unsub();
    this.setSketch(null);
    this.setPreview(null, null);
    for (const id of [...this.bodies.keys()]) this.removeBody(id);
    for (const o of this.highlights) disposeOverlay(o);
    this.grid.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.overlay.remove();
  }
}

function boxOf(g: BodyGeom): Box3 {
  const b = g.props.bbox;
  return new Box3(new Vector3(b.min.x, b.min.y, b.min.z), new Vector3(b.max.x, b.max.y, b.max.z));
}

export function fmt(v: number, d = 3): string {
  if (!Number.isFinite(v)) return "—";
  const r = Number(v.toFixed(d));
  return (Object.is(r, -0) ? 0 : r).toLocaleString("pt-BR", { maximumFractionDigits: d });
}
