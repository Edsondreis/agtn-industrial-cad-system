import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_LAYER } from "@agtn/document";
import { writeDxf } from "@agtn/dxf";
import { type Entity, deg2rad, makeEntity } from "@agtn/geometry";
import { flatEntities, flatPattern } from "./flat";
import { FLAT_LAYER, flatDxfInput, flatToDxf, validateFlatDxf } from "./flatdxf";
import type { Loop2, SheetOp } from "./model";
import { solveSheet } from "./solve";
import { aba, rectBase, spec } from "./testkit";

/**
 * ETAPA 2.6 — DXF direto da planificação + validação automática (relê o arquivo e confere com o grafo), e a
 * regressão do exportador 2D: bytes idênticos aos da base da ETAPA 2 (e463834).
 */
const OUT = "tests/output";
mkdirSync(OUT, { recursive: true });
const rect = (x0: number, y0: number, x1: number, y1: number, key = "r"): Loop2 => ({
  key,
  segs: [
    { t: "line", a: { x: x0, y: y0 }, b: { x: x1, y: y0 } },
    { t: "line", a: { x: x1, y: y0 }, b: { x: x1, y: y1 } },
    { t: "line", a: { x: x1, y: y1 }, b: { x: x0, y: y1 } },
    { t: "line", a: { x: x0, y: y1 }, b: { x: x0, y: y0 } },
  ],
});
const IDS = ["S@B/L1+L@B/L2", "L@B/L2+N@B/L3", "N@B/L3+O@B/L4", "O@B/L4+S@B/L1"];
const PARTS: [string, SheetOp[], ReturnType<typeof rectBase>][] = [
  [
    "bandeja_encosto",
    [aba("S", [["B", "L1"]], 25, 90), aba("L", [["B", "L2"]], 25, 90), aba("N", [["B", "L3"]], 25, 90), aba("O", [["B", "L4"]], 25, 90), ...IDS.map((id, i): SheetOp => ({ t: "canto", id: `C${i}`, label: `C${i}`, corners: [id], kind: "encosto", gap: 0.5, closer: i % 2 ? "b" : "a" }))],
    rectBase(200, 120),
  ],
  ["alivio_oblongo", [aba("A", [["B", "L1"]], 30, 90, { o0: 20, o1: 30 }), { t: "alivio", id: "AL", label: "AL", bends: ["A@B/L1"], kind: "oblongo", gap: 0.5 }], rectBase(100, 50)],
  ["recorte_cruzando", [aba("A", [["B", "L1"]], 30, 90), aba("C", [["B", "L3"]], 30, 90, { side: "baixo" }), { t: "recorte_plano", id: "RP", label: "RP", loops: [rect(40, -5, 60, 10)] }, { t: "recorte", id: "H", label: "H", flange: "B", loops: [{ segs: [{ t: "circle", c: { x: 20, y: 30 }, r: 4 }] }] }], rectBase(100, 50)],
];

describe("DXF direto da planificação", () => {
  for (const [name, ops, base] of PARTS)
    for (const version of ["R2000", "R12"] as const)
      it(`${name} ${version}: relido e conferido (fechado, sem duplicados/micro, área, corte, escala 1:1, dobras)`, () => {
        const s = solveSheet(spec(base, ...ops));
        expect(s.issues.filter((i) => i.level === "error")).toEqual([]);
        const fp = flatPattern(s);
        expect(fp.state).toBe("valida");
        const o = { version, regions: true, reference: true, title: name } as const;
        const txt = flatToDxf(fp, o);
        writeFileSync(`${OUT}/chapa3d_${name}_${version}.dxf`, txt);
        const rep = validateFlatDxf(txt, fp, o);
        expect(rep.checks.filter((c) => !c.ok)).toEqual([]);
        expect(rep.ok).toBe(true);
        if (version === "R2000") expect(txt).toMatch(/\$INSUNITS\r?\n 70\r?\n +4\r?\n/);
        else expect(txt).not.toMatch(/\$INSUNITS/);
      });
  it("recorte que atravessa a dobra interrompe a linha de dobra (2 trechos) e sai como contorno interno", () => {
    const [, ops, base] = PARTS[2];
    const fp = flatPattern(solveSheet(spec(base, ...ops)));
    const ents = flatDxfInput(fp).entities;
    expect(ents.filter((e) => e.layer === FLAT_LAYER.up).length).toBe(2); // D1 cortada em x 40…60
    expect(ents.filter((e) => e.layer === FLAT_LAYER.down).length).toBe(1); // D2 (baixo) inteira
    expect(ents.filter((e) => e.layer === FLAT_LAYER.inner).length).toBe(2); // rasgo + furo
  });
  it("níveis de conteúdo: só corte; corte + dobras; tudo", () => {
    const fp = flatPattern(solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90))));
    const layersOf = (o: Parameters<typeof flatDxfInput>[1]) => [...new Set(flatDxfInput(fp, o).entities.map((e) => e.layer))].sort();
    expect(layersOf({ bends: false, marks: false })).toEqual([FLAT_LAYER.outer]);
    expect(layersOf({ marks: false })).toEqual([FLAT_LAYER.up, FLAT_LAYER.outer].sort());
    expect(layersOf({ regions: true, reference: true })).toEqual([FLAT_LAYER.up, FLAT_LAYER.mark, FLAT_LAYER.region, FLAT_LAYER.outer, FLAT_LAYER.ref].sort());
  });
  it("a validação pega arquivo errado (escala, contorno aberto, área)", () => {
    const fp = flatPattern(solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90))));
    const input = flatDxfInput(fp);
    const scaled = writeDxf({ ...input, entities: input.entities.map((e) => (e.type === "polyline" ? { ...e, pts: e.pts.map((p) => ({ x: p.x * 1.001, y: p.y })) } : e)) }, { version: "R2000" });
    expect(validateFlatDxf(scaled, fp).ok).toBe(false);
    const open = writeDxf({ ...input, entities: input.entities.map((e) => (e.type === "polyline" ? { ...e, closed: false } : e)) }, { version: "R2000" });
    expect(validateFlatDxf(open, fp).checks.find((c) => c.name === "todos os contornos fechados")!.ok).toBe(false);
    const dup = writeDxf({ ...input, entities: [...input.entities, ...input.entities.filter((e) => e.type === "line").map((e) => ({ ...e, id: `${e.id}x` }))] }, { version: "R2000" });
    expect(validateFlatDxf(dup, fp).checks.find((c) => c.name === "sem entidades duplicadas")!.ok).toBe(false);
  });
});

describe("exportador 2D intocado: bytes idênticos aos da base e463834", () => {
  // hashes medidos com o código da base da ETAPA 2 (worktree em e463834), mesma entrada com ids fixos
  const layers = [DEFAULT_LAYER, { name: "CORTE", color: 7, lineweight: 0.35, linetype: "CONTINUOUS", visible: true, locked: false }];
  const ents = (): Entity[] => [
    makeEntity({ type: "line", a: { x: 0.1 + 0.2, y: -12.345678901234 }, b: { x: 1e5 / 3, y: 7 } }, "CORTE", { lineweight: 0.5 }, "E1"),
    makeEntity({ type: "circle", c: { x: 50, y: 50 }, r: 12.5 }, "CORTE", { color: 3 }, "E2"),
    makeEntity({ type: "arc", c: { x: -20, y: 5 }, r: 7.25, a0: deg2rad(30), a1: deg2rad(300) }, "CORTE", {}, "E3"),
    makeEntity({ type: "polyline", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }], bulges: [0, -0.3, 0], closed: true }, "CORTE", {}, "E4"),
    makeEntity({ type: "text", p: { x: 10, y: 10 }, h: 3.5, rot: 0, value: "DOBRA 90° Ø12", halign: 1 }, "0", {}, "E5"),
  ];
  const h = (t: string) => createHash("sha256").update(t).digest("hex");
  it("R12, R2000 e a planificação da ETAPA 1 enviada ao DESENHO", () => {
    expect(h(writeDxf({ layers, entities: ents() }, { version: "R12" }))).toBe("948963b9aa6d655fd1402fd1964d119c634122566c5a1354519793cb8d8c115d");
    expect(h(writeDxf({ layers, entities: ents() }, { version: "R2000" }))).toBe("9d0ee2103bbca739d7f9c314926241cb3e9c211bf4cb55479861218b7427302b");
    const fe = flatEntities(flatPattern(solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90)))), { title: "x" }).map((e, i) => ({ ...e, id: `F${i}` }));
    expect(h(writeDxf({ layers, entities: fe }, { version: "R12" }))).toBe("33214303b6ae092d17fb6ee6919fd804f8d161d6e62a525087c7dc271caa68c1");
  });
});
