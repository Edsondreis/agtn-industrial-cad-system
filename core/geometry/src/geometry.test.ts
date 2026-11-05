import { describe, expect, it } from "vitest";
import {
  type ArcEntity,
  type CircleEntity,
  type LineEntity,
  type PolylineEntity,
  arcFrom3Points,
  bulgeSeg,
  chamferLines,
  circleCircle,
  deg2rad,
  dimensionGeometry,
  dimensionValue,
  entityBox,
  entityIntersections,
  entityLength,
  explodePolyline,
  extendEntity,
  filletLines,
  findSnap,
  joinEntities,
  lineCircleParams,
  lineLine,
  makeEntity,
  mirrorLine,
  offsetEntity,
  polylineSignedArea,
  rectanglePoints,
  regularPolygon,
  rotation,
  scaling,
  selfIntersections,
  stretchEntity,
  transformEntity,
  translation,
  trimEntity,
  polylineSegs,
  formatNumber,
} from "./index";

const L = (ax: number, ay: number, bx: number, by: number): LineEntity =>
  makeEntity({ type: "line", a: { x: ax, y: ay }, b: { x: bx, y: by } }, "0");
const C = (x: number, y: number, r: number): CircleEntity => makeEntity({ type: "circle", c: { x, y }, r }, "0");
const A = (x: number, y: number, r: number, a0: number, a1: number): ArcEntity =>
  makeEntity({ type: "arc", c: { x, y }, r, a0: deg2rad(a0), a1: deg2rad(a1) }, "0");
const P = (pts: [number, number][], closed: boolean, bulges?: number[]): PolylineEntity =>
  makeEntity(
    { type: "polyline", pts: pts.map(([x, y]) => ({ x, y })), bulges: bulges ?? pts.map(() => 0), closed },
    "0",
  );

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);
const closeP = (p: { x: number; y: number }, x: number, y: number, eps = 1e-9) => {
  close(p.x, x, eps);
  close(p.y, y, eps);
};

describe("interseções", () => {
  it("linha × linha", () => {
    const h = lineLine({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })!;
    closeP(h.p, 5, 5);
    close(h.t, 0.5);
    expect(lineLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });
  it("linha × círculo (secante, tangente, externa)", () => {
    expect(lineCircleParams({ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, 5)).toHaveLength(2);
    expect(lineCircleParams({ x: -10, y: 5 }, { x: 10, y: 5 }, { x: 0, y: 0 }, 5)).toHaveLength(1);
    expect(lineCircleParams({ x: -10, y: 6 }, { x: 10, y: 6 }, { x: 0, y: 0 }, 5)).toHaveLength(0);
  });
  it("círculo × círculo", () => {
    const pts = circleCircle({ x: 0, y: 0 }, 5, { x: 8, y: 0 }, 5);
    expect(pts).toHaveLength(2);
    for (const p of pts) close(p.x, 4);
    expect(circleCircle({ x: 0, y: 0 }, 5, { x: 10, y: 0 }, 5)).toHaveLength(1);
  });
  it("arco limita interseções ao seu domínio", () => {
    const arc = A(0, 0, 10, 0, 90);
    const line = L(-20, 5, 20, 5);
    const pts = entityIntersections(arc, line);
    expect(pts).toHaveLength(1);
    closeP(pts[0], Math.sqrt(75), 5);
  });
  it("precisão em coordenadas grandes (1e6 mm)", () => {
    const h = lineLine({ x: 1e6, y: 1e6 }, { x: 1e6 + 1000, y: 1e6 + 1000 }, { x: 1e6, y: 1e6 + 1000 }, { x: 1e6 + 1000, y: 1e6 })!;
    closeP(h.p, 1e6 + 500, 1e6 + 500, 1e-7);
  });
});

describe("medidas", () => {
  it("comprimentos", () => {
    close(entityLength(L(0, 0, 3, 4)), 5);
    close(entityLength(C(0, 0, 10)), 2 * Math.PI * 10);
    close(entityLength(A(0, 0, 10, 0, 90)), (Math.PI / 2) * 10);
    close(entityLength(P([[0, 0], [10, 0], [10, 10]], false)), 20);
  });
  it("bulge → arco: semicírculo", () => {
    const s = bulgeSeg({ x: 0, y: 0 }, { x: 10, y: 0 }, 1);
    expect(s.kind).toBe("arc");
    if (s.kind === "arc") {
      closeP(s.c, 5, 0);
      close(s.r, 5);
      close(s.sweep, Math.PI);
    }
  });
  it("área de polilinha com arco", () => {
    // retângulo 10x10 com lado inferior substituído por semicírculo para fora (bulge positivo em CCW)
    const sq = polylineSignedArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], [0, 0, 0, 0]);
    close(sq, 100);
    const withArc = polylineSignedArea(
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      [1, 0, 0, 0],
    );
    close(withArc, 100 + (Math.PI * 25) / 2, 1e-9);
  });
  it("caixa exata de arco considera quadrantes", () => {
    const b = entityBox(A(0, 0, 10, 45, 135));
    close(b.maxY, 10);
    close(b.minX, -Math.SQRT1_2 * 10);
  });
});

describe("transformações", () => {
  it("rotação 90° em torno de ponto", () => {
    const l = transformEntity(L(10, 0, 20, 0), rotation(Math.PI / 2, { x: 10, y: 0 }));
    closeP(l.a, 10, 0);
    closeP(l.b, 10, 10);
  });
  it("escala uniforme de círculo", () => {
    const c = transformEntity(C(10, 10, 5), scaling(2, { x: 0, y: 0 }));
    closeP(c.c, 20, 20);
    close(c.r, 10);
  });
  it("espelho inverte orientação do arco e mantém comprimento", () => {
    const a = A(0, 0, 10, 0, 90);
    const m = transformEntity(a, mirrorLine({ x: 0, y: 0 }, { x: 0, y: 1 }));
    close(entityLength(m), entityLength(a));
    // arco 0..90 espelhado no eixo Y vira 90..180
    close(m.a0, Math.PI / 2);
    close(m.a1, Math.PI);
  });
  it("translação preserva id", () => {
    const l = L(0, 0, 1, 1);
    const t = transformEntity(l, translation(5, 5));
    expect(t.id).toBe(l.id);
    closeP(t.a, 5, 5);
  });
  it("espelho de polilinha inverte bulges", () => {
    const p = P([[0, 0], [10, 0]], false, [0.5, 0]);
    const m = transformEntity(p, mirrorLine({ x: 0, y: 0 }, { x: 1, y: 0 }));
    close(m.bulges[0], -0.5);
    close(entityLength(m), entityLength(p));
  });
});

describe("offset", () => {
  it("linha deslocada para o lado do ponto", () => {
    const r = offsetEntity(L(0, 0, 10, 0), 5, { x: 3, y: 1 });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === "line") {
      closeP(r.value.a, 0, 5);
      closeP(r.value.b, 10, 5);
    }
  });
  it("círculo para dentro e para fora", () => {
    const i = offsetEntity(C(0, 0, 10), 3, { x: 1, y: 0 });
    const o = offsetEntity(C(0, 0, 10), 3, { x: 20, y: 0 });
    expect(i.ok && i.value.type === "circle" && Math.abs(i.value.r - 7) < 1e-12).toBe(true);
    expect(o.ok && o.value.type === "circle" && Math.abs(o.value.r - 13) < 1e-12).toBe(true);
    expect(offsetEntity(C(0, 0, 2), 3, { x: 0.5, y: 0 }).ok).toBe(false);
  });
  it("retângulo fechado: offset externo de 2 mm", () => {
    const rect = P([[0, 0], [100, 0], [100, 50], [0, 50]], true);
    const r = offsetEntity(rect, 2, { x: -10, y: 25 });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === "polyline") {
      const pts = r.value.pts;
      closeP(pts[0], -2, -2);
      closeP(pts[1], 102, -2);
      closeP(pts[2], 102, 52);
      closeP(pts[3], -2, 52);
    }
  });
  it("polilinha com trecho em arco tangente (perfil) mantém tangência", () => {
    // L com raio: (0,10)->(0,2) arco R2 até (2,0) -> (10,0). Percurso descendo e virando à esquerda.
    const b = Math.tan(Math.PI / 8);
    const pl = P([[0, 10], [0, 2], [2, 0], [10, 0]], false, [0, b, 0, 0]);
    const r = offsetEntity(pl, 1, { x: -5, y: 5 }); // lado de fora (esquerda geométrica = x<0)
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === "polyline") {
      const segs = polylineSegs(r.value);
      const arc = segs[1];
      expect(arc.kind).toBe("arc");
      if (arc.kind === "arc") close(arc.r, 3, 1e-9);
      closeP(r.value.pts[1], -1, 2);
      closeP(r.value.pts[2], 2, -1);
    }
  });
  it("offset grande demais em retângulo interno falha com mensagem", () => {
    const rect = P([[0, 0], [10, 0], [10, 10], [0, 10]], true);
    const r = offsetEntity(rect, 6, { x: 5, y: 5 });
    expect(r.ok).toBe(false);
  });
});

describe("trim / extend", () => {
  it("trim de linha entre duas arestas", () => {
    const target = L(0, 0, 30, 0);
    const c1 = L(10, -5, 10, 5);
    const c2 = L(20, -5, 20, 5);
    const r = trimEntity(target, [c1, c2], { x: 15, y: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(2);
      const [p1, p2] = r.value as LineEntity[];
      expect(p1.id).toBe(target.id);
      closeP(p1.b, 10, 0);
      closeP(p2.a, 20, 0);
    }
  });
  it("trim de extremidade", () => {
    const r = trimEntity(L(0, 0, 30, 0), [L(10, -5, 10, 5)], { x: 2, y: 0 });
    expect(r.ok && r.value.length === 1).toBe(true);
    if (r.ok) closeP((r.value[0] as LineEntity).a, 10, 0);
  });
  it("trim de círculo vira arco", () => {
    const r = trimEntity(C(0, 0, 10), [L(-20, 0, 20, 0)], { x: 0, y: 10 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const a = r.value[0] as ArcEntity;
      expect(a.type).toBe("arc");
      close(entityLength(a), Math.PI * 10, 1e-9);
      // trecho superior removido → arco inferior (π..2π)
      close(a.a0, Math.PI);
    }
  });
  it("trim de retângulo (polilinha fechada)", () => {
    const rect = P([[0, 0], [10, 0], [10, 10], [0, 10]], true);
    const r = trimEntity(rect, [L(5, -5, 5, 15)], { x: 10, y: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const p = r.value[0] as PolylineEntity;
      expect(p.closed).toBe(false);
      close(entityLength(p), 5 + 10 + 5, 1e-9);
    }
  });
  it("extend de linha até limite", () => {
    const r = extendEntity(L(0, 0, 5, 0), [L(20, -5, 20, 5)], { x: 4, y: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) closeP((r.value as LineEntity).b, 20, 0);
  });
  it("extend de arco até linha", () => {
    const r = extendEntity(A(0, 0, 10, 0, 45), [L(0, 0, 0, 20)], { x: 7, y: 7 });
    expect(r.ok).toBe(true);
    if (r.ok) close((r.value as ArcEntity).a1, Math.PI / 2, 1e-9);
  });
});

describe("fillet / chamfer", () => {
  it("fillet R5 em canto 90°", () => {
    const r = filletLines(L(0, 0, 20, 0), { x: 15, y: 0 }, L(0, 0, 0, 20), { x: 0, y: 15 }, 5);
    expect(r.ok).toBe(true);
    if (r.ok) {
      closeP(r.value.l1.b, 5, 0);
      closeP(r.value.l2.b, 0, 5);
      const c = r.value.corner!;
      expect(c.type).toBe("arc");
      if (c.type === "arc") {
        closeP(c.c, 5, 5);
        close(c.r, 5);
      }
    }
  });
  it("fillet com linhas que não se tocam (estende)", () => {
    const r = filletLines(L(2, 0, 20, 0), { x: 15, y: 0 }, L(0, 3, 0, 20), { x: 0, y: 15 }, 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      closeP(r.value.l1.b, 0, 0);
      closeP(r.value.l2.b, 0, 0);
    }
  });
  it("chamfer 3×4", () => {
    const r = chamferLines(L(0, 0, 20, 0), { x: 15, y: 0 }, L(0, 0, 0, 20), { x: 0, y: 15 }, 3, 4);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.corner?.type === "line") {
      closeP(r.value.corner.a, 3, 0);
      closeP(r.value.corner.b, 0, 4);
    }
  });
  it("raio grande demais falha", () => {
    expect(filletLines(L(0, 0, 2, 0), { x: 1, y: 0 }, L(0, 0, 0, 2), { x: 0, y: 1 }, 5).ok).toBe(false);
  });
});

describe("explode / join / stretch", () => {
  it("explode e join são inversos (comprimento preservado)", () => {
    const pl = P([[0, 0], [10, 0], [10, 10], [0, 10]], true, [0, 0.4, 0, 0]);
    const parts = explodePolyline(pl);
    expect(parts).toHaveLength(4);
    const j = joinEntities(parts);
    expect(j.ok).toBe(true);
    if (j.ok) {
      expect(j.value.closed).toBe(true);
      close(entityLength(j.value), entityLength(pl), 1e-9);
    }
  });
  it("join com linha invertida", () => {
    const j = joinEntities([L(0, 0, 10, 0), L(20, 0, 10, 0)]);
    expect(j.ok && j.value.pts.length === 3).toBe(true);
  });
  it("stretch move só os pontos na janela", () => {
    const e = stretchEntity(L(0, 0, 10, 0), { minX: 8, minY: -1, maxX: 12, maxY: 1 }, { x: 5, y: 0 });
    expect(e && e.type === "line" && e.b.x === 15 && e.a.x === 0).toBe(true);
  });
});

describe("snap", () => {
  it("extremidade, ponto médio, centro e interseção", () => {
    const l1 = L(0, 0, 10, 0);
    const l2 = L(5, -5, 5, 5);
    const c = C(30, 0, 5);
    const modes = { endpoint: true, midpoint: true, center: true, intersection: true, quadrant: true };
    expect(findSnap({ cursor: { x: 9.8, y: 0.1 }, tolerance: 0.5, modes, nearby: [l1, l2, c] })?.kind).toBe("endpoint");
    const s = findSnap({ cursor: { x: 5.1, y: 0.1 }, tolerance: 0.5, modes, nearby: [l1, l2, c] });
    expect(s?.kind === "intersection" || s?.kind === "midpoint").toBe(true);
    closeP(s!.p, 5, 0);
    expect(findSnap({ cursor: { x: 30.2, y: 0.2 }, tolerance: 0.5, modes, nearby: [c] })?.kind).toBe("center");
  });
  it("perpendicular a partir do ponto base", () => {
    const s = findSnap({
      cursor: { x: 4.9, y: 0.2 },
      tolerance: 0.5,
      modes: { perpendicular: true },
      nearby: [L(0, 0, 10, 0)],
      base: { x: 5, y: 10 },
    });
    expect(s?.kind).toBe("perpendicular");
    closeP(s!.p, 5, 0);
  });
});

describe("formas", () => {
  it("retângulo e polígono", () => {
    expect(rectanglePoints({ x: 10, y: 10 }, { x: 0, y: 0 })[0]).toEqual({ x: 0, y: 0 });
    const hex = regularPolygon({ x: 0, y: 0 }, 6, 10, 0, "inscribed");
    close(hex[1].x, 5);
    const sq = regularPolygon({ x: 0, y: 0 }, 4, 5, 0, "circumscribed");
    close(Math.abs(sq[0].x), 5);
  });
  it("arco por 3 pontos", () => {
    const a = arcFrom3Points({ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 })!;
    closeP(a.c, 0, 0);
    close(a.r, 10);
    close(a.a0, 0);
    close(a.a1, Math.PI);
  });
  it("autointerseção detectada", () => {
    const bow = P([[0, 0], [10, 10], [10, 0], [0, 10]], true);
    expect(selfIntersections(polylineSegs(bow), true).length).toBeGreaterThan(0);
    const sq = P([[0, 0], [10, 0], [10, 10], [0, 10]], true);
    expect(selfIntersections(polylineSegs(sq), true)).toHaveLength(0);
  });
});

describe("cotas", () => {
  const dim = (kind: "aligned" | "linear", rot = 0) =>
    makeEntity(
      {
        type: "dimension",
        kind,
        p1: { x: 0, y: 0 },
        p2: { x: 30, y: 40 },
        loc: { x: 0, y: -10 },
        rot,
        textOverride: null,
        assoc: null,
      },
      "COTAS",
    );
  it("alinhada mede a distância real", () => {
    close(dimensionValue(dim("aligned")), 50);
  });
  it("linear horizontal/vertical", () => {
    close(dimensionValue(dim("linear", 0)), 30);
    close(dimensionValue(dim("linear", Math.PI / 2)), 40);
  });
  it("texto formatado com vírgula e precisão", () => {
    const g = dimensionGeometry(dim("aligned"));
    expect(g.text.value).toBe("50,00");
    expect(formatNumber(174.59734, 3, ",")).toBe("174,597");
  });
});
