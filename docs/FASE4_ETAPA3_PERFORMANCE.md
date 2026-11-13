# FASE 4 · ETAPA 3 — Desempenho e estabilidade

Data: 13/11/2026.

## Resultado

| # | Verificação | Status |
|---|---|---|
| P1 | Desempenho, memória e estabilidade no contêiner (Linux, 2 vCPU Xeon 2,10 GHz, 7 GB) | **APROVADO** depois da correção F-01 |
| P2 | Desempenho em hardware real (PC Windows da AGTN) | **PENDENTE** (depende do W1/W2) |

**Os números abaixo são do contêiner.** Não valem como medida do PC da AGTN: lá o WebView2 é outro, a CPU é outra e o motor roda no worker do app.

## Como foi medido

Teste `modules/sheet3d/src/perf3.test.ts`. Usa o caminho real do app: `PartEvaluator` + motor de chapa, com o cache incremental.

| Modelo | Operações | Descrição | Faces do sólido |
|---|---|---|---|
| pequeno | 3 | base 200 × 120, 4 abas | 30 |
| médio | 7 | base 600 × 400, 4 abas, 24 furos, 2 recortes planos | 66 |
| grande | 7 | base 2000 × 1000, 4 abas, **120 furos**, 8 recortes planos | 198 |

O que se mede, em cada tamanho:
- abrir (regeneração completa);
- editar a altura da aba;
- editar só o raio dos furos;
- planificar;
- DXF gravado e relido pelo validador.

Repetições:
- edições seguidas: 60 (pequeno), 20 (médio) e 6 (grande);
- abrir/fechar: 20, 10 e 3 vezes.

Duas regras do teste:
- cada edição tem valor diferente da anterior, então nunca cai no cache;
- o "grande" só roda com `AGTN_PERF=1` (fica pulado na suíte normal por ser lento), mas os critérios são os mesmos.

Saída: `tests/output/perf_etapa3.json`.

## Resultados (mediana, ms) — depois da correção F-01

| Modelo | Abrir | Editar aba | Editar raio dos furos | Planificar | DXF + validação |
|---|---|---|---|---|---|
| pequeno | 352 | 90 | — | 2,3 | 6,5 |
| médio | 413 | 413 | 335 | 1,9 | 2,6 |
| grande | 1 129 | 1 089 | 1 065 | 3,9 | 4,2 |

Onde vai o tempo de uma regeneração do "grande" (motor de chapa):

| Etapa | ms |
|---|---|
| Grafo (solve) | 24 |
| Peças | 259 |
| Interferência | 20 |
| Fusão e conferências | 224 |
| **Construção total** | **492** |

O restante (~600 ms da regeneração completa) não foi separado por etapa. Inclui os esboços, as operações de chapa anteriores (cada uma constrói o seu sólido) e as conferências gerais do avaliador.

## Estabilidade

| Modelo | Formas OCCT vivas: antes | depois de 1 | depois das edições | depois de abrir/fechar | Edições: 1ª metade × 2ª metade (ms) |
|---|---|---|---|---|---|
| pequeno | 0 | 2 | **2** | **0** | 121 × 87 |
| médio | 0 | 4 | **4** | **0** | 421 × 408 |
| grande | 0 | 4 | **4** | **0** | 1 068 × 1 121 (+5 %, dentro do ruído) |

- **Sem vazamento:** as edições repetidas não acumulam formas, e fechar libera tudo.
- **Sem degradação:** o tempo das últimas edições é igual ao das primeiras.
- **Memória:** o motor OCCT ficou em 128 MB de WebAssembly o tempo todo (não cresceu). O heap do Node ficou entre 33 e 83 MB.

## Interface (navegador, `load3d.py`)

Estrutura com 38 corpos no Chromium com SwiftShader (renderização por software):

| Tela | Regeneração | Quadro, mediana | Quadro, p95 | Heap JS |
|---|---|---|---|---|
| paisagem | 791 ms | 0,7 ms | 1,2 ms | 55 MB |
| vertical | 984 ms | 0,8 ms | 1,8 ms | 60 MB |

O motor roda num Worker (`apps/desktop/src/ws3d/engine.worker.ts`), então a regeneração não trava a tela.

## Falha F-01 — encontrada e corrigida nesta etapa

Na primeira medição, o "grande" levava **9,3 s por edição**. Só o esboço dos 120 furos tomava 8,3 s.

| Campo | Conteúdo |
|---|---|
| ID | F-01 |
| Gravidade | **MÉDIA**: não erra geometria nem perde dados. Torna lenta a edição de peças com muitos furos, que são comuns, como chapas perfuradas |
| Módulo / arquivo | `core/sketch/src/profile.ts`, `profiles()` (detecção de regiões do esboço; só 3D, não existe na main) |
| Descrição | Para descobrir se dois laços se tocam, comparava todos os vértices de todos os pares de laços: O(N²·P²), com 96 pontos por círculo |
| Como reproduzir | Esboço com 120 círculos de R4 numa grade; chamar `profiles()` |
| Esperado | Menos de 1 s |
| Obtido | 8 262 ms (e 9,3 s por edição na peça grande) |
| Causa raiz | Sem pré-filtro espacial em `sameComponent()` |
| Correção | Pré-filtro **exato** por caixa envolvente: se as caixas, alargadas da tolerância de vértice (tol·10), não se cruzam, nenhum par de vértices pode estar a menos de tol·10. A resposta "não" é a mesma, sem comparar ponto a ponto. Nada de precisão foi trocado por velocidade |
| Teste que comprova | `profiles()` depois: **32 ms** (8 262 → 32). Peça grande: 9 251 → 1 129 ms para abrir e 8 985 → 1 089 ms por edição. Equivalência: a saída nova é **idêntica byte a byte** (JSON) à do código anterior em 3 007 esboços: 3 dos arquivos `.agtncad` do repositório, 3 000 aleatórios (retângulos, círculos, linhas, arcos, polígonos, sobrepostos e encostados) e 4 grades de furos encostados/sobrepostos/concêntricos com diâmetros de 7,9999999 a 8,0000001 mm, somando 27 245 regiões. Suíte completa 571/571; e2e no navegador 138/138 |
| Status | **CORRIGIDA** (commit `1d3eba4`) |

O teste de equivalência rodou com uma cópia do código anterior e foi apagado depois. Não ficou um segundo `profiles()` no repositório. Para refazer: `git show 1d3eba4~1:core/sketch/src/profile.ts`.

## O que falta (P2)

No PC da AGTN, com o app instalado:
1. Abrir a caixa de proteção (nº 5) e a chapa grande com furos.
2. Medir: tempo para abrir e editar, fluidez ao girar, memória do processo (Gerenciador de Tarefas).
3. Repetir 30 edições e conferir que a memória não cresce.
