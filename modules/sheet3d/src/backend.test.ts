import { flatPattern } from "@agtn/sheetgraph";
import { type Sketch, addCircle, addLine, addRectangle, emptySketch, removeEntities } from "@agtn/sketch";
import { type Feature, type FeatureDraft, OcctSolidKernel, PartEvaluator, type PartResult } from "@agtn/solid";
import { type SheetState, createSheetBackend } from "./backend";

let K: OcctSolidKernel;
let ev: PartEvaluator;
beforeAll(async () => {
  K = await OcctSolidKernel.create();
  ev = new PartEvaluator(K, createSheetBackend());
});
afterAll(() => {
  ev.releaseAll();
  K.dispose();
});

let seq = 0;
const F = (name: string, d: FeatureDraft, id = `f${++seq}`): Feature => ({ ...(d as object), id, name }) as Feature;
const sk = (s: Sketch, offset = 0, id?: string) => F("Esboço", { t: "sketch", plane: { t: "std", plane: "XY", offset }, sketch: s }, id);
const rect = (w: number, h: number) => addRectangle(emptySketch(), { x: 0, y: 0 }, { x: w, y: h });
const base = (sketch: string, o: Partial<Extract<FeatureDraft, { t: "sheetBase" }>> = {}, id = "CH") =>
  F("Chapa_1", { t: "sheetBase", sketch, T: 2, R: 2, K: 0.33, material: "aco_carbono", process: "ar", ref: "externa", side: "cima", ...o }, id);
const flange = (edges: { flange: string; edge: string; hint?: { a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number } } }[], length: number, deflectionDeg = 90, id?: string) =>
  F("Aba_1", { t: "sheetFlange", edges, length, deflectionDeg, R: null, K: null, side: "cima", ref: "externa" }, id);
const st = (r: PartResult) => r.sheet?.state as SheetState;
const states = (r: PartResult) => r.status.map((s) => s.state);
const vol = (r: PartResult) => K.raw.getVolume(r.shape!);
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));

describe("chapa no PartEvaluator (ponto de extensão)", () => {
  it("base + aba: sólido válido, volume = fórmula, planificação válida 100 × 76,178318", () => {
    const r0 = rect(100, 50);
    const s = sk(r0.s);
    const r = ev.evaluate("p1", [s, base(s.id), flange([{ flange: "CH", edge: r0.lines[0] }], 30)]);
    expect(states(r)).toEqual(["ok", "ok", "ok"]);
    expect(rel(vol(r), st(r).solved.volume)).toBeLessThan(1e-9);
    const fp = flatPattern(st(r).solved);
    expect(fp.state).toBe("valida");
    expect(fp.box.maxY - fp.box.minY).toBeCloseTo(76.178318229, 8);
    expect(st(r).faceLabels.length).toBe(K.raw.getSubShapes(r.shape!, "face").length);
  });
  it("K da tabela (material × processo × R/T) com origem 'estimado' quando K = null", () => {
    const r0 = rect(100, 50);
    const s = sk(r0.s);
    const r = ev.evaluate("p2", [s, base(s.id, { K: null }), flange([{ flange: "CH", edge: r0.lines[0] }], 30)]);
    const b = st(r).solved.bends[0];
    expect(b.K).toBe(0.43); // aço carbono, ar, R/T = 1 → faixa [1,3)
    expect(b.kSource).toBe("estimado");
    expect(r.status[2].warning).toContain("estimado");
  });
  it("edição paramétrica: T, θ, comprimento e medida da base → aba continua na MESMA aresta", () => {
    const r0 = rect(100, 50);
    const s = sk(r0.s, 0, "S1");
    const L3 = r0.lines[2];
    const mk = (w: number, T: number, th: number, len: number) => {
      const rr = addRectangle(emptySketch(), { x: 0, y: 0 }, { x: w, y: 50 });
      return [sk(rr.s, 0, "S1"), base("S1", { T }), flange([{ flange: "CH", edge: L3 }], len, th, "AB")];
    };
    for (const [w, T, th, len] of [[100, 2, 90, 30], [140, 3, 60, 45], [90, 1.5, 120, 20]] as const) {
      const r = ev.evaluate("p3", mk(w, T, th, len));
      expect(states(r)).toEqual(["ok", "ok", "ok"]);
      const f = st(r).solved.flanges.find((x) => x.id === `AB@CH/${L3}`)!;
      // a aba nasce na aresta de cima (y = 50): origem do sistema local da aba sobre a linha de molde y ≈ 50
      const bend = st(r).solved.bends[0];
      expect(bend.edge).toBe(L3);
      expect(bend.flatLine[0].y).toBeGreaterThan(50 - bend.SB);
      expect(f).toBeTruthy();
      expect(rel(vol(r), st(r).solved.volume)).toBeLessThan(1e-9);
    }
    expect(s.id).toBe("S1");
  });
  it("linha da aresta apagada → 'referência perdida' na aba; dependente fica dependency_error", () => {
    const r0 = rect(100, 50);
    const L1 = r0.lines[0];
    const s2 = { ...r0.s, entities: { ...r0.s.entities } };
    // apaga L1 e redesenha em dois trechos (mesma reta) → sem L1
    let t = removeEntities(r0.s, [L1]);
    const p = r0.points;
    t = addLine(t, p[0], { x: 50, y: 0 }).s;
    const mid = Object.values(t.points).find((q) => q.x === 50 && q.y === 0)!.id;
    t = addLine(t, mid, p[1]).s;
    const feats = (sketch: Sketch, hint?: boolean) => {
      const s = sk(sketch, 0, "S9");
      const h = hint ? { a: { x: 0, y: 0, z: 0 }, b: { x: 100, y: 0, z: 0 } } : undefined;
      return [s, base("S9"), flange([{ flange: "CH", edge: L1, ...(h ? { hint: h } : {}) }], 30, 90, "A1"), flange([{ flange: `A1@CH/${L1}`, edge: "ponta" }], 10, 90, "A2")];
    };
    const ok = ev.evaluate("p4", feats(s2));
    expect(states(ok)).toEqual(["ok", "ok", "ok", "ok"]);
    const lost = ev.evaluate("p4", feats(t));
    expect(states(lost)).toEqual(["ok", "ok", "error", "dependency_error"]);
    expect(lost.status[2].error).toContain("referência perdida");
    // com a posição guardada: duas linhas na mesma reta → ambígua (não escolhe sozinho)
    const amb = ev.evaluate("p4", feats(t, true));
    expect(amb.status[2].error).toContain("referência ambígua");
    // redesenhada inteira no mesmo lugar (outro id) → recuperada com aviso
    let one = removeEntities(r0.s, [L1]);
    one = addLine(one, p[0], p[1]).s;
    const rec = ev.evaluate("p4", feats(one, true));
    expect(states(rec)).toEqual(["ok", "ok", "ok", "ok"]); // id da aba 1 preservado: a aba 2 continua ligada
    expect(rec.status[2].warning).toMatch(new RegExp(`recuperada por geometria — ${L1} → L\\d+`));
  });
  it("operação sólida genérica depois da chapa: permitida, planificação marcada; chapa depois dela → erro", () => {
    const r0 = rect(100, 50);
    const s = sk(r0.s);
    const c = sk(addCircle(emptySketch(), { x: 50, y: 25 }, 5).s, 2);
    const ext = F("Ressalto_1", { t: "extrude", sketch: c.id, regions: null, depth: 5, mode: "one", depth2: 0, reverse: false, through: false, op: "join" });
    const r = ev.evaluate("p5", [s, base(s.id), flange([{ flange: "CH", edge: r0.lines[0] }], 30), c, ext]);
    expect(states(r)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(r.sheet!.generic).toEqual(["Ressalto_1"]);
    const r2 = ev.evaluate("p5", [s, base(s.id), flange([{ flange: "CH", edge: r0.lines[0] }], 30), c, ext, flange([{ flange: "CH", edge: r0.lines[2] }], 30)]);
    expect(r2.status[5].state).toBe("error");
    expect(r2.status[5].error).toContain("deixou de ser só chapa");
  });
  it("dobra por linha (esboço na face) e recorte: planificação = chapa original, volume com furo", () => {
    const r0 = rect(100, 60);
    const s = sk(r0.s);
    const ln = sk(addLine(emptySketch(), { x: 40, y: -10 }, { x: 40, y: 70 }).s, 2);
    const lineId = Object.values(ln.t === "sketch" ? ln.sketch.entities : {})[0].id;
    const hole = sk(addCircle(emptySketch(), { x: 15, y: 30 }, 4).s, 2);
    const bl = F("Dobra_1", { t: "sheetBendLine", sketch: ln.id, line: lineId, flange: "CH", deflectionDeg: 90, R: null, K: 0.5, side: "cima", ref: "externa", fixed: "esq" });
    const cut = F("Recorte_1", { t: "sheetCut", sketch: hole.id, flange: "CH" });
    const r = ev.evaluate("p6", [s, base(s.id), ln, bl, hole, cut]);
    expect(states(r)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
    const sv = st(r).solved;
    expect(sv.flatArea).toBeCloseTo(100 * 60 - Math.PI * 16, 9);
    expect(rel(vol(r), 2 * sv.flatArea)).toBeLessThan(1e-9); // K = 0,5 → V = T·área
    const fp = flatPattern(sv);
    expect(fp.state).toBe("valida");
    expect(fp.holes.length).toBe(1);
  });
  it("esboço fora da face da aba → erro explícito", () => {
    const r0 = rect(100, 60);
    const s = sk(r0.s);
    const hole = sk(addCircle(emptySketch(), { x: 15, y: 30 }, 4).s, 7);
    const r = ev.evaluate("p7", [s, base(s.id), hole, F("Recorte_1", { t: "sheetCut", sketch: hole.id, flange: "CH" })]);
    expect(r.status[3].error).toContain("não está sobre uma face");
  });
  it("flange de contorno (U) pela tabela de segmentos", () => {
    const r0 = rect(200, 50);
    const s = sk(r0.s);
    const ct = F("Flange_1", {
      t: "sheetContour",
      edge: { flange: "CH", edge: r0.lines[0] },
      ref: "externa",
      segments: [
        { length: 40, deflectionDeg: 90, side: "cima", R: null, K: null },
        { length: 25, deflectionDeg: 90, side: "cima", R: 3, K: 0.4 },
      ],
    });
    const r = ev.evaluate("p8", [s, base(s.id), ct]);
    expect(states(r)).toEqual(["ok", "ok", "ok"]);
    expect(st(r).solved.flanges.map((f) => f.id)).toEqual(["CH", `${ct.id}#1`, `${ct.id}#2`]);
    expect(rel(vol(r), st(r).solved.volume)).toBeLessThan(1e-9);
  });
  it("base de chapa precisa ser a primeira operação sólida; uma por corpo", () => {
    const r0 = rect(100, 50);
    const s = sk(r0.s);
    const c = sk(addCircle(emptySketch(), { x: 50, y: 25 }, 5).s, 0);
    const ext = F("Cilindro", { t: "extrude", sketch: c.id, regions: null, depth: 5, mode: "one", depth2: 0, reverse: false, through: false, op: "new" });
    const r = ev.evaluate("p9", [c, ext, s, base(s.id)]);
    expect(r.status[3].error).toContain("primeira operação sólida");
  });
});

describe("compatibilidade e ambiente", () => {
  it("sem motor de chapa → erro explícito (não trava)", () => {
    const e2 = new PartEvaluator(K);
    const r0 = rect(100, 50);
    const s = sk(r0.s);
    const r = e2.evaluate("q1", [s, base(s.id)]);
    expect(r.status[1].state).toBe("error");
    expect(r.status[1].error).toContain("motor de chapa não está carregado");
    e2.releaseAll();
  });
  it("operação desconhecida (versão mais nova) → erro claro; dependentes não avaliados", () => {
    const r0 = rect(100, 50);
    const s = sk(r0.s);
    const future = { id: "X1", name: "Calandra_1", t: "sheetRoll", radius: 300 } as unknown as Feature;
    const r = ev.evaluate("q2", [s, base(s.id), future, flange([{ flange: "CH", edge: r0.lines[0] }], 30)]);
    expect(r.status[2].state).toBe("error");
    expect(r.status[2].error).toBe("A operação Calandra_1 (sheetRoll) é de uma versão mais nova do AGTN CAD — atualize para editar. Ela foi preservada no arquivo.");
    expect(r.status[3].state).toBe("dependency_error");
  });
});
