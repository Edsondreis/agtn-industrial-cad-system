import { type Change, CadDocument, SelectionSet, findPointRef } from "@agtn/document";
import {
  type Entity,
  type EntityGeom,
  type PointRef,
  type SnapCandidate,
  type SnapModes,
  type Vec2,
  SNAP_LABEL,
  UNIT_TO_MM,
  add,
  boxFromPoints,
  ccwSweep,
  deg2rad,
  dist,
  dot,
  findSnap,
  formatNumber,
  fromAngle,
  makeEntity,
  mid,
  normAngle,
  rad2deg,
  sub,
  angleOf,
  ellipseMinor,
  entityBox,
  transformEntity,
  translation,
} from "@agtn/geometry";
import { COMMANDS, type CommandDef, findCommand } from "./commands";
import { parseInput } from "./input";
import { THEME, drawEntities, drawGrid, drawUcsIcon, type RenderStyle } from "./renderer";
import { type PickMode, type PointEvent, Tool, type ToolHost } from "./tools/base";
import { Viewport } from "./view";

export interface DraftSettings {
  osnap: boolean;
  snapModes: SnapModes;
  gridSnap: boolean;
  grid: boolean;
  ortho: boolean;
  polar: boolean;
  polarStep: number;
  lwt: boolean;
  pickbox: number;
  aperture: number;
}

export const DEFAULT_DRAFT: DraftSettings = {
  osnap: true,
  snapModes: { endpoint: true, midpoint: true, center: true, intersection: true, quadrant: true, perpendicular: true, tangent: false, nearest: false, node: true },
  gridSnap: false,
  grid: true,
  ortho: false,
  polar: false,
  polarStep: 15,
  lwt: false,
  pickbox: 6,
  aperture: 12,
};

export interface LogLine {
  text: string;
  level: "info" | "warn" | "error" | "cmd";
}

interface CursorState {
  screen: Vec2;
  raw: Vec2;
  p: Vec2;
  snap: SnapCandidate | null;
  inside: boolean;
  tracking: { from: Vec2; angle: number } | null;
}

type Grip = { key: string; p: Vec2 };

export function gripsOf(e: Entity): Grip[] {
  switch (e.type) {
    case "line":
      return [
        { key: "a", p: e.a },
        { key: "b", p: e.b },
        { key: "m", p: mid(e.a, e.b) },
      ];
    case "circle":
      return [{ key: "c", p: e.c }, ...[0, 1, 2, 3].map((k) => ({ key: "q", p: add(e.c, fromAngle((k * Math.PI) / 2, e.r)) }))];
    case "arc": {
      const sw = ccwSweep(e.a0, e.a1);
      return [
        { key: "c", p: e.c },
        { key: "s", p: add(e.c, fromAngle(e.a0, e.r)) },
        { key: "e", p: add(e.c, fromAngle(e.a0 + sw, e.r)) },
        { key: "m", p: add(e.c, fromAngle(e.a0 + sw / 2, e.r)) },
      ];
    }
    case "polyline":
      return e.pts.map((p, i) => ({ key: `v:${i}`, p }));
    case "point":
      return [{ key: "p", p: e.p }];
    case "text":
      return [{ key: "p", p: e.p }];
    case "dimension":
      return [{ key: "loc", p: e.loc }];
    case "ellipse": {
      const mn = ellipseMinor(e);
      return [
        { key: "c", p: e.c },
        { key: "M", p: add(e.c, e.major) },
        { key: "M", p: sub(e.c, e.major) },
        { key: "m", p: add(e.c, mn) },
        { key: "m", p: sub(e.c, mn) },
      ];
    }
    case "spline":
      return e.ctrl.map((p, i) => ({ key: `v:${i}`, p }));
    case "hatch": {
      const b = entityBox(e);
      return [{ key: "c", p: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } }];
    }
  }
}

/** Aplica a edição por grip (alça). */
export function applyGrip(e: Entity, key: string, p: Vec2): Entity {
  switch (e.type) {
    case "line":
      if (key === "a") return { ...e, a: p };
      if (key === "b") return { ...e, b: p };
      return transformEntity(e, translation(p.x - mid(e.a, e.b).x, p.y - mid(e.a, e.b).y));
    case "circle":
      if (key === "c") return { ...e, c: p };
      return dist(e.c, p) > 1e-9 ? { ...e, r: dist(e.c, p) } : e;
    case "arc":
      if (key === "c") return { ...e, c: p };
      if (key === "s") return { ...e, a0: normAngle(angleOf(sub(p, e.c))) };
      if (key === "e") return { ...e, a1: normAngle(angleOf(sub(p, e.c))) };
      return dist(e.c, p) > 1e-9 ? { ...e, r: dist(e.c, p) } : e;
    case "polyline": {
      const i = Number(key.slice(2));
      const pts = e.pts.slice();
      pts[i] = p;
      return { ...e, pts };
    }
    case "point":
      return { ...e, p };
    case "text":
      return { ...e, p };
    case "dimension":
      return { ...e, loc: p };
    case "ellipse": {
      if (key === "c") return { ...e, c: p };
      const v = sub(p, e.c);
      const L = Math.hypot(v.x, v.y);
      if (L < 1e-9) return e;
      if (key === "M") {
        const b = Math.hypot(e.major.x, e.major.y) * e.ratio;
        // o eixo menor mantém o tamanho; se ficar maior que o novo eixo maior, os eixos trocam de papel
        if (b <= L) return { ...e, major: v, ratio: b / L };
        const nm = { x: (-v.y / L) * b, y: (v.x / L) * b };
        return { ...e, major: nm, ratio: L / b, t0: e.t0 - Math.PI / 2, t1: e.t1 - Math.PI / 2 };
      }
      const a = Math.hypot(e.major.x, e.major.y);
      if (L <= a) return { ...e, ratio: L / a };
      const mn = ellipseMinor(e);
      const nm = { x: (mn.x / Math.hypot(mn.x, mn.y)) * L, y: (mn.y / Math.hypot(mn.x, mn.y)) * L };
      return { ...e, major: nm, ratio: a / L, t0: e.t0 - Math.PI / 2, t1: e.t1 - Math.PI / 2 };
    }
    case "spline": {
      const i = Number(key.slice(2));
      const ctrl = e.ctrl.slice();
      ctrl[i] = p;
      return { ...e, ctrl, fit: undefined };
    }
    case "hatch": {
      const b = entityBox(e);
      return transformEntity(e, translation(p.x - (b.minX + b.maxX) / 2, p.y - (b.minY + b.maxY) / 2));
    }
  }
}

class GripTool extends Tool {
  readonly id = "GRIP";
  readonly title = "ALÇA";
  constructor(
    h: ToolHost,
    private ent: Entity,
    private key: string,
    origin: Vec2,
  ) {
    super(h);
    this.base = origin;
  }
  prompt() {
    return "ALÇA: Novo ponto (Esc cancela)";
  }
  onPoint(ev: PointEvent): void {
    const cur = this.h.doc.get(this.ent.id);
    if (cur) this.h.commit("Editar por alça", this.h.doc.updateChanges([applyGrip(cur, this.key, ev.p)]));
    this.h.finish();
  }
  preview(c: Vec2): Entity[] {
    const cur = this.h.doc.get(this.ent.id);
    return cur ? [applyGrip(cur, this.key, c)] : [];
  }
}

export type CtlEvent = "state" | "cursor" | "log";

/**
 * Controlador CAD: liga documento, seleção, viewport, ferramentas, snap e linha de comando.
 * Não depende de React; a interface apenas assina eventos.
 */
export class CadController implements ToolHost {
  readonly doc = new CadDocument();
  readonly sel = new SelectionSet(this.doc);
  readonly view = new Viewport();
  draft: DraftSettings = structuredClone(DEFAULT_DRAFT);
  tool: Tool | null = null;
  lastCommand: CommandDef | null = null;
  lastPoint: Vec2 | null = null;
  memory = new Map<string, number>();
  log: LogLine[] = [{ text: "AGTN CAD pronto. Digite um comando (ex.: L, REC, C) ou escolha uma ferramenta.", level: "info" }];
  cursor: CursorState = {
    screen: { x: 0, y: 0 },
    raw: { x: 0, y: 0 },
    p: { x: 0, y: 0 },
    snap: null,
    inside: false,
    tracking: null,
  };
  /** ações registradas pela interface (abrir planificação, camadas...) */
  readonly actions = new Map<string, () => void>();

  private main: HTMLCanvasElement | null = null;
  private overlay: HTMLCanvasElement | null = null;
  private dpr = 1;
  private dirtyMain = true;
  private dirtyOverlay = true;
  private raf = 0;
  private listeners = new Map<CtlEvent, Set<() => void>>();
  private drag: { kind: "pan" | "box"; start: Vec2; startWorld: Vec2; moved: boolean; button: number } | null = null;
  private boxPending: Vec2 | null = null;
  private shift = false;
  private versions: Record<CtlEvent, number> = { state: 0, cursor: 0, log: 0 };

  constructor() {
    this.doc.subscribe(() => {
      this.invalidate(true);
      this.emit("state");
    });
    this.sel.subscribe(() => {
      this.invalidate(true);
      this.emit("state");
    });
    this.view.fit({ minX: -20, minY: -20, maxX: 420, maxY: 297 });
  }

  /* ---------------------------- assinatura ---------------------------- */
  on(ev: CtlEvent, fn: () => void): () => void {
    let s = this.listeners.get(ev);
    if (!s) this.listeners.set(ev, (s = new Set()));
    s.add(fn);
    return () => s!.delete(fn);
  }
  private emit(ev: CtlEvent) {
    this.versions[ev]++;
    for (const f of this.listeners.get(ev) ?? []) f();
  }
  versionOf(ev: CtlEvent): number {
    return this.versions[ev];
  }

  /* ------------------------------ ToolHost ---------------------------- */
  get unitToMM(): number {
    return UNIT_TO_MM[this.doc.settings.units];
  }
  fmtLen(mm: number): string {
    return formatNumber(mm / this.unitToMM, 4, ",");
  }
  fmtAng(rad: number): string {
    return `${formatNumber(rad2deg(normAngle(rad)), 4, ",")}°`;
  }
  commit(label: string, changes: Change[]): void {
    if (!changes.length) return;
    this.doc.commit(label, changes);
  }
  message(text: string, level: LogLine["level"] = "info"): void {
    this.log = [...this.log.slice(-199), { text, level }];
    this.emit("log");
  }
  refresh(): void {
    this.invalidate(false);
    this.emit("state");
  }
  finish(): void {
    this.tool = null;
    this.boxPending = null;
    this.invalidate(true);
    this.emit("state");
  }
  pick(p: Vec2, filter?: (e: Entity) => boolean): Entity | null {
    return this.doc.hitTest(p, this.draft.pickbox / this.view.scale, filter);
  }
  create<G extends EntityGeom>(geom: G): Entity {
    return makeEntity(geom, this.doc.currentLayer);
  }
  pointRefFromSnap(snap: SnapCandidate | null, p: Vec2): PointRef | null {
    if (!snap?.entityId) return null;
    const e = this.doc.get(snap.entityId);
    return e ? findPointRef(e, p, 1e-6) : null;
  }
  zoomExtents(): void {
    const b = this.doc.extents();
    if (b) this.view.fit(b);
    this.invalidate(true);
    this.emit("state");
  }
  zoomWindow(a: Vec2, b: Vec2): void {
    if (dist(a, b) < 1e-9) return;
    this.view.fit(boxFromPoints(a, b), 0.02);
    this.invalidate(true);
    this.emit("state");
  }
  zoomFactor(f: number): void {
    this.view.zoomAt({ x: this.view.width / 2, y: this.view.height / 2 }, f);
    this.invalidate(true);
    this.emit("state");
  }

  /* ------------------------------- comandos --------------------------- */
  get prompt(): string {
    return this.tool ? this.tool.prompt() : "Comando:";
  }
  get pickMode(): PickMode {
    return this.tool ? this.tool.mode() : "select";
  }

  runCommand(def: CommandDef): void {
    this.cancel(true);
    this.lastCommand = def;
    this.message(`Comando: ${def.label.toUpperCase()}`, "cmd");
    const t = def.tool(this);
    this.tool = t;
    t.start();
    // a ferramenta pode ter terminado no start (ex.: apagar com seleção prévia)
    this.invalidate(true);
    this.emit("state");
  }
  runById(id: string): void {
    const def = COMMANDS.find((c) => c.id === id);
    if (def) this.runCommand(def);
  }

  cancel(silent = false): void {
    if (this.tool) {
      const t = this.tool;
      this.tool = null;
      t.onCancel();
      this.tool = null;
      if (!silent) this.message("*Cancelado*", "warn");
    } else if (!silent) this.sel.clear();
    this.boxPending = null;
    this.drag = null;
    this.invalidate(true);
    this.emit("state");
  }

  undo(): void {
    if (this.tool) this.cancel(true);
    const tx = this.doc.undo();
    this.message(tx ? `Desfeito: ${tx.label}` : "Nada para desfazer.", tx ? "info" : "warn");
  }
  redo(): void {
    if (this.tool) this.cancel(true);
    const tx = this.doc.redo();
    this.message(tx ? `Refeito: ${tx.label}` : "Nada para refazer.", tx ? "info" : "warn");
  }
  eraseSelection(): void {
    if (!this.sel.size) return;
    const ids = this.sel.list();
    this.doc.commit(`Apagar ${ids.length} objeto(s)`, this.doc.removeChanges(ids));
    this.sel.clear();
  }

  /** Entrada da linha de comando. */
  submit(raw: string): void {
    const t = this.tool;
    if (t?.wantsRawText()) {
      this.message(raw, "cmd");
      t.onText(raw);
      return;
    }
    const parsed = parseInput(raw, t?.base ?? this.lastPoint, this.unitToMM);
    if (parsed.kind !== "empty") this.message(raw.trim(), "cmd");
    switch (parsed.kind) {
      case "empty":
        if (t) t.onEnter();
        else if (this.lastCommand) this.runCommand(this.lastCommand);
        break;
      case "error":
        this.message(parsed.message, "error");
        break;
      case "point":
        if (!t) {
          this.message("Coordenada recebida sem comando ativo.", "warn");
          break;
        }
        this.feedPoint({ p: parsed.p, raw: parsed.p, snap: null, shift: false, typed: true });
        break;
      case "number": {
        if (!t) {
          this.message("Valor recebido sem comando ativo.", "warn");
          break;
        }
        if (t.onNumber(parsed.value)) break;
        if (t.base && t.mode() === "point") {
          // entrada direta de distância na direção do cursor (respeitando ortho/polar)
          const dir = sub(this.constrain(t.base, this.cursor.raw), t.base);
          const L = Math.hypot(dir.x, dir.y);
          if (L < 1e-12) {
            this.message("Mova o cursor para indicar a direção.", "warn");
            break;
          }
          const p = add(t.base, { x: (dir.x / L) * parsed.value * this.unitToMM, y: (dir.y / L) * parsed.value * this.unitToMM });
          this.feedPoint({ p, raw: p, snap: null, shift: false, typed: true });
        } else this.message("Valor não esperado nesta etapa.", "warn");
        break;
      }
      case "word": {
        if (t && t.onWord(parsed.word)) break;
        const w = parsed.word;
        if (w === "U" || w === "UNDO" || w === "DESFAZER") return this.undo();
        if (w === "REDO" || w === "REFAZER") return this.redo();
        const action = this.actions.get(w);
        if (action) {
          this.cancel(true);
          action();
          break;
        }
        const def = findCommand(w);
        if (def) this.runCommand(def);
        else this.message(`Comando desconhecido: "${w}". Digite AJUDA para a lista de atalhos.`, "error");
        break;
      }
    }
    this.invalidate(false);
    this.emit("state");
  }

  private feedPoint(ev: PointEvent) {
    const t = this.tool;
    if (!t) return;
    this.lastPoint = ev.p;
    if (t.mode() === "entity") {
      const e = this.pick(ev.p);
      if (e) t.onEntity(e, ev);
      else this.message("Nenhum objeto no ponto indicado.", "warn");
    } else t.onPoint(ev);
    this.invalidate(true);
    this.emit("state");
  }

  /* --------------------------------- snap ----------------------------- */
  private constrain(base: Vec2, p: Vec2): Vec2 {
    const d = sub(p, base);
    if (this.draft.ortho) return Math.abs(d.x) >= Math.abs(d.y) ? { x: p.x, y: base.y } : { x: base.x, y: p.y };
    if (this.draft.polar) {
      const step = deg2rad(this.draft.polarStep);
      const a = Math.atan2(d.y, d.x);
      const k = Math.round(a / step) * step;
      const L = Math.hypot(d.x, d.y);
      const perp = Math.abs(Math.sin(a - k)) * L * this.view.scale;
      if (perp < 10) {
        const u = fromAngle(k);
        return add(base, { x: u.x * dot(d, u), y: u.y * dot(d, u) });
      }
    }
    return p;
  }

  private resolveCursor(screen: Vec2) {
    const raw = this.view.toWorld(screen);
    let p = raw;
    let snap: SnapCandidate | null = null;
    let tracking: CursorState["tracking"] = null;
    const mode = this.pickMode;
    const base = this.tool?.base ?? null;
    if (mode === "point" || (this.tool instanceof GripTool)) {
      if (this.draft.osnap && !this.shift) {
        const tol = this.draft.aperture / this.view.scale;
        const nearby = this.doc.query({ minX: raw.x - tol, minY: raw.y - tol, maxX: raw.x + tol, maxY: raw.y + tol });
        snap = findSnap({ cursor: raw, tolerance: tol, modes: this.draft.snapModes, nearby, base });
        if (snap) p = snap.p;
      }
      if (!snap) {
        if (this.draft.gridSnap) {
          const s = this.doc.settings.snapSpacing;
          p = { x: Math.round(p.x / s) * s, y: Math.round(p.y / s) * s };
        }
        if (base) {
          const c = this.constrain(base, p);
          if (c !== p) {
            tracking = { from: base, angle: Math.atan2(c.y - base.y, c.x - base.x) };
            p = c;
          }
        }
      }
    }
    this.cursor = { screen, raw, p, snap, inside: true, tracking };
  }

  /* --------------------------------- mouse ---------------------------- */
  pointerMove(screen: Vec2, shift: boolean) {
    this.shift = shift;
    if (this.drag?.kind === "pan") {
      this.view.panPixels(screen.x - this.drag.start.x, screen.y - this.drag.start.y);
      this.drag.start = screen;
      this.drag.moved = true;
      this.invalidate(true);
    } else if (this.drag && Math.hypot(screen.x - this.drag.start.x, screen.y - this.drag.start.y) > 4) this.drag.moved = true;
    this.resolveCursor(screen);
    this.invalidate(false);
    this.emit("cursor");
  }
  pointerLeave() {
    this.cursor = { ...this.cursor, inside: false };
    this.invalidate(false);
  }

  pointerDown(screen: Vec2, button: number, shift: boolean) {
    this.shift = shift;
    this.resolveCursor(screen);
    if (button === 1) {
      this.drag = { kind: "pan", start: screen, startWorld: this.view.toWorld(screen), moved: false, button };
      return;
    }
    if (button === 2) return;
    const mode = this.pickMode;
    if (mode === "point") {
      this.feedPoint({ p: this.cursor.p, raw: this.cursor.raw, snap: this.cursor.snap, shift, typed: false });
      return;
    }
    if (mode === "entity") {
      const e = this.pick(this.cursor.raw);
      if (e) this.tool!.onEntity(e, { p: this.cursor.raw, raw: this.cursor.raw, snap: null, shift, typed: false });
      this.invalidate(true);
      this.emit("state");
      return;
    }
    // modo seleção
    if (this.boxPending) {
      this.finishBox(this.boxPending, this.cursor.raw, shift);
      this.boxPending = null;
      return;
    }
    if (!this.tool && this.sel.size && this.sel.size <= 200) {
      const tol = this.draft.pickbox / this.view.scale;
      for (const e of this.sel.entities())
        for (const g of gripsOf(e))
          if (dist(g.p, this.cursor.raw) <= tol) {
            this.tool = new GripTool(this, e, g.key, g.p);
            this.invalidate(true);
            this.emit("state");
            return;
          }
    }
    this.drag = { kind: "box", start: screen, startWorld: this.cursor.raw, moved: false, button };
  }

  pointerUp(screen: Vec2, button: number, shift: boolean) {
    const d = this.drag;
    this.drag = null;
    if (button === 2) {
      // botão direito = Enter (convenção CAD)
      this.submit("");
      return;
    }
    if (!d) return;
    if (d.kind === "pan") {
      this.invalidate(true);
      return;
    }
    const world = this.view.toWorld(screen);
    if (d.moved) {
      this.finishBox(d.startWorld, world, shift);
      return;
    }
    const e = this.pick(d.startWorld);
    if (e) {
      if (shift) this.sel.remove([e.id]);
      else this.sel.toggle(e.id);
      this.tool?.onSelectionChanged();
    } else this.boxPending = d.startWorld;
    this.invalidate(true);
    this.emit("state");
  }

  private finishBox(a: Vec2, b: Vec2, shift: boolean) {
    const sa = this.view.toScreen(a);
    const sb = this.view.toScreen(b);
    const crossing = this.tool?.forceCrossing || sb.x < sa.x;
    const ids = this.doc.selectBox(boxFromPoints(a, b), crossing).map((e) => e.id);
    if (shift) this.sel.remove(ids);
    else this.sel.add(ids);
    this.tool?.onSelectionChanged();
    this.invalidate(true);
    this.emit("state");
  }

  wheel(screen: Vec2, deltaY: number) {
    const f = Math.exp(-deltaY * 0.0015);
    this.view.zoomAt(screen, f);
    this.resolveCursor(screen);
    this.invalidate(true);
    this.emit("cursor");
    this.emit("state");
  }

  toggle(key: "osnap" | "gridSnap" | "grid" | "ortho" | "polar" | "lwt") {
    this.draft = { ...this.draft, [key]: !this.draft[key] };
    if (key === "ortho" && this.draft.ortho) this.draft.polar = false;
    if (key === "polar" && this.draft.polar) this.draft.ortho = false;
    const label: Record<string, string> = { osnap: "OSNAP", gridSnap: "SNAP", grid: "GRADE", ortho: "ORTHO", polar: "POLAR", lwt: "ESPESSURA" };
    this.message(`${label[key]} ${this.draft[key] ? "ligado" : "desligado"}`);
    this.invalidate(true);
    this.emit("state");
  }
  setDraft(patch: Partial<DraftSettings>) {
    this.draft = { ...this.draft, ...patch };
    this.invalidate(true);
    this.emit("state");
  }

  /* -------------------------------- render ---------------------------- */
  attach(main: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    this.main = main;
    this.overlay = overlay;
    this.invalidate(true);
  }
  detach() {
    this.main = this.overlay = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
  resize(w: number, h: number, dpr: number) {
    const first = this.view.width === 800 && this.view.height === 600;
    const c = { x: this.view.cx, y: this.view.cy };
    this.view.width = w;
    this.view.height = h;
    this.dpr = dpr;
    for (const cv of [this.main, this.overlay]) {
      if (!cv) continue;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
    }
    if (first) this.view.fit({ minX: -20, minY: -20, maxX: 420, maxY: 297 });
    else {
      this.view.cx = c.x;
      this.view.cy = c.y;
    }
    this.invalidate(true);
  }
  invalidate(main: boolean) {
    if (main) this.dirtyMain = true;
    this.dirtyOverlay = true;
    if (!this.raf && typeof requestAnimationFrame !== "undefined") this.raf = requestAnimationFrame(() => this.frame());
  }
  private renderStyle(): RenderStyle {
    return {
      layers: new Map(this.doc.layers.map((l) => [l.name, l])),
      ltScale: this.doc.settings.ltScale,
      showLineweight: this.draft.lwt,
      dimStyle: { ...this.doc.settings.dimStyle, unitFactor: 1 / this.unitToMM },
    };
  }
  private frame() {
    this.raf = 0;
    if (this.dirtyMain && this.main) {
      this.dirtyMain = false;
      this.drawMain(this.main.getContext("2d")!);
    }
    if (this.dirtyOverlay && this.overlay) {
      this.dirtyOverlay = false;
      this.drawOverlay(this.overlay.getContext("2d")!);
    }
  }
  private drawMain(ctx: CanvasRenderingContext2D) {
    const v = this.view;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, v.width, v.height);
    drawGrid(ctx, v, this.doc.settings.gridSpacing, this.draft.grid);
    const st = this.renderStyle();
    const margin = 4 / v.scale;
    const visible = this.doc.query(v.worldBox(margin));
    // mantém ordem de criação para sobreposição estável
    drawEntities(ctx, visible, v, st);
    if (this.sel.size) {
      const selEnts = this.sel.entities();
      drawEntities(ctx, selEnts, v, st, { override: { color: THEME.select, width: 2, dash: [6, 4] } });
      if (selEnts.length <= 200) {
        ctx.fillStyle = THEME.accent;
        ctx.strokeStyle = "#0b1a33";
        for (const e of selEnts)
          for (const g of gripsOf(e)) {
            const s = v.toScreen(g.p);
            ctx.fillRect(s.x - 4, s.y - 4, 8, 8);
            ctx.strokeRect(s.x - 4.5, s.y - 4.5, 9, 9);
          }
      }
    }
    drawUcsIcon(ctx, v);
  }
  private drawOverlay(ctx: CanvasRenderingContext2D) {
    const v = this.view;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, v.width, v.height);
    const c = this.cursor;
    const t = this.tool;
    const st = this.renderStyle();
    if (t) {
      const prev = t.preview(c.p);
      if (prev.length) drawEntities(ctx, prev, v, st, { override: { color: THEME.preview, width: 1 } });
      if (t.base && t.mode() === "point" && !prev.length) {
        const a = v.toScreen(t.base);
        const b = v.toScreen(c.p);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = THEME.preview;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // janela de seleção
    const boxFrom = this.boxPending ?? (this.drag?.kind === "box" && this.drag.moved ? this.drag.startWorld : null);
    if (boxFrom && c.inside) {
      const a = v.toScreen(boxFrom);
      const b = c.screen;
      const crossing = this.tool?.forceCrossing || b.x < a.x;
      ctx.fillStyle = crossing ? THEME.crossing : THEME.windowFill;
      ctx.strokeStyle = crossing ? THEME.crossingStroke : THEME.accent;
      ctx.setLineDash(crossing ? [5, 4] : []);
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.setLineDash([]);
    }
    if (!c.inside) return;
    const s = v.toScreen(c.p);
    // rastreamento polar/ortho
    if (c.tracking) {
      const o = v.toScreen(c.tracking.from);
      const far = { x: o.x + Math.cos(-c.tracking.angle) * 4000, y: o.y + Math.sin(-c.tracking.angle) * 4000 };
      ctx.strokeStyle = THEME.tracking;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(far.x, far.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // marcador de snap
    if (c.snap) drawSnapMarker(ctx, s, c.snap.kind);
    // cursor em cruz + pickbox
    ctx.strokeStyle = THEME.cursor;
    ctx.lineWidth = 1;
    const mode = this.pickMode;
    const L = mode === "point" ? 40 : 14;
    const pb = this.draft.pickbox;
    const cx = Math.round(s.x) + 0.5;
    const cy = Math.round(s.y) + 0.5;
    ctx.beginPath();
    if (mode !== "entity") {
      ctx.moveTo(cx - L, cy);
      ctx.lineTo(cx - pb, cy);
      ctx.moveTo(cx + pb, cy);
      ctx.lineTo(cx + L, cy);
      ctx.moveTo(cx, cy - L);
      ctx.lineTo(cx, cy - pb);
      ctx.moveTo(cx, cy + pb);
      ctx.lineTo(cx, cy + L);
    }
    ctx.stroke();
    if (mode !== "point") ctx.strokeRect(cx - pb, cy - pb, pb * 2, pb * 2);
    // dica junto ao cursor
    const tips: string[] = [];
    if (c.snap) tips.push(SNAP_LABEL[c.snap.kind]);
    if (t?.base && mode === "point") {
      const d = sub(c.p, t.base);
      tips.push(`${this.fmtLen(Math.hypot(d.x, d.y))} < ${formatNumber(rad2deg(normAngle(Math.atan2(d.y, d.x))), 2, ",")}°`);
    }
    if (tips.length) {
      ctx.font = `11px "Segoe UI", system-ui, sans-serif`;
      const text = tips.join("   ");
      const w = ctx.measureText(text).width + 12;
      ctx.fillStyle = "rgba(20,24,30,0.92)";
      ctx.strokeStyle = "rgba(61,139,253,0.55)";
      ctx.fillRect(s.x + 16, s.y + 16, w, 20);
      ctx.strokeRect(s.x + 16.5, s.y + 16.5, w - 1, 19);
      ctx.fillStyle = "#d6dde6";
      ctx.fillText(text, s.x + 22, s.y + 30);
    }
  }
}

function drawSnapMarker(ctx: CanvasRenderingContext2D, s: Vec2, kind: SnapCandidate["kind"]) {
  const r = 6;
  ctx.strokeStyle = THEME.snap;
  ctx.lineWidth = 2;
  ctx.beginPath();
  switch (kind) {
    case "endpoint":
    case "node":
      ctx.rect(s.x - r, s.y - r, r * 2, r * 2);
      break;
    case "midpoint":
      ctx.moveTo(s.x, s.y - r);
      ctx.lineTo(s.x + r, s.y + r * 0.8);
      ctx.lineTo(s.x - r, s.y + r * 0.8);
      ctx.closePath();
      break;
    case "center":
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      break;
    case "quadrant":
      ctx.moveTo(s.x, s.y - r);
      ctx.lineTo(s.x + r, s.y);
      ctx.lineTo(s.x, s.y + r);
      ctx.lineTo(s.x - r, s.y);
      ctx.closePath();
      break;
    case "intersection":
      ctx.moveTo(s.x - r, s.y - r);
      ctx.lineTo(s.x + r, s.y + r);
      ctx.moveTo(s.x + r, s.y - r);
      ctx.lineTo(s.x - r, s.y + r);
      break;
    case "perpendicular":
      ctx.moveTo(s.x - r, s.y + r);
      ctx.lineTo(s.x + r, s.y + r);
      ctx.moveTo(s.x - r, s.y + r);
      ctx.lineTo(s.x - r, s.y - r);
      ctx.moveTo(s.x - r, s.y);
      ctx.lineTo(s.x, s.y);
      ctx.lineTo(s.x, s.y + r);
      break;
    case "tangent":
      ctx.arc(s.x, s.y, r * 0.8, 0, Math.PI * 2);
      ctx.moveTo(s.x - r, s.y - r);
      ctx.lineTo(s.x + r, s.y - r);
      break;
    default:
      ctx.moveTo(s.x - r, s.y - r);
      ctx.lineTo(s.x + r, s.y + r);
      ctx.lineTo(s.x - r, s.y + r);
      ctx.lineTo(s.x + r, s.y - r);
      ctx.closePath();
  }
  ctx.stroke();
  ctx.lineWidth = 1;
}
