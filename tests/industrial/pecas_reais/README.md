# Peças reais da AGTN — homologação industrial (FASE 4 · ETAPA 3, I2)

Uma pasta por peça: `tests/industrial/pecas_reais/NN_nome_curto/`. Copie `_modelo/` e preencha.

| Arquivo | Obrigatório | O que é |
|---|---|---|
| `ficha.json` | sim | dados de engenharia da peça (ver `_modelo/ficha.json`) |
| `modelo.agtncad` | sim | a peça modelada no AGTN CAD (Chapa 3D), salva pelo app |
| `referencia.dxf` | sim | planificação de REFERÊNCIA da engenharia/produção — de preferência o DXF que já foi cortado e dobrado com sucesso |
| `desenho.pdf` | recomendado | desenho técnico original |
| `peca.step` | opcional | STEP do cliente/engenharia |

O teste `modules/sheet3d/src/industrial/realparts.test.ts` regenera cada `modelo.agtncad` (mesmo motor do app),
gera a planificação e compara com `referencia.dxf`:

- blank (largura × altura), área, comprimento de corte, número de contornos internos;
- linhas de dobra (quantidade e posição);
- vértices do contorno (quando a referência tem o mesmo desenho de cantos).

O resultado vai para `tests/output/pecas_reais/comparativo.json` e `comparativo.md`.

**Tolerâncias:** o teste NÃO inventa tolerância. Enquanto `ficha.json` tiver `"tolerancias": null`, a peça sai
como **AGUARDANDO APROVAÇÃO DA ENGENHARIA**, com as diferenças medidas. Com tolerâncias aprovadas, a peça vira
APROVADA ou REPROVADA.

Lembrete: o CAD confere a GEOMETRIA (fórmulas, K, R, T). A medida dobrada real depende também de material, ferramenta,
matriz, punção, máquina e retorno elástico — por isso o K de cada ficha deve ser o K calibrado da AGTN para aquele
conjunto material × espessura × ferramenta, quando existir.
