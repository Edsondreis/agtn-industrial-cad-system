/**
 * P-F5-01 — superfícies de revolução que fecham num polo (tampos elípticos, calotas): suíte dedicada.
 *
 * Referências INDEPENDENTES do OCCT: volume por fórmula fechada (π∫r²dx), área da superfície curva por
 * quadratura de Gauss–Legendre de 2π∫r·|C'(t)|dt (precisão ~1e-13), caixa pela geometria. Para o caso com bocal
 * (sem fórmula fechada) a referência é o B-rep CONSTRUÍDO em memória, antes de passar por STEP (indicado).
 *
 * Cada caso: o STEP é escrito pelo OCCT (que começa o laço pela borda — exatamente o arquivo que o leitor do
 * OCCT lê errado), depois girado em TODAS as posições iniciais possíveis do laço (simula escritores de outros
 * CADs) e lido pelo caminho do app (OcctSolidKernel.fromStep → normalização → OCCT).
 *
 * TOLERÂNCIAS (justificadas, não ajustadas ao resultado):
 *  - volume e área: 1e-6 relativo. A integração de propriedades do occt-wasm (GProp) tem erro medido de
 *    ~2,8e-7 relativo em sólidos de revolução construídos em memória contra a fórmula fechada (sem STEP), e o
 *    escritor grava 13–15 algarismos significativos; 1e-6 fica ~3,5× acima do piso do motor.
 *  - caixa: 1e-3 mm + 1e-7·tamanho. A caixa do OCCT é a do B-rep (Bnd_Box), alargada pela tolerância das
 *    arestas (1e-7 mm no arquivo) e da aproximação das curvas; 1 µm é 4 ordens abaixo de qualquer medida de
 *    fabricação da AGTN e ainda pega erro de geometria (o defeito encurtava a caixa em 150 mm).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OcctSolidKernel } from "./occt";
import { normalizeRevolutionPoleLoops } from "./step-pole";
import { indexEntities, parseBody } from "./part21";

const VREF = fileURLToPath(new URL("../../../tests/step/viewer_ref/", import.meta.url));
const OUT = fileURLToPath(new URL("../../../tests/output/step/", import.meta.url));
const TOL_REL = 1e-6;
const bboxTol = (size: number) => 1e-3 + 1e-7 * size;

let kk: OcctSolidKernel;
beforeAll(async () => {
  kk = await OcctSolidKernel.create();
});
afterAll(() => kk.dispose());

type V = { x: number; y: number; z: number };
const P = (x: number, y: number, z: number): V => ({ x, y, z });
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-30, Math.abs(b));

/* ---------- referência independente ---------- */
/** Gauss–Legendre composto (20 subintervalos × 16 pontos). */
const GL16: [number, number][] = (() => {
  const x = [0.0950125098376374, 0.2816035507792589, 0.4580167776572274, 0.6178762444026438, 0.755404408355003, 0.8656312023878318, 0.9445750230732326, 0.9894009349916499];
  const w = [0.1894506104550685, 0.1826034150449236, 0.1691565193950025, 0.1495959888165767, 0.1246289712555339, 0.0951585116824928, 0.0622535239386479, 0.0271524594117541];
  return x.flatMap((xi, i) => [[xi, w[i]], [-xi, w[i]]] as [number, number][]);
})();
function integrate(f: (t: number) => number, a: number, b: number, n = 20): number {
  let s = 0;
  const h = (b - a) / n;
  for (let k = 0; k < n; k++) {
    const m = a + (k + 0.5) * h;
    for (const [x, w] of GL16) s += w * f(m + (x * h) / 2);
  }
  return (s * h) / 2;
}
/**
 * Calota de revolução: meridiano elíptico r(t) = R·cos t, x(t) = h·sin t, t ∈ [0, t1] (t1 = π/2 → fecha no polo).
 * Retorna volume do sólido 0 ≤ x ≤ x1 e área da superfície curva.
 */
function capRef(R: number, h: number, t1 = Math.PI / 2) {
  const x1 = h * Math.sin(t1);
  const volume = Math.PI * R * R * (x1 - x1 ** 3 / (3 * h * h));
  const area = integrate((t) => 2 * Math.PI * R * Math.cos(t) * Math.hypot(R * Math.sin(t), h * Math.cos(t)), 0, t1);
  return { volume, area, x1, rEnd: R * Math.cos(t1) };
}

/* ---------- geradores (OCCT só para ESCREVER o arquivo de teste) ---------- */
/** Vaso no eixo +X: costado de comprimento L (pode ser 0) + tampo de semi-eixos R (radial) e h (axial). */
function vessel(R: number, h: number, o: { L?: number; wall?: number; t1?: number } = {}) {
  const k = kk.raw;
  const L = o.L ?? 0;
  const t1 = o.t1 ?? Math.PI / 2;
  const arc = (r: number, hh: number) =>
    r >= hh ? k.makeEllipseArc(P(L, 0, 0), P(0, 1, 0), r, hh, 0, t1, P(0, 0, 1)) : k.makeEllipseArc(P(L, 0, 0), P(0, -1, 0), hh, r, Math.PI / 2 - t1, Math.PI / 2, P(1, 0, 0));
  const e: ReturnType<typeof k.makeLineEdge>[] = [];
  if (o.wall) {
    const Ri = R - o.wall, hi = (Ri * h) / R; // tampo interno com a mesma proporção (como o vessel_revolved)
    if (L > 0) e.push(k.makeLineEdge(P(0, 0, Ri), P(0, 0, R)), k.makeLineEdge(P(0, 0, R), P(L, 0, R)));
    else e.push(k.makeLineEdge(P(L, 0, Ri), P(L, 0, R)));
    e.push(arc(R, h), k.makeLineEdge(P(L + h, 0, 0), P(L + hi, 0, 0)), arc(Ri, hi));
    if (L > 0) e.push(k.makeLineEdge(P(L, 0, Ri), P(0, 0, Ri)));
  } else {
    const c = capRef(R, h, t1);
    if (L > 0) e.push(k.makeLineEdge(P(0, 0, 0), P(0, 0, R)), k.makeLineEdge(P(0, 0, R), P(L, 0, R)));
    else e.push(k.makeLineEdge(P(0, 0, 0), P(0, 0, R)));
    e.push(arc(R, h));
    if (t1 < Math.PI / 2 - 1e-12) e.push(k.makeLineEdge(P(L + c.x1, 0, c.rEnd), P(L + c.x1, 0, 0)));
    e.push(k.makeLineEdge(P(L + c.x1, 0, 0), P(0, 0, 0)));
  }
  return k.revolve(k.makeFace(k.makeWire(e)), { point: P(0, 0, 0), direction: P(1, 0, 0) }, 2 * Math.PI);
}
function vesselRef(R: number, h: number, o: { L?: number; wall?: number; t1?: number } = {}) {
  const L = o.L ?? 0;
  if (o.wall) {
    const Ri = R - o.wall, hi = (Ri * h) / R;
    const co = capRef(R, h), ci = capRef(Ri, hi);
    return {
      volume: Math.PI * (R * R - Ri * Ri) * L + co.volume - ci.volume,
      area: co.area + ci.area + 2 * Math.PI * (R + Ri) * L + Math.PI * (R * R - Ri * Ri),
      len: L + h,
      R,
    };
  }
  const c = capRef(R, h, o.t1);
  return { volume: Math.PI * R * R * L + c.volume, area: c.area + 2 * Math.PI * R * L + Math.PI * R * R + Math.PI * c.rEnd ** 2, len: L + c.x1, R };
}

/** Todas as rotações cíclicas possíveis dos laços com costura nas faces de revolução (escritores diferentes). */
function loopRotations(text: string): string[] {
  const dataAt = text.search(/\bDATA\s*;/);
  const idx = indexEntities(text, dataAt);
  const loops: { s: number; e: number; head: string; refs: string[]; tail: string }[] = [];
  for (const [, r] of idx) {
    const body = text.slice(r[0], r[1]);
    if (!/^\s*EDGE_LOOP/.test(body)) continue;
    const m = /^(.*)\((\s*#\d+(?:\s*,\s*#\d+)*\s*)\)(\s*\)\s*)$/s.exec(body)!;
    const refs = m[2].split(",").map((x) => x.trim());
    const ents = refs.map((x) => parseBody(text.slice(...idx.get(Number(x.slice(1)))!))[0].args[3]);
    const ids = ents.map((a) => (a.t === "ref" ? a.v : -1));
    if (new Set(ids).size === ids.length) continue; // sem costura
    loops.push({ s: r[0], e: r[1], head: m[1], refs, tail: m[3] });
  }
  // combinações: cada laço com costura gira de forma independente (produto cartesiano, limitado)
  let variants: { s: number; e: number; body: string }[][] = [[]];
  for (const L of loops) {
    const next: typeof variants = [];
    for (const v of variants)
      for (let j = 0; j < L.refs.length; j++) next.push([...v, { s: L.s, e: L.e, body: `${L.head}(${[...L.refs.slice(j), ...L.refs.slice(0, j)].join(",")})${L.tail}` }]);
    variants = next.slice(0, 64);
  }
  return variants.map((v) => {
    let out = text;
    for (const ed of [...v].sort((a, b) => b.s - a.s)) out = out.slice(0, ed.s) + ed.body + out.slice(ed.e);
    return out;
  });
}

interface Row {
  caso: string;
  unidade: string;
  volRef: number;
  volAgtn: number;
  difAbs: number;
  difPct: number;
  area: number;
  areaRef: number;
  bbox: number[];
  valido: boolean;
  semCorrecao: { volume: number; valid: boolean };
  desvioMax: number;
  variantes: number;
  laçosNormalizados: number;
}
const rows: Row[] = [];
afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(OUT + "p-f5-01.json", JSON.stringify(rows, null, 1));
});

function readApp(text: string) {
  const ref = kk.fromStep(text);
  try {
    const p = kk.props(ref);
    const rep = kk.lastStepRepair()!;
    return { p, valid: kk.isValid(ref), solids: kk.topology(ref).solids, rep, geo: kk.checkGeometry(ref) };
  } finally {
    kk.release(ref);
  }
}
function readRaw(text: string) {
  const h = kk.raw.importStep(text);
  try {
    return { volume: kk.raw.getVolume(h), valid: kk.raw.isValid(h) };
  } finally {
    kk.raw.release(h);
  }
}

/** Confere UM caso em todas as variantes de laço; registra a linha da tabela. */
function check(caso: string, text: string, ref: { volume: number; area: number; bbox?: number[]; solids?: number }, unidade = "mm") {
  const raw = readRaw(text);
  const variants = loopRotations(text);
  let first: ReturnType<typeof readApp> | null = null;
  for (const v of variants) {
    const r = readApp(v);
    first ??= r;
    expect(r.valid, `${caso}: válido`).toBe(true);
    expect(r.geo.ok, `${caso}: arestas sobre as superfícies (desvio ${r.geo.maxDeviation})`).toBe(true);
    expect(rel(r.p.volume, ref.volume), `${caso}: volume ${r.p.volume} × ${ref.volume}`).toBeLessThan(TOL_REL);
    expect(rel(r.p.area, ref.area), `${caso}: área ${r.p.area} × ${ref.area}`).toBeLessThan(TOL_REL);
    if (ref.solids !== undefined) expect(r.solids).toBe(ref.solids);
    if (ref.bbox) {
      const b = [r.p.bbox.min.x, r.p.bbox.min.y, r.p.bbox.min.z, r.p.bbox.max.x, r.p.bbox.max.y, r.p.bbox.max.z];
      const size = Math.max(...ref.bbox.map(Math.abs));
      for (let i = 0; i < 6; i++) expect(Math.abs(b[i] - ref.bbox[i]), `${caso}: caixa[${i}] ${b[i]} × ${ref.bbox[i]}`).toBeLessThan(bboxTol(size));
    }
  }
  const r = first!;
  rows.push({
    caso,
    unidade,
    volRef: ref.volume,
    volAgtn: r.p.volume,
    difAbs: r.p.volume - ref.volume,
    difPct: ((r.p.volume - ref.volume) / ref.volume) * 100,
    area: r.p.area,
    areaRef: ref.area,
    bbox: [r.p.bbox.min.x, r.p.bbox.min.y, r.p.bbox.min.z, r.p.bbox.max.x, r.p.bbox.max.y, r.p.bbox.max.z],
    valido: r.valid,
    semCorrecao: raw,
    desvioMax: r.geo.maxDeviation,
    variantes: variants.length,
    laçosNormalizados: r.rep.fixes,
  });
  return { raw, r };
}

describe("P-F5-01 — normalização do laço (só a ordem cíclica muda)", () => {
  const src = readFileSync(VREF + "vessel_revolved.step", "latin1");
  it("vessel_revolved: 2 laços girados (#146, #234); todo o resto do arquivo idêntico, mesmas referências", () => {
    const n = normalizeRevolutionPoleLoops(src);
    expect(n.fixes.map((f) => f.loop).sort()).toEqual([146, 234]);
    expect(n.fixes.map((f) => f.face).sort()).toEqual([144, 232]);
    expect(n.poleFaces).toBe(2);
    expect(n.skipped).toEqual([]);
    const a = src.split(/\r?\n/), b = n.text.split(/\r?\n/); // checkout no Windows pode trazer CRLF
    expect(b.length).toBe(a.length);
    const changed = a.map((l, i) => [l, b[i]] as const).filter(([x, y]) => x !== y);
    expect(changed).toEqual([
      ["#146 = EDGE_LOOP('',(#147,#148,#172));", "#146 = EDGE_LOOP('',(#172,#147,#148));"],
      ["#234 = EDGE_LOOP('',(#235,#236,#260));", "#234 = EDGE_LOOP('',(#260,#235,#236));"],
    ]);
  });
  it("idempotente: normalizar de novo não muda nada", () => {
    const n = normalizeRevolutionPoleLoops(src);
    const m = normalizeRevolutionPoleLoops(n.text);
    expect(m.fixes).toEqual([]);
    expect(m.text).toBe(n.text);
  });
  it("arquivos sem face de revolução com polo: texto entregue ao leitor é o MESMO objeto (byte a byte)", () => {
    for (const f of ["box_100x50x20.step", "cylinder_d60_h100.step", "cone_sphere_torus.step", "tank_assembly.step", "virola_d800.step", "loft_bspline.step", "inch_block_2x1x0.5.step"]) {
      const t = readFileSync(VREF + f, "latin1");
      const n = normalizeRevolutionPoleLoops(t);
      expect(n.text, f).toBe(t);
      expect(n.fixes, f).toEqual([]);
    }
  });
  it("entrada malformada não derruba nem altera: devolve o texto como veio", () => {
    for (const t of ["", "ISO-10303-21;\nDATA;\n#1=SURFACE_OF_REVOLUTION(;\nENDSEC;", "lixo SURFACE_OF_REVOLUTION ((((", src.slice(0, 5000)]) {
      const n = normalizeRevolutionPoleLoops(t);
      expect(n.text).toBe(t);
    }
  });
});

describe("P-F5-01 — causa raiz reproduzida e corrigida (arquivo de referência independente)", () => {
  const src = readFileSync(VREF + "vessel_revolved.step", "latin1");
  const REF = JSON.parse(readFileSync(VREF + "reference.json", "latin1"))["vessel_revolved.step"];
  it("SEM a normalização o leitor do OCCT perde as calotas (−28,47 %, inválido) — o defeito continua no motor", () => {
    const raw = readRaw(src);
    expect(raw.valid).toBe(false);
    expect(raw.volume / REF.volume - 1).toBeCloseTo(-0.2847, 3);
  });
  it("COM a normalização: válido, volume/área/caixa/faces = referência do viewer (CadQuery) e fórmula fechada", () => {
    // fórmula fechada do vaso: costado Ø600×900, parede 6, tampo 2:1 (R=300,h=150 / Ri=294,hi=147)
    const ref = vesselRef(300, 150, { L: 900, wall: 6 });
    expect(rel(ref.volume, REF.volume)).toBeLessThan(1e-12);
    expect(rel(ref.area, REF.area)).toBeLessThan(1e-9);
    check("vessel_revolved.step (viewer, CadQuery/OCCT 8)", src, { volume: REF.volume, area: REF.area, bbox: REF.bbox, solids: 1 });
    const r = readApp(src);
    expect(kk.topology(kk.fromStep(src)).faces).toBe(REF.faces);
    expect(r.rep.fixes).toBe(2);
  });
});

describe("P-F5-01 — tampos elípticos: proporções, dimensões, unidades, eixos, sólidos", () => {
  const prop: [string, number, number][] = [
    ["2:1 (ASME/DIN 28013) Ø600", 300, 150],
    ["2:1 Ø3000", 1500, 750],
    ["1,9:1 Ø1200", 600, 600 / 1.9],
    ["3:1 Ø800", 400, 400 / 3],
    ["hemisférico (círculo) Ø500", 250, 250],
    ["prolato h>R Ø300", 150, 300],
    ["achatado 6:1 Ø100", 50, 50 / 6],
  ];
  for (const [nome, R, h] of prop) {
    it(`tampo maciço ${nome}`, () => {
      const s = vessel(R, h);
      const ref = vesselRef(R, h);
      check(`tampo ${nome}`, kk.raw.exportStep(s), { volume: ref.volume, area: ref.area, bbox: [0, -R, -R, h, R, R], solids: 1 });
    });
  }
  it("vaso oco com costado (parede 8, Ø1000×1500, tampo 2:1)", () => {
    const s = vessel(500, 250, { L: 1500, wall: 8 });
    const ref = vesselRef(500, 250, { L: 1500, wall: 8 });
    check("vaso oco Ø1000×1500 e8", kk.raw.exportStep(s), { volume: ref.volume, area: ref.area, bbox: [0, -500, -500, 1750, 500, 500], solids: 1 });
  });
  it("calota truncada (sem polo, limites paramétricos t ∈ [0, 70°]) — não é tocada e continua exata", () => {
    const t1 = (70 * Math.PI) / 180;
    const s = vessel(300, 150, { t1 });
    const ref = vesselRef(300, 150, { t1 });
    const txt = kk.raw.exportStep(s);
    expect(normalizeRevolutionPoleLoops(txt).fixes).toEqual([]);
    const { raw } = check("calota truncada 70°", txt, { volume: ref.volume, area: ref.area, bbox: [0, -300, -300, ref.len, 300, 300], solids: 1 });
    expect(raw.valid).toBe(true); // o leitor já lia certo: o caso não é afetado
  });
  for (const [u, f] of [["inch", 25.4], ["cm", 10], ["m", 1000]] as const) {
    it(`unidade do arquivo em ${u} (geometria convertida para mm)`, () => {
      const s = vessel(300, 150, { L: 400 });
      const ref = vesselRef(300, 150, { L: 400 });
      const txt = kk.raw.exportStep(s, { unit: u });
      expect(txt).toMatch(u === "inch" ? /INCH/ : u === "cm" ? /\.CENTI\./ : /SI_UNIT\(\$,\.METRE\.\)/);
      check(`vaso Ø600×400 em ${u} (1 ${u} = ${f} mm)`, txt, { volume: ref.volume, area: ref.area, bbox: [0, -300, -300, 550, 300, 300], solids: 1 }, u);
    });
  }
  const rot: [string, number[], (b: number[]) => number[]][] = [
    ["eixo +Y", [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0], (b) => [b[1], b[0], b[2], b[4], b[3], b[5]]],
    ["eixo −Z", [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0], (b) => [b[1], b[2], -b[3], b[4], b[5], -b[0]]],
  ];
  for (const [nome, m, bb] of rot) {
    it(`orientação ${nome}`, () => {
      const s = kk.raw.transform(vessel(300, 150, { L: 200 }), m);
      const ref = vesselRef(300, 150, { L: 200 });
      check(`vaso Ø600×200 ${nome}`, kk.raw.exportStep(s), { volume: ref.volume, area: ref.area, bbox: bb([0, -300, -300, 350, 300, 300]), solids: 1 });
    });
  }
  it("orientação oblíqua (eixo (1,1,1)/√3, deslocado) — volume e área invariantes", () => {
    const c = 1 / Math.sqrt(3), a = Math.acos(c), ax = [0, -1, 1].map((v) => v / Math.SQRT2);
    // rotação de Rodrigues que leva +X em (1,1,1)/√3
    const [x, y, z] = ax, C = Math.cos(a), S = Math.sin(a), t = 1 - C;
    const m = [t * x * x + C, t * x * y - S * z, t * x * z + S * y, 120, t * x * y + S * z, t * y * y + C, t * y * z - S * x, -80, t * x * z - S * y, t * y * z + S * x, t * z * z + C, 35];
    const s = kk.raw.transform(vessel(300, 150, { L: 200 }), m);
    const ref = vesselRef(300, 150, { L: 200 });
    check("vaso Ø600×200 eixo oblíquo", kk.raw.exportStep(s), { volume: ref.volume, area: ref.area, solids: 1 });
  });
  it("vários sólidos no mesmo arquivo (2 tampos diferentes + 1 vaso oco)", () => {
    const k = kk.raw;
    const a = vessel(300, 150);
    const b = k.translate(vessel(200, 100, { L: 300 }), 0, 1000, 0);
    const c = k.translate(vessel(400, 200, { L: 600, wall: 6 }), 0, 0, 1500);
    const ra = vesselRef(300, 150), rb = vesselRef(200, 100, { L: 300 }), rc = vesselRef(400, 200, { L: 600, wall: 6 });
    const comp = k.makeCompound([a, b, c]);
    // piso do motor para compostos, SEM passar por STEP (prova de que a diferença não vem da leitura)
    const floor = rel(k.getVolume(comp), ra.volume + rb.volume + rc.volume);
    const { r } = check("3 sólidos num arquivo", k.exportStep(comp), { volume: ra.volume + rb.volume + rc.volume, area: ra.area + rb.area + rc.area, solids: 3 });
    expect(Math.abs(r.p.volume - k.getVolume(comp)) / k.getVolume(comp)).toBeLessThan(1e-9);
    expect(floor).toBeGreaterThan(5e-7); // o erro é do integrador do motor no composto, igual com ou sem STEP
  });
  it("tampo com bocal (furo fora do eixo: face com laço interno + polo) — referência: B-rep construído, sem STEP", () => {
    const k = kk.raw;
    const v = vessel(300, 150, { L: 300 });
    const tool = k.translate(k.transform(k.makeCylinder(40, 400), [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0]), 200, 150, 0);
    const s = k.cut(v, tool);
    const txt = k.exportStep(s);
    // o OCCT já grava este laço começando no polo; as variantes giradas cobrem os outros começos
    expect(normalizeRevolutionPoleLoops(txt).poleFaces).toBe(1);
    check("vaso Ø600×300 com bocal Ø80 no tampo (ref. construída)", txt, { volume: k.getVolume(s), area: k.getSurfaceArea(s), solids: 1 });
  });
});

describe("P-F5-01 — proteção: o que não é confiável continua sinalizado", () => {
  it("meridiano polo-a-polo (elipsoide inteiro): OCCT grava VERTEX_LOOP — nada a normalizar; leitura exata", () => {
    const k = kk.raw;
    const arc = k.makeEllipseArc(P(0, 0, 0), P(0, 1, 0), 300, 150, -Math.PI / 2, Math.PI / 2, P(0, 0, 1));
    const s = k.revolve(k.makeFace(k.makeWire([arc, k.makeLineEdge(P(150, 0, 0), P(-150, 0, 0))])), { point: P(0, 0, 0), direction: P(1, 0, 0) }, 2 * Math.PI);
    const txt = k.exportStep(s);
    expect(txt).toMatch(/VERTEX_LOOP/);
    expect(normalizeRevolutionPoleLoops(txt).fixes).toEqual([]);
    const ref = 2 * capRef(300, 150).volume, area = 2 * capRef(300, 150).area;
    check("elipsoide 600×300 (VERTEX_LOOP)", txt, { volume: ref, area, bbox: [-150, -300, -300, 150, 300, 300], solids: 1 });
  });
  it("VERTEX_LOOP: superfície original intacta, face aponta para cópia com meia cônica (TRIMMED_CURVE −π/2…π/2)", () => {
    const k = kk.raw;
    const arc = k.makeEllipseArc(P(0, 0, 0), P(0, 1, 0), 300, 150, -Math.PI / 2, Math.PI / 2, P(0, 0, 1));
    const txt = k.exportStep(k.revolve(k.makeFace(k.makeWire([arc, k.makeLineEdge(P(150, 0, 0), P(-150, 0, 0))])), { point: P(0, 0, 0), direction: P(1, 0, 0) }, 2 * Math.PI));
    const n = normalizeRevolutionPoleLoops(txt);
    expect(n.halfConics).toHaveLength(1);
    const h = n.halfConics[0];
    expect(h.t0).toBeCloseTo(-Math.PI / 2, 14);
    expect(h.t1 - h.t0).toBeCloseTo(Math.PI, 14);
    // todas as linhas originais continuam lá, só a face mudou de superfície; 2 entidades novas no fim do DATA
    const a = txt.split(/\r?\n/), b = n.text.split(/\r?\n/);
    expect(a.filter((l) => !b.includes(l))).toEqual([a.find((l) => l.startsWith(`#${h.face} =`))]);
    expect(n.text).toMatch(new RegExp(`#${h.trimmed}=TRIMMED_CURVE\\('',#\\d+,\\(PARAMETER_VALUE\\(-1\\.5707963267948966\\)\\),\\(PARAMETER_VALUE\\(1\\.5707963267948966\\)\\),\\.T\\.,\\.PARAMETER\\.\\);`));
    // SEM a correção: o motor aprova a forma, mas o volume é ~0 — a verificação reprova (volumeOk)
    const raw = kk.raw.importStep(txt);
    const g = kk.checkGeometry(raw as never);
    expect(g.shapeValid).toBe(true);
    expect(g.volumeOk).toBe(false);
    expect(g.ok).toBe(false);
    kk.release(raw as never);
  });
  it("esfera por revolução de CIRCLE com VERTEX_LOOP (arquivo montado à mão, não pelo escritor do OCCT) Ø600 — exata", () => {
    const k = kk.raw;
    const arc = k.makeEllipseArc(P(0, 0, 0), P(0, 1, 0), 300, 150, -Math.PI / 2, Math.PI / 2, P(0, 0, 1));
    const base = k.exportStep(k.revolve(k.makeFace(k.makeWire([arc, k.makeLineEdge(P(150, 0, 0), P(-150, 0, 0))])), { point: P(0, 0, 0), direction: P(1, 0, 0) }, 2 * Math.PI));
    // geratriz trocada por círculo R=300 centrado no eixo; vértice do VERTEX_LOOP no polo (300,0,0)
    const txt = base.replace(/ELLIPSE\('',(#\d+),300\.,150\.\)/, "CIRCLE('',$1,300.)").replace(/CARTESIAN_POINT\('',\(150\.,0\.,[^)]*\)\)/, "CARTESIAN_POINT('',(300.,0.,0.))");
    expect(txt).toMatch(/CIRCLE\('',#\d+,300\.\)/);
    // o leitor do OCCT já trata CIRCLE (só a ELLIPSE se anula); com o recorte o resultado continua exato
    expect(rel(readRaw(txt).volume, (4 / 3) * Math.PI * 300 ** 3)).toBeLessThan(TOL_REL);
    check("esfera Ø600 por revolução de CIRCLE (VERTEX_LOOP, à mão)", txt, { volume: (4 / 3) * Math.PI * 300 ** 3, area: 4 * Math.PI * 300 ** 2, bbox: [-300, -300, -300, 300, 300, 300], solids: 1 });
  });
  it("arquivo com ângulo plano em GRAUS: recorte não é aplicado (registrado) e a proteção reprova o resultado", () => {
    const k = kk.raw;
    const arc = k.makeEllipseArc(P(0, 0, 0), P(0, 1, 0), 300, 150, -Math.PI / 2, Math.PI / 2, P(0, 0, 1));
    const txt = k
      .exportStep(k.revolve(k.makeFace(k.makeWire([arc, k.makeLineEdge(P(150, 0, 0), P(-150, 0, 0))])), { point: P(0, 0, 0), direction: P(1, 0, 0) }, 2 * Math.PI))
      .replace(/\( NAMED_UNIT\(\*\) PLANE_ANGLE_UNIT\(\) SI_UNIT\(\$,\.RADIAN\.\) \)/, "( CONVERSION_BASED_UNIT('DEGREE',#9990) NAMED_UNIT(#9991) PLANE_ANGLE_UNIT() )");
    expect(txt).toMatch(/DEGREE/);
    const n = normalizeRevolutionPoleLoops(txt);
    expect(n.halfConics).toEqual([]);
    expect(n.skipped.join(" ")).toMatch(/não é radiano/);
    let ok = true;
    try {
      const ref = kk.fromStep(txt);
      ok = kk.checkGeometry(ref).ok;
      kk.release(ref);
    } catch {
      ok = false;
    }
    expect(ok).toBe(false);
  });
  it("laço sintético com costura tocando o eixo nas DUAS pontas: não é mexido e fica registrado", () => {
    const t = [
      "ISO-10303-21;", "HEADER;", "ENDSEC;", "DATA;",
      "#1=ADVANCED_FACE('',(#2),#10,.T.);", "#2=FACE_OUTER_BOUND('',#3,.T.);", "#3=EDGE_LOOP('',(#4,#5,#6));",
      "#4=ORIENTED_EDGE('',*,*,#20,.T.);", "#5=ORIENTED_EDGE('',*,*,#21,.T.);", "#6=ORIENTED_EDGE('',*,*,#20,.F.);",
      "#10=SURFACE_OF_REVOLUTION('',#11,#12);", "#11=LINE('',#13,#14);", "#12=AXIS1_PLACEMENT('',#13,#15);",
      "#13=CARTESIAN_POINT('',(0.,0.,0.));", "#14=VECTOR('',#15,1.);", "#15=DIRECTION('',(1.,0.,0.));",
      "#20=EDGE_CURVE('',#30,#31,#11,.T.);", "#21=EDGE_CURVE('',#31,#31,#11,.T.);",
      "#30=VERTEX_POINT('',#13);", "#31=VERTEX_POINT('',#32);", "#32=CARTESIAN_POINT('',(5.,0.,0.));",
      "ENDSEC;", "END-ISO-10303-21;",
    ].join("\n");
    const n = normalizeRevolutionPoleLoops(t);
    expect(n.fixes).toEqual([]);
    expect(n.text).toBe(t);
    expect(n.skipped.join(" ")).toMatch(/polo nas duas pontas/);
  });
  it("geometria deliberadamente inconsistente (semi-eixo da superfície ≠ das arestas): o BRepCheck APROVA, a verificação de arestas reprova e aponta a face", () => {
    const src = readFileSync(VREF + "vessel_revolved.step", "latin1");
    const bad = src.replace("#94 = ELLIPSE('',#95,300.,150.);", "#94 = ELLIPSE('',#95,300.,90.);");
    expect(bad).not.toBe(src);
    const r = readApp(bad);
    expect(r.valid).toBe(true); // limitação do verificador de forma do OCCT: não compara aresta com superfície
    expect(r.p.volume / 11739729.6226 - 1).toBeLessThan(-0.9); // e o volume sai absurdo
    expect(r.geo.ok).toBe(false);
    expect(r.geo.maxDeviation).toBeGreaterThan(50);
    expect(r.geo.faces).toHaveLength(1);
    expect(r.geo.faces[0]).toMatchObject({ surface: "revolution", reason: "fora_da_superficie" });
  });
  it("sem a normalização (defeito do motor exposto): a face colapsada é apontada como inválida", () => {
    const src = readFileSync(VREF + "vessel_revolved.step", "latin1");
    const h = kk.raw.importStep(src);
    const ref = h as unknown as Parameters<typeof kk.checkGeometry>[0];
    const g = kk.checkGeometry(ref);
    expect(g.ok).toBe(false);
    expect(g.shapeValid).toBe(false);
    expect(g.faces.map((f) => f.surface)).toContain("revolution");
    expect(g.faces.find((f) => f.surface === "revolution")!.area).toBe(0);
    kk.release(ref);
  });
  it("arquivo truncado no meio de um tampo: leitura falha ou sai inválida — nunca válida", () => {
    const src = readFileSync(VREF + "vessel_revolved.step", "latin1");
    const cut = src.slice(0, src.indexOf("#232 ="));
    let valid = false;
    try {
      valid = readApp(cut).valid;
    } catch {
      valid = false;
    }
    expect(valid).toBe(false);
  });
});

describe("P-F5-01 — custo", () => {
  it("200 vasos (400 faces com polo, ~2,4 MB): normalização e verificação em tempo de leitura aceitável", () => {
    const src = readFileSync(VREF + "vessel_revolved.step", "latin1");
    const head = src.slice(0, src.indexOf("DATA;") + 5);
    const data = src.slice(src.indexOf("DATA;") + 5, src.lastIndexOf("ENDSEC;"));
    const parts: string[] = [];
    for (let i = 0; i < 200; i++) parts.push(data.replace(/#(\d+)/g, (_m, n) => `#${Number(n) + i * 1000}`));
    // um único produto basta para o leitor: os demais blocos viram representações soltas — aqui medimos o texto
    const big = `${head}${parts.join("")}ENDSEC;\nEND-ISO-10303-21;\n`;
    let t = performance.now();
    const n = normalizeRevolutionPoleLoops(big);
    const tNorm = performance.now() - t;
    expect(n.fixes).toHaveLength(400);
    const box = readFileSync(VREF + "box_100x50x20.step", "latin1");
    t = performance.now();
    for (let i = 0; i < 50; i++) normalizeRevolutionPoleLoops(box);
    const tNoRev = (performance.now() - t) / 50;
    const ref = kk.fromStep(src);
    t = performance.now();
    const g = kk.checkGeometry(ref);
    const tCheck = performance.now() - t;
    kk.release(ref);
    expect(g.ok).toBe(true);
    console.log(`PERF P-F5-01 normalizar ${(big.length / 1048576).toFixed(1)} MB/400 laços: ${tNorm.toFixed(0)} ms · arquivo sem revolução: ${tNoRev.toFixed(3)} ms · verificar 1 vaso (${g.points} pontos): ${tCheck.toFixed(1)} ms`);
    expect(tNorm).toBeLessThan(5000);
  });
});
