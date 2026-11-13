/**
 * Auditoria da FASE 3 — avaliador paramétrico (OCCT real).
 * A01: nenhuma operação fica "ok" sobre geometria desatualizada; estados inequívocos; recuperação.
 * A02: referências não trocam de face/aresta em silêncio; ambiguidade → erro explícito; determinismo.
 * A05: resultados válidos (BRep, volume, área, nº de sólidos) ou erro explícito.
 */
import { type Sketch, addCircle, addConstraint, addLine, addPointEntity, addRectangle, emptySketch, solve } from "@agtn/sketch";
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
const F = (name: string, d: FeatureDraft): Feature => ({ ...(d as object), id: `a${++seq}`, name }) as Feature;
type R = ReturnType<PartEvaluator["evaluate"]>;
const vol = (r: R) => k.raw.getVolume(r.shape!);
const states = (r: R) => r.status.map((s) => s.state);

function rectAt(x0: number, y0: number, w: number, h: number): Sketch {
  const r = addRectangle(emptySketch(), { x: x0 + 1, y: y0 + 1 }, { x: x0 + w - 1, y: y0 + h - 1 });
  let s = addConstraint(r.s, { t: "fixed", p: r.points[0], x: x0, y: y0 }).s;
  s = addConstraint(s, { t: "length", l: r.lines[0], v: w }).s;
  s = addConstraint(s, { t: "length", l: r.lines[1], v: h }).s;
  const res = solve(s);
  expect(res.status).toBe("full");
  return res.sketch;
}
const sk = (name: string, sketch: Sketch, plane: Extract<Feature, { t: "sketch" }>["plane"] = { t: "std", plane: "XY", offset: 0 }) => F(name, { t: "sketch", plane, sketch });
const ext = (sketchId: string, depth: number, op: "new" | "join" | "cut" | "intersect" = "new", more: Partial<Extract<FeatureDraft, { t: "extrude" }>> = {}) =>
  ({ t: "extrude", sketch: sketchId, regions: null, depth, mode: "one", depth2: 0, reverse: false, through: false, op, ...more }) as FeatureDraft;
function near(kind: "edge" | "face", shape: number, p: { x: number; y: number; z: number }): number {
  const subs = k.raw.getSubShapes(shape as never, kind);
  let best = -1;
  let bd = Infinity;
  subs.forEach((e, i) => {
    const v = k.raw.makeVertex(p.x, p.y, p.z);
    const d = k.raw.distanceBetween(v, e);
    k.raw.release(v);
    if (d < bd) [bd, best] = [d, i];
  });
  return best;
}

/** Base 100×60×20 com arredondamento R5 na aresta vertical (100,60). */
function plate(id: string) {
  const s1 = sk("Esboço_Base", rectAt(0, 0, 100, 60));
  const e1 = F("Extrusão_Base", ext(s1.id, 20));
  ev.evaluate(id, [s1, e1]);
  const edge = ev.identifyEdge(id, [s1, e1], 1, near("edge", ev.shapeAt(id, 1)!, { x: 100, y: 60, z: 10 }));
  return { s1, e1, edge };
}
const FILLET_LOSS = (25 - (25 * PI) / 4) * 20; // R5 × 20

describe("A01 — propagação de erros", () => {
  it("corte intermediário falha → arredondamento posterior NÃO fica 'ok'; corrigir regenera a cadeia inteira", () => {
    const { s1, e1, edge } = plate("e1");
    const sOpen = sk("Esboço_Rasgo", addLine(emptySketch(), { x: 20, y: 20 }, { x: 40, y: 20 }).s); // perfil aberto
    const cut = F("Rasgo", ext(sOpen.id, 0, "cut", { through: true }));
    const fil = F("Arredondar", { t: "fillet", edges: [edge], r: 5 });
    let r = ev.evaluate("e1", [s1, e1, sOpen, cut, fil]);
    expect(r.status[3].state).toBe("error");
    expect(r.status[4].state).toBe("dependency_error");
    expect(r.status[4].error).toMatch(/Rasgo/);
    // o sólido exibido é o último válido (antes do Rasgo) e o resultado diz isso explicitamente
    expect(r.failed?.id).toBe(cut.id);
    expect(rel(vol(r), 100 * 60 * 20)).toBeLessThan(1e-12);
    // corrigido o esboço, tudo volta a 'ok' com o volume correto (rasgo 20×10 passante + R5)
    const sFix = { ...sOpen, sketch: rectAt(20, 20, 20, 10) } as Feature;
    r = ev.evaluate("e1", [s1, e1, sFix, cut, fil]);
    expect(states(r)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(r.failed).toBeNull();
    expect(rel(vol(r), 120000 - 200 * 20 - FILLET_LOSS)).toBeLessThan(1e-9);
  });

  it("extrusão-base falha → todas as operações sobre o sólido ficam com erro de dependência", () => {
    const s1 = sk("Esboço_Base", addLine(emptySketch(), { x: 0, y: 0 }, { x: 10, y: 0 }).s);
    const e1 = F("Extrusão_Base", ext(s1.id, 20));
    const s2 = sk("Topo", rectAt(0, 0, 5, 5), { t: "std", plane: "XY", offset: 20 });
    const e2 = F("Ressalto", ext(s2.id, 5, "join"));
    const r = ev.evaluate("e2", [s1, e1, s2, e2]);
    expect(states(r)).toEqual(["ok", "error", "ok", "dependency_error"]); // esboço em plano padrão não depende do sólido
    expect(r.shape).toBeNull();
  });

  it("operação intermediária suprimida: dependentes são suprimidos junto (intencional); independentes seguem válidos", () => {
    const { s1, e1 } = plate("e3");
    const shape = ev.shapeAt("e3", 1)!;
    const top = ev.identifyFace("e3", [s1, e1], 1, near("face", shape, { x: 50, y: 30, z: 20 }));
    const s2 = F("Esboço_Topo", { t: "sketch", plane: { t: "face", face: top, offset: 0 }, sketch: addCircle(emptySketch(), { x: 50, y: 30 }, 5).s });
    const h = F("Furo", ext(s2.id, 0, "cut", { through: true }));
    const s3 = sk("Lateral", rectAt(0, 0, 10, 10), { t: "std", plane: "XY", offset: 20 });
    const e3 = F("Ressalto", ext(s3.id, 5, "join"));
    const base = [s1, e1, s2, h, s3, e3];
    let r = ev.evaluate("e3", base);
    expect(states(r)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
    // suprimir o esboço do topo: o furo depende dele → suprimido junto (como nos CAD de histórico); o ressalto não
    // depende do furo e é avaliado sobre a peça sem furo — geometria intencional, não desatualizada
    r = ev.evaluate("e3", base.map((f) => (f.id === s2.id ? ({ ...f, suppressed: true } as Feature) : f)));
    expect(states(r)).toEqual(["ok", "ok", "suppressed", "suppressed", "ok", "ok"]);
    expect(r.status[3].error).toMatch(/Suprimida junto com Esboço_Topo/);
    expect(r.status[3].cause).toBe(s2.id);
    expect(r.failed).toBeNull();
    expect(rel(vol(r), 120000 + 500)).toBeLessThan(1e-9);
  });

  it("operação excluída: referência a operação inexistente é erro da própria operação (não 'ok')", () => {
    const { s1, edge } = plate("e4");
    const fil = F("Arredondar", { t: "fillet", edges: [edge], r: 5 });
    const r = ev.evaluate("e4", [s1, fil]); // Extrusão_Base apagada
    expect(r.status[1].state).not.toBe("ok");
  });

  it("referência topológica some → erro explícito; o que vem depois fica com erro de dependência", () => {
    const { s1, e1, edge } = plate("e5");
    const fil = F("Arredondar", { t: "fillet", edges: [edge], r: 5 });
    const s3 = sk("Topo", rectAt(10, 10, 10, 10), { t: "std", plane: "XY", offset: 20 });
    const e3 = F("Ressalto", ext(s3.id, 5, "join"));
    // a base vira círculo: as faces laterais de origem (linhas) deixam de existir
    const s1b = { ...s1, sketch: addCircle(emptySketch(), { x: 50, y: 30 }, 25).s } as Feature;
    const r = ev.evaluate("e5", [s1b, e1, fil, s3, e3]);
    expect(states(r)).toEqual(["ok", "ok", "error", "ok", "dependency_error"]);
    expect(r.status[2].error).toMatch(/Referência perdida/);
  });

  it("combinação: corpo-ferramenta com erro → erro de dependência (não usa geometria velha)", () => {
    const { s1, e1 } = plate("e6");
    const comb = F("União", { t: "combine", op: "join", tools: ["corpoX"] });
    let r = ev.evaluate("e6", [s1, e1, comb], { external: () => ({ sig: "x", shape: null, error: "Arredondar_1 com erro" }) });
    expect(r.status[2].state).toBe("dependency_error");
    expect(r.status[2].error).toMatch(/Arredondar_1/);
    r = ev.evaluate("e6", [s1, e1, comb], { external: () => null });
    expect(r.status[2].state).toBe("error");
  });
});

describe("A02 — referências topológicas", () => {
  it("duas faces coplanares (topos de dois ressaltos na mesma altura): mover um ressalto não troca a face", () => {
    // base 150×20×10 + ressalto A (30..50) e ressalto B (60..90), ambos com topo em z = 20
    const s0 = sk("Base", rectAt(0, 0, 150, 20));
    const e0 = F("Base", ext(s0.id, 10));
    const sA = sk("A", rectAt(30, 0, 20, 20), { t: "std", plane: "XY", offset: 10 });
    const eA = F("RessaltoA", ext(sA.id, 10, "join"));
    const sB = sk("B", rectAt(60, 0, 30, 20), { t: "std", plane: "XY", offset: 10 });
    const eB = F("RessaltoB", ext(sB.id, 10, "join"));
    const feats = [s0, e0, sA, eA, sB, eB];
    ev.evaluate("t1", feats);
    const topB = ev.identifyFace("t1", feats, 5, near("face", ev.shapeAt("t1", 5)!, { x: 75, y: 10, z: 20 }));
    const sh = F("Casca", { t: "shell", faces: [topB], thickness: 2 });
    let r = ev.evaluate("t1", [...feats, sh]);
    expect(r.status[6].error ?? "").toBe("");
    // B vai para 120..150: o ponto-semente antigo (75, 10, 20) fica MAIS PERTO do topo de A (30..50)
    const sB2 = { ...sB, sketch: rectAt(120, 0, 30, 20) } as Feature;
    const moved = [s0, e0, sA, eA, sB2, eB];
    r = ev.evaluate("t1", [...moved, sh]);
    expect(r.status[6].error ?? "").toBe("");
    const v = vol(r);
    // referência: casca abrindo o topo de B identificado do zero na posição nova — e o de A, para comparar
    const ref = (p: { x: number; y: number; z: number }) => {
      const e2 = new PartEvaluator(k);
      e2.evaluate("x", moved);
      const face = e2.identifyFace("x", moved, 5, near("face", e2.shapeAt("x", 5)!, p));
      const out = vol(e2.evaluate("x", [...moved, { ...sh, faces: [face] } as Feature]));
      e2.releaseAll();
      return out;
    };
    const vB = ref({ x: 135, y: 10, z: 20 });
    const vA = ref({ x: 40, y: 10, z: 20 });
    expect(Math.abs(vA - vB)).toBeGreaterThan(10); // as duas escolhas dão sólidos diferentes
    expect(rel(v, vB)).toBeLessThan(1e-9); // e a referência continuou no topo de B
  });

  it("mover o furo: arredondamento na borda do furo acompanha (âncora do furo, não posição antiga)", () => {
    const { s1, e1 } = plate("t2");
    const top = ev.identifyFace("t2", [s1, e1], 1, near("face", ev.shapeAt("t2", 1)!, { x: 50, y: 30, z: 20 }));
    const pt = addPointEntity(emptySketch(), { x: 30, y: 30 });
    const s2 = F("Centros", { t: "sketch", plane: { t: "face", face: top, offset: 0 }, sketch: pt.s });
    const hole = F("Furo", { t: "hole", sketch: s2.id, d: 10, depth: 0, through: true, reverse: false, cbore: null, csink: null });
    const feats = [s1, e1, s2, hole];
    let r = ev.evaluate("t2", feats);
    expect(r.status[3].state).toBe("ok");
    const rim = ev.identifyEdge("t2", feats, 3, near("edge", r.shape!, { x: 35, y: 30, z: 20 }));
    const fil = F("Borda", { t: "fillet", edges: [rim], r: 1 });
    r = ev.evaluate("t2", [...feats, fil]);
    expect(r.status[4].state).toBe("ok");
    const v0 = vol(r);
    // furo vai de x=30 para x=70
    const moved = { ...s2, sketch: { ...pt.s, points: { ...pt.s.points, [pt.p]: { ...pt.s.points[pt.p], x: 70 } } } } as Feature;
    r = ev.evaluate("t2", [s1, e1, moved, hole, fil]);
    expect(r.status[4].state).toBe("ok");
    expect(rel(vol(r), v0)).toBeLessThan(1e-9);
  });

  it("padrão: aumentar a quantidade mantém a referência; diminuir até a cópia sumir → erro explícito", () => {
    const { s1, e1 } = plate("t3");
    const top = ev.identifyFace("t3", [s1, e1], 1, near("face", ev.shapeAt("t3", 1)!, { x: 50, y: 30, z: 20 }));
    const s2 = F("Centros", { t: "sketch", plane: { t: "face", face: top, offset: 0 }, sketch: addPointEntity(emptySketch(), { x: 15, y: 30 }).s });
    const hole = F("Furo", { t: "hole", sketch: s2.id, d: 6, depth: 0, through: true, reverse: false, cbore: null, csink: null });
    const pat = F("Padrão", { t: "pattern", kind: "linear", targets: [hole.id], dir: { t: "axis", a: "X" }, count: 3, spacing: 20, angle: 360, reverse: false });
    const feats = [s1, e1, s2, hole, pat];
    let r = ev.evaluate("t3", feats);
    expect(r.status[4].state).toBe("ok");
    // borda da 3ª cópia (x = 55)
    const rim = ev.identifyEdge("t3", feats, 4, near("edge", r.shape!, { x: 58, y: 30, z: 20 }));
    const fil = F("Borda", { t: "fillet", edges: [rim], r: 0.5 });
    r = ev.evaluate("t3", [...feats, fil]);
    expect(r.status[5].state).toBe("ok");
    const v3 = vol(r);
    r = ev.evaluate("t3", [s1, e1, s2, hole, { ...pat, count: 4 } as Feature, fil]);
    expect(r.status[5].state).toBe("ok");
    expect(rel(vol(r), v3 - PI * 9 * 20)).toBeLessThan(1e-9);
    r = ev.evaluate("t3", [s1, e1, s2, hole, { ...pat, count: 2 } as Feature, fil]);
    expect(r.status[5].state).toBe("error");
    expect(r.status[5].error).toMatch(/Referência perdida|ambígua/);
  });

  it("determinismo: mesma peça em avaliadores novos → mesmo volume, área e nº de faces", () => {
    const { s1, e1, edge } = plate("t4");
    const feats = [s1, e1, F("Arredondar", { t: "fillet", edges: [edge], r: 5 })];
    const outs = [0, 1, 2].map(() => {
      const e = new PartEvaluator(k);
      const r = e.evaluate("x", JSON.parse(JSON.stringify(feats)));
      const out = [vol(r), k.raw.getSurfaceArea(r.shape!), k.raw.getSubShapes(r.shape!, "face").length];
      e.releaseAll();
      return out;
    });
    expect(outs[1]).toEqual(outs[0]);
    expect(outs[2]).toEqual(outs[0]);
  });
});

/**
 * Edição paramétrica com referência guardada: o resultado tem que ser OU "ok" igual ao de uma escolha nova da
 * MESMA entidade na geometria editada, OU erro explícito de referência. Nunca "ok" com outra entidade.
 */
function sameOrExplicit(id: string, after: Feature[], refAt: number, op: (ref: never) => Feature, kind: "face" | "edge", probe: { x: number; y: number; z: number } | null, oldOp: Feature) {
  const r = ev.evaluate(id, [...after, oldOp]);
  const st = r.status.at(-1)!;
  if (st.state !== "ok") {
    expect(st.error).toMatch(/Referência (perdida|ambígua)/);
    return "erro explícito";
  }
  expect(probe).not.toBeNull();
  const e2 = new PartEvaluator(k);
  e2.evaluate("fresh", after);
  const idx = near(kind, e2.shapeAt("fresh", refAt)!, probe!);
  const ref = kind === "face" ? e2.identifyFace("fresh", after, refAt, idx) : e2.identifyEdge("fresh", after, refAt, idx);
  const fresh = e2.evaluate("fresh", [...after, op(ref as never)]);
  expect(fresh.status.at(-1)!.state).toBe("ok");
  expect(rel(vol(r), vol(fresh))).toBeLessThan(1e-9);
  e2.releaseAll();
  return "acompanhou";
}

describe("A02 — cenários de edição com referência guardada", () => {
  it("largura/altura do esboço, profundidade e raio anterior: a aresta acompanha", () => {
    const { s1, e1, edge } = plate("c1");
    const fil = F("R5", { t: "fillet", edges: [edge], r: 5 });
    const ch = F("Chanfro", { t: "chamfer", edges: [ev.identifyEdge("c1", [s1, e1], 1, near("edge", ev.shapeAt("c1", 1)!, { x: 50, y: 60, z: 20 }))], d: 1 });
    const out: string[] = [];
    // 1) esboço 100×60 → 140×90 (a aresta (100,60) vai para (140,90))
    const s1b = { ...s1, sketch: rectAt(0, 0, 140, 90) } as Feature;
    out.push(sameOrExplicit("c1", [s1b, e1], 1, (r) => ({ ...fil, edges: [r] }) as Feature, "edge", { x: 140, y: 90, z: 10 }, fil));
    // 2) profundidade 20 → 35
    const e1b = { ...e1, depth: 35 } as Feature;
    out.push(sameOrExplicit("c1", [s1, e1b], 1, (r) => ({ ...fil, edges: [r] }) as Feature, "edge", { x: 100, y: 60, z: 17 }, fil));
    // 3) raio do arredondamento anterior 5 → 8: o chanfro (aresta superior traseira) acompanha
    const r5 = ev.evaluate("c1", [s1, e1, fil, ch]);
    expect(states(r5)).toEqual(["ok", "ok", "ok", "ok"]);
    const v5 = vol(r5);
    const r8 = ev.evaluate("c1", [s1, e1, { ...fil, r: 8 } as Feature, ch]);
    expect(states(r8)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(vol(r8)).toBeLessThan(v5);
    expect(out).toEqual(["acompanhou", "acompanhou"]);
  });

  it("espelho com plano mudado: aresta da cópia espelhada não troca para a original", () => {
    const { s1, e1 } = plate("c2");
    const mir = F("Espelho", { t: "mirror", plane: { t: "std", plane: "YZ", offset: 0 }, targets: null });
    const feats = [s1, e1, mir];
    const r = ev.evaluate("c2", feats);
    expect(rel(vol(r), 240000)).toBeLessThan(1e-12);
    const e = ev.identifyEdge("c2", feats, 2, near("edge", r.shape!, { x: -100, y: 60, z: 10 }));
    const fil = F("R3", { t: "fillet", edges: [e], r: 3 });
    expect(ev.evaluate("c2", [...feats, fil]).status.at(-1)!.state).toBe("ok");
    // plano YZ deslocado −30: a cópia vai para x ∈ [−160, −60]
    const mir2 = { ...mir, plane: { t: "std", plane: "YZ", offset: -30 } } as Feature;
    const res = sameOrExplicit("c2", [s1, e1, mir2], 2, (x) => ({ ...fil, edges: [x] }) as Feature, "edge", { x: -160, y: 60, z: 10 }, fil);
    expect(["acompanhou", "erro explícito"]).toContain(res);
  });

  it("revolução, varredura e loft com perfil/caminho/seções mudados: segue a mesma face ou erro explícito", () => {
    // revolução: anel r 40..60, h 20 → casca abrindo o topo; perfil vira r 40..70
    const ring = (r1: number) => rectAt(40, 0, r1 - 40, 20);
    const sR = F("Perfil", { t: "sketch", plane: { t: "std", plane: "XZ", offset: 0 }, sketch: ring(60) });
    const rev = F("Revolução", { t: "revolve", sketch: sR.id, regions: null, axis: "AY", angle: 360, op: "new" });
    let r = ev.evaluate("c3", [sR, rev]);
    expect(rel(vol(r), PI * (3600 - 1600) * 20)).toBeLessThan(1e-9);
    const top = ev.identifyFace("c3", [sR, rev], 1, near("face", r.shape!, { x: 50, y: 0, z: 20 }));
    const sh = F("Casca", { t: "shell", faces: [top], thickness: 2 });
    expect(ev.evaluate("c3", [sR, rev, sh]).status.at(-1)!.state).toBe("ok");
    const out = [sameOrExplicit("c3", [{ ...sR, sketch: ring(70) } as Feature, rev], 1, (f) => ({ ...sh, faces: [f] }) as Feature, "face", { x: 55, y: 0, z: 20 }, sh)];
    // varredura: círculo Ø10 ao longo de linha de 100 → caminho de 150
    const path = (L: number) => addLine(emptySketch(), { x: 0, y: 0 }, { x: 0, y: L }).s;
    const sP = F("Caminho", { t: "sketch", plane: { t: "std", plane: "XY", offset: 0 }, sketch: path(100) });
    const sC = F("Seção", { t: "sketch", plane: { t: "std", plane: "XZ", offset: 0 }, sketch: addCircle(emptySketch(), { x: 0, y: 0 }, 5).s });
    const sw = F("Varredura", { t: "sweep", profile: sC.id, path: sP.id, op: "new" });
    r = ev.evaluate("c4", [sP, sC, sw]);
    expect(rel(vol(r), PI * 25 * 100)).toBeLessThan(1e-6);
    const endF = ev.identifyFace("c4", [sP, sC, sw], 2, near("face", r.shape!, { x: 0, y: 100, z: 0 }));
    const sh2 = F("Casca", { t: "shell", faces: [endF], thickness: 1 });
    out.push(sameOrExplicit("c4", [{ ...sP, sketch: path(150) } as Feature, sC, sw], 2, (f) => ({ ...sh2, faces: [f] }) as Feature, "face", { x: 0, y: 150, z: 0 }, sh2));
    // loft: quadrado 40 → 20 a 50 mm; seção superior vira 30
    const sq = (a: number) => rectAt(-a / 2, -a / 2, a, a);
    const l1 = F("S1", { t: "sketch", plane: { t: "std", plane: "XY", offset: 0 }, sketch: sq(40) });
    const l2 = F("S2", { t: "sketch", plane: { t: "std", plane: "XY", offset: 50 }, sketch: sq(20) });
    const lo = F("Loft", { t: "loft", sections: [l1.id, l2.id], ruled: true, op: "new" });
    r = ev.evaluate("c5", [l1, l2, lo]);
    expect(rel(vol(r), (50 / 3) * (1600 + 400 + 800))).toBeLessThan(1e-9);
    const topL = ev.identifyFace("c5", [l1, l2, lo], 2, near("face", r.shape!, { x: 0, y: 0, z: 50 }));
    const sh3 = F("Casca", { t: "shell", faces: [topL], thickness: 1 });
    out.push(sameOrExplicit("c5", [l1, { ...l2, sketch: sq(30) } as Feature, lo], 2, (f) => ({ ...sh3, faces: [f] }) as Feature, "face", { x: 0, y: 0, z: 50 }, sh3));
    console.info("referências após edição (revolução, varredura, loft):", out.join(" · "));
  });

  it("inserir e remover operações anteriores que não geram a entidade: a referência continua", () => {
    const { s1, e1, edge } = plate("c6");
    const fil = F("R5", { t: "fillet", edges: [edge], r: 5 });
    const v0 = vol(ev.evaluate("c6", [s1, e1, fil]));
    const sH = sk("Rasgo", rectAt(20, 20, 20, 10), { t: "std", plane: "XY", offset: 20 });
    const cut = F("Rasgo", ext(sH.id, 5, "cut", { reverse: true }));
    const r1 = ev.evaluate("c6", [s1, e1, sH, cut, fil]);
    expect(states(r1)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(rel(vol(r1), v0 - 20 * 10 * 5)).toBeLessThan(1e-9);
    const r2 = ev.evaluate("c6", [s1, e1, fil]);
    expect(rel(vol(r2), v0)).toBeLessThan(1e-12);
  });
});

describe("A05 — validade dos resultados OCCT", () => {
  it("cada operação: sólido válido, volume/área com fórmula, 1 sólido", () => {
    const s1 = sk("Base", rectAt(0, 0, 100, 50));
    const e1 = F("Base", ext(s1.id, 10));
    const r = ev.evaluate("v1", [s1, e1]);
    expect(k.raw.isValid(r.shape!)).toBe(true);
    expect(rel(vol(r), 50000)).toBeLessThan(1e-12);
    expect(rel(k.raw.getSurfaceArea(r.shape!), 2 * (100 * 50 + 100 * 10 + 50 * 10))).toBeLessThan(1e-12);
    expect(k.raw.getSubShapes(r.shape!, "solid").length).toBe(1);
  });
  it("corte que não toca a peça avisa (ferramenta no sentido errado) — não passa calado", () => {
    const s1 = sk("Base", rectAt(0, 0, 50, 50));
    const s2 = sk("Rasgo", rectAt(10, 10, 10, 10), { t: "std", plane: "XY", offset: 10 });
    const r = ev.evaluate("v3", [s1, F("Base", ext(s1.id, 10)), s2, F("Rasgo", ext(s2.id, 5, "cut"))]);
    expect(r.status[3].state).toBe("ok");
    expect(r.status[3].warning).toMatch(/não removeu material/);
    const r2 = ev.evaluate("v3", [s1, F("Base", ext(s1.id, 10)), s2, F("Rasgo", ext(s2.id, 5, "cut", { reverse: true }))]);
    expect(r2.status[3].warning).toBeUndefined();
    expect(rel(vol(r2), 25000 - 500)).toBeLessThan(1e-11); // booleana: ruído de 1e-12 relativo
  });
  it("unir corpo separado (sem contato) avisa: resultado com 2 sólidos não passa como peça única", () => {
    const s1 = sk("A", rectAt(0, 0, 10, 10));
    const s2 = sk("B", rectAt(50, 0, 10, 10));
    const r = ev.evaluate("v2", [s1, F("A", ext(s1.id, 10)), s2, F("B", ext(s2.id, 10, "join"))]);
    expect(r.status[3].state).toBe("ok");
    expect(r.status[3].warning).toMatch(/2 sólidos/);
    expect(k.raw.getSubShapes(r.shape!, "solid").length).toBe(2);
  });
});
