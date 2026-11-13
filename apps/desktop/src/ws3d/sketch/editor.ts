import {
  type Constraint,
  type ConstraintKind,
  type Id,
  type Pt,
  type SEntity,
  type Sketch,
  type SolveResult,
  addArc3,
  addCircle,
  addConstraint,
  addLine,
  addPointEntity,
  addRectangle,
  constraintRefs,
  drag,
  entityOf,
  extend,
  isBuiltin,
  isDimension,
  offset,
  pointOf,
  removeConstraints,
  removeEntities,
  roundRadius,
  setDimension,
  solve,
  tangentConstraint,
  toggleConstruction,
  trim,
} from "@agtn/sketch";

/**
 * Editor de esboço: ferramentas como máquinas de estado sobre pontos 2D já projetados no plano.
 * Sem DOM e sem three.js — testado em Node. O viewport só converte mouse → plano e desenha o estado.
 */
export type SketchTool = "select" | "line" | "rect" | "circle" | "arc" | "point" | "trim" | "extend" | "offset" | "dimension";

export const TOOL_LABEL: Record<SketchTool, string> = {
  select: "Selecionar / arrastar",
  line: "Linha (encadeada) — Esc termina",
  rect: "Retângulo por 2 cantos",
  circle: "Círculo: centro e raio",
  arc: "Arco por 3 pontos: início, fim e ponto do arco",
  point: "Ponto (centro de furo)",
  trim: "Aparar: clique no trecho a remover",
  extend: "Estender: clique perto da ponta",
  offset: "Offset: clique na curva (a cadeia conectada é incluída)",
  dimension: "Cota: clique em linha, círculo, 2 pontos ou 2 linhas",
};

/** Ponto do plano + o que está embaixo do cursor (resolvido pelo viewport com tolerância em pixels). */
export interface Hit {
  readonly p: Pt;
  readonly point?: Id;
  readonly entity?: Id;
  readonly constraint?: Id;
}

export type DimKind = "distance" | "distanceX" | "distanceY" | "length" | "radius" | "diameter" | "angle" | "pointLineDistance";

/** Pedido de valor para uma cota (a interface mostra o campo e chama `confirmDimension`). */
export interface DimPrompt {
  readonly kind: DimKind;
  readonly refs: readonly Id[];
  readonly value: number;
  readonly at: Pt;
  /** alternativas (ex.: distância alinhada/horizontal/vertical entre pontos) */
  readonly options: readonly DimKind[];
  /** editando cota existente */
  readonly edit?: Id;
}

export interface EditorState {
  readonly sketch: Sketch;
  readonly solve: SolveResult;
  readonly tool: SketchTool;
  readonly sel: readonly Id[];
  /** pontos já clicados pela ferramenta atual */
  readonly clicks: readonly Hit[];
  /** posição do cursor (pré-visualização) */
  readonly cursor: Hit | null;
  readonly prompt: DimPrompt | null;
  readonly message: string | null;
  readonly error: string | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

const ANG_SNAP = (2 * Math.PI) / 180; // 2°: linha quase horizontal/vertical ganha a restrição

export class SketchEditor {
  private s: Sketch;
  private res: SolveResult;
  private tool: SketchTool = "line";
  private sel: Id[] = [];
  private clicks: Hit[] = [];
  private cursor: Hit | null = null;
  private prompt: DimPrompt | null = null;
  private message: string | null = null;
  private error: string | null = null;
  private undoStack: Sketch[] = [];
  private redoStack: Sketch[] = [];
  private chainStart: Id | null = null;
  private listeners = new Set<() => void>();
  private snapCache: EditorState | null = null;

  constructor(initial: Sketch) {
    this.s = initial;
    this.res = solve(initial);
    if (this.res.status !== "inconsistent" && this.res.status !== "unsolved") this.s = this.res.sketch;
    if (Object.keys(initial.entities).length) this.tool = "select";
  }

  /* ------------------------------------------------------------------ observação */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getState = (): EditorState => {
    if (!this.snapCache)
      this.snapCache = {
        sketch: this.s,
        solve: this.res,
        tool: this.tool,
        sel: this.sel,
        clicks: this.clicks,
        cursor: this.cursor,
        prompt: this.prompt,
        message: this.message,
        error: this.error,
        canUndo: this.undoStack.length > 0,
        canRedo: this.redoStack.length > 0,
      };
    return this.snapCache;
  };
  private emit() {
    this.snapCache = null;
    for (const f of this.listeners) f();
  }
  get sketch() {
    return this.s;
  }

  /* ------------------------------------------------------------------ histórico */
  /** Aplica uma alteração e resolve. Inconsistente → desfaz e informa as restrições em conflito. */
  private commit(next: Sketch, note?: string): boolean {
    const r = solve(next);
    if (r.status === "inconsistent" || r.status === "unsolved") {
      this.error = r.message;
      this.emit();
      return false;
    }
    this.undoStack.push(this.s);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.s = r.sketch;
    this.res = r;
    this.error = null;
    this.message = note ?? null;
    this.emit();
    return true;
  }
  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.s);
    this.s = prev;
    this.res = solve(prev);
    this.sel = this.sel.filter((id) => this.exists(id));
    this.emit();
  }
  redo() {
    const n = this.redoStack.pop();
    if (!n) return;
    this.undoStack.push(this.s);
    this.s = n;
    this.res = solve(n);
    this.emit();
  }
  private exists(id: Id) {
    return !!pointOf(this.s, id) || !!entityOf(this.s, id) || this.s.constraints.some((c) => c.id === id);
  }

  /* ------------------------------------------------------------------ ferramentas */
  setTool(t: SketchTool) {
    this.tool = t;
    this.clicks = [];
    this.prompt = null;
    this.chainStart = null;
    this.error = null;
    this.message = TOOL_LABEL[t];
    if (t !== "select" && t !== "dimension") this.sel = [];
    this.emit();
  }
  get currentTool() {
    return this.tool;
  }

  /** Esc: termina a ferramenta atual (cadeia de linhas) ou limpa a seleção. */
  escape() {
    if (this.prompt) this.prompt = null;
    else if (this.clicks.length) {
      this.clicks = [];
      this.chainStart = null;
    } else if (this.tool !== "select") this.tool = "select";
    else this.sel = [];
    this.error = null;
    this.emit();
  }

  hover(h: Hit | null) {
    this.cursor = h;
    this.emit();
  }

  /** Ponto do clique: reaproveita ponto existente (coincidência por topologia). */
  private pt(h: Hit): Pt | Id {
    return h.point ?? h.p;
  }

  click(h: Hit, additive = false) {
    this.error = null;
    try {
      switch (this.tool) {
        case "select":
          return this.selectAt(h, additive);
        case "line":
          return this.lineClick(h);
        case "rect":
          return this.rectClick(h);
        case "circle":
          return this.circleClick(h);
        case "arc":
          return this.arcClick(h);
        case "point":
          this.commit(addPointEntity(this.s, this.pt(h)).s, "Ponto criado.");
          return;
        case "trim":
          if (!h.entity) throw new Error("Clique sobre uma curva.");
          this.commit(trim(this.s, h.entity, h.p), "Aparado.");
          return;
        case "extend":
          if (!h.entity) throw new Error("Clique perto da ponta de uma linha ou arco.");
          this.commit(extend(this.s, h.entity, h.p), "Estendido.");
          return;
        case "offset":
          return this.offsetClick(h);
        case "dimension":
          return this.dimClick(h);
      }
    } catch (e) {
      this.error = (e as Error).message;
      this.clicks = [];
      this.emit();
    }
  }

  private selectAt(h: Hit, additive: boolean) {
    const id = h.constraint ?? h.point ?? h.entity ?? null;
    if (!id || isBuiltin(id)) {
      if (!additive) this.sel = [];
    } else if (additive) this.sel = this.sel.includes(id) ? this.sel.filter((x) => x !== id) : [...this.sel, id];
    else this.sel = [id];
    this.emit();
  }

  private autoHV(lineId: Id, s: Sketch): Sketch {
    const l = s.entities[lineId];
    if (l?.t !== "line") return s;
    const a = pointOf(s, l.p1)!;
    const b = pointOf(s, l.p2)!;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const near = (t: number) => Math.abs(Math.atan2(Math.sin(ang - t), Math.cos(ang - t))) < ANG_SNAP;
    try {
      if (near(0) || near(Math.PI)) return addConstraint(s, { t: "horizontal", l: lineId }).s;
      if (near(Math.PI / 2) || near(-Math.PI / 2)) return addConstraint(s, { t: "vertical", l: lineId }).s;
    } catch {
      /* já existe */
    }
    return s;
  }

  private lineClick(h: Hit) {
    if (!this.clicks.length) {
      this.clicks = [h];
      this.chainStart = h.point ?? null;
      this.emit();
      return;
    }
    const prev = this.clicks[this.clicks.length - 1];
    const r = addLine(this.s, this.pt(prev), this.pt(h));
    let s = this.autoHV(r.id, r.s);
    s = this.autoOnCurve(s, r.p2, h);
    if (this.clicks.length === 1) s = this.autoOnCurve(s, r.p1, prev);
    if (!this.commit(s)) return;
    // continua a cadeia a partir do ponto criado; clicar no ponto inicial fecha e termina
    const closed = h.point && (h.point === this.chainStart || h.point === this.clicks[0].point);
    if (closed) {
      this.clicks = [];
      this.chainStart = null;
      this.message = "Contorno fechado.";
    } else {
      if (!this.chainStart) this.chainStart = r.p1;
      this.clicks = [{ p: pointOf(this.s, r.p2)!, point: r.p2 }];
    }
    this.emit();
  }

  /** Ponto solto em cima de uma curva vira "ponto sobre" ela. */
  private autoOnCurve(s: Sketch, pid: Id, h: Hit): Sketch {
    if (h.point || !h.entity || isBuiltin(pid)) return s;
    const e = entityOf(s, h.entity);
    try {
      if (e?.t === "line") return addConstraint(s, { t: "pointOnLine", p: pid, l: e.id }).s;
      if (e?.t === "circle" || e?.t === "arc") return addConstraint(s, { t: "pointOnCircle", p: pid, c: e.id }).s;
    } catch {
      /* incompatível */
    }
    return s;
  }

  private rectClick(h: Hit) {
    if (!this.clicks.length) {
      this.clicks = [h];
      this.emit();
      return;
    }
    const a = this.clicks[0];
    const r = addRectangle(this.s, a.p, h.p);
    let s = r.s;
    // canto em ponto existente (ex.: origem) → coincidente
    if (a.point) s = addConstraint(s, { t: "coincident", a: r.points[0], b: a.point }).s;
    if (h.point) s = addConstraint(s, { t: "coincident", a: r.points[2], b: h.point }).s;
    this.clicks = [];
    this.commit(s, "Retângulo criado.");
  }

  private circleClick(h: Hit) {
    if (!this.clicks.length) {
      this.clicks = [h];
      this.emit();
      return;
    }
    const c = this.clicks[0];
    const r = Math.hypot(h.p.x - c.p.x, h.p.y - c.p.y);
    this.clicks = [];
    this.commit(addCircle(this.s, this.pt(c), r).s, "Círculo criado.");
  }

  private arcClick(h: Hit) {
    if (this.clicks.length < 2) {
      this.clicks = [...this.clicks, h];
      this.emit();
      return;
    }
    const [a, b] = this.clicks;
    this.clicks = [];
    this.commit(addArc3(this.s, this.pt(a), h.p, this.pt(b)).s, "Arco criado.");
  }

  private offsetClick(h: Hit) {
    if (!this.clicks.length) {
      if (!h.entity) throw new Error("Clique sobre uma curva.");
      this.clicks = [h];
      this.message = "Clique do lado para onde copiar (distância no campo).";
      this.emit();
      return;
    }
    const chain = this.chainOf(this.clicks[0].entity!);
    const d = this.offsetDist > 0 ? this.offsetDist : this.distanceToEntity(this.clicks[0].entity!, h.p);
    this.clicks = [];
    if (!(d > 1e-6)) throw new Error("Escolha um ponto fora da curva.");
    this.commit(offset(this.s, chain, Math.round(d * 1000) / 1000, h.p).s, `Offset de ${chain.length} curva(s).`);
  }

  /** Distância fixa do offset (0 = pela posição do clique). */
  offsetDist = 0;
  setOffsetDist(v: number) {
    this.offsetDist = Number.isFinite(v) && v > 0 ? v : 0;
    this.emit();
  }

  /** Offset com distância exata digitada. */
  offsetBy(entity: Id, dist: number, side: Pt) {
    try {
      this.commit(offset(this.s, this.chainOf(entity), dist, side).s, "Offset criado.");
    } catch (e) {
      this.error = (e as Error).message;
      this.emit();
    }
  }

  /** Curvas conectadas (pontos compartilhados) a partir de uma. */
  chainOf(id: Id): Id[] {
    const out = new Set<Id>([id]);
    let grew = true;
    const pts = (e: SEntity) => (e.t === "line" ? [e.p1, e.p2] : e.t === "arc" ? [e.p1, e.p2] : []);
    while (grew) {
      grew = false;
      const used = new Set([...out].flatMap((x) => pts(this.s.entities[x])));
      for (const e of Object.values(this.s.entities))
        if (!out.has(e.id) && !e.cons && pts(e).some((p) => used.has(p))) {
          out.add(e.id);
          grew = true;
        }
    }
    return [...out];
  }

  private distanceToEntity(id: Id, p: Pt): number {
    const e = entityOf(this.s, id)!;
    if (e.t === "line") {
      const a = pointOf(this.s, e.p1)!;
      const b = pointOf(this.s, e.p2)!;
      return Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
    }
    if (e.t === "circle" || e.t === "arc") {
      const c = pointOf(this.s, e.c)!;
      return Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - roundRadius(this.s, e));
    }
    return 0;
  }

  /* ------------------------------------------------------------------ cotas */
  private measure(kind: DimKind, refs: readonly Id[]): number {
    const s = this.s;
    const P = (id: Id) => pointOf(s, id)!;
    switch (kind) {
      case "length": {
        const l = entityOf(s, refs[0]) as Extract<SEntity, { t: "line" }>;
        return Math.hypot(P(l.p2).x - P(l.p1).x, P(l.p2).y - P(l.p1).y);
      }
      case "radius":
        return roundRadius(s, entityOf(s, refs[0])!);
      case "diameter":
        return 2 * roundRadius(s, entityOf(s, refs[0])!);
      case "distance":
        return Math.hypot(P(refs[1]).x - P(refs[0]).x, P(refs[1]).y - P(refs[0]).y);
      case "distanceX":
        return P(refs[1]).x - P(refs[0]).x;
      case "distanceY":
        return P(refs[1]).y - P(refs[0]).y;
      case "pointLineDistance":
        return this.distanceToEntity(refs[1], P(refs[0]));
      case "angle": {
        const l1 = entityOf(s, refs[0]) as Extract<SEntity, { t: "line" }>;
        const l2 = entityOf(s, refs[1]) as Extract<SEntity, { t: "line" }>;
        const u = { x: P(l1.p2).x - P(l1.p1).x, y: P(l1.p2).y - P(l1.p1).y };
        const v = { x: P(l2.p2).x - P(l2.p1).x, y: P(l2.p2).y - P(l2.p1).y };
        return Math.abs((Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y) * 180) / Math.PI);
      }
    }
  }

  private dimClick(h: Hit) {
    if (h.constraint) return this.editDimension(h.constraint);
    const id = h.point ?? h.entity;
    if (!id) return;
    const picks = [...this.sel.filter((x) => !this.s.constraints.some((c) => c.id === x)), id];
    const kinds = picks.map((x) => (pointOf(this.s, x) && !entityOf(this.s, x) ? "p" : entityOf(this.s, x)!.t));
    const ask = (kind: DimKind, refs: Id[], options: DimKind[] = [kind], at: Pt = h.p) => {
      this.prompt = { kind, refs, value: Math.round(this.measure(kind, refs) * 1e6) / 1e6, at, options };
      this.sel = [];
      this.emit();
    };
    if (picks.length === 1) {
      if (kinds[0] === "line") return ask("length", picks);
      if (kinds[0] === "circle") return ask("diameter", picks, ["diameter", "radius"]);
      if (kinds[0] === "arc") return ask("radius", picks, ["radius", "diameter"]);
      this.sel = picks; // aguarda o 2º
      this.emit();
      return;
    }
    const [a, b] = picks.slice(-2);
    const [ka, kb] = kinds.slice(-2);
    if (ka === "p" && kb === "p") {
      // rótulo no meio dos dois pontos (não cobre os pontos para os próximos cliques)
      const pa = pointOf(this.s, a)!;
      const pb = pointOf(this.s, b)!;
      return ask("distance", [a, b], ["distance", "distanceX", "distanceY"], { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 });
    }
    if (ka === "line" && kb === "line") return ask("angle", [a, b]);
    if (ka === "p" && kb === "line") return ask("pointLineDistance", [a, b]);
    if (ka === "line" && kb === "p") return ask("pointLineDistance", [b, a]);
    this.sel = [id];
    this.error = "Combinação não suportada para cota — escolha linha, círculo/arco, 2 pontos, ponto+linha ou 2 linhas.";
    this.emit();
  }

  /** Abre o campo para editar uma cota existente. */
  editDimension(cid: Id) {
    const c = this.s.constraints.find((k) => k.id === cid);
    if (!c || !isDimension(c)) return;
    this.prompt = { kind: c.t as DimKind, refs: constraintRefs(c), value: c.v, at: c.at ?? { x: 0, y: 0 }, options: [c.t as DimKind], edit: cid };
    this.emit();
  }

  setPromptKind(kind: DimKind) {
    if (!this.prompt || this.prompt.edit) return;
    this.prompt = { ...this.prompt, kind, value: Math.round(this.measure(kind, this.prompt.refs) * 1e6) / 1e6 };
    this.emit();
  }

  /** Confirma o valor: cria/altera a cota e resolve (o esboço se ajusta). */
  confirmDimension(value: number): boolean {
    const p = this.prompt;
    if (!p) return false;
    if (!Number.isFinite(value) || (value <= 0 && p.kind !== "distanceX" && p.kind !== "distanceY" && p.kind !== "angle")) {
      this.error = "Valor inválido.";
      this.emit();
      return false;
    }
    let next: Sketch;
    if (p.edit) next = setDimension(this.s, p.edit, value);
    else {
      const r = p.refs;
      let at = p.at;
      if (p.kind === "distanceX" || p.kind === "distanceY") {
        const pa = pointOf(this.s, r[0])!;
        const pb = pointOf(this.s, r[1])!;
        at = p.kind === "distanceX" ? { x: (pa.x + pb.x) / 2, y: pa.y } : { x: pa.x, y: (pa.y + pb.y) / 2 };
      }
      const c =
        p.kind === "length"
          ? { t: "length" as const, l: r[0], v: value, at }
          : p.kind === "radius" || p.kind === "diameter"
            ? { t: p.kind, c: r[0], v: value, at }
            : p.kind === "angle"
              ? { t: "angle" as const, a: r[0], b: r[1], v: value, at }
              : p.kind === "pointLineDistance"
                ? { t: "pointLineDistance" as const, p: r[0], l: r[1], v: value, at }
                : { t: p.kind, a: r[0], b: r[1], v: value, at };
      try {
        next = addConstraint(this.s, c).s;
      } catch (e) {
        this.error = (e as Error).message;
        this.emit();
        return false;
      }
    }
    const ok = this.commit(next, p.edit ? "Cota alterada." : "Cota criada.");
    if (ok) this.prompt = null;
    this.emit();
    return ok;
  }
  cancelPrompt() {
    this.prompt = null;
    this.emit();
  }

  /* ------------------------------------------------------------------ restrições geométricas */

  /** Restrições aplicáveis à seleção atual (para habilitar os botões). */
  applicable(): ConstraintKind[] {
    const ids = this.sel.filter((x) => !this.s.constraints.some((c) => c.id === x));
    const kinds = ids.map((x) => (entityOf(this.s, x)?.t ?? (pointOf(this.s, x) ? "p" : "?")));
    const n = (k: string) => kinds.filter((x) => x === k).length;
    const lines = n("line");
    const round = n("circle") + n("arc");
    const pts = n("p");
    const out: ConstraintKind[] = [];
    if (ids.length === 1 && lines === 1) out.push("horizontal", "vertical");
    if (ids.length === 2 && pts === 2) out.push("coincident", "horizontal", "vertical");
    if (ids.length === 2 && lines === 2) out.push("parallel", "perpendicular", "equal");
    if (ids.length === 2 && pts === 1 && lines === 1) out.push("coincident", "midpoint");
    if (ids.length === 2 && pts === 1 && round === 1) out.push("coincident");
    if (ids.length === 2 && ((lines === 1 && round === 1) || round === 2)) out.push("tangent");
    if (ids.length === 2 && round === 2) out.push("concentric", "equal");
    if (pts >= 1 && ids.length === pts) out.push("fixed");
    return out;
  }

  /** Aplica a restrição à seleção. */
  constrain(kind: ConstraintKind) {
    const ids = this.sel.filter((x) => !this.s.constraints.some((c) => c.id === x));
    const isPt = (x: Id) => !!pointOf(this.s, x) && !entityOf(this.s, x);
    const ent = (x: Id) => entityOf(this.s, x);
    let s = this.s;
    try {
      if (kind === "fixed") {
        for (const p of ids.filter(isPt)) s = addConstraint(s, { t: "fixed", p, x: pointOf(s, p)!.x, y: pointOf(s, p)!.y }).s;
      } else if ((kind === "horizontal" || kind === "vertical") && ids.length === 2 && ids.every(isPt)) {
        // dois pontos alinhados: cota X/Y = 0
        s = addConstraint(s, { t: kind === "horizontal" ? "distanceY" : "distanceX", a: ids[0], b: ids[1], v: 0 }).s;
      } else if (kind === "horizontal" || kind === "vertical") s = addConstraint(s, { t: kind, l: ids[0] }).s;
      else if (kind === "coincident") {
        const p = ids.find(isPt)!;
        const o = ids.find((x) => x !== p)!;
        if (isPt(o)) s = addConstraint(s, { t: "coincident", a: p, b: o }).s;
        else if (ent(o)?.t === "line") s = addConstraint(s, { t: "pointOnLine", p, l: o }).s;
        else s = addConstraint(s, { t: "pointOnCircle", p, c: o }).s;
      } else if (kind === "midpoint") s = addConstraint(s, { t: "midpoint", p: ids.find(isPt)!, l: ids.find((x) => !isPt(x))! }).s;
      else if (kind === "tangent") s = addConstraint(s, tangentConstraint(s, ids[0], ids[1])).s;
      else s = addConstraint(s, { t: kind, a: ids[0], b: ids[1] } as Omit<Extract<Constraint, { t: "parallel" }>, "id">).s;
    } catch (e) {
      this.error = (e as Error).message;
      this.emit();
      return;
    }
    if (this.commit(s, `Restrição aplicada.`)) this.sel = [];
    this.emit();
  }

  /** Apaga a seleção (curvas, pontos ou restrições/cotas). */
  deleteSelection() {
    const cons = this.sel.filter((x) => this.s.constraints.some((c) => c.id === x));
    const ents = this.sel.filter((x) => entityOf(this.s, x) && !isBuiltin(x));
    const pts = this.sel.filter((x) => this.s.points[x]);
    let s = removeConstraints(this.s, cons);
    // apagar ponto apaga as curvas que o usam
    const viaPts = Object.values(s.entities).filter((e) => pts.some((p) => JSON.stringify(e).includes(`"${p}"`))).map((e) => e.id);
    s = removeEntities(s, [...ents, ...viaPts]);
    this.sel = [];
    this.commit(s, "Excluído.");
  }

  toggleConstruction() {
    const ents = this.sel.filter((x) => this.s.entities[x]);
    if (!ents.length) return;
    this.commit(toggleConstruction(this.s, ents), "Construção alternada.");
  }

  /* ------------------------------------------------------------------ arrasto */
  private dragBase: Sketch | null = null;
  beginDrag(pointId: Id): boolean {
    if (!this.s.points[pointId]) return false;
    this.dragBase = this.s;
    return true;
  }
  dragTo(pointId: Id, to: Pt) {
    if (!this.dragBase) return;
    const r = drag(this.s, pointId, to);
    if (r.status === "inconsistent" || r.status === "unsolved") return;
    this.s = r.sketch;
    this.res = r;
    this.emit();
  }
  endDrag() {
    if (!this.dragBase) return;
    if (this.dragBase !== this.s) {
      this.undoStack.push(this.dragBase);
      this.redoStack = [];
    }
    this.dragBase = null;
    this.emit();
  }
}
