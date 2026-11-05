import { describe, expect, it } from "vitest";
import { parseInput } from "./input";
import { Viewport } from "./view";

describe("linha de comando — coordenadas", () => {
  const last = { x: 10, y: 20 };
  it("absoluta", () => {
    expect(parseInput("100,50", last)).toEqual({ kind: "point", p: { x: 100, y: 50 }, relative: false, polar: false });
    expect(parseInput("-1.5, 2e2", last)).toMatchObject({ p: { x: -1.5, y: 200 } });
  });
  it("relativa", () => {
    expect(parseInput("@25,0", last)).toMatchObject({ kind: "point", p: { x: 35, y: 20 }, relative: true });
  });
  it("polar relativa e absoluta", () => {
    const r = parseInput("@10<90", last);
    expect(r.kind).toBe("point");
    if (r.kind === "point") {
      expect(r.p.x).toBeCloseTo(10, 12);
      expect(r.p.y).toBeCloseTo(30, 12);
    }
    const a = parseInput("100<45", null);
    if (a.kind === "point") expect(a.p.x).toBeCloseTo(70.71067811865476, 12);
  });
  it("relativa sem ponto anterior gera erro", () => {
    expect(parseInput("@1,1", null).kind).toBe("error");
  });
  it("conversão de unidade (cm → mm)", () => {
    expect(parseInput("10,2", null, 10)).toMatchObject({ p: { x: 100, y: 20 } });
  });
  it("número e palavra", () => {
    expect(parseInput("12.75", null)).toEqual({ kind: "number", value: 12.75 });
    expect(parseInput("rec", null)).toEqual({ kind: "word", word: "REC" });
    expect(parseInput("  ", null).kind).toBe("empty");
    expect(parseInput("12,5,3", null).kind).toBe("error");
  });
});

describe("viewport", () => {
  it("ida e volta tela ↔ mundo e zoom ancorado no cursor", () => {
    const v = new Viewport();
    v.width = 1000;
    v.height = 500;
    v.cx = 123.456;
    v.cy = -7;
    v.scale = 3.7;
    const w = { x: 140.25, y: 3.125 };
    const s = v.toScreen(w);
    const back = v.toWorld(s);
    expect(back.x).toBeCloseTo(w.x, 9);
    expect(back.y).toBeCloseTo(w.y, 9);
    v.zoomAt(s, 8);
    const after = v.toWorld(s);
    expect(after.x).toBeCloseTo(w.x, 9);
    expect(after.y).toBeCloseTo(w.y, 9);
  });
});
