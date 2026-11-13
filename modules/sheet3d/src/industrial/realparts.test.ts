import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseModel3D } from "@agtn/model3d";
import { dxfBytes, readDxf } from "@agtn/dxf";
import { type Entity, entityLength, polylineSignedArea } from "@agtn/geometry";
import { type FlatPattern, flatPattern, flatToDxf } from "@agtn/sheetgraph";
import { type Feature, OcctSolidKernel, PartEvaluator } from "@agtn/solid";
import { type SheetState, createSheetBackend } from "../backend";
import { type Diagnostico, type DobraMedida, type Medida, type P2, type Seg, type Tolerancias, diagnosticar, flatGeometry, matchBendLines } from "./dimensional";

/**
 * I2 — peças REAIS da AGTN (uma pasta por peça em tests/industrial/pecas_reais/, ficha em _modelo/ficha.json).
 * Sem peça → PENDENTE (não aprova nada). Sem tolerância aprovada → AGUARDANDO; o teste não inventa tolerância.
 * Para cada peça: comparação A (modelo × DXF de produção: blank, área, corte, contornos, POSIÇÃO de cada dobra),
 * B (modelo × desenho: ângulos e raios do modelo contra a ficha), C (peça física medida), causa provável e um
 * relatório individual; no fim, o consolidado. O autoteste (peça da ETAPA 2 contra o próprio DXF, medidas
 * FICTÍCIAS marcadas como tal) prova que o caminho funciona e não entra no consolidado.
 */
const DIR = new URL("../../../../tests/industrial/pecas_reais/", import.meta.url);
const OUT = "tests/output/pecas_reais";
const folders = existsSync(DIR) ? readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("_")).map((d) => d.name) : [];
type Num = { agtn: number; ref: number; dif: number };
const areaOf = (e: Entity) => (e.type === "circle" ? Math.PI * e.r * e.r : e.type === "polyline" ? Math.abs(polylineSignedArea(e.pts, e.bulges)) : 0);
const isBend = (l: string) => /^(LINHAS?_DOBRA|BEND_UP|BEND_DOWN|DOBRAS?)$/i.test(l);
const isCut = (l: string) => !isBend(l) && !/REGIAO|REGION|COTA|DIM|TEXT|MARCA|ANOT|REFER|BEND_MARK/i.test(l);

function measure(ents: readonly Entity[]) {
  const cuts = ents.filter((e) => isCut(e.layer) && (e.type === "polyline" || e.type === "circle" || e.type === "line" || e.type === "arc"));
  const closed = cuts.filter((e) => e.type === "circle" || (e.type === "polyline" && e.closed));
  const outer = closed.reduce<Entity | null>((m, e) => (!m || areaOf(e) > areaOf(m) ? e : m), null);
  const pts: P2[] = outer?.type === "polyline" ? [...outer.pts] : [];
  const w = pts.length ? Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)) : Number.NaN;
  const h = pts.length ? Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)) : Number.NaN;
  const area = outer ? areaOf(outer) - closed.filter((e) => e !== outer).reduce((a, e) => a + areaOf(e), 0) : Number.NaN;
  const corte = cuts.reduce((a, e) => a + entityLength(e), 0);
  const bends: Seg[] = ents.filter((e) => isBend(e.layer) && e.type === "line").map((e) => (e.type === "line" ? { a: e.a, b: e.b } : { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }));
  return { w, h, area, corte, internos: closed.length - (outer ? 1 : 0), bends, outline: pts, abertas: cuts.length - closed.length };
}

interface Ficha {
  id: string;
  descricao: string;
  desenho?: string;
  material: string;
  espessura_mm: number;
  espessura_medida_mm?: number[];
  raio_interno_mm: number;
  k_factor: number | null;
  k_origem: string;
  ferramenta?: Record<string, unknown>;
  processo_dobra?: Record<string, unknown>;
  angulos_graus?: number[];
  medidas_fisicas?: Medida[];
  dobras_medidas?: DobraMedida[];
  tolerancias: Tolerancias | null;
  tolerancias_aprovadas_por?: string;
  exemplo?: boolean;
}

function comparar(name: string, ficha: Ficha, fp: FlatPattern, T: number, refBytes: Uint8Array) {
  const mr = measure(readDxf(refBytes).entities);
  const w = fp.box.maxX - fp.box.minX;
  const h = fp.box.maxY - fp.box.minY;
  const pair = (a: number, b: number): Num => ({ agtn: a, ref: b, dif: a - b });
  const rot = Math.abs(w - mr.h) + Math.abs(h - mr.w) < Math.abs(w - mr.w) + Math.abs(h - mr.h);
  const g = flatGeometry(fp);
  const bm = matchBendLines(g.bends, g.outline, mr.bends, mr.outline);
  const itens: Record<string, Num> = {
    blank_largura: pair(w, rot ? mr.h : mr.w),
    blank_altura: pair(h, rot ? mr.w : mr.h),
    area: pair(fp.area, mr.area),
    corte: pair(fp.cutLength, mr.corte),
    contornos_internos: pair(fp.cut.length - 1 + fp.holes.length, mr.internos),
    linhas_dobra: pair(g.bends.length, mr.bends.length),
    posicao_dobra_max: pair(bm.maiorDeslocamento_mm, 0),
  };
  // B — o modelo usa os ângulos, R, K e T da ficha?
  const B = {
    T: pair(T, ficha.espessura_mm),
    R: fp.bends.map((b) => pair(b.R, ficha.raio_interno_mm)),
    K: fp.bends.map((b) => pair(b.K, ficha.k_factor ?? Number.NaN)),
    angulos: fp.bends.map((b, i) => pair(b.includedDeg, ficha.angulos_graus?.[i] ?? Number.NaN)),
  };
  const diag = diagnosticar({
    cad: { blank_mm: Math.max(Math.abs(itens.blank_largura.dif), Math.abs(itens.blank_altura.dif)), area_mm2: itens.area.dif, corte_mm: itens.corte.dif, posicao_dobra_mm: bm.maiorDeslocamento_mm, contornos_iguais: itens.contornos_internos.dif === 0, dobras_iguais: itens.linhas_dobra.dif === 0 && bm.semPar.modelo === 0 && bm.semPar.referencia === 0 },
    modelo: { T, R: fp.bends.map((b) => b.R), K: fp.bends.map((b) => b.K) },
    ficha: { espessura_mm: ficha.espessura_mm, raio_interno_mm: ficha.raio_interno_mm, k_factor: ficha.k_factor, k_origem: ficha.k_origem, espessura_medida_mm: ficha.espessura_medida_mm },
    medidas: ficha.medidas_fisicas ?? [],
    dobras: ficha.dobras_medidas ?? [],
    tol: ficha.tolerancias,
  });
  return { id: name, descricao: ficha.descricao, desenho: ficha.desenho, exemplo: !!ficha.exemplo, referencia_aberta: mr.abertas === 0, transformacao_referencia: bm.transformacao, itens, dobras: bm.pares, B, diag };
}
type Linha = ReturnType<typeof comparar>;

function relatorio(r: Linha, ficha: Ficha): string {
  const f = (v: number) => (Number.isFinite(v) ? v.toFixed(4) : "—");
  const L: string[] = [
    `# Peça ${r.id} — ${r.descricao}${r.exemplo ? " (AUTOTESTE — DADOS FICTÍCIOS, NÃO É PEÇA REAL)" : ""}`,
    "",
    `Desenho: ${r.desenho ?? "—"} · material ${ficha.material} · T ${ficha.espessura_mm} mm · R ${ficha.raio_interno_mm} mm · K ${ficha.k_factor ?? "—"} (${ficha.k_origem})`,
    `Ferramenta: ${JSON.stringify(ficha.ferramenta ?? {})} · processo: ${JSON.stringify(ficha.processo_dobra ?? {})}`,
    `Tolerâncias: ${ficha.tolerancias ? `${JSON.stringify(ficha.tolerancias)} (aprovadas por ${ficha.tolerancias_aprovadas_por ?? "—"})` : "NÃO DEFINIDAS"}`,
    "",
    `## Resultado: ${r.diag.status}`,
    "",
    "## A. Modelo AGTN × DXF de produção",
    "",
    `Referência alinhada por ${r.transformacao_referencia} (canto inferior esquerdo do contorno).`,
    "",
    "| Item | AGTN | Referência | Diferença |",
    "|---|---|---|---|",
    ...Object.entries(r.itens).map(([k, v]) => `| ${k} | ${f(v.agtn)} | ${f(v.ref)} | ${f(v.dif)} |`),
    "",
    "| Dobra (modelo → referência) | Deslocamento (mm) | Ângulo (°) | Comprimento (mm) |",
    "|---|---|---|---|",
    ...r.dobras.map((p) => `| ${p.modelo + 1} → ${p.referencia + 1} | ${f(p.deslocamento_mm)} | ${f(p.angulo_graus)} | ${f(p.comprimento_mm)} |`),
    "",
    "## B. Modelo × desenho/ficha (parâmetros)",
    "",
    `T: modelo ${f(r.B.T.agtn)} × ficha ${f(r.B.T.ref)}`,
    ...r.B.R.map((v, i) => `D${i + 1}: R ${f(v.agtn)} × ${f(v.ref)} · K ${f(r.B.K[i].agtn)} × ${f(r.B.K[i].ref)} · ângulo ${f(r.B.angulos[i].agtn)}° × ${f(r.B.angulos[i].ref)}°`),
    "",
    "## C. Peça física",
    "",
    "| Cota | Nominal | Modelo | Leituras | Média | Δ |",
    "|---|---|---|---|---|---|",
    ...(ficha.medidas_fisicas ?? []).map((m) => {
      const av = m.medido_mm.length ? m.medido_mm.reduce((a, b) => a + b, 0) / m.medido_mm.length : Number.NaN;
      return `| ${m.cota} | ${f(m.nominal_mm)} | ${m.modelo_mm != null ? f(m.modelo_mm) : "—"} | ${m.medido_mm.join("; ")} | ${f(av)} | ${f(av - m.nominal_mm)} |`;
    }),
    ...(ficha.dobras_medidas ?? []).map((d) => `| ângulo ${d.id} | ${d.angulo_nominal_graus}° | — | ${d.angulos_medidos_graus.join("; ")} | | |`),
    "",
    "## Causa provável das diferenças",
    "",
    ...(r.diag.achados.length ? r.diag.achados.map((a) => `- **${a.item}** → ${a.causa}: ${a.evidencia}`) : ["- nenhuma diferença acima das tolerâncias" + (ficha.tolerancias ? "" : " (sem tolerâncias, nada foi julgado)")]),
    "",
  ];
  return L.join("\n");
}

function consolidado(rows: readonly Linha[]): string {
  const L = ["# Validação dimensional — consolidado", "", "| Peça | Descrição | Blank Δ (mm) | Posição de dobra máx. (mm) | Achados | Resultado |", "|---|---|---|---|---|---|"];
  for (const r of rows) L.push(`| ${r.id} | ${r.descricao} | ${Math.max(Math.abs(r.itens.blank_largura.dif), Math.abs(r.itens.blank_altura.dif)).toFixed(4)} | ${r.itens.posicao_dobra_max.agtn.toFixed(4)} | ${r.diag.achados.map((a) => a.causa).join(", ") || "—"} | ${r.diag.status} |`);
  const c = (s: Diagnostico["status"]) => rows.filter((r) => r.diag.status === s).length;
  L.push("", `Peças: ${rows.length} · aprovadas ${c("APROVADO")} · reprovadas ${c("REPROVADO")} · aguardando tolerâncias ${c("AGUARDANDO TOLERÂNCIAS DA ENGENHARIA")} · K não calibrado ${c("NÃO APROVÁVEL (K não calibrado)")} · só geometria ${c("APROVADO SÓ NA GEOMETRIA (fabricação sem medida)")}`, "");
  return L.join("\n");
}

let K: OcctSolidKernel;
let ev: PartEvaluator;
beforeAll(async () => {
  K = await OcctSolidKernel.create();
  ev = new PartEvaluator(K, createSheetBackend());
});
afterAll(() => {
  ev.releaseAll();
  K.dispose();
});
function avaliar(id: string, docText: string) {
  const doc = JSON.parse(docText);
  const { model } = parseModel3D(doc.extras.agtn3d);
  const body = Object.values(model.nodes).find((n) => n.kind === "body" && n.source.type === "part");
  if (!body || body.kind !== "body" || body.source.type !== "part") throw new Error(`${id}: modelo.agtncad sem peça de chapa`);
  const r = ev.evaluate(`${id}:${body.id}`, body.source.features as readonly Feature[]);
  expect(r.status.filter((s) => s.state === "error" || s.state === "dependency_error")).toEqual([]);
  const st = r.sheet!.state as SheetState;
  const fp = flatPattern(st.solved);
  expect(fp.state).toBe("valida");
  return { fp, T: st.solved.T };
}

describe("I2 — autoteste do caminho (DADOS FICTÍCIOS, não entra no consolidado)", () => {
  it("peça da ETAPA 2 contra o próprio DXF: diferença 0; medidas fictícias geram relatório e causa", () => {
    const tmp = mkdtempSync(join(tmpdir(), "agtn-i2-"));
    try {
      const text = readFileSync(new URL("../fixtures/etapa2_completo.agtncad", import.meta.url), "utf8");
      const { fp, T } = avaliar("autoteste", text);
      const ref = dxfBytes(flatToDxf(fp, { version: "R2000" }));
      writeFileSync(join(tmp, "referencia.dxf"), ref);
      const ficha: Ficha = {
        id: "_autoteste", descricao: "autoteste — peça da ETAPA 2", exemplo: true, material: "aço carbono (fictício)", espessura_mm: T, raio_interno_mm: fp.bends[0].R, k_factor: fp.bends[0].K, k_origem: "estimado (FICTÍCIO)",
        angulos_graus: fp.bends.map((b) => b.includedDeg),
        medidas_fisicas: [{ cota: "aba (fictícia)", nominal_mm: 30, medido_mm: [30.4, 30.41, 30.4], resolucao_mm: 0.01, tipo: "aba" }],
        dobras_medidas: [{ id: "D1", angulo_nominal_graus: 90, angulos_medidos_graus: [90.1, 90.1] }],
        tolerancias: { blank_mm: 0.1, area_mm2: 1, corte_mm: 0.5, posicao_dobra_mm: 0.1, angulo_graus: 0.5, medida_final_mm: 0.2 },
        tolerancias_aprovadas_por: "NINGUÉM — valores fictícios do autoteste",
      };
      const r = comparar("_autoteste", ficha, fp, T, new Uint8Array(readFileSync(join(tmp, "referencia.dxf"))));
      for (const k of ["blank_largura", "blank_altura", "area", "corte", "contornos_internos", "linhas_dobra"]) expect(Math.abs(r.itens[k].dif)).toBeLessThan(1e-6);
      expect(r.itens.posicao_dobra_max.agtn).toBeLessThan(1e-6);
      expect(r.diag.status).toBe("REPROVADO");
      expect(r.diag.achados.map((a) => a.causa)).toEqual(["PARAMETRO_DO_MODELO"]);
      mkdirSync(`${OUT}/_autoteste`, { recursive: true });
      writeFileSync(`${OUT}/_autoteste/relatorio.md`, relatorio(r, ficha));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("I2 — peças reais da AGTN", () => {
  if (!folders.length) {
    it("nenhuma peça real fornecida ainda → I2 PENDENTE", () => {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(`${OUT}/comparativo.json`, JSON.stringify({ status: "PENDENTE", motivo: "nenhuma peça em tests/industrial/pecas_reais/" }, null, 1));
      writeFileSync(`${OUT}/consolidado.md`, "# Validação dimensional — consolidado\n\nPENDENTE: nenhuma peça real em tests/industrial/pecas_reais/.\n");
      expect(folders.length).toBe(0);
    });
    return;
  }
  const rows: Linha[] = [];
  afterAll(() => {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/comparativo.json`, JSON.stringify(rows, null, 1));
    writeFileSync(`${OUT}/consolidado.md`, consolidado(rows));
  });
  for (const name of folders)
    it(name, () => {
      const base = new URL(`${name}/`, DIR);
      const ficha = JSON.parse(readFileSync(new URL("ficha.json", base), "utf8")) as Ficha;
      const { fp, T } = avaliar(name, readFileSync(new URL("modelo.agtncad", base), "utf8"));
      const r = comparar(name, ficha, fp, T, new Uint8Array(readFileSync(new URL("referencia.dxf", base))));
      rows.push(r);
      mkdirSync(`${OUT}/${name}`, { recursive: true });
      writeFileSync(`${OUT}/${name}/relatorio.md`, relatorio(r, ficha));
      // com tolerância aprovada, reprovação é falha do teste (sem tolerância, só registra)
      if (ficha.tolerancias) expect(r.diag.status).not.toBe("REPROVADO");
    });
});
