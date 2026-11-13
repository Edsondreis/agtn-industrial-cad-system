/**
 * Auditoria da FASE 3 — persistência (A04), dependências entre corpos (A01), desempenho e memória (A06).
 * Ciclo: criar → salvar → "fechar" (documento novo, motor novo) → abrir → regenerar → comparar árvore, parâmetros,
 * estados e volume → editar operação intermediária → salvar/abrir de novo → Undo/Redo → comparar.
 */
import { CadDocument, deserializeInto, serializeDocument } from "@agtn/document";
import { BodyCache, MODEL3D_KEY, type Model3D, type NodeId, addBody, addFeature, commitModel, getModel, newPart, parseModel3D, partOf, setPlacement, setRollback, setSuppressed, updateFeature } from "@agtn/model3d";
import { addCircle, addConstraint, addPointEntity, addRectangle, emptySketch, solve } from "@agtn/sketch";
import { type EdgeRef, type FaceRef, type Feature, type FeatureDraft, OcctSolidKernel, PartEvaluator } from "@agtn/solid";

let k: OcctSolidKernel;
beforeAll(async () => {
  k = await OcctSolidKernel.create();
});
afterAll(() => k.dispose());
const PI = Math.PI;
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));

function rectAt(x0: number, y0: number, w: number, h: number) {
  const r = addRectangle(emptySketch(), { x: x0 + 1, y: y0 + 1 }, { x: x0 + w - 1, y: y0 + h - 1 });
  let s = addConstraint(r.s, { t: "fixed", p: r.points[0], x: x0, y: y0 }).s;
  s = addConstraint(s, { t: "length", l: r.lines[0], v: w }).s;
  s = addConstraint(s, { t: "length", l: r.lines[1], v: h }).s;
  return solve(s).sketch;
}
const ext = (sketch: string, depth: number, op: "new" | "join" | "cut" = "new", through = false): FeatureDraft => ({ t: "extrude", sketch, regions: null, depth, mode: "one", depth2: 0, reverse: false, through, op });
const XY = (offset = 0) => ({ t: "std", plane: "XY", offset }) as const;

function near(ev: PartEvaluator, id: string, at: number, kind: "face" | "edge", p: { x: number; y: number; z: number }): number {
  const shape = ev.shapeAt(id, at)!;
  const subs = k.raw.getSubShapes(shape, kind);
  let best = -1;
  let bd = Infinity;
  subs.forEach((e, i) => {
    const v = k.raw.makeVertex(p.x, p.y, p.z);
    const d = k.raw.distanceBetween(v, e);
    k.raw.release(v);
    if (d < bd) [bd, best] = [d, i];
  });
  subs.forEach((h) => k.raw.release(h));
  return best;
}

/**
 * Peça industrial com `n` operações (≥ 10): chapa 400×200×20, rebaixos, furos com rebaixo em face, padrão,
 * ressaltos, arredondamento e chanfro por referência, uma operação suprimida.
 */
function bigPart(n: number, ev: PartEvaluator) {
  let m: Model3D = { version: 1, nodes: {}, roots: [] };
  const p = newPart(m, { name: "CHAPA_BASE" });
  m = p.model;
  const id = p.id;
  const add = (d: FeatureDraft) => {
    const r = addFeature(m, id, d);
    m = r.model;
    return r.id;
  };
  const feats = () => partOf(m, id).part.features;
  const s0 = add({ t: "sketch", plane: XY(), sketch: rectAt(0, 0, 400, 200) });
  add(ext(s0, 20));
  ev.evaluate(id, feats());
  const top: FaceRef = ev.identifyFace(id, feats(), 1, near(ev, id, 1, "face", { x: 200, y: 100, z: 20 }));
  const corner: EdgeRef = ev.identifyEdge(id, feats(), 1, near(ev, id, 1, "edge", { x: 400, y: 200, z: 10 }));
  const back: EdgeRef = ev.identifyEdge(id, feats(), 1, near(ev, id, 1, "edge", { x: 200, y: 200, z: 20 }));
  let i = 0;
  while (feats().length < n - 3) {
    const col = i % 9;
    const row = Math.floor(i / 9) % 3;
    const x = 30 + col * 40;
    const y = 40 + row * 60;
    if (i % 3 === 0) {
      const s = add({ t: "sketch", plane: { t: "face", face: top, offset: 0 }, sketch: addPointEntity(emptySketch(), { x, y }).s });
      add({ t: "hole", sketch: s, d: 6.6, depth: 0, through: true, reverse: false, cbore: { d: 11, depth: 3 }, csink: null });
    } else if (i % 3 === 1) {
      const s = add({ t: "sketch", plane: XY(20), sketch: addCircle(emptySketch(), { x, y }, 6).s });
      add(ext(s, 8, "join"));
    } else {
      const s = add({ t: "sketch", plane: XY(20), sketch: rectAt(x - 8, y - 8, 16, 16) });
      add({ ...ext(s, 5, "cut"), reverse: true } as FeatureDraft); // para baixo, dentro da chapa
    }
    i++;
  }
  const lastHole = [...feats()].reverse().find((f) => f.t === "hole")!;
  add({ t: "pattern", kind: "linear", targets: [lastHole.id], dir: { t: "axis", a: "Y" }, count: 2, spacing: 15, angle: 360, reverse: false });
  add({ t: "fillet", edges: [corner], r: 10 });
  add({ t: "chamfer", edges: [back], d: 2 });
  // uma operação suprimida no meio
  const mid = feats()[Math.floor(feats().length / 2)];
  m = setSuppressed(m, id, mid.id, true);
  return { m, id };
}

const sig = (feats: readonly Feature[]) => JSON.stringify(feats);
const states = (c: BodyCache, id: NodeId) => c.featureStatus(id)!.map((s) => `${s.id}:${s.state}`);

describe("A04 — persistência integral da árvore", () => {
  it("40+ operações, corpo com erro, peça recuada e combinação entre corpos: salvar → fechar → abrir → regenerar idêntico", async () => {
    const ev0 = new PartEvaluator(k);
    const big = bigPart(44, ev0);
    ev0.releaseAll();
    let m = big.m;
    // operação com erro no fim (arredondamento impossível)
    const f = partOf(m, big.id).part.features;
    const edge = (f.find((x) => x.t === "fillet") as Extract<Feature, { t: "fillet" }>).edges[0];
    m = addFeature(m, big.id, { t: "fillet", edges: [edge], r: 400 }, "Arredondar_Impossível").model;
    // segunda peça recuada
    const p2 = newPart(m, { name: "PEÇA_RECUADA" });
    m = setPlacement(p2.model, p2.id, { origin: { x: 0, y: 300, z: 0 }, rot: { x: 0, y: 0, z: 0 } });
    const a = addFeature(m, p2.id, { t: "sketch", plane: XY(), sketch: rectAt(0, 0, 100, 50) });
    m = addFeature(a.model, p2.id, ext(a.id, 10)).model;
    const b = addFeature(m, p2.id, { t: "sketch", plane: XY(10), sketch: rectAt(10, 10, 20, 20) });
    m = addFeature(b.model, p2.id, ext(b.id, 10, "join")).model;
    m = setRollback(m, p2.id, 2);
    // terceira peça combinada com um cilindro (corpo-ferramenta)
    const pin = addBody(m, { name: "PINO", placement: { origin: { x: 25, y: 625, z: -5 }, rot: { x: 0, y: 0, z: 0 } }, source: { type: "primitive", spec: { kind: "cylinder", r: 5, h: 30 } } });
    m = pin.model;
    const pinId = pin.id;
    const p3 = newPart(m, { name: "FLANGE" });
    m = setPlacement(p3.model, p3.id, { origin: { x: 0, y: 600, z: 0 }, rot: { x: 0, y: 0, z: 0 } });
    const c1 = addFeature(m, p3.id, { t: "sketch", plane: XY(), sketch: rectAt(0, 0, 50, 50) });
    m = addFeature(c1.model, p3.id, ext(c1.id, 10)).model;
    m = addFeature(m, p3.id, { t: "combine", op: "cut", tools: [pinId] }).model;

    const doc = new CadDocument();
    commitModel(doc, "modelo de auditoria", m);
    const c = new BodyCache(k, new PartEvaluator(k));
    const r1 = c.sync(getModel(doc));
    const vol = (cc: BodyCache, id: NodeId) => k.props(cc.get(id)!).volume;
    const v1 = { big: vol(c, big.id), rec: vol(c, p2.id), fl: vol(c, p3.id) };
    expect(partOf(getModel(doc), big.id).part.features.length).toBe(f.length + 1);
    expect(f.length).toBeGreaterThanOrEqual(44);
    expect(r1.partial[big.id]?.name).toBe("Arredondar_Impossível");
    expect(c.featureStatus(big.id)!.at(-1)!.state).toBe("error");
    expect(c.featureStatus(big.id)!.filter((s) => s.state === "suppressed").length).toBeGreaterThanOrEqual(1);
    expect(c.featureStatus(p2.id)!.map((s) => s.state)).toEqual(["ok", "ok", "rolledback", "rolledback"]);
    expect(rel(v1.rec, 50000)).toBeLessThan(1e-12);
    expect(rel(v1.fl, 25000 - PI * 25 * 10)).toBeLessThan(1e-9);
    const st1 = { big: states(c, big.id), rec: states(c, p2.id), fl: states(c, p3.id) };

    // salvar → fechar (documento e motor novos) → abrir
    const text = serializeDocument(doc);
    // evidência: AGTN_AUDIT_OUT=pasta grava o modelo de teste (abre no AGTN CAD)
    const out = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.AGTN_AUDIT_OUT;
    if (out) {
      const fs = await import("node:fs");
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(`${out}/auditoria_45_operacoes.agtncad`, text);
    }
    JSON.parse(text); // JSON íntegro
    c.clear();
    const doc2 = new CadDocument();
    deserializeInto(doc2, text);
    const c2 = new BodyCache(k, new PartEvaluator(k));
    const r2 = c2.sync(getModel(doc2));
    expect(r2.errors).toEqual(r1.errors);
    for (const id of [big.id, p2.id, p3.id]) {
      expect(sig(partOf(getModel(doc2), id).part.features)).toBe(sig(partOf(m, id).part.features));
      expect(partOf(getModel(doc2), id).part.rollback).toBe(partOf(m, id).part.rollback);
    }
    expect({ big: states(c2, big.id), rec: states(c2, p2.id), fl: states(c2, p3.id) }).toEqual(st1);
    expect(vol(c2, big.id)).toBe(v1.big); // bit a bit: mesma sequência de operações OCCT
    expect(vol(c2, p2.id)).toBe(v1.rec);
    expect(vol(c2, p3.id)).toBe(v1.fl);

    // editar uma operação intermediária (rebaixo 5 → 7) → salvar → abrir → Undo/Redo
    const feats = partOf(getModel(doc2), big.id).part.features;
    const okIds = new Set(c2.featureStatus(big.id)!.filter((x) => x.state === "ok").map((x) => x.id));
    const pocket = feats.find((x, i) => i > 10 && x.t === "extrude" && x.op === "cut" && okIds.has(x.id)) as Extract<Feature, { t: "extrude" }>;
    const { id: _id, name: _n, suppressed: _s, ...draft } = pocket;
    void _id;
    void _n;
    void _s;
    commitModel(doc2, "rebaixo 7", updateFeature(getModel(doc2), big.id, pocket.id, { ...draft, depth: 7 }));
    c2.sync(getModel(doc2));
    const vEdit = vol(c2, big.id);
    expect(rel(vEdit, v1.big - 16 * 16 * 2)).toBeLessThan(1e-9); // 2 mm a mais de rebaixo 16×16
    const doc3 = new CadDocument();
    deserializeInto(doc3, serializeDocument(doc2));
    const c3 = new BodyCache(k, new PartEvaluator(k));
    c3.sync(getModel(doc3));
    expect(vol(c3, big.id)).toBe(vEdit);
    // o histórico de Undo/Redo é da sessão (não vai no arquivo) — no documento aberto ele funciona:
    doc2.undo();
    c2.sync(getModel(doc2));
    expect(vol(c2, big.id)).toBe(v1.big);
    doc2.redo();
    c2.sync(getModel(doc2));
    expect(vol(c2, big.id)).toBe(vEdit);
    c2.clear();
    c3.clear();
  }, 60000);

  it("arquivo corrompido: ids duplicados, campos ausentes, referência a operação inexistente — abre sem travar", () => {
    let m: Model3D = { version: 1, nodes: {}, roots: [] };
    const p = newPart(m, { name: "P" });
    m = p.model;
    const s = addFeature(m, p.id, { t: "sketch", plane: XY(), sketch: rectAt(0, 0, 10, 10) });
    m = addFeature(s.model, p.id, ext(s.id, 10)).model;
    const raw = JSON.parse(JSON.stringify(m));
    const fs = raw.nodes[p.id].source.features;
    fs.push({ ...fs[1], name: "Duplicada", op: "join" }); // id duplicado
    fs.push({ id: "semcampos", name: "Sem campos", t: "extrude" }); // campos ausentes
    fs.push({ id: "orfa", name: "Órfã", t: "extrude", sketch: "naoexiste", regions: null, depth: 5, mode: "one", depth2: 0, reverse: false, through: false, op: "join" });
    fs.push(42, null, { t: "fillet" }); // lixo
    raw.nodes[p.id].source.rollback = 999;
    const rep = parseModel3D(raw);
    expect(rep.warnings.join(" ")).toMatch(/duplicad/i);
    const part = partOf(rep.model, p.id).part;
    expect(new Set(part.features.map((f) => f.id)).size).toBe(part.features.length);
    expect(part.rollback).toBe(part.features.length);
    const c = new BodyCache(k, new PartEvaluator(k));
    const r = c.sync(rep.model);
    expect(r.errors).toEqual({});
    const st = c.featureStatus(p.id)!;
    expect(st[0].state).toBe("ok");
    expect(st[1].state).toBe("ok");
    expect(st.find((x) => x.id === "semcampos")!.state).toBe("error");
    expect(st.find((x) => x.id === "orfa")!.state).not.toBe("ok");
    expect(rel(k.props(c.get(p.id)!).volume, 1000)).toBeLessThan(1e-12);
    c.clear();
  });

  it("arquivo da FASE 2 (só primitivas) e arquivo sem 3D continuam abrindo", () => {
    const phase2 = { version: 1, roots: ["a"], nodes: { a: { id: "a", name: "CAIXA", kind: "body", parent: null, visible: true, placement: { origin: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } }, source: { type: "primitive", spec: { kind: "box", w: 10, d: 10, h: 10 } }, color: "#9aa7b6", material: "aco_carbono" } } };
    const rep = parseModel3D(phase2);
    expect(rep.warnings).toEqual([]);
    expect(Object.keys(rep.model.nodes)).toEqual(["a"]);
    const doc = new CadDocument();
    expect(doc.extras[MODEL3D_KEY]).toBeUndefined();
    expect(getModel(doc).roots).toEqual([]);
  });
});

describe("A01 — dependência entre corpos", () => {
  it("corpo-ferramenta com operação falhando → combinação com erro de dependência; corrigir recupera", () => {
    let m: Model3D = { version: 1, nodes: {}, roots: [] };
    const tool = newPart(m, { name: "FERRAMENTA" });
    m = tool.model;
    const ts = addFeature(m, tool.id, { t: "sketch", plane: XY(), sketch: addCircle(emptySketch(), { x: 50, y: 50 }, 10).s });
    m = addFeature(ts.model, tool.id, ext(ts.id, 30)).model;
    const tb = addFeature(m, tool.id, { t: "sketch", plane: XY(), sketch: emptySketch() }); // esboço vazio → extrusão falha
    const bad = addFeature(tb.model, tool.id, ext(tb.id, 5, "join"));
    m = bad.model;
    const host = newPart(m, { name: "CHAPA" });
    m = host.model;
    const hs = addFeature(m, host.id, { t: "sketch", plane: XY(), sketch: rectAt(0, 0, 100, 100) });
    m = addFeature(hs.model, host.id, ext(hs.id, 10)).model;
    m = addFeature(m, host.id, { t: "combine", op: "cut", tools: [tool.id] }).model;
    const c = new BodyCache(k, new PartEvaluator(k));
    const r = c.sync(m);
    expect(r.partial[tool.id]?.name).toBe(partOf(m, tool.id).part.features[3].name);
    const st = c.featureStatus(host.id)!;
    expect(st[2].state).toBe("dependency_error");
    expect(st[2].error).toMatch(/FERRAMENTA/);
    expect(r.partial[host.id]).toBeDefined();
    // corrigir a ferramenta (suprimir a operação ruim) → a chapa regenera com o furo
    m = setSuppressed(m, tool.id, bad.id, true);
    const r2 = c.sync(m);
    expect(r2.partial).toEqual({});
    expect(c.featureStatus(host.id)![2].state).toBe("ok");
    expect(rel(k.props(c.get(host.id)!).volume, 100000 - PI * 100 * 10)).toBeLessThan(1e-9);
    c.clear();
  });
});

describe("A06 — desempenho e memória", () => {
  it("10/20/40/80 operações: regeneração completa, edição da 1ª/meio/última, suprimir, recuar, salvar/abrir", () => {
    const rows: string[] = [];
    for (const n of [10, 20, 40, 80]) {
      const ev = new PartEvaluator(k);
      const { m, id } = bigPart(n, ev);
      ev.releaseAll();
      const feats = partOf(m, id).part.features;
      const t = (fn: () => void) => {
        const t0 = performance.now();
        fn();
        return performance.now() - t0;
      };
      const e = new PartEvaluator(k);
      const full = t(() => e.evaluate(id, feats));
      const bad = e.evaluate(id, feats).status.filter((s) => s.state === "error" || s.state === "dependency_error");
      expect(bad.map((s) => s.error)).toEqual([]);
      const edit = (i: number) => {
        const f = feats[i];
        // altera um parâmetro real (extrusão: profundidade; demais: o nome, que entra na assinatura)
        const g = f.t === "extrude" ? ({ ...f, depth: f.depth + 0.5 } as Feature) : ({ ...f, name: f.name + "'" } as Feature);
        const next = feats.map((x, j) => (j === i ? g : x));
        const ms = t(() => e.evaluate(id, next));
        e.evaluate(id, feats);
        return ms;
      };
      const first = edit(1);
      const mid = edit(Math.floor(feats.length / 2) | 1);
      const last = t(() => e.evaluate(id, feats.map((x, j) => (j === feats.length - 1 ? ({ ...x, d: 2.5 } as Feature) : x))));
      e.evaluate(id, feats);
      const k2 = Math.floor(feats.length / 3);
      const supp = t(() => e.evaluate(id, feats.map((x, j) => (j === k2 ? ({ ...x, suppressed: true } as Feature) : x))));
      const unsupp = t(() => e.evaluate(id, feats));
      const back = t(() => e.evaluate(id, feats, { rollback: k2 }));
      const fwd = t(() => e.evaluate(id, feats));
      const doc = new CadDocument();
      commitModel(doc, "x", m);
      let text = "";
      const save = t(() => (text = serializeDocument(doc)));
      const open = t(() => {
        const d2 = new CadDocument();
        deserializeInto(d2, text);
        getModel(d2);
      });
      e.releaseAll();
      rows.push(`${String(n).padStart(3)} ops | completa ${full.toFixed(0)} ms | editar 1ª ${first.toFixed(0)} | meio ${mid.toFixed(0)} | última ${last.toFixed(0)} | suprimir ${supp.toFixed(0)} / reativar ${unsupp.toFixed(0)} | recuar ${back.toFixed(0)} / avançar ${fwd.toFixed(0)} | salvar ${save.toFixed(1)} / abrir ${open.toFixed(1)} ms | ${(text.length / 1024).toFixed(0)} kB`);
      expect(last).toBeLessThan(full);
      expect(back).toBeLessThan(full);
    }
    console.info("DESEMPENHO\n" + rows.join("\n"));
  }, 120000);

  it("sem vazamento de formas OCCT: 30 ciclos editar/regenerar e liberar voltam ao mesmo número de formas", () => {
    const base0 = k.liveShapes;
    const ev = new PartEvaluator(k);
    const { m, id } = bigPart(20, ev);
    ev.releaseAll();
    const feats = partOf(m, id).part.features;
    const c = new BodyCache(k, new PartEvaluator(k));
    let model = m;
    c.sync(model);
    const after1 = k.liveShapes;
    for (let i = 0; i < 30; i++) {
      const f = feats[1] as Extract<Feature, { t: "extrude" }>;
      const { id: _a, name: _b, suppressed: _c, ...d } = f;
      void _a;
      void _b;
      void _c;
      model = updateFeature(model, id, f.id, { ...d, depth: 20 + (i % 5) });
      c.sync(model);
    }
    model = updateFeature(model, id, feats[1].id, (() => {
      const { id: _a, name: _b, suppressed: _c, ...d } = feats[1] as Extract<Feature, { t: "extrude" }>;
      void _a;
      void _b;
      void _c;
      return d;
    })());
    c.sync(model);
    const after30 = k.liveShapes;
    c.clear();
    const end = k.liveShapes;
    console.info(`MEMÓRIA formas OCCT vivas: início ${base0} · após 1ª sync ${after1} · após 30 ciclos ${after30} · após liberar ${end} · heap WASM ${(k.wasmMemoryBytes / 2 ** 20).toFixed(0)} MB`);
    expect(Math.abs(after30 - after1)).toBeLessThanOrEqual(2);
    expect(end).toBe(base0);
  }, 120000);
});
