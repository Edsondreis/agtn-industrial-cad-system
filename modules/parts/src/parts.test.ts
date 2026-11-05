import { describe, expect, it } from "vitest";
import type { PolylineEntity } from "@agtn/geometry";
import { PARTS, buildPart, defaultParams, partById } from "./index";

describe("biblioteca de chapas", () => {
  it("todas as peças padrão geram contorno válido", () => {
    for (const d of PARTS) {
      const r = buildPart(d, defaultParams(d));
      expect(r.ok, d.id).toBe(true);
      expect(r.area, d.id).toBeGreaterThan(0);
      expect(r.cutLength, d.id).toBeGreaterThan(0);
      expect(r.entities.some((e) => e.layer === "CONTORNO_CORTE"), d.id).toBe(true);
    }
  });
  it("flange: área líquida e furação", () => {
    const r = buildPart(partById("flange"), { De: 300, Di: 160, pcd: 240, n: 8, dh: 18, a0: 22.5 });
    const expected = Math.PI * (150 ** 2 - 80 ** 2 - 8 * 9 ** 2);
    expect(r.area).toBeCloseTo(expected, 6);
    expect(r.pierces).toBe(9);
    expect(r.cutLength).toBeCloseTo(Math.PI * (300 + 160 + 8 * 18), 6);
  });
  it("flange inválido: furos fora da peça ou sobrepostos", () => {
    expect(buildPart(partById("flange"), { De: 300, Di: 160, pcd: 290, n: 8, dh: 18, a0: 0 }).ok).toBe(false);
    expect(buildPart(partById("flange"), { De: 300, Di: 0, pcd: 100, n: 40, dh: 18, a0: 0 }).ok).toBe(false);
  });
  it("bolacha: anel e disco", () => {
    expect(buildPart(partById("bolacha"), { De: 100, Di: 40 }).area).toBeCloseTo(Math.PI * (2500 - 400), 9);
    expect(buildPart(partById("bolacha"), { De: 100, Di: 0 }).pierces).toBe(0);
  });
  it("chapa de base com raio de canto: área exata", () => {
    const r = buildPart(partById("chapa-base"), { W: 300, H: 200, r: 10, dh: 0, ex: 30, ey: 30, dc: 0 });
    expect(r.area).toBeCloseTo(300 * 200 - (4 - Math.PI) * 100, 6);
  });
  it("oblongo: área do rasgo", () => {
    const r = buildPart(partById("chapa-oblongo"), { W: 250, H: 120, r: 0, n: 1, L: 40, w: 14, e: 45 });
    expect(r.area).toBeCloseTo(250 * 120 - (26 * 14 + Math.PI * 49), 6);
  });
  it("olhal: laterais tangentes ao arco", () => {
    const r = buildPart(partById("olhal"), { B: 120, Hc: 100, R: 45, d: 35 });
    expect(r.ok).toBe(true);
    const o = r.entities[0] as PolylineEntity;
    const t = o.pts[2];
    const dx = t.x - 60;
    const dy = t.y - 0;
    // raio no ponto de tangência ⟂ à lateral
    expect((t.x - 0) * dx + (t.y - 100) * dy).toBeCloseTo(0, 6);
    expect(r.height).toBeCloseTo(145, 6);
  });
  it("boca de lobo: perímetro do derivado e altura do gabarito", () => {
    const r = buildPart(partById("boca-de-lobo"), { D: 168.3, d: 114.3, e: 0, Lb: 50 });
    expect(r.width).toBeCloseTo(Math.PI * 114.3, 6);
    const R = 84.15;
    const rr = 57.15;
    expect(r.height).toBeCloseTo(50 + R - Math.sqrt(R * R - rr * rr), 3);
    // 0° (alinhado ao eixo do principal) = menor altura; 90° (lateral) = maior altura
    const o = r.entities[0] as PolylineEntity;
    const at = (x: number) => o.pts.slice(2).reduce((b, q) => (Math.abs(q.x - x) < Math.abs(b.x - x) ? q : b));
    expect(at(0).y).toBeCloseTo(50, 9);
    expect(at((Math.PI * 114.3) / 4).y).toBeCloseTo(r.height, 3);
    expect(buildPart(partById("boca-de-lobo"), { D: 100, d: 120, e: 0, Lb: 50 }).ok).toBe(false);
  });
  it("cartela com chanfro e furo", () => {
    const r = buildPart(partById("cartela"), { b: 150, h: 150, c: 15, t: 10, dh: 20 });
    expect(r.ok).toBe(true);
    expect(r.pierces).toBe(1);
  });
});
