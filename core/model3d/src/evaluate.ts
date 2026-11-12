import type { SolidKernel, SolidRef } from "@agtn/solid";
import { type BodyNode, type Model3D, bodies, worldMatrix } from "./model";
import { base64ToBytes } from "./persist";

/** Assinatura da geometria de um corpo no mundo: muda ⇔ o sólido precisa ser regenerado. */
export function bodySignature(m: Model3D, b: BodyNode): string {
  const src = b.source.type === "primitive" ? JSON.stringify(b.source.spec) : `brep:${b.source.data.length}:${fnv(b.source.data)}`;
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

/** Gera o sólido de um corpo já posicionado no mundo. Quem chama libera com `kernel.release`. */
export function buildBody(k: SolidKernel, m: Model3D, b: BodyNode): SolidRef {
  const local = b.source.type === "primitive" ? k.primitive(b.source.spec) : k.fromBrep(base64ToBytes(b.source.data));
  try {
    return k.transform(local, worldMatrix(m, b.id));
  } finally {
    k.release(local);
  }
}

/**
 * Cache de sólidos por corpo: regenera só o que mudou (assinatura), libera o que saiu do modelo.
 * Usado no worker do viewport e nos testes de persistência.
 */
export class BodyCache {
  private readonly items = new Map<string, { sig: string; ref: SolidRef }>();
  constructor(private readonly k: SolidKernel) {}

  /** Sincroniza com o modelo. Retorna ids regenerados, removidos e erros por corpo. */
  sync(m: Model3D): { built: string[]; removed: string[]; errors: Record<string, string> } {
    const built: string[] = [];
    const removed: string[] = [];
    const errors: Record<string, string> = {};
    const alive = new Set<string>();
    for (const b of bodies(m)) {
      alive.add(b.id);
      const sig = bodySignature(m, b);
      const cur = this.items.get(b.id);
      if (cur?.sig === sig) continue;
      try {
        const ref = buildBody(this.k, m, b);
        if (cur) this.k.release(cur.ref);
        this.items.set(b.id, { sig, ref });
        built.push(b.id);
      } catch (e) {
        errors[b.id] = (e as Error).message;
        if (cur) {
          this.k.release(cur.ref);
          this.items.delete(b.id);
          removed.push(b.id);
        }
      }
    }
    for (const [id, it] of this.items) {
      if (alive.has(id)) continue;
      this.k.release(it.ref);
      this.items.delete(id);
      removed.push(id);
    }
    return { built, removed, errors };
  }

  get(id: string): SolidRef | undefined {
    return this.items.get(id)?.ref;
  }
  ids(): string[] {
    return [...this.items.keys()];
  }
  clear(): void {
    for (const it of this.items.values()) this.k.release(it.ref);
    this.items.clear();
  }
}
