import { mkdirSync, writeFileSync } from "node:fs";
import { dxfBytes } from "@agtn/dxf";
import { FLAT_LAYER, flatDxfInput, flatPattern, flatToDxf, solveSheet, validateFlatDxf } from "@agtn/sheetgraph";
import { OcctSolidKernel } from "@agtn/solid";
import type { OcctKernel, ShapeHandle } from "occt-wasm";
import { buildSheet } from "../build";
import { REF_PARTS } from "./parts";

/**
 * FASE 4 · ETAPA 3 — I1 / D1 / D2: as 10 peças de referência pelo caminho completo
 * grafo → sólido OCCT (válido, um sólido, casca fechada, volume = grafo) → planificação → DXF R2000 e R12
 * (relidos e conferidos; cada entidade na camada certa). Grava os DXF em tests/output/industrial/ para o teste
 * externo (ZWCAD / AutoCAD / CAM) e a ficha de resultados em resultados.json.
 */
const OUT = "tests/output/industrial";
mkdirSync(OUT, { recursive: true });
let S: OcctSolidKernel;
let k: OcctKernel;
beforeAll(async () => {
  S = await OcctSolidKernel.create();
  k = S.raw;
});
const ROWS: Record<string, unknown>[] = [];
afterAll(() => {
  writeFileSync(`${OUT}/resultados.json`, JSON.stringify(ROWS, null, 1));
  S.dispose();
});
const DENS: Record<string, number> = { "aço carbono": 7.85, galvanizado: 7.85, inox: 7.93 };
function freeEdges(shape: ShapeHandle): number {
  const m = k.edgeToFaceMap(shape, 1 << 22);
  const faces = new Map<number, Set<number>>();
  const seen = new Map<number, number>();
  for (let i = 0; i < m.length; ) {
    const n = m[i + 1];
    const s = faces.get(m[i]) ?? new Set<number>();
    for (let j = 0; j < n; j++) s.add(m[i + 2 + j]);
    faces.set(m[i], s);
    seen.set(m[i], (seen.get(m[i]) ?? 0) + 1);
    i += 2 + n;
  }
  let free = 0;
  for (const [e, s] of faces) if (s.size < 2 && (seen.get(e) ?? 0) < 2) free++;
  return free;
}

describe("10 peças de referência — caminho completo até o DXF", () => {
  for (const p of REF_PARTS)
    it(`${p.n}. ${p.nome}`, () => {
      const tmp: ShapeHandle[] = [];
      const T = <H extends ShapeHandle>(h: H): H => (tmp.push(h), h);
      const t0 = performance.now();
      const s = solveSheet(p.spec);
      expect(s.issues.filter((i) => i.level === "error")).toEqual([]);
      const t1 = performance.now();
      const b = buildSheet(k, s, T);
      const t2 = performance.now();
      expect(k.isValid(b.shape)).toBe(true);
      expect(k.getSubShapes(b.shape, "solid").map(T).length).toBe(1);
      const free = freeEdges(b.shape);
      expect(free).toBe(0);
      expect(Math.abs(b.volume - s.volume)).toBeLessThan(1e-9 * s.volume);
      const fp = flatPattern(s);
      expect(fp.state).toBe("valida");
      const checks: Record<string, boolean> = {};
      for (const version of ["R2000", "R12"] as const) {
        const o = { version, regions: true, reference: true, title: p.id } as const;
        const txt = flatToDxf(fp, o);
        writeFileSync(`${OUT}/${p.id}_${version}.dxf`, dxfBytes(txt));
        const rep = validateFlatDxf(txt, fp, o);
        expect(rep.checks.filter((c) => !c.ok)).toEqual([]);
        checks[version] = rep.ok;
      }
      // D2: cada entidade na camada certa (pelo tipo e pela origem)
      const ents = flatDxfInput(fp, { regions: true, reference: true }).entities;
      const cutOuter = ents.filter((e) => e.layer === FLAT_LAYER.outer);
      const cutInner = ents.filter((e) => e.layer === FLAT_LAYER.inner);
      expect(cutOuter.length).toBe(1);
      expect(cutOuter[0].type).toBe("polyline");
      expect(cutInner.length).toBe(fp.cut.length - 1 + fp.holes.length);
      expect(cutInner.every((e) => e.type === "polyline" || e.type === "circle")).toBe(true);
      for (const e of ents.filter((x) => x.layer === FLAT_LAYER.up || x.layer === FLAT_LAYER.down || x.layer === FLAT_LAYER.region)) expect(e.type).toBe("line");
      for (const e of ents.filter((x) => x.layer === FLAT_LAYER.mark || x.layer === FLAT_LAYER.ref)) expect(e.type).toBe("text");
      const up = fp.bends.filter((q) => q.sense === "CIMA").reduce((a, q) => a + q.lineSegs.length, 0);
      const dn = fp.bends.filter((q) => q.sense === "BAIXO").reduce((a, q) => a + q.lineSegs.length, 0);
      expect(ents.filter((e) => e.layer === FLAT_LAYER.up).length).toBe(up);
      expect(ents.filter((e) => e.layer === FLAT_LAYER.down).length).toBe(dn);
      ROWS.push({
        n: p.n,
        id: p.id,
        familia: p.familia,
        real: p.real,
        material: p.material,
        T: s.T,
        abas: s.flanges.length,
        dobras: s.bends.length,
        cantos: (s.corners ?? []).map((c) => c.kind),
        blank: [fp.box.maxX - fp.box.minX, fp.box.maxY - fp.box.minY],
        areaPlana: fp.area,
        corte: fp.cutLength,
        contornos: { externos: 1, internos: fp.cut.length - 1 + fp.holes.length },
        volume: b.volume,
        massaKg: (b.volume * (DENS[p.material] ?? 7.85)) / 1e6,
        facesSolido: b.faceLabels.length,
        arestasLivres: free,
        dobrasTabela: fp.bends.map((q) => ({ D: q.n, sentido: q.sense, theta: q.deflectionDeg, alpha: q.includedDeg, R: q.R, K: q.K, BA: q.BA, BD: q.BD, L: q.L, trechosLinha: q.lineSegs.length })),
        dxf: checks,
        ms: { grafo: t1 - t0, solido: t2 - t1 },
      });
      for (const h of tmp)
        try {
          k.release(h);
        } catch {
          /* */
        }
    });
});
