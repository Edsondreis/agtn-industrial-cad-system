import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { type PolylineEntity, polylineSignedArea } from "@agtn/geometry";
import { DEFAULT_LASER_TEXT, LASER_FONTS, buildLaserText, parseFont } from "./index";

const load = (file: string) => {
  const b = readFileSync(new URL(`../fonts/${file}`, import.meta.url));
  return parseFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const barlow = load("barlow-700.woff");
const pacifico = load("pacifico-400.woff");

describe("texto laser", () => {
  it("todas as fontes do catálogo carregam e geram geometria com acentos", () => {
    for (const f of LASER_FONTS) {
      const r = buildLaserText(load(f.file), { ...DEFAULT_LASER_TEXT, text: "AGTN Ç Ã É 2026", mode: "marcacao" });
      expect(r.ok, f.id).toBe(true);
      expect(r.missingGlyphs, f.id).toEqual([]);
    }
  });
  it("gera polilinhas fechadas (elementos), não entidades TEXT", () => {
    const r = buildLaserText(barlow, { ...DEFAULT_LASER_TEXT, text: "AGTN" });
    expect(r.entities.length).toBeGreaterThan(0);
    expect(r.entities.every((e) => e.type === "polyline" && e.closed)).toBe(true);
  });
  it("altura das maiúsculas respeitada", () => {
    const r = buildLaserText(barlow, { ...DEFAULT_LASER_TEXT, text: "H", mode: "marcacao" });
    expect(r.heightTotal).toBeCloseTo(50, 0);
  });
  it("vazado: ilhas de O, A, B, R, 8 recebem pontes e nenhuma fica solta", () => {
    const r = buildLaserText(barlow, { ...DEFAULT_LASER_TEXT, text: "OAB R8", mode: "vazado", bridgeWidth: 3 });
    expect(r.bridges).toBeGreaterThanOrEqual(5);
    expect(r.islandsLeft).toBe(0);
    // após as pontes, nenhuma região tem furo interno
    expect(r.regions.every((p) => p.length === 1)).toBe(true);
  });
  it("vazado: letra sem miolo não recebe ponte", () => {
    const r = buildLaserText(barlow, { ...DEFAULT_LASER_TEXT, text: "LT", mode: "vazado" });
    expect(r.bridges).toBe(0);
  });
  it("vazado com placa: contorno externo da placa incluído", () => {
    const r = buildLaserText(barlow, { ...DEFAULT_LASER_TEXT, text: "AGTN", plateMargin: 15, plateRadius: 5 });
    const plate = r.entities[0] as PolylineEntity;
    expect(Math.abs(polylineSignedArea(plate.pts, plate.bulges))).toBeGreaterThan(r.width * 0 + 1000);
    expect(r.width).toBeGreaterThan(30);
  });
  it("emendado: barra de ligação junta tudo em uma peça", () => {
    const solto = buildLaserText(barlow, { ...DEFAULT_LASER_TEXT, text: "AGTN", mode: "emendado", joinBar: false });
    const junto = buildLaserText(barlow, { ...DEFAULT_LASER_TEXT, text: "AGTN", mode: "emendado", joinBar: true, barHeight: 8 });
    expect(solto.pieces).toBe(4);
    expect(junto.pieces).toBe(1);
  });
  it("emendado com cursiva e espaçamento negativo reduz peças", () => {
    const r = buildLaserText(pacifico, { ...DEFAULT_LASER_TEXT, text: "aço", mode: "emendado", spacing: -2 });
    expect(r.pieces).toBeLessThanOrEqual(2);
  });
  it("aviso de traço fino para chapa grossa", () => {
    const r = buildLaserText(barlow, { ...DEFAULT_LASER_TEXT, text: "AGTN", height: 8, thickness: 6 });
    expect(r.warnings.some((w) => w.includes("Traço"))).toBe(true);
  });
  it("multilinha e alinhamento centralizado", () => {
    const r = buildLaserText(barlow, { ...DEFAULT_LASER_TEXT, text: "AGTN\nCAD", align: "center", mode: "marcacao" });
    expect(r.heightTotal).toBeGreaterThan(100);
  });
});
