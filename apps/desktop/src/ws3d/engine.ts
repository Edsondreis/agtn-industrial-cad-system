import { invoke } from "@tauri-apps/api/core";
import type { Model3D } from "@agtn/model3d";
import { isTauri } from "../platform/platform";
import { type EngineDiagnostic, type EngineStage, classifyEngineFailure } from "./diagnostics";
import type { EngineApi, EngineOp, EngineRequest, EngineResponse, SyncResult } from "./protocol";

export class EngineError extends Error {
  constructor(
    message: string,
    readonly details: readonly string[] = [],
    /** etapa em que falhou (F-06): leitura do .wasm, worker, inicialização do OCCT, comunicação */
    readonly stage: EngineStage = "init",
    /** nome do erro original (EvalError, CompileError, RangeError…) */
    readonly origName?: string,
  ) {
    super(message);
  }
  get diagnostic(): EngineDiagnostic {
    return classifyEngineFailure(this.stage, { name: this.origName, message: this.message, details: this.details });
  }
}

/** Tempo máximo para o worker responder à inicialização (o OCCT leva ~0,5–1,5 s; 90 s = travado). */
const INIT_TIMEOUT_MS = 90_000;
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/** Lê o binário do motor: recurso do instalador (Tauri) ou middleware do Vite (navegador). */
async function loadWasm(): Promise<ArrayBuffer> {
  try {
    if (isTauri()) return await invoke<ArrayBuffer>("read_engine", { name: "occt-wasm.wasm" });
    const r = await fetch("/__engine/occt-wasm.wasm");
    if (!r.ok) throw new EngineError(`Motor 3D não encontrado (HTTP ${r.status}).`, [], "wasm");
    return await r.arrayBuffer();
  } catch (e) {
    if (e instanceof EngineError) throw e;
    throw new EngineError("Não foi possível ler o arquivo do motor 3D (occt-wasm.wasm).", [errText(e)], "wasm", (e as Error)?.name);
  }
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
  wasmLoadMs = 0;
  wasmBytesOnDisk = 0;

  private idleTimer = 0;

  /** Libera o worker (e os ~130 MB do motor) depois de `ms` sem uso — chamado ao sair da área 3D. */
  releaseLater(ms: number) {
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      if (!this.syncing && !this.pending.size) this.dispose();
    }, ms);
  }
  get alive() {
    return !!this.worker;
  }

  start(): Promise<{ kernel: string; ms: number }> {
    window.clearTimeout(this.idleTimer);
    if (!this.ready) {
      this.ready = (async () => {
        const t0 = performance.now();
        const wasm = await loadWasm();
        this.wasmBytesOnDisk = wasm.byteLength;
        this.wasmLoadMs = performance.now() - t0;
        let initDone = false;
        try {
          this.worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module", name: "agtn-motor-3d" });
        } catch (e) {
          throw new EngineError("O worker do motor 3D não pôde ser criado.", [errText(e)], "worker", (e as Error)?.name);
        }
        this.worker.onmessage = (ev: MessageEvent<EngineResponse>) => this.onMessage(ev.data);
        // erro do worker ANTES de responder à inicialização = o worker não iniciou (script, módulo, CSP do worker);
        // depois = o worker caiu no meio do trabalho (comunicação perdida)
        this.worker.onerror = (ev) => {
          const stage: EngineStage = initDone ? "comm" : "worker";
          const msg = ev.message || "erro sem mensagem no worker do motor 3D";
          const where = ev.filename ? [`${ev.filename}:${ev.lineno}:${ev.colno}`] : [];
          for (const p of this.pending.values()) p.fail(new EngineError(`Falha no motor 3D: ${msg}`, [msg, ...where], stage));
          this.pending.clear();
        };
        this.worker.onmessageerror = () => {
          for (const p of this.pending.values()) p.fail(new EngineError("Mensagem do motor 3D não pôde ser lida.", ["messageerror"], "comm"));
          this.pending.clear();
        };
        let timer = 0;
        const timeout = new Promise<never>((_, fail) => {
          timer = window.setTimeout(() => fail(new EngineError(`O motor 3D não respondeu em ${INIT_TIMEOUT_MS / 1000} s.`, ["sem resposta à inicialização"], "comm")), INIT_TIMEOUT_MS);
        });
        try {
          const r = await Promise.race([this.raw("init", { wasm }, [wasm]), timeout]);
          initDone = true;
          this.initMs = performance.now() - t0;
          return r;
        } finally {
          window.clearTimeout(timer);
        }
      })();
      this.ready.catch(() => {
        // falhou: libera o worker para que "Tentar novamente" comece do zero (recuperação após falha)
        this.worker?.terminate();
        this.worker = null;
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
    else p.fail(new EngineError(m.error, m.details ?? [], m.stage ?? "init", m.errorName));
  }

  private raw<K extends EngineOp>(op: K, args: Parameters<EngineApi[K]>[0], transfer: Transferable[] = []): Promise<ReturnType<EngineApi[K]>> {
    const w = this.worker;
    if (!w) return Promise.reject(new EngineError("Motor 3D não iniciado.", [], "comm"));
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
    window.clearTimeout(this.idleTimer);
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    for (const p of this.pending.values()) p.fail(new EngineError("Motor 3D encerrado.", [], "comm"));
    this.pending.clear();
  }
}

let shared: Engine | null = null;
export const engine = (): Engine => (shared ??= new Engine());
