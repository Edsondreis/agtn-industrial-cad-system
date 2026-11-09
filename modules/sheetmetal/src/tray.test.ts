import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Entity, type LineEntity, type PolylineEntity, type TextEntity, entityBox, makeEntity } from "@agtn/geometry";
import { dxfBytes, readDxf, writeDxf } from "@agtn/dxf";
import { SM_LAYERS, type TrayInput, rectUnionOutline, solveTray, trayFlatEntities, trayViewEntities } from "./index";

/**
 * Gabarito: tests/dxf/fixtures/bandeja_710.0CUH25-01-03.dxf — planificação real usada na AGTN
 * (CHAPA SUPERIOR, CH 3,18; 535 × 520 × 25,4 externas; Ri 2; K 0,33; canto sobreposto pelas abas do lado A).
 */
const FIX = new URL("../../../tests/dxf/fixtures/", import.meta.url);
const ref = readDxf(new Uint8Array(readFileSync(new URL("bandeja_710.0CUH25-01-03.dxf", FIX))));
const refOutline = ref.entities.find((e) => e.type === "polyline") as PolylineEntity;
const refBends = ref.entities.filter((e) => e.type === "line") as LineEntity[];

const BASE: TrayInput = {
  A: 535,
  B: 520,
  flanges: { S: 25.4, N: 25.4, O: 25.4, L: 25.4 },
  ref: "externa",
  T: 3.18,
  R: 2,
  K: 0.33,
  corner: "sobreposto",
  overlap: "A",
  gap: 0,
};
const solve = (p: Partial<TrayInput> = {}) => {
  const r = solveTray({ ...BASE, ...p });
  expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  return r;
};
const sameLoop = (a: readonly { x: number; y: number }[], b: readonly { x: number; y: number }[], tol = 1e-6) => {
  expect(a.length).toBe(b.length);
  const i0 = a.findIndex((p) => Math.abs(p.x - b[0].x) < tol && Math.abs(p.y - b[0].y) < tol);
  expect(i0).toBeGreaterThanOrEqual(0);
  for (let k = 0; k < b.length; k++) {
    const p = a[(i0 + k) % a.length];
    expect(p.x).toBeCloseTo(b[k].x, 5);
    expect(p.y).toBeCloseTo(b[k].y, 5);
  }
};

describe("bandeja", () => {
  it("reproduz a planificação 710.0CUH25-01-03 (contorno, recortes e linhas de dobra)", () => {
    const r = solve();
    expect(r.BA).toBeCloseTo((Math.PI / 2) * (2 + 0.33 * 3.18), 12);
    expect(r.BA).toBeCloseTo(4.79, 4);
    expect(r.contour).toHaveLength(20);
    sameLoop(r.contour, refOutline.pts);
    expect(r.blank.w).toBeCloseTo(574.66, 4);
    expect(r.blank.h).toBeCloseTo(559.66, 4);
    expect(refBends).toHaveLength(4);
    for (const l of refBends) {
      const hit = r.bends.find((b) => {
        const [p, q] = b.line;
        const d = (u: { x: number; y: number }, v: { x: number; y: number }) => Math.hypot(u.x - v.x, u.y - v.y);
        return (d(p, l.a) < 1e-6 && d(q, l.b) < 1e-6) || (d(p, l.b) < 1e-6 && d(q, l.a) < 1e-6);
      });
      expect(hit, `linha de dobra ${JSON.stringify(l.a)}`).toBeTruthy();
    }
  });

  it("fórmulas: fundo, reto da aba, área e corte", () => {
    const r = solve();
    const s = 2 + 3.18;
    expect(r.base.a).toBeCloseTo(535 - 2 * s, 12);
    expect(r.base.b).toBeCloseTo(520 - 2 * s, 12);
    for (const b of r.bends) {
      expect(b.flat).toBeCloseTo(25.4 - s, 12);
      expect(b.heightInt).toBeCloseTo(25.4 - 3.18, 12);
    }
    // área = fundo + 4 regiões de dobra + abas (as do lado A com avanço s em cada ponta)
    const a = r.base.a, b = r.base.b, f = 25.4 - s;
    const area = a * b + 2 * r.BA * (a + b) + 2 * f * (a + 2 * s) + 2 * f * b;
    expect(r.area).toBeCloseTo(area, 6);
    const pr = refOutline.pts;
    const per = pr.reduce((acc, p, i) => acc + Math.hypot(pr[(i + 1) % pr.length].x - p.x, pr[(i + 1) % pr.length].y - p.y), 0);
    expect(r.cutLength).toBeCloseTo(per, 6);
  });

  it("medidas internas ≡ externas − T", () => {
    const e = solve();
    const i = solve({ ref: "interna", A: 535 - 6.36, B: 520 - 6.36, flanges: { S: 22.22, N: 22.22, O: 22.22, L: 22.22 } });
    sameLoop(i.contour, e.contour);
    expect(i.Aext).toBeCloseTo(535, 12);
  });

  it("encosto avança R; aberto não avança; folga desconta", () => {
    const xMin = (r: ReturnType<typeof solve>) => Math.min(...r.contour.filter((p) => p.y < 1e-6).map((p) => p.x));
    const s = solve();
    expect(xMin(s)).toBeCloseTo(19.829986, 5); // aba O (20,22) + BA (4,79) − avanço s (5,18)
    expect(xMin(solve({ corner: "encosto" }))).toBeCloseTo(xMin(s) + 3.18, 9);
    expect(xMin(solve({ gap: 1 }))).toBeCloseTo(xMin(s) + 1, 9);
    const ab = solve({ corner: "aberto" });
    expect(xMin(ab)).toBeCloseTo(xMin(s) + 5.18, 9);
    expect(ab.contour).toHaveLength(12);
  });

  it("sobrepor pelo lado B passa o avanço para as abas esquerda/direita", () => {
    const r = solve({ overlap: "B" });
    const yMin = Math.min(...r.contour.filter((p) => p.x < 1e-6).map((p) => p.y));
    expect(yMin).toBeCloseTo(20.22 + 4.79 - 5.18, 4);
    expect(r.order).toEqual(["S", "N", "O", "L"]);
    expect(solve().order).toEqual(["O", "L", "S", "N"]);
  });

  it("três abas e alturas diferentes", () => {
    const r = solve({ A: 400, B: 300, flanges: { S: 40, N: 0, O: 30, L: 30 }, T: 2, R: 2, K: 0.4 });
    expect(r.bends).toHaveLength(3);
    // borda N sem aba: o fundo vai até a medida B (sem recuo)
    expect(r.base.b).toBeCloseTo(300 - 4, 12);
    const box = entityBox(makeEntity({ type: "polyline", pts: r.contour, bulges: r.contour.map(() => 0), closed: true }, "0"));
    expect(box.maxY - box.minY).toBeCloseTo(r.base.b + r.BA + 36, 9);
  });

  it("erros: aba menor que R+T, nenhuma aba, fundo negativo", () => {
    expect(solveTray({ ...BASE, flanges: { S: 5, N: 25, O: 25, L: 25 } }).issues.some((i) => i.code === "H_MIN")).toBe(true);
    expect(solveTray({ ...BASE, flanges: { S: 0, N: 0, O: 0, L: 0 } }).ok).toBe(false);
    expect(solveTray({ ...BASE, A: 8 }).issues.some((i) => i.code === "BASE")).toBe(true);
    expect(solveTray({ ...BASE, gap: 9 }).issues.some((i) => i.code === "GAP_BIG")).toBe(true);
  });

  it("entidades: camadas do módulo, marcação por dobra e DXF R12 de ida e volta", () => {
    const r = solve();
    const ents = trayFlatEntities(r, { title: "BANDEJA 535x520x25,4 #3,18" });
    const names = new Set(SM_LAYERS.map((l) => l.name));
    for (const e of ents) expect(names.has(e.layer), e.layer).toBe(true);
    const marks = ents.filter((e) => e.layer === "MARCACAO") as TextEntity[];
    expect(marks.map((m) => m.value.split(" ")[0]).sort()).toEqual(["D1", "D2", "D3", "D4"]);
    // marcação sempre dentro do fundo (não sai para a aba nem cruza a linha de dobra)
    for (const m of marks) {
      expect(m.p.x).toBeGreaterThan(25);
      expect(m.p.y).toBeGreaterThan(25);
      expect(m.p.x).toBeLessThan(550);
      expect(m.p.y).toBeLessThan(535);
    }
    const layers = SM_LAYERS.map((l) => ({ name: l.name, color: l.color, lineweight: l.lineweight, linetype: l.linetype, visible: true, locked: false }));
    const txt = writeDxf({ layers, entities: ents }, { layerFilter: ["CONTORNO_CORTE", "LINHAS_DOBRA"] });
    const back = readDxf(txt);
    const poly = back.entities.find((e) => e.type === "polyline") as PolylineEntity;
    sameLoop(poly.pts, refOutline.pts);
    expect(back.entities.filter((e: Entity) => e.type === "line" && e.layer === "LINHAS_DOBRA")).toHaveLength(4);
    // arquivos para a auditoria independente (npm run validate:dxf)
    const OUT = new URL("../../../tests/output/", import.meta.url);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(new URL("planificacao_bandeja_corte.dxf", OUT), dxfBytes(txt));
    writeFileSync(new URL("planificacao_bandeja_completa.dxf", OUT), dxfBytes(writeDxf({ layers, entities: ents })));
  });

  it("vista: planta + duas seções, sem erro com R = 0 e borda sem aba", () => {
    for (const p of [{}, { R: 0 }, { flanges: { S: 25.4, N: 0, O: 25.4, L: 0 } }, { corner: "aberto" as const }]) {
      const v = trayViewEntities(solve(p));
      const secs = v.filter((e) => e.type === "polyline" && e.layer === "SECAO_PERFIL") as PolylineEntity[];
      expect(secs.length).toBeGreaterThanOrEqual(4);
      for (const s of secs) for (const pt of s.pts) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
    }
  });

  it("união de retângulos: L e retângulos encostados", () => {
    const L = rectUnionOutline([
      [0, 0, 10, 2],
      [0, 0, 2, 10],
    ]);
    expect(L).toHaveLength(6);
    expect(rectUnionOutline([[0, 0, 5, 5], [5, 0, 10, 5]])).toHaveLength(4);
  });
});
