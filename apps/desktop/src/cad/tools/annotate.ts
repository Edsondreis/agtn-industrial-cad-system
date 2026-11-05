import {
  type DimensionEntity,
  type Entity,
  type PointRef,
  type Vec2,
  add,
  angleOf,
  dist,
  fromAngle,
  lineLine,
  rad2deg,
  sub,
} from "@agtn/geometry";
import { type PointEvent, Tool } from "./base";

/* ------------------------- COTA ALINHADA / LINEAR ------------------------ */
export class DimLinearTool extends Tool {
  readonly id: string = "DIMLINEAR";
  readonly title: string = "COTA LINEAR";
  protected aligned = false;
  private p1: Vec2 | null = null;
  private p2: Vec2 | null = null;
  private r1: PointRef | null = null;
  private r2: PointRef | null = null;
  private forced: number | null = null;
  prompt(): string {
    if (!this.p1) return `${this.title}: Origem da primeira linha auxiliar`;
    if (!this.p2) return `${this.title}: Origem da segunda linha auxiliar`;
    return `${this.title}: Posição da linha de cota${this.aligned ? "" : " ou [Horizontal (H) / Vertical (V)]"}`;
  }
  onPoint(ev: PointEvent): void {
    if (!this.p1) {
      this.p1 = ev.p;
      this.r1 = this.h.pointRefFromSnap(ev.snap, ev.p);
      this.base = ev.p;
    } else if (!this.p2) {
      if (dist(ev.p, this.p1) < 1e-9) return;
      this.p2 = ev.p;
      this.r2 = this.h.pointRefFromSnap(ev.snap, ev.p);
      this.base = null;
    } else {
      const d = this.build(ev.p);
      this.h.commit(this.title, [{ kind: "add", e: d }]);
      this.h.finish();
      return;
    }
    this.h.refresh();
  }
  onWord(w: string): boolean {
    if (this.aligned || !this.p2) return false;
    if (w === "H") this.forced = 0;
    else if (w === "V") this.forced = Math.PI / 2;
    else return false;
    this.h.refresh();
    return true;
  }
  private rotFor(loc: Vec2): number {
    if (this.forced !== null) return this.forced;
    const a = this.p1!;
    const b = this.p2!;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    if (loc.y > maxY || loc.y < minY) return 0;
    if (loc.x > maxX || loc.x < minX) return Math.PI / 2;
    return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 0 : Math.PI / 2;
  }
  private build(loc: Vec2): Entity {
    const assoc = this.r1 || this.r2 ? { p1: this.r1 ?? undefined, p2: this.r2 ?? undefined } : null;
    return this.h.create({
      type: "dimension",
      kind: this.aligned ? "aligned" : "linear",
      p1: this.p1!,
      p2: this.p2!,
      loc,
      rot: this.aligned ? 0 : this.rotFor(loc),
      textOverride: null,
      assoc,
    });
  }
  preview(c: Vec2): Entity[] {
    if (this.p1 && !this.p2) return [this.h.create({ type: "line", a: this.p1, b: c })];
    if (this.p1 && this.p2) return [this.build(c)];
    return [];
  }
}

export class DimAlignedTool extends DimLinearTool {
  readonly id = "DIMALIGNED";
  readonly title = "COTA ALINHADA";
  protected aligned = true;
}

/* --------------------------- COTA RAIO / DIÂMETRO ------------------------ */
export class DimRadialTool extends Tool {
  readonly id: string = "DIMRADIUS";
  readonly title: string = "COTA DE RAIO";
  protected kind: "radius" | "diameter" = "radius";
  private target: Entity | null = null;
  prompt(): string {
    return `${this.title}: ${this.target ? "Posição do texto" : "Selecione um círculo ou arco"}`;
  }
  mode() {
    return this.target ? ("point" as const) : ("entity" as const);
  }
  onEntity(e: Entity): void {
    if (e.type !== "circle" && e.type !== "arc") {
      this.h.message("Selecione um círculo ou arco.", "warn");
      return;
    }
    this.target = e;
    this.h.sel.set([e.id]);
    this.h.refresh();
  }
  private build(loc: Vec2): DimensionEntity | null {
    const t = this.target;
    if (!t || (t.type !== "circle" && t.type !== "arc")) return null;
    const a = dist(loc, t.c) < 1e-9 ? 0 : angleOf(sub(loc, t.c));
    return this.h.create({
      type: "dimension",
      kind: this.kind,
      p1: t.c,
      p2: add(t.c, fromAngle(a, t.r)),
      loc,
      rot: 0,
      textOverride: null,
      assoc: { circle: t.id },
    }) as DimensionEntity;
  }
  onPoint(ev: PointEvent): void {
    const d = this.build(ev.p);
    if (!d) return;
    this.h.sel.clear();
    this.h.commit(this.title, [{ kind: "add", e: d }]);
    this.h.finish();
  }
  preview(c: Vec2): Entity[] {
    const d = this.build(c);
    return d ? [d] : [];
  }
}

export class DimDiameterTool extends DimRadialTool {
  readonly id = "DIMDIAMETER";
  readonly title = "COTA DE DIÂMETRO";
  protected kind = "diameter" as const;
}

/* ------------------------------ COTA ANGULAR ----------------------------- */
export class DimAngularTool extends Tool {
  readonly id = "DIMANGULAR";
  readonly title = "COTA ANGULAR";
  private l1: Entity | null = null;
  private l2: Entity | null = null;
  prompt(): string {
    if (!this.l1) return "COTA ANGULAR: Primeira linha";
    if (!this.l2) return "COTA ANGULAR: Segunda linha";
    return "COTA ANGULAR: Posição do arco de cota";
  }
  mode() {
    return this.l2 ? ("point" as const) : ("entity" as const);
  }
  onEntity(e: Entity): void {
    if (e.type !== "line") {
      this.h.message("Selecione linhas.", "warn");
      return;
    }
    if (!this.l1) this.l1 = e;
    else if (e.id !== this.l1.id) {
      this.l2 = e;
      if (!this.vertex()) {
        this.h.message("Linhas paralelas não formam ângulo.", "error");
        this.l2 = null;
      }
    }
    this.h.sel.set([this.l1, this.l2].filter(Boolean).map((x) => x!.id));
    this.h.refresh();
  }
  private vertex(): Vec2 | null {
    if (!this.l1 || !this.l2 || this.l1.type !== "line" || this.l2.type !== "line") return null;
    return lineLine(this.l1.a, this.l1.b, this.l2.a, this.l2.b)?.p ?? null;
  }
  private far(l: Entity, v: Vec2): Vec2 {
    if (l.type !== "line") return v;
    return dist(l.a, v) > dist(l.b, v) ? l.a : l.b;
  }
  private build(loc: Vec2): Entity | null {
    const v = this.vertex();
    if (!v) return null;
    const p2 = this.far(this.l1!, v);
    const p3 = this.far(this.l2!, v);
    return this.h.create({
      type: "dimension",
      kind: "angular",
      p1: v,
      p2,
      p3,
      loc,
      rot: 0,
      textOverride: null,
      assoc: null,
    });
  }
  onPoint(ev: PointEvent): void {
    const d = this.build(ev.p);
    if (!d) return;
    this.h.sel.clear();
    this.h.commit(this.title, [{ kind: "add", e: d }]);
    this.h.finish();
  }
  preview(c: Vec2): Entity[] {
    const d = this.l2 ? this.build(c) : null;
    return d ? [d] : [];
  }
}

/* --------------------------------- MEDIR -------------------------------- */
export class DistTool extends Tool {
  readonly id = "DIST";
  readonly title = "MEDIR DISTÂNCIA";
  prompt(): string {
    return this.base ? "MEDIR: Segundo ponto" : "MEDIR: Primeiro ponto";
  }
  onPoint(ev: PointEvent): void {
    if (!this.base) {
      this.base = ev.p;
      this.h.refresh();
      return;
    }
    const d = sub(ev.p, this.base);
    this.h.message(
      `Distância = ${this.h.fmtLen(Math.hypot(d.x, d.y))}   ΔX = ${this.h.fmtLen(d.x)}   ΔY = ${this.h.fmtLen(d.y)}   Ângulo = ${this.h.fmtAng(angleOf(d))}`,
    );
    this.h.finish();
  }
  preview(c: Vec2): Entity[] {
    return this.base ? [this.h.create({ type: "line", a: this.base, b: c })] : [];
  }
}

/* --------------------------------- ZOOM --------------------------------- */
export class ZoomTool extends Tool {
  readonly id = "ZOOM";
  readonly title = "ZOOM";
  private win = false;
  prompt(): string {
    if (this.win) return this.base ? "ZOOM: Canto oposto" : "ZOOM: Primeiro canto da janela";
    return "ZOOM: [Extensão (E) / Janela (W)] ou fator (ex.: 2, 0.5)";
  }
  onWord(w: string): boolean {
    if (w === "E" || w === "EXTENSAO" || w === "EXTENSÃO") {
      this.h.zoomExtents();
      this.h.finish();
      return true;
    }
    if (w === "W" || w === "J" || w === "JANELA") {
      this.win = true;
      this.h.refresh();
      return true;
    }
    return false;
  }
  onNumber(n: number): boolean {
    if (n > 0) this.h.zoomFactor(n);
    this.h.finish();
    return true;
  }
  onPoint(ev: PointEvent): void {
    if (!this.win) {
      this.win = true;
    }
    if (!this.base) {
      this.base = ev.p;
      this.h.refresh();
      return;
    }
    this.h.zoomWindow(this.base, ev.p);
    this.h.finish();
  }
  preview(c: Vec2): Entity[] {
    if (!this.base) return [];
    const a = this.base;
    return [
      this.h.create({
        type: "polyline",
        pts: [a, { x: c.x, y: a.y }, c, { x: a.x, y: c.y }],
        bulges: [0, 0, 0, 0],
        closed: true,
      }),
    ];
  }
}

export const toDeg = rad2deg;
