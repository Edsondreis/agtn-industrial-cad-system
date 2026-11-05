import {
  type DimensionEntity,
  type Entity,
  type Vec2,
  add,
  formatNumber,
  makeEntity,
  mul,
  norm,
  perpL,
  perpR,
  sub,
} from "@agtn/geometry";
import type { SolveResult } from "./engine";

/** Camadas de fabricação geradas pelo módulo (nomes compatíveis com DXF R12: sem acentos). */
export interface SheetLayerDef {
  name: string;
  color: number;
  lineweight: number;
  linetype: string;
  description: string;
  /** Exportada por padrão no DXF de planificação */
  exportDefault: boolean;
}

export const SM_LAYERS: readonly SheetLayerDef[] = [
  { name: "CONTORNO_CORTE", color: 7, lineweight: 0.35, linetype: "CONTINUOUS", description: "Contorno de corte (fechado)", exportDefault: true },
  { name: "LINHAS_DOBRA", color: 1, lineweight: 0.25, linetype: "DASHED", description: "Linhas de dobra (centro da região de dobra) — NÃO cortar", exportDefault: true },
  { name: "REGIAO_DOBRA", color: 8, lineweight: 0.13, linetype: "HIDDEN", description: "Limites da região de dobra (tangências)", exportDefault: false },
  { name: "COTAS", color: 4, lineweight: 0.18, linetype: "CONTINUOUS", description: "Cotas de fabricação", exportDefault: false },
  { name: "CENTROS", color: 6, lineweight: 0.13, linetype: "CENTER", description: "Linhas de centro / eixo neutro", exportDefault: false },
  { name: "ANOTACOES", color: 2, lineweight: 0.18, linetype: "CONTINUOUS", description: "Anotações de dobra (sentido, ângulo, raio)", exportDefault: false },
  { name: "SECAO_PERFIL", color: 7, lineweight: 0.35, linetype: "CONTINUOUS", description: "Seção transversal do perfil dobrado", exportDefault: false },
];

/** Cores das cotas na seção: externa (ciano) e interna (laranja). */
export const DIM_COLOR_EXT = 4;
export const DIM_COLOR_INT = 30;

export const fmtMM = (v: number, p = 2): string => formatNumber(v, p, ",");

const dim = (
  layer: string,
  kind: DimensionEntity["kind"],
  p1: Vec2,
  p2: Vec2,
  loc: Vec2,
  opts: { rot?: number; p3?: Vec2; text?: string | null; scale?: number; color?: number } = {},
): DimensionEntity =>
  makeEntity(
    {
      type: "dimension",
      kind,
      p1,
      p2,
      p3: opts.p3,
      loc,
      rot: opts.rot ?? 0,
      textOverride: opts.text ?? null,
      dimScale: opts.scale ?? 1,
      assoc: null,
    },
    layer,
    { color: opts.color ?? null },
  ) as DimensionEntity;

/** Escala de cotas proporcional ao tamanho da peça (texto ≈ 1/45 da maior dimensão, mín. 1). */
export function autoDimScale(size: number): number {
  const raw = size / 45 / 2.5;
  if (raw <= 1) return 1;
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50];
  return steps.find((s) => s >= raw) ?? 50;
}

export interface FlatOptions {
  origin?: Vec2;
  bendRegions?: boolean;
  dims?: boolean;
  notes?: boolean;
  dimScale?: number;
  /** Texto de identificação (ex.: "PERFIL U 50x100x50 #3") */
  title?: string;
}

/** Geometria da planificação (retângulo desenvolvido × comprimento do perfil). */
export function flatPatternEntities(r: SolveResult, o: FlatOptions = {}): Entity[] {
  if (!r.ok) return [];
  const O = o.origin ?? { x: 0, y: 0 };
  const L = r.developedLength;
  const W = r.partLength;
  const P = (x: number, y: number): Vec2 => ({ x: O.x + x, y: O.y + y });
  const sc = o.dimScale ?? autoDimScale(L);
  const out: Entity[] = [];
  out.push(
    makeEntity({ type: "polyline", pts: [P(0, 0), P(L, 0), P(L, W), P(0, W)], bulges: [0, 0, 0, 0], closed: true }, "CONTORNO_CORTE"),
  );
  for (const b of r.bends) {
    out.push(makeEntity({ type: "line", a: P(b.xLine, 0), b: P(b.xLine, W) }, "LINHAS_DOBRA"));
    if (o.bendRegions ?? true) {
      out.push(makeEntity({ type: "line", a: P(b.xStart, 0), b: P(b.xStart, W) }, "REGIAO_DOBRA"));
      out.push(makeEntity({ type: "line", a: P(b.xEnd, 0), b: P(b.xEnd, W) }, "REGIAO_DOBRA"));
    }
  }
  if (o.notes ?? true) {
    const h = 2.5 * sc;
    r.bends.forEach((b, j) => {
      const sense = b.dir === "left" ? "CIMA" : "BAIXO";
      out.push(
        makeEntity(
          {
            type: "text",
            p: P(b.xLine - h * 0.4, W * 0.5),
            h,
            rot: Math.PI / 2,
            value: `D${j + 1} ${sense} ${fmtMM(b.thetaDeg, 1)}° Ri${fmtMM(b.R)} K${fmtMM(b.K, 3)}`,
            halign: 1,
          },
          "ANOTACOES",
        ),
      );
    });
    if (o.title)
      out.push(makeEntity({ type: "text", p: P(0, -h * 6 - 8 * sc), h: h * 1.2, rot: 0, value: o.title, halign: 0 }, "ANOTACOES"));
  }
  if (o.dims ?? true) {
    const g = 8 * sc;
    out.push(dim("COTAS", "linear", P(0, 0), P(L, 0), P(0, -g * 2), { rot: 0, scale: sc }));
    out.push(dim("COTAS", "linear", P(L, 0), P(L, W), P(L + g * 1.5, 0), { rot: Math.PI / 2, scale: sc }));
    r.bends.forEach((b, j) => {
      out.push(dim("COTAS", "linear", P(0, W), P(b.xLine, W), P(0, W + g * (j + 1)), { rot: 0, scale: sc }));
    });
    if (r.bends.length) {
      // cadeia entre linhas de dobra (distâncias usadas no batente da dobradeira)
      const xs = [0, ...r.bends.map((b) => b.xLine), L];
      for (let i = 0; i + 1 < xs.length; i++)
        if (xs[i + 1] - xs[i] > 1e-9) out.push(dim("COTAS", "linear", P(xs[i], 0), P(xs[i + 1], 0), P(0, -g), { rot: 0, scale: sc }));
    }
  }
  return out;
}

export interface SectionOptions {
  origin?: Vec2;
  dims?: boolean;
  neutral?: boolean;
  dimScale?: number;
}

/**
 * Seção transversal do perfil dobrado, com cotas na face de referência
 * (texto "EXT"/"INT" indica onde cada dimensão é medida) e marcação dos vértices virtuais.
 */
export function sectionEntities(r: SolveResult, o: SectionOptions = {}): Entity[] {
  if (!r.section) return [];
  const O = o.origin ?? { x: 0, y: 0 };
  const T = r.T;
  const mv = (p: Vec2): Vec2 => add(p, O);
  const s = r.section;
  const size = Math.max(...s.moldB.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))), 10);
  const sc = o.dimScale ?? autoDimScale(size * 1.6);
  const out: Entity[] = [];
  out.push(makeEntity({ type: "polyline", pts: s.contour.pts.map(mv), bulges: s.contour.bulges.slice(), closed: true }, "SECAO_PERFIL"));
  if (o.neutral ?? true) {
    for (const b of r.bends)
      if (b.neutralR > 0)
        out.push(makeEntity({ type: "arc", c: mv(b.center), r: b.neutralR, a0: b.arcA0, a1: b.arcA0 + b.arcSweep }, "CENTROS"));
  }
  if (!(o.dims ?? true)) return out;
  const n = r.bends.length;
  // linhas de construção até os vértices virtuais (mold lines)
  for (let j = 0; j < n; j++) {
    const [P1, P2] = s.tangentsA[j];
    const [Q1, Q2] = s.tangentsB[j];
    const VA = s.moldA[j + 1];
    const VB = s.moldB[j + 1];
    for (const [a, b] of [
      [P1, VA],
      [P2, VA],
      [Q1, VB],
      [Q2, VB],
    ] as const)
      if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-6) out.push(makeEntity({ type: "line", a: mv(a), b: mv(b) }, "ANOTACOES", { linetype: "HIDDEN", color: 8 }));
  }
  const gap = 6 * sc;
  r.flanges.forEach((f, i) => {
    const pts = f.face === "A" ? s.moldA : s.moldB;
    const a = pts[i];
    const b = pts[i + 1];
    const u = norm(sub(b, a));
    const side = f.face === "B" ? perpR(u) : perpL(u);
    const off = f.face === "B" ? gap * 1.6 : gap * 1.2;
    out.push(
      dim("COTAS", "aligned", mv(a), mv(b), mv(add(a, mul(side, off))), {
        text: `<> ${f.face === "B" ? "EXT" : "INT"}`,
        scale: sc,
        color: f.face === "B" ? DIM_COLOR_EXT : DIM_COLOR_INT,
      }),
    );
  });
  // espessura na extremidade inicial
  const a0 = s.moldA[0];
  const b0 = s.moldB[0];
  const u0 = norm(sub(s.moldA[1], s.moldA[0]));
  out.push(dim("COTAS", "aligned", mv(a0), mv(b0), mv(add(a0, mul(u0, -gap))), { text: "T=<>", scale: sc }));
  // ângulos internos (no vértice virtual externo) e raios internos
  r.bends.forEach((b, j) => {
    const W = s.moldB[j + 1];
    const uin = norm(sub(s.moldB[j], W));
    const uout = norm(sub(s.moldB[j + 2], W));
    const bis = norm(add(uin, uout));
    const rr = Math.max(gap * 2, b.R + T + gap);
    out.push(
      dim("COTAS", "angular", mv(W), mv(add(W, mul(uin, rr))), mv(add(W, mul(bis, rr))), {
        p3: mv(add(W, mul(uout, rr))),
        scale: sc,
      }),
    );
    if (b.R > 1e-9) {
      const inner = b.dir === "left" ? s.tangentsA[j] : s.tangentsB[j];
      const mid = add(b.center, mul(norm(add(sub(inner[0], b.center), sub(inner[1], b.center))), b.R));
      const dirIn = norm(sub(b.center, mid));
      out.push(
        dim("COTAS", "radius", mv(b.center), mv(mid), mv(add(mid, mul(dirIn, -0.01))), { scale: sc }),
      );
    }
  });
  return out;
}
