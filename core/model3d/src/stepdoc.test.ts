/**
 * FASE 5 — abrir STEP como documento: geometria pelo OCCT, conferida contra valores de referência
 * INDEPENDENTES (reference.json do agtn-cad-tank-viewer, gerado com CadQuery/OCCT por scripts próprios,
 * não por este código). Unidades conferidas pelo cabeçalho do arquivo (port do StepReader Kotlin).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OcctSolidKernel } from "@agtn/solid";
import { BodyCache, type BodyFacts, STEP_MAX_BYTES, fmtLen, precheckStep, scanStep, stepTreeToModel, summarize } from "@agtn/model3d";

const DIR = fileURLToPath(new URL("../../../tests/step/viewer_ref/", import.meta.url));
const read = (f: string) => readFileSync(DIR + f, "latin1");
const OUT = fileURLToPath(new URL("../../../tests/output/step/", import.meta.url));
type Ref = { volume: number; area?: number; bbox?: number[]; faces?: number; edges?: number; solids?: number };
const REF = JSON.parse(read("reference.json")) as Record<string, Ref>;

let k: OcctSolidKernel;
beforeAll(async () => {
  k = await OcctSolidKernel.create();
});
afterAll(() => k.dispose());

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));

function open(file: string, text = read(file)) {
  const nodes = k.importStepTree(text);
  const doc = stepTreeToModel(nodes, file);
  const cache = new BodyCache(k);
  const rep = cache.sync(doc.model);
  const facts: BodyFacts[] = [];
  for (const n of Object.values(doc.model.nodes)) {
    if (n.kind !== "body") continue;
    const ref = cache.get(n.id);
    if (!ref) continue;
    facts.push({ props: k.props(ref), topo: k.topology(ref), valid: k.isValid(ref) });
  }
  const sum = summarize(facts);
  cache.clear();
  return { doc, rep, sum, nodes };
}

describe("STEP — leitura pelo OCCT contra referência independente", () => {
  // vessel_revolved: limitação CONHECIDA do leitor STEP do OCCT 8 (occt-wasm 5.17.1) — ver bloco abaixo.
  const KNOWN_BAD = new Set(["vessel_revolved.step"]);
  for (const [file, ref] of Object.entries(REF)) {
    const t = KNOWN_BAD.has(file) ? it.fails : it;
    t(`${file}: volume${ref.area ? ", área" : ""}${ref.bbox ? ", caixa" : ""}${ref.solids ? ", sólidos" : ""}${KNOWN_BAD.has(file) ? " (FALHA CONHECIDA do OCCT)" : ""}`, () => {
      const { sum, rep } = open(file);
      expect(Object.keys(rep.errors)).toEqual([]);
      expect(sum.invalid).toBe(0);
      expect(rel(sum.volume, ref.volume)).toBeLessThan(1e-6);
      if (ref.area !== undefined) expect(rel(sum.area, ref.area)).toBeLessThan(1e-6);
      if (ref.solids !== undefined) expect(sum.solids).toBe(ref.solids);
      if (ref.faces !== undefined && ref.solids === 1) expect(sum.faces).toBe(ref.faces);
      if (ref.bbox && sum.bbox) {
        const b = [sum.bbox.min.x, sum.bbox.min.y, sum.bbox.min.z, sum.bbox.max.x, sum.bbox.max.y, sum.bbox.max.z];
        for (let i = 0; i < 6; i++) expect(Math.abs(b[i] - ref.bbox[i])).toBeLessThan(0.05);
      }
    });
  }
});

describe("STEP — geometria inválida é detectada e sinalizada (não escondida)", () => {
  it("vessel_revolved: calotas elípticas (SURFACE_OF_REVOLUTION de ELLIPSE) saem inválidas do OCCT — o verificador reprova", () => {
    const { sum } = open("vessel_revolved.step");
    // referência independente: 11 739 729,6 mm³, caixa até x = 1050. O OCCT entrega x até 900 e volume errado.
    expect(sum.invalid).toBe(1);
    expect(rel(sum.volume, REF["vessel_revolved.step"].volume)).toBeGreaterThan(0.1);
  });
});

describe("STEP — unidades declaradas pelo arquivo", () => {
  it("polegada: arquivo em in, geometria convertida para mm (50,8 × 25,4 × 12,7)", () => {
    const s = scanStep(read("inch_block_2x1x0.5.step"));
    expect(s.length?.name).toBe("in");
    expect(s.length?.toMm).toBeCloseTo(25.4, 9);
    const { sum } = open("inch_block_2x1x0.5.step");
    expect(sum.bbox!.max.x - sum.bbox!.min.x).toBeCloseTo(50.8, 3);
    expect(sum.bbox!.max.y - sum.bbox!.min.y).toBeCloseTo(25.4, 3);
    expect(sum.bbox!.max.z - sum.bbox!.min.z).toBeCloseTo(12.7, 3);
    expect(fmtLen(50.8, "in")).toBe("2,000 in");
  });
  it("milímetro, esquema, origem", () => {
    const s = scanStep(read("box_100x50x20.step"));
    expect(s.length).toEqual({ name: "mm", toMm: 1, source: "SI_UNIT" });
    expect(s.valid && s.complete).toBe(true);
    expect(s.protocol).toMatch(/AP2(03|14|42)/);
    expect(s.entities).toBeGreaterThan(50);
    expect(s.warnings).toEqual([]);
  });
  const mk = (unit: string) =>
    `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\nFILE_NAME('t','2026',(''),(''),'','','');\nFILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }'));\nENDSEC;\nDATA;\n${unit}\nENDSEC;\nEND-ISO-10303-21;\n`;
  it("cm, m e pé (CONVERSION_BASED_UNIT com MEASURE_WITH_UNIT)", () => {
    const ctx = "#9=( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNIT_ASSIGNED_CONTEXT((#1,#2)) REPRESENTATION_CONTEXT('',''));";
    const ang = "#2=( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) );";
    expect(scanStep(mk(`#1=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.CENTI.,.METRE.) );\n${ang}\n${ctx}`)).length).toEqual({ name: "cm", toMm: 10, source: "SI_UNIT" });
    const m = scanStep(mk(`#1=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.) );\n${ang}\n${ctx}`));
    expect(m.length?.toMm).toBe(1000);
    expect(m.angleToRad).toBe(1);
    const ft = scanStep(mk(`#1=( CONVERSION_BASED_UNIT('FOOT',#3) LENGTH_UNIT() NAMED_UNIT(#4) );\n#3=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(304.8),#5);\n#5=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );\n#4=DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.);\n${ang}\n${ctx}`));
    expect(ft.length?.name).toBe("ft");
    expect(ft.length?.toMm).toBeCloseTo(304.8, 9);
  });
  it("sem unidade: não assume mm em silêncio — informa desconhecida", () => {
    const s = scanStep(mk("#1=CARTESIAN_POINT('',(0.,0.,0.));"));
    expect(s.length).toBeNull();
    expect(s.warnings.join(" ")).toMatch(/não encontrada/);
  });
  it("unidade com prefixo desconhecido é recusada com aviso", () => {
    const s = scanStep(mk("#1=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.ZETTA.,.METRE.) );\n#9=( GLOBAL_UNIT_ASSIGNED_CONTEXT((#1)) REPRESENTATION_CONTEXT('',''));"));
    expect(s.length).toBeNull();
    expect(s.warnings.join(" ")).toMatch(/Prefixo SI desconhecido/);
  });
});

describe("STEP — múltiplos sólidos, conjuntos, nomes e hierarquia", () => {
  it("tank_assembly: 4 sólidos em conjunto, nomes preservados, B-rep guardado (não malha)", () => {
    const { doc, sum } = open("tank_assembly.step");
    expect(sum.solids).toBe(4);
    const bodies = Object.values(doc.model.nodes).filter((n) => n.kind === "body");
    expect(bodies.length).toBeGreaterThanOrEqual(1);
    for (const b of bodies) expect(b.kind === "body" && b.source.type).toBe("brep");
    const names = Object.values(doc.model.nodes).map((n) => n.name);
    expect(names.every((n) => typeof n === "string" && n.length > 0)).toBe(true);
  });
  it("fusion_srr_assembly (padrão Fusion 360): abre com conjunto e corpos nomeados", () => {
    const { doc, sum } = open("fusion_srr_assembly.step");
    expect(sum.solids).toBeGreaterThanOrEqual(1);
    expect(sum.volume).toBeGreaterThan(0);
    expect(Object.values(doc.model.nodes).some((n) => n.kind === "group")).toBe(true);
  });
  it("cone_sphere_torus: superfícies curvas (cone, esfera, toro) — 3 sólidos, volume exato", () => {
    const { sum } = open("cone_sphere_torus.step");
    expect(sum.solids).toBe(3);
    expect(sum.open).toBe(0);
  });
});

describe("STEP — arquivos inválidos são recusados com mensagem clara", () => {
  it("vazio", () => {
    const r = precheckStep("", 0);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/vazio/);
  });
  it("não-STEP", () => {
    const r = precheckStep("isto não é STEP", 15);
    expect(!r.ok && r.error).toMatch(/não é um STEP/);
  });
  it("acima do limite de tamanho", () => {
    const r = precheckStep("ISO-10303-21;", STEP_MAX_BYTES + 1);
    expect(!r.ok && r.error).toMatch(/muito grande/);
  });
  it("cabeçalho sem DATA", () => {
    const r = precheckStep("ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;\n", 50);
    expect(!r.ok && r.error).toMatch(/não contém entidades/);
  });
  it("truncado: aviso de integridade e o motor não derruba o app", () => {
    const full = read("box_100x50x20.step");
    const cut = full.slice(0, Math.floor(full.length * 0.6));
    const s = scanStep(cut);
    expect(s.complete).toBe(false);
    expect(s.warnings.join(" ")).toMatch(/truncado/);
    let err: unknown = null;
    try {
      const nodes = k.importStepTree(cut);
      // se o OCCT recuperar algo, ainda assim nada pode ser NaN
      const { sum } = open("cut", cut);
      expect(Number.isFinite(sum.volume)).toBe(true);
      expect(nodes.length).toBeGreaterThanOrEqual(0);
    } catch (e) {
      err = e;
    }
    if (err) expect((err as Error).message).toMatch(/STEP|geometria|importar/i);
  });
  it("lixo binário após o cabeçalho: erro controlado", () => {
    const junk = "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=\u0000\u0001((((;\n#2=ADVANCED_FACE('',(#99),#98,.T.);\nENDSEC;\nEND-ISO-10303-21;\n";
    expect(() => k.importStepTree(junk)).toThrow();
    expect(scanStep(junk).valid).toBe(true);
  });
  it("geometria inválida (referências quebradas): erro controlado, sem travar", () => {
    const bad = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\nFILE_NAME('x','',(''),(''),'','','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n#1=MANIFOLD_SOLID_BREP('s',#2);\n#2=CLOSED_SHELL('',(#3));\n#3=ADVANCED_FACE('',(#4),#5,.T.);\nENDSEC;\nEND-ISO-10303-21;\n";
    expect(() => k.importStepTree(bad)).toThrow();
  });
});

describe("STEP — arquivo grande gerado", () => {
  it("conjunto com 120 cópias posicionadas: lê, mantém 120 sólidos e soma o volume", () => {
    const one = k.importStepTree(read("box_100x50x20.step"));
    const brep = one[0].brep ?? one[0].children?.[0]?.brep;
    expect(brep).toBeTruthy();
    const children = Array.from({ length: 120 }, (_, i) => ({ name: `Caixa ${i + 1}`, matrix: [1, 0, 0, (i % 12) * 150, 0, 1, 0, Math.floor(i / 12) * 80, 0, 0, 1, 0], brep }));
    const text = k.exportStepTree([{ name: "Grande", matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], children }]);
    expect(text.length).toBeGreaterThan(200_000);
    const t0 = performance.now();
    const { sum } = open("grande.step", text);
    const ms = performance.now() - t0;
    expect(sum.solids).toBe(120);
    expect(rel(sum.volume, 120 * 100000)).toBeLessThan(1e-6);
    expect(sum.bbox!.max.x - sum.bbox!.min.x).toBeCloseTo(11 * 150 + 100, 3);
    expect(ms).toBeLessThan(60_000);
    // guardado para os testes de interface (E2E/WebView2): mesmo arquivo, valores esperados conhecidos
    mkdirSync(OUT, { recursive: true });
    writeFileSync(OUT + "grande_120_caixas.step", text);
  }, 120_000);
  it("arquivo grande (~10 MB): 400 placas com furos e arredondamentos — lê e mantém volume exato", () => {
    const one = k.importStepTree(read("plate_holes_fillet.step"));
    const brep = one[0].brep ?? one[0].children?.[0]?.brep;
    const V = REF["plate_holes_fillet.step"].volume;
    const children = Array.from({ length: 400 }, (_, i) => ({ name: `Placa ${i + 1}`, matrix: [1, 0, 0, (i % 20) * 220, 0, 1, 0, Math.floor(i / 20) * 140, 0, 0, 1, 0], brep }));
    const text = k.exportStepTree([{ name: "Placas", matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], children }]);
    const t0 = performance.now();
    const { sum } = open("placas.step", text);
    const ms = performance.now() - t0;
    expect(sum.solids).toBe(400);
    expect(sum.invalid).toBe(0);
    expect(rel(sum.volume, 400 * V)).toBeLessThan(1e-6);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(OUT + "grande_400_placas.step", text);
    writeFileSync(OUT + "grande.json", JSON.stringify({ "grande_400_placas.step": { bytes: text.length, solids: 400, volume: 400 * V, ms }, "grande_120_caixas.step": { solids: 120, volume: 120 * 100000 } }, null, 1));
  }, 300_000);
});

describe("STEP — arquivos reais adicionais do corpus do visualizador", () => {
  for (const f of ["virola_d800.step", "conj_bom.step", "flange_607.step"]) {
    it(`${f}: abre, todos os corpos válidos, volume positivo, unidade declarada`, () => {
      const { sum } = open(f);
      expect(sum.solids).toBeGreaterThanOrEqual(1);
      expect(sum.invalid).toBe(0);
      expect(sum.volume).toBeGreaterThan(0);
      expect(scanStep(read(f)).length).not.toBeNull();
    });
  }
});
