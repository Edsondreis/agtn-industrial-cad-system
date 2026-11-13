# Peças reais da AGTN: validação dimensional (FASE 4 · ETAPA 4, I2)

O objetivo é passar da validação geométrica (matemática) para a validação de fabricação: de 5 a 10 peças reais já produzidas pela AGTN.

Cada peça fica numa pasta própria: `tests/industrial/pecas_reais/NN_nome_curto/`. Para criar, copie `_modelo/` e preencha.

| Arquivo | Obrigatório | O que é |
|---|---|---|
| `ficha.json` | sim | dados de engenharia e de fabricação (modelo em `_modelo/ficha.json`) |
| `modelo.agtncad` | sim | a peça modelada no AGTN CAD (Chapa 3D), salva pelo app |
| `referencia.dxf` | sim | DXF de produção **aprovado**: o que já foi cortado e dobrado com sucesso |
| `desenho.pdf` | sim | desenho técnico original |
| `peca.step` | opcional | STEP do cliente ou da engenharia |
| `fotos/` | opcional | fotos da peça medida e dos instrumentos |

## O que a ficha precisa ter

- material, espessura nominal e espessura **medida**;
- raio interno e **fator K calibrado** (`k_origem` = "calibrado …"). Com K de tabela ou estimado, a peça nunca sai aprovada industrialmente;
- ferramenta (punção, matriz V, raio do punção, máquina) e processo de dobra (ar/fundo/cunhagem, sequência);
- medidas físicas da peça fabricada: cada cota com 3 leituras ou mais, instrumento e resolução, e tipo (`aba`, `corte` ou `geral`). Quando houver, também o valor do modelo AGTN para a mesma cota;
- ângulos medidos (várias leituras) e raio interno medido de cada dobra;
- **tolerâncias aprovadas pela engenharia**, com quem aprovou. Enquanto `"tolerancias": null`, nada é julgado: a peça fica **AGUARDANDO TOLERÂNCIAS DA ENGENHARIA**, com as diferenças medidas.

## O que o teste confere

O teste é `modules/sheet3d/src/industrial/realparts.test.ts`, com a ferramenta `dimensional.ts`. Para cada peça:

**A. Modelo AGTN × DXF de produção (CAD contra CAD)**
- blank, comprimento desenvolvido (blank) e área;
- comprimento de corte e número de contornos internos;
- **posição de cada linha de dobra**: as duas peças são alinhadas pelo canto do contorno externo. O teste aceita o desenho girado (0°, 90°, 180° ou 270°) ou espelhado (desenhado pelo outro lado). Para cada dobra mede deslocamento, ângulo e comprimento.

**B. Modelo × desenho**
- T, R, K e ângulos do modelo contra os da ficha.

**C. Peça física**
- medidas finais, ângulos, raios e espessura contra o nominal e contra o modelo.

**Causa provável** de cada diferença:

| Causa | Quando aparece |
|---|---|
| `ERRO_GEOMETRICO_DO_CAD` | modelo ≠ DXF de produção, com os **mesmos** T, R e K |
| `PARAMETRO_DO_MODELO` | modelo ≠ DXF com T/R/K diferentes; ou aba fora com ângulo e raio certos e K não calibrado |
| `ERRO_DE_MEDICAO` | leituras da mesma cota espalhadas além de 2× a resolução |
| `VARIACAO_DO_MATERIAL` | espessura medida fora da tolerância |
| `RETORNO_ELASTICO` | todas as dobras fora, abertas para o mesmo lado |
| `VARIACAO_DO_PROCESSO` | ângulos para lados diferentes, cota de corte fora, ou aba fora com K calibrado |
| `CONFIGURACAO_DA_FERRAMENTA` | raio interno medido ≠ R do modelo |

As causas são **indicação para a engenharia**, não veredito automático.

## Resultado por peça

| Status | Significa |
|---|---|
| AGUARDANDO TOLERÂNCIAS DA ENGENHARIA | sem tolerância aprovada, nada foi julgado |
| REPROVADO | algum item fora da tolerância |
| NÃO APROVÁVEL (K não calibrado) | tudo dentro, mas o K não é calibrado |
| APROVADO SÓ NA GEOMETRIA (fabricação sem medida) | tudo dentro, mas não há medida física |
| APROVADO | tudo dentro, K calibrado e peça medida |

## Saída

- `tests/output/pecas_reais/<peça>/relatorio.md`: relatório individual;
- `tests/output/pecas_reais/consolidado.md` e `comparativo.json`.

O autoteste (`_autoteste`) usa **dados fictícios**, marcados como tal no relatório, e não entra no consolidado.

## Lembrete

O CAD confere a **geometria**. A medida dobrada real depende também do material, da ferramenta, da máquina e do retorno elástico. Por isso:
- o K de cada ficha deve ser o K calibrado da AGTN para aquele conjunto material × espessura × ferramenta;
- as tolerâncias são sempre as da engenharia da AGTN. O teste não inventa tolerância.
