import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { type ArcEntity, type CircleEntity, type Entity, type LineEntity, type PolylineEntity, type TextEntity, deg2rad, entityLength, makeEntity } from "@agtn/geometry";
import { CadDocument, DEFAULT_LAYER } from "@agtn/document";
import { PROFILE_DEFS, SM_LAYERS, buildProfileInput, flatPatternEntities, solveProfile } from "@agtn/sheetmetal";
import { decodeDxfBytes, dxfBytes, num, readDxf, writeDxfR12 } from "./index";

const layers = [
  DEFAULT_LAYER,
  { name: "CONTORNO_CORTE", color: 7, lineweight: 0.35, linetype: "CONTINUOUS", visible: true, locked: false },
  { name: "LINHAS_DOBRA", color: 1, lineweight: 0.25, linetype: "DASHED", visible: true, locked: false },
  { name: "OCULTA", color: 3, lineweight: 0.25, linetype: "HIDDEN", visible: false, locked: true },
];

const sample = (): Entity[] => [
  makeEntity({ type: "line", a: { x: 0.1 + 0.2, y: -12.345678901234 }, b: { x: 1e5 / 3, y: 7 } }, "CONTORNO_CORTE"),
  makeEntity({ type: "circle", c: { x: 50, y: 50 }, r: 12.5 }, "CONTORNO_CORTE", { color: 3 }),
  makeEntity({ type: "arc", c: { x: -20, y: 5 }, r: 7.25, a0: deg2rad(30), a1: deg2rad(300) }, "LINHAS_DOBRA"),
  makeEntity(
    { type: "polyline", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }], bulges: [0, 0.41421356237309503, 0, -0.2], closed: true },
    "CONTORNO_CORTE",
  ),
  makeEntity({ type: "point", p: { x: 3, y: 4 } }, "0"),
  makeEntity({ type: "text", p: { x: 10, y: 10 }, h: 3.5, rot: deg2rad(90), value: "DOBRA 90° Ø12 ±0,1 AÇÃO", halign: 1 }, "OCULTA"),
];

const OUT = new URL("../../../tests/output/", import.meta.url);

describe("escrita DXF R12", () => {
  it("números com precisão total e sem notação científica", () => {
    expect(num(0.1 + 0.2)).toBe("0.30000000000000004");
    expect(num(1e-7)).toBe("0.0000001");
    expect(num(5)).toBe("5.0");
    expect(num(-0)).toBe("0.0");
  });
  it("estrutura de seções e tabela de camadas", () => {
    const txt = writeDxfR12({ layers, entities: sample() });
    expect(txt.startsWith("  0\r\nSECTION\r\n  2\r\nHEADER")).toBe(true);
    expect(txt).toContain("AC1009");
    expect(txt).toContain("\r\nLINHAS_DOBRA\r\n");
    expect(txt.trimEnd().endsWith("EOF")).toBe(true);
    // camada oculta = cor negativa; bloqueada = flag 4
    expect(/LAYER\r\n  2\r\nOCULTA\r\n 70\r\n {5}4\r\n 62\r\n {4}-3/.test(txt)).toBe(true);
    expect(txt).toContain("%%d");
  });
  it("filtro de camadas exporta só o selecionado", () => {
    const txt = writeDxfR12({ layers, entities: sample() }, { layerFilter: ["LINHAS_DOBRA"] });
    const r = readDxf(txt);
    expect(r.entities.every((e) => e.layer === "LINHAS_DOBRA")).toBe(true);
    expect(r.entities).toHaveLength(1);
  });
});

describe("round-trip DXF (exportar → importar)", () => {
  const src = sample();
  const bytes = dxfBytes(writeDxfR12({ layers, entities: src }));
  const back = readDxf(bytes);

  it("decodifica Windows-1252", () => {
    expect(decodeDxfBytes(bytes).encoding).toBe("windows-1252");
  });
  it("preserva coordenadas exatamente", () => {
    const l = back.entities.find((e) => e.type === "line") as LineEntity;
    const s = src[0] as LineEntity;
    expect(l.a).toEqual(s.a);
    expect(l.b).toEqual(s.b);
    const c = back.entities.find((e) => e.type === "circle") as CircleEntity;
    expect(c.r).toBe(12.5);
    expect(c.color).toBe(3);
  });
  it("preserva arco e polilinha com bulges (comprimento)", () => {
    const a = back.entities.find((e) => e.type === "arc") as ArcEntity;
    expect(entityLength(a)).toBeCloseTo(entityLength(src[2]), 9);
    const p = back.entities.find((e) => e.type === "polyline") as PolylineEntity;
    expect(p.closed).toBe(true);
    expect(p.bulges).toEqual([0, 0.41421356237309503, 0, -0.2]);
    expect(entityLength(p)).toBeCloseTo(entityLength(src[3]), 9);
  });
  it("preserva camadas, cores, tipo de linha, visibilidade e bloqueio", () => {
    const L = (n: string) => back.layers.find((l) => l.name === n)!;
    expect(L("LINHAS_DOBRA").linetype).toBe("DASHED");
    expect(L("LINHAS_DOBRA").color).toBe(1);
    expect(L("OCULTA").visible).toBe(false);
    expect(L("OCULTA").locked).toBe(true);
  });
  it("preserva texto com símbolos técnicos e acentos", () => {
    const t = back.entities.find((e) => e.type === "text") as TextEntity;
    expect(t.value).toBe("DOBRA 90° Ø12 ±0,1 AÇÃO");
    expect(t.halign).toBe(1);
    expect(t.rot).toBeCloseTo(Math.PI / 2, 12);
  });
  it("número de entidades igual e sem não suportadas", () => {
    expect(back.entities).toHaveLength(src.length);
    expect(Object.keys(back.report.unsupported)).toHaveLength(0);
  });
});

const dxf = (...lines: (string | number)[]) => lines.join("\n") + "\n";

describe("importação de DXF de terceiros", () => {
  it("LWPOLYLINE + $INSUNITS em cm → convertido para mm", () => {
    const t = dxf(
      0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1015", 9, "$INSUNITS", 70, 5, 0, "ENDSEC",
      0, "SECTION", 2, "ENTITIES",
      0, "LWPOLYLINE", 8, "PECA", 90, 3, 70, 1, 10, 0, 20, 0, 10, 10, 20, 0, 42, 1, 10, 10, 20, 5,
      0, "ENDSEC", 0, "EOF",
    );
    const r = readDxf(t);
    expect(r.report.unitFactor).toBe(10);
    const p = r.entities[0] as PolylineEntity;
    expect(p.pts[1]).toEqual({ x: 100, y: 0 });
    expect(p.closed).toBe(true);
    expect(p.bulges[1]).toBe(1);
    expect(r.layers.some((l) => l.name === "PECA")).toBe(true);
  });
  it("sem unidade: assume mm e avisa", () => {
    const r = readDxf(dxf(0, "SECTION", 2, "ENTITIES", 0, "LINE", 8, "0", 10, 0, 20, 0, 11, 1, 21, 0, 0, "ENDSEC", 0, "EOF"));
    expect(r.report.unitSource).toBe("assumido");
    expect(r.report.warnings.join(" ")).toMatch(/milímetros/);
  });
  it("INSERT expande bloco com rotação, escala e camada herdada", () => {
    const t = dxf(
      0, "SECTION", 2, "BLOCKS",
      0, "BLOCK", 8, "0", 2, "FURO", 70, 0, 10, 0, 20, 0,
      0, "CIRCLE", 8, "0", 10, 10, 20, 0, 40, 2,
      0, "ENDBLK", 8, "0",
      0, "ENDSEC",
      0, "SECTION", 2, "ENTITIES",
      0, "INSERT", 8, "FUROS", 2, "FURO", 10, 100, 20, 100, 41, 2, 42, 2, 50, 90,
      0, "ENDSEC", 0, "EOF",
    );
    const r = readDxf(t);
    const c = r.entities[0] as CircleEntity;
    expect(c.layer).toBe("FUROS");
    expect(c.c.x).toBeCloseTo(100, 12);
    expect(c.c.y).toBeCloseTo(120, 12);
    expect(c.r).toBeCloseTo(4, 12);
  });
  it("arco com extrusão (0,0,−1) é espelhado corretamente", () => {
    const r = readDxf(dxf(0, "SECTION", 2, "ENTITIES", 0, "ARC", 8, "0", 10, 10, 20, 0, 30, 0, 40, 5, 50, 0, 51, 90, 210, 0, 220, 0, 230, -1, 0, "ENDSEC", 0, "EOF"));
    const a = r.entities[0] as ArcEntity;
    expect(a.c.x).toBe(-10);
    expect(a.a0).toBeCloseTo(Math.PI / 2, 12);
    expect(a.a1).toBeCloseTo(Math.PI, 12);
  });
  it("informa entidades não suportadas (sem simular)", () => {
    const r = readDxf(
      dxf(0, "SECTION", 2, "ENTITIES", 0, "SPLINE", 8, "0", 70, 8, 0, "HATCH", 8, "0", 0, "ELLIPSE", 8, "0", 0, "LINE", 8, "0", 10, 0, 20, 0, 11, 1, 21, 1, 0, "ENDSEC", 0, "EOF"),
    );
    expect(r.entities).toHaveLength(1);
    expect(r.report.unsupported).toEqual({ SPLINE: 1, HATCH: 1, ELLIPSE: 1 });
  });
  it("interpreta cota alinhada e de raio", () => {
    const r = readDxf(
      dxf(
        0, "SECTION", 2, "ENTITIES",
        0, "DIMENSION", 8, "COTAS", 2, "*D1", 10, 0, 20, -10, 13, 0, 23, 0, 14, 100, 24, 0, 70, 33,
        0, "DIMENSION", 8, "COTAS", 2, "*D2", 10, 5, 20, 5, 15, 8, 25, 9, 70, 4,
        0, "ENDSEC", 0, "EOF",
      ),
    );
    expect(r.entities).toHaveLength(2);
    const [a, b] = r.entities;
    expect(a.type === "dimension" && a.kind).toBe("aligned");
    expect(b.type === "dimension" && b.kind).toBe("radius");
  });
  it("DXF binário é recusado com mensagem clara", () => {
    const bin = new TextEncoder().encode("AutoCAD Binary DXF\r\n\x1a\x00xxxxxxxx");
    expect(() => readDxf(bin)).toThrow(/binário/);
  });
});

describe("planificação → DXF para corte", () => {
  it("contorno fechado e linhas de dobra em camadas separadas, dimensões reais", () => {
    const res = solveProfile(buildProfileInput({ ...PROFILE_DEFS.U.defaults(), fab: { material: "aco_carbono", process: "ar", toolName: "", vOpening: null, punchRadius: null, kTableId: "" } }));
    const ents = flatPatternEntities(res, { dims: true, notes: true });
    const lyr = SM_LAYERS.map((l) => ({ name: l.name, color: l.color, lineweight: l.lineweight, linetype: l.linetype, visible: true, locked: false }));
    const all = writeDxfR12({ layers: [DEFAULT_LAYER, ...lyr], entities: ents });
    const cut = writeDxfR12({ layers: [DEFAULT_LAYER, ...lyr], entities: ents }, { layerFilter: ["CONTORNO_CORTE", "LINHAS_DOBRA"] });
    const back = readDxf(cut);
    const contour = back.entities.filter((e) => e.layer === "CONTORNO_CORTE");
    expect(contour).toHaveLength(1);
    expect((contour[0] as PolylineEntity).closed).toBe(true);
    expect((contour[0] as PolylineEntity).pts[1].x).toBeCloseTo(res.developedLength, 12);
    expect(back.entities.filter((e) => e.layer === "LINHAS_DOBRA")).toHaveLength(2);
    expect(back.entities.some((e) => e.layer === "COTAS")).toBe(false);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(new URL("planificacao_U_completa.dxf", OUT), dxfBytes(all));
    writeFileSync(new URL("planificacao_U_corte.dxf", OUT), dxfBytes(cut));
    writeFileSync(new URL("roundtrip_amostra.dxf", OUT), dxfBytes(writeDxfR12({ layers, entities: sample() })));
  });
  it("documento completo exporta via CadDocument", () => {
    const d = new CadDocument();
    d.commit("x", d.addChanges(sample().filter((e) => e.layer === "0")));
    const r = readDxf(writeDxfR12({ layers: d.layers, entities: d.all(), dimStyle: d.settings.dimStyle }));
    expect(r.entities).toHaveLength(1);
  });
});
