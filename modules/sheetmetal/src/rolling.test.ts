import { describe, expect, it } from "vitest";
import type { PolylineEntity, TextEntity } from "@agtn/geometry";
import { rollingFlatEntities, rollingSectionEntities, solveRolling } from "./index";

const base = { diameter: 1000, ref: "externo" as const, T: 3, width: 500, angleDeg: 360, K: 0.5 };

describe("calandra", () => {
  it("volta completa por diâmetro externo: π·(Di + 2KT)", () => {
    const r = solveRolling(base);
    expect(r.ok).toBe(true);
    expect(r.Ri).toBe(497);
    expect(r.Re).toBe(500);
    expect(r.developed).toBeCloseTo(Math.PI * (994 + 2 * 0.5 * 3), 10);
    expect(r.developed).toBeCloseTo(3132.168, 3);
  });
  it("diâmetro interno muda o desenvolvimento", () => {
    const r = solveRolling({ ...base, ref: "interno" });
    expect(r.Ri).toBe(500);
    expect(r.developed).toBeCloseTo(2 * Math.PI * 501.5, 10);
  });
  it("segmento de 90° com corda e flecha externas", () => {
    const r = solveRolling({ ...base, angleDeg: 90 });
    expect(r.developed).toBeCloseTo((Math.PI / 2) * 498.5, 10);
    expect(r.chordOuter).toBeCloseTo(2 * 500 * Math.sin(Math.PI / 4), 10);
    expect(r.sagittaOuter).toBeCloseTo(500 * (1 - Math.cos(Math.PI / 4)), 10);
  });
  it("K altera o eixo neutro", () => {
    expect(solveRolling({ ...base, K: 0.4 }).developed).toBeLessThan(solveRolling(base).developed);
  });
  it("entradas inválidas", () => {
    expect(solveRolling({ ...base, diameter: 5 }).ok).toBe(false);
    expect(solveRolling({ ...base, T: 0 }).ok).toBe(false);
    expect(solveRolling({ ...base, angleDeg: 400 }).ok).toBe(false);
    expect(solveRolling({ ...base, width: 0 }).ok).toBe(false);
  });
  it("planificação: retângulo exato + marcação com referência e raio", () => {
    const r = solveRolling(base);
    const ents = rollingFlatEntities(r);
    const c = ents.find((e) => e.layer === "CONTORNO_CORTE") as PolylineEntity;
    expect(c.closed).toBe(true);
    expect(c.pts[1].x).toBeCloseTo(r.developed, 12);
    expect(c.pts[2].y).toBe(500);
    const mk = ents.filter((e) => e.layer === "MARCACAO") as TextEntity[];
    expect(mk[0].value).toBe("CALANDRAR RAIO EXTERNO R500,00");
    expect(mk.some((t) => t.value.includes("RI 497,00"))).toBe(true);
  });
  it("vista: anel e segmento", () => {
    expect(rollingSectionEntities(solveRolling(base)).filter((e) => e.type === "circle")).toHaveLength(3);
    expect(rollingSectionEntities(solveRolling({ ...base, angleDeg: 120 })).some((e) => e.type === "polyline")).toBe(true);
  });
});
