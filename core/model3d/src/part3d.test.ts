import { CadDocument, deserializeInto, serializeDocument } from "@agtn/document";
import {
  BodyCache,
  addBody,
  addFeature,
  commitModel,
  convertToPart,
  dependentsOf,
  emptyModel,
  getModel,
  modelToStepTree,
  newPart,
  partOf,
  removeFeature,
  setRollback,
  setSuppressed,
  updateFeature,
} from "@agtn/model3d";
import { addCircle, addConstraint, addRectangle, emptySketch, solve } from "@agtn/sketch";
import { type FeatureDraft, OcctSolidKernel, PartEvaluator } from "@agtn/solid";

let k: OcctSolidKernel;
beforeAll(async () => {
  k = await OcctSolidKernel.create();
});
afterAll(() => k.dispose());
const PI = Math.PI;
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));

function rect(w: number, h: number) {
  let s = emptySketch();
  const r = addRectangle(s, { x: 1, y: 1 }, { x: w - 1, y: h - 1 });
  s = addConstraint(r.s, { t: "coincident", a: r.points[0], b: "O" }).s;
  s = addConstraint(s, { t: "length", l: r.lines[0], v: w }).s;
  s = addConstraint(s, { t: "length", l: r.lines[1], v: h }).s;
  return solve(s).sketch;
}
const ext = (sketch: string, depth: number, op: "new" | "join" | "cut" = "new", through = false): FeatureDraft => ({ t: "extrude", sketch, regions: null, depth, mode: "one", depth2: 0, reverse: false, through, op });

/** Peça: chapa 200×100×10 com furo Ø40 passante. */
function plate() {
  let m = emptyModel();
  const p = newPart(m, { name: "CHAPA" });
  m = p.model;
  const s1 = addFeature(m, p.id, { t: "sketch", plane: { t: "std", plane: "XY", offset: 0 }, sketch: rect(200, 100) });
  m = s1.model;
  const e1 = addFeature(m, p.id, ext(s1.id, 10));
  m = e1.model;
  const s2 = addFeature(m, p.id, { t: "sketch", plane: { t: "std", plane: "XY", offset: 0 }, sketch: addCircle(emptySketch(), { x: 100, y: 50 }, 20).s });
  m = s2.model;
  const e2 = addFeature(m, p.id, ext(s2.id, 0, "cut", true));
  m = e2.model;
  return { m, id: p.id, s1: s1.id, e1: e1.id, s2: s2.id, e2: e2.id };
}
const cacheOf = () => new BodyCache(k, new PartEvaluator(k));

describe("peça paramétrica no documento", () => {
  it("nomes automáticos e volume exato", () => {
    const p = plate();
    expect(partOf(p.m, p.id).part.features.map((f) => f.name)).toEqual(["Esboço_1", "Extrusão_1", "Esboço_2", "Extrusão_2"]);
    const c = cacheOf();
    const r = c.sync(p.m);
    expect(r.errors).toEqual({});
    expect(r.features[p.id].every((s) => s.state === "ok")).toBe(true);
    expect(rel(k.props(c.get(p.id)!).volume, (20000 - PI * 400) * 10)).toBeLessThan(1e-9);
    c.clear();
  });
  it("editar operação anterior regenera as dependentes; Undo/Redo restaura", () => {
    const p = plate();
    const doc = new CadDocument();
    commitModel(doc, "peça", p.m);
    commitModel(doc, "profundidade", updateFeature(getModel(doc), p.id, p.e1, ext(p.s1, 25)));
    const c = cacheOf();
    c.sync(getModel(doc));
    expect(rel(k.props(c.get(p.id)!).volume, (20000 - PI * 400) * 25)).toBeLessThan(1e-9);
    doc.undo();
    c.sync(getModel(doc));
    expect(rel(k.props(c.get(p.id)!).volume, (20000 - PI * 400) * 10)).toBeLessThan(1e-9);
    doc.redo();
    c.sync(getModel(doc));
    expect(rel(k.props(c.get(p.id)!).volume, (20000 - PI * 400) * 25)).toBeLessThan(1e-9);
    c.clear();
  });
  it("salvar e reabrir o .agtncad: mesma árvore e mesmo volume", () => {
    const p = plate();
    const doc = new CadDocument();
    commitModel(doc, "peça", p.m);
    const doc2 = new CadDocument();
    deserializeInto(doc2, serializeDocument(doc));
    const m2 = getModel(doc2);
    expect(partOf(m2, p.id).part.features.length).toBe(4);
    const c = cacheOf();
    c.sync(m2);
    expect(rel(k.props(c.get(p.id)!).volume, (20000 - PI * 400) * 10)).toBeLessThan(1e-9);
    c.clear();
  });
  it("dependências: excluir esboço exige cascata; suprimir e recuar", () => {
    const p = plate();
    expect(dependentsOf(partOf(p.m, p.id).part.features, p.s2)).toEqual([p.e2]);
    expect(() => removeFeature(p.m, p.id, p.s2, false)).toThrow(/Usada por: Extrusão_2/);
    const m2 = removeFeature(p.m, p.id, p.s2, true);
    expect(partOf(m2, p.id).part.features.length).toBe(2);
    const c = cacheOf();
    c.sync(setSuppressed(p.m, p.id, p.e2, true));
    expect(rel(k.props(c.get(p.id)!).volume, 200000)).toBeLessThan(1e-12);
    const rb = setRollback(p.m, p.id, 2);
    c.sync(rb);
    expect(rel(k.props(c.get(p.id)!).volume, 200000)).toBeLessThan(1e-12);
    // operação nova entra na barra de recuo
    const add = addFeature(rb, p.id, { t: "sketch", plane: { t: "std", plane: "XY", offset: 0 }, sketch: emptySketch() });
    expect(add.index).toBe(2);
    expect(partOf(add.model, p.id).part.rollback).toBe(3);
    c.clear();
  });
  it("peça só com esboço não tem sólido (sem erro)", () => {
    let m = emptyModel();
    const p = newPart(m);
    m = addFeature(p.model, p.id, { t: "sketch", plane: { t: "std", plane: "XY", offset: 0 }, sketch: rect(10, 10) }).model;
    const c = cacheOf();
    const r = c.sync(m);
    expect(r.empty).toEqual([p.id]);
    expect(r.errors).toEqual({});
  });
  it("combinar corpos: chapa − cilindro de outro corpo (posições no mundo)", () => {
    const p = plate();
    let m = addBody(p.m, { name: "PINO", placement: { origin: { x: 20, y: 20, z: -5 }, rot: { x: 0, y: 0, z: 0 } }, source: { type: "primitive", spec: { kind: "cylinder", r: 5, h: 20 } } }).model;
    const pino = Object.values(m.nodes).find((n) => n.name === "PINO")!.id;
    m = addFeature(m, p.id, { t: "combine", op: "cut", tools: [pino] }).model;
    const c = cacheOf();
    const r = c.sync(m);
    expect(r.errors).toEqual({});
    expect(rel(k.props(c.get(p.id)!).volume, (20000 - PI * 400 - PI * 25) * 10)).toBeLessThan(1e-9);
    // mover o pino regenera a chapa
    const m2 = { ...m, nodes: { ...m.nodes, [pino]: { ...m.nodes[pino], placement: { origin: { x: 300, y: 300, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } };
    const r2 = c.sync(m2);
    expect(r2.built).toContain(p.id);
    expect(rel(k.props(c.get(p.id)!).volume, (20000 - PI * 400) * 10)).toBeLessThan(1e-9);
    c.clear();
  });
  it("primitiva convertida em peça recebe operações; STEP exporta a peça", () => {
    let m = addBody(emptyModel(), { name: "BLOCO", source: { type: "primitive", spec: { kind: "box", w: 50, d: 50, h: 50 } } }).model;
    const id = Object.keys(m.nodes)[0];
    m = convertToPart(m, id);
    m = addFeature(m, id, { t: "sketch", plane: { t: "std", plane: "XY", offset: 50 }, sketch: addCircle(emptySketch(), { x: 25, y: 25 }, 10).s }).model;
    const sid = partOf(m, id).part.features[1].id;
    m = addFeature(m, id, ext(sid, 20, "join")).model;
    const c = cacheOf();
    c.sync(m);
    expect(rel(k.props(c.get(id)!).volume, 125000 + PI * 100 * 20)).toBeLessThan(1e-9);
    const tree = modelToStepTree(k, m, undefined, () => k.toBrep(c.get(id)!));
    expect(tree.length).toBe(1);
    const back = k.importStepTree(k.exportStepTree(tree));
    expect(back.length).toBeGreaterThan(0);
    c.clear();
  });
});
