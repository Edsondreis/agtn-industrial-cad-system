import {
  type Entity,
  type HatchLoop,
  type Vec2,
  HATCH_PATTERNS,
  TAU,
  deg2rad,
  dist,
  ellipsePoints,
  hatchPatternByName,
  isFullEllipse,
  patternLines,
  rad2deg,
  splinePoints,
  sub,
} from "@agtn/geometry";
import { type PointEvent, SelectionTool, Tool } from "./base";

/* --------------------------------- ELIPSE -------------------------------- */
/** ELIPSE: centro → extremidade do eixo maior → distância do outro semieixo. */
export class EllipseTool extends Tool {
  readonly id = "ELLIPSE";
  readonly title = "ELIPSE";
  private axisEnd: Vec2 | null = null;
  prompt(): string {
    if (!this.base) return "ELIPSE: Centro";
    if (!this.axisEnd) return "ELIPSE: Extremidade do primeiro eixo (ou semieixo)";
    return "ELIPSE: Comprimento do outro semieixo";
  }
  private geom(other: number) {
    const c = this.base!;
    let major = sub(this.axisEnd!, c);
    const a = Math.hypot(major.x, major.y);
    let ratio = other / a;
    if (ratio > 1) {
      // o segundo eixo é o maior: troca os papéis
      const L = Math.hypot(major.x, major.y);
      major = { x: (-major.y / L) * other, y: (major.x / L) * other };
      ratio = a / other;
    }
    return { type: "ellipse" as const, c, major, ratio, t0: 0, t1: TAU };
  }
  private add(other: number) {
    const a = dist(this.base!, this.axisEnd!);
    if (!(other > 1e-9) || !(a > 1e-9)) {
      this.h.message("Semieixos devem ser maiores que zero.", "warn");
      return;
    }
    this.h.commit("Elipse", [{ kind: "add", e: this.h.create(this.geom(other)) }]);
    this.h.finish();
  }
  onPoint(ev: PointEvent): void {
    if (!this.base) {
      this.base = ev.p;
    } else if (!this.axisEnd) {
      if (dist(this.base, ev.p) < 1e-9) return;
      this.axisEnd = ev.p;
    } else {
      // distância do ponto à reta do primeiro eixo
      const d = sub(this.axisEnd, this.base);
      const L = Math.hypot(d.x, d.y);
      const w = sub(ev.p, this.base);
      this.add(Math.abs((d.x * w.y - d.y * w.x) / L));
      return;
    }
    this.h.refresh();
  }
  onNumber(n: number): boolean {
    if (!this.base) return false;
    const v = n * this.h.unitToMM;
    if (!this.axisEnd) {
      // número no 2º passo = semieixo na horizontal
      this.axisEnd = { x: this.base.x + v, y: this.base.y };
      this.h.refresh();
      return true;
    }
    this.add(v);
    return true;
  }
  preview(cur: Vec2): Entity[] {
    if (!this.base) return [];
    if (!this.axisEnd) {
      return dist(this.base, cur) > 1e-9 ? [this.h.create({ type: "line", a: this.base, b: cur })] : [];
    }
    const d = sub(this.axisEnd, this.base);
    const L = Math.hypot(d.x, d.y);
    const w = sub(cur, this.base);
    const other = Math.abs((d.x * w.y - d.y * w.x) / L);
    return other > 1e-9 ? [this.h.create(this.geom(other))] : [];
  }
}

/* -------------------------------- HACHURA -------------------------------- */
const hatchState = { pattern: "ANSI31", scale: 1, angle: 0 };

/** Converte um objeto fechado em contorno de hachura (ou null se não for fechado). */
export function boundaryLoop(e: Entity): HatchLoop | null {
  switch (e.type) {
    case "circle":
      return { pts: [{ x: e.c.x - e.r, y: e.c.y }, { x: e.c.x + e.r, y: e.c.y }], bulges: [1, 1] };
    case "polyline":
      if (!e.closed || e.pts.length < 2) return null;
      return { pts: e.pts.slice(), bulges: e.pts.map((_, i) => e.bulges[i] ?? 0) };
    case "ellipse": {
      if (!isFullEllipse(e)) return null;
      const pts = ellipsePoints(e, 2e-6);
      pts.pop();
      return { pts, bulges: pts.map(() => 0) };
    }
    case "spline": {
      const pts = splinePoints(e, 48);
      if (pts.length < 3 || dist(pts[0], pts[pts.length - 1]) > 1e-6) return null;
      pts.pop();
      return { pts, bulges: pts.map(() => 0) };
    }
    case "hatch":
      return null;
    default:
      return null;
  }
}

/**
 * HACHURA: seleciona contornos fechados (polilinha fechada, círculo, elipse, spline fechado).
 * Contornos dentro de outros viram furos (regra par-ímpar, como o estilo "Normal" do AutoCAD).
 * Na linha de comando: nome do padrão (ANSI31, SOLID, NET…), número = escala, "A" + número = ângulo.
 */
export class HatchTool extends SelectionTool {
  readonly id = "HATCH";
  readonly title = "HACHURA";
  private wantAngle = false;
  protected selectPrompt(): string {
    const st = hatchState;
    const info = st.pattern === "SOLID" ? "SOLID" : `${st.pattern}, escala ${st.scale}, ângulo ${rad2deg(st.angle)}°`;
    return `Selecione contornos fechados e Enter  [padrão: ${info} · digite ${HATCH_PATTERNS.slice(0, 4)
      .map((p) => p.name)
      .join("/")}…, número = escala, A = ângulo]`;
  }
  protected stagePrompt() {
    return "";
  }
  onWord(w: string): boolean {
    const def = hatchPatternByName(w);
    if (def) {
      hatchState.pattern = def.name;
      this.h.message(`Padrão: ${def.label}`, "info");
      this.h.refresh();
      return true;
    }
    if (w === "A" || w === "ANGULO") {
      this.wantAngle = true;
      this.h.message("Digite o ângulo do padrão (graus).", "info");
      return true;
    }
    return false;
  }
  onNumber(n: number): boolean {
    if (this.wantAngle) {
      hatchState.angle = deg2rad(n);
      this.wantAngle = false;
    } else if (n > 0) hatchState.scale = n;
    else return false;
    this.h.refresh();
    return true;
  }
  protected afterSelection() {
    const loops: HatchLoop[] = [];
    let skipped = 0;
    for (const e of this.selected()) {
      const l = boundaryLoop(e);
      if (l) loops.push(l);
      else skipped++;
    }
    if (!loops.length) {
      this.h.message("Nenhum contorno fechado selecionado (use polilinha fechada, círculo, elipse ou spline fechado).", "warn");
    } else {
      const def = hatchPatternByName(hatchState.pattern) ?? HATCH_PATTERNS[1];
      const solid = def.name === "SOLID";
      const e = this.h.create({
        type: "hatch",
        loops,
        solid,
        pattern: def.name,
        patternAngle: hatchState.angle,
        patternScale: hatchState.scale,
        lines: solid ? [] : patternLines(def, hatchState.angle, hatchState.scale),
      });
      this.h.commit("Hachura", [{ kind: "add", e }]);
      if (skipped) this.h.message(`${skipped} objeto(s) aberto(s) ignorado(s).`, "warn");
    }
    this.h.sel.clear();
    this.h.finish();
  }
}

/* ------------------------- JANELA (para imprimir) ------------------------ */
/** Pede dois cantos e devolve a caixa (usado pela janela de impressão). */
export class PickWindowTool extends Tool {
  readonly id = "PLOTWINDOW";
  readonly title = "IMPRIMIR";
  constructor(
    h: ConstructorParameters<typeof Tool>[0],
    private done: (box: { minX: number; minY: number; maxX: number; maxY: number } | null) => void,
  ) {
    super(h);
  }
  prompt(): string {
    return this.base ? "IMPRIMIR: Canto oposto da janela" : "IMPRIMIR: Primeiro canto da janela (Esc volta)";
  }
  onPoint(ev: PointEvent): void {
    if (!this.base) {
      this.base = ev.p;
      this.h.refresh();
      return;
    }
    const a = this.base;
    const b = ev.p;
    if (Math.abs(a.x - b.x) < 1e-9 || Math.abs(a.y - b.y) < 1e-9) {
      this.h.message("Janela sem área: escolha cantos opostos.", "warn");
      return;
    }
    this.h.finish();
    this.done({ minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) });
  }
  onCancel(): void {
    this.h.finish();
    this.done(null);
  }
  onEnter(): void {
    this.onCancel();
  }
  preview(c: Vec2): Entity[] {
    if (!this.base) return [];
    const a = this.base;
    return [this.h.create({ type: "polyline", pts: [a, { x: c.x, y: a.y }, c, { x: a.x, y: c.y }], bulges: [0, 0, 0, 0], closed: true })];
  }
}
