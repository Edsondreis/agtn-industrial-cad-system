import { OcctSolidKernel, type SolidRef, type StepNode } from "@agtn/solid";

let k: OcctSolidKernel;
beforeAll(async () => {
  k = await OcctSolidKernel.create();
});
afterAll(() => k.dispose());

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const T = (x: number, y: number, z: number) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];

/** Índice da face cujo centro está mais perto de p (busca pela geometria real). */
function faceAt(ref: SolidRef, p: { x: number; y: number; z: number }): number {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < k.count(ref, "face"); i++) {
    const f = k.info(ref, "face", i);
    if (f.kind !== "face") continue;
    const d = Math.hypot(f.center.x - p.x, f.center.y - p.y, f.center.z - p.z);
    if (d < bd) [bd, best] = [d, i];
  }
  return best;
}

describe("identificação topológica (mesma ordem da malha)", () => {
  it("as faixas da malha correspondem às faces reais do OCCT na mesma ordem", () => {
    const plate = k.cut(k.primitive({ kind: "box", w: 100, d: 60, h: 10 }), k.primitive({ kind: "cylinder", r: 8, h: 10 }, { origin: { x: 50, y: 30, z: 0 }, rot: { x: 0, y: 0, z: 0 } }));
    const mesh = k.mesh(plate);
    expect(mesh.faces.length).toBe(k.count(plate, "face"));
    // para cada faixa, os triângulos estão sobre a superfície da face de mesmo índice
    mesh.faces.forEach((range, i) => {
      const info = k.info(plate, "face", i);
      if (info.kind !== "face") throw new Error();
      const t = range.start + Math.floor(range.count / 2);
      const vi = mesh.indices[t * 3];
      const p = { x: mesh.positions[vi * 3], y: mesh.positions[vi * 3 + 1], z: mesh.positions[vi * 3 + 2] };
      if (info.surface === "plane" && info.normal) {
        const n = info.normal;
        const off = (p.x - info.center.x) * n.x + (p.y - info.center.y) * n.y + (p.z - info.center.z) * n.z;
        expect(Math.abs(off)).toBeLessThan(1e-4);
      } else if (info.surface === "cylinder") {
        expect(Math.hypot(p.x - 50, p.y - 30)).toBeCloseTo(8, 2);
      }
    });
    const e = k.edges(plate);
    expect(e.edges.length).toBe(k.count(plate, "edge"));
    k.release(plate);
  });

  it("face plana: área, normal; face cilíndrica: raio e eixo exatos", () => {
    const plate = k.cut(k.primitive({ kind: "box", w: 100, d: 60, h: 10 }), k.primitive({ kind: "cylinder", r: 8, h: 10 }, { origin: { x: 50, y: 30, z: 0 }, rot: { x: 0, y: 0, z: 0 } }));
    const top = k.info(plate, "face", faceAt(plate, { x: 50, y: 30, z: 10 }));
    expect(top.kind === "face" && top.surface).toBe("plane");
    if (top.kind !== "face") throw new Error();
    expect(top.area).toBeCloseTo(6000 - Math.PI * 64, 9);
    expect(Math.abs(top.normal!.z)).toBeCloseTo(1, 12);
    const holeIdx = [...Array(k.count(plate, "face")).keys()].find((i) => {
      const f = k.info(plate, "face", i);
      return f.kind === "face" && f.surface === "cylinder";
    })!;
    const hole = k.info(plate, "face", holeIdx);
    if (hole.kind !== "face") throw new Error();
    expect(hole.radius).toBeCloseTo(8, 12);
    expect(Math.abs(hole.axis!.z)).toBeCloseTo(1, 12);
    expect(hole.area).toBeCloseTo(2 * Math.PI * 8 * 10, 9);
    k.release(plate);
  });

  it("aresta reta e circular: comprimento, raio e extremidades exatos", () => {
    const cyl = k.primitive({ kind: "cylinder", r: 12.5, h: 40 });
    const lens = [...Array(k.count(cyl, "edge")).keys()].map((i) => k.info(cyl, "edge", i));
    const circ = lens.find((e) => e.kind === "edge" && e.curve === "circle");
    const line = lens.find((e) => e.kind === "edge" && e.curve === "line");
    if (circ?.kind !== "edge" || line?.kind !== "edge") throw new Error("arestas não encontradas");
    expect(circ.length).toBeCloseTo(2 * Math.PI * 12.5, 10);
    expect(circ.radius).toBeCloseTo(12.5, 12);
    expect(circ.closed).toBe(true);
    expect(line.length).toBeCloseTo(40, 10);
    k.release(cyl);
  });

  it("vértices de uma caixa posicionada", () => {
    const b = k.primitive({ kind: "box", w: 10, d: 20, h: 30 }, { origin: { x: 5, y: 5, z: 5 }, rot: { x: 0, y: 0, z: 0 } });
    const v = k.vertexPoints(b);
    expect(v.length).toBe(8 * 3);
    const xs = new Set<number>();
    for (let i = 0; i < 8; i++) xs.add(v[i * 3]);
    expect([...xs].sort((a, c) => a - c)).toEqual([5, 15]);
    expect(() => k.info(b, "face", 99)).toThrow(/não existe/);
    k.release(b);
  });
});

describe("medição exata", () => {
  it("vértice × vértice: distância e ΔX/ΔY/ΔZ (diagonal da caixa)", () => {
    const b = k.primitive({ kind: "box", w: 30, d: 40, h: 120 });
    const v = k.vertexPoints(b);
    let i0 = -1;
    let i1 = -1;
    for (let i = 0; i < 8; i++) {
      const [x, y, z] = [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
      if (x === 0 && y === 0 && z === 0) i0 = i;
      if (x === 30 && y === 40 && z === 120) i1 = i;
    }
    const m = k.measure({ ref: b, kind: "vertex", index: i0 }, { ref: b, kind: "vertex", index: i1 });
    expect(m.distance).toBeCloseTo(130, 10);
    expect(m.delta).toEqual({ x: 30, y: 40, z: 120 });
    k.release(b);
  });

  it("faces paralelas de dois sólidos: distância, ângulo 0° e folga entre planos", () => {
    const a = k.primitive({ kind: "box", w: 50, d: 50, h: 10 });
    const b = k.primitive({ kind: "box", w: 50, d: 50, h: 10 }, { origin: { x: 0, y: 0, z: 37.25 }, rot: { x: 0, y: 0, z: 0 } });
    const fa = faceAt(a, { x: 25, y: 25, z: 10 });
    const fb = faceAt(b, { x: 25, y: 25, z: 37.25 });
    const m = k.measure({ ref: a, kind: "face", index: fa }, { ref: b, kind: "face", index: fb });
    expect(m.distance).toBeCloseTo(27.25, 9);
    expect(m.angle).toBeCloseTo(0, 9);
    expect(m.planeGap).toBeCloseTo(27.25, 9);
    const solids = k.measure({ ref: a, kind: "solid", index: 0 }, { ref: b, kind: "solid", index: 0 });
    expect(solids.distance).toBeCloseTo(27.25, 9);
    k.release(a);
    k.release(b);
  });

  it("vértice × face: ponto projetado exato", () => {
    const a = k.primitive({ kind: "box", w: 100, d: 100, h: 5 });
    const c = k.primitive({ kind: "box", w: 1, d: 1, h: 1 }, { origin: { x: 20, y: 30, z: 45 }, rot: { x: 0, y: 0, z: 0 } });
    const v = k.vertexPoints(c);
    let vi = 0;
    for (let i = 0; i < 8; i++) if (v[i * 3] === 20 && v[i * 3 + 1] === 30 && v[i * 3 + 2] === 45) vi = i;
    const top = faceAt(a, { x: 50, y: 50, z: 5 });
    const m = k.measure({ ref: c, kind: "vertex", index: vi }, { ref: a, kind: "face", index: top });
    expect(m.distance).toBeCloseTo(40, 10);
    expect(m.pb!.z).toBeCloseTo(5, 10);
    expect(m.pb!.x).toBeCloseTo(20, 10);
    k.release(a);
    k.release(c);
  });

  it("faces perpendiculares: 90°", () => {
    const a = k.primitive({ kind: "box", w: 50, d: 50, h: 50 });
    const m = k.measure({ ref: a, kind: "face", index: faceAt(a, { x: 25, y: 25, z: 50 }) }, { ref: a, kind: "face", index: faceAt(a, { x: 0, y: 25, z: 25 }) });
    expect(m.angle).toBeCloseTo(90, 9);
    expect(m.distance).toBeCloseTo(0, 9);
    k.release(a);
  });
});

describe("STEP com estrutura de montagem", () => {
  it("exporta conjunto com nomes e posições e reimporta a mesma árvore", () => {
    const base = k.primitive({ kind: "box", w: 400, d: 200, h: 12 });
    const col = k.primitive({ kind: "profile", length: 800, profile: { shape: "RHS", b: 50, h: 50, t: 3 } });
    const nodes: StepNode[] = [
      { name: "CHAPA_BASE", matrix: I, brep: k.toBrep(base) },
      { name: "COLUNA_1", matrix: T(20, 20, 12), brep: k.toBrep(col) },
      { name: "COLUNA_2", matrix: T(330, 20, 12), brep: k.toBrep(col) },
    ];
    const step = k.exportStepTree(nodes);
    expect(step).toMatch(/CHAPA_BASE/);
    const back = k.importStepTree(step);
    // raiz única = conjunto com 3 componentes
    const flat: { name: string; vol: number; z: number }[] = [];
    const walk = (n: StepNode, parent: number[]) => {
      const m = compose(parent, [...n.matrix]);
      if (n.brep) {
        const s = k.fromBrep(n.brep);
        const placed = k.transform(s, m);
        const p = k.props(placed);
        flat.push({ name: n.name, vol: p.volume, z: p.bbox.min.z });
        k.release(s);
        k.release(placed);
      }
      for (const c of n.children ?? []) walk(c, m);
    };
    for (const r of back) walk(r, I);
    expect(flat.map((f) => f.name).sort()).toEqual(["CHAPA_BASE", "COLUNA_1", "COLUNA_2"]);
    const colVol = k.props(col).volume;
    expect(flat.find((f) => f.name === "COLUNA_2")!.vol).toBeCloseTo(colVol, 6);
    expect(flat.find((f) => f.name === "COLUNA_1")!.z).toBeCloseTo(12, 9);
    k.release(base);
    k.release(col);
  });

  it("STL binário de um cilindro", () => {
    const c = k.primitive({ kind: "cylinder", r: 10, h: 10 });
    const stl = k.toStl(c);
    const tris = new DataView(stl.buffer, stl.byteOffset).getUint32(80, true);
    expect(stl.length).toBe(84 + tris * 50);
    k.release(c);
  });
});

function compose(a: number[], b: number[]): number[] {
  const r = new Array<number>(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) r[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j];
    r[i * 4 + 3] = a[i * 4] * b[3] + a[i * 4 + 1] * b[7] + a[i * 4 + 2] * b[11] + a[i * 4 + 3];
  }
  return r;
}
