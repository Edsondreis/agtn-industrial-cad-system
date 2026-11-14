import { mkdirSync, writeFileSync } from "node:fs";
import { type Loop2, type SheetOp, flatPattern, flatToDxf, solveSheet, validateFlatDxf } from "@agtn/sheetgraph";
import { OcctSolidKernel } from "@agtn/solid";
import type { OcctKernel, ShapeHandle } from "occt-wasm";
import { aba, rectBase, spec } from "../../sheetmetal/src/sheet3d/testkit";
import { buildSheet } from "./build";

/** Medidas de desempenho da ETAPA 2 (mediana de 5): resolver o grafo, planificar, montar o sólido OCCT, DXF. */
let S: OcctSolidKernel;
let k: OcctKernel;
beforeAll(async () => {
  S = await OcctSolidKernel.create();
  k = S.raw;
});
afterAll(() => S.dispose());
const rect = (x0: number, y0: number, x1: number, y1: number, key: string): Loop2 => ({
  key,
  segs: [
    { t: "line", a: { x: x0, y: y0 }, b: { x: x1, y: y0 } },
    { t: "line", a: { x: x1, y: y0 }, b: { x: x1, y: y1 } },
    { t: "line", a: { x: x1, y: y1 }, b: { x: x0, y: y1 } },
    { t: "line", a: { x: x0, y: y1 }, b: { x: x0, y: y0 } },
  ],
});
const IDS = ["S@B/L1+L@B/L2", "L@B/L2+N@B/L3", "N@B/L3+O@B/L4", "O@B/L4+S@B/L1"];
const tray: SheetOp[] = [aba("S", [["B", "L1"]], 25, 90), aba("L", [["B", "L2"]], 25, 90), aba("N", [["B", "L3"]], 25, 90), aba("O", [["B", "L4"]], 25, 90), ...IDS.map((id, i): SheetOp => ({ t: "canto", id: `C${i}`, label: `C${i}`, corners: [id], kind: "encosto", gap: 0.5, closer: i % 2 ? "b" : "a" }))];
const CASES: [string, ReturnType<typeof rectBase>, SheetOp[]][] = [
  ["bandeja 4 abas + 4 cantos encosto", rectBase(535, 520, { T: 3.18 }), tray],
  ["bandeja + 2 pestanas (recuo 15) + 6 rasgos atravessando dobras", rectBase(535, 520, { T: 3.18 }), [...tray, ...["S", "N"].map((a) => aba(`P${a}`, [[`${a}@B/${a === "S" ? "L1" : "L3"}`, "ponta"]], 12, 90, { o0: 15, o1: 15 })), { t: "recorte_plano", id: "RP", label: "RP", loops: [0, 1, 2].flatMap((i) => [rect(60 + i * 150, -10, 90 + i * 150, 20, `a${i}`), rect(60 + i * 150, 500, 90 + i * 150, 530, `b${i}`)]) }]],
  ["aba parcial + alívios oblongos", rectBase(300, 200), [aba("A", [["B", "L1"]], 40, 90, { o0: 40, o1: 60 }), { t: "alivio", id: "AL", label: "AL", bends: ["A@B/L1"], kind: "oblongo", gap: 0.5 }]],
  ["bandeja desdobrada (todas)", rectBase(535, 520, { T: 3.18 }), [...tray, { t: "desdobrar", id: "U", label: "U", bends: [] }]],
];
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe("desempenho ETAPA 2", () => {
  it("mediana de 5 execuções por caso (ms)", () => {
    const rows: Record<string, unknown>[] = [];
    for (const [name, base, ops] of CASES) {
      const t = { solve: [] as number[], flat: [] as number[], build: [] as number[], dxf: [] as number[] };
      let faces = 0;
      for (let i = 0; i < 5; i++) {
        const tmp: ShapeHandle[] = [];
        const T = <H extends ShapeHandle>(h: H): H => (tmp.push(h), h);
        let t0 = performance.now();
        const s = solveSheet(spec(base, ...ops));
        t.solve.push(performance.now() - t0);
        expect(s.issues.filter((x) => x.level === "error")).toEqual([]);
        t0 = performance.now();
        const fp = flatPattern(s);
        t.flat.push(performance.now() - t0);
        expect(fp.state).toBe("valida");
        t0 = performance.now();
        const b = buildSheet(k, s, T);
        t.build.push(performance.now() - t0);
        faces = b.faceLabels.length;
        t0 = performance.now();
        const txt = flatToDxf(fp);
        expect(validateFlatDxf(txt, fp).ok).toBe(true);
        t.dxf.push(performance.now() - t0);
        for (const h of tmp)
          try {
            k.release(h);
          } catch {
            /* */
          }
      }
      rows.push({ caso: name, faces, solve: med(t.solve), planificacao: med(t.flat), solidoOCCT: med(t.build), dxfMaisConferencia: med(t.dxf) });
    }
    mkdirSync("tests/output", { recursive: true });
    writeFileSync("tests/output/perf_etapa2.json", JSON.stringify(rows, null, 1));
    process.stderr.write(`PERF ${JSON.stringify(rows)}\n`);
    for (const r of rows) expect(r.solidoOCCT as number).toBeLessThan(20000);
    // o limite é o de cima (20 s por caso); os 5 s padrão do vitest estouravam num PC Windows mais lento (ETAPA 6)
  }, 120_000);
});
