import { readFileSync } from "node:fs";
import { readDxf } from "@agtn/dxf";
import type { LineEntity, PolylineEntity } from "@agtn/geometry";
import { flatPattern, solveSheet } from "@agtn/sheetgraph";
import { type Entrada, type P2, type Seg, diagnosticar, flatGeometry, matchBendLines } from "./dimensional";
import { REF_PARTS } from "./parts";

/**
 * FASE 4 · ETAPA 4 — ferramenta da validação dimensional (I2).
 * Parte 1 com a ÚNICA peça real do repositório (bandeja 710.0CUH25-01-03, DXF de produção).
 * Parte 2 com DADOS FICTÍCIOS DE TESTE (não são medições da AGTN): só exercitam as regras de causa provável.
 */
const real = readDxf(new Uint8Array(readFileSync(new URL("../../../../tests/dxf/fixtures/bandeja_710.0CUH25-01-03.dxf", import.meta.url))));
const realOutline = (real.entities.find((e) => e.type === "polyline") as PolylineEntity).pts as P2[];
const realBends: Seg[] = (real.entities.filter((e) => e.type === "line") as LineEntity[]).map((l) => ({ a: l.a, b: l.b }));
const g = flatGeometry(flatPattern(solveSheet(REF_PARTS.find((x) => x.n === 3)!.spec)));

describe("posição das linhas de dobra: modelo × DXF de produção (bandeja 710 real)", () => {
  it("mesmo desenho: 4 pares, deslocamento < 1e-6 mm, sem linha sobrando", () => {
    const m = matchBendLines(g.bends, g.outline, realBends, realOutline);
    expect(m.pares.length).toBe(4);
    expect(m.semPar).toEqual({ modelo: 0, referencia: 0 });
    expect(m.maiorDeslocamento_mm).toBeLessThan(1e-6);
    expect(m.erroCaixa_mm).toBeLessThan(1e-6);
  });
  for (const [nome, f] of [
    ["girado 90°", (p: P2) => ({ x: -p.y + 1000, y: p.x - 50 })],
    ["espelhado (desenhado pelo outro lado)", (p: P2) => ({ x: 300 - p.x, y: p.y + 7 })],
    ["girado 270° e espelhado", (p: P2) => ({ x: -p.y, y: -p.x })],
  ] as const)
    it(`referência ${nome}: encontra a transformação e o encaixe continua < 1e-6 mm`, () => {
      const m = matchBendLines(g.bends, g.outline, realBends.map((s) => ({ a: f(s.a), b: f(s.b) })), realOutline.map(f));
      expect(m.semPar).toEqual({ modelo: 0, referencia: 0 });
      expect(m.maiorDeslocamento_mm).toBeLessThan(1e-6);
    });
  it("uma dobra da referência 0,3 mm fora: o desvio aparece (0,3 mm), não é escondido", () => {
    const moved = realBends.map((s, i) => {
      if (i !== 0) return s;
      const vertical = Math.abs(s.a.x - s.b.x) < 1e-9;
      const d = vertical ? { x: 0.3, y: 0 } : { x: 0, y: 0.3 };
      return { a: { x: s.a.x + d.x, y: s.a.y + d.y }, b: { x: s.b.x + d.x, y: s.b.y + d.y } };
    });
    const m = matchBendLines(g.bends, g.outline, moved, realOutline);
    expect(Math.abs(m.maiorDeslocamento_mm - 0.3)).toBeLessThan(1e-6);
  });
});

describe("causa provável das diferenças (DADOS FICTÍCIOS DE TESTE)", () => {
  const base: Entrada = {
    cad: { blank_mm: 0, area_mm2: 0, corte_mm: 0, posicao_dobra_mm: 0, contornos_iguais: true, dobras_iguais: true },
    modelo: { T: 2, R: [2, 2], K: [0.43, 0.43] },
    ficha: { espessura_mm: 2, raio_interno_mm: 2, k_factor: 0.43, k_origem: "calibrado em ensaio" },
    medidas: [{ cota: "aba 1", nominal_mm: 50, medido_mm: [50.02, 50.03, 50.02], resolucao_mm: 0.01, tipo: "aba" }],
    dobras: [{ id: "D1", angulo_nominal_graus: 90, angulos_medidos_graus: [90.1, 90.2], raio_interno_medido_mm: [2.05] }],
    tol: { blank_mm: 0.1, area_mm2: 5, corte_mm: 0.5, posicao_dobra_mm: 0.1, angulo_graus: 0.5, raio_mm: 0.3, medida_final_mm: 0.2, espessura_mm: 0.1 },
  };
  const causas = (e: Entrada) => diagnosticar(e).achados.map((a) => a.causa);
  it("sem tolerância da engenharia: nunca aprova", () => expect(diagnosticar({ ...base, tol: null }).status).toBe("AGUARDANDO TOLERÂNCIAS DA ENGENHARIA"));
  it("tudo dentro, K calibrado e peça medida: APROVADO", () => expect(diagnosticar(base).status).toBe("APROVADO"));
  it("tudo dentro mas K estimado: não aprovável industrialmente", () => expect(diagnosticar({ ...base, ficha: { ...base.ficha, k_origem: "estimado (padrão)" } }).status).toBe("NÃO APROVÁVEL (K não calibrado)"));
  it("sem medida física: aprovado só na geometria", () => expect(diagnosticar({ ...base, medidas: [], dobras: [] }).status).toBe("APROVADO SÓ NA GEOMETRIA (fabricação sem medida)"));
  it("modelo ≠ DXF de produção com os mesmos T/R/K → erro geométrico do CAD", () => expect(causas({ ...base, cad: { ...base.cad!, blank_mm: 0.4 } })).toContain("ERRO_GEOMETRICO_DO_CAD"));
  it("modelo ≠ DXF de produção com K diferente → parâmetro do modelo", () => expect(causas({ ...base, modelo: { ...base.modelo, K: [0.33, 0.33] }, cad: { ...base.cad!, blank_mm: 0.4 } })).toContain("PARAMETRO_DO_MODELO"));
  it("todas as dobras abertas para o mesmo lado → retorno elástico", () => expect(causas({ ...base, dobras: [{ id: "D1", angulo_nominal_graus: 90, angulos_medidos_graus: [91.2, 91.3] }, { id: "D2", angulo_nominal_graus: 90, angulos_medidos_graus: [91.1, 91.2] }] })).toEqual(["RETORNO_ELASTICO", "RETORNO_ELASTICO"]));
  it("ângulos para lados diferentes → variação do processo", () => expect(causas({ ...base, dobras: [{ id: "D1", angulo_nominal_graus: 90, angulos_medidos_graus: [91.2] }, { id: "D2", angulo_nominal_graus: 90, angulos_medidos_graus: [88.9] }] })).toEqual(["VARIACAO_DO_PROCESSO", "VARIACAO_DO_PROCESSO"]));
  it("raio interno medido ≠ R do modelo → configuração da ferramenta", () => expect(causas({ ...base, dobras: [{ ...base.dobras[0], raio_interno_medido_mm: [3.1, 3.0] }] })).toContain("CONFIGURACAO_DA_FERRAMENTA"));
  it("leituras espalhadas → erro de medição", () => expect(causas({ ...base, medidas: [{ ...base.medidas[0], medido_mm: [50.0, 50.3, 49.9] }] })).toContain("ERRO_DE_MEDICAO"));
  it("espessura fora → variação do material", () => expect(causas({ ...base, ficha: { ...base.ficha, espessura_medida_mm: [2.21, 2.2] } })).toContain("VARIACAO_DO_MATERIAL"));
  it("aba fora com ângulo e raio certos e K estimado → parâmetro do modelo (K); com K calibrado → processo", () => {
    const aba = { ...base, medidas: [{ ...base.medidas[0], medido_mm: [50.45, 50.46, 50.45] }] };
    expect(causas({ ...aba, ficha: { ...aba.ficha, k_origem: "estimado" } })).toEqual(["PARAMETRO_DO_MODELO"]);
    expect(causas(aba)).toEqual(["VARIACAO_DO_PROCESSO"]);
  });
  it("cota só de corte fora com CAD = DXF → processo do laser", () => expect(causas({ ...base, medidas: [{ cota: "furo Ø10", nominal_mm: 10, medido_mm: [10.4, 10.41], resolucao_mm: 0.01, tipo: "corte" }] })).toEqual(["VARIACAO_DO_PROCESSO"]));
});
