/**
 * Tolerâncias da chapa 3D — SEPARADAS por finalidade (nunca uma tolerância única para tudo).
 * Unidades: mm, mm², mm³. A peça é dimensionada em mm (0,5 … 10 000 mm típicos).
 *
 * 1. NUMÉRICA (`num`): erro de arredondamento de ponto flutuante em cálculos encadeados (BA, recuos, matrizes).
 *    Relativa ao tamanho da peça: `numAbs(size) = 1e-9 · max(1, size)`. Fórmulas comparadas entre si (3D × 2D ×
 *    bend.ts) usam esta tolerância — qualquer diferença maior é ERRO de lógica, não de medida.
 * 2. GEOMÉTRICA DO OCCT (`occt`): Precision::Confusion do OCCT = 1e-7 mm. Coincidência de pontos/arestas no
 *    kernel; abaixo disso o OCCT considera a mesma posição. Não usar para decidir medida de fabricação.
 * 3. DIMENSIONAL (`dim`): conferência de medidas da peça construída (bbox, espessura, ângulo medido) contra o
 *    modelo: `dimAbs(size) = max(1e-6, 1e-9 · size)` mm; ângulo `dimAngDeg = 1e-7`°. Muito abaixo de qualquer
 *    tolerância de fabricação (0,1 mm) — serve para provar que a geometria É a do modelo.
 * 4. INTERFERÊNCIA (`interf`): volume comum entre peças NÃO vizinhas acima de
 *    `interfVol(v) = max(1e-6 mm³, 1e-9 · v)` (v = volume da menor peça) é interferência (erro). Distância
 *    abaixo de `contactDist = 1e-6` mm sem volume comum é CONTATO (aviso). Peças vizinhas no grafo
 *    (aba–dobra–aba) se tocam por construção: contato previsto, não verificado como interferência.
 *    Sobreposição na planificação: área comum acima de `interfArea(a) = max(1e-6 mm², 1e-9 · a)`.
 */
export const TOL = {
  num: 1e-9,
  occt: 1e-7,
  dimMin: 1e-6,
  dimAngDeg: 1e-7,
  interfVolMin: 1e-6,
  interfAreaMin: 1e-6,
  contactDist: 1e-6,
} as const;

export const numAbs = (size: number): number => TOL.num * Math.max(1, size);
export const dimAbs = (size: number): number => Math.max(TOL.dimMin, TOL.num * size);
export const interfVol = (v: number): number => Math.max(TOL.interfVolMin, TOL.num * v);
export const interfArea = (a: number): number => Math.max(TOL.interfAreaMin, TOL.num * a);
