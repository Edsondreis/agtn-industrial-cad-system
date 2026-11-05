import {
  type Entity,
  type Vec2,
  angleOf,
  arcFrom3Points,
  circleFrom3Points,
  cross,
  deg2rad,
  dist,
  dot,
  fromAngle,
  mid,
  norm,
  normAngle,
  rectanglePoints,
  regularPolygon,
  sub,
  bulgeSeg,
} from "@agtn/geometry";
import { type PointEvent, Tool } from "./base";

/* ------------------------------- LINHA ------------------------------- */
export class LineTool extends Tool {
  readonly id = "LINE";
  readonly title = "LINHA";
  private first: Vec2 | null = null;
  private created: string[] = [];
  private pts: Vec2[] = [];

  prompt(): string {
    if (!this.base) return "LINHA: Primeiro ponto";
    return `LINHA: Próximo ponto ou [Desfazer (U)${this.pts.length >= 3 ? " / Fechar (F)" : ""}]  (Enter termina)`;
  }
  onPoint(ev: PointEvent): void {
    if (!this.base) {
      this.base = ev.p;
      this.first = ev.p;
      this.pts = [ev.p];
      this.h.refresh();
      return;
    }
    if (dist(this.base, ev.p) < 1e-9) {
      this.h.message("Comprimento zero ignorado.", "warn");
      return;
    }
    const e = this.h.create({ type: "line", a: this.base, b: ev.p });
    this.h.commit("Linha", [{ kind: "add", e }]);
    this.created.push(e.id);
    this.pts.push(ev.p);
    this.base = ev.p;
    this.h.refresh();
  }
  onWord(w: string): boolean {
    if ((w === "U" || w === "DESFAZER") && this.created.length) {
      const id = this.created.pop()!;
      this.h.commit("Desfazer segmento", this.h.doc.removeChanges([id]));
      this.pts.pop();
      this.base = this.pts.at(-1) ?? null;
      this.h.refresh();
      return true;
    }
    if ((w === "F" || w === "C" || w === "FECHAR") && this.first && this.pts.length >= 3) {
      this.onPoint({ p: this.first, raw: this.first, snap: null, shift: false, typed: true });
      this.h.finish();
      return true;
    }
    return false;
  }
  preview(c: Vec2): Entity[] {
    return this.base ? [this.h.create({ type: "line", a: this.base, b: c })] : [];
  }
}

/* ----------------------------- POLILINHA ----------------------------- */
export class PolylineTool extends Tool {
  readonly id = "PLINE";
  readonly title = "POLILINHA";
  private pts: Vec2[] = [];
  private bulges: number[] = [];
  private arcMode = false;

  prompt(): string {
    if (!this.pts.length) return "POLILINHA: Ponto inicial";
    const opts = this.arcMode ? "Linha (L)" : "Arco (A)";
    return `POLILINHA: Próximo ponto ou [${opts} / Desfazer (U)${this.pts.length >= 2 ? " / Fechar (F)" : ""}]  (Enter termina)`;
  }
  private endTangent(): Vec2 {
    const n = this.pts.length;
    if (n < 2) return { x: 1, y: 0 };
    const a = this.pts[n - 2];
    const b = this.pts[n - 1];
    const bl = this.bulges[n - 2] ?? 0;
    const d = norm(sub(b, a));
    if (Math.abs(bl) < 1e-12) return d;
    const th = 4 * Math.atan(bl);
    return fromAngle(angleOf(d) + th / 2);
  }
  private bulgeTo(p: Vec2): number {
    const last = this.pts[this.pts.length - 1];
    const t = this.endTangent();
    const d = sub(p, last);
    if (Math.hypot(d.x, d.y) < 1e-12) return 0;
    // θ = 2·(ângulo da tangente até a corda); bulge = tan(θ/4)
    const half = Math.atan2(cross(t, d), dot(t, d));
    return Math.tan((2 * half) / 4);
  }
  onPoint(ev: PointEvent): void {
    if (this.pts.length && dist(this.pts[this.pts.length - 1], ev.p) < 1e-9) return;
    if (this.pts.length) this.bulges[this.pts.length - 1] = this.arcMode ? this.bulgeTo(ev.p) : 0;
    this.pts.push(ev.p);
    this.bulges[this.pts.length - 1] = 0;
    this.base = ev.p;
    this.h.refresh();
  }
  onWord(w: string): boolean {
    if (w === "A" || w === "ARCO") {
      this.arcMode = true;
      this.h.refresh();
      return true;
    }
    if (w === "L" || w === "LINHA") {
      this.arcMode = false;
      this.h.refresh();
      return true;
    }
    if (w === "U" && this.pts.length) {
      this.pts.pop();
      this.bulges.pop();
      if (this.pts.length) this.bulges[this.pts.length - 1] = 0;
      this.base = this.pts.at(-1) ?? null;
      this.h.refresh();
      return true;
    }
    if ((w === "F" || w === "C" || w === "FECHAR") && this.pts.length >= 2) {
      this.bulges[this.pts.length - 1] = this.arcMode ? this.bulgeTo(this.pts[0]) : 0;
      this.commit(true);
      return true;
    }
    return false;
  }
  private commit(closed: boolean) {
    if (this.pts.length >= 2) {
      const e = this.h.create({ type: "polyline", pts: this.pts.slice(), bulges: this.bulges.slice(0, this.pts.length), closed });
      this.h.commit("Polilinha", [{ kind: "add", e }]);
    }
    this.h.finish();
  }
  onEnter(): void {
    this.commit(false);
  }
  preview(c: Vec2): Entity[] {
    if (!this.pts.length) return [];
    const pts = [...this.pts, c];
    const bulges = [...this.bulges.slice(0, this.pts.length - 1), this.arcMode ? this.bulgeTo(c) : 0, 0];
    return [this.h.create({ type: "polyline", pts, bulges, closed: false })];
  }
}

/* ----------------------------- RETÂNGULO ----------------------------- */
export class RectTool extends Tool {
  readonly id = "RECTANG";
  readonly title = "RETÂNGULO";
  prompt(): string {
    return this.base ? "RETÂNGULO: Canto oposto (ex.: @largura,altura)" : "RETÂNGULO: Primeiro canto";
  }
  onPoint(ev: PointEvent): void {
    if (!this.base) {
      this.base = ev.p;
      this.h.refresh();
      return;
    }
    if (Math.abs(ev.p.x - this.base.x) < 1e-9 || Math.abs(ev.p.y - this.base.y) < 1e-9) {
      this.h.message("Retângulo com largura ou altura zero.", "warn");
      return;
    }
    const e = this.h.create({ type: "polyline", pts: rectanglePoints(this.base, ev.p), bulges: [0, 0, 0, 0], closed: true });
    this.h.commit("Retângulo", [{ kind: "add", e }]);
    this.h.finish();
  }
  preview(c: Vec2): Entity[] {
    if (!this.base) return [];
    return [this.h.create({ type: "polyline", pts: rectanglePoints(this.base, c), bulges: [0, 0, 0, 0], closed: true })];
  }
}

/* ------------------------------- CÍRCULO ----------------------------- */
export class CircleTool extends Tool {
  readonly id = "CIRCLE";
  readonly title = "CÍRCULO";
  private diameter = false;
  private three: Vec2[] | null = null;
  prompt(): string {
    if (this.three) return `CÍRCULO 3P: ${["Primeiro", "Segundo", "Terceiro"][this.three.length]} ponto`;
    if (!this.base) return "CÍRCULO: Centro ou [3 pontos (3P)]";
    return this.diameter ? "CÍRCULO: Diâmetro ou [Raio (R)]" : "CÍRCULO: Raio ou [Diâmetro (D)]";
  }
  private add(c: Vec2, r: number) {
    if (!(r > 1e-9)) {
      this.h.message("Raio deve ser maior que zero.", "warn");
      return;
    }
    this.h.commit("Círculo", [{ kind: "add", e: this.h.create({ type: "circle", c, r }) }]);
    this.h.finish();
  }
  onPoint(ev: PointEvent): void {
    if (this.three) {
      this.three.push(ev.p);
      if (this.three.length === 3) {
        const c = circleFrom3Points(this.three[0], this.three[1], this.three[2]);
        if (!c) {
          this.h.message("Pontos colineares.", "error");
          this.three.pop();
          return;
        }
        this.add(c.c, c.r);
        return;
      }
      this.base = ev.p;
      this.h.refresh();
      return;
    }
    if (!this.base) {
      this.base = ev.p;
      this.h.refresh();
      return;
    }
    const d = dist(this.base, ev.p);
    this.add(this.base, this.diameter ? d / 2 : d);
  }
  onNumber(n: number): boolean {
    if (!this.base || this.three) return false;
    const v = n * this.h.unitToMM;
    this.add(this.base, this.diameter ? v / 2 : v);
    return true;
  }
  onWord(w: string): boolean {
    if (w === "D") {
      this.diameter = true;
      this.h.refresh();
      return true;
    }
    if (w === "R") {
      this.diameter = false;
      this.h.refresh();
      return true;
    }
    if (w === "3P" && !this.base) {
      this.three = [];
      this.h.refresh();
      return true;
    }
    return false;
  }
  preview(c: Vec2): Entity[] {
    if (this.three) {
      if (this.three.length === 2) {
        const cc = circleFrom3Points(this.three[0], this.three[1], c);
        return cc ? [this.h.create({ type: "circle", c: cc.c, r: cc.r })] : [];
      }
      return [];
    }
    if (!this.base) return [];
    const d = dist(this.base, c);
    const r = this.diameter ? d / 2 : d;
    return r > 0 ? [this.h.create({ type: "circle", c: this.base, r })] : [];
  }
}

/* --------------------------------- ARCO ------------------------------ */
export class ArcTool extends Tool {
  readonly id = "ARC";
  readonly title = "ARCO";
  private pts: Vec2[] = [];
  private centerMode = false;
  prompt(): string {
    if (this.centerMode) return `ARCO (centro): ${["Centro", "Ponto inicial", "Ponto final (sentido anti-horário)"][this.pts.length]}`;
    return `ARCO: ${["Ponto inicial ou [Centro (C)]", "Segundo ponto", "Ponto final"][this.pts.length]}`;
  }
  onPoint(ev: PointEvent): void {
    this.pts.push(ev.p);
    this.base = ev.p;
    if (this.pts.length === 3) {
      const e = this.build(this.pts[2]);
      if (!e) {
        this.h.message("Não foi possível definir o arco (pontos colineares ou coincidentes).", "error");
        this.pts.pop();
        return;
      }
      this.h.commit("Arco", [{ kind: "add", e }]);
      this.h.finish();
      return;
    }
    if (this.centerMode && this.pts.length === 2) this.base = this.pts[0];
    this.h.refresh();
  }
  private build(p3: Vec2): Entity | null {
    if (this.centerMode) {
      const [c, s] = this.pts;
      const r = dist(c, s);
      if (r < 1e-9 || dist(c, p3) < 1e-9) return null;
      return this.h.create({ type: "arc", c, r, a0: normAngle(angleOf(sub(s, c))), a1: normAngle(angleOf(sub(p3, c))) });
    }
    const a = arcFrom3Points(this.pts[0], this.pts[1], p3);
    return a ? this.h.create({ type: "arc", ...a }) : null;
  }
  onWord(w: string): boolean {
    if (w === "C" && this.pts.length === 0) {
      this.centerMode = true;
      this.h.refresh();
      return true;
    }
    return false;
  }
  preview(c: Vec2): Entity[] {
    if (this.pts.length === 2) {
      const e = this.build(c);
      return e ? [e] : [];
    }
    if (this.pts.length === 1) return [this.h.create({ type: "line", a: this.pts[0], b: c })];
    return [];
  }
}

/* ------------------------------- POLÍGONO ----------------------------- */
export class PolygonTool extends Tool {
  readonly id = "POLYGON";
  readonly title = "POLÍGONO";
  private sides: number | null = null;
  private circ = false;
  prompt(): string {
    if (this.sides === null) return `POLÍGONO: Número de lados <${this.h.memory.get("polygon.sides") ?? 6}>`;
    if (!this.base) return "POLÍGONO: Centro";
    return `POLÍGONO: Raio (${this.circ ? "circunscrito" : "inscrito"}) ou [Inscrito (I) / Circunscrito (C)]`;
  }
  onNumber(n: number): boolean {
    if (this.sides === null) {
      if (!Number.isInteger(n) || n < 3 || n > 1024) {
        this.h.message("Informe um inteiro entre 3 e 1024.", "warn");
        return true;
      }
      this.sides = n;
      this.h.memory.set("polygon.sides", n);
      this.h.refresh();
      return true;
    }
    if (this.base) {
      this.add(n * this.h.unitToMM, 0);
      return true;
    }
    return false;
  }
  onEnter(): void {
    if (this.sides === null) {
      this.sides = this.h.memory.get("polygon.sides") ?? 6;
      this.h.refresh();
      return;
    }
    this.h.finish();
  }
  onWord(w: string): boolean {
    if (w === "I" || w === "C") {
      this.circ = w === "C";
      this.h.refresh();
      return true;
    }
    return false;
  }
  private pts(r: number, ang: number) {
    return regularPolygon(this.base!, this.sides!, r, ang, this.circ ? "circumscribed" : "inscribed");
  }
  private add(r: number, ang: number) {
    if (!(r > 1e-9)) return;
    const pts = this.pts(r, ang);
    this.h.commit("Polígono", [{ kind: "add", e: this.h.create({ type: "polyline", pts, bulges: pts.map(() => 0), closed: true }) }]);
    this.h.finish();
  }
  onPoint(ev: PointEvent): void {
    if (this.sides === null) return;
    if (!this.base) {
      this.base = ev.p;
      this.h.refresh();
      return;
    }
    const a = angleOf(sub(ev.p, this.base));
    this.add(dist(this.base, ev.p), this.circ ? a - Math.PI / this.sides : a);
  }
  preview(c: Vec2): Entity[] {
    if (!this.base || this.sides === null) return [];
    const r = dist(this.base, c);
    if (r < 1e-9) return [];
    const a = angleOf(sub(c, this.base));
    const pts = this.pts(r, this.circ ? a - Math.PI / this.sides : a);
    return [this.h.create({ type: "polyline", pts, bulges: pts.map(() => 0), closed: true })];
  }
}

/* -------------------------------- PONTO ------------------------------- */
export class PointTool extends Tool {
  readonly id = "POINT";
  readonly title = "PONTO";
  prompt(): string {
    return "PONTO: Posição (Enter termina)";
  }
  onPoint(ev: PointEvent): void {
    this.h.commit("Ponto", [{ kind: "add", e: this.h.create({ type: "point", p: ev.p }) }]);
  }
}

/* -------------------------------- TEXTO ------------------------------- */
export class TextTool extends Tool {
  readonly id = "TEXT";
  readonly title = "TEXTO";
  private stage: "pos" | "h" | "rot" | "text" = "pos";
  private hgt = 0;
  private rot = 0;
  prompt(): string {
    const dh = this.h.memory.get("text.h") ?? this.h.doc.settings.textHeight;
    switch (this.stage) {
      case "pos":
        return "TEXTO: Ponto de inserção";
      case "h":
        return `TEXTO: Altura <${this.h.fmtLen(dh)}>`;
      case "rot":
        return "TEXTO: Rotação em graus <0>";
      case "text":
        return "TEXTO: Digite o texto e pressione Enter";
    }
  }
  wantsRawText(): boolean {
    return this.stage === "text";
  }
  onPoint(ev: PointEvent): void {
    if (this.stage === "pos") {
      this.base = ev.p;
      this.stage = "h";
      this.h.refresh();
    } else if (this.stage === "h") {
      this.hgt = dist(this.base!, ev.p);
      this.stage = "rot";
      this.h.refresh();
    } else if (this.stage === "rot") {
      this.rot = angleOf(sub(ev.p, this.base!));
      this.stage = "text";
      this.h.refresh();
    }
  }
  onNumber(n: number): boolean {
    if (this.stage === "h") {
      if (n <= 0) return true;
      this.hgt = n * this.h.unitToMM;
      this.h.memory.set("text.h", this.hgt);
      this.stage = "rot";
      this.h.refresh();
      return true;
    }
    if (this.stage === "rot") {
      this.rot = deg2rad(n);
      this.stage = "text";
      this.h.refresh();
      return true;
    }
    return false;
  }
  onEnter(): void {
    if (this.stage === "h") {
      this.hgt = this.h.memory.get("text.h") ?? this.h.doc.settings.textHeight;
      this.stage = "rot";
    } else if (this.stage === "rot") {
      this.rot = 0;
      this.stage = "text";
    } else this.h.finish();
    this.h.refresh();
  }
  onText(raw: string): void {
    if (!raw.trim()) {
      this.h.finish();
      return;
    }
    this.h.commit("Texto", [{ kind: "add", e: this.h.create({ type: "text", p: this.base!, h: this.hgt, rot: this.rot, value: raw, halign: 0 }) }]);
    this.h.finish();
  }
  mode() {
    return this.stage === "text" ? ("entity" as const) : ("point" as const);
  }
}

/** Utilitário para pré-visualizar distância de ponto médio (usado por ferramentas de cota). */
export const midOf = mid;
export const segOf = bulgeSeg;
