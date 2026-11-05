import {
  type DimensionEntity,
  type Entity,
  type Vec2,
  TAU,
  entityBox,
  entityLength,
  makeEntity,
  polylineSignedArea,
  tangentPoints,
  normAngle,
} from "@agtn/geometry";

/**
 * BIBLIOTECA DE CHAPAS — peças paramétricas prontas para corte (laser/plasma).
 * Cada peça gera contornos reais (polilinhas com arcos e círculos) na camada CONTORNO_CORTE,
 * marcas de centro em CENTROS, cotas em COTAS e, quando aplicável, marcações em MARCACAO.
 * Unidades em mm. Sem compensação de kerf (ajustada no CAM).
 */
export type ParamKind = "len" | "count" | "angle";

export interface ParamDef {
  key: string;
  label: string;
  kind: ParamKind;
  def: number;
  min?: number;
  hint?: string;
}

export interface PartIssue {
  level: "error" | "warning";
  message: string;
}

export interface PartResult {
  ok: boolean;
  issues: PartIssue[];
  entities: Entity[];
  /** área líquida (mm²) */
  area: number;
  /** comprimento total de corte (mm) */
  cutLength: number;
  /** nº de furos/recortes internos */
  pierces: number;
  width: number;
  height: number;
}

export interface PartDef {
  id: string;
  name: string;
  category: "Discos e flanges" | "Chapas e bases" | "Suportes e reforços" | "Caldeiraria";
  description: string;
  params: ParamDef[];
  build: (p: Record<string, number>) => Omit<PartResult, "area" | "cutLength" | "pierces" | "width" | "height"> & { outer: Entity | null; holes: Entity[] };
}

const q90 = Math.tan(Math.PI / 8);
const cut = "CONTORNO_CORTE";

const circle = (c: Vec2, r: number): Entity => makeEntity({ type: "circle", c, r }, cut);
const centerMark = (c: Vec2, s: number): Entity[] => [
  makeEntity({ type: "line", a: { x: c.x - s, y: c.y }, b: { x: c.x + s, y: c.y } }, "CENTROS"),
  makeEntity({ type: "line", a: { x: c.x, y: c.y - s }, b: { x: c.x, y: c.y + s } }, "CENTROS"),
];
const dim = (kind: DimensionEntity["kind"], p1: Vec2, p2: Vec2, loc: Vec2, rot = 0, text: string | null = null, scale = 1): Entity =>
  makeEntity({ type: "dimension", kind, p1, p2, loc, rot, textOverride: text, dimScale: scale, assoc: null }, "COTAS");

/** Polilinha retangular com cantos arredondados (r = 0 → cantos vivos). Origem no canto inferior esquerdo. */
export function roundedRectPoly(w: number, h: number, r: number, o: Vec2 = { x: 0, y: 0 }): Entity {
  if (r <= 1e-9)
    return makeEntity(
      { type: "polyline", pts: [o, { x: o.x + w, y: o.y }, { x: o.x + w, y: o.y + h }, { x: o.x, y: o.y + h }], bulges: [0, 0, 0, 0], closed: true },
      cut,
    );
  const P = (x: number, y: number) => ({ x: o.x + x, y: o.y + y });
  return makeEntity(
    {
      type: "polyline",
      pts: [P(r, 0), P(w - r, 0), P(w, r), P(w, h - r), P(w - r, h), P(r, h), P(0, h - r), P(0, r)],
      bulges: [0, q90, 0, q90, 0, q90, 0, q90],
      closed: true,
    },
    cut,
  );
}

/** Furo oblongo (rasgo) com centro c, comprimento total L, largura w, horizontal. */
export function slotPoly(c: Vec2, L: number, w: number, rot = 0): Entity {
  const r = w / 2;
  const a = Math.max(0, L / 2 - r);
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const T = (x: number, y: number) => ({ x: c.x + x * cs - y * sn, y: c.y + x * sn + y * cs });
  if (a < 1e-9) return circle(c, r);
  return makeEntity({ type: "polyline", pts: [T(-a, -r), T(a, -r), T(a, r), T(-a, r)], bulges: [0, 1, 0, 1], closed: true }, cut);
}

const autoScale = (size: number) => Math.max(1, Math.ceil(size / 45 / 2.5));

/* ------------------------------------------------------------------------------------------ */

const flange: PartDef = {
  id: "flange",
  name: "Flange (furação em círculo)",
  category: "Discos e flanges",
  description: "Disco com furo central e furos distribuídos no círculo de furação (PCD). Ø interno 0 = flange cego.",
  params: [
    { key: "De", label: "Ø externo", kind: "len", def: 300, min: 1 },
    { key: "Di", label: "Ø interno (0 = cego)", kind: "len", def: 160, min: 0 },
    { key: "pcd", label: "Ø círculo de furação", kind: "len", def: 240, min: 0 },
    { key: "n", label: "Nº de furos", kind: "count", def: 8, min: 0 },
    { key: "dh", label: "Ø dos furos", kind: "len", def: 18, min: 0 },
    { key: "a0", label: "Ângulo do 1º furo", kind: "angle", def: 22.5, hint: "0° = eixo X; 22,5° deixa os furos fora dos eixos em flange de 8 furos" },
  ],
  build: (p) => {
    const issues: PartIssue[] = [];
    const c = { x: 0, y: 0 };
    if (p.Di >= p.De) issues.push({ level: "error", message: "Ø interno deve ser menor que o externo." });
    if (p.n > 0) {
      if (p.dh <= 0) issues.push({ level: "error", message: "Ø dos furos deve ser maior que zero." });
      if (p.pcd / 2 + p.dh / 2 >= p.De / 2) issues.push({ level: "error", message: "Furos ultrapassam o Ø externo." });
      if (p.Di > 0 && p.pcd / 2 - p.dh / 2 <= p.Di / 2) issues.push({ level: "error", message: "Furos invadem o furo central." });
      const pitch = (Math.PI * p.pcd) / p.n;
      if (p.n > 1 && pitch <= p.dh) issues.push({ level: "error", message: "Furos se sobrepõem no círculo de furação." });
      const lig = Math.min(p.De / 2 - p.pcd / 2 - p.dh / 2, p.Di > 0 ? p.pcd / 2 - p.dh / 2 - p.Di / 2 : Infinity, p.n > 1 ? pitch - p.dh : Infinity);
      if (lig > 0 && lig < p.dh * 0.5) issues.push({ level: "warning", message: `Material entre furos/bordas de ${lig.toFixed(1)} mm — pequeno.` });
    }
    if (issues.some((i) => i.level === "error")) return { ok: false, issues, entities: [], outer: null, holes: [] };
    const outer = circle(c, p.De / 2);
    const holes: Entity[] = [];
    if (p.Di > 0) holes.push(circle(c, p.Di / 2));
    for (let i = 0; i < p.n; i++) {
      const a = (p.a0 * Math.PI) / 180 + (i * TAU) / p.n;
      const hc = { x: (Math.cos(a) * p.pcd) / 2, y: (Math.sin(a) * p.pcd) / 2 };
      holes.push(circle(hc, p.dh / 2));
    }
    const sc = autoScale(p.De);
    const ents: Entity[] = [outer, ...holes, ...centerMark(c, p.De * 0.55)];
    if (p.n > 0) ents.push(makeEntity({ type: "circle", c, r: p.pcd / 2 }, "CENTROS"));
    ents.push(
      dim("diameter", c, { x: (p.De / 2) * Math.cos(Math.PI / 4), y: (p.De / 2) * Math.sin(Math.PI / 4) }, { x: p.De * 0.45, y: p.De * 0.45 }, 0, null, sc),
    );
    if (p.n > 0)
      ents.push(
        dim("diameter", c, { x: (-p.pcd / 2) * Math.cos(Math.PI / 4), y: (p.pcd / 2) * Math.sin(Math.PI / 4) }, { x: -p.De * 0.5, y: p.De * 0.5 }, 0, "PCD <>", sc),
        makeEntity({ type: "text", p: { x: 0, y: -p.De / 2 - 12 * sc }, h: 3 * sc, rot: 0, value: `${p.n} FUROS Ø${p.dh.toString().replace(".", ",")}`, halign: 1 }, "ANOTACOES"),
      );
    return { ok: true, issues, entities: ents, outer, holes };
  },
};

const washer: PartDef = {
  id: "bolacha",
  name: "Bolacha / arruela (disco com furo)",
  category: "Discos e flanges",
  description: "Disco com furo concêntrico. Ø interno 0 = disco cheio.",
  params: [
    { key: "De", label: "Ø externo", kind: "len", def: 100, min: 1 },
    { key: "Di", label: "Ø interno (0 = disco)", kind: "len", def: 40, min: 0 },
  ],
  build: (p) => {
    if (p.Di >= p.De) return { ok: false, issues: [{ level: "error", message: "Ø interno deve ser menor que o externo." }], entities: [], outer: null, holes: [] };
    const c = { x: 0, y: 0 };
    const outer = circle(c, p.De / 2);
    const holes = p.Di > 0 ? [circle(c, p.Di / 2)] : [];
    const sc = autoScale(p.De);
    const issues: PartIssue[] = [];
    if (p.Di > 0 && (p.De - p.Di) / 2 < 3) issues.push({ level: "warning", message: "Anel muito estreito (< 3 mm)." });
    return {
      ok: true,
      issues,
      outer,
      holes,
      entities: [
        outer,
        ...holes,
        ...centerMark(c, p.De * 0.55),
        dim("diameter", c, { x: p.De / 2 / Math.SQRT2, y: p.De / 2 / Math.SQRT2 }, { x: p.De * 0.45, y: p.De * 0.45 }, 0, null, sc),
        ...(p.Di > 0 ? [dim("diameter", c, { x: -p.Di / 2 / Math.SQRT2, y: -p.Di / 2 / Math.SQRT2 }, { x: -p.De * 0.45, y: -p.De * 0.45 }, 0, null, sc)] : []),
      ],
    };
  },
};

const ringSector: PartDef = {
  id: "setor",
  name: "Setor de anel (flange segmentado)",
  category: "Discos e flanges",
  description: "Segmento de anel para flanges grandes cortados em partes.",
  params: [
    { key: "De", label: "Ø externo", kind: "len", def: 1200, min: 1 },
    { key: "Di", label: "Ø interno", kind: "len", def: 1000, min: 1 },
    { key: "ang", label: "Ângulo do setor", kind: "angle", def: 90, min: 1 },
  ],
  build: (p) => {
    if (p.Di >= p.De || p.ang <= 0 || p.ang >= 360)
      return { ok: false, issues: [{ level: "error", message: "Exige Ø interno < Ø externo e 0° < ângulo < 360°." }], entities: [], outer: null, holes: [] };
    const th = (p.ang * Math.PI) / 180;
    const a0 = Math.PI / 2 - th / 2;
    const a1 = Math.PI / 2 + th / 2;
    const Re = p.De / 2;
    const Ri = p.Di / 2;
    const pt = (R: number, a: number) => ({ x: Math.cos(a) * R, y: Math.sin(a) * R });
    const qq = Math.tan(th / 4);
    const outer = makeEntity({ type: "polyline", pts: [pt(Re, a0), pt(Re, a1), pt(Ri, a1), pt(Ri, a0)], bulges: [qq, 0, -qq, 0], closed: true }, cut);
    const sc = autoScale(p.De * Math.sin(Math.min(th, Math.PI) / 2));
    return {
      ok: true,
      issues: [],
      outer,
      holes: [],
      entities: [
        outer,
        dim("radius", { x: 0, y: 0 }, pt(Re, Math.PI / 2), pt(Re * 1.05, Math.PI / 2), 0, null, sc),
        makeEntity({ type: "text", p: pt((Re + Ri) / 2, Math.PI / 2), h: 3 * sc, rot: 0, value: `SETOR ${p.ang}° — ØE ${p.De} / ØI ${p.Di}`, halign: 1 }, "ANOTACOES"),
      ],
    };
  },
};

const basePlate: PartDef = {
  id: "chapa-base",
  name: "Chapa retangular / chapa de base",
  category: "Chapas e bases",
  description: "Retângulo com raio de canto, furos nos cantos e furo central opcionais.",
  params: [
    { key: "W", label: "Largura", kind: "len", def: 300, min: 1 },
    { key: "H", label: "Altura", kind: "len", def: 200, min: 1 },
    { key: "r", label: "Raio de canto", kind: "len", def: 10, min: 0 },
    { key: "dh", label: "Ø furos de canto (0 = sem)", kind: "len", def: 18, min: 0 },
    { key: "ex", label: "Distância do furo à borda X", kind: "len", def: 30, min: 0 },
    { key: "ey", label: "Distância do furo à borda Y", kind: "len", def: 30, min: 0 },
    { key: "dc", label: "Ø furo central (0 = sem)", kind: "len", def: 0, min: 0 },
  ],
  build: (p) => {
    const issues: PartIssue[] = [];
    if (p.r * 2 > Math.min(p.W, p.H)) issues.push({ level: "error", message: "Raio de canto maior que metade do menor lado." });
    if (p.dh > 0) {
      if (p.ex - p.dh / 2 <= 0 || p.ey - p.dh / 2 <= 0) issues.push({ level: "error", message: "Furos de canto ultrapassam a borda." });
      if (p.W - 2 * p.ex <= p.dh || p.H - 2 * p.ey <= p.dh) issues.push({ level: "error", message: "Furos de canto se sobrepõem." });
      if (p.ex - p.dh / 2 < p.dh * 0.5 || p.ey - p.dh / 2 < p.dh * 0.5) issues.push({ level: "warning", message: "Furo muito próximo da borda (< 0,5 × Ø)." });
    }
    if (p.dc > 0 && (p.dc >= Math.min(p.W, p.H))) issues.push({ level: "error", message: "Furo central maior que a chapa." });
    if (issues.some((i) => i.level === "error")) return { ok: false, issues, entities: [], outer: null, holes: [] };
    const outer = roundedRectPoly(p.W, p.H, p.r);
    const holes: Entity[] = [];
    const marks: Entity[] = [];
    if (p.dh > 0)
      for (const [x, y] of [
        [p.ex, p.ey],
        [p.W - p.ex, p.ey],
        [p.W - p.ex, p.H - p.ey],
        [p.ex, p.H - p.ey],
      ]) {
        holes.push(circle({ x, y }, p.dh / 2));
        marks.push(...centerMark({ x, y }, p.dh * 0.8));
      }
    if (p.dc > 0) {
      holes.push(circle({ x: p.W / 2, y: p.H / 2 }, p.dc / 2));
      marks.push(...centerMark({ x: p.W / 2, y: p.H / 2 }, p.dc * 0.7));
    }
    const sc = autoScale(Math.max(p.W, p.H));
    const g = 10 * sc;
    const ents = [outer, ...holes, ...marks, dim("linear", { x: 0, y: 0 }, { x: p.W, y: 0 }, { x: 0, y: -g }, 0, null, sc), dim("linear", { x: p.W, y: 0 }, { x: p.W, y: p.H }, { x: p.W + g, y: 0 }, Math.PI / 2, null, sc)];
    if (p.dh > 0)
      ents.push(
        dim("linear", { x: 0, y: p.H }, { x: p.ex, y: p.H - p.ey }, { x: 0, y: p.H + g }, 0, null, sc),
        dim("linear", { x: 0, y: p.H }, { x: p.ex, y: p.H - p.ey }, { x: -g, y: 0 }, Math.PI / 2, null, sc),
        makeEntity({ type: "text", p: { x: p.W / 2, y: -g * 2.2 }, h: 3 * sc, rot: 0, value: `4 FUROS Ø${String(p.dh).replace(".", ",")}`, halign: 1 }, "ANOTACOES"),
      );
    return { ok: true, issues, entities: ents, outer, holes };
  },
};

const slotPlate: PartDef = {
  id: "chapa-oblongo",
  name: "Chapa com furos oblongos (rasgos)",
  category: "Chapas e bases",
  description: "Chapa retangular com rasgos oblongos horizontais distribuídos (ajuste de montagem).",
  params: [
    { key: "W", label: "Largura", kind: "len", def: 250, min: 1 },
    { key: "H", label: "Altura", kind: "len", def: 120, min: 1 },
    { key: "r", label: "Raio de canto", kind: "len", def: 5, min: 0 },
    { key: "n", label: "Nº de rasgos", kind: "count", def: 2, min: 1 },
    { key: "L", label: "Comprimento do rasgo", kind: "len", def: 40, min: 1 },
    { key: "w", label: "Largura do rasgo", kind: "len", def: 14, min: 0.5 },
    { key: "e", label: "Distância do centro à borda X", kind: "len", def: 45, min: 0 },
  ],
  build: (p) => {
    const issues: PartIssue[] = [];
    if (p.w > p.L) issues.push({ level: "error", message: "Largura do rasgo maior que o comprimento." });
    if (p.e - p.L / 2 <= 0) issues.push({ level: "error", message: "Rasgo ultrapassa a borda." });
    if (p.w >= p.H) issues.push({ level: "error", message: "Rasgo mais largo que a chapa." });
    const n = Math.max(1, Math.round(p.n));
    const xs = n === 1 ? [p.W / 2] : Array.from({ length: n }, (_, i) => p.e + ((p.W - 2 * p.e) * i) / (n - 1));
    for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] <= p.L) issues.push({ level: "error", message: "Rasgos se sobrepõem." });
    if (p.r * 2 > Math.min(p.W, p.H)) issues.push({ level: "error", message: "Raio de canto grande demais." });
    if (issues.some((i) => i.level === "error")) return { ok: false, issues, entities: [], outer: null, holes: [] };
    const outer = roundedRectPoly(p.W, p.H, p.r);
    const holes = xs.map((x) => slotPoly({ x, y: p.H / 2 }, p.L, p.w));
    const sc = autoScale(p.W);
    const g = 10 * sc;
    return {
      ok: true,
      issues,
      outer,
      holes,
      entities: [
        outer,
        ...holes,
        ...xs.flatMap((x) => centerMark({ x, y: p.H / 2 }, p.L * 0.6)),
        dim("linear", { x: 0, y: 0 }, { x: p.W, y: 0 }, { x: 0, y: -g }, 0, null, sc),
        dim("linear", { x: p.W, y: 0 }, { x: p.W, y: p.H }, { x: p.W + g, y: 0 }, Math.PI / 2, null, sc),
        makeEntity({ type: "text", p: { x: p.W / 2, y: -g * 2.2 }, h: 3 * sc, rot: 0, value: `${n} RASGOS ${p.L}x${p.w}`.replace(/\./g, ","), halign: 1 }, "ANOTACOES"),
      ],
    };
  },
};

const polygonPlate: PartDef = {
  id: "poligono",
  name: "Polígono regular (sextavado...) com furo",
  category: "Chapas e bases",
  description: "Polígono regular definido pela medida entre faces, com furo central opcional.",
  params: [
    { key: "n", label: "Nº de lados", kind: "count", def: 6, min: 3 },
    { key: "s", label: "Medida entre faces", kind: "len", def: 100, min: 1 },
    { key: "dc", label: "Ø furo central (0 = sem)", kind: "len", def: 30, min: 0 },
  ],
  build: (p) => {
    const n = Math.round(p.n);
    if (n < 3 || n > 64) return { ok: false, issues: [{ level: "error", message: "Nº de lados entre 3 e 64." }], entities: [], outer: null, holes: [] };
    const apothem = p.s / 2;
    const R = apothem / Math.cos(Math.PI / n);
    if (p.dc >= p.s) return { ok: false, issues: [{ level: "error", message: "Furo maior que a peça." }], entities: [], outer: null, holes: [] };
    const pts = Array.from({ length: n }, (_, i) => {
      const a = Math.PI / 2 + Math.PI / n + (i * TAU) / n;
      return { x: Math.cos(a) * R, y: Math.sin(a) * R };
    });
    const outer = makeEntity({ type: "polyline", pts, bulges: pts.map(() => 0), closed: true }, cut);
    const holes = p.dc > 0 ? [circle({ x: 0, y: 0 }, p.dc / 2)] : [];
    const sc = autoScale(p.s);
    return {
      ok: true,
      issues: [],
      outer,
      holes,
      entities: [outer, ...holes, ...centerMark({ x: 0, y: 0 }, R * 1.1), dim("linear", { x: -apothem, y: 0 }, { x: apothem, y: 0 }, { x: 0, y: -R - 10 * sc }, 0, null, sc)],
    };
  },
};

const gusset: PartDef = {
  id: "cartela",
  name: "Cartela / mão-francesa (reforço triangular)",
  category: "Suportes e reforços",
  description: "Reforço triangular com chanfro de solda no canto e pontas truncadas.",
  params: [
    { key: "b", label: "Base", kind: "len", def: 150, min: 1 },
    { key: "h", label: "Altura", kind: "len", def: 150, min: 1 },
    { key: "c", label: "Chanfro do canto (cordão)", kind: "len", def: 15, min: 0 },
    { key: "t", label: "Ponta truncada", kind: "len", def: 10, min: 0 },
    { key: "dh", label: "Ø furo de alívio (0 = sem)", kind: "len", def: 0, min: 0 },
  ],
  build: (p) => {
    const issues: PartIssue[] = [];
    if (p.c >= Math.min(p.b, p.h) * 0.5) issues.push({ level: "error", message: "Chanfro grande demais." });
    if (p.t >= Math.min(p.b, p.h) * 0.4) issues.push({ level: "error", message: "Ponta truncada grande demais." });
    if (issues.length) return { ok: false, issues, entities: [], outer: null, holes: [] };
    // triângulo retângulo com canto em (0,0); pontas truncadas perpendiculares aos catetos
    const tb = p.t * (p.h / p.b);
    const th = p.t * (p.b / p.h);
    // ordena: (c,0) → (b,0) → (b,tb) → (th,h) → (0,h) → (0,c)
    const ordered: Vec2[] = [p.c > 0 ? { x: p.c, y: 0 } : { x: 0, y: 0 }, { x: p.b, y: 0 }];
    if (p.t > 0) ordered.push({ x: p.b, y: tb }, { x: th, y: p.h }, { x: 0, y: p.h });
    else ordered.push({ x: 0, y: p.h });
    if (p.c > 0) ordered.push({ x: 0, y: p.c });
    const outer = makeEntity({ type: "polyline", pts: ordered, bulges: ordered.map(() => 0), closed: true }, cut);
    const holes: Entity[] = [];
    if (p.dh > 0) {
      // incentro do triângulo retângulo
      const hyp = Math.hypot(p.b, p.h);
      const rIn = (p.b + p.h - hyp) / 2;
      if (p.dh / 2 >= rIn * 0.7) issues.push({ level: "warning", message: "Furo de alívio grande para a cartela." });
      holes.push(circle({ x: rIn, y: rIn }, p.dh / 2));
    }
    const sc = autoScale(Math.max(p.b, p.h));
    const g = 10 * sc;
    return {
      ok: true,
      issues,
      outer,
      holes,
      entities: [outer, ...holes, dim("linear", { x: 0, y: 0 }, { x: p.b, y: 0 }, { x: 0, y: -g }, 0, null, sc), dim("linear", { x: 0, y: 0 }, { x: 0, y: p.h }, { x: -g, y: 0 }, Math.PI / 2, null, sc)],
    };
  },
};

const lug: PartDef = {
  id: "olhal",
  name: "Olhal de içamento",
  category: "Suportes e reforços",
  description: "Olhal com base reta, laterais tangentes ao arco superior e furo do manilha.",
  params: [
    { key: "B", label: "Largura da base", kind: "len", def: 120, min: 1 },
    { key: "Hc", label: "Altura até o centro do furo", kind: "len", def: 100, min: 1 },
    { key: "R", label: "Raio externo superior", kind: "len", def: 45, min: 1 },
    { key: "d", label: "Ø do furo", kind: "len", def: 35, min: 0 },
  ],
  build: (p) => {
    const issues: PartIssue[] = [];
    if (p.Hc <= p.R) issues.push({ level: "error", message: "Centro do furo deve ficar acima do raio (Hc > R)." });
    if (p.B / 2 < p.R) issues.push({ level: "error", message: "Base deve ser ≥ 2 × R." });
    if (p.d >= 2 * p.R) issues.push({ level: "error", message: "Furo maior que o olhal." });
    if (issues.length) return { ok: false, issues, entities: [], outer: null, holes: [] };
    if (p.R - p.d / 2 < p.d * 0.5) issues.push({ level: "warning", message: "Material acima do furo pequeno (< 0,5 × Ø): verifique a capacidade de carga com o projetista." });
    const C = { x: 0, y: p.Hc };
    const circ = makeEntity({ type: "circle", c: C, r: p.R }, "0");
    const right = { x: p.B / 2, y: 0 };
    const left = { x: -p.B / 2, y: 0 };
    // tangente externa: do lado direito, o ponto de tangência com maior x
    const tr = tangentPoints(circ, right).sort((a, b) => b.x - a.x)[0] ?? { x: p.R, y: p.Hc };
    const tl = { x: -tr.x, y: tr.y };
    const aR = Math.atan2(tr.y - C.y, tr.x - C.x);
    const aL = Math.atan2(tl.y - C.y, tl.x - C.x);
    const sweep = normAngle(aL - aR);
    const outer = makeEntity({ type: "polyline", pts: [left, right, tr, tl], bulges: [0, 0, Math.tan(sweep / 4), 0], closed: true }, cut);
    const holes = p.d > 0 ? [circle(C, p.d / 2)] : [];
    const sc = autoScale(Math.max(p.B, p.Hc + p.R));
    const g = 10 * sc;
    return {
      ok: true,
      issues,
      outer,
      holes,
      entities: [
        outer,
        ...holes,
        ...centerMark(C, p.R * 1.2),
        dim("linear", left, right, { x: 0, y: -g }, 0, null, sc),
        dim("linear", right, C, { x: p.B / 2 + g, y: 0 }, Math.PI / 2, null, sc),
        dim("radius", C, { x: C.x + p.R * Math.cos(Math.PI / 3), y: C.y + p.R * Math.sin(Math.PI / 3) }, { x: C.x + p.R * 1.3, y: C.y + p.R * 1.3 }, 0, null, sc),
      ],
    };
  },
};

const saddle: PartDef = {
  id: "boca-de-lobo",
  name: "Gabarito boca de lobo (tubo × tubo a 90°)",
  category: "Caldeiraria",
  description:
    "Gabarito planificado para traçar/cortar o tubo derivado que encaixa no principal a 90°, com excentricidade opcional. Enrolar no Ø externo do derivado com a borda reta para a ponta livre; 0° e 180° ficam alinhados ao eixo do tubo principal.",
  params: [
    { key: "D", label: "Ø externo do tubo principal", kind: "len", def: 168.3, min: 1 },
    { key: "d", label: "Ø externo do tubo derivado", kind: "len", def: 114.3, min: 1 },
    { key: "e", label: "Excentricidade (0 = centrado)", kind: "len", def: 0 },
    { key: "Lb", label: "Altura mínima do gabarito", kind: "len", def: 50, min: 1 },
  ],
  build: (p) => {
    const R = p.D / 2;
    const r = p.d / 2;
    if (r + Math.abs(p.e) > R + 1e-9)
      return { ok: false, issues: [{ level: "error", message: "O tubo derivado (com excentricidade) deve caber no principal: d/2 + |e| ≤ D/2." }], entities: [], outer: null, holes: [] };
    const N = 360;
    const zs: number[] = [];
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * TAU;
      const y = r * Math.sin(th) + p.e;
      zs.push(Math.sqrt(Math.max(0, R * R - y * y)));
    }
    const zmin = Math.min(...zs);
    const zmax = Math.max(...zs);
    const Ldev = TAU * r;
    // comprimento do derivado até a interseção: menor onde o tubo principal é mais alto (z máx)
    const top: Vec2[] = zs.map((z, i) => ({ x: (i / N) * Ldev, y: p.Lb + (zmax - z) }));
    const pts: Vec2[] = [{ x: 0, y: 0 }, { x: Ldev, y: 0 }, ...top.slice().reverse()];
    const outer = makeEntity({ type: "polyline", pts, bulges: pts.map(() => 0), closed: true }, cut);
    const marks: Entity[] = [];
    for (let k = 0; k <= 4; k++) {
      const x = (k / 4) * Ldev;
      marks.push(makeEntity({ type: "line", a: { x, y: 0 }, b: { x, y: p.Lb * 0.4 } }, "MARCACAO"));
      marks.push(makeEntity({ type: "text", p: { x: x + 2, y: p.Lb * 0.45 }, h: 4, rot: 0, value: `${k * 90}°`, halign: 0 }, "MARCACAO"));
    }
    const sc = autoScale(Ldev);
    const g = 10 * sc;
    const hmax = p.Lb + zmax - zmin;
    return {
      ok: true,
      issues: [{ level: "warning", message: "Gabarito pelo diâmetro EXTERNO do derivado; para chanfro de solda ajuste no tubo." }],
      outer,
      holes: [],
      entities: [
        outer,
        ...marks,
        dim("linear", { x: 0, y: 0 }, { x: Ldev, y: 0 }, { x: 0, y: -g }, 0, "<> (π·d)", sc),
        dim("linear", { x: 0, y: 0 }, { x: 0, y: hmax }, { x: -g, y: 0 }, Math.PI / 2, null, sc),
      ],
    };
  },
};

export const PARTS: readonly PartDef[] = [flange, washer, ringSector, basePlate, slotPlate, polygonPlate, gusset, lug, saddle];

export const partById = (id: string): PartDef => PARTS.find((p) => p.id === id) ?? PARTS[0];

export function defaultParams(def: PartDef): Record<string, number> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.def]));
}

/** Monta a peça e calcula área líquida, comprimento de corte e perfurações. */
export function buildPart(def: PartDef, params: Record<string, number>): PartResult {
  for (const pd of def.params) {
    const v = params[pd.key];
    if (!Number.isFinite(v)) return { ok: false, issues: [{ level: "error", message: `${pd.label}: valor inválido.` }], entities: [], area: 0, cutLength: 0, pierces: 0, width: 0, height: 0 };
    if (pd.min !== undefined && v < pd.min)
      return { ok: false, issues: [{ level: "error", message: `${pd.label}: mínimo ${pd.min}.` }], entities: [], area: 0, cutLength: 0, pierces: 0, width: 0, height: 0 };
  }
  const r = def.build(params);
  if (!r.ok || !r.outer) return { ok: false, issues: r.issues, entities: [], area: 0, cutLength: 0, pierces: 0, width: 0, height: 0 };
  const areaOf = (e: Entity) =>
    e.type === "circle" ? Math.PI * e.r * e.r : e.type === "polyline" ? Math.abs(polylineSignedArea(e.pts, e.bulges)) : 0;
  const area = areaOf(r.outer) - r.holes.reduce((s, h) => s + areaOf(h), 0);
  const cutLength = [r.outer, ...r.holes].reduce((s, e) => s + entityLength(e), 0);
  const bb = entityBox(r.outer);
  return { ok: true, issues: r.issues, entities: r.entities, area, cutLength, pierces: r.holes.length, width: bb.maxX - bb.minX, height: bb.maxY - bb.minY };
}
