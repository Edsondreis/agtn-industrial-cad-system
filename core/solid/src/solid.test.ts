import {
  IDENTITY,
  OcctSolidKernel,
  type PrimitiveSpec,
  SolidError,
  type SolidRef,
  applyPlacement,
  describePrimitive,
  placementMatrix,
  sectionArea,
  validatePrimitive,
} from "@agtn/solid";

const PI = Math.PI;
let k: OcctSolidKernel;
const refs: SolidRef[] = [];
const keep = (r: SolidRef) => (refs.push(r), r);

beforeAll(async () => {
  k = await OcctSolidKernel.create();
});
afterAll(() => {
  for (const r of refs) k.release(r);
  k.dispose();
});

/** Erro relativo — volumes de geometria analítica devem bater quase na precisão de máquina. */
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));

describe("validação de primitivas", () => {
  it("aceita especificações válidas", () => {
    expect(validatePrimitive({ kind: "box", w: 1, d: 2, h: 3 })).toEqual([]);
    expect(validatePrimitive({ kind: "profile", length: 1000, profile: { shape: "U", h: 100, b: 50, tw: 6, tf: 8 } })).toEqual([]);
  });
  it("recusa medidas nulas, negativas e incoerentes com mensagem em pt-BR", () => {
    expect(validatePrimitive({ kind: "box", w: 0, d: 2, h: 3 })[0]).toMatch(/maior que zero/);
    expect(validatePrimitive({ kind: "cylinder", r: -1, h: 3 })[0]).toMatch(/Raio/);
    expect(validatePrimitive({ kind: "torus", R: 10, r: 10 })).toContain("O raio menor deve ser menor que o raio maior.");
    expect(validatePrimitive({ kind: "tube", od: 20, t: 10, h: 5 })[0]).toMatch(/parede/i);
    expect(validatePrimitive({ kind: "cone", r1: 5, r2: 5, h: 5 })[0]).toMatch(/cilindro/);
    expect(validatePrimitive({ kind: "box", w: Number.NaN, d: 1, h: 1 })[0]).toMatch(/inválido/);
    expect(validatePrimitive({ kind: "profile", length: 10, profile: { shape: "RHS", b: 20, h: 40, t: 10 } })[0]).toMatch(/Parede/);
  });
  it("o kernel não cria primitiva inválida", () => {
    expect(() => k.primitive({ kind: "sphere", r: 0 })).toThrow(SolidError);
    try {
      k.primitive({ kind: "sphere", r: 0 });
    } catch (e) {
      expect((e as SolidError).code).toBe("INVALID_PARAMS");
    }
  });
});

describe("primitivas — volume e área exatos", () => {
  const cases: { spec: PrimitiveSpec; volume: number; area?: number }[] = [
    { spec: { kind: "box", w: 500, d: 300, h: 10 }, volume: 500 * 300 * 10, area: 2 * (500 * 300 + 500 * 10 + 300 * 10) },
    { spec: { kind: "cylinder", r: 25, h: 100 }, volume: PI * 625 * 100, area: 2 * PI * 625 + 2 * PI * 25 * 100 },
    { spec: { kind: "sphere", r: 50 }, volume: (4 / 3) * PI * 50 ** 3, area: 4 * PI * 2500 },
    { spec: { kind: "cone", r1: 30, r2: 10, h: 60 }, volume: (PI * 60 * (900 + 300 + 100)) / 3 },
    { spec: { kind: "cone", r1: 30, r2: 0, h: 60 }, volume: (PI * 900 * 60) / 3 },
    { spec: { kind: "torus", R: 100, r: 10 }, volume: 2 * PI * PI * 100 * 100, area: 4 * PI * PI * 100 * 10 },
    { spec: { kind: "tube", od: 114.3, t: 6.02, h: 1000 }, volume: PI * ((114.3 / 2) ** 2 - (114.3 / 2 - 6.02) ** 2) * 1000 },
  ];
  for (const c of cases) {
    it(describePrimitive(c.spec), () => {
      const s = keep(k.primitive(c.spec));
      expect(k.isValid(s)).toBe(true);
      expect(k.kind(s)).toBe("solid");
      const p = k.props(s);
      expect(rel(p.volume, c.volume)).toBeLessThan(1e-9);
      if (c.area !== undefined) expect(rel(p.area, c.area)).toBeLessThan(1e-9);
    });
  }

  it("plano é superfície: área sem volume", () => {
    const s = keep(k.primitive({ kind: "plane", w: 200, d: 100 }));
    expect(k.kind(s)).toBe("face");
    const p = k.props(s);
    expect(p.volume).toBe(0);
    expect(rel(p.area, 20000)).toBeLessThan(1e-12);
  });
});

describe("perfis estruturais", () => {
  const profiles: PrimitiveSpec[] = [
    { kind: "profile", length: 1500, profile: { shape: "L", a: 50, b: 50, t: 6.35 } },
    { kind: "profile", length: 1500, profile: { shape: "U", h: 100, b: 50, tw: 6, tf: 8 } },
    { kind: "profile", length: 2000, profile: { shape: "I", h: 200, b: 100, tw: 5.6, tf: 8.5 } },
    { kind: "profile", length: 6000, profile: { shape: "RHS", b: 50, h: 100, t: 3 } },
    { kind: "profile", length: 300, profile: { shape: "FLAT", b: 76.2, t: 9.52 } },
  ];
  for (const spec of profiles) {
    it(describePrimitive(spec), () => {
      if (spec.kind !== "profile") throw new Error();
      const s = keep(k.primitive(spec));
      expect(k.isValid(s)).toBe(true);
      const p = k.props(s);
      expect(rel(p.volume, sectionArea(spec.profile) * spec.length)).toBeLessThan(1e-9);
      expect(p.bbox.min.z).toBeCloseTo(0, 9);
      expect(p.bbox.max.z).toBeCloseTo(spec.length, 9);
    });
  }
  it("área de seção do U 100×50×6×8 confere com cálculo manual", () => {
    // 2 abas 50×8 + alma 6×(100−16)
    expect(sectionArea({ shape: "U", h: 100, b: 50, tw: 6, tf: 8 })).toBeCloseTo(2 * 50 * 8 + 6 * 84, 12);
  });
  it("tubo retangular: 1 sólido, 10 faces (4 externas, 4 internas, 2 tampas)", () => {
    const s = keep(k.primitive({ kind: "profile", length: 100, profile: { shape: "RHS", b: 40, h: 40, t: 2 } }));
    const t = k.topology(s);
    expect(t.solids).toBe(1);
    expect(t.faces).toBe(10); // 4 externas + 4 internas + 2 tampas
  });
});

describe("posicionamento", () => {
  it("matriz identidade", () => {
    expect(placementMatrix(IDENTITY)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  });
  it("rotação X→Y→Z e translação coincidem com o kernel", () => {
    const pl = { origin: { x: 100, y: -50, z: 20 }, rot: { x: 90, y: 0, z: 90 } };
    // caixa 10×20×30: após Rx(90) o eixo Z vira −Y; depois Rz(90) X→Y
    const s = keep(k.primitive({ kind: "box", w: 10, d: 20, h: 30 }, pl));
    const b = k.props(s).bbox;
    const corners = [0, 10].flatMap((x) => [0, 20].flatMap((y) => [0, 30].map((z) => applyPlacement(pl, { x, y, z }))));
    const min = { x: Math.min(...corners.map((c) => c.x)), y: Math.min(...corners.map((c) => c.y)), z: Math.min(...corners.map((c) => c.z)) };
    const max = { x: Math.max(...corners.map((c) => c.x)), y: Math.max(...corners.map((c) => c.y)), z: Math.max(...corners.map((c) => c.z)) };
    for (const ax of ["x", "y", "z"] as const) {
      expect(b.min[ax]).toBeCloseTo(min[ax], 6);
      expect(b.max[ax]).toBeCloseTo(max[ax], 6);
    }
    expect(rel(k.props(s).volume, 6000)).toBeLessThan(1e-12);
  });
});

describe("booleanas", () => {
  it("chapa 500×300×10 com 4 furos Ø20 a 30 mm das bordas", () => {
    let plate = k.primitive({ kind: "box", w: 500, d: 300, h: 10 });
    for (const [x, y] of [[30, 30], [470, 30], [30, 270], [470, 270]]) {
      const hole = k.primitive({ kind: "cylinder", r: 10, h: 10 }, { origin: { x, y, z: 0 }, rot: { x: 0, y: 0, z: 0 } });
      const next = k.cut(plate, hole);
      k.release(plate);
      k.release(hole);
      plate = next;
    }
    keep(plate);
    expect(k.isValid(plate)).toBe(true);
    expect(rel(k.props(plate).volume, 500 * 300 * 10 - 4 * PI * 100 * 10)).toBeLessThan(1e-12);
    expect(k.kind(plate)).toBe("solid");
    expect(k.topology(plate).faces).toBe(10);
  });
  it("união e interseção de caixas sobrepostas", () => {
    const a = keep(k.primitive({ kind: "box", w: 100, d: 100, h: 100 }));
    const b = keep(k.primitive({ kind: "box", w: 100, d: 100, h: 100 }, { origin: { x: 50, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } }));
    expect(rel(k.props(keep(k.fuse(a, b))).volume, 1.5e6)).toBeLessThan(1e-12);
    expect(rel(k.props(keep(k.common(a, b))).volume, 0.5e6)).toBeLessThan(1e-12);
    expect(rel(k.props(keep(k.cut(a, b))).volume, 0.5e6)).toBeLessThan(1e-12);
  });
});

describe("malha e arestas para o viewport", () => {
  it("faixas por face cobrem todos os triângulos e as de aresta todos os pontos", () => {
    const s = keep(k.primitive({ kind: "cylinder", r: 20, h: 50 }));
    const m = k.mesh(s);
    const tris = m.indices.length / 3;
    expect(m.faces.length).toBe(k.topology(s).faces);
    expect(m.faces.reduce((a, f) => a + f.count, 0)).toBe(tris);
    let next = 0;
    for (const f of m.faces) {
      expect(f.start).toBe(next);
      next += f.count;
    }
    expect(m.positions.length).toBe(m.normals.length);
    const e = k.edges(s);
    expect(e.edges.reduce((a, g) => a + g.count, 0)).toBe(e.points.length / 3);
    expect(new Set(m.faces.map((f) => f.id)).size).toBe(m.faces.length);
  });
});

describe("intercâmbio", () => {
  it("STEP: exporta e reimporta o mesmo sólido (mm)", () => {
    const s = keep(k.primitive({ kind: "profile", length: 1500, profile: { shape: "U", h: 100, b: 50, tw: 6, tf: 8 } }));
    const step = k.toStep(s);
    expect(step).toMatch(/^ISO-10303-21;/);
    expect(step).toMatch(/MILLI/);
    const back = keep(k.fromStep(step));
    expect(rel(k.props(back).volume, k.props(s).volume)).toBeLessThan(1e-9);
  });
  it("BREP binário: ida e volta exata", () => {
    const s = keep(k.primitive({ kind: "torus", R: 80, r: 15 }));
    const bytes = k.toBrep(s);
    expect(bytes.length).toBeGreaterThan(100);
    const back = keep(k.fromBrep(bytes));
    expect(k.props(back).volume).toBe(k.props(s).volume);
  });
  it("STEP inválido gera erro de E/S legível", () => {
    expect(() => k.fromStep("isto não é STEP")).toThrow(SolidError);
  });
});

describe("matrizes de posicionamento", () => {
  it("decompor ∘ compor = identidade para vários ângulos", async () => {
    const { matrixToPlacement, composeMatrix, invertRigid, MATRIX_IDENTITY } = await import("@agtn/solid");
    for (const rot of [{ x: 0, y: 0, z: 0 }, { x: 30, y: -45, z: 120 }, { x: 90, y: 0, z: 90 }, { x: 10, y: 90, z: 0 }, { x: -170, y: 20, z: 5 }]) {
      const pl = { origin: { x: 12.5, y: -3, z: 1000 }, rot };
      const m = placementMatrix(pl);
      const back = placementMatrix(matrixToPlacement(m));
      back.forEach((v, i) => expect(v).toBeCloseTo(m[i], 9));
      composeMatrix(m, invertRigid(m)).forEach((v, i) => expect(v).toBeCloseTo(MATRIX_IDENTITY[i], 12));
    }
  });
});
