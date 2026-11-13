import type { FlatPattern } from "@agtn/sheetgraph";

/**
 * FASE 4 · ETAPA 4 — validação DIMENSIONAL de peças reais (I2). Ferramenta de TESTE, não é código do app.
 *
 * Três comparações diferentes, que NÃO podem ser misturadas:
 *   A. modelo AGTN × DXF de produção aprovado (CAD × CAD): blank, área, corte, contornos, POSIÇÃO das linhas de dobra;
 *   B. modelo AGTN × desenho original: ângulos, raios, medidas finais nominais;
 *   C. peça FÍSICA medida × desenho/modelo: medidas finais, ângulos, raios, espessura — com várias leituras.
 * E a causa provável de cada diferença, separando: erro geométrico do CAD, parâmetro do modelo (K/R/T), erro de
 * medição, variação do material, retorno elástico, variação do processo, configuração da ferramenta.
 * Sem tolerância aprovada pela engenharia, NADA é aprovado. Com K não calibrado, não há aprovação industrial.
 */

export interface P2 { readonly x: number; readonly y: number }
export interface Seg { readonly a: P2; readonly b: P2 }
export interface Box { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }

/* ----------------------------------------------------------------------------------- A. posição das dobras */

/** As 8 posições possíveis do desenho de referência (rotação 0/90/180/270 e espelho), com o canto inferior
 *  esquerdo da caixa na origem. O DXF de produção pode ter sido desenhado girado ou pelo outro lado da chapa. */
const TRANSFORMS: readonly { nome: string; f: (p: P2) => P2 }[] = [
  { nome: "0°", f: (p) => p },
  { nome: "90°", f: (p) => ({ x: -p.y, y: p.x }) },
  { nome: "180°", f: (p) => ({ x: -p.x, y: -p.y }) },
  { nome: "270°", f: (p) => ({ x: p.y, y: -p.x }) },
  { nome: "espelho", f: (p) => ({ x: -p.x, y: p.y }) },
  { nome: "espelho+90°", f: (p) => ({ x: -p.y, y: -p.x }) },
  { nome: "espelho+180°", f: (p) => ({ x: p.x, y: -p.y }) },
  { nome: "espelho+270°", f: (p) => ({ x: p.y, y: p.x }) },
];
const boxOf = (pts: readonly P2[]): Box => ({ minX: Math.min(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxX: Math.max(...pts.map((p) => p.x)), maxY: Math.max(...pts.map((p) => p.y)) });
const mid = (s: Seg): P2 => ({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 });
const len = (s: Seg) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
/** distância do ponto p à reta (infinita) do segmento s */
const toLine = (p: P2, s: Seg) => Math.abs((s.b.x - s.a.x) * (s.a.y - p.y) - (s.a.x - p.x) * (s.b.y - s.a.y)) / Math.max(len(s), 1e-300);
const angDeg = (s: Seg, t: Seg) => {
  const u = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
  const v = Math.atan2(t.b.y - t.a.y, t.b.x - t.a.x);
  let d = Math.abs(u - v) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return (d * 180) / Math.PI;
};

export interface BendMatch {
  readonly transformacao: string;
  /** por linha do modelo: deslocamento perpendicular (mm), diferença de ângulo (°), de comprimento (mm) */
  readonly pares: readonly { readonly modelo: number; readonly referencia: number; readonly deslocamento_mm: number; readonly angulo_graus: number; readonly comprimento_mm: number }[];
  readonly maiorDeslocamento_mm: number;
  readonly semPar: { readonly modelo: number; readonly referencia: number };
  /** erro de caixa do contorno depois da transformação (mm) — confirma que é o mesmo desenho */
  readonly erroCaixa_mm: number;
}

/**
 * Compara as linhas de dobra do modelo com as do DXF de referência, com as duas peças alinhadas pelo canto inferior
 * esquerdo do contorno externo. Escolhe a transformação (das 8) que melhor encaixa contorno e dobras.
 */
export function matchBendLines(model: readonly Seg[], modelOutline: readonly P2[], ref: readonly Seg[], refOutline: readonly P2[]): BendMatch {
  const mb = boxOf(modelOutline);
  const norm = (p: P2, b: Box) => ({ x: p.x - b.minX, y: p.y - b.minY });
  const M = model.map((s) => ({ a: norm(s.a, mb), b: norm(s.b, mb) }));
  let best: BendMatch | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const t of TRANSFORMS) {
    const ro = refOutline.map(t.f);
    const rb = boxOf(ro);
    const R = ref.map((s) => ({ a: norm(t.f(s.a), rb), b: norm(t.f(s.b), rb) }));
    const erroCaixa = Math.max(Math.abs(rb.maxX - rb.minX - (mb.maxX - mb.minX)), Math.abs(rb.maxY - rb.minY - (mb.maxY - mb.minY)));
    const used = new Set<number>();
    const pares: BendMatch["pares"][number][] = [];
    let cost = erroCaixa * 10;
    M.forEach((m, i) => {
      let k = -1;
      let kc = Number.POSITIVE_INFINITY;
      R.forEach((r, j) => {
        if (used.has(j) || angDeg(m, r) > 5) return;
        const c = Math.hypot(mid(m).x - mid(r).x, mid(m).y - mid(r).y);
        if (c < kc) { kc = c; k = j; }
      });
      if (k < 0) { cost += 1e6; return; }
      used.add(k);
      cost += kc;
      pares.push({ modelo: i, referencia: k, deslocamento_mm: toLine(mid(R[k]), m), angulo_graus: angDeg(m, R[k]), comprimento_mm: len(R[k]) - len(m) });
    });
    cost += (R.length - used.size) * 1e6;
    if (cost < bestCost) {
      bestCost = cost;
      best = { transformacao: t.nome, pares, maiorDeslocamento_mm: pares.reduce((a, p) => Math.max(a, p.deslocamento_mm), 0), semPar: { modelo: M.length - pares.length, referencia: R.length - used.size }, erroCaixa_mm: erroCaixa };
    }
  }
  return best!;
}

/** Linhas de dobra e contorno externo de uma planificação do AGTN. */
export function flatGeometry(fp: FlatPattern): { bends: Seg[]; outline: P2[] } {
  return { bends: fp.bends.flatMap((b) => b.lineSegs.map(([a, c]) => ({ a, b: c }))), outline: fp.cut[0] ? [...fp.cut[0]] : [] };
}

/* ----------------------------------------------------------------------------------- C. medidas físicas */

export interface Medida {
  /** nome da cota no desenho (ex.: "comprimento externo", "aba 1") */
  readonly cota: string;
  readonly nominal_mm: number;
  /** valor que o MODELO AGTN dá para a mesma cota, quando a ficha o informa (ex.: caixa do sólido) */
  readonly modelo_mm?: number | null;
  /** leituras na peça física (várias, de preferência ≥ 3) */
  readonly medido_mm: readonly number[];
  readonly instrumento?: string;
  /** resolução do instrumento (mm) */
  readonly resolucao_mm?: number;
  /** tipo: "aba" (depende de K, R e ângulo), "corte" (só laser), "geral" */
  readonly tipo?: "aba" | "corte" | "geral";
}
export interface DobraMedida {
  readonly id: string;
  readonly angulo_nominal_graus: number;
  readonly angulos_medidos_graus: readonly number[];
  readonly raio_interno_medido_mm?: readonly number[];
}
export interface Tolerancias {
  readonly blank_mm?: number;
  readonly area_mm2?: number;
  readonly corte_mm?: number;
  readonly posicao_dobra_mm?: number;
  readonly angulo_graus?: number;
  readonly raio_mm?: number;
  readonly medida_final_mm?: number;
  readonly espessura_mm?: number;
}
export type Causa =
  | "ERRO_GEOMETRICO_DO_CAD"
  | "PARAMETRO_DO_MODELO"
  | "ERRO_DE_MEDICAO"
  | "VARIACAO_DO_MATERIAL"
  | "RETORNO_ELASTICO"
  | "VARIACAO_DO_PROCESSO"
  | "CONFIGURACAO_DA_FERRAMENTA";
export interface Achado { readonly item: string; readonly causa: Causa; readonly evidencia: string }

const mean = (v: readonly number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const spread = (v: readonly number[]) => Math.max(...v) - Math.min(...v);

export interface Entrada {
  /** A: diferenças modelo × DXF de produção (mm / mm²); null = não comparado */
  readonly cad: { readonly blank_mm: number; readonly area_mm2: number; readonly corte_mm: number; readonly posicao_dobra_mm: number | null; readonly contornos_iguais: boolean; readonly dobras_iguais: boolean } | null;
  /** parâmetros do modelo e da produção (ficha) */
  readonly modelo: { readonly T: number; readonly R: readonly number[]; readonly K: readonly number[] };
  readonly ficha: { readonly espessura_mm: number; readonly raio_interno_mm: number; readonly k_factor: number | null; readonly k_origem: string; readonly espessura_medida_mm?: readonly number[] };
  readonly medidas: readonly Medida[];
  readonly dobras: readonly DobraMedida[];
  readonly tol: Tolerancias | null;
}
export interface Diagnostico {
  readonly status: "AGUARDANDO TOLERÂNCIAS DA ENGENHARIA" | "APROVADO" | "APROVADO SÓ NA GEOMETRIA (fabricação sem medida)" | "REPROVADO" | "NÃO APROVÁVEL (K não calibrado)";
  readonly achados: readonly Achado[];
  readonly foraDaTolerancia: readonly string[];
}

/**
 * Regras de causa provável (indicação para a engenharia, não veredito automático):
 *  - modelo ≠ DXF de produção com os MESMOS T, R e K → ERRO_GEOMETRICO_DO_CAD; com T/R/K diferentes → PARAMETRO_DO_MODELO;
 *  - leituras de uma cota espalhadas mais que 2× a resolução (ou > metade da tolerância) → ERRO_DE_MEDICAO;
 *  - espessura medida fora da tolerância de espessura → VARIACAO_DO_MATERIAL;
 *  - raio interno medido ≠ R do modelo → CONFIGURACAO_DA_FERRAMENTA (o raio vem da ferramenta/matriz);
 *  - ângulo fora: todas as dobras para o MESMO lado e abertas (> nominal) → RETORNO_ELASTICO; sinais misturados ou
 *    espalhamento grande entre leituras → VARIACAO_DO_PROCESSO;
 *  - aba fora com ângulo e raio dentro e CAD = DXF de produção → K real ≠ K do modelo: PARAMETRO_DO_MODELO se o K não é
 *    calibrado; VARIACAO_DO_PROCESSO se é;
 *  - cota de corte (sem dobra) fora com CAD = DXF de produção → VARIACAO_DO_PROCESSO (laser: kerf, calibração).
 */
export function diagnosticar(e: Entrada): Diagnostico {
  const achados: Achado[] = [];
  const fora: string[] = [];
  const t = e.tol;
  const kCal = /calibrad/i.test(e.ficha.k_origem);
  const paramIguais =
    Math.abs(e.modelo.T - e.ficha.espessura_mm) < 1e-9 &&
    e.modelo.R.every((r) => Math.abs(r - e.ficha.raio_interno_mm) < 1e-9) &&
    (e.ficha.k_factor == null || e.modelo.K.every((k) => Math.abs(k - (e.ficha.k_factor as number)) < 1e-9));
  // A — CAD × CAD
  let cadOk = true;
  if (e.cad) {
    const itens: [string, number, number | undefined][] = [
      ["blank", e.cad.blank_mm, t?.blank_mm],
      ["área", e.cad.area_mm2, t?.area_mm2],
      ["corte", e.cad.corte_mm, t?.corte_mm],
      ["posição das dobras", e.cad.posicao_dobra_mm ?? 0, t?.posicao_dobra_mm],
    ];
    for (const [n, v, tl] of itens) {
      if (tl == null) continue;
      if (Math.abs(v) > tl) {
        cadOk = false;
        fora.push(`CAD×DXF ${n}`);
        achados.push({ item: `CAD×DXF ${n}`, causa: paramIguais ? "ERRO_GEOMETRICO_DO_CAD" : "PARAMETRO_DO_MODELO", evidencia: `diferença ${v.toFixed(4)} > tolerância ${tl}; T/R/K do modelo ${paramIguais ? "iguais" : "DIFERENTES"} dos da ficha` });
      }
    }
    if (!e.cad.contornos_iguais || !e.cad.dobras_iguais) {
      cadOk = false;
      fora.push("CAD×DXF topologia");
      achados.push({ item: "CAD×DXF contornos/dobras", causa: paramIguais ? "ERRO_GEOMETRICO_DO_CAD" : "PARAMETRO_DO_MODELO", evidencia: "quantidade de contornos internos ou de linhas de dobra diferente" });
    }
  }
  // C — físico
  for (const m of e.medidas) {
    if (!m.medido_mm.length) continue;
    const res = m.resolucao_mm ?? 0.01;
    const sp = spread(m.medido_mm);
    if (sp > Math.max(2 * res, t?.medida_final_mm != null ? t.medida_final_mm / 2 : Number.POSITIVE_INFINITY))
      achados.push({ item: m.cota, causa: "ERRO_DE_MEDICAO", evidencia: `leituras espalhadas ${sp.toFixed(3)} mm (resolução ${res}); repetir a medição antes de concluir` });
  }
  if (e.ficha.espessura_medida_mm?.length && t?.espessura_mm != null) {
    const d = mean(e.ficha.espessura_medida_mm) - e.ficha.espessura_mm;
    if (Math.abs(d) > t.espessura_mm) { fora.push("espessura"); achados.push({ item: "espessura", causa: "VARIACAO_DO_MATERIAL", evidencia: `espessura medida ${mean(e.ficha.espessura_medida_mm).toFixed(3)} × nominal ${e.ficha.espessura_mm} (tol ±${t.espessura_mm})` }); }
  }
  let anguloOk = true;
  let raioOk = true;
  const dAng = e.dobras.filter((d) => d.angulos_medidos_graus.length).map((d) => ({ d, delta: mean(d.angulos_medidos_graus) - d.angulo_nominal_graus, sp: spread(d.angulos_medidos_graus) }));
  if (t?.angulo_graus != null) {
    const out = dAng.filter((x) => Math.abs(x.delta) > (t.angulo_graus as number));
    if (out.length) {
      anguloOk = false;
      const mesmoLado = out.every((x) => x.delta > 0) || out.every((x) => x.delta < 0);
      const abertos = out.every((x) => x.delta > 0);
      const espalhado = dAng.some((x) => x.sp > (t.angulo_graus as number));
      for (const x of out) {
        fora.push(`ângulo ${x.d.id}`);
        achados.push({ item: `ângulo ${x.d.id}`, causa: mesmoLado && abertos && !espalhado ? "RETORNO_ELASTICO" : "VARIACAO_DO_PROCESSO", evidencia: `medido ${mean(x.d.angulos_medidos_graus).toFixed(2)}° × nominal ${x.d.angulo_nominal_graus}° (Δ ${x.delta.toFixed(2)}°, tol ±${t.angulo_graus}°)${mesmoLado && abertos ? "; todas abertas para o mesmo lado" : ""}` });
      }
    }
  }
  if (t?.raio_mm != null)
    for (const d of e.dobras) {
      if (!d.raio_interno_medido_mm?.length) continue;
      const r = mean(d.raio_interno_medido_mm);
      const rm = e.modelo.R[0] ?? e.ficha.raio_interno_mm;
      if (Math.abs(r - rm) > t.raio_mm) { raioOk = false; fora.push(`raio ${d.id}`); achados.push({ item: `raio ${d.id}`, causa: "CONFIGURACAO_DA_FERRAMENTA", evidencia: `raio medido ${r.toFixed(2)} × R do modelo ${rm} (tol ±${t.raio_mm}); o raio real vem da ferramenta/matriz` }); }
    }
  if (t?.medida_final_mm != null)
    for (const m of e.medidas) {
      if (!m.medido_mm.length) continue;
      const d = mean(m.medido_mm) - m.nominal_mm;
      if (Math.abs(d) <= t.medida_final_mm) continue;
      fora.push(m.cota);
      let causa: Causa;
      if (m.modelo_mm != null && Math.abs(m.modelo_mm - m.nominal_mm) > t.medida_final_mm) causa = paramIguais ? "ERRO_GEOMETRICO_DO_CAD" : "PARAMETRO_DO_MODELO";
      else if (m.tipo === "corte") causa = "VARIACAO_DO_PROCESSO";
      else if (m.tipo === "aba" && anguloOk && raioOk && cadOk) causa = kCal ? "VARIACAO_DO_PROCESSO" : "PARAMETRO_DO_MODELO";
      else if (!raioOk) causa = "CONFIGURACAO_DA_FERRAMENTA";
      else if (!anguloOk) causa = "RETORNO_ELASTICO";
      else causa = "VARIACAO_DO_PROCESSO";
      achados.push({ item: m.cota, causa, evidencia: `medido ${mean(m.medido_mm).toFixed(3)} × nominal ${m.nominal_mm}${m.modelo_mm != null ? ` (modelo ${m.modelo_mm.toFixed(3)})` : ""}; Δ ${d.toFixed(3)} > tol ±${t.medida_final_mm}${causa === "PARAMETRO_DO_MODELO" && m.tipo === "aba" ? "; ângulo e raio dentro: K real ≠ K do modelo (K não calibrado)" : ""}` });
    }
  const temFisico = e.medidas.some((m) => m.medido_mm.length) || dAng.length > 0;
  let status: Diagnostico["status"];
  if (!t) status = "AGUARDANDO TOLERÂNCIAS DA ENGENHARIA";
  else if (fora.length) status = "REPROVADO";
  else if (!kCal) status = "NÃO APROVÁVEL (K não calibrado)";
  else if (!temFisico) status = "APROVADO SÓ NA GEOMETRIA (fabricação sem medida)";
  else status = "APROVADO";
  return { status, achados, foraDaTolerancia: fora };
}
