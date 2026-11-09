import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Entity, type LineEntity, type PolylineEntity, type TextEntity, type Vec2, polylineSignedArea } from "@agtn/geometry";
import { dxfBytes, readDxf, writeDxf } from "@agtn/dxf";
import { SM_LAYERS, type TrayInput, type TrayResult, solveTray, subtractCircle, trayFlatEntities, trayViewEntities } from "./index";

/**
 * Gabarito: tests/dxf/fixtures/bandeja_710.0CUH25-01-03.dxf — planificação real usada na AGTN
 * (CHAPA SUPERIOR, CH 3,18; 535 × 520 × 25,4 externas; Ri 2; K 0,33; canto sobreposto pelas abas do lado A).
 */
const FIX = new URL("../../../tests/dxf/fixtures/", import.meta.url);
const ref = readDxf(new Uint8Array(readFileSync(new URL("bandeja_710.0CUH25-01-03.dxf", FIX))));
const refOutline = ref.entities.find((e) => e.type === "polyline") as PolylineEntity;
const refBends = ref.entities.filter((e) => e.type === "line") as LineEntity[];

const BASE: TrayInput = {
  A: 535,
  B: 520,
  flanges: { S: 25.4, N: 25.4, O: 25.4, L: 25.4 },
  ref: "externa",
  T: 3.18,
  R: 2,
  K: 0.33,
  corner: "sobreposto",
  overlap: "A",
  gap: 0,
};
const ALL = (v: number) => ({ S: v, N: v, O: v, L: v });
const solve = (p: Partial<TrayInput> = {}) => {
  const r = solveTray({ ...BASE, ...p });
  expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  return r;
};
const sameLoop = (a: readonly Vec2[], b: readonly Vec2[]) => {
  expect(a.length).toBe(b.length);
  const i0 = a.findIndex((p) => Math.abs(p.x - b[0].x) < 1e-6 && Math.abs(p.y - b[0].y) < 1e-6);
  expect(i0).toBeGreaterThanOrEqual(0);
  for (let k = 0; k < b.length; k++) {
    const p = a[(i0 + k) % a.length];
    expect(p.x).toBeCloseTo(b[k].x, 5);
    expect(p.y).toBeCloseTo(b[k].y, 5);
  }
};
const perimeter = (p: readonly Vec2[]) => p.reduce((s, q, i) => s + Math.hypot(p[(i + 1) % p.length].x - q.x, p[(i + 1) % p.length].y - q.y), 0);
/** menor x do contorno numa faixa de y (para medir avanços) */
const minXat = (r: TrayResult, y0: number, y1: number): number => Math.min(...r.contour.filter((p) => p.y >= y0 - 1e-9 && p.y <= y1 + 1e-9).map((p) => p.x));
const minYat = (r: TrayResult, x0: number, x1: number) => Math.min(...r.contour.filter((p) => p.x >= x0 - 1e-9 && p.x <= x1 + 1e-9).map((p) => p.y));

describe("bandeja — 90°, sem pestana", () => {
  it("reproduz a planificação 710.0CUH25-01-03 (contorno, recortes e linhas de dobra)", () => {
    const r = solve();
    expect(r.BA).toBeCloseTo(4.79, 4);
    expect(r.contour).toHaveLength(20);
    sameLoop(r.contour, refOutline.pts);
    expect(r.blank.w).toBeCloseTo(574.66, 4);
    expect(r.blank.h).toBeCloseTo(559.66, 4);
    expect(r.cutLength).toBeCloseTo(perimeter(refOutline.pts), 6);
    expect(r.area).toBeCloseTo(Math.abs(polylineSignedArea(refOutline.pts, refOutline.pts.map(() => 0))), 6);
    expect(refBends).toHaveLength(4);
    const d = (u: Vec2, v: Vec2) => Math.hypot(u.x - v.x, u.y - v.y);
    for (const l of refBends) {
      const hit = r.bends.find((b) => (d(b.line[0], l.a) < 1e-6 && d(b.line[1], l.b) < 1e-6) || (d(b.line[0], l.b) < 1e-6 && d(b.line[1], l.a) < 1e-6));
      expect(hit, `linha de dobra ${JSON.stringify(l.a)}`).toBeTruthy();
    }
  });

  it("medidas internas ≡ externas − T", () => {
    const e = solve();
    const i = solve({ ref: "interna", A: 535 - 6.36, B: 520 - 6.36, flanges: ALL(22.22) });
    sameLoop(i.contour, e.contour);
    expect(i.Aext).toBeCloseTo(535, 12);
  });

  it("cantos: sobreposto, encosto (fechado), esquadria e aberto", () => {
    const s = 5.18, R = 2;
    // aba S (lado A) — menor x na faixa y ∈ [0, 20,22]; aba O (lado B) — menor y na faixa x ∈ [0, 20,22]
    const sob = solve();
    expect(minXat(sob, 0, 15)).toBeCloseTo(25.009986 - s, 5);
    expect(minYat(sob, 0, 15)).toBeCloseTo(25.009986, 5);
    const enc = solve({ corner: "encosto", gap: 0.5 });
    expect(minXat(enc, 0, 15)).toBeCloseTo(25.009986 - s, 5); // a que fecha vai até a face externa
    expect(minYat(enc, 0, 15)).toBeCloseTo(25.009986 - (R - 0.5), 5); // a outra encosta na face interna
    const esq = solve({ corner: "esquadria", gap: 1 });
    expect(minXat(esq, 0, 15)).toBeCloseTo(25.009986 - (R - 0.5), 5);
    expect(minYat(esq, 0, 15)).toBeCloseTo(25.009986 - (R - 0.5), 5);
    const ab = solve({ corner: "aberto" });
    expect(ab.contour).toHaveLength(12);
    expect(minXat(ab, 0, 15)).toBeCloseTo(25.009986, 5);
  });

  it("sobrepor pelo lado B passa o avanço para as abas esquerda/direita", () => {
    const r = solve({ overlap: "B" });
    expect(minYat(r, 0, 15)).toBeCloseTo(25.009986 - 5.18, 5);
    expect(r.order.map((o) => o.side)).toEqual(["S", "N", "O", "L"]);
    expect(solve().order.map((o) => o.side)).toEqual(["O", "L", "S", "N"]);
  });

  it("três abas e alturas diferentes", () => {
    const r = solve({ A: 400, B: 300, flanges: { S: 40, N: 0, O: 30, L: 30 }, T: 2, R: 2, K: 0.4 });
    expect(r.bends).toHaveLength(3);
    expect(r.base.b).toBeCloseTo(300 - 4, 12);
    expect(r.blank.h).toBeCloseTo(r.base.b + r.BA + 36, 9);
  });

  it("erros", () => {
    const code = (p: Partial<TrayInput>) => solveTray({ ...BASE, ...p }).issues.map((i) => i.code);
    expect(code({ flanges: { S: 5, N: 25, O: 25, L: 25 } })).toContain("H_MIN");
    expect(solveTray({ ...BASE, flanges: ALL(0) }).ok).toBe(false);
    expect(code({ A: 8 })).toContain("BASE");
    expect(code({ angleDeg: 180 })).toContain("ANGLE");
    expect(code({ lips: ALL(3) })).toContain("P_MIN");
    expect(code({ lips: ALL(15), flanges: ALL(8) })).toContain("H_MIN");
  });
});

describe("bandeja — ângulo qualquer e pestana (enrijecida)", () => {
  const CASES: [string, Partial<TrayInput>][] = [
    ["θ 60° esquadria", { angleDeg: 60, corner: "esquadria", flanges: ALL(40) }],
    ["θ 120° esquadria", { angleDeg: 120, corner: "esquadria", flanges: ALL(40) }],
    ["θ 75° encosto", { angleDeg: 75, corner: "encosto", flanges: ALL(40), gap: 0.5 }],
    ["enrijecida 90/90 para dentro", { flanges: ALL(40), lips: ALL(15), corner: "sobreposto" }],
    ["enrijecida para fora, interna", { flanges: ALL(40), lips: ALL(15), lipDir: "fora", ref: "interna", corner: "esquadria" }],
    ["enrijecida θ 80° pestana 45°", { angleDeg: 80, flanges: ALL(50), lips: ALL(20), lipAngleDeg: 45, corner: "esquadria", gap: 1 }],
    ["enrijecida, abas e pestanas diferentes", { flanges: { S: 40, N: 30, O: 50, L: 0 }, lips: { S: 12, N: 0, O: 18, L: 9 }, corner: "encosto" }],
  ];

  it.each(CASES)("%s: retos e desenvolvimento idênticos ao motor de perfis", (_n, p) => {
    const r = solve(p);
    for (const [sec, first, last, base] of [
      [r.sections.X, "esq.", "dir.", r.base.a],
      [r.sections.Y, "inf.", "sup.", r.base.b],
    ] as const) {
      expect(sec?.ok, JSON.stringify(sec?.issues)).toBe(true);
      const fl = (label: string) => sec!.flanges.find((f) => f.label === label);
      expect(fl("Fundo")!.flat).toBeCloseTo(base, 9);
      for (const sd of r.sides) {
        const short = { S: "inf.", N: "sup.", O: "esq.", L: "dir." }[sd.side];
        if (short !== first && short !== last) continue;
        expect(fl(`Aba ${short}`)!.flat).toBeCloseTo(sd.flat, 9);
        if (sd.P > 0) expect(fl(`Pestana ${short}`)!.flat).toBeCloseTo(sd.lipFlat, 9);
      }
      // linhas de dobra da chapa nas mesmas posições do desenvolvimento do motor
      const vertical = first === "esq.";
      const pos = r.bends
        .filter((b) => (vertical ? b.side === "O" || b.side === "L" : b.side === "S" || b.side === "N"))
        .map((b) => (vertical ? b.line[0].x : b.line[0].y))
        .sort((x, y) => x - y);
      const eng = sec!.bends.map((b) => b.xLine);
      const off = pos[0] - eng[0];
      eng.forEach((x, j) => expect(pos[j] - off).toBeCloseTo(x, 9));
    }
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("esquadria com aba inclinada: ponta da aba inclina cos θ por mm e a chapa tem esse vértice", () => {
    for (const th of [60, 75, 105, 120]) {
      const r = solve({ angleDeg: th, corner: "esquadria", flanges: ALL(40), gap: 1 });
      const S = r.sides.find((x) => x.side === "S")!;
      const w = S.bands.find((g) => g.kind === "aba")!;
      const c = Math.cos((th * Math.PI) / 180);
      expect((w.s1 - w.s0) / (w.v1 - w.v0)).toBeCloseTo(c, 9);
      expect((w.e1 - w.e0) / (w.v1 - w.v0)).toBeCloseTo(c, 9);
      // simetria: a aba vizinha tem a mesma aresta (meia-esquadria)
      const O = r.sides.find((x) => x.side === "O")!.bands.find((g) => g.kind === "aba")!;
      expect(O.e1).toBeCloseTo(w.s1, 9);
      // a ponta da aba S (y mínimo) começa em  (canto do fundo) − avanço na ponta
      const D = r.BA + S.flat;
      expect(r.contour.some((p) => Math.abs(p.y) < 1e-9 && Math.abs(p.x - (D - w.s1)) < 1e-9)).toBe(true);
    }
  });

  it("pestana para dentro em esquadria: corte a 45° na chapa", () => {
    const r = solve({ flanges: ALL(40), lips: ALL(15), corner: "esquadria" });
    const y0 = minYat(r, 0, 1e9);
    const lipLen = r.sides[0].lipFlat;
    const pts = r.contour.filter((p) => p.y >= y0 - 1e-9 && p.y <= y0 + lipLen + 1e-9 && p.x < r.blank.w / 2).sort((p, q) => p.y - q.y);
    const a = pts[0], b = pts[pts.length - 1];
    expect(Math.abs((b.x - a.x) / (b.y - a.y))).toBeCloseTo(1, 9);
    // a ponta da pestana fica para dentro (estreita) — corte em V que fecha na dobra
    expect(a.x).toBeGreaterThan(b.x);
    expect(r.bends.filter((x) => x.kind === "pestana")).toHaveLength(4);
    expect(r.order.slice(0, 4).every((o) => o.kind === "pestana")).toBe(true);
  });

  it("pestana para fora: dobra BAIXO e cresce no canto", () => {
    const r = solve({ flanges: ALL(40), lips: ALL(15), lipDir: "fora", corner: "esquadria" });
    expect(r.bends.filter((b) => b.kind === "pestana").every((b) => b.sense === "BAIXO")).toBe(true);
    const bands = r.sides[0].bands;
    const wall = bands.find((g) => g.kind === "aba")!, lip = bands.find((g) => g.kind === "pestana")!;
    expect(lip.s1).toBeGreaterThan(wall.s1 + 10); // a pestana passa da aba no canto, em V para fora
    expect(lip.s1 - lip.s0).toBeCloseTo(lip.v1 - lip.v0, 9); // 45°
  });

  it("altura vertical: θ 60° → H·sen θ + espessura no topo", () => {
    const r = solve({ angleDeg: 60, corner: "esquadria", flanges: ALL(40) });
    const th = Math.PI / 3;
    // topo externo da aba (face externa) a H·sen θ; a quina interna do topo fica T·cos θ acima
    expect(r.sides[0].heightVert).toBeCloseTo(40 * Math.sin(th) + 3.18 * Math.cos(th), 6);
  });
});

describe("bandeja — alívio redondo e saída", () => {
  it("furo de alívio redondo nos 4 cantos", () => {
    const ret = solve();
    const r = solve({ relief: "redondo" });
    expect(r.reliefD).toBe(Math.ceil((Math.SQRT2 * r.BA + 3.18) * 2) / 2);
    const arcs = r.bulges.filter((b) => b < -1e-9);
    expect(arcs).toHaveLength(4);
    expect(r.area).toBeLessThan(ret.area);
    expect(r.issues.some((i) => i.code === "RELIEF_SMALL")).toBe(false);
    expect(solve({ relief: "redondo", reliefD: 4 }).issues.some((i) => i.code === "RELIEF_SMALL")).toBe(true);
  });

  it("subtractCircle: quadrado menos círculo no canto", () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const r = subtractCircle(sq, [0, 0, 0, 0], { x: 0, y: 0 }, 3);
    expect(r.pts).toHaveLength(5);
    const area = Math.abs(polylineSignedArea(r.pts, r.bulges));
    expect(area).toBeCloseTo(100 - (Math.PI * 9) / 4, 9);
  });

  it("entidades: camadas do módulo, marcação por dobra e DXF R12 de ida e volta", () => {
    const r = solve();
    const ents = trayFlatEntities(r, { title: "BANDEJA 535x520x25,4 #3,18" });
    const names = new Set(SM_LAYERS.map((l) => l.name));
    for (const e of ents) expect(names.has(e.layer), e.layer).toBe(true);
    const marks = ents.filter((e) => e.layer === "MARCACAO") as TextEntity[];
    expect(marks.map((m) => m.value.split(" ")[0]).sort()).toEqual(["D1", "D2", "D3", "D4"]);
    for (const m of marks) {
      expect(m.p.x).toBeGreaterThan(25);
      expect(m.p.y).toBeGreaterThan(25);
      expect(m.p.x).toBeLessThan(550);
      expect(m.p.y).toBeLessThan(535);
    }
    const layers = SM_LAYERS.map((l) => ({ name: l.name, color: l.color, lineweight: l.lineweight, linetype: l.linetype, visible: true, locked: false }));
    const txt = writeDxf({ layers, entities: ents }, { layerFilter: ["CONTORNO_CORTE", "LINHAS_DOBRA"] });
    const back = readDxf(txt);
    sameLoop((back.entities.find((e) => e.type === "polyline") as PolylineEntity).pts, refOutline.pts);
    expect(back.entities.filter((e: Entity) => e.type === "line" && e.layer === "LINHAS_DOBRA")).toHaveLength(4);
    const OUT = new URL("../../../tests/output/", import.meta.url);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(new URL("planificacao_bandeja_corte.dxf", OUT), dxfBytes(txt));
    const enr = solve({ flanges: ALL(40), lips: ALL(15), corner: "esquadria", relief: "redondo", gap: 1 });
    const enrEnts = trayFlatEntities(enr, { title: "BANDEJA ENRIJ. 535x520x40 P15 #3,18" });
    expect((enrEnts.filter((e) => e.layer === "MARCACAO") as TextEntity[]).map((m) => m.value.split(" ")[0]).sort()).toEqual(
      ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"],
    );
    writeFileSync(new URL("planificacao_bandeja_enrijecida.dxf", OUT), dxfBytes(writeDxf({ layers, entities: enrEnts })));
  });

  it("vista: planta + duas seções em todas as variações", () => {
    for (const p of [{}, { R: 0 }, { flanges: { S: 25.4, N: 0, O: 25.4, L: 0 } }, { corner: "aberto" as const }, { angleDeg: 60, corner: "esquadria" as const, flanges: ALL(40) }, { lips: ALL(15), flanges: ALL(40) }]) {
      const r = solve(p);
      const v = trayViewEntities(r);
      expect(v.filter((e) => e.type === "polyline" && e.layer === "SECAO_PERFIL").length).toBeGreaterThanOrEqual(4);
      for (const e of v) if (e.type === "polyline") for (const pt of e.pts) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
    }
  });
});
