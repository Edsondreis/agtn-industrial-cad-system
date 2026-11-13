import { mkdirSync, writeFileSync } from "node:fs";
import { segSeg, selfIntersections } from "@agtn/geometry";
import { type SheetOp, type SheetSolved, edgeSeg, flatPattern, solveSheet } from "@agtn/sheetgraph";
import { OcctSolidKernel } from "@agtn/solid";
import type { OcctKernel, ShapeHandle } from "occt-wasm";
import { bendAllowance, bendDeduction, insideSetback, outsideSetback } from "../../sheetmetal/src/bend";
import { aba, rectBase, spec } from "../../sheetmetal/src/sheet3d/testkit";
import { buildSheet } from "./build";

/**
 * FASE 4 · ETAPA 3 — AUDITORIA GEOMÉTRICA (G1–G4).
 *
 * O objetivo é NÃO conferir o motor contra ele mesmo. Cada medida é obtida por um caminho independente:
 *  - G1: as fórmulas do `bend.ts` contra a geometria pura (arco da fibra neutra integrado numericamente, recuo pela
 *        interseção das retas tangentes) — nenhuma chamada ao `bend.ts` no lado de referência;
 *  - G2/G3: cada peça da bateria do §5.2 é descrita por um MODELO DE SEÇÃO escrito aqui (caminhada pela face B e
 *        pela face A, retos e arcos, só com trigonometria) e comparada com o que o OCCT mede no sólido B-Rep
 *        (caixa, raios das faces cilíndricas, normais das faces planas, eixo de cada dobra, casca fechada) e com a
 *        planificação (comprimento, área, perímetro, posição das linhas de dobra, autointerseção);
 *  - G4: proveniência sob edição paramétrica.
 * Os resultados medidos são gravados em tests/output/auditoria_geometria.json (vão para o relatório).
 */
let S: OcctSolidKernel;
let k: OcctKernel;
const tmp: ShapeHandle[] = [];
const T_ = <H extends ShapeHandle>(h: H): H => (tmp.push(h), h);
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
const LOG: Record<string, unknown>[] = [];
afterAll(() => {
  mkdirSync("tests/output", { recursive: true });
  writeFileSync("tests/output/auditoria_geometria.json", JSON.stringify(LOG, null, 1));
  S.dispose();
});
const rad = (d: number) => (d * Math.PI) / 180;
const codes = (s: SheetSolved) => s.issues.filter((i) => i.level === "error").map((i) => i.code);

/* =============================================================================== G1 — fórmulas */

describe("G1 — fórmulas do bend.ts contra geometria pura", () => {
  it("BA = comprimento da fibra neutra (integração numérica); OSB/ISB = interseção das tangentes; BD = 2·OSB − BA", () => {
    let worst = 0;
    for (const th of [1, 15, 30, 45, 60, 90, 120, 135, 150, 170])
      for (const [R, T, K] of [[0.5, 1, 0.33], [2, 2, 0.43], [6, 3.18, 0.45], [20, 6.35, 0.5], [0, 2, 0.33]] as const) {
        const t = rad(th);
        // fibra neutra: arco de raio R + K·T, somado em 20 000 cordas (independe da fórmula fechada)
        const r = R + K * T;
        let arc = 0;
        const N = 20000;
        for (let i = 0; i < N; i++) {
          const a0 = (t * i) / N;
          const a1 = (t * (i + 1)) / N;
          arc += Math.hypot(r * (Math.cos(a1) - Math.cos(a0)), r * (Math.sin(a1) - Math.sin(a0)));
        }
        // recuo: face de raio ρ, tangentes nos dois extremos do arco, interseção = vértice virtual
        const setback = (rho: number) => {
          // arco de centro (0, ρ) partindo de (0, 0) com tangente (1, 0); tangente final (cos t, sin t)
          const end = { x: rho * Math.sin(t), y: rho - rho * Math.cos(t) };
          // reta 1: y = 0 ; reta 2: end + s·(cos t, sin t) → y = 0 em s = −end.y / sin t
          const s = -end.y / Math.sin(t);
          return end.x + s * Math.cos(t); // distância da tangência ao vértice virtual
        };
        const osb = setback(R + T);
        const isb = setback(R);
        const ba = bendAllowance(t, R, K, T);
        worst = Math.max(worst, Math.abs(ba - arc) / Math.max(arc, 1e-9));
        expect(Math.abs(ba - arc)).toBeLessThan(1e-7 * Math.max(1, arc));
        expect(Math.abs(outsideSetback(t, R, T) - osb)).toBeLessThan(1e-9 * Math.max(1, osb));
        expect(Math.abs(insideSetback(t, R) - isb)).toBeLessThan(1e-9 * Math.max(1, isb));
        expect(Math.abs(bendDeduction(t, R, K, T) - (2 * osb - arc))).toBeLessThan(1e-7 * Math.max(1, osb));
      }
    LOG.push({ teste: "G1 fórmulas", casos: 50, maiorErroRelativoBA: worst });
  });
  it("convenções: θ = 0 plana; α = 180° − θ; K não é universal (vem da tabela/operação, com origem)", () => {
    const s0 = solveSheet(spec(rectBase(100, 50)));
    expect(s0.bends).toEqual([]);
    const s = solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 60)));
    expect(s.bends[0].deflectionDeg).toBe(60);
    expect(s.bends[0].includedDeg).toBe(120);
    expect(s.bends[0].K).toBe(0.33); // K da peça (testkit), não 0,5
    expect(s.bends[0].kSource).toBe("manual");
  });
});

/* ===================================================================== modelo de seção independente */

interface Seg {
  /** comprimento até o vértice virtual (mm), na referência ref */
  H: number;
  th: number;
  R: number;
  K: number;
  side: "cima" | "baixo";
}
type V = { x: number; y: number };
/**
 * Seção (plano y–z) de uma base retangular Lb (na direção y) com uma cadeia de abas na aresta y = 0. Caminha pela
 * face B (z = 0 da base) e pela face A (z = T), da aresta livre y = Lb para a dobra. Só trigonometria aqui.
 */
function section(Lb: number, T: number, ref: "externa" | "interna", segs: readonly Seg[]) {
  const sb = (s: Seg) => (ref === "externa" ? (s.R + T) : s.R) * Math.tan(rad(s.th) / 2);
  // retos: base = Lb − SB1; aba i = H_i − SB_i − SB_{i+1}
  const straights = [Lb - (segs[0] ? sb(segs[0]) : 0), ...segs.map((s, i) => s.H - sb(s) - (segs[i + 1] ? sb(segs[i + 1]) : 0))];
  const BAs = segs.map((s) => rad(s.th) * (s.R + s.K * T));
  const walk = (face: "B" | "A") => {
    let p: V = { x: Lb, y: face === "A" ? T : 0 };
    let d: V = { x: -1, y: 0 };
    const pts: V[] = [p];
    const arcs: { c: V; r: number; a0: number; a1: number }[] = [];
    const centers: V[] = [];
    segs.forEach((s, i) => {
      p = { x: p.x + d.x * straights[i], y: p.y + d.y * straights[i] };
      pts.push(p);
      const up = s.side === "cima";
      const nrm = { x: d.y, y: -d.x }; // lado A (+z local)
      // face B é externa nas dobras "cima" e interna nas "baixo"; a face A, o contrário
      const outer = (face === "B") === up;
      const rho = outer ? s.R + T : s.R;
      const sg = up ? 1 : -1;
      const c = { x: p.x + nrm.x * rho * sg, y: p.y + nrm.y * rho * sg };
      const t = -rad(s.th) * sg; // d gira em direção ao lado A (+nrm): sentido horário no plano y–z
      const nd = { x: d.x * Math.cos(t) - d.y * Math.sin(t), y: d.x * Math.sin(t) + d.y * Math.cos(t) };
      const a0 = Math.atan2(p.y - c.y, p.x - c.x);
      const q = { x: c.x + (p.x - c.x) * Math.cos(t) - (p.y - c.y) * Math.sin(t), y: c.y + (p.x - c.x) * Math.sin(t) + (p.y - c.y) * Math.cos(t) };
      arcs.push({ c, r: rho, a0, a1: a0 + t });
      if (face === "B") centers.push(c);
      p = q;
      d = nd;
      pts.push(p);
    });
    const last = straights[straights.length - 1];
    // sem dobra: a base inteira é o único reto
    p = { x: p.x + d.x * last, y: p.y + d.y * last };
    pts.push(p);
    return { pts, arcs, centers };
  };
  const B = walk("B");
  const A = walk("A");
  const box = { y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  const put = (q: V) => {
    box.y0 = Math.min(box.y0, q.x);
    box.y1 = Math.max(box.y1, q.x);
    box.z0 = Math.min(box.z0, q.y);
    box.z1 = Math.max(box.z1, q.y);
  };
  for (const w of [A, B]) {
    w.pts.forEach(put);
    for (const a of w.arcs) {
      const lo = Math.min(a.a0, a.a1);
      const hi = Math.max(a.a0, a.a1);
      for (let m = -4; m <= 4; m++) {
        const ang = (m * Math.PI) / 2;
        if (ang > lo && ang < hi) put({ x: a.c.x + a.r * Math.cos(ang), y: a.c.y + a.r * Math.sin(ang) });
      }
    }
  }
  const flatLen = straights.reduce((a, b) => a + b, 0) + BAs.reduce((a, b) => a + b, 0);
  return { straights, BAs, box, flatLen, centers: B.centers };
}

/** casca fechada: toda aresta em 2 faces (ou costura de um cilindro inteiro) */
function freeEdges(shape: ShapeHandle): number {
  const m = k.edgeToFaceMap(shape, 1 << 22);
  const faces = new Map<number, Set<number>>();
  const seen = new Map<number, number>();
  for (let i = 0; i < m.length; ) {
    const e = m[i];
    const n = m[i + 1];
    const s = faces.get(e) ?? new Set<number>();
    for (let j = 0; j < n; j++) s.add(m[i + 2 + j]);
    faces.set(e, s);
    seen.set(e, (seen.get(e) ?? 0) + 1);
    i += 2 + n;
  }
  let free = 0;
  for (const [e, s] of faces) if (s.size < 2 && (seen.get(e) ?? 0) < 2) free++;
  return free;
}
function occtMeasure(shape: ShapeHandle) {
  const fs = k.getSubShapes(shape, "face").map(T_);
  const radii: number[] = [];
  const normals: { x: number; y: number; z: number }[] = [];
  const axes: { p: { x: number; y: number; z: number }; a: { x: number; y: number; z: number }; r: number }[] = [];
  for (const f of fs) {
    const t = k.surfaceType(f);
    const d = k.surfaceData(f) as unknown as { location: { x: number; y: number; z: number }; normal?: { x: number; y: number; z: number }; axis?: { x: number; y: number; z: number }; radius?: number };
    if (t === "cylinder") {
      radii.push(d.radius!);
      axes.push({ p: d.location, a: d.axis!, r: d.radius! });
    } else if (t === "plane") normals.push(d.normal!);
  }
  const bb = k.getBoundingBox(shape);
  return { faces: fs.length, radii, normals, axes, bb, free: freeEdges(shape), valid: k.isValid(shape), solids: k.getSubShapes(shape, "solid").map(T_).length };
}
const near = (a: number, b: number, t: number) => Math.abs(a - b) <= t;

/* ========================================================================== G2/G3 — bateria §5.2 */

type Case = { name: string; T: number; ref?: "externa" | "interna"; segs: Seg[]; R0?: number; K0?: number };
const W = 100;
const LB = 50;
const CASES: Case[] = [
  { name: "chapa plana", T: 2, segs: [] },
  { name: "uma dobra 90°", T: 2, segs: [{ H: 30, th: 90, R: 2, K: 0.33, side: "cima" }] },
  { name: "uma dobra 45°", T: 2, segs: [{ H: 30, th: 45, R: 2, K: 0.33, side: "cima" }] },
  { name: "uma dobra 135°", T: 2, segs: [{ H: 30, th: 135, R: 2, K: 0.33, side: "cima" }] },
  { name: "duas dobras em sentidos opostos (Z)", T: 2, segs: [{ H: 30, th: 90, R: 2, K: 0.33, side: "cima" }, { H: 20, th: 90, R: 2, K: 0.33, side: "baixo" }] },
  {
    name: "três dobras sequenciais, alturas diferentes",
    T: 2,
    segs: [
      { H: 40, th: 90, R: 2, K: 0.33, side: "cima" },
      { H: 25, th: 90, R: 2, K: 0.33, side: "cima" },
      { H: 12, th: 45, R: 2, K: 0.33, side: "cima" },
    ],
  },
  {
    name: "raios internos diferentes por dobra",
    T: 2,
    segs: [
      { H: 35, th: 90, R: 1, K: 0.33, side: "cima" },
      { H: 30, th: 60, R: 6, K: 0.33, side: "baixo" },
    ],
  },
  { name: "espessura 1 mm", T: 1, segs: [{ H: 30, th: 90, R: 1, K: 0.33, side: "cima" }] },
  { name: "espessura 6,35 mm", T: 6.35, segs: [{ H: 40, th: 90, R: 6.35, K: 0.33, side: "cima" }] },
  {
    name: "fatores K diferentes por dobra",
    T: 3,
    segs: [
      { H: 40, th: 90, R: 3, K: 0.3, side: "cima" },
      { H: 30, th: 90, R: 3, K: 0.5, side: "cima" },
    ],
  },
  {
    name: "medidas internas (ref. interna)",
    T: 3.18,
    ref: "interna",
    segs: [
      { H: 25.4, th: 90, R: 2, K: 0.43, side: "cima" },
      { H: 12, th: 90, R: 2, K: 0.43, side: "baixo" },
    ],
  },
];
function opsOf(c: Case): SheetOp[] {
  const ops: SheetOp[] = [];
  let parent: [string, string] = ["B", "L1"];
  c.segs.forEach((s, i) => {
    const id = `S${i}`;
    ops.push(aba(id, [parent], s.H, s.th, { side: s.side, ref: c.ref ?? "externa", R: s.R, K: s.K }));
    parent = [`${id}@${parent[0]}/${parent[1]}`, "ponta"];
  });
  return ops;
}

describe("G2/G3 — bateria do §5.2: sólido OCCT e planificação contra o modelo de seção independente", () => {
  for (const c of CASES)
    it(c.name, () => {
      const ref = c.ref ?? "externa";
      const s = solveSheet(spec(rectBase(W, LB, { T: c.T, R: c.segs[0]?.R ?? 2, K: c.segs[0]?.K ?? 0.33 }), ...opsOf(c)));
      expect(codes(s)).toEqual([]);
      const X = section(LB, c.T, ref, c.segs);
      const built = buildSheet(k, s, T_);
      const m = occtMeasure(built.shape);
      const tolL = 1e-6; // mm (OCCT 1e-7 + soma de transformações)
      // sólido
      expect(m.valid).toBe(true);
      expect(m.solids).toBe(1);
      expect(m.free).toBe(0);
      // volume: independente (retos × T × W + Σ θ·T·(R + T/2)·W)
      const Vref = c.T * W * X.straights.reduce((a, b) => a + b, 0) + c.segs.reduce((a, g) => a + rad(g.th) * c.T * (g.R + c.T / 2) * W, 0);
      expect(near(built.volume, Vref, 1e-9 * Vref)).toBe(true);
      // caixa: x ∈ [0, W]; (y, z) = caixa da seção
      expect(near(m.bb.xmin, 0, tolL) && near(m.bb.xmax, W, tolL)).toBe(true);
      if (!(near(m.bb.ymin, X.box.y0, tolL) && near(m.bb.ymax, X.box.y1, tolL) && near(m.bb.zmin, X.box.z0, tolL) && near(m.bb.zmax, X.box.z1, tolL)))
        process.stderr.write(`BOX ${c.name} occt ${JSON.stringify(m.bb)} ref ${JSON.stringify(X.box)}\n`);
      expect(near(m.bb.ymin, X.box.y0, tolL) && near(m.bb.ymax, X.box.y1, tolL)).toBe(true);
      expect(near(m.bb.zmin, X.box.z0, tolL) && near(m.bb.zmax, X.box.z1, tolL)).toBe(true);
      // raios: cada dobra tem faces cilíndricas de raio R (interna) e R + T (externa), e só essas
      const want = c.segs.flatMap((g) => [g.R, g.R + c.T]).sort((a, b) => a - b);
      const got = [...m.radii].sort((a, b) => a - b);
      expect(got.length).toBe(want.length);
      got.forEach((r, i) => expect(near(r, want[i], 1e-7)).toBe(true));
      // eixos: cada dobra tem um eixo paralelo a x passando pelo centro do arco da face B da seção
      for (const ctr of X.centers) {
        const hit = m.axes.some((ax) => Math.abs(Math.abs(ax.a.x) - 1) < 1e-9 && near(ax.p.y, ctr.x, tolL) && near(ax.p.z, ctr.y, tolL));
        expect(hit).toBe(true);
      }
      // ângulos: as normais das faces planas incluem a direção de cada aba (rotação acumulada em x)
      let phi = 0;
      for (const g of c.segs) {
        phi += (g.side === "cima" ? 1 : -1) * rad(g.th);
        // normal da face A da aba: (0, −sin φ… ) — basta a direção da reta da aba no plano y–z
        const n = { y: Math.sin(phi), z: Math.cos(phi) };
        const ok = m.normals.some((q) => Math.abs(q.x) < 1e-9 && Math.abs(Math.abs(q.y * n.y + q.z * n.z) - 1) < 1e-9);
        expect(ok).toBe(true);
      }
      // planificação
      const fp = flatPattern(s);
      expect(fp.state).toBe("valida");
      const h = fp.box.maxY - fp.box.minY;
      expect(near(h, X.flatLen, 1e-9)).toBe(true);
      expect(near(fp.box.maxX - fp.box.minX, W, 1e-9)).toBe(true);
      expect(near(fp.area, W * X.flatLen, 1e-9 * W * X.flatLen)).toBe(true);
      expect(near(fp.cutLength, 2 * (W + X.flatLen), 1e-9)).toBe(true);
      // linhas de dobra: distância desde a aresta livre = Σ retos + Σ BA anteriores + reto + BA/2
      let acc = 0;
      fp.bends.forEach((b, i) => {
        acc += X.straights[i];
        const yLine = fp.box.maxY - (acc + X.BAs[i] / 2);
        expect(near(b.line[0].y, yLine, 1e-9) && near(b.line[1].y, yLine, 1e-9)).toBe(true);
        expect(near(b.BA, X.BAs[i], 1e-12)).toBe(true);
        acc += X.BAs[i];
      });
      // contorno sem autointerseção
      for (const l of fp.cut) {
        const segs = l.map((a, i) => edgeSeg({ key: "", a, b: l[(i + 1) % l.length] }));
        expect(selfIntersections(segs, true, 1e-9)).toEqual([]);
      }
      LOG.push({
        teste: `G2 ${c.name}`,
        volume: { occt: built.volume, referencia: Vref, dif: built.volume - Vref },
        blank: { agtn: h, referencia: X.flatLen, dif: h - X.flatLen },
        caixa: { occt: [m.bb.ymin, m.bb.ymax, m.bb.zmin, m.bb.zmax], referencia: [X.box.y0, X.box.y1, X.box.z0, X.box.z1] },
        raios: got,
        faces: m.faces,
        arestasLivres: m.free,
      });
    });
});

/* ================================================================== G2 — recursos da ETAPA 2 no OCCT */

const relief = (kind: "retangular" | "oblongo" | "lagrima"): SheetOp => ({ t: "alivio", id: "AL", label: "AL", bends: ["A@B/L1"], kind, gap: 0.5 });
const rect = (x0: number, y0: number, x1: number, y1: number, key = "r") => ({
  key,
  segs: [
    { t: "line" as const, a: { x: x0, y: y0 }, b: { x: x1, y: y0 } },
    { t: "line" as const, a: { x: x1, y: y0 }, b: { x: x1, y: y1 } },
    { t: "line" as const, a: { x: x1, y: y1 }, b: { x: x0, y: y1 } },
    { t: "line" as const, a: { x: x0, y: y1 }, b: { x: x0, y: y0 } },
  ],
});
const IDS = ["S@B/L1+L@B/L2", "L@B/L2+N@B/L3", "N@B/L3+O@B/L4", "O@B/L4+S@B/L1"];
const box4 = (H = 30): SheetOp[] => [aba("S", [["B", "L1"]], H, 90), aba("L", [["B", "L2"]], H, 90), aba("N", [["B", "L3"]], H, 90), aba("O", [["B", "L4"]], H, 90)];
const FEATS: [string, SheetOp[], (s: SheetSolved) => number | null][] = [
  // [nome, operações, volume de referência independente (null = só conferências topológicas)]
  ["recuos 20/30 (faixa parcial)", [aba("A", [["B", "L1"]], 30, 90, { o0: 20, o1: 30 })], () => 2 * (100 * 50 - 4 * 50) + (Math.PI / 2) * 2 * 3 * 50 + 2 * 26 * 50],
  ["alívio retangular", [aba("A", [["B", "L1"]], 30, 90, { o0: 20, o1: 30 }), relief("retangular")], () => 2 * (100 * 50 - 4 * 50 - 2 * 2.5 * 4.5) + (Math.PI / 2) * 2 * 3 * 50 + 2 * 26 * 50],
  ["alívio oblongo", [aba("A", [["B", "L1"]], 30, 90, { o0: 20, o1: 30 }), relief("oblongo")], () => {
    const w = 2.5;
    const d = 4.5 + w / 2;
    return 2 * (100 * 50 - 4 * 50 - 2 * (w * (d - w / 2) + (Math.PI * (w / 2) ** 2) / 2)) + (Math.PI / 2) * 2 * 3 * 50 + 2 * 26 * 50;
  }],
  ["alívio lágrima", [aba("A", [["B", "L1"]], 30, 90, { o0: 20, o1: 30 }), relief("lagrima")], () => {
    const w = 2.5;
    return 2 * (100 * 50 - 4 * 50 - 2 * (w * 4.5 + (3 * Math.PI * w * w) / 4)) + (Math.PI / 2) * 2 * 3 * 50 + 2 * 26 * 50;
  }],
  ["furo a 0,5 mm da tangência", [aba("A", [["B", "L1"]], 30, 90), { t: "recorte", id: "H", label: "H", flange: "B", loops: [rect(40, 4.5, 60, 14.5, "h")] }], () => 2 * (100 * 46 - 200) + (Math.PI / 2) * 2 * 3 * 100 + 2 * 26 * 100],
  ["recorte atravessando a dobra", [aba("A", [["B", "L1"]], 30, 90), { t: "recorte_plano", id: "RP", label: "RP", loops: [rect(40, -5, 60, 10)] }], () => null],
  ["caixa com 4 cantos sobrepostos", [...box4(), ...IDS.map((id, i): SheetOp => ({ t: "canto", id: `C${i}`, label: `C${i}`, corners: [id], kind: "sobreposto", gap: 0.5, closer: i % 2 ? "b" : "a" }))], () => null],
  ["caixa com 4 cantos em esquadria", [...box4(), ...IDS.map((id, i): SheetOp => ({ t: "canto", id: `C${i}`, label: `C${i}`, corners: [id], kind: "esquadria", gap: 0.5 }))], () => null],
];

describe("G2 — recursos (recuos, alívios, recortes perto/atravessando dobra, cantos): sólido fechado e válido", () => {
  for (const [name, ops, Vref] of FEATS)
    it(name, () => {
      const s = solveSheet(spec(rectBase(100, 50), ...ops));
      expect(codes(s)).toEqual([]);
      const built = buildSheet(k, s, T_);
      const m = occtMeasure(built.shape);
      expect(m.valid).toBe(true);
      expect(m.solids).toBe(1);
      expect(m.free).toBe(0);
      const v = Vref(s);
      if (v !== null) expect(Math.abs(built.volume - v)).toBeLessThan(1e-9 * v);
      const fp = flatPattern(s);
      expect(fp.state).toBe("valida");
      // planificação ↔ 3D: volume = área plana × T só vale se tudo estiver plano; aqui: Σ regiões·T + Σ dobras
      for (const l of fp.cut) {
        const segs = l.map((a, i) => edgeSeg({ key: "", a, b: l[(i + 1) % l.length] }));
        // arcos dos alívios contam como cordas aqui: só para detectar laços cruzados
        expect(selfIntersections(segs, true, 1e-9)).toEqual([]);
      }
      LOG.push({ teste: `G2 ${name}`, volume: { occt: built.volume, referencia: v, grafo: s.volume }, faces: m.faces, arestasLivres: m.free, raios: [...new Set(m.radii.map((r) => +r.toFixed(9)))] });
    });
  it("recorte que encosta na região de dobra (sem atravessá-la): bloqueado, nunca aproximado", () => {
    const s = solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90), { t: "recorte", id: "H", label: "H", flange: "B", loops: [rect(40, 4, 60, 14, "h")] }));
    expect(codes(s)).toEqual(["CUT_EDGE"]);
  });
});

/* ================================================================== G2 — edição e desdobrar repetido */

describe("G2 — alteração de parâmetros depois da criação e desdobrar/redobrar repetido", () => {
  // T entra pela base; aqui só H, θ e R das abas e os 4 cantos encosto
  const part = (H: number, th: number, R: number): SheetOp[] => [
    ...box4(H).map((o) => (o.t === "aba" ? { ...o, bend: { ...o.bend, deflectionDeg: th, R } } : o)),
    ...IDS.map((id, i): SheetOp => ({ t: "canto", id: `C${i}`, label: `C${i}`, corners: [id], kind: "encosto", gap: 0.5, closer: i % 2 ? "b" : "a" })),
  ];
  const G = (s: SheetSolved) => s.flanges.map((f) => [...f.G]);
  it("editar H/θ/T/R e voltar ao valor original = peça idêntica (nada acumula)", () => {
    const base = (T: number) => rectBase(200, 120, { T });
    const a = solveSheet(spec(base(2), ...part(30, 90, 2)));
    for (const [H, th, T, R] of [[45, 80, 3, 1], [20, 95, 1.5, 4], [30, 90, 2, 2]] as const) {
      const b = solveSheet(spec(base(T), ...part(H, th, R)));
      expect(codes(b)).toEqual([]);
      const mb = occtMeasure(buildSheet(k, b, T_).shape);
      expect(mb.valid && mb.free === 0 && mb.solids === 1).toBe(true);
    }
    const back = solveSheet(spec(base(2), ...part(30, 90, 2)));
    expect(G(back)).toEqual(G(a));
    expect(back.volume).toBe(a.volume);
  });
  it("desdobrar/redobrar 10 vezes seguidas: G idênticas bit a bit e sólido igual", () => {
    const ops = part(30, 90, 2);
    const ref = solveSheet(spec(rectBase(200, 120), ...ops));
    const cyc: SheetOp[] = [];
    for (let i = 0; i < 10; i++) cyc.push({ t: "desdobrar", id: `U${i}`, label: `U${i}`, bends: [] }, { t: "redobrar", id: `R${i}`, label: `R${i}`, bends: [] });
    const s = solveSheet(spec(rectBase(200, 120), ...ops, ...cyc));
    expect(G(s)).toEqual(G(ref));
    expect(s.volume).toBe(ref.volume);
    const v1 = buildSheet(k, ref, T_).volume;
    const v2 = buildSheet(k, s, T_).volume;
    expect(v2).toBe(v1);
    LOG.push({ teste: "G2 desdobrar/redobrar ×10", volume: v2, igualBitABit: v1 === v2 });
  });
});

/* ======================================================================== G4 — proveniência */

describe("G4 — proveniência sob edição paramétrica", () => {
  const ops = (H: number): SheetOp[] => [
    aba("S", [["B", "L1"]], H, 90, { o0: 20, o1: 30 }),
    { t: "alivio", id: "AL", label: "AL", bends: ["S@B/L1"], kind: "oblongo", gap: 0.5 },
    aba("N", [["B", "L3"]], H, 90),
    { t: "recorte", id: "H", label: "H", flange: "B", loops: [rect(40, 25, 60, 35, "furo1")] },
    { t: "recorte_plano", id: "RP", label: "RP", loops: [rect(150, 110, 170, 125, "rasgo")] },
  ];
  it("rótulos das faces e chaves da planificação não mudam ao editar H e T (mesma topologia)", () => {
    const lab = (H: number, T: number) => {
      const s = solveSheet(spec(rectBase(200, 120, { T }), ...ops(H)));
      expect(codes(s)).toEqual([]);
      const b = buildSheet(k, s, T_);
      return {
        faces: b.faceLabels.map((l) => l.join("|")).sort(),
        flat: s.flanges.map((f) => `${f.id}:${f.flat.map((e) => e.key).join(",")}`),
        holes: s.flanges.flatMap((f) => f.holes.map((h) => h.key)).sort(),
      };
    };
    const a = lab(30, 2);
    const b = lab(42, 3);
    expect(b.faces).toEqual(a.faces);
    expect(b.flat).toEqual(a.flat);
    expect(b.holes).toEqual(a.holes);
    expect(a.holes).toEqual(["H#furo1"]);
    LOG.push({ teste: "G4 rótulos estáveis", faces: a.faces.length, chavesPlanificacao: a.flat.length });
  });
  it("nenhuma face sem origem e nenhum rótulo fora da superfície do grafo (conferido em cada build) — e a troca é pega", () => {
    const s = solveSheet(spec(rectBase(200, 120), ...ops(30)));
    // adulterar os rótulos (trocar duas faces) precisa ser recusado pela conferência
    expect(() =>
      buildSheet(k, s, T_, {
        tamper: (L) => {
          const i = L.findIndex((x) => x.some((y) => y.endsWith("/A")));
          const j = L.findIndex((x) => x.some((y) => y.includes("/e:")));
          [L[i], L[j]] = [L[j], L[i]];
        },
      }),
    ).toThrow(/Proveniência inconsistente/);
  });
  it("cruzamentos de segmentos: o laço do recorte plano não cruza nenhuma aresta da planificação (entalhe exato)", () => {
    const s = solveSheet(spec(rectBase(100, 50), aba("A", [["B", "L1"]], 30, 90), { t: "recorte_plano", id: "RP", label: "RP", loops: [rect(40, -5, 60, 10)] }));
    const fp = flatPattern(s);
    const outer = fp.cut[0];
    const inner = fp.cut[1];
    const sg = (l: typeof outer) => l.map((a, i) => edgeSeg({ key: "", a, b: l[(i + 1) % l.length] }));
    for (const a of sg(outer)) for (const b of sg(inner)) expect(segSeg(a, b)).toEqual([]);
  });
});
