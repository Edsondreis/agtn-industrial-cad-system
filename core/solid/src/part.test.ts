import { type Sketch, addCircle, addConstraint, addLine, addPointEntity, addRectangle, emptySketch, setDimension, solve } from "@agtn/sketch";
import { type Feature, type FeatureDraft, OcctSolidKernel, PartEvaluator } from "@agtn/solid";

let k: OcctSolidKernel;
let ev: PartEvaluator;
beforeAll(async () => {
  k = await OcctSolidKernel.create();
  ev = new PartEvaluator(k);
});
afterAll(() => {
  ev.releaseAll();
  k.dispose();
});

const PI = Math.PI;
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));
let seq = 0;
const F = (name: string, d: FeatureDraft): Feature => ({ ...(d as object), id: `f${++seq}`, name } as Feature);
const vol = (r: ReturnType<PartEvaluator["evaluate"]>) => k.raw.getVolume(r.shape!);
const bbox = (r: ReturnType<PartEvaluator["evaluate"]>) => k.raw.getBoundingBox(r.shape!);
const okAll = (r: ReturnType<PartEvaluator["evaluate"]>) => {
  const bad = r.status.filter((s) => s.state === "error");
  expect(bad.map((s) => s.error)).toEqual([]);
  expect(k.raw.isValid(r.shape!)).toBe(true);
};

/** Retângulo w×h com canto na origem, totalmente definido. Devolve o esboço e o id da cota de largura. */
function rectSketch(w: number, h: number, x0 = 0, y0 = 0) {
  let s = emptySketch();
  const r = addRectangle(s, { x: x0 + 1, y: y0 + 1 }, { x: x0 + w - 1, y: y0 + h - 1 });
  s = r.s;
  if (x0 === 0 && y0 === 0) s = addConstraint(s, { t: "coincident", a: r.points[0], b: "O" }).s;
  else s = addConstraint(s, { t: "fixed", p: r.points[0], x: x0, y: y0 }).s;
  const dw = addConstraint(s, { t: "length", l: r.lines[0], v: w });
  s = addConstraint(dw.s, { t: "length", l: r.lines[1], v: h }).s;
  const res = solve(s);
  expect(res.status).toBe("full");
  return { s: res.sketch, dimW: dw.id, lines: r.lines };
}
const circleSketch = (cx: number, cy: number, r: number) => addCircle(emptySketch(), { x: cx, y: cy }, r).s;
const sk = (name: string, sketch: Sketch, plane: Feature extends infer _ ? Extract<Feature, { t: "sketch" }>["plane"] : never = { t: "std", plane: "XY", offset: 0 }) => F(name, { t: "sketch", plane, sketch });
const ext = (sketchId: string, depth: number, op: "new" | "join" | "cut" | "intersect" = "new", more: Partial<Extract<FeatureDraft, { t: "extrude" }>> = {}) =>
  ({ t: "extrude", sketch: sketchId, regions: null, depth, mode: "one", depth2: 0, reverse: false, through: false, op, ...more }) as FeatureDraft;

/** Índice da aresta do sólido mais próxima de um ponto (simula o clique do usuário). */
function edgeNear(shape: number, p: { x: number; y: number; z: number }): number {
  const edges = k.raw.getSubShapes(shape as never, "edge");
  let best = -1;
  let bd = Infinity;
  edges.forEach((e, i) => {
    const v = k.raw.makeVertex(p.x, p.y, p.z);
    const d = k.raw.distanceBetween(v, e);
    k.raw.release(v);
    if (d < bd) [bd, best] = [d, i];
  });
  return best;
}
function faceNear(shape: number, p: { x: number; y: number; z: number }): number {
  const faces = k.raw.getSubShapes(shape as never, "face");
  let best = -1;
  let bd = Infinity;
  faces.forEach((f, i) => {
    const v = k.raw.makeVertex(p.x, p.y, p.z);
    const d = k.raw.distanceBetween(v, f);
    k.raw.release(v);
    if (d < bd) [bd, best] = [d, i];
  });
  return best;
}

describe("extrusão e edição de cotas", () => {
  it("retângulo 200×100 extrudado 10 = 200.000 mm³; mudar a cota do esboço regenera", () => {
    const r = rectSketch(200, 100);
    const s1 = sk("Esboço_Base", r.s);
    const e1 = F("Extrusão_Base", ext(s1.id, 10));
    let res = ev.evaluate("p1", [s1, e1]);
    okAll(res);
    expect(rel(vol(res), 200000)).toBeLessThan(1e-12);
    const s1b = { ...s1, sketch: solve(setDimension(r.s, r.dimW, 300)).sketch } as Feature;
    res = ev.evaluate("p1", [s1b, e1]);
    expect(rel(vol(res), 300000)).toBeLessThan(1e-12);
    expect(bbox(res).xmax).toBeCloseTo(300, 9);
  });
  it("simétrica, dois sentidos e inverter", () => {
    const s = sk("E", rectSketch(10, 10).s);
    let r = ev.evaluate("p2", [s, F("X", ext(s.id, 40, "new", { mode: "symmetric" }))]);
    expect(bbox(r).zmin).toBeCloseTo(-20, 9);
    expect(bbox(r).zmax).toBeCloseTo(20, 9);
    r = ev.evaluate("p2", [s, F("X", ext(s.id, 30, "new", { mode: "two", depth2: 5 }))]);
    expect(bbox(r).zmin).toBeCloseTo(-5, 9);
    expect(rel(vol(r), 3500)).toBeLessThan(1e-12);
    r = ev.evaluate("p2", [s, F("X", ext(s.id, 7, "new", { reverse: true }))]);
    expect(bbox(r).zmax).toBeCloseTo(0, 9);
    expect(bbox(r).zmin).toBeCloseTo(-7, 9);
  });
  it("esboço com furo (retângulo + círculo) vira chapa furada", () => {
    const s = addCircle(rectSketch(200, 100).s, { x: 100, y: 50 }, 20).s;
    const sf = sk("E", s);
    const r = ev.evaluate("p3", [sf, F("X", ext(sf.id, 10))]);
    okAll(r);
    expect(rel(vol(r), (20000 - PI * 400) * 10)).toBeLessThan(1e-9);
  });
  it("esboço nos planos XZ e YZ e com deslocamento", () => {
    const s = sk("E", rectSketch(50, 20).s, { t: "std", plane: "XZ", offset: 0 });
    let r = ev.evaluate("p4", [s, F("X", ext(s.id, 30))]);
    const b = bbox(r);
    expect([b.xmax, b.zmax, b.ymin]).toEqual([50, 20, -30].map((v) => expect.closeTo(v, 9)));
    const s2 = sk("E", rectSketch(50, 20).s, { t: "std", plane: "YZ", offset: 15 });
    r = ev.evaluate("p4", [s2, F("X", ext(s2.id, 10))]);
    expect(bbox(r).xmin).toBeCloseTo(15, 9);
    expect(bbox(r).ymax).toBeCloseTo(50, 9);
  });
});

describe("esboço sobre face e referências estáveis", () => {
  it("rasgo passante no topo acompanha a mudança de profundidade da base", () => {
    const s1 = sk("Esboço_Base", rectSketch(200, 100).s);
    const e1 = F("Extrusão_Base", ext(s1.id, 10));
    const base = [s1, e1];
    ev.evaluate("q1", base);
    // usuário clica na face de cima da chapa
    const shape = ev.shapeAt("q1", 1)!;
    const top = ev.identifyFace("q1", base, 1, faceNear(shape, { x: 100, y: 50, z: 10 }));
    expect(top.t).toBe("anchor");
    expect(top.t === "anchor" && top.role).toBe("end");
    const s2 = F("Esboço_Furos", { t: "sketch", plane: { t: "face", face: top, offset: 0 }, sketch: circleSketch(100, 50, 20) });
    const p = F("Rasgo_Furos", ext(s2.id, 0, "cut", { through: true }));
    let r = ev.evaluate("q1", [...base, s2, p]);
    okAll(r);
    expect(rel(vol(r), (20000 - PI * 400) * 10)).toBeLessThan(1e-9);
    // base mais grossa: o esboço sobe junto com a face e o furo continua passante
    const e1b = { ...e1, depth: 25 } as Feature;
    r = ev.evaluate("q1", [s1, e1b, s2, p]);
    okAll(r);
    expect(rel(vol(r), (20000 - PI * 400) * 25)).toBeLessThan(1e-9);
  });

  it("arredondamento segue a aresta quando a peça cresce (aresta = faces vizinhas)", () => {
    const s1 = sk("E", rectSketch(100, 100).s);
    const e1 = F("Extrusão", ext(s1.id, 100));
    ev.evaluate("q2", [s1, e1]);
    const idx = edgeNear(ev.shapeAt("q2", 1)!, { x: 100, y: 100, z: 50 });
    const edge = ev.identifyEdge("q2", [s1, e1], 1, idx);
    const fl = F("Arredondar", { t: "fillet", edges: [edge], r: 10 });
    let r = ev.evaluate("q2", [s1, e1, fl]);
    okAll(r);
    expect(rel(vol(r), 1e6 - (100 - 25 * PI) * 100)).toBeLessThan(1e-9);
    r = ev.evaluate("q2", [s1, { ...e1, depth: 150 } as Feature, fl]);
    okAll(r);
    expect(rel(vol(r), 1.5e6 - (100 - 25 * PI) * 150)).toBeLessThan(1e-9);
  });

  it("referência perdida gera erro explícito (não escolhe outra face)", () => {
    const r0 = rectSketch(100, 100);
    const s1 = sk("Esboço_Base", r0.s);
    const e1 = F("Extrusão_Base", ext(s1.id, 20));
    ev.evaluate("q3", [s1, e1]);
    const shape = ev.shapeAt("q3", 1)!;
    // face lateral gerada pela 1ª linha do retângulo (y = 0)
    const side = ev.identifyFace("q3", [s1, e1], 1, faceNear(shape, { x: 50, y: 0, z: 10 }));
    expect(side.t === "anchor" && side.role).toBe("side");
    const sh = F("Casca", { t: "shell", faces: [side], thickness: 2 });
    let r = ev.evaluate("q3", [s1, e1, sh]);
    okAll(r);
    // apagar a linha que gerava a face: a casca falha com mensagem clara e o sólido fica como estava
    // a linha é substituída por duas (perfil continua fechado, mas a curva de origem não existe mais)
    const L = r0.s.entities[r0.lines[0]] as { p1: string; p2: string };
    let s2 = { ...r0.s, entities: Object.fromEntries(Object.entries(r0.s.entities).filter(([id]) => id !== r0.lines[0])) };
    const half = addLine(s2, L.p1, { x: 50, y: 0 });
    s2 = addLine(half.s, half.p2, L.p2).s;
    r = ev.evaluate("q3", [{ ...s1, sketch: s2 } as Feature, e1, sh]);
    expect(r.status[1].state).toBe("ok");
    const st = r.status[2];
    expect(st.state).toBe("error");
    expect(st.error).toMatch(/apagada|perdida|não existe/);
  });
});

describe("demais operações com volumes conhecidos", () => {
  const cube = (id: string, a = 100) => {
    const s = sk("E", rectSketch(a, a).s);
    const e = F("Extrusão", ext(s.id, a));
    ev.evaluate(id, [s, e]);
    return [s, e];
  };
  it("chanfro 10 mm numa aresta: remove ½·10·10·h", () => {
    const base = cube("o1");
    const edge = ev.identifyEdge("o1", base, 1, edgeNear(ev.shapeAt("o1", 1)!, { x: 100, y: 0, z: 50 }));
    const r = ev.evaluate("o1", [...base, F("Chanfro", { t: "chamfer", edges: [edge], d: 10 })]);
    okAll(r);
    expect(rel(vol(r), 1e6 - 50 * 100)).toBeLessThan(1e-9);
  });
  it("casca: cubo 100 sem a tampa, parede 5 → 1e6 − 90·90·95", () => {
    const base = cube("o2");
    const top = ev.identifyFace("o2", base, 1, faceNear(ev.shapeAt("o2", 1)!, { x: 50, y: 50, z: 100 }));
    const r = ev.evaluate("o2", [...base, F("Casca", { t: "shell", faces: [top], thickness: 5 })]);
    okAll(r);
    expect(rel(vol(r), 1e6 - 90 * 90 * 95)).toBeLessThan(1e-9);
  });
  it("revolução 360° de retângulo em torno do eixo do esboço = tubo", () => {
    let s = emptySketch();
    const rr = addRectangle(s, { x: 10, y: 0 }, { x: 20, y: 30 });
    s = rr.s;
    const sf = sk("Perfil", s, { t: "std", plane: "XZ", offset: 0 });
    const r = ev.evaluate("o3", [sf, F("Revolução", { t: "revolve", sketch: sf.id, regions: null, axis: "AY", angle: 360, op: "new" })]);
    okAll(r);
    expect(rel(vol(r), PI * (400 - 100) * 30)).toBeLessThan(1e-7);
    const r2 = ev.evaluate("o3b", [sf, F("Revolução", { t: "revolve", sketch: sf.id, regions: null, axis: "AY", angle: 90, op: "new" })]);
    expect(rel(vol(r2), (PI * (400 - 100) * 30) / 4)).toBeLessThan(1e-7);
  });
  it("varredura de círculo ao longo de uma linha = cilindro", () => {
    const prof = sk("Perfil", circleSketch(0, 0, 5));
    let path = emptySketch();
    path = addLine(path, { x: 0, y: 0 }, { x: 0, y: 100 }).s;
    const pf = sk("Caminho", path, { t: "std", plane: "XZ", offset: 0 });
    const r = ev.evaluate("o4", [prof, pf, F("Varredura", { t: "sweep", profile: prof.id, path: pf.id, op: "new" })]);
    okAll(r);
    expect(rel(vol(r), PI * 25 * 100)).toBeLessThan(1e-6);
  });
  it("loft regrado quadrado 20 → quadrado 10 (h 50) = tronco de pirâmide", () => {
    const a = sk("S1", rectSketch(20, 20, -10, -10).s);
    const b = sk("S2", rectSketch(10, 10, -5, -5).s, { t: "std", plane: "XY", offset: 50 });
    const r = ev.evaluate("o5", [a, b, F("Loft", { t: "loft", sections: [a.id, b.id], ruled: true, op: "new" })]);
    okAll(r);
    expect(rel(vol(r), (50 / 3) * (400 + 100 + 200))).toBeLessThan(1e-7);
  });
  it("furos passantes, rebaixo e escareado nos pontos do esboço da face", () => {
    const s1 = sk("E", rectSketch(100, 100).s);
    const e1 = F("Chapa", ext(s1.id, 10));
    ev.evaluate("o6", [s1, e1]);
    const top = ev.identifyFace("o6", [s1, e1], 1, faceNear(ev.shapeAt("o6", 1)!, { x: 50, y: 50, z: 10 }));
    let hs = emptySketch();
    hs = addPointEntity(hs, { x: 25, y: 25 }).s;
    hs = addPointEntity(hs, { x: 75, y: 75 }).s;
    const s2 = F("Pontos", { t: "sketch", plane: { t: "face", face: top, offset: 0 }, sketch: hs });
    const hole = (more: object) => F("Furo", { t: "hole", sketch: s2.id, d: 10, depth: 0, through: true, reverse: false, cbore: null, csink: null, ...more } as FeatureDraft);
    let r = ev.evaluate("o6", [s1, e1, s2, hole({})]);
    okAll(r);
    expect(rel(vol(r), 1e5 - 2 * PI * 25 * 10)).toBeLessThan(1e-9);
    r = ev.evaluate("o6", [s1, e1, s2, hole({ through: false, depth: 6 })]);
    expect(rel(vol(r), 1e5 - 2 * PI * 25 * 6)).toBeLessThan(1e-9);
    r = ev.evaluate("o6", [s1, e1, s2, hole({ cbore: { d: 16, depth: 4 } })]);
    okAll(r);
    expect(rel(vol(r), 1e5 - 2 * (PI * 25 * 6 + PI * 64 * 4))).toBeLessThan(1e-9);
    r = ev.evaluate("o6", [s1, e1, s2, hole({ csink: { d: 18, angle: 90 } })]);
    okAll(r);
    const h = 4; // (18 − 10)/2 / tan 45°
    const cone = ((PI * h) / 3) * (81 + 25 + 45);
    expect(rel(vol(r), 1e5 - 2 * (PI * 25 * (10 - h) + cone))).toBeLessThan(1e-7);
  });
  it("espelhamento de um ressalto e do corpo inteiro", () => {
    const s1 = sk("Base", rectSketch(100, 50, -50, 0).s);
    const e1 = F("Base", ext(s1.id, 10));
    const s2 = sk("Ressalto", rectSketch(10, 10, 20, 20).s, { t: "std", plane: "XY", offset: 10 });
    const e2 = F("Ressalto", ext(s2.id, 15, "join"));
    const m = F("Espelho", { t: "mirror", plane: { t: "std", plane: "YZ", offset: 0 }, targets: [e2.id] });
    const r = ev.evaluate("o7", [s1, e1, s2, e2, m]);
    okAll(r);
    expect(rel(vol(r), 100 * 50 * 10 + 2 * 1500)).toBeLessThan(1e-9);
    expect(bbox(r).zmax).toBeCloseTo(25, 9);
    const s3 = sk("Meia", rectSketch(40, 20).s);
    const e3 = F("Meia", ext(s3.id, 5));
    const r2 = ev.evaluate("o7b", [s3, e3, F("Espelho", { t: "mirror", plane: { t: "std", plane: "YZ", offset: 0 }, targets: null })]);
    expect(rel(vol(r2), 2 * 40 * 20 * 5)).toBeLessThan(1e-9);
    expect(bbox(r2).xmin).toBeCloseTo(-40, 9);
  });
  it("padrão linear de furo (4×, passo 20) e circular de ressaltos (6×360°)", () => {
    const s1 = sk("Chapa", rectSketch(100, 40).s);
    const e1 = F("Chapa", ext(s1.id, 8));
    const s2 = sk("Furo", circleSketch(10, 20, 3));
    const e2 = F("Furo", ext(s2.id, 0, "cut", { through: true }));
    const pat = F("Padrão", { t: "pattern", kind: "linear", targets: [e2.id], dir: { t: "axis", a: "X" }, count: 4, spacing: 20, angle: 0, reverse: false });
    let r = ev.evaluate("o8", [s1, e1, s2, e2, pat]);
    okAll(r);
    expect(rel(vol(r), 100 * 40 * 8 - 4 * PI * 9 * 8)).toBeLessThan(1e-9);
    // mudar a quantidade regenera
    r = ev.evaluate("o8", [s1, e1, s2, e2, { ...pat, count: 5 } as Feature]);
    expect(rel(vol(r), 100 * 40 * 8 - 5 * PI * 9 * 8)).toBeLessThan(1e-9);
    const d1 = sk("Disco", circleSketch(0, 0, 50));
    const e3 = F("Disco", ext(d1.id, 10));
    const b1 = sk("Pino", circleSketch(40, 0, 4), { t: "std", plane: "XY", offset: 10 });
    const e4 = F("Pino", ext(b1.id, 12, "join"));
    const cp = F("Polar", { t: "pattern", kind: "circular", targets: [e4.id], dir: { t: "axis", a: "Z" }, count: 6, spacing: 0, angle: 360, reverse: false });
    r = ev.evaluate("o9", [d1, e3, b1, e4, cp]);
    okAll(r);
    expect(rel(vol(r), PI * 2500 * 10 + 6 * PI * 16 * 12)).toBeLessThan(1e-9);
  });
  it("interseção e união por operação", () => {
    const s1 = sk("A", rectSketch(100, 100).s);
    const s2 = sk("B", circleSketch(100, 100, 50));
    const r = ev.evaluate("o10", [s1, F("A", ext(s1.id, 10)), s2, F("B", ext(s2.id, 10, "intersect"))]);
    okAll(r);
    expect(rel(vol(r), (PI * 2500 * 10) / 4)).toBeLessThan(1e-9);
  });
});

describe("falhas, supressão, rollback e desempenho", () => {
  // Auditoria FASE 3 (A01): este teste antes exigia o Ressalto "ok" sobre o sólido SEM o arredondamento que falhou —
  // geometria desatualizada. Agora o Ressalto fica com erro de dependência e o resultado é o último sólido válido.
  it("arredondamento impossível: erro claro, último sólido válido preservado, posteriores com erro de dependência", () => {
    const s1 = sk("E", rectSketch(20, 20).s);
    const e1 = F("Extrusão", ext(s1.id, 20));
    ev.evaluate("f1", [s1, e1]);
    const edge = ev.identifyEdge("f1", [s1, e1], 1, edgeNear(ev.shapeAt("f1", 1)!, { x: 20, y: 20, z: 10 }));
    const s3 = sk("Topo", circleSketch(10, 10, 3), { t: "std", plane: "XY", offset: 20 });
    const r = ev.evaluate("f1", [s1, e1, F("Arredondar", { t: "fillet", edges: [edge], r: 50 }), s3, F("Ressalto", ext(s3.id, 5, "join"))]);
    expect(r.status[2].state).toBe("error");
    expect(r.status[2].error).toMatch(/raio grande/i);
    expect(r.status[3].state).toBe("ok"); // esboço em plano padrão não usa o sólido
    expect(r.status[4].state).toBe("dependency_error");
    expect(r.failed?.name).toBe("Arredondar");
    expect(rel(vol(r), 8000)).toBeLessThan(1e-9);
  });
  it("perfil aberto, validação de parâmetros e corte sem sólido", () => {
    const open = sk("Aberto", addLine(emptySketch(), { x: 0, y: 0 }, { x: 10, y: 0 }).s);
    let r = ev.evaluate("f2", [open, F("X", ext(open.id, 5))]);
    expect(r.status[1].error).toMatch(/perfil/);
    const s = sk("E", rectSketch(10, 10).s);
    r = ev.evaluate("f2", [s, F("X", ext(s.id, -5))]);
    expect(r.status[1].error).toMatch(/maior que zero/);
    r = ev.evaluate("f2", [s, F("X", ext(s.id, 5, "cut"))]);
    expect(r.status[1].error).toMatch(/Não há sólido/);
  });
  it("suprimir e recuar (rollback)", () => {
    const s1 = sk("E", rectSketch(10, 10).s);
    const s2 = sk("T", rectSketch(10, 10).s, { t: "std", plane: "XY", offset: 10 });
    const feats = [s1, F("A", ext(s1.id, 10)), s2, F("B", ext(s2.id, 10, "join"))];
    let r = ev.evaluate("f3", feats);
    expect(rel(vol(r), 2000)).toBeLessThan(1e-12);
    r = ev.evaluate("f3", [...feats.slice(0, 3), { ...feats[3], suppressed: true } as Feature]);
    expect(rel(vol(r), 1000)).toBeLessThan(1e-12);
    expect(r.status[3].state).toBe("suppressed");
    r = ev.evaluate("f3", feats, { rollback: 2 });
    expect(rel(vol(r), 1000)).toBeLessThan(1e-12);
    expect(r.status[3].state).toBe("rolledback");
    r = ev.evaluate("f3", feats);
    expect(rel(vol(r), 2000)).toBeLessThan(1e-12);
  });
  it("desempenho: 40 operações; editar a última reaproveita o cache", () => {
    const s1 = sk("Chapa", rectSketch(400, 200).s);
    const feats: Feature[] = [s1, F("Chapa", ext(s1.id, 10))];
    for (let i = 0; i < 19; i++) {
      const s = sk(`F${i}`, circleSketch(20 + (i % 10) * 36, 50 + Math.floor(i / 10) * 100, 6));
      feats.push(s, F(`Furo${i}`, ext(s.id, 0, "cut", { through: true })));
    }
    const t0 = performance.now();
    let r = ev.evaluate("perf", feats);
    const full = performance.now() - t0;
    okAll(r);
    expect(rel(vol(r), 400 * 200 * 10 - 19 * PI * 36 * 10)).toBeLessThan(1e-9);
    const last = feats.length - 1;
    const edited = feats.map((f, i) => (i === last - 1 ? ({ ...f, sketch: circleSketch(20 + 8 * 36, 150, 8) } as Feature) : f));
    const t1 = performance.now();
    r = ev.evaluate("perf", edited);
    const incr = performance.now() - t1;
    okAll(r);
    expect(rel(vol(r), 400 * 200 * 10 - 18 * PI * 36 * 10 - PI * 64 * 10)).toBeLessThan(1e-9);
    expect(incr).toBeLessThan(full / 3);
    console.info(`regeneração completa ${full.toFixed(0)} ms · incremental ${incr.toFixed(0)} ms · ${feats.length} operações`);
  });
});
