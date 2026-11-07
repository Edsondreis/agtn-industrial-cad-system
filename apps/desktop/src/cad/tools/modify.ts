import type { Change } from "@agtn/document";
import {
  type Affine,
  type Entity,
  type LineEntity,
  type Vec2,
  angleOf,
  boxFromPoints,
  chamferLines,
  deg2rad,
  dist,
  entityBox,
  explodeCurve,
  explodePolyline,
  extendEntity,
  filletLines,
  joinEntities,
  mirrorLine,
  newId,
  offsetEntity,
  rotation,
  scaling,
  stretchEntity,
  sub,
  transformEntity,
  translation,
  trimEntity,
  dimensionGeometry,
  makeEntity,
} from "@agtn/geometry";
import { type PointEvent, SelectionTool, Tool } from "./base";

const xform = (ents: Entity[], m: Affine) => ents.map((e) => transformEntity(e, m));
const copies = (ents: Entity[], m: Affine) => ents.map((e) => ({ ...transformEntity(e, m), id: newId() }) as Entity);

/* --------------------------------- APAGAR ------------------------------- */
export class EraseTool extends SelectionTool {
  readonly id = "ERASE";
  readonly title = "APAGAR";
  protected stagePrompt() {
    return "";
  }
  protected afterSelection() {
    const ids = this.selected().map((e) => e.id);
    this.h.commit(`Apagar ${ids.length} objeto(s)`, this.h.doc.removeChanges(ids));
    this.h.sel.clear();
    this.h.finish();
  }
}

/* ------------------------------ MOVER / COPIAR -------------------------- */
export class MoveTool extends SelectionTool {
  readonly id: string = "MOVE";
  readonly title: string = "MOVER";
  protected copyMode = false;
  protected stagePrompt(): string {
    return this.base ? "Segundo ponto (ou distância na direção do cursor)" : "Ponto base";
  }
  protected afterSelection() {}
  onPoint(ev: PointEvent): void {
    if (this.selecting) return;
    if (!this.base) {
      this.base = ev.p;
      this.h.refresh();
      return;
    }
    const m = translation(ev.p.x - this.base.x, ev.p.y - this.base.y);
    const ents = this.selected();
    if (this.copyMode) {
      this.h.commit(`Copiar ${ents.length} objeto(s)`, this.h.doc.addChanges(copies(ents, m)));
      this.h.refresh();
      return; // cópia múltipla até Enter
    }
    this.h.commit(`Mover ${ents.length} objeto(s)`, this.h.doc.updateChanges(xform(ents, m)));
    this.h.finish();
  }
  preview(c: Vec2): Entity[] {
    if (this.selecting || !this.base) return [];
    return xform(this.selected(), translation(c.x - this.base.x, c.y - this.base.y));
  }
}

export class CopyTool extends MoveTool {
  readonly id = "COPY";
  readonly title = "COPIAR";
  protected copyMode = true;
  protected stagePrompt(): string {
    return this.base ? "Segundo ponto (Enter termina)" : "Ponto base";
  }
}

/* -------------------------------- ROTACIONAR ---------------------------- */
export class RotateTool extends SelectionTool {
  readonly id = "ROTATE";
  readonly title = "ROTACIONAR";
  protected stagePrompt() {
    return this.base ? "Ângulo de rotação em graus (anti-horário) ou ponto" : "Ponto base";
  }
  protected afterSelection() {}
  private apply(ang: number) {
    const ents = this.selected();
    this.h.commit(`Rotacionar ${ents.length} objeto(s)`, this.h.doc.updateChanges(xform(ents, rotation(ang, this.base!))));
    this.h.finish();
  }
  onPoint(ev: PointEvent): void {
    if (this.selecting) return;
    if (!this.base) {
      this.base = ev.p;
      this.h.refresh();
      return;
    }
    if (dist(ev.p, this.base) < 1e-12) return;
    this.apply(angleOf(sub(ev.p, this.base)));
  }
  onNumber(n: number): boolean {
    if (this.selecting || !this.base) return false;
    this.apply(deg2rad(n));
    return true;
  }
  preview(c: Vec2): Entity[] {
    if (this.selecting || !this.base || dist(c, this.base) < 1e-12) return [];
    return xform(this.selected(), rotation(angleOf(sub(c, this.base)), this.base));
  }
}

/* --------------------------------- ESCALA ------------------------------- */
export class ScaleTool extends SelectionTool {
  readonly id = "SCALE";
  readonly title = "ESCALA";
  private refLen: number | null = null;
  private refPts: Vec2[] | null = null;
  protected stagePrompt() {
    if (!this.base) return "Ponto base";
    if (this.refPts && this.refPts.length < 2) return `Referência: ${this.refPts.length ? "segundo" : "primeiro"} ponto`;
    if (this.refLen !== null) return "Novo comprimento (número ou ponto)";
    return "Fator de escala ou [Referência (R)]";
  }
  protected afterSelection() {}
  private apply(f: number) {
    if (!(f > 0)) {
      this.h.message("Fator deve ser positivo.", "warn");
      return;
    }
    const ents = this.selected();
    this.h.commit(`Escala ×${f}`, this.h.doc.updateChanges(xform(ents, scaling(f, this.base!))));
    this.h.finish();
  }
  onPoint(ev: PointEvent): void {
    if (this.selecting) return;
    if (!this.base) {
      this.base = ev.p;
      this.h.refresh();
      return;
    }
    if (this.refPts && this.refPts.length < 2) {
      this.refPts.push(ev.p);
      if (this.refPts.length === 2) this.refLen = dist(this.refPts[0], this.refPts[1]);
      this.h.refresh();
      return;
    }
    if (this.refLen !== null && this.refLen > 0) this.apply(dist(this.base, ev.p) / this.refLen);
  }
  onNumber(n: number): boolean {
    if (this.selecting || !this.base) return false;
    if (this.refLen !== null) {
      if (this.refLen > 0) this.apply((n * this.h.unitToMM) / this.refLen);
      return true;
    }
    this.apply(n);
    return true;
  }
  onWord(w: string): boolean {
    if (w === "R" && this.base && !this.refPts) {
      this.refPts = [];
      this.h.refresh();
      return true;
    }
    return false;
  }
}

/* --------------------------------- ESPELHAR ----------------------------- */
export class MirrorTool extends SelectionTool {
  readonly id = "MIRROR";
  readonly title = "ESPELHAR";
  private p2: Vec2 | null = null;
  protected stagePrompt() {
    if (!this.base) return "Primeiro ponto do eixo de espelho";
    if (!this.p2) return "Segundo ponto do eixo";
    return "Apagar objetos de origem? [Sim (S) / Não (N)] <N>";
  }
  protected afterSelection() {}
  onPoint(ev: PointEvent): void {
    if (this.selecting) return;
    if (!this.base) this.base = ev.p;
    else if (!this.p2 && dist(ev.p, this.base) > 1e-9) this.p2 = ev.p;
    this.h.refresh();
  }
  private apply(erase: boolean) {
    const ents = this.selected();
    const m = mirrorLine(this.base!, this.p2!);
    const ch: Change[] = erase ? this.h.doc.updateChanges(xform(ents, m)) : this.h.doc.addChanges(copies(ents, m));
    this.h.commit(`Espelhar ${ents.length} objeto(s)`, ch);
    this.h.finish();
  }
  onWord(w: string): boolean {
    if (!this.p2) return false;
    if (w === "S" || w === "SIM" || w === "Y") this.apply(true);
    else if (w === "N" || w === "NAO" || w === "NÃO") this.apply(false);
    else return false;
    return true;
  }
  protected stageEnter() {
    if (this.p2) this.apply(false);
    else this.h.finish();
  }
  preview(c: Vec2): Entity[] {
    if (this.selecting || !this.base) return [];
    const p2 = this.p2 ?? c;
    if (dist(p2, this.base) < 1e-9) return [];
    return [...xform(this.selected(), mirrorLine(this.base, p2)), makeEntity({ type: "line", a: this.base, b: p2 }, "0", { linetype: "CENTER" })];
  }
}

/* --------------------------------- OFFSET ------------------------------- */
export class OffsetTool extends Tool {
  readonly id = "OFFSET";
  readonly title = "OFFSET";
  private distance: number | null = null;
  private target: Entity | null = null;
  start() {
    this.h.sel.clear();
  }
  prompt(): string {
    const last = this.h.memory.get("offset.d");
    if (this.distance === null) return `OFFSET: Distância${last ? ` <${this.h.fmtLen(last)}>` : ""}`;
    if (!this.target) return `OFFSET (${this.h.fmtLen(this.distance)}): Selecione o objeto (Enter termina)`;
    return "OFFSET: Clique no lado do deslocamento";
  }
  mode() {
    return this.distance !== null && !this.target ? ("entity" as const) : ("point" as const);
  }
  onNumber(n: number): boolean {
    if (this.distance !== null) return false;
    if (!(n > 0)) {
      this.h.message("Distância deve ser positiva.", "warn");
      return true;
    }
    this.distance = n * this.h.unitToMM;
    this.h.memory.set("offset.d", this.distance);
    this.h.refresh();
    return true;
  }
  onEnter(): void {
    if (this.distance === null && this.h.memory.get("offset.d")) {
      this.distance = this.h.memory.get("offset.d")!;
      this.h.refresh();
      return;
    }
    this.h.finish();
  }
  onEntity(e: Entity): void {
    this.target = e;
    this.h.sel.set([e.id]);
    this.h.refresh();
  }
  onPoint(ev: PointEvent): void {
    if (!this.target || this.distance === null) return;
    const r = offsetEntity(this.target, this.distance, ev.p);
    if (!r.ok) this.h.message(r.reason, "error");
    else this.h.commit("Offset", [{ kind: "add", e: r.value }]);
    this.target = null;
    this.h.sel.clear();
    this.h.refresh();
  }
  preview(c: Vec2): Entity[] {
    if (!this.target || this.distance === null) return [];
    const r = offsetEntity(this.target, this.distance, c);
    return r.ok ? [r.value] : [];
  }
}

/* ------------------------------- TRIM / EXTEND -------------------------- */
function neighbours(h: { doc: { query: (b: ReturnType<typeof entityBox>) => Entity[] } }, e: Entity, grow: number): Entity[] {
  const b = entityBox(e);
  return h.doc.query({ minX: b.minX - grow, minY: b.minY - grow, maxX: b.maxX + grow, maxY: b.maxY + grow });
}

export class TrimTool extends Tool {
  readonly id = "TRIM";
  readonly title = "TRIM";
  start() {
    this.h.sel.clear();
  }
  prompt(): string {
    return "TRIM: Clique no trecho a remover (todos os objetos são arestas de corte). Enter termina";
  }
  mode() {
    return "entity" as const;
  }
  onEntity(e: Entity, ev: PointEvent): void {
    const cutters = neighbours(this.h, e, 0).filter((c) => c.id !== e.id && c.type !== "text");
    const r = trimEntity(e, cutters, ev.raw);
    if (!r.ok) {
      this.h.message(r.reason, "warn");
      return;
    }
    const [first, ...rest] = r.value;
    const ch: Change[] = first && first.id === e.id ? this.h.doc.updateChanges([first]) : this.h.doc.removeChanges([e.id]);
    if (first && first.id !== e.id) ch.push({ kind: "add", e: first });
    ch.push(...this.h.doc.addChanges(rest));
    this.h.commit("Trim", ch);
  }
}

export class ExtendTool extends Tool {
  readonly id = "EXTEND";
  readonly title = "EXTEND";
  start() {
    this.h.sel.clear();
  }
  prompt(): string {
    return "EXTEND: Clique perto da extremidade a estender (todos os objetos são limites). Enter termina";
  }
  mode() {
    return "entity" as const;
  }
  onEntity(e: Entity, ev: PointEvent): void {
    const bounds = this.h.doc.all().filter((b) => b.id !== e.id && this.h.doc.isVisible(b) && b.type !== "text" && b.type !== "dimension");
    const r = extendEntity(e, bounds, ev.raw);
    if (!r.ok) {
      this.h.message(r.reason, "warn");
      return;
    }
    this.h.commit("Extend", this.h.doc.updateChanges([r.value]));
  }
}

/* ----------------------------- FILLET / CHAMFER ------------------------- */
abstract class CornerTool extends Tool {
  protected first: { e: LineEntity; p: Vec2 } | null = null;
  start() {
    this.h.sel.clear();
  }
  mode() {
    return "entity" as const;
  }
  protected abstract compute(l1: LineEntity, p1: Vec2, l2: LineEntity, p2: Vec2): ReturnType<typeof filletLines>;
  onEntity(e: Entity, ev: PointEvent): void {
    if (e.type !== "line") {
      this.h.message(`${this.title} nesta versão trabalha entre duas LINHAS (use EXPLODIR em polilinhas).`, "warn");
      return;
    }
    if (!this.first) {
      this.first = { e, p: ev.raw };
      this.h.sel.set([e.id]);
      this.h.refresh();
      return;
    }
    if (e.id === this.first.e.id) return;
    const r = this.compute(this.first.e, this.first.p, e, ev.raw);
    this.h.sel.clear();
    if (!r.ok) {
      this.h.message(r.reason, "error");
      this.first = null;
      this.h.refresh();
      return;
    }
    const ch: Change[] = this.h.doc.updateChanges([r.value.l1, r.value.l2]);
    if (r.value.corner) ch.push({ kind: "add", e: this.h.create(r.value.corner) });
    this.h.commit(this.title, ch);
    this.h.finish();
  }
}

export class FilletTool extends CornerTool {
  readonly id = "FILLET";
  readonly title = "FILLET";
  private get r() {
    return this.h.memory.get("fillet.r") ?? 0;
  }
  prompt(): string {
    return `FILLET (raio ${this.h.fmtLen(this.r)}): ${this.first ? "Segunda linha" : "Primeira linha ou [Raio (R)]"}`;
  }
  private askingR = false;
  onWord(w: string): boolean {
    if (w === "R") {
      this.askingR = true;
      this.h.message("Digite o raio:");
      return true;
    }
    return false;
  }
  onNumber(n: number): boolean {
    if (n < 0) return true;
    this.h.memory.set("fillet.r", n * this.h.unitToMM);
    this.askingR = false;
    this.h.refresh();
    return true;
  }
  protected compute(l1: LineEntity, p1: Vec2, l2: LineEntity, p2: Vec2) {
    void this.askingR;
    return filletLines(l1, p1, l2, p2, this.r);
  }
}

export class ChamferTool extends CornerTool {
  readonly id = "CHAMFER";
  readonly title = "CHANFRO";
  private pending: number[] | null = null;
  private get d() {
    return [this.h.memory.get("chamfer.d1") ?? 0, this.h.memory.get("chamfer.d2") ?? 0];
  }
  prompt(): string {
    if (this.pending) return `CHANFRO: ${this.pending.length ? "Segunda" : "Primeira"} distância`;
    const [a, b] = this.d;
    return `CHANFRO (d1=${this.h.fmtLen(a)}, d2=${this.h.fmtLen(b)}): ${this.first ? "Segunda linha" : "Primeira linha ou [Distâncias (D)]"}`;
  }
  onWord(w: string): boolean {
    if (w === "D") {
      this.pending = [];
      this.h.refresh();
      return true;
    }
    return false;
  }
  onNumber(n: number): boolean {
    if (!this.pending) return false;
    this.pending.push(n * this.h.unitToMM);
    if (this.pending.length === 2) {
      this.h.memory.set("chamfer.d1", this.pending[0]);
      this.h.memory.set("chamfer.d2", this.pending[1]);
      this.pending = null;
    }
    this.h.refresh();
    return true;
  }
  protected compute(l1: LineEntity, p1: Vec2, l2: LineEntity, p2: Vec2) {
    const [a, b] = this.d;
    return chamferLines(l1, p1, l2, p2, a, b);
  }
}

/* --------------------------------- STRETCH ------------------------------ */
export class StretchTool extends Tool {
  readonly id = "STRETCH";
  readonly title = "STRETCH";
  private c1: Vec2 | null = null;
  private win: ReturnType<typeof boxFromPoints> | null = null;
  start() {
    this.h.sel.clear();
  }
  prompt(): string {
    if (!this.win) return `STRETCH: ${this.c1 ? "Segundo canto da janela de cruzamento" : "Primeiro canto da janela de cruzamento"}`;
    return this.base ? "STRETCH: Segundo ponto" : "STRETCH: Ponto base";
  }
  onPoint(ev: PointEvent): void {
    if (!this.win) {
      if (!this.c1) this.c1 = ev.p;
      else {
        this.win = boxFromPoints(this.c1, ev.p);
        const ids = this.h.doc.selectBox(this.win, true).map((e) => e.id);
        if (!ids.length) {
          this.h.message("Nenhum objeto na janela.", "warn");
          this.h.finish();
          return;
        }
        this.h.sel.set(ids);
      }
      this.h.refresh();
      return;
    }
    if (!this.base) {
      this.base = ev.p;
      this.h.refresh();
      return;
    }
    const out = this.apply(sub(ev.p, this.base));
    this.h.commit("Stretch", this.h.doc.updateChanges(out));
    this.h.sel.clear();
    this.h.finish();
  }
  private apply(d: Vec2): Entity[] {
    return this.h.sel
      .entities()
      .map((e) => stretchEntity(e, this.win!, d))
      .filter((e): e is Entity => !!e);
  }
  preview(c: Vec2): Entity[] {
    if (this.win && this.base) return this.apply(sub(c, this.base));
    if (this.c1 && !this.win) {
      const b = boxFromPoints(this.c1, c);
      return [
        makeEntity(
          {
            type: "polyline",
            pts: [
              { x: b.minX, y: b.minY },
              { x: b.maxX, y: b.minY },
              { x: b.maxX, y: b.maxY },
              { x: b.minX, y: b.maxY },
            ],
            bulges: [0, 0, 0, 0],
            closed: true,
          },
          "0",
          { linetype: "DASHED" },
        ),
      ];
    }
    return [];
  }
}

/* ------------------------------ EXPLODIR / UNIR ------------------------- */
export class ExplodeTool extends SelectionTool {
  readonly id = "EXPLODE";
  readonly title = "EXPLODIR";
  protected stagePrompt() {
    return "";
  }
  protected afterSelection() {
    const ch: Change[] = [];
    let n = 0;
    for (const e of this.selected()) {
      if (e.type === "polyline") {
        ch.push({ kind: "remove", e }, ...this.h.doc.addChanges(explodePolyline(e)));
        n++;
      } else if (e.type === "ellipse" || e.type === "spline" || e.type === "hatch") {
        const parts = explodeCurve(e) ?? [];
        ch.push({ kind: "remove", e }, ...this.h.doc.addChanges(parts));
        n++;
      } else if (e.type === "dimension") {
        const g = dimensionGeometry(e, this.h.doc.settings.dimStyle);
        const st = { color: e.color, linetype: null, lineweight: null };
        const parts: Entity[] = g.lines.map(([a, b]) => makeEntity({ type: "line", a, b }, e.layer, st));
        for (const a of g.arcs) parts.push(makeEntity({ type: "arc", ...a }, e.layer, st));
        for (const s of g.solids) parts.push(makeEntity({ type: "polyline", pts: s, bulges: s.map(() => 0), closed: true }, e.layer, st));
        parts.push(makeEntity({ type: "text", ...g.text, halign: 1 }, e.layer, st));
        ch.push({ kind: "remove", e }, ...this.h.doc.addChanges(parts));
        n++;
      }
    }
    if (!n) this.h.message("Nenhum objeto explodível (polilinhas, cotas, elipses, splines e hachuras).", "warn");
    else this.h.commit(`Explodir ${n} objeto(s)`, ch);
    this.h.sel.clear();
    this.h.finish();
  }
}

export class JoinTool extends SelectionTool {
  readonly id = "JOIN";
  readonly title = "UNIR";
  protected stagePrompt() {
    return "";
  }
  protected afterSelection() {
    const ents = this.selected();
    const r = joinEntities(ents);
    if (!r.ok) this.h.message(r.reason, "error");
    else {
      this.h.commit(`Unir ${ents.length} objetos`, [...this.h.doc.removeChanges(ents.map((e) => e.id)), { kind: "add", e: r.value }]);
      this.h.sel.set([r.value.id]);
    }
    this.h.finish();
  }
}
