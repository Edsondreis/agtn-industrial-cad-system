import { invoke } from "@tauri-apps/api/core";
import type { Model3D } from "@agtn/model3d";
import { isTauri } from "../platform/platform";
import type { EngineApi, EngineOp, EngineRequest, EngineResponse, SyncResult } from "./protocol";

export class EngineError extends Error {
  constructor(message: string, readonly details: readonly string[] = []) {
    super(message);
  }
}

/** Lê o binário do motor: recurso do instalador (Tauri) ou middleware do Vite (navegador). */
async function loadWasm(): Promise<ArrayBuffer> {
  if (isTauri()) return invoke<ArrayBuffer>("read_engine", { name: "occt-wasm.wasm" });
  const r = await fetch("/__engine/occt-wasm.wasm");
  if (!r.ok) throw new EngineError(`Motor 3D não encontrado (${r.status}).`);
  return r.arrayBuffer();
}

/**
 * Cliente do worker do motor 3D. Uma instância por aplicação (lazy). Pedidos são enfileirados no worker;
 * `sync` é coalescido: se o modelo mudar várias vezes enquanto um sync roda, só o último é enviado.
 */
export class Engine {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
  private ready: Promise<{ kernel: string; ms: number }> | null = null;
  private syncing = false;
  private nextModel: Model3D | null = null;
  private nextFull = false;
  private nextWaiters: { ok: (v: SyncResult | null) => void; fail: (e: Error) => void }[] = [];
  initMs = 0;
  wasmBytesOnDisk = 0;

  start(): Promise<{ kernel: string; ms: number }> {
    if (!this.ready) {
      this.ready = (async () => {
        const t0 = performance.now();
        const wasm = await loadWasm();
        this.wasmBytesOnDisk = wasm.byteLength;
        this.worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module", name: "agtn-motor-3d" });
        this.worker.onmessage = (ev: MessageEvent<EngineResponse>) => this.onMessage(ev.data);
        this.worker.onerror = (ev) => {
          for (const p of this.pending.values()) p.fail(new EngineError(`Falha no motor 3D: ${ev.message}`));
          this.pending.clear();
        };
        const r = await this.raw("init", { wasm }, [wasm]);
        this.initMs = performance.now() - t0;
        return r;
      })();
      this.ready.catch(() => {
        this.ready = null;
      });
    }
    return this.ready;
  }

  private onMessage(m: EngineResponse) {
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    if (m.ok) p.ok(m.result);
    else p.fail(new EngineError(m.error, m.details ?? []));
  }

  private raw<K extends EngineOp>(op: K, args: Parameters<EngineApi[K]>[0], transfer: Transferable[] = []): Promise<ReturnType<EngineApi[K]>> {
    const w = this.worker;
    if (!w) return Promise.reject(new EngineError("Motor 3D não iniciado."));
    const id = ++this.seq;
    const req: EngineRequest<K> = { id, op, args };
    return new Promise((ok, fail) => {
      this.pending.set(id, { ok: ok as (v: unknown) => void, fail });
      w.postMessage(req, transfer);
    });
  }

  async call<K extends Exclude<EngineOp, "init" | "sync">>(op: K, args: Parameters<EngineApi[K]>[0]): Promise<ReturnType<EngineApi[K]>> {
    await this.start();
    return this.raw(op, args);
  }

  /** Sincroniza o modelo. Resolve com o resultado, ou `null` se foi substituído por um modelo mais novo. */
  sync(model: Model3D, full = false): Promise<SyncResult | null> {
    return new Promise((ok, fail) => {
      this.nextFull ||= full;
      for (const w of this.nextWaiters) w.ok(null);
      this.nextWaiters = [{ ok, fail }];
      this.nextModel = model;
      void this.pump();
    });
  }

  private async pump() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      await this.start();
      while (this.nextModel) {
        const model = this.nextModel;
        const waiters = this.nextWaiters;
        const full = this.nextFull;
        this.nextFull = false;
        this.nextModel = null;
        this.nextWaiters = [];
        try {
          const r = await this.raw("sync", { model, full });
          for (const w of waiters) w.ok(r);
        } catch (e) {
          for (const w of waiters) w.fail(e as Error);
        }
      }
    } catch (e) {
      for (const w of this.nextWaiters) w.fail(e as Error);
      this.nextWaiters = [];
      this.nextModel = null;
    } finally {
      this.syncing = false;
    }
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }
}

let shared: Engine | null = null;
export const engine = (): Engine => (shared ??= new Engine());
