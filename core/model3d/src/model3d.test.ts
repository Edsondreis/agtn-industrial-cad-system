import { CadDocument, deserializeInto, serializeDocument } from "@agtn/document";
import {
  BodyCache,
  MODEL3D_KEY,
  addBody,
  addGroup,
  bodies,
  checkLoadedModel,
  commitModel,
  duplicate,
  emptyModel,
  getModel,
  groupNodes,
  insertStepTree,
  isShown,
  massKg,
  modelToStepTree,
  parseModel3D,
  pathOf,
  remove,
  rename,
  reparent,
  setPlacement,
  setPrimitive,
  setVisible,
  worldMatrix,
} from "@agtn/model3d";
import { OcctSolidKernel, applyMatrix } from "@agtn/solid";

let k: OcctSolidKernel;
beforeAll(async () => {
  k = await OcctSolidKernel.create();
});
afterAll(() => k.dispose());

const at = (x: number, y: number, z: number, rz = 0) => ({ origin: { x, y, z }, rot: { x: 0, y: 0, z: rz } });

/** Estrutura de teste: SUPORTE (conjunto em x=1000) com base + 2 colunas; e um tubo solto. */
function sample() {
  let m = emptyModel();
  const g = addGroup(m, { name: "SUPORTE", placement: at(1000, 0, 0) });
  m = g.model;
  const base = addBody(m, { name: "BASE", parent: g.id, source: { type: "primitive", spec: { kind: "box", w: 400, d: 200, h: 12 } } });
  m = base.model;
  const c1 = addBody(m, { name: "COLUNA_1", parent: g.id, placement: at(20, 20, 12), source: { type: "primitive", spec: { kind: "profile", length: 800, profile: { shape: "U", h: 100, b: 50, tw: 6, tf: 8 } } } });
  m = c1.model;
  const c2 = addBody(m, { name: "COLUNA_2", parent: g.id, placement: at(330, 20, 12), source: { type: "primitive", spec: { kind: "profile", length: 800, profile: { shape: "U", h: 100, b: 50, tw: 6, tf: 8 } } } });
  m = c2.model;
  const tube = addBody(m, { source: { type: "primitive", spec: { kind: "tube", od: 60.3, t: 3.91, h: 500 } } });
  m = tube.model;
  return { m, g: g.id, base: base.id, c1: c1.id, c2: c2.id, tube: tube.id };
}

describe("árvore do modelo 3D", () => {
  it("cria conjuntos e corpos com nomes automáticos e caminhos", () => {
    const s = sample();
    expect(s.m.roots).toEqual([s.g, s.tube]);
    expect(s.m.nodes[s.tube].name).toBe("Tubo 1");
    expect(pathOf(s.m, s.c1)).toBe("SUPORTE › COLUNA_1");
    expect(bodies(s.m).map((b) => b.name)).toEqual(["BASE", "COLUNA_1", "COLUNA_2", "Tubo 1"]);
  });
  it("posição no mundo compõe conjunto → peça", () => {
    const s = sample();
    const p = applyMatrix(worldMatrix(s.m, s.c2), { x: 0, y: 0, z: 0 });
    expect(p).toEqual({ x: 1330, y: 20, z: 12 });
    const rot = setPlacement(s.m, s.g, at(0, 0, 0, 90));
    const q = applyMatrix(worldMatrix(rot, s.c2), { x: 0, y: 0, z: 0 });
    expect(q.x).toBeCloseTo(-20, 9);
    expect(q.y).toBeCloseTo(330, 9);
  });
  it("ocultar o conjunto oculta os filhos; renomear valida", () => {
    const s = sample();
    const h = setVisible(s.m, [s.g], false);
    expect(isShown(h, s.c1)).toBe(false);
    expect(isShown(h, s.tube)).toBe(true);
    expect(rename(s.m, s.c1, "  COLUNA ESQ  ").nodes[s.c1].name).toBe("COLUNA ESQ");
    expect(() => rename(s.m, s.c1, "   ")).toThrow(/vazio/);
  });
  it("remover conjunto remove a subárvore; mover não permite ciclo", () => {
    const s = sample();
    const r = remove(s.m, [s.g]);
    expect(Object.keys(r.nodes)).toEqual([s.tube]);
    expect(r.roots).toEqual([s.tube]);
    const sub = addGroup(s.m, { name: "SUB", parent: s.g });
    expect(() => reparent(sub.model, s.g, sub.id)).toThrow(/dentro dele mesmo/);
    const moved = reparent(s.m, s.tube, s.g);
    expect(moved.roots).toEqual([s.g]);
    const gn = moved.nodes[s.g];
    expect(gn.kind === "group" ? gn.children : []).toContain(s.tube);
  });
  it("agrupar e duplicar", () => {
    const s = sample();
    const g = groupNodes(s.m, [s.c1, s.c2], "COLUNAS");
    expect(pathOf(g.model, s.c1)).toBe("SUPORTE › COLUNAS › COLUNA_1");
    const d = duplicate(g.model, g.id, { x: 0, y: 500, z: 0 });
    expect(bodies(d.model).length).toBe(6);
    expect(d.model.nodes[d.id].name).toBe("COLUNAS 1");
    expect(() => groupNodes(s.m, [s.c1, s.tube])).toThrow(/mesmo nível/);
  });
  it("editar parâmetros valida a primitiva", () => {
    const s = sample();
    expect(() => setPrimitive(s.m, s.base, { kind: "box", w: -1, d: 1, h: 1 })).toThrow(/maior que zero/);
    expect(() => addBody(s.m, { source: { type: "primitive", spec: { kind: "sphere", r: 0 } } })).toThrow();
  });
});

describe("documento: undo/redo e .agtncad", () => {
  it("cada edição é uma transação desfazível", () => {
    const doc = new CadDocument();
    const s = sample();
    commitModel(doc, "Criar suporte", s.m);
    commitModel(doc, "Renomear", rename(getModel(doc), s.c1, "X"));
    expect(getModel(doc).nodes[s.c1].name).toBe("X");
    doc.undo();
    expect(getModel(doc).nodes[s.c1].name).toBe("COLUNA_1");
    doc.undo();
    expect(getModel(doc).roots).toEqual([]);
    doc.redo();
    expect(bodies(getModel(doc)).length).toBe(4);
    expect(commitModel(doc, "nada", getModel(doc))).toBe(false);
  });

  it("salvar e reabrir preserva árvore, posições e geometria (mesmos volumes no kernel)", () => {
    const doc = new CadDocument();
    const s = sample();
    commitModel(doc, "modelo", s.m);
    const text = serializeDocument(doc);
    const doc2 = new CadDocument();
    deserializeInto(doc2, text);
    expect(checkLoadedModel(doc2)).toEqual([]);
    const m2 = getModel(doc2);
    expect(m2).toEqual(JSON.parse(JSON.stringify(s.m)));
    const c1 = new BodyCache(k);
    const c2 = new BodyCache(k);
    expect(c1.sync(s.m).errors).toEqual({});
    expect(c2.sync(m2).errors).toEqual({});
    for (const b of bodies(s.m)) {
      const p1 = k.props(c1.get(b.id)!);
      const p2 = k.props(c2.get(b.id)!);
      expect(p2.volume).toBe(p1.volume);
      expect(p2.bbox).toEqual(p1.bbox);
    }
    // COLUNA_2 no mundo: conjunto x=1000 + 330
    expect(k.props(c2.get(s.c2)!).bbox.min.x).toBeCloseTo(1330, 9);
    c1.clear();
    c2.clear();
  });

  it("2D e 3D convivem no mesmo arquivo sem interferência", () => {
    const doc = new CadDocument();
    doc.commit("linha", [{ kind: "add", e: { type: "line", id: "L1", layer: "0", color: null, lineweight: null, linetype: null, a: { x: 0, y: 0 }, b: { x: 10, y: 0 } } }]);
    commitModel(doc, "3D", sample().m);
    const doc2 = new CadDocument();
    deserializeInto(doc2, serializeDocument(doc));
    expect(doc2.size).toBe(1);
    expect(bodies(getModel(doc2)).length).toBe(4);
  });

  it("arquivo antigo (sem 3D) abre com modelo vazio", () => {
    const doc = new CadDocument();
    expect(getModel(doc).roots).toEqual([]);
  });

  it("dados corrompidos: descarta o inválido, conserta referências, avisa", () => {
    const s = sample();
    const raw = JSON.parse(JSON.stringify(s.m));
    raw.nodes[s.base].source.spec.w = -5; // primitiva inválida
    raw.nodes["fantasma"] = { id: "fantasma", kind: "body", name: "Órfão", parent: "nao-existe", visible: true, placement: at(0, 0, 0), source: { type: "primitive", spec: { kind: "sphere", r: 5 } }, color: "#ffffff", material: "aco_carbono" };
    raw.nodes[s.g].children.push("nao-existe");
    const rep = parseModel3D(raw);
    expect(rep.model.nodes[s.base]).toBeUndefined();
    const rg = rep.model.nodes[s.g];
    expect(rg.kind === "group" ? rg.children : []).toEqual([s.c1, s.c2]);
    expect(rep.model.roots).toContain("fantasma");
    expect(rep.warnings.length).toBeGreaterThanOrEqual(2);
    expect(() => parseModel3D({ version: 99, nodes: {}, roots: [] })).toThrow(/versão mais nova/);
    expect(parseModel3D("lixo").warnings[0]).toMatch(/ilegíveis/);
  });

  it("modelo gravado em extras com a chave agtn3d", () => {
    const doc = new CadDocument();
    commitModel(doc, "m", sample().m);
    expect(JSON.parse(serializeDocument(doc)).extras[MODEL3D_KEY].roots.length).toBe(2);
  });
});

describe("cache de sólidos (regeneração incremental)", () => {
  it("só regenera o que mudou e libera o que saiu", () => {
    const s = sample();
    const c = new BodyCache(k);
    expect(c.sync(s.m).built.length).toBe(4);
    expect(c.sync(s.m).built.length).toBe(0);
    // mover o conjunto regenera os 3 filhos, não o tubo
    const moved = setPlacement(s.m, s.g, at(0, 0, 0));
    expect(c.sync(moved).built.sort()).toEqual([s.base, s.c1, s.c2].sort());
    const r = c.sync(remove(moved, [s.tube]));
    expect(r.removed).toEqual([s.tube]);
    c.clear();
  });
  it("massa pelo material (aço carbono 7,85)", () => {
    expect(massKg(1e6, "aco_carbono")).toBeCloseTo(7.85, 12);
  });
});

describe("STEP de montagem ↔ modelo", () => {
  it("exporta o suporte e reimporta com conjuntos, nomes e posições", () => {
    const s = sample();
    const step = k.exportStepTree(modelToStepTree(k, s.m));
    const back = insertStepTree(emptyModel(), k.importStepTree(step), "suporte.step");
    const names = bodies(back.model).map((b) => b.name).sort();
    expect(names).toEqual(["BASE", "COLUNA_1", "COLUNA_2", "Tubo 1"]);
    const sup = Object.values(back.model.nodes).find((n) => n.name === "SUPORTE");
    expect(sup?.kind).toBe("group");
    expect(pathOf(back.model, bodies(back.model).find((b) => b.name === "COLUNA_2")!.id)).toMatch(/SUPORTE › COLUNA_2$/);
    const c = new BodyCache(k);
    const c0 = new BodyCache(k);
    c.sync(back.model);
    c0.sync(s.m);
    const byName = (m: typeof s.m, n: string) => bodies(m).find((b) => b.name === n)!.id;
    for (const n of names) {
      const a = k.props(c0.get(byName(s.m, n))!);
      const b = k.props(c.get(byName(back.model, n))!);
      expect(b.volume).toBeCloseTo(a.volume, 6);
      expect(b.bbox.min.x).toBeCloseTo(a.bbox.min.x, 6);
      expect(b.bbox.min.z).toBeCloseTo(a.bbox.min.z, 6);
    }
    c.clear();
    c0.clear();
  });
});
