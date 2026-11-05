/**
 * Materiais e tabelas de fator K.
 *
 * IMPORTANTE: os valores iniciais são ESTIMATIVAS DE PARTIDA (tabela empírica clássica para
 * dobra no ar, por faixa de R/T). Não são valores certificados. O fator K real depende de
 * material, lote, espessura real, ferramental (abertura V, raio do punção), processo e máquina.
 * Use a calibração por ensaio para substituir as estimativas por valores medidos na fábrica.
 */
export type MaterialId = "aco_carbono" | "aco_inox" | "aluminio" | "galvanizado" | "outro";

export interface Material {
  id: MaterialId;
  name: string;
  /** Densidade em g/cm³ (para peso teórico). */
  density: number;
}

export const MATERIALS: readonly Material[] = [
  { id: "aco_carbono", name: "Aço carbono", density: 7.85 },
  { id: "aco_inox", name: "Aço inoxidável", density: 7.93 },
  { id: "aluminio", name: "Alumínio", density: 2.7 },
  { id: "galvanizado", name: "Aço galvanizado", density: 7.85 },
  { id: "outro", name: "Outro", density: 7.85 },
];

export const materialById = (id: MaterialId): Material => MATERIALS.find((m) => m.id === id) ?? MATERIALS[0];

export type BendProcess = "ar" | "fundo" | "cunhagem" | "outro";
export const PROCESS_LABEL: Record<BendProcess, string> = {
  ar: "Dobra no ar",
  fundo: "Dobra de fundo (bottoming)",
  cunhagem: "Cunhagem (coining)",
  outro: "Outro",
};

/** Origem do valor — nunca apresentar estimativa como calibração. */
export type ValueSource = "teorico" | "estimado" | "calibrado" | "manual";
export const SOURCE_LABEL: Record<ValueSource, string> = {
  teorico: "Teórico",
  estimado: "Estimativa de partida",
  calibrado: "Calibrado em ensaio",
  manual: "Informado manualmente",
};

export interface KRule {
  id: string;
  material: MaterialId;
  process: BendProcess;
  /** Faixa de espessura [tMin, tMax) em mm */
  tMin: number;
  tMax: number;
  /** Faixa de R/T [rtMin, rtMax) */
  rtMin: number;
  rtMax: number;
  k: number;
  source: ValueSource;
  /** Ferramental de referência (opcional) */
  vOpening?: number | null;
  punchRadius?: number | null;
  note?: string;
}

export interface KTable {
  id: string;
  name: string;
  /** Tabela padrão fornecida com o programa (editável; cópias podem ser criadas). */
  builtIn: boolean;
  rules: KRule[];
}

const est = (material: MaterialId, rtMin: number, rtMax: number, k: number, i: number): KRule => ({
  id: `${material}-${i}`,
  material,
  process: "ar",
  tMin: 0,
  tMax: 1000,
  rtMin,
  rtMax,
  k,
  source: "estimado",
  note: "Estimativa de partida (tabela empírica para dobra no ar). Validar por ensaio.",
});

/** Valores de partida por faixa de R/T: [0,1), [1,3), [3,∞). */
const START: Record<Exclude<MaterialId, "outro">, [number, number, number]> = {
  aluminio: [0.33, 0.4, 0.5],
  aco_carbono: [0.38, 0.43, 0.5],
  galvanizado: [0.38, 0.43, 0.5],
  aco_inox: [0.4, 0.45, 0.5],
};

export function defaultKTable(): KTable {
  const rules: KRule[] = [];
  for (const [mat, ks] of Object.entries(START) as [Exclude<MaterialId, "outro">, [number, number, number]][]) {
    rules.push(est(mat, 0, 1, ks[0], 0), est(mat, 1, 3, ks[1], 1), est(mat, 3, 1e9, ks[2], 2));
  }
  return { id: "padrao-agtn", name: "Padrão (estimativas de partida)", builtIn: true, rules };
}

const SOURCE_RANK: Record<ValueSource, number> = { calibrado: 0, manual: 1, estimado: 2, teorico: 3 };

/**
 * Seleciona a regra aplicável: mesmo material e processo, espessura e R/T dentro da faixa.
 * Preferência: calibrado > manual > estimado > teórico; depois a faixa mais estreita.
 */
export function lookupK(table: KTable, q: { material: MaterialId; process: BendProcess; T: number; R: number }): KRule | null {
  const rt = q.T > 0 ? q.R / q.T : 0;
  const hits = table.rules.filter(
    (r) => r.material === q.material && r.process === q.process && q.T >= r.tMin && q.T < r.tMax && rt >= r.rtMin && rt < r.rtMax,
  );
  if (!hits.length) return null;
  hits.sort(
    (a, b) =>
      SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
      a.tMax - a.tMin - (b.tMax - b.tMin) ||
      a.rtMax - a.rtMin - (b.rtMax - b.rtMin),
  );
  return hits[0];
}

/** Registro de ensaio de dobra para calibração (estrutura preparada para a base da fábrica). */
export interface CalibrationRecord {
  id: string;
  date: string;
  material: MaterialId;
  process: BendProcess;
  nominalThickness: number;
  measuredThickness: number | null;
  toolName: string;
  vOpening: number | null;
  punchRadius: number | null;
  programmedAngleDeg: number;
  /** Ângulo de dobra medido (θ, deflexão) */
  measuredAngleDeg: number;
  /** Raio interno medido ou adotado */
  innerRadius: number;
  /** Comprimento plano antes da dobra */
  blankLength: number;
  /** Abas externas medidas depois da dobra */
  outerA: number;
  outerB: number;
  /** Resultado calculado (não editável manualmente) */
  result: { BD: number; BA: number; K: number } | null;
  note: string;
}
