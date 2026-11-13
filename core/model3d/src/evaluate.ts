import { type FeatureStatus, type Frame, type PartEvaluator, type PartResult, type SolidKernel, type SolidRef, invertRigid } from "@agtn/solid";
import { type BodyNode, type Model3D, type NodeId, bodies, worldMatrix } from "./model";
import { base64ToBytes } from "./persist";

/** Assinatura da geometria de um corpo no mundo: muda ⇔ o sólido precisa ser regenerado. */
export function bodySignature(m: Model3D, b: BodyNode, toolSig: (id: NodeId) => string = () => ""): string {
  const s = b.source;
  const src =
    s.type === "primitive"
      ? JSON.stringify(s.spec)
      : s.type === "brep"
        ? `brep:${s.data.length}:${fnv(s.data)}`
        : `part:${fnv(JSON.stringify(s.features))}:${s.rollback ?? "-"}:${combineTools(b).map(toolSig).join(",")}`;
  return `${src}|${worldMatrix(m, b.id).map((v) => v.toPrecision(15)).join(",")}`;
}

/** FNV-1a 32 bits (assinatura rápida de dados longos). */
export function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Corpos usados como ferramenta por operações "combinar" da peça. */
export function combineTools(b: BodyNode): NodeId[] {
  if (b.source.type !== "part") return [];
  const out: NodeId[] = [];
  b.source.features.forEach((f, i) => {
    if (f.t === "combine" && !f.suppressed && (b.source.type !== "part" || b.source.rollback === null || i < b.source.rollback)) out.push(...f.tools);
  });
  return out;
}

/** Gera o sólido de um corpo NÃO paramétrico já posicionado no mundo. */
export function buildBody(k: SolidKernel, m: Model3D, b: BodyNode): SolidRef {
  if (b.source.type === "part") throw new Error("Peça paramétrica: use BodyCache com PartEvaluator.");
  const local = b.source.type === "primitive" ? k.primitive(b.source.spec) : k.fromBrep(base64ToBytes(b.source.data));
  try {
    return k.transform(local, worldMatrix(m, b.id));
  } finally {
    k.release(local);
  }
}

export interface SyncReport {
  built: NodeId[];
  removed: NodeId[];
  errors: Record<NodeId, string>;
  /** estado de cada operação das peças paramétricas regeneradas */
  features: Record<NodeId, readonly FeatureStatus[]>;
  /** planos dos esboços (coordenadas LOCAIS da peça) */
  frames: Record<NodeId, Readonly<Record<string, Frame>>>;
  /** peças que ainda não têm sólido (só esboços) */
  empty: NodeId[];
  /** peças com operação falhando: o sólido exibido é o último válido, ANTES desta operação */
  partial: Record<NodeId, { readonly id: string; readonly name: string; readonly error: string }>;
  /** peças de chapa regeneradas: estado do grafo (planificação, proveniência) e operações genéricas depois */
  sheets: Record<NodeId, NonNullable<PartResult["sheet"]>>;
}

/**
 * Cache de sólidos por corpo: regenera só o que mudou (assinatura), libera o que saiu do modelo.
 * Peças paramétricas passam pelo `PartEvaluator` (cache por operação). "Combinar" é avaliado depois dos
 * corpos-ferramenta (ordem topológica); ciclo → erro.
 */
export class BodyCache {
  private readonly items = new Map<string, { sig: string; ref: SolidRef }>();
  private readonly status = new Map<NodeId, readonly FeatureStatus[]>();
  private readonly degraded = new Map<NodeId, { id: string; name: string; error: string }>();
  private readonly sheet = new Map<NodeId, NonNullable<PartResult["sheet"]>>();
  constructor(
    private readonly k: SolidKernel,
    readonly parts: PartEvaluator | null = null,
  ) {}

  sync(m: Model3D): SyncReport {
    const rep: SyncReport = { built: [], removed: [], errors: {}, features: {}, frames: {}, empty: [], partial: {}, sheets: {} };
    const all = bodies(m);
    const byId = new Map(all.map((b) => [b.id, b]));
    // ordem: ferramentas antes de quem as combina
    const order: BodyNode[] = [];
    const state = new Map<NodeId, 0 | 1 | 2>();
    const cyc = new Set<NodeId>();
    const visit = (b: BodyNode) => {
      const st = state.get(b.id);
      if (st === 2) return;
      if (st === 1) {
        cyc.add(b.id);
        return;
      }
      state.set(b.id, 1);
      for (const t of combineTools(b)) {
        const tb = byId.get(t);
        if (tb) visit(tb);
      }
      state.set(b.id, 2);
      order.push(b);
    };
    all.forEach(visit);
    const sigs = new Map<NodeId, string>();
    const alive = new Set<string>();
    for (const b of order) {
      alive.add(b.id);
      if (cyc.has(b.id)) {
        rep.errors[b.id] = "Dependência circular entre corpos (um combina o outro).";
        this.drop(b.id, rep);
        continue;
      }
      const sig = bodySignature(m, b, (id) => sigs.get(id) ?? "∅");
      sigs.set(b.id, sig);
      const cur = this.items.get(b.id);
      if (cur?.sig === sig) continue;
      try {
        let ref: SolidRef | null;
        if (b.source.type === "part") ref = this.buildPart(m, b, rep, byId);
        else ref = buildBody(this.k, m, b);
        if (cur) this.k.release(cur.ref);
        if (ref === null) {
          this.items.delete(b.id);
          rep.empty.push(b.id);
          if (cur) rep.removed.push(b.id);
          continue;
        }
        this.items.set(b.id, { sig, ref });
        rep.built.push(b.id);
      } catch (e) {
        rep.errors[b.id] = (e as Error).message;
        this.degraded.delete(b.id);
        this.drop(b.id, rep);
      }
    }
    // estado "parcial" vale também para peças que não precisaram regenerar neste ciclo
    for (const [id, f] of this.degraded) if (byId.has(id)) rep.partial[id] = f;
    for (const [id, it] of this.items) {
      if (alive.has(id)) continue;
      this.k.release(it.ref);
      this.items.delete(id);
      this.parts?.release(id);
      this.status.delete(id);
      this.degraded.delete(id);
      this.sheet.delete(id);
      rep.removed.push(id);
    }
    return rep;
  }

  private drop(id: NodeId, rep: SyncReport) {
    const cur = this.items.get(id);
    if (!cur) return;
    this.k.release(cur.ref);
    this.items.delete(id);
    rep.removed.push(id);
  }

  private buildPart(m: Model3D, b: BodyNode, rep: SyncReport, byId: ReadonlyMap<NodeId, BodyNode>): SolidRef | null {
    if (b.source.type !== "part") return null;
    if (!this.parts) throw new Error("Avaliador de peças indisponível.");
    const world = worldMatrix(m, b.id);
    const inv = invertRigid(world);
    const tmp: SolidRef[] = [];
    try {
      const res = this.parts.evaluate(b.id, b.source.features, {
        rollback: b.source.rollback,
        external: (id) => {
          const tb = byId.get(id);
          if (!tb) return null; // excluído do modelo: erro da própria combinação
          const bad = this.degraded.get(id);
          const t = this.items.get(id);
          // ferramenta com erro: NÃO usa o último sólido válido dela (estaria desatualizado)
          if (bad) return { sig: t?.sig ?? "∅", shape: null, error: `${tb.name} › ${bad.name} falhou` };
          if (!t) return { sig: "∅", shape: null, error: rep.errors[id] ? `${tb.name}: ${rep.errors[id]}` : `${tb.name} não tem sólido` };
          const local = this.k.transform(t.ref, inv);
          tmp.push(local);
          return { sig: t.sig, shape: local as unknown as never };
        },
      });
      rep.features[b.id] = res.status;
      rep.frames[b.id] = res.frames;
      this.status.set(b.id, res.status);
      if (res.failed) this.degraded.set(b.id, res.failed);
      else this.degraded.delete(b.id);
      if (res.sheet) {
        this.sheet.set(b.id, res.sheet);
        rep.sheets[b.id] = res.sheet;
      } else this.sheet.delete(b.id);
      if (res.shape === null) return null;
      return this.k.transform(res.shape as unknown as SolidRef, world);
    } finally {
      for (const t of tmp) this.k.release(t);
    }
  }

  get(id: string): SolidRef | undefined {
    return this.items.get(id)?.ref;
  }
  /** peça com operação falhando (o sólido em cache é o último válido) */
  partialOf(id: NodeId): { id: string; name: string; error: string } | undefined {
    return this.degraded.get(id);
  }
  /** peça de chapa: estado do grafo da última regeneração (null se não é chapa) */
  sheetOf(id: NodeId): NonNullable<PartResult["sheet"]> | undefined {
    return this.sheet.get(id);
  }
  featureStatus(id: NodeId): readonly FeatureStatus[] | undefined {
    return this.status.get(id);
  }
  ids(): string[] {
    return [...this.items.keys()];
  }
  clear(): void {
    for (const it of this.items.values()) this.k.release(it.ref);
    this.items.clear();
    this.parts?.releaseAll();
    this.status.clear();
    this.degraded.clear();
    this.sheet.clear();
  }
}
