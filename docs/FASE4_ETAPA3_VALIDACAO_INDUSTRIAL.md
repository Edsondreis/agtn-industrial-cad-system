# FASE 4 · ETAPA 3 — Validação industrial (peças de referência e peças reais)

Data: 13/11/2026.

## Resultado

| # | Verificação | Status |
|---|---|---|
| I1 | 10 peças de referência pelo caminho completo do app | **APROVADO** (geometria e DXF; **não** é homologação de fabricação) |
| I2 | Comparação com peças reais da AGTN | **PENDENTE** (só 1 peça real disponível; faltam as demais e as tolerâncias) |
| C1 | `.agtncad` de todas as fases reabrem e regeneram igual | **APROVADO** |
| C2 | DXF antes e depois de salvar/reabrir: idêntico | **APROVADO** |

## I1 — 10 peças de referência

`modules/sheet3d/src/industrial/parts.ts` e `industrial.test.ts`.

**Atenção:** as peças 1, 2 e 4 a 10 são **sintéticas**. Foram montadas com os recursos existentes para cobrir as famílias pedidas e **não têm desenho de engenharia da AGTN por trás**. A nº 3 usa as medidas reais da bandeja 710.0CUH25-01-03, com canto sobreposto e folga 0, igual ao DXF de produção.

Cada peça percorre o caminho completo:
1. grafo;
2. sólido OCCT: válido, 1 sólido, 0 arestas livres, volume = grafo;
3. planificação válida;
4. DXF R12 e R2000 conferidos;
5. camadas por entidade.

| # | Peça | Material | T (mm) | Dobras | Cantos | Blank (mm) | Internos | Faces | kg |
|---|---|---|---|---|---|---|---|---|---|
| 1 | chapa com furos | aço carbono | 3 | 0 | — | 300 × 200 | 6 | 18 | 1,353 |
| 2 | caixa dobrada | aço carbono | 2 | 4 | 4 encosto | 492,985 × 392,985 | 0 | 46 | 2,902 |
| 3 | **bandeja 710.0CUH25-01-03 (real)** | aço carbono | 3,18 | 4 | 4 sobreposto | 574,660 × 559,660 | 0 | 38 | 8,020 |
| 4 | tampa com dobras laterais | galvanizado | 1,5 | 4 | — | 600 × 319,477 | 0 | 34 | 2,256 |
| 5 | caixa de proteção | aço carbono | 1,5 | 4 | 4 esquadria | 504,739 × 404,739 | 12 | 94 | 2,068 |
| 6 | múltiplas dobras (cima/baixo) | aço carbono | 2 | 4 | — | 1000 × 175,970 | 0 | 22 | 2,777 |
| 7 | peça com alívios | aço carbono | 3 | 2 | — | 300 × 199,477 | 0 | 30 | 1,310 |
| 8 | recortes próximos às dobras | aço carbono | 2 | 1 | — | 400 × 236,492 | 4 | 24 | 1,467 |
| 9 | fechamento de cantos | inox | 2 | 4 | 4 sobreposto | 417,111 × 417,111 | 0 | 38 | 2,543 |
| 10 | geometria complexa (60°/120°, esquadria) | aço carbono | 2 | 3 | 1 esquadria | 354,144 × 243,626 | 2 | 43 | 1,016 |

- Tempo de cada peça no contêiner: 58 a 399 ms (grafo + sólido).
- Tabela de dobras completa (θ, α, R, K, BA, BD, comprimento): `tests/output/industrial/resultados.json`.
- K usado nas peças sintéticas: os padrões do app (0,33 a 0,45 conforme a peça). **Não são K calibrados da AGTN.**

## Peça real disponível: bandeja 710.0CUH25-01-03 — **APROVADA (geometria)**

`realref.test.ts`: a planificação gerada pelo caminho 3D é igual ao **DXF de produção** `tests/dxf/fixtures/bandeja_710.0CUH25-01-03.dxf`.

| Item | DXF de produção | AGTN 3D |
|---|---|---|
| Vértices do contorno | 20 | 20, iguais a 10⁻⁶ mm |
| Blank | 574,6599726378568 × 559,6599726378568 | igual |
| Perímetro | 2310,0798905514266 | 2310,079890551427 |
| Linhas de dobra | 4 | 4, mesmas posições |

Isso compara com o DXF que a AGTN já usa. **Não** compara com a peça física dobrada: medir a peça cortada e dobrada é trabalho da AGTN.

## I2 — estrutura para receber as peças reais

Pasta: `tests/industrial/pecas_reais/`. Leia o `README.md` e copie `_modelo/`.
- Arquivos por peça: `ficha.json`, `modelo.agtncad` e `referencia.dxf`; opcionais `desenho.pdf` e `peca.step`.
- O teste `realparts.test.ts` compara blank, área, corte, contornos internos e quantidade de linhas de dobra. O resultado vai para `tests/output/pecas_reais/comparativo.json` e `.md`.
- **Sem tolerância inventada.** Com `"tolerancias": null` a peça sai como **AGUARDANDO APROVAÇÃO DA ENGENHARIA**, com as diferenças medidas.
- Hoje: **nenhuma pasta de peça real** além do modelo, e o teste registra PENDENTE.
- O teste foi conferido com uma pasta temporária: diferença zero, e a pasta foi apagada.

## C1/C2 — persistência (`persist3.test.ts`, 5 testes)

Arquivos de referência, todos gerados pelo app de cada fase:
- FASE 2: `fixtures/fase2_projeto_3d.agtncad`, do e2e de `e66702a`;
- FASE 3: `fixtures/fase3_peca_parametrica.agtncad`, do e2e de `0f5ea29`;
- ETAPA 1 e ETAPA 2: os arquivos de chapa já existentes.

Para cada um:
- abre sem operação ignorada e sem aviso;
- re-gravar dá o mesmo JSON (só `savedAt` muda);
- `parseModel3D` vai e volta igual;
- o motor regenera com volumes iguais a 10⁻⁹ e todos os estados `ok`.

| Arquivo | Corpo | Volume (mm³) |
|---|---|---|
| FASE 2 | CHAPA / COLUNA / TUBO_SUPORTE | 1 500 000 / 782 400 / 173 168,4355168697 |
| FASE 3 | Peça 1 | 233 609,51377451912 |
| ETAPA 1 | chapa | 26 027,433388230813 |
| ETAPA 2 | chapa | 19 837,522264378968 |

C2: o DXF plano da ETAPA 2, em R2000 e R12, sai **idêntico** antes e depois de salvar e reabrir.

O formato `.agtncad` **não mudou** (v1, chapa em `extras["agtn3d"]`).

## O que a AGTN precisa fornecer (I2)

1. De 5 a 10 peças reais já produzidas, cobrindo as famílias acima. Para cada uma:
   - desenho;
   - DXF que foi cortado e dobrado com sucesso;
   - material, T, R da ferramenta e K calibrado, se houver.
2. As **tolerâncias aprovadas pela engenharia**: blank, área, corte e posição de dobra.
3. Se possível, medidas da peça física dobrada, para conferir K e retorno elástico (fora do alcance do CAD sozinho).
