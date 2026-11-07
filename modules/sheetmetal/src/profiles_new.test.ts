import { describe, expect, it } from "vitest";
import { entityBox, makeEntity } from "@agtn/geometry";
import { PROFILE_DEFS, type ProfileParams, buildProfileInput, flangeFaces, flatPatternEntities, sectionEntities, solveProfile } from "./index";

const FAB = { material: "aco_carbono", process: "ar", toolName: "", vOpening: null, punchRadius: null, kTableId: "padrao-agtn" } as const;
const solve = (p: Omit<ProfileParams, "fab">) => solveProfile(buildProfileInput({ ...p, fab: { ...FAB } }));
const box = (p: Omit<ProfileParams, "fab">) => {
  const r = solve(p);
  expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  const c = r.section!.contour;
  return { r, b: entityBox(makeEntity({ type: "polyline", pts: c.pts, bulges: c.bulges, closed: true }, "0")) };
};
const BA = (thDeg: number, R: number, K: number, T: number) => ((thDeg * Math.PI) / 180) * (R + K * T);

describe("perfis com dobras em sentidos opostos", () => {
  it("faces externas por ponta: Z usa B na dobra 'left' e A na 'right'", () => {
    expect(flangeFaces("externa", 0, ["left", "right"])).toEqual(["B", "B"]);
    expect(flangeFaces("externa", 1, ["left", "right"])).toEqual(["B", "A"]);
    expect(flangeFaces("externa", 2, ["left", "right"])).toEqual(["A", "A"]);
    expect(flangeFaces("interna", 1, ["left", "right"])).toEqual(["A", "B"]);
    // perfis de um sentido só continuam iguais ao comportamento antigo
    expect(flangeFaces("externa", 1, ["left", "left"])).toEqual(["B", "B"]);
  });

  it("Z 50×150×50 #2 R2: altura de fora a fora = 150, largura = 98, desenvolvido por conta direta", () => {
    const p = PROFILE_DEFS.Z.defaults();
    const { r, b } = box(p);
    expect(b.maxY - b.minY).toBeCloseTo(150, 9);
    expect(b.maxX - b.minX).toBeCloseTo(50 + 50 - 2, 9);
    const T = 2;
    const R = 2;
    const K = p.bends[0].K;
    const flats = [50 - (R + T), 150 - 2 * (R + T), 50 - (R + T)];
    expect(r.flanges.map((f) => f.flat)).toEqual(flats.map((v) => expect.closeTo(v, 9)));
    expect(r.developedLength).toBeCloseTo(flats.reduce((s, v) => s + v, 0) + 2 * BA(90, R, K, T), 9);
    // tabela: alma 150 por fora e 146 por dentro; abas 50 / 48
    expect(r.flanges.map((f) => [f.lengthExt, f.lengthInt])).toEqual([
      [expect.closeTo(50, 9), expect.closeTo(48, 9)],
      [expect.closeTo(150, 9), expect.closeTo(146, 9)],
      [expect.closeTo(50, 9), expect.closeTo(48, 9)],
    ]);
  });

  it("Z interno: alma medida por dentro (face interna nas duas pontas)", () => {
    const p = { ...PROFILE_DEFS.Z.defaults(), dims: [50, 146, 50].map((value) => ({ value, ref: "interna" as const })) };
    const { b } = box(p);
    expect(b.maxY - b.minY).toBeCloseTo(146 + 4, 9);
  });

  it("cartola 25/50/50/50/25 #2: altura total 50 e topo externo 50", () => {
    const { r, b } = box(PROFILE_DEFS.CARTOLA.defaults());
    expect(b.maxY - b.minY).toBeCloseTo(50, 9);
    // largura total = abas + topo externo − as duas espessuras das laterais que as abas compartilham
    expect(b.maxX - b.minX).toBeCloseTo(25 + 50 + 25 - 2 * 2, 9);
    expect(r.bends).toHaveLength(4);
  });

  it("ômega a 60°: abas e topo horizontais, laterais inclinadas e simetria", () => {
    const { r, b } = box(PROFILE_DEFS.OMEGA.defaults());
    expect(r.bends.every((x) => Math.abs(x.thetaDeg - 60) < 1e-9)).toBe(true);
    // lateral medida de fora a fora na direção dela (60); as faces externas das duas pontas ficam
    // em lados opostos da chapa, o que soma T·cos 60° na altura total
    expect(b.maxY - b.minY).toBeCloseTo(60 * Math.sin(Math.PI / 3) + 2 * Math.cos(Math.PI / 3), 9);
    const fl = r.flanges.map((f) => f.flat);
    expect(fl[0]).toBeCloseTo(fl[4], 9);
    expect(fl[1]).toBeCloseTo(fl[3], 9);
  });

  it("Z enrijecido (Ze 200×60×17 #2): seção válida, alma de 200 e saídas de desenho", () => {
    const p = PROFILE_DEFS.Z_ENRIJECIDO.defaults();
    const { r, b } = box(p);
    expect(b.maxY - b.minY).toBeCloseTo(200, 9);
    const sec = sectionEntities(r);
    expect(sec.some((e) => e.type === "dimension" && e.kind === "linear")).toBe(true);
    const flat = flatPatternEntities(r, { title: "Ze" } as never);
    expect(flat.length).toBeGreaterThan(5);
  });
});
