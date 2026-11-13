import { type Sketch, addCircle, addLine, addRectangle, emptySketch } from "@agtn/sketch";
import { type Feature, type FeatureDraft, OcctSolidKernel, PartEvaluator, type PartResult } from "@agtn/solid";
import { type SheetState, createSheetBackend } from "./backend";
import { edgeFromFaces } from "./provenance";

/**
 * ETAPA 2.0 — identificadores estáveis e proveniência por construção. Nenhuma edição pode fazer uma operação
 * passar a usar OUTRA aba/aresta sem erro ou aviso.
 */
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
const F = (name: string, d: FeatureDraft, id: string): Feature => ({ ...(d as object), id, name }) as Feature;
const sk = (s: Sketch, offset = 0, id = "S1") => F("Esboço", { t: "sketch", plane: { t: "std", plane: "XY", offset }, sketch: s }, id);
const base = (sketch = "S1") => F("Chapa_1", { t: "sheetBase", sketch, T: 2, R: 2, K: 0.33, material: "aco_carbono", process: "ar", ref: "externa", side: "cima" }, "CH");
const st = (r: PartResult) => r.sheet?.state as SheetState;
const states = (r: PartResult) => r.status.map((s) => s.state);
type Seg = { id?: string; length: number; deflectionDeg: number; side: "cima" | "baixo"; R: number | null; K: number | null };
const seg = (length: number, id?: string): Seg => ({ ...(id ? { id } : {}), length, deflectionDeg: 90, side: "cima", R: null, K: null });
const contour = (edge: string, segments: Seg[]) => F("Flange_1", { t: "sheetContour", edge: { flange: "CH", edge }, ref: "externa", segments }, "FC");
const flangeOn = (flange: string, edge: string, length = 10) =>
  F("Aba_1", { t: "sheetFlange", edges: [{ flange, edge }], length, deflectionDeg: 90, R: null, K: null, side: "baixo", ref: "externa" }, "AB");

describe("A2 — segmentos do flange de contorno com id próprio", () => {
  const r0 = addRectangle(emptySketch(), { x: 0, y: 0 }, { x: 200, y: 60 });
  it("remover o segmento do MEIO não muda o segmento onde está a aba (antes ia para outro sem aviso)", () => {
    const full = [seg(30, "s1"), seg(40, "s2"), seg(20, "s3")];
    const a = ev.evaluate("c1", [sk(r0.s), base(), contour(r0.lines[0], full), flangeOn("FC#s3", "ponta")]);
    expect(states(a)).toEqual(["ok", "ok", "ok", "ok"]);
    const fa = st(a).solved.flanges.find((f) => f.id === "AB@FC#s3/ponta")!;
    // sem o s2: a aba continua na ponta do s3 (comprimento 20), que agora nasce do s1
    const b = ev.evaluate("c1", [sk(r0.s), base(), contour(r0.lines[0], [full[0], full[2]]), flangeOn("FC#s3", "ponta")]);
    expect(states(b)).toEqual(["ok", "ok", "ok", "ok"]);
    const pb = st(b).solved.bends.find((x) => x.child === "AB@FC#s3/ponta")!;
    expect(pb.parent).toBe("FC#s3");
    expect(st(b).solved.flanges.find((f) => f.id === "FC#s3")!.outline.find((e) => e.key === "ponta")).toBeTruthy();
    expect(fa).toBeTruthy();
    // sem o s3: referência perdida, explícita
    const c = ev.evaluate("c1", [sk(r0.s), base(), contour(r0.lines[0], full.slice(0, 2)), flangeOn("FC#s3", "ponta")]);
    expect(c.status[3].state).toBe("error");
    expect(c.status[3].error).toContain("referência perdida");
  });
  it("arquivo da ETAPA 1 (segmentos sem id) regenera com os mesmos ids #1, #2", () => {
    const r = ev.evaluate("c2", [sk(r0.s), base(), contour(r0.lines[0], [seg(30), seg(15)]), flangeOn("FC#2", "ponta")]);
    expect(states(r)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(st(r).solved.flanges.map((f) => f.id)).toEqual(["CH", "FC#1", "FC#2", "AB@FC#2/ponta"]);
  });
  it("ids repetidos → erro", () => {
    const r = ev.evaluate("c3", [sk(r0.s), base(), contour(r0.lines[0], [seg(30, "s1"), seg(15, "s1")])]);
    expect(r.status[2].error).toContain("mesmo id");
  });
});

describe("A3 — linha da base dividida: chave pelo que a divide", () => {
  it("L1 cortada por L9 vira L1[P~X:L9] e L1[X:L9~P]; outro corte muda as chaves (sem renumerar)", () => {
    const r0 = addRectangle(emptySketch(), { x: 0, y: 0 }, { x: 100, y: 50 });
    const L1 = r0.lines[0];
    // linha vertical que cruza o fundo e termina dentro: divide L1 no x = 40
    const cut1 = addLine(r0.s, { x: 40, y: -10 }, { x: 40, y: 20 });
    const a = ev.evaluate("d1", [sk(cut1.s), base()]);
    expect(states(a)).toEqual(["ok", "ok"]);
    const keys = st(a).solved.flanges[0].outline.map((e) => e.key);
    const pieces = keys.filter((k) => k.startsWith(`${L1}[`));
    expect(pieces).toEqual([`${L1}[${r0.points[0]}~X:${cut1.id}]`, `${L1}[X:${cut1.id}~${r0.points[1]}]`]);
    // segundo corte em x = 70: o trecho da direita muda de chave; o da esquerda continua o mesmo
    const cut2 = addLine(cut1.s, { x: 70, y: -10 }, { x: 70, y: 20 });
    const b = ev.evaluate("d1", [sk(cut2.s), base()]);
    const keys2 = st(b).solved.flanges[0].outline.map((e) => e.key).filter((k) => k.startsWith(`${L1}[`));
    expect(keys2).toEqual([`${L1}[${r0.points[0]}~X:${cut1.id}]`, `${L1}[X:${cut1.id}~X:${cut2.id}]`, `${L1}[X:${cut2.id}~${r0.points[1]}]`]);
    expect(keys2).not.toContain(pieces[1]);
  });
});

describe("A4 — furos com chave pelas entidades do esboço", () => {
  it("acrescentar outro círculo ao esboço do recorte não renumera os furos existentes", () => {
    const r0 = addRectangle(emptySketch(), { x: 0, y: 0 }, { x: 100, y: 60 });
    const c1 = addCircle(emptySketch(), { x: 70, y: 30 }, 4);
    const c2 = addCircle(c1.s, { x: 20, y: 30 }, 4);
    const cut = (s: Sketch) => [sk(r0.s), base(), sk(s, 2, "S2"), F("Recorte_1", { t: "sheetCut", sketch: "S2", flange: "CH" }, "RC")];
    const a = ev.evaluate("h1", cut(c1.s));
    const b = ev.evaluate("h1", cut(c2.s));
    const keysA = st(a).solved.flanges[0].holes.map((h) => h.key);
    const keysB = st(b).solved.flanges[0].holes.map((h) => h.key).sort();
    expect(keysA).toEqual([`RC#${c1.id}`]);
    expect(keysB).toEqual([`RC#${c1.id}`, `RC#${c2.id}`].sort());
  });
});

describe("A1/A5 — proveniência por construção e arestas", () => {
  it("bandeja 4 abas: toda aresta de borda resolve para UMA (aba, aresta); arestas com o mesmo id são paralelas (faces A e B da mesma borda)", () => {
    const r0 = addRectangle(emptySketch(), { x: 0, y: 0 }, { x: 300, y: 200 });
    const four = F("Aba_1", { t: "sheetFlange", edges: r0.lines.map((l) => ({ flange: "CH", edge: l })), length: 40, deflectionDeg: 90, R: null, K: null, side: "cima", ref: "externa" }, "A4");
    const r = ev.evaluate("e1", [sk(r0.s), base(), four]);
    expect(states(r)).toEqual(["ok", "ok", "ok"]);
    const k = K.raw;
    const faces = k.getSubShapes(r.shape!, "face");
    const edges = k.getSubShapes(r.shape!, "edge");
    const labels = st(r).faceLabels;
    const groups = new Map<string, { a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number } }[]>();
    let amb = 0;
    for (const e of edges) {
      const own = faces.map((f, i) => [f, i] as const).filter(([f]) => k.getSubShapes(f, "edge").some((x) => k.isSame(x, e)));
      if (own.length !== 2) continue;
      const id = edgeFromFaces(labels[own[0][1]], labels[own[1][1]]);
      if (id === "ambigua") amb++;
      if (!id || id === "ambigua") continue;
      const vs = k.getSubShapes(e, "vertex").map((v) => k.vertexPosition(v));
      const key = `${id.flange}/${id.edge}`;
      groups.set(key, [...(groups.get(key) ?? []), { a: vs[0], b: vs[1] ?? vs[0] }]);
    }
    expect(amb).toBe(0);
    for (const fl of st(r).solved.flanges.slice(1)) for (const e of ["ponta", "lado0", "lado1"]) expect(groups.has(`${fl.id}/${e}`)).toBe(true);
    for (const [, list] of groups) {
      const dir = (q: (typeof list)[number]) => {
        const v = { x: q.b.x - q.a.x, y: q.b.y - q.a.y, z: q.b.z - q.a.z };
        const L = Math.hypot(v.x, v.y, v.z);
        return { x: v.x / L, y: v.y / L, z: v.z / L };
      };
      const d0 = dir(list[0]);
      for (const q of list) {
        const d = dir(q);
        expect(Math.hypot(d.y * d0.z - d.z * d0.y, d.z * d0.x - d.x * d0.z, d.x * d0.y - d.y * d0.x)).toBeLessThan(1e-9);
      }
    }
  });
});
