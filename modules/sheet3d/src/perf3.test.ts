import { mkdirSync, writeFileSync } from "node:fs";
import { flatPattern, flatToDxf, validateFlatDxf } from "@agtn/sheetgraph";
import { type Sketch, addCircle, addRectangle, emptySketch } from "@agtn/sketch";
import { type Feature, type FeatureDraft, OcctSolidKernel, PartEvaluator } from "@agtn/solid";
import { type SheetState, createSheetBackend } from "./backend";
import type { ShapeHandle } from "occt-wasm";
import { buildSheet } from "./build";

/**
 * FASE 4 · ETAPA 3 — P1: desempenho e estabilidade NO CONTÊINER (não é hardware real; P2 fica para o PC da AGTN).
 * Pelo mesmo caminho do app (PartEvaluator + motor de chapa, cache incremental):
 *  - pequeno / médio / grande: abrir (regeneração completa), editar 1 parâmetro (incremental), planificar, DXF;
 *  - 60 edições seguidas: tempo das 10 primeiras × 10 últimas (degradação) e formas OCCT vivas (vazamento);
 *  - abrir e fechar 20 vezes: formas vivas voltam à linha de base.
 */
let S: OcctSolidKernel;
beforeAll(async () => {
  S = await OcctSolidKernel.create();
});
afterAll(() => S.dispose());
let seq = 0;
const F = (name: string, d: FeatureDraft, id = `f${++seq}`): Feature => ({ ...(d as object), id, name }) as Feature;
const sk = (s: Sketch, id: string, offset = 0) => F("Esboço", { t: "sketch", plane: { t: "std", plane: "XY", offset }, sketch: s }, id);
function model(size: "pequeno" | "medio" | "grande", H: number, rh = 4): Feature[] {
  const [A, B, nh, nc] = size === "pequeno" ? [200, 120, 0, 0] : size === "medio" ? [600, 400, 24, 2] : [2000, 1000, 120, 8];
  const r0 = addRectangle(emptySketch(), { x: 0, y: 0 }, { x: A, y: B });
  const f: Feature[] = [sk(r0.s, "S0"), F("Chapa_1", { t: "sheetBase", sketch: "S0", T: 2, R: 2, K: 0.43, material: "aco_carbono", process: "ar", ref: "externa", side: "cima" }, "CH")];
  f.push(F("Aba_1", { t: "sheetFlange", edges: r0.lines.map((l) => ({ flange: "CH", edge: l })), length: H, deflectionDeg: 90, R: null, K: null, side: "cima", ref: "externa" }, "AB"));
  if (nh) {
    let s = emptySketch();
    const cols = Math.ceil(Math.sqrt((nh * A) / B));
    for (let i = 0; i < nh; i++) s = addCircle(s, { x: 60 + ((i % cols) * (A - 120)) / Math.max(1, cols - 1), y: 60 + (Math.floor(i / cols) * (B - 120)) / Math.max(1, Math.ceil(nh / cols) - 1) }, rh).s;
    f.push(sk(s, "SH", 2), F("Furos", { t: "sheetCut", sketch: "SH", flange: "CH" }, "FU"));
  }
  if (nc) {
    let s = emptySketch();
    for (let i = 0; i < nc; i++) s = addRectangle(s, { x: 100 + i * ((A - 240) / Math.max(1, nc - 1)), y: -10 }, { x: 120 + i * ((A - 240) / Math.max(1, nc - 1)), y: 15 }).s;
    f.push(sk(s, "SC"), F("RecortePlano_1", { t: "sheetFlatCut", sketch: "SC" }, "RP"));
  }
  return f;
}
const med = (x: number[]) => [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)];
const ROWS: Record<string, unknown>[] = [];
afterAll(() => {
  mkdirSync("tests/output", { recursive: true });
  writeFileSync("tests/output/perf_etapa3.json", JSON.stringify(ROWS, null, 1));
});

// Iterações por tamanho: o "grande" (2000×1000, 120 furos) leva ~9 s por regeneração no contêiner, então
// roda só com AGTN_PERF=1 (registrado no relatório). Os critérios de vazamento são os mesmos nos três.
const CFG = { pequeno: { open: 3, edits: 60, cycles: 20 }, medio: { open: 3, edits: 20, cycles: 10 }, grande: { open: 2, edits: 6, cycles: 3 } };
describe("P1 — desempenho e estabilidade (contêiner Linux)", () => {
  for (const size of ["pequeno", "medio", "grande"] as const)
    (size === "grande" && !process.env.AGTN_PERF ? it.skip : it)(`${size}: abrir, editar, planificar, DXF; edições repetidas; sem vazamento`, { timeout: 900_000 }, () => {
      const c = CFG[size];
      const ev = new PartEvaluator(S, createSheetBackend());
      const base0 = S.liveShapes;
      const open: number[] = [];
      for (let i = 0; i < c.open; i++) {
        ev.release(`p-${i}`);
        const t0 = performance.now();
        const r = ev.evaluate(`p-${i}`, model(size, 50));
        open.push(performance.now() - t0);
        expect(r.status.every((s) => s.state === "ok")).toBe(true);
        ev.release(`p-${i}`);
      }
      // edições seguidas no mesmo corpo (cache incremental: só da aba em diante)
      const r0 = ev.evaluate("p", model(size, 50));
      const faces = S.raw.subShapeCount(r0.shape!, "face");
      const sv = (r0.sheet!.state as SheetState).solved;
      const after1 = S.liveShapes;
      const edit: number[] = [];
      for (let i = 0; i < c.edits; i++) {
        const t0 = performance.now();
        const r = ev.evaluate("p", model(size, i % 2 ? 50 : 51)); // nunca igual à anterior (sem acerto de cache)
        edit.push(performance.now() - t0);
        expect(r.failed).toBeNull();
      }
      const after60 = S.liveShapes;
      // edição tardia (só o raio dos furos): o cache refaz apenas do recorte em diante
      const late: number[] = [];
      if (size !== "pequeno")
        for (let i = 0; i < Math.min(6, c.edits); i++) {
          const t0 = performance.now();
          expect(ev.evaluate("p", model(size, 50, i % 2 ? 4 : 4.5)).failed).toBeNull();
          late.push(performance.now() - t0);
        }
      const st = ev.evaluate("p", model(size, 50)).sheet!.state as SheetState;
      // onde vai o tempo de uma regeneração: grafo (solve) × OCCT (peças, interferência, fusão+conferências)
      const own: ShapeHandle[] = [];
      const b = buildSheet(S.raw, st.solved, <H extends ShapeHandle>(h: H): H => (own.push(h), h));
      for (const h of own) try { S.raw.release(h as never); } catch { /* já liberado */ }
      const fases = { solve: st.ms.solve, build: st.ms.build, pecas: b.ms.pieces, interferencia: b.ms.checks, fusaoEConferencias: b.ms.total - b.ms.pieces - b.ms.checks };
      const t1 = performance.now();
      const fp = flatPattern(st.solved);
      const tFlat = performance.now() - t1;
      const t2 = performance.now();
      const txt = flatToDxf(fp);
      const ok = validateFlatDxf(txt, fp).ok;
      const tDxf = performance.now() - t2;
      expect(ok).toBe(true);
      ev.release("p");
      // abrir e fechar 20 vezes
      for (let i = 0; i < c.cycles; i++) {
        ev.evaluate("q", model(size, 50));
        ev.release("q");
      }
      const end = S.liveShapes;
      const n = Math.min(10, Math.floor(edit.length / 2));
      const first10 = edit.slice(0, n).reduce((a, b) => a + b, 0) / n;
      const last10 = edit.slice(-n).reduce((a, b) => a + b, 0) / n;
      ROWS.push({
        tamanho: size,
        operacoes: model(size, 50).length,
        faces,
        abas: sv.flanges.length,
        furos: sv.flanges[0].holes.length,
        msAbrir: med(open),
        iteracoes: c,
        msEditarAba: med(edit),
        msEditarRaioFuros: late.length ? med(late) : null,
        msEditarPrimeiras: first10,
        msEditarUltimas: last10,
        msPlanificar: tFlat,
        msDxfConferido: tDxf,
        msPorFase: fases,
        formasVivas: { antes: base0, depoisDe1: after1, depoisDasEdicoes: after60, depoisDeAbrirFechar: end },
        wasmMB: S.wasmMemoryBytes / 2 ** 20,
        heapNodeMB: process.memoryUsage().heapUsed / 2 ** 20,
      });
      expect(after60).toBe(after1); // edições repetidas não acumulam formas
      expect(end).toBe(base0); // fechar libera tudo
      expect(last10).toBeLessThan(3 * first10 + 50); // sem degradação grosseira
    });
});
