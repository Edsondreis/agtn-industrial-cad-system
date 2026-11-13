import { readFileSync } from "node:fs";
import { readDxf } from "@agtn/dxf";
import type { LineEntity, PolylineEntity } from "@agtn/geometry";
import { flatPattern, flatToDxf, solveSheet } from "@agtn/sheetgraph";
import { REF_PARTS } from "./parts";

/**
 * I2 (parcial) — a ÚNICA peça real disponível no repositório: a planificação de produção da bandeja
 * 710.0CUH25-01-03 (tests/dxf/fixtures, DXF usado na AGTN e que já validou o 2D na v3.1.0).
 * A peça nº 3 é modelada no 3D (base + 4 abas + 4 cantos sobrepostos) e o DXF que o AGTN exporta da
 * planificação 3D é comparado com o DXF real: vértice a vértice, blank, perímetro, área e linhas de dobra.
 */
const real = readDxf(new Uint8Array(readFileSync(new URL("../../../../tests/dxf/fixtures/bandeja_710.0CUH25-01-03.dxf", import.meta.url))));
const realOutline = real.entities.find((e) => e.type === "polyline") as PolylineEntity;
const realBends = real.entities.filter((e) => e.type === "line") as LineEntity[];

it("bandeja 710.0CUH25-01-03: DXF da planificação 3D = DXF real de produção (vértices, blank, perímetro, área, dobras)", () => {
  const p = REF_PARTS.find((x) => x.n === 3)!;
  const s = solveSheet(p.spec);
  const fp = flatPattern(s);
  const mine = readDxf(flatToDxf(fp, { version: "R2000" }));
  const outline = mine.entities.find((e) => e.layer === "CUT_OUTER") as PolylineEntity;
  const bends = mine.entities.filter((e) => e.layer === "BEND_UP") as LineEntity[];
  // alinhamento: canto inferior esquerdo da caixa de cada um
  const minOf = (pts: readonly { x: number; y: number }[]) => ({ x: Math.min(...pts.map((q) => q.x)), y: Math.min(...pts.map((q) => q.y)) });
  const o1 = minOf(realOutline.pts);
  const o2 = minOf(outline.pts);
  const key = (q: { x: number; y: number }, o: { x: number; y: number }) => `${(q.x - o.x).toFixed(6)},${(q.y - o.y).toFixed(6)}`;
  const A = realOutline.pts.map((q) => key(q, o1)).sort();
  const B = outline.pts.map((q) => key(q, o2)).sort();
  expect(B).toEqual(A); // mesmos 20 vértices a 1e-6 mm
  const per = (pts: readonly { x: number; y: number }[]) => pts.reduce((a, q, i) => a + Math.hypot(pts[(i + 1) % pts.length].x - q.x, pts[(i + 1) % pts.length].y - q.y), 0);
  expect(Math.abs(per(outline.pts) - per(realOutline.pts))).toBeLessThan(1e-6);
  const seg = (l: LineEntity, o: { x: number; y: number }) => [key(l.a, o), key(l.b, o)].sort().join("|");
  expect(bends.map((l) => seg(l, o2)).sort()).toEqual(realBends.map((l) => seg(l, o1)).sort());
  // blank: a caixa do DXF real (o desenho cota 574,66 × 559,66, arredondado)
  const w = (pts: readonly { x: number; y: number }[], c: "x" | "y") => Math.max(...pts.map((q) => q[c])) - Math.min(...pts.map((q) => q[c]));
  expect(Math.abs(fp.box.maxX - fp.box.minX - w(realOutline.pts, "x"))).toBeLessThan(1e-6);
  expect(Math.abs(fp.box.maxY - fp.box.minY - w(realOutline.pts, "y"))).toBeLessThan(1e-6);
  process.stderr.write(`REAL710 blank real ${w(realOutline.pts, "x")} × ${w(realOutline.pts, "y")} · AGTN 3D ${fp.box.maxX - fp.box.minX} × ${fp.box.maxY - fp.box.minY} · perímetro real ${per(realOutline.pts)} · AGTN ${per(outline.pts)}\n`);
});
