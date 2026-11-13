import type { Loop2, SheetBaseSpec, SheetOp, SheetSpec } from "@agtn/sheetgraph";
import { aba, defaults, rectBase } from "../../../sheetmetal/src/sheet3d/testkit";

/**
 * FASE 4 · ETAPA 3 — 10 peças de REFERÊNCIA (I1).
 *
 * ATENÇÃO: são peças SINTÉTICAS, montadas com os recursos existentes para cobrir as famílias do §6.1. Não são
 * peças reais da AGTN e não têm desenho de engenharia por trás — a única exceção é a nº 3, que usa as medidas da
 * bandeja 710.0CUH25-01-03 (desenho real já usado na validação 2D da v3.1.0). A comparação com peças reais fica
 * na estrutura de `tests/industrial/pecas_reais/`.
 */
export interface RefPart {
  readonly n: number;
  readonly id: string;
  readonly nome: string;
  readonly familia: string;
  readonly real: boolean;
  readonly material: string;
  readonly spec: SheetSpec;
}

const rect = (x0: number, y0: number, x1: number, y1: number, key: string): Loop2 => ({
  key,
  segs: [
    { t: "line", a: { x: x0, y: y0 }, b: { x: x1, y: y0 } },
    { t: "line", a: { x: x1, y: y0 }, b: { x: x1, y: y1 } },
    { t: "line", a: { x: x1, y: y1 }, b: { x: x0, y: y1 } },
    { t: "line", a: { x: x0, y: y1 }, b: { x: x0, y: y0 } },
  ],
});
const circle = (x: number, y: number, r: number, key: string): Loop2 => ({ key, segs: [{ t: "circle", c: { x, y }, r }] });
/** oblongo horizontal centrado em (cx, cy), comprimento total L, largura w */
const slot = (cx: number, cy: number, L: number, w: number, key: string): Loop2 => {
  const r = w / 2;
  const a = cx - L / 2 + r;
  const b = cx + L / 2 - r;
  return {
    key,
    segs: [
      { t: "line", a: { x: a, y: cy - r }, b: { x: b, y: cy - r } },
      { t: "arc", c: { x: b, y: cy }, r, a: { x: b, y: cy - r }, b: { x: b, y: cy + r }, sweep: Math.PI },
      { t: "line", a: { x: b, y: cy + r }, b: { x: a, y: cy + r } },
      { t: "arc", c: { x: a, y: cy }, r, a: { x: a, y: cy + r }, b: { x: a, y: cy - r }, sweep: Math.PI },
    ],
  };
};
const withHoles = (b: SheetBaseSpec, holes: Loop2[]): SheetBaseSpec => ({ ...b, holes });
const IDS = ["S@B/L1+L@B/L2", "L@B/L2+N@B/L3", "N@B/L3+O@B/L4", "O@B/L4+S@B/L1"];
const four = (H: number, o: Parameters<typeof aba>[4] = {}): SheetOp[] => [aba("S", [["B", "L1"]], H, 90, o), aba("L", [["B", "L2"]], H, 90, o), aba("N", [["B", "L3"]], H, 90, o), aba("O", [["B", "L4"]], H, 90, o)];
const corners = (kind: "sobreposto" | "encosto" | "esquadria", gap: number, closerA = true): SheetOp[] =>
  IDS.map((id, i): SheetOp => ({ t: "canto", id: `C${i}`, label: `Canto_${i + 1}`, corners: [id], kind, gap, closer: (i % 2 === 0) === closerA ? "a" : "b" }));

export const REF_PARTS: readonly RefPart[] = [
  {
    n: 1,
    id: "01_chapa_furos",
    nome: "Chapa plana 300 × 200 × 3 com 4 furos Ø10, 1 oblongo 40 × 12 e 1 janela 60 × 30",
    familia: "chapa plana com furos",
    real: false,
    material: "aço carbono",
    spec: { base: withHoles(rectBase(300, 200, { T: 3, R: 3, K: 0.43 }), [circle(20, 20, 5, "f1"), circle(280, 20, 5, "f2"), circle(280, 180, 5, "f3"), circle(20, 180, 5, "f4"), slot(150, 50, 40, 12, "ob"), rect(120, 110, 180, 140, "jan")]), ops: [] },
  },
  {
    n: 2,
    id: "02_caixa_dobrada",
    nome: "Caixa 400 × 300 × 50, T 2, cantos encosto g 0,5",
    familia: "caixa dobrada",
    real: false,
    material: "aço carbono",
    spec: { base: rectBase(400, 300, { T: 2, R: 2, K: 0.43 }), ops: [...four(50), ...corners("encosto", 0.5)] },
  },
  {
    n: 3,
    id: "03_bandeja_710CUH25",
    nome: "Bandeja 535 × 520, abas 25,4, T 3,18, R 2, K 0,33, canto sobreposto sem folga, fecham S/N (710.0CUH25-01-03)",
    familia: "bandeja com abas",
    real: true,
    material: "aço carbono",
    spec: { base: rectBase(535, 520, { T: 3.18, R: 2, K: 0.33 }), ops: [...four(25.4), ...corners("sobreposto", 0)] },
  },
  {
    n: 4,
    id: "04_tampa_dobras_laterais",
    nome: "Tampa 600 × 250, T 1,5, abas 30 nas laterais longas com pestana 10 para dentro (recuos 15)",
    familia: "tampa com dobras laterais",
    real: false,
    material: "galvanizado",
    spec: {
      base: rectBase(600, 250, { T: 1.5, R: 1.5, K: 0.43 }),
      ops: [aba("S", [["B", "L1"]], 30, 90), aba("N", [["B", "L3"]], 30, 90), aba("PS", [["S@B/L1", "ponta"]], 10, 90, { o0: 15, o1: 15 }), aba("PN", [["N@B/L3", "ponta"]], 10, 90, { o0: 15, o1: 15 })],
    },
  },
  {
    n: 5,
    id: "05_caixa_protecao",
    nome: "Caixa de proteção 350 × 250 × 80, T 1,5, esquadria g 1, 12 oblongos de ventilação no fundo",
    familia: "caixa de proteção",
    real: false,
    material: "aço carbono",
    spec: {
      base: withHoles(
        rectBase(350, 250, { T: 1.5, R: 1.5, K: 0.43 }),
        Array.from({ length: 12 }, (_, i) => slot(80 + (i % 4) * 63, 70 + Math.floor(i / 4) * 55, 40, 8, `v${i + 1}`)),
      ),
      ops: [...four(80), ...corners("esquadria", 1)],
    },
  },
  {
    n: 6,
    id: "06_multiplas_dobras",
    nome: "Perfil cartola (flange de contorno de 4 segmentos) numa chapa 1000 × 60, T 2",
    familia: "múltiplas dobras",
    real: false,
    material: "aço carbono",
    spec: {
      base: rectBase(1000, 60, { T: 2, R: 2, K: 0.43 }),
      ops: [
        {
          t: "contorno",
          id: "CT",
          label: "Flange_1",
          edge: { flange: "B", edge: "L1" },
          ref: "externa",
          segments: [
            { id: "s1", length: 40, side: "cima", bend: { deflectionDeg: 90 } },
            { id: "s2", length: 30, side: "baixo", bend: { deflectionDeg: 90 } },
            { id: "s3", length: 40, side: "baixo", bend: { deflectionDeg: 90 } },
            { id: "s4", length: 20, side: "cima", bend: { deflectionDeg: 90 } },
          ],
        },
      ],
    },
  },
  {
    n: 7,
    id: "07_alivios",
    nome: "Suporte 300 × 150, T 3: aba parcial 30 (recuos 40/40) com alívio oblongo e outra (recuos 30/60) com lágrima",
    familia: "peça com alívios",
    real: false,
    material: "aço carbono",
    spec: {
      base: rectBase(300, 150, { T: 3, R: 3, K: 0.43 }),
      ops: [
        aba("A", [["B", "L1"]], 30, 90, { o0: 40, o1: 40 }),
        aba("C", [["B", "L3"]], 30, 90, { o0: 30, o1: 60 }),
        { t: "alivio", id: "AL1", label: "Alívio_1", bends: ["A@B/L1"], kind: "oblongo", gap: 0.5 },
        { t: "alivio", id: "AL2", label: "Alívio_2", bends: ["C@B/L3"], kind: "lagrima", gap: 0.5 },
      ],
    },
  },
  {
    n: 8,
    id: "08_recortes_perto_dobra",
    nome: "Painel 400 × 200, T 2, aba 40: furos a 1 mm da tangência e 2 rasgos atravessando a dobra",
    familia: "recortes próximos às dobras",
    real: false,
    material: "aço carbono",
    spec: {
      base: withHoles(rectBase(400, 200, { T: 2, R: 2, K: 0.43 }), [circle(100, 4 + 1 + 5, 5, "p1"), circle(300, 4 + 1 + 5, 5, "p2")]),
      ops: [aba("A", [["B", "L1"]], 40, 90), { t: "recorte_plano", id: "RP", label: "RecortePlano_1", loops: [rect(170, -12, 190, 15, "r1"), rect(210, -12, 230, 15, "r2")] }],
    },
  },
  {
    n: 9,
    id: "09_fechamento_cantos",
    nome: "Caixa 300 × 300 × 60, T 2, material por fora, cantos sobrepostos (fecham S/N) g 0,3",
    familia: "fechamento de cantos",
    real: false,
    material: "inox",
    spec: { base: rectBase(300, 300, { T: 2, R: 2, K: 0.45 }), ops: [...four(60, { pos: "fora" }), ...corners("sobreposto", 0.3)] },
  },
  {
    n: 10,
    id: "10_geometria_complexa",
    nome: "Base hexagonal irregular, T 2: 3 abas (90°, 60°, 120°), canto esquadria, recorte atravessando dobra, furo, desdobrar/redobrar no histórico",
    familia: "geometria mais complexa",
    real: false,
    material: "aço carbono",
    spec: {
      base: {
        id: "B",
        label: "Base",
        defaults: defaults({ T: 2, R: 2, K: 0.43 }),
        plane: { o: { x: 0, y: 0, z: 0 }, x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, n: { x: 0, y: 0, z: 1 } },
        side: "cima",
        outline: [
          { key: "L1", a: { x: 0, y: 0 }, b: { x: 240, y: 0 } },
          { key: "L2", a: { x: 240, y: 0 }, b: { x: 300, y: 90 } },
          { key: "L3", a: { x: 300, y: 90 }, b: { x: 240, y: 180 } },
          { key: "L4", a: { x: 240, y: 180 }, b: { x: 30, y: 180 } },
          { key: "L5", a: { x: 30, y: 180 }, b: { x: -30, y: 90 } },
          { key: "L6", a: { x: -30, y: 90 }, b: { x: 0, y: 0 } },
        ],
        holes: [circle(120, 90, 15, "centro")],
      },
      ops: [
        aba("S", [["B", "L1"]], 40, 90),
        aba("D", [["B", "L2"]], 30, 60),
        aba("N", [["B", "L4"]], 35, 120, { o0: 20, o1: 20 }),
        { t: "alivio", id: "AL", label: "Alívio_1", bends: ["N@B/L4"], kind: "retangular", gap: 0.5 },
        { t: "canto", id: "CT", label: "Canto_1", corners: ["S@B/L1+D@B/L2"], kind: "esquadria", gap: 0.5 },
        { t: "recorte_plano", id: "RP", label: "RecortePlano_1", loops: [rect(100, -15, 140, 20, "rasgo")] },
        { t: "desdobrar", id: "U", label: "Desdobrar_1", bends: [] },
        { t: "redobrar", id: "R", label: "Redobrar_1", bends: [] },
      ],
    },
  },
];
