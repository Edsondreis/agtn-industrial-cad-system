import { mkdirSync, writeFileSync } from "node:fs";
import { OcctKernel } from "occt-wasm";

/**
 * FASE 4 · ETAPA 5 — medida do custo da ligação JS↔WASM (embind) antes/depois da correção F-05.
 * Só roda com AGTN_BENCH=1 (rótulo da medição em AGTN_BENCH_LABEL). Saída: tests/output/bench_embind_<rótulo>.json.
 *  - init: OcctKernel.init (instancia o WASM e registra TODAS as ligações do embind — é aqui que o glue original
 *    gera código com new Function); 5 vezes, cada uma num módulo novo;
 *  - chamadas curtas (makeBox+release, getVolume): mede o custo do invocador, que a correção troca;
 *  - booleanas (fuse/cut) e caixa: trabalho pesado do OCCT (o invocador some no meio).
 */
const on = process.env.AGTN_BENCH === "1";
(on ? it : it.skip)("bench embind", { timeout: 600_000 }, async () => {
  const label = process.env.AGTN_BENCH_LABEL ?? "sem_rotulo";
  const med = (x: number[]) => [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)];
  const cpu0 = process.cpuUsage();
  const init: number[] = [];
  let k: OcctKernel | null = null;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const kk = await OcctKernel.init();
    init.push(performance.now() - t0);
    if (k) (k as unknown as { dispose?: () => void }).dispose?.();
    k = kk;
  }
  const K = k!;
  const time = (n: number, f: () => void) => {
    for (let i = 0; i < Math.min(200, n); i++) f(); // aquecimento
    const t0 = performance.now();
    for (let i = 0; i < n; i++) f();
    return ((performance.now() - t0) * 1000) / n; // µs por chamada
  };
  const box = K.makeBox(10, 20, 30);
  const runs = (f: () => number) => med([f(), f(), f()]);
  const r = {
    rotulo: label,
    node: process.version,
    initMs: init.map((x) => Math.round(x)),
    initMediana_ms: Math.round(med(init)),
    makeBoxRelease_us: runs(() => time(20000, () => K.release(K.makeBox(1, 2, 3)))),
    getVolume_us: runs(() => time(50000, () => K.getVolume(box))),
    fuseCut_us: runs(() =>
      time(150, () => {
        const a = K.makeBox(10, 10, 10);
        const b = K.translate(K.makeCylinder(3, 20), 5, 5, -5);
        const f = K.fuse(a, b);
        const c = K.cut(f, a);
        for (const h of [a, b, f, c]) K.release(h);
      }),
    ),
    bbox_us: runs(() => time(20000, () => K.getBoundingBox(box))),
    volumeBox: K.getVolume(box),
    cpu_ms: Math.round((process.cpuUsage(cpu0).user + process.cpuUsage(cpu0).system) / 1000),
    rssMB: Math.round(process.memoryUsage().rss / 2 ** 20),
    heapMB: Math.round(process.memoryUsage().heapUsed / 2 ** 20),
  };
  expect(r.volumeBox).toBeCloseTo(6000, 9);
  mkdirSync("tests/output", { recursive: true });
  writeFileSync(`tests/output/bench_embind_${label}.json`, JSON.stringify(r, null, 1));
  console.log(JSON.stringify(r));
});
