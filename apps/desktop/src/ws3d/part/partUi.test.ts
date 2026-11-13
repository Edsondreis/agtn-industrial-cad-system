import { addFeature, emptyModel, newPart, setPlacement } from "@agtn/model3d";
import { addRectangle, emptySketch } from "@agtn/sketch";
import type { Feature } from "@agtn/solid";
import { describe, expect, it } from "vitest";
import { DRAFT_ID, axisLines, defaultDraft, featureSummary, hasSolidBefore, regionsOf, stdFrame, withDraft, worldFrame } from "./partUi";

const rectSketch = () => addRectangle(emptySketch(), { x: 0, y: 0 }, { x: 100, y: 50 }).s;

describe("partUi — auxiliares da interface paramétrica", () => {
  it("rascunho padrão: primeira extrusão é 'novo sólido', depois 'unir'; usa o último esboço", () => {
    const sk: Feature = { id: "s1", name: "Esboço_1", t: "sketch", plane: { t: "std", plane: "XY", offset: 0 }, sketch: rectSketch() };
    const d0 = defaultDraft("extrude", [sk], 1);
    expect(d0).toMatchObject({ t: "extrude", sketch: "s1", op: "new", depth: 10 });
    const ex = { ...(d0 as object), id: "e1", name: "Extrusão_1" } as Feature;
    expect(hasSolidBefore([sk, ex], 2)).toBe(true);
    expect(defaultDraft("extrude", [sk, ex], 2)).toMatchObject({ op: "join" });
    expect(defaultDraft("combine", [sk, ex], 2, { op: "cut" })).toMatchObject({ t: "combine", op: "cut", tools: [] });
    // padrão: alvo padrão = última operação com sólido próprio (não a arestas/chanfros)
    const fil = { id: "f1", name: "Arredondar_1", t: "fillet", edges: [], r: 1 } as unknown as Feature;
    expect(defaultDraft("pattern", [sk, ex, fil], 3)).toMatchObject({ targets: ["e1"] });
  });

  it("prévia: rascunho novo entra na posição de inserção; em edição substitui mantendo o id", () => {
    const a = { id: "a", name: "A", t: "sketch", plane: { t: "std", plane: "XY", offset: 0 }, sketch: emptySketch() } as Feature;
    const b = { id: "b", name: "B", t: "fillet", edges: [], r: 1, suppressed: true } as unknown as Feature;
    const ins = withDraft([a, b], 1, null, { t: "chamfer", edges: [], d: 2 }, "Chanfro_1");
    expect(ins.map((f) => f.id)).toEqual(["a", DRAFT_ID, "b"]);
    const ed = withDraft([a, b], 1, "b", { t: "fillet", edges: [], r: 3 }, "B");
    expect(ed.map((f) => f.id)).toEqual(["a", "b"]);
    expect(ed[1]).toMatchObject({ r: 3, suppressed: true });
  });

  it("plano do esboço no mundo acompanha o posicionamento do corpo", () => {
    let m = emptyModel();
    const r = newPart(m, {});
    m = setPlacement(r.model, r.id, { origin: { x: 100, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 90 } });
    const f = worldFrame(m, r.id, stdFrame("XY", 10));
    expect(f.o.x).toBeCloseTo(100);
    expect(f.o.z).toBeCloseTo(10);
    expect(f.x.y).toBeCloseTo(1); // X local girado 90° em Z → Y do mundo
    expect(f.n.z).toBeCloseTo(1);
    // sem corpo (nova peça): plano padrão
    expect(worldFrame(m, null, stdFrame("XZ", 0)).n).toEqual({ x: 0, y: -1, z: 0 });
  });

  it("regiões e eixos do esboço para os campos do painel", () => {
    const s = rectSketch();
    const info = regionsOf(s);
    expect(info.regions).toHaveLength(1);
    expect(info.regions[0].area).toBeCloseTo(5000);
    expect(axisLines(s).map((a) => a.id).slice(0, 2)).toEqual(["AX", "AY"]);
    expect(axisLines(s)).toHaveLength(6);
  });

  it("resumo de parâmetros na árvore", () => {
    let m = emptyModel();
    const p = newPart(m, {});
    m = p.model;
    const s = addFeature(m, p.id, { t: "sketch", plane: { t: "std", plane: "XY", offset: 0 }, sketch: rectSketch() });
    const x = addFeature(s.model, p.id, { t: "extrude", sketch: s.id, regions: null, depth: 25, mode: "symmetric", depth2: 0, reverse: false, through: false, op: "new" });
    const feats = (x.model.nodes[p.id] as Extract<(typeof x.model.nodes)[string], { kind: "body" }>).source as { features: readonly Feature[] };
    expect(featureSummary(feats.features[1])).toBe("25 mm simétrica · novo");
    expect(featureSummary({ id: "h", name: "Furo_1", t: "hole", sketch: "s", d: 8.5, depth: 10, through: true, reverse: false, cbore: { d: 15, depth: 5 }, csink: null })).toBe("Ø8,5 passante · rebaixo");
  });
});
