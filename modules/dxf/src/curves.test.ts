import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type EllipseEntity,
  type Entity,
  type HatchEntity,
  type SplineEntity,
  type TextEntity,
  type Vec2,
  closestOnEntity,
  dist,
  hatchArea,
  hatchLoopPolygon,
  hatchPatternSegments,
} from "@agtn/geometry";
import { readDxf } from "./index";

/**
 * Gabarito independente: tests/dxf/fixtures/curvas.dxf e curvas.expected.json foram gerados pelo
 * ezdxf (make_curves_fixture.py). O JSON traz a geometria calculada pelo ezdxf; aqui conferimos que
 * o leitor do AGTN CAD chega ao mesmo desenho.
 */
const FIX = new URL("../../../tests/dxf/fixtures/", import.meta.url);
const exp = JSON.parse(readFileSync(new URL("curvas.expected.json", FIX), "utf8")) as {
  ellipses: [number, number][][];
  splines: [number, number][][];
  hatches: { solid: boolean; area: number; patternLength: number; pattern: string }[];
};
const r = readDxf(new Uint8Array(readFileSync(new URL("curvas.dxf", FIX))));
const of = <T extends Entity["type"]>(t: T) => r.entities.filter((e) => e.type === t) as Extract<Entity, { type: T }>[];

/** maior distância de pontos de referência até a curva lida */
function maxDev(ref: [number, number][], e: Entity): number {
  let m = 0;
  for (const [x, y] of ref) {
    const p: Vec2 = { x, y };
    m = Math.max(m, dist(p, closestOnEntity(p, e)));
  }
  return m;
}

describe("leitura de ELLIPSE / SPLINE / HATCH / MTEXT (gabarito ezdxf)", () => {
  it("nada fica como não suportado", () => {
    expect(r.report.unsupported).toEqual({});
    expect(r.report.counts).toMatchObject({ ELLIPSE: 2, SPLINE: 3, HATCH: 4, MTEXT: 2 });
  });

  it("elipses coincidem com o ezdxf (desvio < 0,01 mm)", () => {
    const ells = of("ellipse") as EllipseEntity[];
    expect(ells).toHaveLength(2);
    ells.forEach((e, i) => {
      expect(maxDev(exp.ellipses[i], e)).toBeLessThan(0.01);
      // extremidades do arco iguais às do ezdxf
      const ref = exp.ellipses[i];
      const seg0 = closestOnEntity({ x: ref[0][0], y: ref[0][1] }, e);
      expect(dist(seg0, { x: ref[0][0], y: ref[0][1] })).toBeLessThan(1e-6);
    });
  });

  it("splines (ajuste, aberto e racional) coincidem com o ezdxf (desvio < 0,01 mm)", () => {
    const sps = of("spline") as SplineEntity[];
    expect(sps).toHaveLength(3);
    sps.forEach((e, i) => expect(maxDev(exp.splines[i], e)).toBeLessThan(0.01));
    expect(sps[2].weights).not.toBeNull();
  });

  it("hachuras: área exata e mesmo comprimento de traços do padrão do ezdxf", () => {
    const hs = of("hatch") as HatchEntity[];
    expect(hs).toHaveLength(4);
    // áreas analíticas (o ezdxf mede o polígono aproximado, com erro de ~1e-4)
    const seg = (c: number, b: number) => {
      const th = 4 * Math.atan(b);
      const r = (c * (1 + b * b)) / (4 * b);
      return ((r * r) / 2) * (th - Math.sin(th));
    };
    const exact = [20000 + seg(100, 0.5) - Math.PI * 400, 6000 + Math.PI * 900, (Math.PI * 50 * 25) / 2, exp.hatches[3].area];
    const tol = [1e-9, 1e-9, 1e-5, 2e-4];
    hs.forEach((h, i) => {
      const e = exp.hatches[i];
      const polys = h.loops.map(hatchLoopPolygon);
      expect(h.solid).toBe(e.solid);
      expect(h.pattern).toBe(e.pattern);
      expect(Math.abs(hatchArea(polys, h.loops) - exact[i]) / exact[i]).toBeLessThan(tol[i]);
      expect(Math.abs(e.area - exact[i]) / exact[i]).toBeLessThan(5e-4);
      if (!e.solid) {
        const segs = hatchPatternSegments(polys, h.lines).segs;
        const total = segs.reduce((s, [a, b]) => s + dist(a, b), 0);
        expect(Math.abs(total - e.patternLength) / e.patternLength).toBeLessThan(5e-3);
      }
    });
  });

  it("MTEXT mantém as quebras de linha e o ponto de anexação", () => {
    const ts = of("text") as TextEntity[];
    expect(ts[0].value).toBe("LINHA 1\nSEGUNDA LINHA\ntres");
    // anexação 1 (topo-esquerda): base da 1ª linha uma altura abaixo do ponto de inserção
    expect(ts[0].p.x).toBeCloseTo(0, 9);
    expect(ts[0].p.y).toBeCloseTo(695, 9);
    expect(ts[0].halign).toBe(0);
    expect(ts[1].value).toBe("CENTRO\nMEIO");
    expect(ts[1].halign).toBe(1);
  });
});
