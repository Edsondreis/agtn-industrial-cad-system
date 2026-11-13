# FASE 4 · ETAPA 4 — Validação dimensional de peças reais (I1–I2)

Data: 13/11/2026.

## Resultado

| ID | Validação | Status | Evidência |
|---|---|---|---|
| I1 | 10 peças de referência (9 sintéticas + bandeja 710 real), caminho completo | **APROVADO** (geometria e DXF; não é fabricação) | `industrial.test.ts` 10/10 (refeito nesta etapa) |
| I2 | Peças reais com tolerância da engenharia e medida física | **PENDENTE** | nenhuma peça em `tests/industrial/pecas_reais/`; estrutura e ferramenta prontas |

Única peça real comparada: bandeja **710.0CUH25-01-03** contra o DXF de produção.
- 20 vértices iguais a 10⁻⁶ mm;
- as 4 dobras na mesma posição (deslocamento < 10⁻⁶ mm, também com o desenho girado ou espelhado).

Isso é CAD contra CAD. A peça física **não** foi medida. Sem tolerâncias, nada é aprovado industrialmente, e K padrão não basta.

## O que foi preparado

**Ficha v2:** `tests/industrial/pecas_reais/_modelo/ficha.json`. Pede:
- desenho original e DXF de produção aprovado;
- material, espessura nominal e **medida**, raio interno;
- **K calibrado** (`k_origem`);
- ferramenta (punção, matriz V, raio do punção, máquina) e processo de dobra (ar/fundo/cunhagem, sequência);
- medidas físicas: várias leituras por cota, com instrumento, resolução e tipo (aba / corte / geral);
- ângulos e raios medidos por dobra;
- tolerâncias **aprovadas pela engenharia**, com quem aprovou.

**Ferramenta:** `modules/sheet3d/src/industrial/dimensional.ts`, com teste em `dimensional.test.ts` (18 testes). Faz três comparações separadas:

| Bloco | Compara | Itens |
|---|---|---|
| A | modelo AGTN × DXF de produção | blank (comprimento desenvolvido), área, corte, contornos, **posição de cada dobra** (8 orientações: 0/90/180/270° e espelho), ângulo e comprimento de cada linha |
| B | modelo × desenho/ficha | T, R, K e ângulo de cada dobra |
| C | peça física × nominal/modelo | medidas finais, ângulos, raios, espessura |

**Causa provável** de cada diferença (indicação para a engenharia, não veredito):

| Causa | Regra |
|---|---|
| Erro geométrico do CAD | modelo ≠ DXF de produção com os **mesmos** T, R e K |
| Parâmetro do modelo | idem com T/R/K diferentes; ou aba fora com ângulo e raio certos e K não calibrado |
| Erro de medição | leituras da mesma cota espalhadas além de 2× a resolução |
| Variação do material | espessura medida fora da tolerância |
| Retorno elástico | dobras fora, todas abertas para o mesmo lado |
| Variação do processo | ângulos para lados diferentes; cota de corte fora; aba fora com K calibrado |
| Configuração da ferramenta | raio interno medido ≠ R do modelo |

**Status por peça:**
- **AGUARDANDO TOLERÂNCIAS** quando a ficha não tem tolerância;
- **REPROVADO** se algum item sai da tolerância;
- **NÃO APROVÁVEL (K não calibrado)** se tudo está dentro, mas o K é de tabela ou estimado;
- **APROVADO SÓ NA GEOMETRIA** se tudo está dentro, mas falta a medida física;
- **APROVADO** só com tudo dentro, K calibrado e peça medida.

**Relatórios:** `realparts.test.ts` gera `tests/output/pecas_reais/<peça>/relatorio.md` (individual) e `consolidado.md`.

**Autoteste:** usa a peça da ETAPA 2 contra o próprio DXF, com medidas **fictícias marcadas como tal**. Dá diferença 0 no bloco A e "PARAMETRO_DO_MODELO" na aba fictícia. Não entra no consolidado.

## Testes da ferramenta (dimensional.test.ts)

| Teste | Resultado |
|---|---|
| bandeja 710 × DXF de produção: 4 pares de dobra, deslocamento < 1e-6, nenhuma linha sem par | ok |
| mesma referência girada 90°, espelhada, ou girada 270° e espelhada | ok |
| uma dobra deslocada 0,3 mm na referência: o desvio medido é 0,3 mm | ok |
| 13 casos de regras com dados fictícios (cada causa e cada status) | ok |

## O que a AGTN precisa mandar (por peça)

1. Desenho técnico original (PDF).
2. DXF de produção aprovado (o que foi cortado e dobrado com sucesso).
3. Material, espessura nominal e medida, raio interno e **K calibrado** (com a data do ensaio).
4. Ferramenta (punção, matriz, raio) e processo (máquina, tipo de dobra, sequência).
5. Medidas físicas da peça pronta: pelo menos 3 leituras por cota, ângulos e raios por dobra, instrumento.
6. **Tolerâncias aprovadas pela engenharia**, com o nome de quem aprovou.
7. O modelo da peça no AGTN 3D (`modelo.agtncad`). Posso modelar a partir do desenho, mas a conferência do modelo é da engenharia.

De 5 a 10 peças, cobrindo:
- bandeja;
- caixa com cantos;
- peça com alívios;
- recortes perto da dobra;
- dobras para cima e para baixo;
- espessura grossa (≥ 6,35 mm).
