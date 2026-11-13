import { type Seg2, type Sketch, defaultRegions, entityOf, pathChain, pointOf, profiles } from "@agtn/sketch";
import { JoinType, type OcctKernel, type ShapeHandle } from "occt-wasm";
import type { AxisRef, BoolOp, EdgeRef, FaceRef, FeatId, Feature, PlaneRef, SheetFeature } from "./features";
import { FEATURE_LABEL, featureRefs, isSheetFeature, validateFeature } from "./features";
import type { OcctSolidKernel } from "./occt";
import { placementMatrix } from "./placement";
import type { PrimitiveSpec } from "./primitives";
import { type Placement, SolidError, type SolidRef, type Vec3 } from "./types";

/* =============================================================================================== vetores */
const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3) => V(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: Vec3, b: Vec3) => V(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a: Vec3, k: number) => V(a.x * k, a.y * k, a.z * k);
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const unit = (a: Vec3) => mul(a, 1 / (len(a) || 1));
const vec = (p: { x: number; y: number; z: number }) => V(p.x, p.y, p.z);

/** Sistema de coordenadas de um plano de esboço: origem, eixos X/Y do esboço e normal (X × Y). */
export interface Frame {
  readonly o: Vec3;
  readonly x: Vec3;
  readonly y: Vec3;
  readonly n: Vec3;
}

export const STD_FRAMES: Record<"XY" | "XZ" | "YZ", Frame> = {
  XY: { o: V(0, 0, 0), x: V(1, 0, 0), y: V(0, 1, 0), n: V(0, 0, 1) },
  // plano frontal: visto de frente (de −Y), X para a direita e Z para cima
  XZ: { o: V(0, 0, 0), x: V(1, 0, 0), y: V(0, 0, 1), n: V(0, -1, 0) },
  // plano lateral direito: visto da direita (de +X), Y para a direita e Z para cima
  YZ: { o: V(0, 0, 0), x: V(0, 1, 0), y: V(0, 0, 1), n: V(1, 0, 0) },
};

export const to3d = (f: Frame, p: { x: number; y: number }): Vec3 => add(f.o, add(mul(f.x, p.x), mul(f.y, p.y)));
export function to2d(f: Frame, p: Vec3): { x: number; y: number } {
  const d = sub(p, f.o);
  return { x: dot(d, f.x), y: dot(d, f.y) };
}

/**
 * Estado de uma operação após a regeneração:
 * - `ok`: executada sobre dependências válidas;
 * - `error`: falha própria (parâmetro, kernel, referência perdida/ambígua);
 * - `dependency_error`: NÃO avaliada — depende de uma operação com erro (referência explícita ou o sólido
 *   acumulado de uma operação anterior que falhou); nunca recebe "ok" sobre geometria desatualizada;
 * - `suppressed`: suprimida pelo usuário, ou junto com uma operação suprimida da qual depende (`cause`);
 * - `rolledback`: depois da barra de recuo (não avaliada).
 */
export interface FeatureStatus {
  readonly id: FeatId;
  readonly state: "ok" | "error" | "dependency_error" | "suppressed" | "rolledback";
  readonly error?: string;
  /** operação que causou o estado (dependência com erro ou supressão do pai) */
  readonly cause?: FeatId;
  /** aviso sem falha (ex.: união gerou sólidos separados) */
  readonly warning?: string;
  readonly ms: number;
}

export interface PartResult {
  /** sólido final (pertence ao cache — NÃO liberar). Com `failed`, é o ÚLTIMO SÓLIDO VÁLIDO, antes da falha. */
  readonly shape: ShapeHandle | null;
  readonly status: readonly FeatureStatus[];
  /** quadros dos esboços (para a interface desenhar no plano certo) */
  readonly frames: Readonly<Record<FeatId, Frame>>;
  /** primeira operação que quebrou a cadeia do sólido (o resultado é o sólido de antes dela) */
  readonly failed: { readonly id: FeatId; readonly name: string; readonly error: string } | null;
  /** peça de chapa: estado da última operação de chapa válida + operações sólidas genéricas depois dela */
  readonly sheet: { readonly state: unknown; readonly feature: FeatId; readonly generic: readonly string[] } | null;
}

/**
 * PONTO DE EXTENSÃO DA CHAPA (FASE 4). O `core/solid` não conhece o motor de chapa (as dependências só
 * descem): o módulo de chapa implementa esta interface e é injetado no avaliador. Cache, estados, rollback,
 * propagação de erro e validação do sólido continuam aqui. Sem backend → erro explícito.
 */
export interface SheetBackend {
  apply(f: SheetFeature, ctx: SheetCtx): SheetApply;
  /**
   * Avisos da operação `featureId` (no estado `step`) que uma operação de chapa posterior já resolveu no estado
   * final (ex.: "dobra sem alívio" depois de um Alívio). Opcional: sem ele os avisos ficam como foram gerados.
   */
  superseded?(step: unknown, final: unknown, featureId: FeatId): readonly string[];
}
export interface SheetCtx {
  readonly kernel: OcctKernel;
  /** estado da chapa da operação de chapa anterior (null na base) */
  readonly prev: unknown | null;
  readonly sketch: (id: FeatId) => { readonly frame: Frame; readonly sketch: Sketch };
  /** registra um temporário OCCT (liberado no fim da operação se não for o resultado) */
  readonly T: <H extends ShapeHandle>(h: H) => H;
}
export interface SheetApply {
  /** estado novo (dados puros, sem handles OCCT) */
  readonly state: unknown;
  /** sólido completo da chapa (substitui o anterior) */
  readonly shape: ShapeHandle;
  readonly warning?: string;
}

type Anchor =
  | { readonly kind: "extrude"; readonly frame: Frame; readonly z0: number; readonly z1: number; readonly sketch: Sketch }
  | { readonly kind: "prim"; readonly spec: PrimitiveSpec; readonly placement: Placement }
  | {
      readonly kind: "hole";
      /** sentido do furo (para dentro do material) */
      readonly z: Vec3;
      readonly centers: readonly { readonly key: string; readonly o: Vec3 }[];
      readonly d: number;
      readonly cbore: { readonly d: number; readonly depth: number } | null;
    };

interface Entry {
  sig: string;
  result: ShapeHandle | null;
  ownsResult: boolean;
  tool: ShapeHandle | null;
  op: BoolOp | null;
  frame?: Frame;
  anchor?: Anchor;
  status: FeatureStatus;
  /** volume do resultado (calculado uma vez; serve de entrada para a operação seguinte) */
  vol?: number;
  /** estado da chapa (só operações de chapa válidas) */
  sheet?: unknown;
}

type Desc = { kind: "plane"; p: Vec3; n: Vec3 } | { kind: "cyl"; p: Vec3; axis: Vec3; r: number } | { kind: "point"; p: Vec3 };

export interface External {
  readonly sig: string;
  /** sólido no sistema LOCAL desta peça (pertence a quem fornece); null quando o corpo está com erro */
  readonly shape: ShapeHandle | null;
  /** o corpo-ferramenta existe mas está com erro (a combinação fica com erro de dependência) */
  readonly error?: string;
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Avaliador de peças paramétricas sobre o OCCT.
 *
 * - Regenera em ordem; cada operação guarda resultado, ferramenta (sólido somado/retirado) e âncoras.
 * - Cache incremental por assinatura (parâmetros + assinatura anterior): editar a 5ª operação recalcula da 5ª em diante.
 * - Falha de uma operação: estado "error" com mensagem, o sólido segue como estava (as demais continuam).
 * - Rollback: operações a partir do índice ficam "recuadas" (não avaliadas).
 */
export class PartEvaluator {
  private readonly cache = new Map<string, Entry[]>();
  private readonly k: OcctKernel;

  constructor(
    private readonly sk: OcctSolidKernel,
    private sheetBackend: SheetBackend | null = null,
  ) {
    this.k = sk.raw;
  }

  /** Liga o motor de chapa (o cache é descartado: as operações de chapa passam a ser avaliadas). */
  setSheetBackend(b: SheetBackend | null) {
    this.sheetBackend = b;
    this.releaseAll();
  }

  evaluate(partId: string, features: readonly Feature[], opts: { rollback?: number | null; external?: (id: string) => External | null } = {}): PartResult {
    const entries = this.cache.get(partId) ?? [];
    const status: FeatureStatus[] = [];
    const frames: Record<FeatId, Frame> = {};
    const stop = opts.rollback ?? features.length;
    let prevSig = "";
    let result: ShapeHandle | null = null;
    let valid = 0; // entradas reaproveitáveis
    let failed: PartResult["failed"] = null;
    let resultVol: number | undefined;
    const ids = new Set<string>();
    for (let i = 0; i < features.length; i++) {
      const f = features[i];
      if (ids.has(f.id)) throw new SolidError("INVALID_PARAMS", `Operação duplicada: ${f.id}`);
      ids.add(f.id);
      if (i >= stop) {
        status.push({ id: f.id, state: "rolledback", ms: 0 });
        continue;
      }
      const ext = f.t === "combine" ? f.tools.map((t) => { const e = opts.external?.(t); return e ? `${e.sig}${e.error ? "!" : ""}` : "∅"; }).join(",") : "";
      const sig = fnv(prevSig + "|" + JSON.stringify(f) + "|" + ext);
      prevSig = sig;
      const cached = entries[i];
      let entry: Entry;
      if (cached && cached.sig === sig && valid === i) entry = cached;
      else {
        // a partir daqui tudo é recalculado (o estado de cada operação só depende das anteriores: a assinatura
        // em cadeia garante que o cache nunca guarda um 'ok' calculado sobre outra versão da árvore)
        this.releaseFrom(entries, i);
        const t0 = performance.now();
        entry = this.compute(f, i, features, entries, result, failed, opts.external, resultVol);
        entry.sig = sig;
        entry.status = { ...entry.status, ms: performance.now() - t0 };
        entries[i] = entry;
      }
      valid = i + 1;
      result = entry.result;
      resultVol = entry.vol ?? (entry.result === null ? undefined : resultVol);
      if (entry.frame) frames[f.id] = entry.frame;
      status.push(entry.status);
      // falha (própria ou de dependência) de operação que mexe no sólido quebra a cadeia: o que vier depois e
      // usar o sólido não pode ficar 'ok' (o sólido de entrada estaria desatualizado)
      const st = entry.status.state;
      if (!failed && f.t !== "sketch" && (st === "error" || st === "dependency_error")) failed = { id: f.id, name: f.name, error: entry.status.error ?? "erro" };
    }
    // entradas além do rollback continuam no cache (reaproveitadas se nada mudar antes delas)
    if (stop >= features.length) this.releaseFrom(entries, features.length);
    this.cache.set(partId, entries);
    // chapa: última operação de chapa válida e as operações sólidas genéricas que vieram depois
    let sheet = null as { state: unknown; feature: FeatId; generic: string[] } | null;
    for (let i = 0; i < Math.min(stop, features.length); i++) {
      const e = entries[i];
      const f = features[i];
      if (!e) continue;
      if (e.sheet !== undefined) sheet = { state: e.sheet, feature: f.id, generic: [] };
      else if (sheet && f.t !== "sketch" && !isSheetFeature(f) && e.status.state === "ok") sheet.generic.push(f.name);
    }
    // avisos de chapa resolvidos mais adiante no histórico (cópia do status: o cache guarda o aviso da etapa)
    const sb = this.sheetBackend;
    if (sheet && sb?.superseded)
      for (let i = 0; i < status.length; i++) {
        const e = entries[i];
        const w = status[i].warning;
        if (!w || e?.sheet === undefined || features[i].id === sheet.feature) continue;
        let left = w;
        for (const m of sb.superseded(e.sheet, sheet.state, features[i].id)) left = left.replace(m, "").trim();
        if (left !== w) {
          const { warning: _, ...rest } = status[i];
          status[i] = left ? { ...rest, warning: left.replace(/\s{2,}/g, " ") } : rest;
        }
      }
    return { shape: result, status, frames, failed, sheet };
  }

  /** Sólido no estado após a operação `index` (para editar com rollback). */
  shapeAt(partId: string, index: number): ShapeHandle | null {
    const e = this.cache.get(partId);
    if (!e || index < 0) return null;
    return e[Math.min(index, e.length - 1)]?.result ?? null;
  }

  release(partId: string) {
    const e = this.cache.get(partId);
    if (e) this.releaseFrom(e, 0);
    this.cache.delete(partId);
  }
  releaseAll() {
    for (const id of [...this.cache.keys()]) this.release(id);
  }

  private releaseFrom(entries: Entry[], from: number) {
    for (let i = entries.length - 1; i >= from; i--) {
      const e = entries[i];
      if (!e) continue;
      if (e.ownsResult && e.result !== null) this.free(e.result);
      if (e.tool !== null && e.tool !== e.result) this.free(e.tool);
    }
    entries.length = Math.min(entries.length, from);
  }
  private free(h: ShapeHandle) {
    try {
      this.k.release(h);
    } catch {
      /* já liberado */
    }
  }

  /* =========================================================================================== operações */

  private compute(
    f: Feature,
    index: number,
    features: readonly Feature[],
    entries: Entry[],
    input: ShapeHandle | null,
    broken: PartResult["failed"],
    external?: (id: string) => External | null,
    inputVol?: number,
  ): Entry {
    const pass = (state: FeatureStatus["state"], error?: string, cause?: FeatId): Entry => ({
      sig: "",
      result: input,
      ownsResult: false,
      tool: null,
      op: null,
      status: { id: f.id, state, error, cause, ms: 0 },
    });
    if (f.suppressed) return pass("suppressed");
    // operação desconhecida: arquivo de versão mais nova — preservada, nunca executada às cegas
    if (!Object.prototype.hasOwnProperty.call(FEATURE_LABEL, (f as { t: string }).t))
      return pass("error", `A operação ${f.name} (${String((f as { t: string }).t)}) é de uma versão mais nova do AGTN CAD — atualize para editar. Ela foi preservada no arquivo.`);
    let errs: string[];
    try {
      errs = validateFeature(f);
    } catch {
      errs = [`Dados da operação ${f.name} estão incompletos ou corrompidos.`];
    }
    if (errs.length) return pass("error", errs[0]);
    // dependências explícitas (esboços, faces/arestas de origem, alvos): estado delas decide antes de executar
    let refs: FeatId[] = [];
    try {
      refs = featureRefs(f);
    } catch {
      return pass("error", `Dados da operação ${f.name} estão incompletos ou corrompidos.`);
    }
    for (const rid of refs) {
      const j = features.findIndex((x) => x.id === rid);
      if (j < 0 || j >= index) continue; // inexistente/fora de ordem: a própria operação explica (erro)
      const st = entries[j]?.status;
      if (!st) continue;
      if (st.state === "suppressed") return pass("suppressed", `Suprimida junto com ${features[j].name} (da qual depende).`, rid);
      if (st.state === "error" || st.state === "dependency_error") return pass("dependency_error", `Não avaliada: depende de ${features[j].name}, que está com erro.`, rid);
    }
    if (f.t === "combine") {
      for (const t of f.tools) {
        const e = external?.(t);
        if (e?.error) return pass("dependency_error", `Não avaliada: o corpo-ferramenta está com erro (${e.error}).`);
      }
    }
    // cadeia do sólido quebrada antes: quem usa o sólido acumulado não pode ser avaliado sobre a versão velha
    const usesSolid = f.t !== "sketch" || f.plane.t === "face";
    if (broken && usesSolid) return pass("dependency_error", `Não avaliada: o sólido anterior está incompleto porque ${broken.name} falhou.`, broken.id);
    const tmp: ShapeHandle[] = [];
    const T = <H extends ShapeHandle>(h: H): H => {
      tmp.push(h);
      return h;
    };
    const keep = new Set<ShapeHandle>();
    const ctx: Ctx = { index, features, entries, input, T };
    try {
      const out = this.run(f, ctx, external);
      if (out.result !== null) keep.add(out.result);
      if (out.tool !== null) keep.add(out.tool);
      let warning: string | undefined = out.warning;
      let v: number | undefined;
      if (out.result !== null && out.result !== input) {
        if (!this.k.isValid(out.result)) throw new SolidError("KERNEL", "O resultado não é um sólido válido (geometria degenerada).");
        v = this.k.getVolume(out.result);
        if (!(v > 1e-9)) throw new SolidError("KERNEL", "O resultado não tem volume positivo (sólido invertido ou degenerado).");
        const n = this.k.getSubShapes(out.result, "solid").map(T).length;
        if (n > 1 && out.op === "join") warning = `A união resultou em ${n} sólidos separados (sem contato).`;
        if (out.op === "cut" && input !== null && Math.abs((inputVol ?? this.k.getVolume(input)) - v) <= 1e-9 * Math.max(1, v))
          warning = "O corte não removeu material — a ferramenta não toca a peça (sentido invertido?).";
      }
      return {
        sig: "",
        result: out.result,
        ownsResult: out.result !== input,
        tool: out.tool,
        op: out.op ?? null,
        frame: out.frame,
        anchor: out.anchor,
        status: { id: f.id, state: "ok", ms: 0, ...(warning ? { warning } : {}) },
        vol: v ?? inputVol,
        ...(out.sheet !== undefined ? { sheet: out.sheet } : {}),
      };
    } catch (e) {
      keep.clear();
      return pass("error", friendly(f, e));
    } finally {
      for (const h of tmp) if (!keep.has(h)) this.free(h);
    }
  }

  private run(f: Feature, c: Ctx, external?: (id: string) => External | null): Out {
    const k = this.k;
    const T = c.T;
    switch (f.t) {
      case "primitive": {
        const s = T(this.sk.primitive(f.spec, f.placement) as unknown as ShapeHandle);
        const op: BoolOp = c.input === null ? "new" : "join";
        return { result: this.apply(c.input, s, op, T), tool: s, op, anchor: { kind: "prim", spec: f.spec, placement: f.placement } };
      }
      case "sketch":
        return { result: c.input, tool: null, frame: this.frameOf(f.plane, c) };
      case "extrude": {
        const { frame, sketch } = this.sketchOf(f.sketch, c);
        const faces = this.regionFaces(sketch, frame, f.regions, T);
        // corte a partir de esboço em face entra no material (contra a normal externa); "inverter" troca o sentido
        const sk = c.features.find((x) => x.id === f.sketch);
        const intoMaterial = f.op === "cut" && sk?.t === "sketch" && sk.plane.t === "face";
        const n = f.reverse !== intoMaterial ? mul(frame.n, -1) : frame.n;
        let z0 = 0;
        let z1 = f.depth;
        if (f.through) {
          const D = this.farDistance(c.input, frame);
          [z0, z1] = f.mode === "one" ? [0, D] : [-D, D];
        } else if (f.mode === "symmetric") [z0, z1] = [-f.depth / 2, f.depth / 2];
        else if (f.mode === "two") [z0, z1] = [-f.depth2, f.depth];
        const prisms = faces.map((face) => {
          const base = z0 !== 0 ? T(k.translate(face, n.x * z0, n.y * z0, n.z * z0)) : face;
          return T(k.extrude(base, n.x * (z1 - z0), n.y * (z1 - z0), n.z * (z1 - z0)));
        });
        const tool = prisms.length === 1 ? prisms[0] : T(this.single(k.fuseAll(prisms), T));
        const anchorFrame: Frame = { ...frame, n };
        return { result: this.apply(c.input, tool, f.op, T), tool, op: f.op, anchor: { kind: "extrude", frame: anchorFrame, z0, z1, sketch } };
      }
      case "revolve": {
        const { frame, sketch } = this.sketchOf(f.sketch, c);
        const line = entityOf(sketch, f.axis);
        if (!line || line.t !== "line") throw new SolidError("INVALID_PARAMS", `O eixo de revolução (${f.axis}) não é uma linha do esboço.`);
        const a = to3d(frame, pointOf(sketch, line.p1)!);
        const b = to3d(frame, pointOf(sketch, line.p2)!);
        const faces = this.regionFaces(sketch, frame, f.regions, T, f.axis);
        const rad = (f.angle * Math.PI) / 180;
        const solids = faces.map((face) => T(k.revolve(face, { point: a, direction: unit(sub(b, a)) }, rad)));
        const tool = solids.length === 1 ? solids[0] : T(this.single(k.fuseAll(solids), T));
        if (!k.isValid(tool)) throw new SolidError("KERNEL", "O perfil cruza ou toca o eixo de revolução.");
        return { result: this.apply(c.input, tool, f.op, T), tool, op: f.op };
      }
      case "sweep": {
        const prof = this.sketchOf(f.profile, c);
        const path = this.sketchOf(f.path, c);
        const faces = this.regionFaces(prof.sketch, prof.frame, null, T);
        const chain = pathChain(path.sketch);
        const wire = T(k.makeWire(chain.segs.map((s) => T(this.edge3d(s, path.frame)))));
        const solids = faces.map((face) => T(k.pipe(face, wire)));
        const tool = solids.length === 1 ? solids[0] : T(this.single(k.fuseAll(solids), T));
        if (!k.isValid(tool) || k.getVolume(tool) <= 0) throw new SolidError("KERNEL", "A varredura gerou um sólido inválido (perfil grande demais para as curvas do caminho?).");
        return { result: this.apply(c.input, tool, f.op, T), tool, op: f.op };
      }
      case "loft": {
        const wires = f.sections.map((id) => {
          const s = this.sketchOf(id, c);
          const p = profiles(s.sketch);
          const def = defaultRegions(p);
          if (def.length !== 1) throw new SolidError("INVALID_PARAMS", `O esboço ${this.nameOf(id, c)} precisa ter exatamente um perfil fechado para o loft.`);
          const r = p.regions[def[0]];
          if (r.holes.length) throw new SolidError("INVALID_PARAMS", `O perfil do esboço ${this.nameOf(id, c)} tem furos — o loft usa só contornos simples.`);
          return T(this.wire3d(r.outer.segs, s.frame, T));
        });
        const tool = T(k.loft(wires, true, f.ruled));
        return { result: this.apply(c.input, tool, f.op, T), tool, op: f.op };
      }
      case "fillet": {
        const base = this.need(c.input, "arredondar");
        const edges = f.edges.map((e, i) => this.resolveEdge(base, e, c, `aresta ${i + 1}`));
        return { result: T(this.single(k.fillet(base, edges, f.r), T)), tool: null };
      }
      case "chamfer": {
        const base = this.need(c.input, "chanfrar");
        const edges = f.edges.map((e, i) => this.resolveEdge(base, e, c, `aresta ${i + 1}`));
        return { result: T(this.single(k.chamfer(base, edges, f.d), T)), tool: null };
      }
      case "shell": {
        const base = this.need(c.input, "fazer casca");
        const faces = f.faces.map((r, i) => this.resolveFace(base, r, c, `face ${i + 1}`));
        return { result: T(this.single(k.shell(base, faces, f.thickness, 1e-3, JoinType.Intersection), T)), tool: null };
      }
      case "hole": {
        const base = this.need(c.input, "furar");
        const { frame, sketch } = this.sketchOf(f.sketch, c);
        const centers: { x: number; y: number }[] = [];
        const centerKeys: string[] = [];
        for (const e of Object.values(sketch.entities)) {
          if (e.t === "point") centers.push(pointOf(sketch, e.p)!);
          else if (e.t === "circle" && !e.cons) centers.push(pointOf(sketch, e.c)!);
          else continue;
          centerKeys.push(e.id);
        }
        if (!centers.length) throw new SolidError("INVALID_PARAMS", "O esboço do furo não tem pontos nem círculos (centros dos furos).");
        const z = f.reverse ? frame.n : mul(frame.n, -1); // fura para dentro do material
        const x = frame.x;
        const y = cross(z, x);
        const L = f.through ? this.farDistance(base, frame) : f.depth;
        const parts: ShapeHandle[] = [];
        const anchorCenters: { key: string; o: Vec3 }[] = [];
        for (const [ci, c2] of centers.entries()) {
          const o = to3d(frame, c2);
          anchorCenters.push({ key: centerKeys[ci], o });
          const m = [x.x, y.x, z.x, o.x, x.y, y.y, z.y, o.y, x.z, y.z, z.z, o.z];
          const put = (h: ShapeHandle) => T(k.transform(T(h), m));
          parts.push(put(k.makeCylinder(f.d / 2, L)));
          if (f.cbore) parts.push(put(k.makeCylinder(f.cbore.d / 2, f.cbore.depth)));
          if (f.csink) {
            const h = (f.csink.d - f.d) / 2 / Math.tan(((f.csink.angle / 2) * Math.PI) / 180);
            parts.push(put(k.makeCone(f.csink.d / 2, f.d / 2, h)));
          }
        }
        const tool = parts.length === 1 ? parts[0] : T(this.single(k.fuseAll(parts), T));
        return { result: this.apply(base, tool, "cut", T), tool, op: "cut", anchor: { kind: "hole", z, centers: anchorCenters, d: f.d, cbore: f.cbore } };
      }
      case "mirror": {
        const base = this.need(c.input, "espelhar");
        const pl = this.frameOf(f.plane, c);
        if (f.targets === null) {
          const m = T(k.mirror(base, pl.o, pl.n));
          return { result: this.apply(base, m, "join", T), tool: m, op: "join" };
        }
        let r = base;
        for (const id of f.targets) {
          const t = this.targetEntry(id, c);
          const m = T(k.mirror(t.tool!, pl.o, pl.n));
          r = this.apply(r, m, t.op === "new" ? "join" : t.op!, T);
        }
        return { result: r, tool: null };
      }
      case "pattern": {
        const base = this.need(c.input, "repetir");
        const ax = this.axisOf(f.dir, c);
        const d = f.reverse ? mul(ax.d, -1) : ax.d;
        let r = base;
        for (const id of f.targets) {
          const t = this.targetEntry(id, c);
          const copies: ShapeHandle[] = [];
          for (let i = 1; i < f.count; i++) {
            if (f.kind === "linear") copies.push(T(k.translate(t.tool!, d.x * f.spacing * i, d.y * f.spacing * i, d.z * f.spacing * i)));
            else {
              const step = f.angle >= 360 - 1e-9 ? 360 / f.count : f.angle / (f.count - 1);
              copies.push(T(k.rotate(t.tool!, { point: ax.p, direction: d }, ((step * i) * Math.PI) / 180)));
            }
          }
          const all = copies.length === 1 ? copies[0] : T(k.makeCompound(copies));
          r = this.apply(r, all, t.op === "new" ? "join" : t.op!, T);
        }
        return { result: r, tool: null };
      }
      case "sheetBase":
      case "sheetFlange":
      case "sheetContour":
      case "sheetBendLine":
      case "sheetCut":
      case "sheetRelief":
      case "sheetCorner":
        return this.runSheet(f, c);
      case "combine": {
        const base = this.need(c.input, "combinar");
        const tools = f.tools.map((id) => {
          const e = external?.(id);
          if (!e || !e.shape) throw new SolidError("INVALID_PARAMS", "Corpo-ferramenta não encontrado no modelo (excluído?).");
          return e.shape;
        });
        const tool = tools.length === 1 ? T(k.copy(tools[0])) : T(this.single(k.fuseAll(tools), T));
        return { result: this.apply(base, tool, f.op, T), tool, op: f.op };
      }
    }
  }

  /** Operação de chapa: estado anterior + regras de encadeamento; a geometria é do backend injetado. */
  private runSheet(f: SheetFeature, c: Ctx): Out {
    if (!this.sheetBackend) throw new SolidError("INVALID_PARAMS", "O motor de chapa não está carregado neste ambiente.");
    let prev: unknown = null;
    let prevIdx = -1;
    for (let j = c.index - 1; j >= 0; j--)
      if (c.entries[j]?.sheet !== undefined) {
        prev = c.entries[j].sheet;
        prevIdx = j;
        break;
      }
    if (f.t === "sheetBase") {
      if (prev !== null) throw new SolidError("INVALID_PARAMS", "Esta peça já tem uma base de chapa (ETAPA 1: uma chapa por corpo).");
      if (c.input !== null) throw new SolidError("INVALID_PARAMS", "A base de chapa precisa ser a primeira operação sólida do corpo (ETAPA 1).");
    } else {
      if (prev === null) throw new SolidError("INVALID_PARAMS", "Crie a base de chapa antes desta operação.");
      for (let j = prevIdx + 1; j < c.index; j++) {
        const g = c.features[j];
        if (g.t === "sketch" || isSheetFeature(g) || g.suppressed) continue;
        if (c.entries[j]?.status.state === "ok")
          throw new SolidError("INVALID_PARAMS", `Depois de ${g.name} (operação sólida genérica) a peça deixou de ser só chapa — operações de chapa não podem vir depois dela (ETAPA 1).`);
      }
    }
    const r = this.sheetBackend.apply(f, { kernel: this.k, prev, sketch: (id) => this.sketchOf(id, c), T: c.T });
    return { result: r.shape, tool: null, sheet: r.state, ...(r.warning ? { warning: r.warning } : {}) };
  }

  /* =========================================================================================== auxiliares */

  private need(input: ShapeHandle | null, what: string): ShapeHandle {
    if (input === null) throw new SolidError("INVALID_PARAMS", `Não há sólido para ${what} — crie uma extrusão ou primitiva antes.`);
    return input;
  }

  private apply(input: ShapeHandle | null, tool: ShapeHandle, op: BoolOp, T: Ctx["T"]): ShapeHandle {
    const k = this.k;
    if (input === null) {
      if (op === "cut" || op === "intersect") throw new SolidError("INVALID_PARAMS", "Não há sólido para cortar/intersectar — use 'Novo sólido' na primeira operação.");
      return tool;
    }
    let r: ShapeHandle;
    if (op === "new") r = T(k.makeCompound([input, tool]));
    else if (op === "join") r = T(k.fuse(input, tool));
    else if (op === "cut") r = T(k.cut(input, tool));
    else r = T(k.common(input, tool));
    if (op !== "new") {
      // faces coplanares fundidas: topologia limpa (essencial para arredondar arestas depois)
      try {
        r = T(k.unifySameDomain(r));
      } catch {
        /* mantém sem unificar */
      }
    }
    const out = this.single(r, T);
    if (op === "intersect" || op === "cut") {
      if (k.getSubShapes(out, "solid").map(T).length === 0) throw new SolidError("BOOLEAN", op === "cut" ? "O corte removeu todo o sólido." : "A interseção é vazia — os sólidos não se sobrepõem.");
    }
    return out;
  }

  /**
   * Composto com um único sólido vira o sólido. `h` é registrado como temporário: quando a função devolve o
   * sólido interno, o composto de origem (ex.: resultado de fuseAll) era perdido sem liberar — vazamento de
   * formas OCCT a cada regeneração (auditoria A06).
   */
  private single(h: ShapeHandle, T: Ctx["T"]): ShapeHandle {
    const k = this.k;
    T(h);
    if (k.getShapeType(h) !== "compound") return h;
    const solids = k.getSubShapes(h, "solid").map(T);
    if (solids.length === 1 && k.getSubShapes(solids[0], "face").map(T).length === k.getSubShapes(h, "face").map(T).length) return solids[0];
    return h;
  }

  private nameOf(id: FeatId, c: Ctx) {
    return c.features.find((f) => f.id === id)?.name ?? id;
  }

  private sketchOf(id: FeatId, c: Ctx): { frame: Frame; sketch: Sketch } {
    const i = c.features.findIndex((f) => f.id === id);
    const f = c.features[i];
    if (!f || f.t !== "sketch") throw new SolidError("INVALID_PARAMS", "O esboço usado por esta operação foi excluído.");
    if (i >= c.index) throw new SolidError("INVALID_PARAMS", `O esboço ${f.name} vem depois desta operação na árvore.`);
    const e = c.entries[i];
    if (f.suppressed) throw new SolidError("INVALID_PARAMS", `O esboço ${f.name} está suprimido.`);
    if (!e?.frame) throw new SolidError("INVALID_PARAMS", `O esboço ${f.name} está com erro: ${e?.status.error ?? "plano não resolvido"}`);
    return { frame: e.frame, sketch: f.sketch };
  }

  private targetEntry(id: FeatId, c: Ctx): Entry {
    const i = c.features.findIndex((f) => f.id === id);
    if (i < 0) throw new SolidError("INVALID_PARAMS", "Uma operação a repetir/espelhar foi excluída.");
    if (i >= c.index) throw new SolidError("INVALID_PARAMS", "A operação a repetir/espelhar vem depois na árvore.");
    const e = c.entries[i];
    if (!e || e.status.state !== "ok" || e.tool === null || !e.op) throw new SolidError("INVALID_PARAMS", `${c.features[i].name} não pode ser repetida (sem sólido próprio ou com erro).`);
    return e;
  }

  /** Distância que atravessa qualquer coisa (para "passante"). */
  private farDistance(shape: ShapeHandle | null, frame: Frame): number {
    if (shape === null) return 10000;
    const b = this.k.getBoundingBox(shape);
    const diag = Math.hypot(b.xmax - b.xmin, b.ymax - b.ymin, b.zmax - b.zmin);
    const center = V((b.xmin + b.xmax) / 2, (b.ymin + b.ymax) / 2, (b.zmin + b.zmax) / 2);
    return diag * 2 + Math.abs(dot(sub(center, frame.o), frame.n)) + 10;
  }

  private edge3d(s: Seg2, f: Frame): ShapeHandle {
    const k = this.k;
    if (s.t === "line") return k.makeLineEdge(to3d(f, s.a), to3d(f, s.b));
    if (s.t === "circle") return k.makeCircleEdge(to3d(f, s.c), f.n, s.r);
    const a0 = Math.atan2(s.a.y - s.c.y, s.a.x - s.c.x) + s.sweep / 2;
    const mid = { x: s.c.x + s.r * Math.cos(a0), y: s.c.y + s.r * Math.sin(a0) };
    return k.makeArcEdge(to3d(f, s.a), to3d(f, mid), to3d(f, s.b));
  }
  private wire3d(segs: readonly Seg2[], f: Frame, T: Ctx["T"]): ShapeHandle {
    return this.k.makeWire(segs.map((s) => T(this.edge3d(s, f))));
  }

  /** Faces planas das regiões escolhidas do perfil (com furos). */
  private regionFaces(sketch: Sketch, frame: Frame, regions: readonly number[] | null, T: Ctx["T"], axisLine?: string): ShapeHandle[] {
    const k = this.k;
    const p = profiles(axisLine ? withoutEntity(sketch, axisLine) : sketch);
    if (!p.regions.length) throw new SolidError("INVALID_PARAMS", p.openEnds.length ? "O perfil não é fechado — há pontas soltas no esboço." : "O esboço não tem perfil fechado.");
    const sel = regions ?? defaultRegions(p);
    if (!sel.length) throw new SolidError("INVALID_PARAMS", "Nenhuma região do perfil foi escolhida.");
    return sel.map((i) => {
      const r = p.regions[i];
      if (!r) throw new SolidError("INVALID_PARAMS", `A região ${i + 1} do perfil não existe mais (o esboço mudou).`);
      let face = T(k.makeFace(T(this.wire3d(r.outer.segs, frame, T))));
      if (r.holes.length) face = T(k.addHolesInFace(face, r.holes.map((h) => T(this.wire3d(h.segs, frame, T)))));
      return face;
    });
  }

  /** Plano de um esboço/espelho. Face plana: origem = projeção da origem global; X = projeção do X global. */
  frameOf(p: PlaneRef, c: Ctx): Frame {
    if (p.t === "std") {
      const f = STD_FRAMES[p.plane];
      return { ...f, o: mul(f.n, p.offset) };
    }
    const base = this.need(c.input, "esboçar sobre face");
    const face = this.resolveFace(base, p.face, c, "face do esboço");
    if (this.k.surfaceType(face) !== "plane") throw new SolidError("INVALID_PARAMS", "Esboço só em face plana.");
    const sd = this.k.surfaceData(face) as unknown as { normal: Vec3; location: Vec3 };
    let n = unit(vec(sd.normal));
    if (this.k.shapeOrientation(face) === "reversed") n = mul(n, -1);
    const loc = vec(sd.location);
    const o0 = sub(V(0, 0, 0), mul(n, dot(sub(V(0, 0, 0), loc), n)));
    const ref = Math.abs(n.x) > 0.9 ? V(0, 1, 0) : V(1, 0, 0);
    const x = unit(sub(ref, mul(n, dot(ref, n))));
    const y = cross(n, x);
    return { o: add(o0, mul(n, p.offset)), x, y, n };
  }

  private axisOf(a: AxisRef, c: Ctx): { p: Vec3; d: Vec3 } {
    if (a.t === "axis") return { p: V(0, 0, 0), d: a.a === "X" ? V(1, 0, 0) : a.a === "Y" ? V(0, 1, 0) : V(0, 0, 1) };
    if (a.t === "sketchLine") {
      const { frame, sketch } = this.sketchOf(a.sketch, c);
      const l = entityOf(sketch, a.line);
      if (!l || l.t !== "line") throw new SolidError("INVALID_PARAMS", "A linha de direção não existe mais no esboço.");
      const p = to3d(frame, pointOf(sketch, l.p1)!);
      return { p, d: unit(sub(to3d(frame, pointOf(sketch, l.p2)!), p)) };
    }
    const base = this.need(c.input, "usar eixo");
    if (a.t === "edge") {
      const e = this.resolveEdge(base, a.edge, c, "aresta de direção");
      const cd = this.k.curveData(e) as unknown as { kind: string; point?: Vec3; direction?: Vec3; center?: Vec3; axis?: Vec3 };
      if (cd.kind === "line") return { p: vec(cd.point!), d: unit(vec(cd.direction!)) };
      if (cd.kind === "circle") return { p: vec(cd.center!), d: unit(vec(cd.axis!)) };
      throw new SolidError("INVALID_PARAMS", "A aresta de direção precisa ser reta ou circular.");
    }
    const f = this.resolveFace(base, a.face, c, "face do eixo");
    const sd = this.k.surfaceData(f) as unknown as { kind: string; axis?: Vec3; location?: Vec3 };
    if (!sd.axis) throw new SolidError("INVALID_PARAMS", "A face escolhida não tem eixo (use cilindro/cone).");
    return { p: vec(sd.location!), d: unit(vec(sd.axis)) };
  }

  /* ======================================================================== referências topológicas */

  private scaleOf(shape: ShapeHandle): number {
    const b = this.k.getBoundingBox(shape);
    return Math.max(1, Math.hypot(b.xmax - b.xmin, b.ymax - b.ymin, b.zmax - b.zmin));
  }

  /** Descritor da superfície esperada para uma referência de face. */
  private descOf(ref: FaceRef, c: Ctx): Desc {
    if (ref.t === "seed") {
      if (ref.surf === "plane" && ref.n) return { kind: "plane", p: ref.p, n: ref.n };
      if (ref.surf === "cylinder" && ref.axis && ref.r) return { kind: "cyl", p: ref.p, axis: ref.axis, r: ref.r };
      return { kind: "point", p: ref.p };
    }
    const i = c.features.findIndex((f) => f.id === ref.feat);
    const src = c.features[i];
    const e = c.entries[i];
    if (!src || i >= c.index) throw new SolidError("INVALID_PARAMS", "A operação que gerou a face referenciada não existe mais.");
    if (!e?.anchor || e.status.state !== "ok") throw new SolidError("INVALID_PARAMS", `A operação de origem (${src.name}) está com erro ou suprimida.`);
    const a = e.anchor;
    if (a.kind === "extrude") {
      const F = a.frame;
      if (ref.role === "start" || ref.role === "end") return { kind: "plane", p: add(F.o, mul(F.n, ref.role === "start" ? a.z0 : a.z1)), n: F.n };
      const ent = entityOf(a.sketch, ref.key);
      if (!ent || ent.t === "point") throw new SolidError("INVALID_PARAMS", `Referência perdida: a curva ${ref.key} do esboço de ${src.name} foi apagada — a face lateral deixou de existir.`);
      const zm = (a.z0 + a.z1) / 2;
      if (ent.t === "line") {
        const p1 = to3d(F, pointOf(a.sketch, ent.p1)!);
        const p2 = to3d(F, pointOf(a.sketch, ent.p2)!);
        return { kind: "plane", p: add(mul(add(p1, p2), 0.5), mul(F.n, zm)), n: unit(cross(F.n, sub(p2, p1))) };
      }
      const cc = to3d(F, pointOf(a.sketch, ent.c)!);
      const r = ent.t === "circle" ? ent.r : Math.hypot(pointOf(a.sketch, ent.p1)!.x - pointOf(a.sketch, ent.c)!.x, pointOf(a.sketch, ent.p1)!.y - pointOf(a.sketch, ent.c)!.y);
      return { kind: "cyl", p: add(cc, mul(F.n, zm)), axis: F.n, r };
    }
    if (a.kind === "hole") {
      const [ckey, part] = ref.key.split(":");
      const c0 = a.centers.find((c) => c.key === ckey);
      if (ref.role !== "hole" || !c0) throw new SolidError("INVALID_PARAMS", `Referência perdida: o centro ${ckey} do furo ${src.name} foi apagado.`);
      if (!part) return { kind: "cyl", p: c0.o, axis: a.z, r: a.d / 2 };
      if (!a.cbore) throw new SolidError("INVALID_PARAMS", `Referência perdida: o rebaixo do furo ${src.name} foi retirado.`);
      if (part === "cb") return { kind: "cyl", p: c0.o, axis: a.z, r: a.cbore.d / 2 };
      return { kind: "plane", p: add(c0.o, mul(a.z, a.cbore.depth)), n: a.z };
    }
    const m = placementMatrix(a.placement);
    const P = (x: number, y: number, z: number) => V(m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]);
    const D = (x: number, y: number, z: number) => unit(V(m[0] * x + m[1] * y + m[2] * z, m[4] * x + m[5] * y + m[6] * z, m[8] * x + m[9] * y + m[10] * z));
    const s = a.spec;
    if (s.kind === "box") {
      const map: Record<string, [Vec3, Vec3]> = {
        "+X": [P(s.w, s.d / 2, s.h / 2), D(1, 0, 0)],
        "-X": [P(0, s.d / 2, s.h / 2), D(-1, 0, 0)],
        "+Y": [P(s.w / 2, s.d, s.h / 2), D(0, 1, 0)],
        "-Y": [P(s.w / 2, 0, s.h / 2), D(0, -1, 0)],
        "+Z": [P(s.w / 2, s.d / 2, s.h), D(0, 0, 1)],
        "-Z": [P(s.w / 2, s.d / 2, 0), D(0, 0, -1)],
      };
      const hit = map[ref.key];
      if (hit) return { kind: "plane", p: hit[0], n: hit[1] };
    }
    if (s.kind === "cylinder" || s.kind === "tube") {
      const h = s.h;
      const R = s.kind === "cylinder" ? s.r : s.od / 2;
      if (ref.key === "top") return { kind: "plane", p: P(0, 0, h), n: D(0, 0, 1) };
      if (ref.key === "bottom") return { kind: "plane", p: P(0, 0, 0), n: D(0, 0, -1) };
      if (ref.key === "side") return { kind: "cyl", p: P(0, 0, h / 2), axis: D(0, 0, 1), r: R };
      if (ref.key === "inner" && s.kind === "tube") return { kind: "cyl", p: P(0, 0, h / 2), axis: D(0, 0, 1), r: R - s.t };
    }
    return { kind: "point", p: ref.seed };
  }

  /** Lista de âncoras candidatas (para identificar uma face escolhida pelo usuário). */
  private anchorsOf(c: Ctx): FaceRef[] {
    const out: FaceRef[] = [];
    for (let i = c.index - 1; i >= 0; i--) {
      const e = c.entries[i];
      const f = c.features[i];
      if (!e?.anchor || e.status.state !== "ok") continue;
      const a = e.anchor;
      const seed = V(0, 0, 0);
      if (a.kind === "extrude") {
        out.push({ t: "anchor", feat: f.id, role: "end", key: "", seed }, { t: "anchor", feat: f.id, role: "start", key: "", seed });
        for (const ent of Object.values(a.sketch.entities)) if (!ent.cons && ent.t !== "point") out.push({ t: "anchor", feat: f.id, role: "side", key: ent.id, seed });
      } else if (a.kind === "hole") {
        for (const c0 of a.centers) {
          out.push({ t: "anchor", feat: f.id, role: "hole", key: c0.key, seed });
          if (a.cbore) out.push({ t: "anchor", feat: f.id, role: "hole", key: `${c0.key}:cb`, seed }, { t: "anchor", feat: f.id, role: "hole", key: `${c0.key}:cbf`, seed });
        }
      } else {
        const keys = a.spec.kind === "box" ? ["+X", "-X", "+Y", "-Y", "+Z", "-Z"] : a.spec.kind === "cylinder" ? ["top", "bottom", "side"] : a.spec.kind === "tube" ? ["top", "bottom", "side", "inner"] : [];
        for (const key of keys) out.push({ t: "anchor", feat: f.id, role: "prim", key, seed });
      }
    }
    return out;
  }

  private matches(face: ShapeHandle, d: Desc, tol: number): boolean {
    const k = this.k;
    if (d.kind === "point") return true;
    const type = k.surfaceType(face);
    if (d.kind === "plane") {
      if (type !== "plane") return false;
      const sd = k.surfaceData(face) as unknown as { normal: Vec3; location: Vec3 };
      const n = unit(vec(sd.normal));
      if (Math.abs(Math.abs(dot(n, unit(d.n))) - 1) > 1e-7) return false;
      return Math.abs(dot(sub(vec(sd.location), d.p), n)) < tol;
    }
    if (type !== "cylinder") return false;
    const sd = k.surfaceData(face) as unknown as { axis: Vec3; location: Vec3; radius: number };
    const ax = unit(vec(sd.axis));
    if (Math.abs(Math.abs(dot(ax, unit(d.axis))) - 1) > 1e-7) return false;
    if (Math.abs(sd.radius - d.r) > tol) return false;
    const w = sub(vec(sd.location), d.p);
    return len(sub(w, mul(ax, dot(w, ax)))) < tol;
  }

  private distTo(shape: ShapeHandle, p: Vec3, T?: Ctx["T"]): number {
    const v = this.k.makeVertex(p.x, p.y, p.z);
    T?.(v);
    const d = this.k.distanceBetween(v, shape);
    if (!T) this.free(v);
    return d;
  }

  /** Um ponto garantidamente DENTRO da face (centro do domínio UV, senão uma grade 5×5). */
  private interiorPoint(face: ShapeHandle): Vec3 | null {
    const k = this.k;
    const b = k.uvBounds(face);
    const tries: [number, number][] = [[0.5, 0.5]];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) tries.push([(i + 0.5) / 5, (j + 0.5) / 5]);
    for (const [fu, fv] of tries) {
      const u = b.uMin + (b.uMax - b.uMin) * fu;
      const v = b.vMin + (b.vMax - b.vMin) * fv;
      if (k.classifyPointOnFace(face, u, v) === "in") return vec(k.pointOnSurface(face, u, v));
    }
    return null;
  }

  /**
   * Resolve uma referência de face no sólido — sem "a mais parecida":
   * 1. faces cuja superfície coincide com a esperada (plano/cilindro recalculado com os parâmetros atuais);
   * 2. âncora com sólido próprio: só faces que estão na fronteira do sólido daquela operação (a face nasceu dela);
   * 3. ainda mais de uma: vale a que contém o ponto-semente; nenhuma ou várias → erro de referência ambígua.
   * Nenhuma candidata → "Referência perdida". Determinístico (não depende da ordem do OCCT).
   */
  resolveFace(shape: ShapeHandle, ref: FaceRef, c: Ctx, what: string): ShapeHandle {
    const tol = 1e-6 * this.scaleOf(shape) + 1e-7;
    const d = this.descOf(ref, c);
    const faces = this.k.getSubShapes(shape, "face").map(c.T);
    let cand = faces.filter((f) => this.matches(f, d, tol));
    const seed = ref.t === "anchor" ? ref.seed : ref.p;
    if (d.kind === "point") cand = cand.filter((f) => this.distTo(f, seed, c.T) < tol * 100);
    if (!cand.length) throw new SolidError("INVALID_PARAMS", `Referência perdida: a ${what} (${describeRef(ref, c)}) não existe mais no sólido.`);
    if (cand.length > 1 && ref.t === "anchor") {
      const i = c.features.findIndex((f) => f.id === ref.feat);
      const tool = c.entries[i]?.tool ?? null;
      if (tool !== null) {
        const own = cand.filter((f) => {
          const p = this.interiorPoint(f);
          return p !== null && this.distTo(tool, p, c.T) < tol * 10;
        });
        if (own.length) cand = own;
      }
    }
    if (cand.length === 1) return cand[0];
    const onSeed = cand.filter((f) => this.distTo(f, seed, c.T) < tol * 10);
    if (onSeed.length === 1) return onSeed[0];
    throw new SolidError("INVALID_PARAMS", `Referência ambígua: ${cand.length} faces servem para a ${what} (${describeRef(ref, c)}) — escolha de novo para não usar a face errada.`);
  }

  resolveEdge(shape: ShapeHandle, ref: EdgeRef, c: Ctx, what: string): ShapeHandle {
    const fa = this.resolveFace(shape, ref.a, c, `${what} (1ª face)`);
    const fb = this.resolveFace(shape, ref.b, c, `${what} (2ª face)`);
    const shared = this.k.sharedEdges(fa, fb).map(c.T);
    if (!shared.length) throw new SolidError("INVALID_PARAMS", `Referência perdida: a ${what} deixou de existir (as faces vizinhas não se encontram mais).`);
    if (shared.length === 1) return shared[0];
    const tol = 1e-6 * this.scaleOf(shape) + 1e-7;
    const onSeed = shared.filter((e) => this.distTo(e, ref.seed, c.T) < tol * 10);
    if (onSeed.length === 1) return onSeed[0];
    throw new SolidError("INVALID_PARAMS", `Referência ambígua: as faces vizinhas da ${what} se encontram em ${shared.length} arestas — escolha de novo.`);
  }

  /* ======================================================================== identificação (seleção da interface) */

  /** Contexto de identificação no estado após a operação `atIndex` (ou o final). */
  private identCtx(partId: string, features: readonly Feature[], atIndex: number): { c: Ctx; shape: ShapeHandle; done: () => void } {
    const entries = this.cache.get(partId);
    if (!entries) throw new SolidError("NOT_READY", "Peça ainda não avaliada.");
    const idx = Math.min(atIndex, entries.length - 1);
    const shape = entries[idx]?.result;
    if (shape === null || shape === undefined) throw new SolidError("INVALID_PARAMS", "Não há sólido neste ponto da árvore.");
    const tmp: ShapeHandle[] = [];
    const c: Ctx = { index: idx + 1, features, entries, input: shape, T: (h) => (tmp.push(h), h) };
    return { c, shape, done: () => tmp.forEach((h) => this.free(h)) };
  }

  /** Referência estável para a face nº `faceIndex` do sólido (após a operação `atIndex`). */
  identifyFace(partId: string, features: readonly Feature[], atIndex: number, faceIndex: number): FaceRef {
    const { c, shape, done } = this.identCtx(partId, features, atIndex);
    try {
      const faces = this.k.getSubShapes(shape, "face").map(c.T);
      const face = faces[faceIndex];
      if (face === undefined) throw new SolidError("INVALID_PARAMS", "Face não encontrada.");
      return this.faceRefFor(shape, face, c);
    } finally {
      done();
    }
  }

  private faceRefFor(shape: ShapeHandle, face: ShapeHandle, c: Ctx): FaceRef {
    const k = this.k;
    // ponto-semente DENTRO da face (o centro de massa de um cilindro fica no eixo — fora da face)
    const center = this.interiorPoint(face) ?? vec(k.getSurfaceCenterOfMass(face));
    for (const a of this.anchorsOf(c)) {
      const ref = { ...a, seed: center } as FaceRef;
      try {
        if (k.isSame(this.resolveFace(shape, ref, c, "face"), face)) return ref;
      } catch {
        /* próxima âncora */
      }
    }
    const type = k.surfaceType(face);
    const sd = k.surfaceData(face) as unknown as { normal?: Vec3; axis?: Vec3; location?: Vec3; radius?: number };
    if (type === "plane") return { t: "seed", surf: "plane", p: center, n: unit(vec(sd.normal!)) };
    if (type === "cylinder") return { t: "seed", surf: "cylinder", p: vec(sd.location!), axis: unit(vec(sd.axis!)), r: sd.radius! };
    return { t: "seed", surf: String(type), p: center };
  }

  identifyEdge(partId: string, features: readonly Feature[], atIndex: number, edgeIndex: number): EdgeRef {
    const { c, shape, done } = this.identCtx(partId, features, atIndex);
    const k = this.k;
    try {
      const edge = k.getSubShapes(shape, "edge").map(c.T)[edgeIndex];
      if (edge === undefined) throw new SolidError("INVALID_PARAMS", "Aresta não encontrada.");
      const faces = k.getSubShapes(shape, "face").map(c.T);
      const adj = faces.filter((f) => k.getSubShapes(f, "edge").map(c.T).some((e) => k.isSame(e, edge)));
      if (adj.length !== 2) throw new SolidError("INVALID_PARAMS", adj.length < 2 ? "Aresta de costura (uma face só) não pode ser escolhida." : "Aresta não-manifold — não pode ser escolhida.");
      const cd = k.curveData(edge) as unknown as { first: number; last: number };
      const seed = vec(k.curvePointAtParam(edge, (cd.first + cd.last) / 2));
      const ref: EdgeRef = { a: this.faceRefFor(shape, adj[0], c), b: this.faceRefFor(shape, adj[1], c), seed };
      if (!k.isSame(this.resolveEdge(shape, ref, c, "aresta"), edge)) throw new SolidError("INVALID_PARAMS", "Não foi possível referenciar esta aresta de forma estável.");
      return ref;
    } finally {
      done();
    }
  }
}

interface Ctx {
  readonly index: number;
  readonly features: readonly Feature[];
  readonly entries: readonly Entry[];
  readonly input: ShapeHandle | null;
  readonly T: <H extends ShapeHandle>(h: H) => H;
}
interface Out {
  result: ShapeHandle | null;
  tool: ShapeHandle | null;
  op?: BoolOp;
  frame?: Frame;
  anchor?: Anchor;
  sheet?: unknown;
  warning?: string;
}

function withoutEntity(s: Sketch, id: string): Sketch {
  if (!s.entities[id]) return s;
  const entities = { ...s.entities };
  delete entities[id];
  return { ...s, entities };
}

function describeRef(ref: FaceRef, c: Ctx): string {
  if (ref.t === "seed") return ref.surf === "plane" ? "face plana" : ref.surf === "cylinder" ? `face cilíndrica R${Math.round((ref.r ?? 0) * 1000) / 1000}` : "face";
  const name = c.features.find((f) => f.id === ref.feat)?.name ?? "operação apagada";
  const role = ref.role === "end" ? "topo" : ref.role === "start" ? "base" : ref.role === "side" ? `lateral de ${ref.key}` : ref.role === "hole" ? `parede do furo ${ref.key}` : `face ${ref.key}`;
  return `${role} de ${name}`;
}

/** Mensagens claras para falhas do kernel, por operação. */
function friendly(f: Feature, e: unknown): string {
  if (e instanceof SolidError && e.code === "INVALID_PARAMS") return e.message;
  const raw = e instanceof Error ? e.message : String(e);
  const hint: Partial<Record<Feature["t"], string>> = {
    fillet: "Arredondamento falhou — raio grande demais para as arestas/faces vizinhas?",
    chamfer: "Chanfro falhou — distância maior que as faces vizinhas?",
    shell: "Casca falhou — espessura grande demais para a peça ou faces incompatíveis?",
    sweep: "Varredura falhou — o perfil precisa estar no início do caminho e caber nas curvas.",
    loft: "Loft falhou — os perfis precisam ser compatíveis (mesmo sentido, sem cruzar).",
    revolve: "Revolução falhou — o perfil não pode cruzar o eixo.",
  };
  if (e instanceof SolidError && e.code === "BOOLEAN") return e.message;
  return hint[f.t] ?? `${f.name}: o motor geométrico não conseguiu executar (${raw.split("\n")[0].slice(0, 160)}).`;
}

export type { SolidRef };
