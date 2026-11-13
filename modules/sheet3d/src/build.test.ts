import { type SheetOp, type SheetSolved, sheetMath as M, solveSheet } from "@agtn/sheetgraph";
import { OcctSolidKernel } from "@agtn/solid";
import type { OcctKernel, ShapeHandle } from "occt-wasm";
import { aba, rectBase, spec } from "../../sheetmetal/src/sheet3d/testkit";
import { buildSheet, exactBox } from "./build";
import { edgeFromFaces, isContactLabel } from "./provenance";

let S: OcctSolidKernel;
let k: OcctKernel;
const tmp: ShapeHandle[] = [];
const T = <H extends ShapeHandle>(h: H): H => {
  tmp.push(h);
  return h;
};
beforeAll(async () => {
  S = await OcctSolidKernel.create();
  k = S.raw;
});
afterEach(() => {
  for (const h of tmp.splice(0))
    try {
      k.release(h);
    } catch {
      /* */
    }
});
afterAll(() => S.dispose());

const solve = (...a: Parameters<typeof spec>) => {
  const s = solveSheet(spec(...a));
  if (!s.ok) throw new Error(s.issues.map((i) => i.message).join("; "));
  return s;
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));
const four = (len: number, th = 90, o: Parameters<typeof aba>[4] = {}): SheetOp => aba("A", [["B", "L1"], ["B", "L2"], ["B", "L3"], ["B", "L4"]], len, th, o);

/** normal orientada (para fora do material) da face final com o rótulo */
function normalOf(_s: SheetSolved, shape: ShapeHandle, labels: readonly (readonly string[])[], label: string) {
  const i = labels.findIndex((l) => l.includes(label));
  expect(i).toBeGreaterThanOrEqual(0);
  const f = T(k.getSubShapes(shape, "face").map(T)[i]);
  const d = k.surfaceData(f) as unknown as { normal: { x: number; y: number; z: number } };
  return M.unit3(k.shapeOrientation(f) === "reversed" ? M.mul3(d.normal, -1) : d.normal);
}

describe("sólido de chapa (OCCT) — validade, volume, medidas", () => {
  it("L 50 × 30: válido, 1 sólido, volume = fórmula (1e-9), caixa exata", () => {
    const s = solve(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90));
    const b = buildSheet(k, s, T);
    expect(k.isValid(b.shape)).toBe(true);
    expect(k.getSubShapes(b.shape, "solid").map(T).length).toBe(1);
    expect(rel(b.volume, s.volume)).toBeLessThan(1e-9);
    const bb = k.getBoundingBox(b.shape);
    const ex = exactBox(s);
    expect(bb.xmin).toBeCloseTo(0, 9);
    expect(bb.ymin).toBeCloseTo(0, 9);
    expect(bb.zmax).toBeCloseTo(30, 9);
    expect(bb.ymax).toBeCloseTo(50, 9);
    expect(ex.max.z).toBeCloseTo(30, 12);
    expect(b.warnings).toEqual([]);
  });
  it("bandeja 710.0CUH25-01-03 (canto aberto): volume, sem interferência, K = 0,5 → V = T·área plana", () => {
    for (const K of [0.33, 0.5]) {
      const s = solve(rectBase(535, 520, { T: 3.18, R: 2, K }), four(25.4));
      const b = buildSheet(k, s, T);
      expect(rel(b.volume, s.volume)).toBeLessThan(1e-9);
      if (K === 0.5) expect(rel(b.volume, 3.18 * s.flatArea)).toBeLessThan(1e-9);
      else {
        const diff = s.bends.reduce((a, x) => a + 3.18 * (0.5 - K) * (Math.PI / 2) * 3.18 * x.L, 0);
        expect(Math.abs(b.volume - 3.18 * s.flatArea - diff)).toBeLessThan(1e-6);
      }
      expect(b.warnings).toEqual([]);
    }
  });
  it("espessura medida = T em todas as abas (faces A × B)", () => {
    const s = solve(rectBase(300, 200, { T: 4, R: 6 }), four(60, 60));
    const b = buildSheet(k, s, T);
    const faces = k.getSubShapes(b.shape, "face").map(T);
    for (const f of s.flanges) {
      const ia = b.faceLabels.findIndex((l) => l.includes(`${f.id}/A`));
      const ib = b.faceLabels.findIndex((l) => l.includes(`${f.id}/B`));
      const da = k.surfaceData(faces[ia]) as unknown as { location: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } };
      const db = k.surfaceData(faces[ib]) as unknown as { location: { x: number; y: number; z: number } };
      expect(Math.abs(M.dot3(M.sub3(db.location, da.location), M.unit3(da.normal)))).toBeCloseTo(4, 9);
    }
  });
});

describe("ângulos medidos no OCCT — normais orientadas, eixo e sentido (cuidado 1)", () => {
  for (const side of ["cima", "baixo"] as const)
    for (const th of [30, 45, 90, 120, 135])
      it(`${side} θ ${th}°: θ com sinal em torno do eixo e α = 180° − θ`, () => {
        const s = solve(rectBase(120, 80), aba("A", [["B", "L1"]], 40, th, { side }));
        const b = buildSheet(k, s, T);
        const bend = s.bends[0];
        const u = M.unit3(bend.axis.dir);
        const nP = normalOf(s, b.shape, b.faceLabels, "B/A");
        const nC = normalOf(s, b.shape, b.faceLabels, `${bend.child}/A`);
        const signed = (Math.atan2(M.dot3(M.cross3(nP, nC), u), M.dot3(nP, nC)) * 180) / Math.PI;
        expect(signed).toBeCloseTo(th, 9);
        // lado de dentro: a face interna (B para cima, A para baixo) é o cilindro de raio R
        const inner = normalOf(s, b.shape, b.faceLabels, side === "cima" ? "B/B" : "B/A");
        expect(Math.sign(M.dot3(inner, M.v3(0, 0, 1)))).toBe(side === "cima" ? 1 : -1);
        // α: ângulo entre as abas (direções que se afastam da dobra), medido pelas faces de ponta
        const tip = normalOf(s, b.shape, b.faceLabels, `${bend.child}/e:ponta`); // = direção da aba-filha
        const back = normalOf(s, b.shape, b.faceLabels, "B/e:L3"); // = direção da base, para longe da dobra
        expect((Math.acos(M.dot3(tip, back)) * 180) / Math.PI).toBeCloseTo(180 - th, 9);
        // a aba sobe ou desce
        expect(Math.sign(tip.z)).toBe(side === "cima" ? 1 : -1);
      });
});

describe("proveniência (2.2)", () => {
  it("toda face final tem origem; contatos previstos somem e nenhum outro rótulo some", () => {
    const s = solve(rectBase(300, 200), four(40), aba("C", [["A@B/L1", "ponta"]], 15, 90));
    const b = buildSheet(k, s, T);
    expect(b.faceLabels.every((l) => l.length > 0)).toBe(true);
    const all = new Set(b.faceLabels.flat());
    for (const f of s.flanges) for (const r of ["A", "B"]) expect(all.has(`${f.id}/${r}`)).toBe(true);
    for (const x of s.bends) {
      expect(all.has(`${x.id}/int`)).toBe(true);
      expect(all.has(`${x.id}/ext`)).toBe(true);
      expect(isContactLabel(`${x.id}/c0`, s)).toBe(true);
    }
    // aresta da ponta da aba A.1 (onde está C) não está mais livre; as outras pontas sim
    expect(all.has("A@B/L2/e:ponta")).toBe(true);
    expect(all.has("A@B/L1/e:ponta")).toBe(false);
  });
  it("determinismo: duas regenerações → mesmo mapa de proveniência", () => {
    const s = solve(rectBase(300, 200), four(40, 75));
    const a = buildSheet(k, s, T).faceLabels;
    const c = buildSheet(k, s, T).faceLabels;
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
  });
  it("aresta escolhida → (aba, aresta) pelos rótulos das faces vizinhas", () => {
    const s = solve(rectBase(300, 200), aba("A", [["B", "L1"]], 40, 90));
    const b = buildSheet(k, s, T);
    const faces = k.getSubShapes(b.shape, "face").map(T);
    const edges = k.getSubShapes(b.shape, "edge").map(T);
    const ids = new Set<string>();
    for (const e of edges) {
      const owners = faces.map((f, i) => [f, i] as const).filter(([f]) => k.getSubShapes(f, "edge").map(T).some((x) => k.isSame(x, e)));
      if (owners.length !== 2) continue;
      const r = edgeFromFaces(b.faceLabels[owners[0][1]], b.faceLabels[owners[1][1]]);
      if (r && r !== "ambigua") ids.add(`${r.flange}:${r.edge}`);
    }
    for (const want of ["B:L2", "B:L3", "B:L4", "A@B/L1:ponta", "A@B/L1:lado0", "A@B/L1:lado1"]) expect(ids.has(want)).toBe(true);
    expect(ids.has("B:L1")).toBe(false); // aresta dobrada: não é mais aresta de borda
  });
  it("conferência: rótulo trocado à força → erro 'proveniência inconsistente'", () => {
    const s = solve(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90));
    expect(() =>
      buildSheet(k, s, T, {
        tamper: (l) => {
          const i = l.findIndex((x) => x.includes("B/A"));
          const j = l.findIndex((x) => x.includes("B/B"));
          [l[i], l[j]] = [l[j], l[i]];
        },
      }),
    ).toThrow(/Proveniência inconsistente/);
  });
  it("colisão de hash: detectada; nova tentativa com outro limite; todas colidindo → erro explícito", () => {
    const s = solve(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90));
    expect(() => buildSheet(k, s, T, { ubs: [3] })).toThrow(/Colisão de identificadores/);
    const ok = buildSheet(k, s, T, { ubs: [3, 2147483647] });
    expect(ok.faceLabels.every((l) => l.length)).toBe(true);
  });
});

describe("interferência e contato (2.3 / cuidado 2)", () => {
  it("abas opostas inclinadas para dentro que se cruzam → INTERFERÊNCIA com as abas e o volume", () => {
    const s = solve(rectBase(100, 30), aba("A", [["B", "L1"], ["B", "L3"]], 40, 135));
    expect(() => buildSheet(k, s, T)).toThrow(/Interferência entre abas\/dobras: .*A\.1 × .*A\.2: [\d,]+ mm³/);
  });
  it("canto aberto com R = 0: abas vizinhas encostam numa aresta → aviso de contato (não erro)", () => {
    const s = solve(rectBase(200, 100, { R: 0 }), four(30));
    const b = buildSheet(k, s, T);
    expect(b.warnings.some((w) => w.startsWith("Contato"))).toBe(true);
  });
  it("canto aberto 90° padrão: folga R entre as abas, sem aviso", () => {
    const s = solve(rectBase(200, 100), four(30));
    expect(buildSheet(k, s, T).warnings).toEqual([]);
  });
});

describe("desempenho (referência)", () => {
  it("20 abas (10 laterais + 10 retornos) em base de 10 lados", () => {
    const N = 10;
    const pts = Array.from({ length: N }, (_, i) => ({ x: 300 * Math.cos((2 * Math.PI * i) / N), y: 300 * Math.sin((2 * Math.PI * i) / N) }));
    const base = { ...rectBase(1, 1), outline: pts.map((a, i) => ({ key: `L${i + 1}`, a, b: pts[(i + 1) % N] })) };
    const ops: SheetOp[] = [aba("A", pts.map((_, i) => ["B", `L${i + 1}`] as [string, string]), 50, 90), aba("C", pts.map((_, i) => [`A@B/L${i + 1}`, "ponta"] as [string, string]), 15, 90, { side: "baixo" })];
    const t0 = performance.now();
    const s = solve(base, ...ops);
    const t1 = performance.now();
    const b = buildSheet(k, s, T);
    const t2 = performance.now();
    console.log(`DESEMPENHO 20 abas: solve ${(t1 - t0).toFixed(1)} ms; OCCT ${(t2 - t1).toFixed(1)} ms (peças ${b.ms.pieces.toFixed(1)}, interferência ${b.ms.checks.toFixed(1)}, fusão ${b.ms.fuse.toFixed(1)})`);
    expect(s.flanges.length).toBe(21);
    expect(rel(b.volume, s.volume)).toBeLessThan(1e-9);
  });
});
