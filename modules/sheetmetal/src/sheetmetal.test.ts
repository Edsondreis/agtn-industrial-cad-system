import { describe, expect, it } from "vitest";
import { type PolylineEntity, type LineEntity, dist, dot, entityLength, fromAngle, makeEntity, sub } from "@agtn/geometry";
import {
  PROFILE_DEFS,
  type ProfileParams,
  bendAllowance,
  bendDeduction,
  buildProfileInput,
  calibrateFromLTest,
  convertFlangeLength,
  defaultKTable,
  deg,
  flatPatternEntities,
  includedToBend,
  lookupK,
  outsideSetback,
  sectionEntities,
  solveProfile,
} from "./index";

const FAB = { material: "aco_carbono", process: "ar", toolName: "", vOpening: null, punchRadius: null, kTableId: "padrao-agtn" } as const;
const b = (angleDeg: number, R: number, K: number) => ({ angleDeg, R, K, kSource: "manual" as const, kRuleId: null });
const params = (p: Omit<ProfileParams, "fab">): ProfileParams => ({ ...p, fab: { ...FAB } });
const solve = (p: Omit<ProfileParams, "fab">) => solveProfile(buildProfileInput(params(p)));

/** Referência independente (fórmulas aplicadas diretamente, fora do motor). */
const ref = (thDeg: number, R: number, K: number, T: number) => {
  const th = (thDeg * Math.PI) / 180;
  const OSB = (R + T) * Math.tan(th / 2);
  const BA = th * (R + K * T);
  return { OSB, BA, BD: 2 * OSB - BA, ISB: R * Math.tan(th / 2) };
};

describe("fórmulas de dobra", () => {
  it("exemplo da especificação: T=3, R=3, 90°, K=0,40", () => {
    const th = deg(90);
    expect(outsideSetback(th, 3, 3)).toBeCloseTo(6, 12);
    expect(bendAllowance(th, 3, 0.4, 3)).toBeCloseTo(6.597344572538566, 12);
    expect(bendDeduction(th, 3, 0.4, 3)).toBeCloseTo(5.402655427461434, 12);
  });
  it("conversão ângulo interno ↔ ângulo de dobra", () => {
    expect(includedToBend(90)).toBe(90);
    expect(includedToBend(135)).toBe(45);
    expect(includedToBend(45)).toBe(135);
  });
});

describe("Perfil L", () => {
  const L = (h: number, v: number, ref1: "externa" | "interna", T: number, R: number, ang: number, K: number) =>
    solve({ kind: "L", T, partLength: 500, dims: [{ value: v, ref: ref1 }, { value: h, ref: ref1 }], bends: [b(ang, R, K)] });

  it("dimensões externas 100×80, T3 R3 90° K0,40 → 174,5973 mm", () => {
    const r = L(100, 80, "externa", 3, 3, 90, 0.4);
    expect(r.ok).toBe(true);
    expect(r.developedLength).toBeCloseTo(174.59734457253857, 10);
    expect(r.bends[0].OSB).toBeCloseTo(6, 12);
    expect(r.bends[0].BA).toBeCloseTo(6.597344572538566, 12);
    expect(r.bends[0].BD).toBeCloseTo(5.402655427461434, 12);
    expect(r.flanges[0].flat).toBeCloseTo(74, 12);
    expect(r.flanges[1].flat).toBeCloseTo(94, 12);
    expect(r.bends[0].xLine).toBeCloseTo(74 + 6.597344572538566 / 2, 12);
    // equivalência: soma das externas − BD
    expect(r.developedLength).toBeCloseTo(180 - r.bends[0].BD, 12);
  });

  it("dimensões internas 100×80 → 180,5973 mm (≠ externas)", () => {
    const r = L(100, 80, "interna", 3, 3, 90, 0.4);
    expect(r.developedLength).toBeCloseTo(180.59734457253857, 10);
    expect(r.flanges[0].flat).toBeCloseTo(77, 12);
    // interna 100 = externa 103
    expect(r.flanges[1].lengthB).toBeCloseTo(103, 12);
  });

  it("dobra de 45°", () => {
    const rf = ref(45, 2, 0.33, 2);
    const r = L(60, 50, "externa", 2, 2, 45, 0.33);
    expect(r.ok).toBe(true);
    expect(r.bends[0].OSB).toBeCloseTo(rf.OSB, 12);
    expect(r.developedLength).toBeCloseTo(110 - rf.BD, 10);
    expect(r.developedLength).toBeCloseTo(108.77545061565245, 9);
  });

  it("dobra de 135°", () => {
    const rf = ref(135, 1, 0.45, 1.5);
    const r = L(40, 40, "externa", 1.5, 1, 135, 0.45);
    expect(r.ok).toBe(true);
    expect(r.developedLength).toBeCloseTo(80 - rf.BD, 10);
    expect(r.developedLength).toBeCloseTo(71.8755579592067, 9);
    expect(r.bends[0].includedDeg).toBe(45);
  });

  it("espessuras, raios e fatores K diferentes alteram o resultado coerentemente", () => {
    const base = L(100, 80, "externa", 3, 3, 90, 0.4).developedLength;
    expect(L(100, 80, "externa", 3, 3, 90, 0.5).developedLength).toBeGreaterThan(base); // K maior → BA maior
    expect(L(100, 80, "externa", 4, 3, 90, 0.4).developedLength).toBeLessThan(base); // T maior → BD maior
    expect(L(100, 80, "externa", 3, 6, 90, 0.4).developedLength).toBeLessThan(base); // R maior → BD maior
  });

  it("valores de K por material (tabela padrão de estimativas)", () => {
    const t = defaultKTable();
    const steel = lookupK(t, { material: "aco_carbono", process: "ar", T: 3, R: 3 })!;
    const alu = lookupK(t, { material: "aluminio", process: "ar", T: 3, R: 1.5 })!;
    expect(steel.k).toBe(0.43);
    expect(steel.source).toBe("estimado");
    expect(alu.k).toBe(0.33);
    const rs = L(100, 80, "externa", 3, 3, 90, steel.k).developedLength;
    const ra = L(100, 80, "externa", 3, 3, 90, alu.k).developedLength;
    expect(rs).not.toBeCloseTo(ra, 3);
  });

  it("calibração tem prioridade sobre estimativa", () => {
    const t = defaultKTable();
    t.rules.push({ id: "cal1", material: "aco_carbono", process: "ar", tMin: 2.9, tMax: 3.1, rtMin: 0.9, rtMax: 1.1, k: 0.418, source: "calibrado" });
    expect(lookupK(t, { material: "aco_carbono", process: "ar", T: 3, R: 3 })!.k).toBe(0.418);
  });
});

describe("Perfil U", () => {
  it("U simétrico externo 50×100×50, T3 R3 K0,43", () => {
    const r = solve({
      kind: "U",
      T: 3,
      partLength: 1000,
      dims: [{ value: 50, ref: "externa" }, { value: 100, ref: "externa" }, { value: 50, ref: "externa" }],
      bends: [b(90, 3, 0.43), b(90, 3, 0.43)],
    });
    const rf = ref(90, 3, 0.43, 3);
    expect(r.ok).toBe(true);
    expect(r.developedLength).toBeCloseTo(200 - 2 * rf.BD, 10);
    expect(r.developedLength).toBeCloseTo(189.47743248385628, 9);
    expect(r.flanges.map((f) => f.flat)).toEqual([44, 88, 44].map((v) => expect.closeTo(v, 12)));
    // linhas de dobra simétricas
    expect(r.bends[0].xLine + r.bends[1].xLine).toBeCloseTo(r.developedLength, 10);
  });

  it("U assimétrico: abas, raios, ângulos e K diferentes — cada dobra calculada individualmente", () => {
    const r = solve({
      kind: "U",
      T: 2,
      partLength: 600,
      dims: [{ value: 40, ref: "externa" }, { value: 120, ref: "externa" }, { value: 70, ref: "externa" }],
      bends: [b(90, 2, 0.4), b(60, 5, 0.45)],
    });
    const r1 = ref(90, 2, 0.4, 2);
    const r2 = ref(60, 5, 0.45, 2);
    expect(r.ok).toBe(true);
    expect(r.bends[0].BD).toBeCloseTo(r1.BD, 12);
    expect(r.bends[1].BD).toBeCloseTo(r2.BD, 12);
    expect(r.developedLength).toBeCloseTo(230 - r1.BD - r2.BD, 10);
    expect(r.developedLength).toBeCloseTo(224.49379149843088, 9);
  });

  it("referência mista (base externa, abas internas) é convertida explicitamente", () => {
    const sym = solve({
      kind: "U",
      T: 3,
      partLength: 1000,
      dims: [{ value: 50, ref: "externa" }, { value: 100, ref: "externa" }, { value: 50, ref: "externa" }],
      bends: [b(90, 3, 0.43), b(90, 3, 0.43)],
    });
    const mixed = solve({
      kind: "U",
      T: 3,
      partLength: 1000,
      dims: [{ value: 47, ref: "interna" }, { value: 100, ref: "externa" }, { value: 47, ref: "interna" }],
      bends: [b(90, 3, 0.43), b(90, 3, 0.43)],
    });
    expect(mixed.developedLength).toBeCloseTo(sym.developedLength, 12);
  });

  it("conversão interna ↔ externa para ângulos ≠ 90°", () => {
    const bend = { label: "", angleDeg: 60, R: 5, K: 0.45, dir: "left" as const };
    const ext = 70;
    const int = convertFlangeLength(ext, "B", "A", [bend], 2);
    expect(int).toBeCloseTo(70 - 2 * Math.tan(deg(30)), 12);
    expect(convertFlangeLength(int, "A", "B", [bend], 2)).toBeCloseTo(70, 12);
  });

  it("U enrijecido (4 dobras)", () => {
    const r = solve(PROFILE_DEFS.U_ENRIJECIDO.defaults());
    const rf = ref(90, 2, 0.43, 2);
    expect(r.ok).toBe(true);
    expect(r.developedLength).toBeCloseTo(15 + 50 + 100 + 50 + 15 - 4 * rf.BD, 10);
  });
});

describe("validação geométrica da seção", () => {
  const cases = [
    solve(PROFILE_DEFS.L.defaults()),
    solve(PROFILE_DEFS.U.defaults()),
    solve(PROFILE_DEFS.U_ENRIJECIDO.defaults()),
    solve({
      kind: "U",
      T: 2,
      partLength: 600,
      dims: [{ value: 40, ref: "externa" }, { value: 120, ref: "interna" }, { value: 70, ref: "externa" }],
      bends: [b(90, 2, 0.4), b(60, 5, 0.45)],
    }),
  ];

  it("espessura preservada nas tangências e tangência correta (raio ⟂ aba)", () => {
    for (const r of cases) {
      expect(r.ok).toBe(true);
      const s = r.section!;
      r.bends.forEach((bd, j) => {
        const [P1, P2] = s.tangentsA[j];
        const [Q1, Q2] = s.tangentsB[j];
        expect(dist(P1, Q1)).toBeCloseTo(r.T, 10);
        expect(dist(P2, Q2)).toBeCloseTo(r.T, 10);
        // raios concêntricos diferindo exatamente de T
        expect(Math.abs(dist(bd.center, Q1) - dist(bd.center, P1))).toBeCloseTo(r.T, 10);
        expect(dist(bd.center, P1)).toBeCloseTo(dist(bd.center, P2), 10);
        // tangência: direção da aba perpendicular ao raio no ponto de tangência
        const uIn = sub(P1, s.moldA[j]);
        if (Math.hypot(uIn.x, uIn.y) > 1e-9) expect(dot(uIn, sub(P1, bd.center)) / Math.hypot(uIn.x, uIn.y)).toBeCloseTo(0, 9);
      });
    }
  });

  it("perímetro da seção = 2·Σretos + Σθ·R + Σθ·(R+T) + 2T (continuidade e fechamento)", () => {
    for (const r of cases) {
      const poly = makeEntity({ type: "polyline", ...r.section!.contour, closed: true }, "0") as PolylineEntity;
      const expected =
        2 * r.flanges.reduce((s, f) => s + f.flat, 0) +
        r.bends.reduce((s, bd) => s + deg(bd.thetaDeg) * bd.R + deg(bd.thetaDeg) * (bd.R + r.T), 0) +
        2 * r.T;
      expect(entityLength(poly)).toBeCloseTo(expected, 9);
    }
  });

  it("consistência seção × planificação: Σretos + Σ θ(R+KT) = desenvolvido", () => {
    for (const r of cases) {
      const neutral =
        r.flanges.reduce((s, f) => s + f.flat, 0) + r.bends.reduce((s, bd) => s + deg(bd.thetaDeg) * (bd.R + bd.K * r.T), 0);
      expect(neutral).toBeCloseTo(r.developedLength, 10);
    }
  });

  it("comprimentos até vértices virtuais reproduzem a entrada na face escolhida", () => {
    for (const r of cases) for (const f of r.flanges) expect(f.face === "A" ? f.lengthA : f.lengthB).toBeCloseTo(f.inputLength, 10);
  });

  it("direção final do perfil coerente com os ângulos", () => {
    const r = cases[0];
    const s = r.section!;
    const last = sub(s.moldA[2], s.moldA[1]);
    const u = fromAngle(0);
    expect(dot(last, u) / Math.hypot(last.x, last.y)).toBeCloseTo(1, 12); // aba horizontal em +X
  });
});

describe("entradas inválidas e casos-limite", () => {
  const Lp = (over: Partial<{ T: number; R: number; K: number; ang: number; v: number; h: number }>) =>
    solve({
      kind: "L",
      T: over.T ?? 3,
      partLength: 100,
      dims: [{ value: over.v ?? 80, ref: "externa" }, { value: over.h ?? 100, ref: "externa" }],
      bends: [b(over.ang ?? 90, over.R ?? 3, over.K ?? 0.4)],
    });
  it("aba menor que o recuo", () => {
    const r = Lp({ v: 5 });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "FLANGE_SHORT")).toBe(true);
  });
  it("ângulos 0° e 180° rejeitados; K fora de [0,1]; T ≤ 0", () => {
    expect(Lp({ ang: 0 }).ok).toBe(false);
    expect(Lp({ ang: 180 }).ok).toBe(false);
    expect(Lp({ K: 1.2 }).ok).toBe(false);
    expect(Lp({ T: 0 }).ok).toBe(false);
    expect(Lp({ R: -1 }).ok).toBe(false);
  });
  it("raio zero é aceito com aviso", () => {
    const r = Lp({ R: 0 });
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.code === "R_ZERO")).toBe(true);
    expect(r.developedLength).toBeCloseTo(180 - (2 * 3 - (Math.PI / 2) * 0.4 * 3), 10);
  });
  it("K fora da faixa usual gera aviso, não erro", () => {
    const r = Lp({ K: 0.1 });
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.code === "K_UNUSUAL")).toBe(true);
  });
  it("enrijecedores que se cruzam → autointerseção", () => {
    const p = PROFILE_DEFS.U_ENRIJECIDO.defaults();
    p.dims[0].value = 60;
    p.dims[4].value = 60;
    const r = solve(p);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "SELF_INTERSECTION")).toBe(true);
  });
});

describe("planificação e saída para CAD", () => {
  const r = solve(PROFILE_DEFS.U.defaults());
  const ents = flatPatternEntities(r, { origin: { x: 10, y: 20 } });
  it("contorno de corte fechado com dimensões reais", () => {
    const c = ents.filter((e) => e.layer === "CONTORNO_CORTE");
    expect(c).toHaveLength(1);
    const p = c[0] as PolylineEntity;
    expect(p.closed).toBe(true);
    expect(p.pts[1].x - p.pts[0].x).toBeCloseTo(r.developedLength, 12);
    expect(p.pts[2].y - p.pts[1].y).toBeCloseTo(1000, 12);
    expect(p.pts[0]).toEqual({ x: 10, y: 20 });
  });
  it("linhas de dobra separadas do contorno, nas posições calculadas e sem duplicatas", () => {
    const bl = ents.filter((e) => e.layer === "LINHAS_DOBRA") as LineEntity[];
    expect(bl).toHaveLength(2);
    bl.forEach((l, j) => expect(l.a.x - 10).toBeCloseTo(r.bends[j].xLine, 12));
    const keys = new Set(ents.filter((e) => e.type === "line").map((l) => JSON.stringify([(l as LineEntity).a, (l as LineEntity).b])));
    expect(keys.size).toBe(ents.filter((e) => e.type === "line").length);
  });
  it("seção transversal gera contorno e cotas na referência", () => {
    const sec = sectionEntities(r);
    expect(sec.some((e) => e.layer === "SECAO_PERFIL" && e.type === "polyline")).toBe(true);
    expect(sec.filter((e) => e.type === "dimension" && e.kind === "aligned" && e.textOverride?.includes("EXT")).length).toBe(3);
  });
  it("resultado inválido não gera geometria", () => {
    const bad = solve({ ...PROFILE_DEFS.L.defaults(), T: -1 });
    expect(flatPatternEntities(bad)).toHaveLength(0);
  });
});

describe("calibração por ensaio", () => {
  it("recupera o K usado para gerar o ensaio", () => {
    const K = 0.4237;
    const r = solve({ kind: "L", T: 3, partLength: 50, dims: [{ value: 80, ref: "externa" }, { value: 100, ref: "externa" }], bends: [b(90, 3.2, K)] });
    const c = calibrateFromLTest({ blank: r.developedLength, outerA: 80, outerB: 100, thetaDeg: 90, R: 3.2, T: 3 });
    expect(c.K).toBeCloseTo(K, 12);
    expect(c.BD).toBeCloseTo(r.bends[0].BD, 12);
  });
});

describe("regressão", () => {
  it("valores de referência estáveis", () => {
    const snap = [
      solve(PROFILE_DEFS.L.defaults()).developedLength,
      solve(PROFILE_DEFS.U.defaults()).developedLength,
      solve(PROFILE_DEFS.U_ENRIJECIDO.defaults()).developedLength,
    ];
    expect(snap[0]).toBeCloseTo(174.59734457253857, 9);
    expect(snap[1]).toBeCloseTo(200 - 2 * (12 - (Math.PI / 2) * (3 + 0.43 * 3)), 9);
    expect(snap[2]).toBeCloseTo(230 - 4 * (8 - (Math.PI / 2) * (2 + 0.43 * 2)), 9);
  });
});
