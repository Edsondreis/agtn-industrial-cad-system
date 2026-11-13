import type { Layer } from "@agtn/document";
import { type DxfVersion, type DxfWriteInput, readDxf, writeDxf } from "@agtn/dxf";
import { type Entity, entityLength, makeEntity, polylineSignedArea } from "@agtn/geometry";
import { edgeBulge, edgesArea } from "./edges";
import type { FlatPattern } from "./flat";
import type { V2 } from "./math";

/**
 * DXF DIRETO DA PLANIFICAÇÃO (ETAPA 2.6). Sai do MESMO FlatPattern do grafo, sem passar pelo DESENHO e sem mexer
 * no exportador 2D: usa o `writeDxf` existente (R2000 padrão, com $INSUNITS = mm; R12 opcional), escala 1:1 e
 * origem no canto inferior esquerdo do blank. Depois de gravar, o arquivo é RELIDO e conferido
 * (`validateFlatDxf`): contornos fechados, sem duplicados nem micro-segmentos, área e comprimento de corte iguais
 * aos do grafo, caixa = blank e as linhas de dobra por camada.
 */
export const FLAT_LAYER = {
  outer: "CUT_OUTER",
  inner: "CUT_INNER",
  up: "BEND_UP",
  down: "BEND_DOWN",
  mark: "BEND_MARK",
  region: "BEND_REGION",
  ref: "REFERENCE",
} as const;

export interface FlatDxfOptions {
  readonly version?: DxfVersion;
  /** linhas de dobra (BEND_UP / BEND_DOWN) — padrão sim */
  readonly bends?: boolean;
  /** limites da região de dobra (BEND_REGION) — padrão não (a máquina de corte não precisa) */
  readonly regions?: boolean;
  /** marcação D1 CIMA 90,0° RI2,00 (BEND_MARK) — padrão sim */
  readonly marks?: boolean;
  /** título e dados da peça (REFERENCE) — padrão não */
  readonly reference?: boolean;
  readonly title?: string;
}

const L = (name: string, color: number, linetype = "CONTINUOUS", lineweight = 0.25): Layer => ({ name, color, lineweight, linetype, visible: true, locked: false });
export const FLAT_LAYERS: readonly Layer[] = [
  L(FLAT_LAYER.outer, 7, "CONTINUOUS", 0.35),
  L(FLAT_LAYER.inner, 4, "CONTINUOUS", 0.35),
  L(FLAT_LAYER.up, 1, "DASHED"),
  L(FLAT_LAYER.down, 5, "DASHED"),
  L(FLAT_LAYER.mark, 3),
  L(FLAT_LAYER.region, 8, "HIDDEN", 0.18),
  L(FLAT_LAYER.ref, 2, "CONTINUOUS", 0.18),
];

const fmt = (v: number, d = 2) => v.toFixed(d).replace(".", ",");

export function flatDxfInput(fp: FlatPattern, o: FlatDxfOptions = {}): DxfWriteInput {
  if (fp.state !== "valida") throw new Error(`Planificação inválida: ${fp.reasons.join(" ")}`);
  const P = (p: V2) => ({ x: p.x - fp.box.minX, y: p.y - fp.box.minY });
  const ents: Entity[] = [];
  // contorno externo (o maior, anti-horário) e recortes internos que atravessam dobras
  fp.cut.forEach((l, i) => ents.push(makeEntity({ type: "polyline", pts: l.map(P), bulges: [...(fp.cutBulges[i] ?? l.map(() => 0))], closed: true }, i === 0 ? FLAT_LAYER.outer : FLAT_LAYER.inner)));
  for (const h of fp.holes) {
    if (h.segs.length === 1 && h.segs[0].t === "circle") ents.push(makeEntity({ type: "circle", c: P(h.segs[0].c), r: h.segs[0].r }, FLAT_LAYER.inner));
    else
      ents.push(
        makeEntity(
          { type: "polyline", pts: h.segs.map((s) => P((s as { a: V2 }).a)), bulges: h.segs.map((s) => (s.t === "arc" ? edgeBulge({ key: "", a: s.a, b: s.b, arc: { c: s.c, sweep: s.sweep } }) : 0)), closed: true },
          FLAT_LAYER.inner,
        ),
      );
  }
  const w = fp.box.maxX - fp.box.minX;
  const hgt = fp.box.maxY - fp.box.minY;
  const mh = Math.max(1, Math.min(5, Math.min(w, hgt) / 30));
  for (const b of fp.bends) {
    if (o.bends ?? true) for (const s of b.lineSegs) ents.push(makeEntity({ type: "line", a: P(s[0]), b: P(s[1]) }, b.sense === "CIMA" ? FLAT_LAYER.up : FLAT_LAYER.down));
    if (o.regions ?? false) for (const s of [...b.startSegs, ...b.endSegs]) ents.push(makeEntity({ type: "line", a: P(s[0]), b: P(s[1]) }, FLAT_LAYER.region));
    if (o.marks ?? true) {
      const s = b.lineSegs[0] ?? b.line;
      const dx = s[1].x - s[0].x;
      const dy = s[1].y - s[0].y;
      const Ls = Math.hypot(dx, dy);
      const ux = dx / Ls;
      const uy = dy / Ls;
      const at = { x: s[0].x + ux * Math.min(10, Ls * 0.05) - uy * mh * 0.4, y: s[0].y + uy * Math.min(10, Ls * 0.05) + ux * mh * 0.4 };
      ents.push(makeEntity({ type: "text", p: P(at), h: mh, rot: Math.atan2(uy, ux), value: `D${b.n} ${b.sense} ${fmt(b.deflectionDeg, 1)}° RI${fmt(b.R)}`, halign: 0 }, FLAT_LAYER.mark));
    }
  }
  if (o.reference ?? false) {
    const t = o.title ? `${o.title} · ` : "";
    ents.push(makeEntity({ type: "text", p: { x: 0, y: -mh * 3 }, h: mh * 1.2, rot: 0, value: `${t}blank ${fmt(w, 3)} × ${fmt(hgt, 3)} mm · ${fp.bends.length} dobra(s)`, halign: 0 }, FLAT_LAYER.ref));
  }
  return { layers: FLAT_LAYERS, entities: ents };
}

export function flatToDxf(fp: FlatPattern, o: FlatDxfOptions = {}): string {
  return writeDxf(flatDxfInput(fp, o), { version: o.version ?? "R2000" });
}

export interface FlatDxfCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
export interface FlatDxfReport {
  readonly ok: boolean;
  readonly checks: readonly FlatDxfCheck[];
}

/** Relê o DXF gravado e confere contra a planificação do grafo. */
export function validateFlatDxf(text: string, fp: FlatPattern, o: FlatDxfOptions = {}): FlatDxfReport {
  const checks: FlatDxfCheck[] = [];
  const ck = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });
  const version = o.version ?? "R2000";
  let r: ReturnType<typeof readDxf>;
  try {
    r = readDxf(text);
  } catch (e) {
    ck("leitura", false, e instanceof Error ? e.message : String(e));
    return { ok: false, checks };
  }
  ck("leitura sem avisos de entidade não suportada", Object.keys(r.report.unsupported).length === 0, JSON.stringify(r.report.unsupported));
  if (version === "R2000") ck("unidades: $INSUNITS = mm", r.report.unitSource === "INSUNITS" && r.report.unitFactor === 1, `${r.report.unitSource} × ${r.report.unitFactor}`);
  else ck("R12 sem $INSUNITS: lido como mm (1:1)", r.report.unitFactor === 1, `${r.report.unitSource} × ${r.report.unitFactor}`);
  const names = new Set(r.layers.map((l) => l.name));
  const need = [FLAT_LAYER.outer, ...(fp.cut.length > 1 || fp.holes.length ? [FLAT_LAYER.inner] : [])];
  ck("camadas", need.every((n) => names.has(n)), [...names].join(", "));
  const on = (layer: string) => r.entities.filter((e) => e.layer === layer);
  const outer = on(FLAT_LAYER.outer);
  const inner = on(FLAT_LAYER.inner);
  const cuts = [...outer, ...inner];
  ck("um contorno externo", outer.length === 1, String(outer.length));
  ck("contornos internos = recortes + furos", inner.length === fp.cut.length - 1 + fp.holes.length, `${inner.length} ≠ ${fp.cut.length - 1 + fp.holes.length}`);
  ck("todos os contornos fechados", cuts.every((e) => e.type === "circle" || (e.type === "polyline" && e.closed)), cuts.map((e) => e.type).join(","));
  // micro-segmentos e duplicados
  let micro = 0;
  for (const e of cuts)
    if (e.type === "polyline")
      for (let i = 0; i < e.pts.length; i++) {
        const a = e.pts[i];
        const b = e.pts[(i + 1) % e.pts.length];
        if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-4) micro++;
      }
  ck("sem micro-segmentos (< 0,0001 mm)", micro === 0, String(micro));
  const sig = (e: Entity) =>
    e.type === "polyline"
      ? `P${e.pts.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`).sort().join(";")}`
      : e.type === "circle"
        ? `C${e.c.x.toFixed(6)},${e.c.y.toFixed(6)},${e.r.toFixed(6)}`
        : e.type === "line"
          ? `L${[e.a, e.b].map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`).sort().join(";")}`
          : e.id;
  const all = r.entities.filter((e) => e.type !== "text");
  ck("sem entidades duplicadas", new Set(all.map(sig)).size === all.length, `${all.length - new Set(all.map(sig)).size} duplicada(s)`);
  // área e comprimento de corte
  const areaOf = (e: Entity) => (e.type === "circle" ? Math.PI * e.r * e.r : e.type === "polyline" ? Math.abs(polylineSignedArea(e.pts, e.bulges)) : 0);
  const area = outer.reduce((a, e) => a + areaOf(e), 0) - inner.reduce((a, e) => a + areaOf(e), 0);
  ck("área = área do grafo (1e-9 relativo)", Math.abs(area - fp.area) <= 1e-9 * Math.max(1, fp.area), `${area} × ${fp.area}`);
  const cutLen = cuts.reduce((a, e) => a + entityLength(e), 0);
  ck("comprimento de corte = grafo (1e-9 relativo)", Math.abs(cutLen - fp.cutLength) <= 1e-9 * Math.max(1, fp.cutLength), `${cutLen} × ${fp.cutLength}`);
  // escala 1:1: caixa do contorno externo = blank
  const xs: number[] = [];
  const ys: number[] = [];
  const o0 = outer[0];
  if (o0?.type === "polyline") for (const p of o0.pts) xs.push(p.x), ys.push(p.y);
  const w = fp.box.maxX - fp.box.minX;
  const h = fp.box.maxY - fp.box.minY;
  ck(
    "escala 1:1 — caixa do contorno = blank, origem (0, 0)",
    xs.length > 0 && Math.abs(Math.min(...xs)) <= 1e-9 && Math.abs(Math.min(...ys)) <= 1e-9 && Math.abs(Math.max(...xs) - w) <= 1e-9 * Math.max(1, w) && Math.abs(Math.max(...ys) - h) <= 1e-9 * Math.max(1, h),
    `${xs.length ? (Math.max(...xs) - Math.min(...xs)).toFixed(6) : "?"} × ${ys.length ? (Math.max(...ys) - Math.min(...ys)).toFixed(6) : "?"}`,
  );
  if (o.bends ?? true) {
    const nUp = fp.bends.filter((b) => b.sense === "CIMA").reduce((a, b) => a + b.lineSegs.length, 0);
    const nDn = fp.bends.filter((b) => b.sense === "BAIXO").reduce((a, b) => a + b.lineSegs.length, 0);
    ck("linhas de dobra por sentido (BEND_UP / BEND_DOWN)", on(FLAT_LAYER.up).length === nUp && on(FLAT_LAYER.down).length === nDn, `${on(FLAT_LAYER.up).length}/${nUp} · ${on(FLAT_LAYER.down).length}/${nDn}`);
    // cada linha de dobra fica sobre material (dentro do contorno externo)
    const outerPoly = o0?.type === "polyline" ? o0 : null;
    const inside = (p: { x: number; y: number }) => {
      if (!outerPoly) return false;
      let c = false;
      const q = outerPoly.pts;
      for (let i = 0, j = q.length - 1; i < q.length; j = i++)
        if (q[i].y > p.y !== q[j].y > p.y && p.x < ((q[j].x - q[i].x) * (p.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) c = !c;
      return c;
    };
    const lines = [...on(FLAT_LAYER.up), ...on(FLAT_LAYER.down)];
    ck("linhas de dobra dentro do contorno", lines.every((e) => e.type === "line" && inside({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 })), String(lines.length));
  }
  if (o.marks ?? true) ck("marcação D1…Dn", on(FLAT_LAYER.mark).length === fp.bends.length, `${on(FLAT_LAYER.mark).length}/${fp.bends.length}`);
  // conferência cruzada com o grafo: área do contorno externo pelas arestas exatas
  ck("contorno externo = arestas exatas do grafo", Math.abs(areaOf(o0 ?? outer[0]) - Math.abs(edgesAreaOf(fp))) <= 1e-9 * Math.max(1, fp.area), "");
  return { ok: checks.every((c) => c.ok), checks };
}

/** área exata do contorno externo pelas arestas (retas e arcos) do FlatPattern */
function edgesAreaOf(fp: FlatPattern): number {
  const l = fp.cut[0];
  const bu = fp.cutBulges[0];
  return edgesArea(
    l.map((a, i) => {
      const b = l[(i + 1) % l.length];
      const k = bu[i] ?? 0;
      if (!k) return { key: "", a, b };
      // arco pelo bulge: centro a partir da corda e do ângulo incluído
      const th = 4 * Math.atan(k);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const c = Math.hypot(dx, dy);
      const d = c / 2 / Math.tan(th / 2);
      return { key: "", a, b, arc: { c: { x: mx - (dy / c) * d, y: my + (dx / c) * d }, sweep: th } };
    }),
  );
}
