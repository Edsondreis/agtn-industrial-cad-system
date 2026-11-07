import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type Entity,
  TAU,
  closestOnEntity,
  deg2rad,
  dist,
  entityLength,
  hatchArea,
  hatchLoopPolygon,
  hatchPatternByName,
  interpolateSpline,
  makeEntity,
  patternLines,
} from "@agtn/geometry";
import { DEFAULT_LAYER } from "@agtn/document";
import { dxfBytes, readDxf, toDxfText2000, writeDxf, writeDxf2000, writeDxfR12 } from "./index";

const layers = [
  DEFAULT_LAYER,
  { name: "CORTE", color: 7, lineweight: 0.35, linetype: "CONTINUOUS", visible: true, locked: false },
  { name: "HACH", color: 1, lineweight: 0.13, linetype: "CONTINUOUS", visible: true, locked: false },
  { name: "EIXO", color: 4, lineweight: 0.25, linetype: "CENTER", visible: false, locked: true },
];

const square = { pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }], bulges: [0, 0.4, 0, 0] };
const hole = { pts: [{ x: 30, y: 30 }, { x: 50, y: 30 }], bulges: [1, 1] };

export const allEntities = (): Entity[] => [
  makeEntity({ type: "line", a: { x: 0.1 + 0.2, y: -12.345678901234 }, b: { x: 1e5 / 3, y: 7 } }, "CORTE", { lineweight: 0.5 }),
  makeEntity({ type: "circle", c: { x: 50, y: 50 }, r: 12.5 }, "CORTE", { color: 3 }),
  makeEntity({ type: "arc", c: { x: -20, y: 5 }, r: 7.25, a0: deg2rad(30), a1: deg2rad(300) }, "CORTE"),
  makeEntity({ type: "polyline", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }], bulges: [0, -0.3, 0], closed: true }, "CORTE"),
  makeEntity({ type: "point", p: { x: 3, y: 4 } }, "0"),
  makeEntity({ type: "text", p: { x: 10, y: 10 }, h: 3.5, rot: deg2rad(90), value: "DOBRA 90° Ø12 ±0,1 AÇÃO", halign: 1 }, "EIXO", { linetype: "CENTER" }),
  makeEntity({ type: "text", p: { x: 200, y: 10 }, h: 5, rot: 0, value: "LINHA 1\nLINHA 2 {x}\\y\n≈ fim", halign: 0 }, "0"),
  makeEntity({ type: "ellipse", c: { x: 300, y: 50 }, major: { x: 40, y: 30 }, ratio: 0.4, t0: 0, t1: TAU }, "CORTE"),
  makeEntity({ type: "ellipse", c: { x: 400, y: 50 }, major: { x: 0, y: 25 }, ratio: 0.6, t0: 5.5, t1: 1.2 }, "CORTE"),
  makeEntity({ type: "spline", ...interpolateSpline([{ x: 0, y: 200 }, { x: 40, y: 260 }, { x: 90, y: 220 }, { x: 150, y: 280 }]) }, "CORTE"),
  makeEntity(
    { type: "spline", degree: 2, ctrl: [{ x: 500, y: 200 }, { x: 540, y: 280 }, { x: 600, y: 200 }], knots: [0, 0, 0, 1, 1, 1], weights: [1, Math.SQRT1_2, 1], closed: false },
    "CORTE",
  ),
  makeEntity(
    { type: "hatch", loops: [square, hole], solid: false, pattern: "ANSI31", patternAngle: 0, patternScale: 2, lines: patternLines(hatchPatternByName("ANSI31")!, 0, 2) },
    "HACH",
  ),
  makeEntity({ type: "hatch", loops: [hole], solid: true, pattern: "SOLID", patternAngle: 0, patternScale: 1, lines: [] }, "HACH", { color: 5 }),
  makeEntity({ type: "dimension", kind: "aligned", p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, loc: { x: 50, y: -15 }, rot: 0, textOverride: null, assoc: null }, "0"),
];

const OUT = new URL("../../../tests/output/", import.meta.url);

/** desvio máximo entre duas entidades amostrando a primeira */
function dev(a: Entity, b: Entity): number {
  const n = 40;
  let m = 0;
  const pts = a.type === "hatch" ? a.loops.flatMap(hatchLoopPolygon) : sample(a, n);
  for (const p of pts) m = Math.max(m, dist(p, closestOnEntity(p, b)));
  return m;
}
function sample(e: Entity, n: number) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // amostra pela própria entidade: ponto mais próximo de pontos espalhados na caixa
    out.push(closestOnEntity({ x: Math.cos(t * TAU) * 1e4, y: Math.sin(t * TAU) * 1e4 }, e));
  }
  return out;
}

describe("DXF 2000 (AC1015)", () => {
  const src = allEntities();
  const txt = writeDxf2000({ layers, entities: src });
  const back = readDxf(dxfBytes(txt));

  it("estrutura completa: handles, BLOCK_RECORD, layouts e $HANDSEED acima de todos os handles", () => {
    expect(txt).toContain("AC1015");
    for (const k of ["BLOCK_RECORD", "*Model_Space", "*Paper_Space", "ACAD_LAYOUT", "LAYOUT", "ACDBPLACEHOLDER", "$INSUNITS"]) expect(txt).toContain(k);
    const lines = txt.split("\r\n");
    const handles: number[] = [];
    const start = lines.indexOf("CLASSES");
    for (let i = start - (start % 2 === 0 ? 0 : 1); i + 1 < lines.length; i += 2)
      if (lines[i].trim() === "5" || lines[i].trim() === "105") handles.push(parseInt(lines[i + 1], 16));
    expect(new Set(handles).size).toBe(handles.length);
    const seedIdx = lines.indexOf("$HANDSEED");
    const seed = parseInt(lines[seedIdx + 2], 16);
    expect(seed).toBeGreaterThan(Math.max(...handles));
  });

  it("todos os objetos voltam nativos (sem virar polilinha)", () => {
    expect(back.report.unsupported).toEqual({});
    expect(back.report.unitSource).toBe("INSUNITS");
    const types = back.entities.map((e) => e.type);
    for (const t of ["ellipse", "spline", "hatch", "polyline", "circle", "arc", "line", "point", "text"]) expect(types).toContain(t);
    expect(back.report.counts.LWPOLYLINE).toBe(1);
    expect(back.report.counts.MTEXT).toBe(1);
  });

  it("geometria idêntica na volta (desvio < 1e-9 mm) e espessura de linha preservada", () => {
    const geo = src.filter((e) => e.type !== "dimension" && e.type !== "text");
    const bk = back.entities.filter((e) => e.type !== "text");
    for (const e of geo) {
      const same = (b: Entity) => b.type === e.type && (e.type !== "hatch" || (b.type === "hatch" && b.loops.length === e.loops.length && b.solid === e.solid));
      const twin = bk.find((b) => same(b) && dev(e, b) < 1e-6 && dev(b, e) < 1e-6);
      expect(twin, `${e.type} sem par`).toBeDefined();
      if (e.type === "hatch" && twin?.type === "hatch") {
        const a1 = hatchArea(e.loops.map(hatchLoopPolygon), e.loops);
        const a2 = hatchArea(twin.loops.map(hatchLoopPolygon), twin.loops);
        expect(Math.abs(a1 - a2)).toBeLessThan(1e-9);
        expect(twin.solid).toBe(e.solid);
        expect(twin.lines.length).toBe(e.lines.length);
      } else if (twin) expect(Math.abs(entityLength(twin) - entityLength(e))).toBeLessThan(1e-6);
    }
    const line = back.entities.find((e) => e.type === "line" && e.layer === "CORTE")!;
    expect(line.lineweight).toBe(0.5);
    const lay = back.layers.find((l) => l.name === "HACH")!;
    expect(lay.lineweight).toBeCloseTo(0.13, 9);
    const eixo = back.layers.find((l) => l.name === "EIXO")!;
    expect(eixo.visible).toBe(false);
    expect(eixo.locked).toBe(true);
  });

  it("texto de várias linhas vira MTEXT e volta igual, na mesma posição", () => {
    const t = back.entities.find((e) => e.type === "text" && e.value.includes("\n"));
    expect(t?.type === "text" && t.value).toBe("LINHA 1\nLINHA 2 {x}\\y\n≈ fim");
    if (t?.type === "text") {
      expect(t.p.x).toBeCloseTo(200, 9);
      expect(t.p.y).toBeCloseTo(10, 9);
    }
    const acc = back.entities.find((e) => e.type === "text" && e.value.startsWith("DOBRA"));
    expect(acc?.type === "text" && acc.value).toBe("DOBRA 90° Ø12 ±0,1 AÇÃO");
    expect(toDxfText2000("≈")).toBe("\\U+2248");
  });

  it("R12 continua compatível: curvas viram polilinhas/linhas e o texto vira uma linha por TEXT", () => {
    const r12 = readDxf(writeDxfR12({ layers, entities: allEntities() }));
    expect(r12.report.unsupported).toEqual({});
    // (as únicas hachuras na volta são as setas SOLID das cotas)
    expect(r12.entities.some((e) => e.type === "ellipse" || e.type === "spline" || (e.type === "hatch" && (!e.solid || e.loops[0].pts.length > 4)))).toBe(false);
    expect(r12.entities.filter((e) => e.type === "text" && e.value.startsWith("LINHA")).length).toBe(2);
    // elipse completa exportada como polilinha fechada com perímetro correto
    const ell = allEntities()[7];
    const pl = r12.entities.find((e) => e.type === "polyline" && e.closed && Math.abs(entityLength(e) - entityLength(ell)) < 1e-6);
    expect(pl).toBeDefined();
    expect(writeDxf({ layers, entities: [] }, { version: "R2000" })).toContain("AC1015");
  });

  it("grava arquivos para auditoria externa (ezdxf / acadrust)", () => {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(new URL("todas_entidades_r2000.dxf", OUT), dxfBytes(txt));
    writeFileSync(new URL("todas_entidades_r12.dxf", OUT), dxfBytes(writeDxfR12({ layers, entities: allEntities() })));
    writeFileSync(new URL("vazio_r2000.dxf", OUT), dxfBytes(writeDxf2000({ layers: [DEFAULT_LAYER], entities: [] })));
  });
});
