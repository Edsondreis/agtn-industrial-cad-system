import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Entity, TAU, deg2rad, hatchPatternByName, makeEntity, patternLines } from "@agtn/geometry";
import { DEFAULT_LAYER } from "@agtn/document";
import { DEFAULT_PLOT, helveticaWidth, layoutPlot, paperSize, pdfString, plotToPdf, plotToSvg, scaleLabel } from "./index";

const layers = [
  DEFAULT_LAYER,
  { name: "CORTE", color: 1, lineweight: 0.5, linetype: "CONTINUOUS", visible: true, locked: false },
  { name: "EIXO", color: 4, lineweight: 0.18, linetype: "CENTER", visible: true, locked: false },
  { name: "OCULTA", color: 2, lineweight: 0.25, linetype: "CONTINUOUS", visible: false, locked: false },
];
const rect = makeEntity({ type: "polyline", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }], bulges: [0, 0, 0, 0], closed: true }, "CORTE");
const ents: Entity[] = [
  rect,
  makeEntity({ type: "circle", c: { x: 50, y: 25 }, r: 10 }, "CORTE"),
  makeEntity({ type: "line", a: { x: -5, y: 25 }, b: { x: 105, y: 25 } }, "EIXO"),
  makeEntity({ type: "line", a: { x: 0, y: 0 }, b: { x: 5000, y: 5000 } }, "OCULTA"),
  makeEntity({ type: "text", p: { x: 50, y: 55 }, h: 3.5, rot: 0, value: "PEÇA 01 — Ø20\nAÇO 1020", halign: 1 }, "0"),
  makeEntity({ type: "ellipse", c: { x: 20, y: 25 }, major: { x: 8, y: 0 }, ratio: 0.5, t0: 0, t1: TAU }, "CORTE"),
  makeEntity(
    {
      type: "hatch",
      loops: [{ pts: [{ x: 70, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 40 }, { x: 70, y: 40 }], bulges: [0, 0, 0, 0] }],
      solid: false,
      pattern: "ANSI31",
      patternAngle: 0,
      patternScale: 1,
      lines: patternLines(hatchPatternByName("ANSI31")!, 0, 1),
    },
    "0",
  ),
  makeEntity({ type: "dimension", kind: "aligned", p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, loc: { x: 50, y: -10 }, rot: 0, textOverride: null, assoc: null }, "0"),
];

describe("plotagem", () => {
  it("ajustar à folha: A4 paisagem, margem 10, centralizado", () => {
    const p = layoutPlot({ entities: ents, layers }, { ...DEFAULT_PLOT });
    expect(paperSize(DEFAULT_PLOT)).toEqual({ w: 297, h: 210 });
    // área = extensão sem a camada oculta
    expect(p.area.maxX - p.area.minX).toBeLessThan(200);
    expect(p.scale).toBeCloseTo(Math.min(277 / (p.area.maxX - p.area.minX), 190 / (p.area.maxY - p.area.minY)), 9);
    // centro da área no centro da folha
    const allX = p.strokes.flatMap((s) => s.paths.flatMap((q) => q.pts.map((v) => v.x)));
    expect(Math.min(...allX)).toBeGreaterThanOrEqual(10 - 1e-6);
    expect(Math.max(...allX)).toBeLessThanOrEqual(287 + 1e-6);
    expect(p.count).toBe(7);
  });
  it("escala 1:1 mede certo no papel e camada oculta não sai", () => {
    const p = layoutPlot({ entities: ents, layers }, { ...DEFAULT_PLOT, scale: 1, center: false });
    const cut = p.strokes.find((s) => s.width === 0.5)!;
    const r = cut.paths.find((q) => q.closed && q.pts.length === 4)!;
    expect(r.pts[1].x - r.pts[0].x).toBeCloseTo(100, 9);
    expect(r.pts[2].y - r.pts[1].y).toBeCloseTo(50, 9);
    expect(p.strokes.some((s) => s.paths.some((q) => q.pts.some((v) => v.x > 1000)))).toBe(false);
    // linha de centro tracejada com padrão em mm de papel
    expect(p.strokes.some((s) => s.dash.length > 0 && s.width === 0.18)).toBe(true);
  });
  it("círculo com erro de corda ≤ 0,01 mm no papel", () => {
    const p = layoutPlot({ entities: [ents[1]], layers }, { ...DEFAULT_PLOT, scale: 2, center: true });
    const pts = p.strokes[0].paths[0].pts;
    const c = { x: 297 / 2, y: 210 / 2 };
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      expect(20 - Math.hypot(m.x - c.x, m.y - c.y)).toBeLessThanOrEqual(0.0101);
      expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeCloseTo(20, 9);
    }
  });
  it("monocromático deixa tudo preto; colorido troca branco (7) por preto", () => {
    const mono = layoutPlot({ entities: ents, layers }, { ...DEFAULT_PLOT, color: "mono" });
    expect(mono.strokes.every((s) => s.rgb.every((v) => v === 0))).toBe(true);
    const cor = layoutPlot({ entities: ents, layers }, { ...DEFAULT_PLOT, color: "color" });
    expect(cor.strokes.some((s) => s.rgb[0] === 255 && s.rgb[1] === 0)).toBe(true);
    expect(cor.texts[0].rgb).toEqual([0, 0, 0]);
  });
  it("desenho vazio dá erro claro", () => {
    expect(() => layoutPlot({ entities: [], layers }, DEFAULT_PLOT)).toThrow(/vazio/);
  });
  it("rótulo de escala", () => {
    expect(scaleLabel(0.1)).toBe("1:10");
    expect(scaleLabel(2)).toBe("2:1");
    expect(scaleLabel(1 / 7.35)).toBe("1:7,35");
  });
});

describe("PDF", () => {
  const page = layoutPlot({ entities: ents, layers }, { ...DEFAULT_PLOT, paper: "A3", color: "color" });
  const pdf = plotToPdf(page, { title: "Peça 01" });
  const txt = new TextDecoder("latin1").decode(pdf);

  it("tabela xref aponta exatamente para cada objeto", () => {
    expect(txt.startsWith("%PDF-1.4")).toBe(true);
    const start = Number(/startxref\n(\d+)/.exec(txt)![1]);
    expect(txt.slice(start, start + 4)).toBe("xref");
    const offs = [...txt.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offs).toHaveLength(6);
    offs.forEach((o, i) => expect(txt.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    const len = Number(/\/Length (\d+)/.exec(txt)![1]);
    const s = txt.indexOf("stream\n") + 7;
    expect(txt.slice(s + len, s + len + 10)).toBe("\nendstream");
  });
  it("folha A3 paisagem em pontos e texto com acento em WinAnsi", () => {
    expect(txt).toContain("/MediaBox [0 0 1190.5512 841.8898]");
    expect(pdfString("PEÇA (1)\\")).toBe("(PE\\307A \\(1\\)\\\\)");
    expect(helveticaWidth("AAAA")).toBeCloseTo(4 * 0.667, 9);
  });
  it("SVG com o tamanho da folha", () => {
    const svg = plotToSvg(page);
    expect(svg).toContain('width="420mm" height="297mm"');
    expect(svg).toContain("PEÇA 01 — Ø20");
  });
  it("grava PDFs para validação externa (qpdf / pdftotext)", () => {
    const OUT = new URL("../../../tests/output/", import.meta.url);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(new URL("plot_a3.pdf", OUT), pdf);
    const a4 = layoutPlot({ entities: ents, layers }, { ...DEFAULT_PLOT, scale: 1, landscape: false, paper: "A4" });
    writeFileSync(new URL("plot_a4_1-1.pdf", OUT), plotToPdf(a4));
    writeFileSync(new URL("plot_a3.svg", OUT), plotToSvg(page, { background: "#fff" }));
    void deg2rad;
  });
});
