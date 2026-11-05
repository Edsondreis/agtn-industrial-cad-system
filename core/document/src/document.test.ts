import { describe, expect, it } from "vitest";
import { type DimensionEntity, type LineEntity, makeEntity, transformEntity, translation } from "@agtn/geometry";
import { CadDocument, SelectionSet, deserializeInto, findPointRef, serializeDocument, validateLayerName } from "./index";

const line = (ax: number, ay: number, bx: number, by: number, layer = "0"): LineEntity =>
  makeEntity({ type: "line", a: { x: ax, y: ay }, b: { x: bx, y: by } }, layer);

describe("CadDocument — transações e Undo/Redo", () => {
  it("add / undo / redo", () => {
    const d = new CadDocument();
    const l = line(0, 0, 10, 0);
    d.commit("Linha", d.addChanges([l]));
    expect(d.size).toBe(1);
    expect(d.dirty).toBe(true);
    d.undo();
    expect(d.size).toBe(0);
    d.redo();
    expect(d.get(l.id)).toEqual(l);
  });
  it("update reversível restaura geometria exata", () => {
    const d = new CadDocument();
    const l = line(0.1, 0.2, 10.3, 0.4);
    d.commit("Linha", d.addChanges([l]));
    const moved = transformEntity(l, translation(1e-7, 1234.5678));
    d.commit("Mover", d.updateChanges([moved]));
    expect(d.get(l.id)).toEqual(moved);
    d.undo();
    expect(d.get(l.id)).toEqual(l);
  });
  it("nova operação limpa a pilha de redo", () => {
    const d = new CadDocument();
    d.commit("a", d.addChanges([line(0, 0, 1, 0)]));
    d.undo();
    expect(d.canRedo).toBe(true);
    d.commit("b", d.addChanges([line(0, 0, 2, 0)]));
    expect(d.canRedo).toBe(false);
  });
  it("múltiplas alterações em uma transação são desfeitas juntas", () => {
    const d = new CadDocument();
    const a = line(0, 0, 1, 0);
    const b = line(0, 0, 0, 1);
    d.commit("x", d.addChanges([a, b]));
    d.commit("apagar", d.removeChanges([a.id, b.id]));
    expect(d.size).toBe(0);
    d.undo();
    expect(d.size).toBe(2);
    expect(d.all().map((e) => e.id)).toEqual([a.id, b.id]);
  });
  it("estado salvo e alterações não salvas", () => {
    const d = new CadDocument();
    d.commit("a", d.addChanges([line(0, 0, 1, 0)]));
    d.markSaved();
    expect(d.dirty).toBe(false);
    d.commit("b", d.addChanges([line(0, 0, 2, 0)]));
    expect(d.dirty).toBe(true);
  });
});

describe("camadas", () => {
  it("criar, renomear (com entidades) e desfazer", () => {
    const d = new CadDocument();
    d.commit("nova", [d.layerAddChange({ name: "CORTE", color: 1, lineweight: 0.35, linetype: "CONTINUOUS", visible: true, locked: false })]);
    const l = line(0, 0, 1, 1, "CORTE");
    d.commit("l", d.addChanges([l]));
    d.commit("ren", d.layerRenameChanges("CORTE", "CONTORNO_CORTE"));
    expect(d.get(l.id)!.layer).toBe("CONTORNO_CORTE");
    expect(d.layer("CORTE")).toBeUndefined();
    d.undo();
    expect(d.get(l.id)!.layer).toBe("CORTE");
  });
  it("não exclui camada com objetos, nem a camada 0", () => {
    const d = new CadDocument();
    expect(() => d.layerRemoveChanges("0")).toThrow();
    d.commit("nova", [d.layerAddChange({ name: "A", color: 2, lineweight: 0.25, linetype: "CONTINUOUS", visible: true, locked: false })]);
    d.commit("l", d.addChanges([line(0, 0, 1, 1, "A")]));
    expect(() => d.layerRemoveChanges("A")).toThrow();
  });
  it("camada bloqueada/oculta não é selecionável", () => {
    const d = new CadDocument();
    d.commit("nova", [d.layerAddChange({ name: "B", color: 3, lineweight: 0.25, linetype: "CONTINUOUS", visible: true, locked: true })]);
    d.commit("l", d.addChanges([line(0, 0, 10, 0, "B")]));
    expect(d.hitTest({ x: 5, y: 0 }, 1)).toBeNull();
  });
  it("valida nomes compatíveis com DXF R12", () => {
    expect(validateLayerName("LINHAS_DOBRA")).toBeNull();
    expect(validateLayerName("ANOTAÇÕES")).not.toBeNull();
  });
});

describe("seleção espacial", () => {
  const d = new CadDocument();
  const a = line(0, 0, 10, 0);
  const b = line(20, 0, 30, 10);
  d.commit("x", d.addChanges([a, b]));
  it("hit test", () => {
    expect(d.hitTest({ x: 5, y: 0.2 }, 0.5)?.id).toBe(a.id);
  });
  it("janela seleciona só objetos contidos", () => {
    expect(d.selectBox({ minX: -1, minY: -1, maxX: 15, maxY: 5 }, false).map((e) => e.id)).toEqual([a.id]);
  });
  it("cruzamento seleciona quem cruza a borda", () => {
    const ids = d.selectBox({ minX: 5, minY: -1, maxX: 25, maxY: 2 }, true).map((e) => e.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });
  it("seleção por tipo", () => {
    const s = new SelectionSet(d);
    s.selectByType(["line"]);
    expect(s.size).toBe(2);
    s.selectByType(["circle"]);
    expect(s.size).toBe(0);
  });
});

describe("cotas associativas", () => {
  it("cota acompanha a linha ao mover extremidade e o undo restaura", () => {
    const d = new CadDocument();
    const l = line(0, 0, 100, 0);
    d.commit("l", d.addChanges([l]));
    const dim = makeEntity(
      {
        type: "dimension",
        kind: "aligned",
        p1: l.a,
        p2: l.b,
        loc: { x: 50, y: -10 },
        rot: 0,
        textOverride: null,
        assoc: { p1: findPointRef(l, l.a)!, p2: findPointRef(l, l.b)! },
      },
      "0",
    ) as DimensionEntity;
    d.commit("cota", d.addChanges([dim]));
    d.commit("alterar", d.updateChanges([{ ...l, b: { x: 150, y: 0 } }]));
    const nd = d.get(dim.id) as DimensionEntity;
    expect(nd.p2.x).toBe(150);
    d.undo();
    expect((d.get(dim.id) as DimensionEntity).p2.x).toBe(100);
  });
  it("cota perde associação quando a entidade é apagada", () => {
    const d = new CadDocument();
    const l = line(0, 0, 100, 0);
    d.commit("l", d.addChanges([l]));
    const dim = makeEntity(
      { type: "dimension", kind: "aligned", p1: l.a, p2: l.b, loc: { x: 50, y: -10 }, rot: 0, textOverride: null, assoc: { p1: { id: l.id, key: "a" }, p2: { id: l.id, key: "b" } } },
      "0",
    );
    d.commit("cota", d.addChanges([dim]));
    d.commit("apagar", d.removeChanges([l.id]));
    expect((d.get(dim.id) as DimensionEntity).assoc).toBeNull();
  });
});

describe("formato nativo .agtncad", () => {
  it("ida e volta preserva coordenadas exatas, camadas, extras e unidade", () => {
    const d = new CadDocument();
    d.commit("c", [d.layerAddChange({ name: "LINHAS_DOBRA", color: 5, lineweight: 0.18, linetype: "DASHED", visible: true, locked: false })]);
    const l = line(0.1 + 0.2, Math.PI, 1e6 / 3, -Math.E, "LINHAS_DOBRA");
    d.commit("l", d.addChanges([l]));
    d.commit("u", [d.settingsChange({ units: "cm" }), d.extraChange("sheetmetal", { kTables: [{ id: "x", k: 0.42 }] })]);
    const text = serializeDocument(d);
    const d2 = new CadDocument();
    const rep = deserializeInto(d2, text);
    expect(rep.loaded).toBe(1);
    expect(d2.get(l.id)).toEqual(l);
    expect(d2.layer("LINHAS_DOBRA")?.linetype).toBe("DASHED");
    expect(d2.settings.units).toBe("cm");
    expect(d2.extras.sheetmetal).toEqual({ kTables: [{ id: "x", k: 0.42 }] });
    expect(d2.dirty).toBe(false);
  });
  it("rejeita arquivo estranho e ignora entidades inválidas", () => {
    const d = new CadDocument();
    expect(() => deserializeInto(d, "{}")).toThrow();
    expect(() => deserializeInto(d, "não é json")).toThrow();
    const rep = deserializeInto(
      d,
      JSON.stringify({
        format: "agtncad",
        version: 1,
        layers: [],
        entities: [{ type: "line", id: "1", layer: "0", a: { x: 0, y: 0 }, b: { x: "x", y: 0 } }, { type: "spline", id: "2", layer: "0" }],
      }),
    );
    expect(rep.loaded).toBe(0);
    expect(rep.skipped).toHaveLength(2);
  });
});
