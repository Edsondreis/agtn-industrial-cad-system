# FASE 4 · ETAPA 5 — Desempenho antes × depois da correção F-05

Ambiente: contêiner Linux, 2 vCPU Xeon 2,10 GHz, 7 GB. **Não é o PC da AGTN** (P2 continua pendente).
"Antes" = commit `c32f309` (glue original); "depois" = glue corrigido. Mesmas peças das etapas anteriores. Medianas, com o número de rodadas indicado.

## 1. Ligação JS ↔ WASM isolada (`occt_bench.test.ts`, Node, 3 rodadas cada)

| Medida | Antes | Depois | Diferença |
|---|---|---|---|
| 1ª inicialização (cold) | 501 / 151 / 129 ms | 144 / 129 / 122 ms | sem piora (a 1ª rodada "antes" tinha o disco frio) |
| Inicialização (mediana de 5 seguidas) | 99 ms | 98 ms | igual |
| `makeBox` + `release` (chamada curta) | 33,2 µs | 35,4 µs | +2,2 µs (ruído; varia ±4 µs entre rodadas) |
| `getVolume` | 129,0 µs | 127,9 µs | igual |
| `getBoundingBox` | 12,1 µs | 11,9 µs | igual |
| caixa + cilindro + união + corte | 7 214 µs | 7 323 µs | +1,5 % (ruído) |
| CPU do teste inteiro | 31,9 s | 32,0 s | igual |
| RSS do processo | 284 MB | 282 MB | igual |

**Leitura:** o invocador por closure não pesa. As chamadas do OCCT são grossas (cada uma faz trabalho geométrico em C++), então o custo do invocador some. A lentidão conhecida do `DYNAMIC_EXECUTION=0` não aparece aqui de forma mensurável.

## 2. Motor de chapa (`perf3.test.ts`, Node, `AGTN_PERF=1`)

| Modelo | Abrir (antes → depois) | Editar aba | Planificar | DXF conferido | Formas OCCT (1 / edições / fechar) |
|---|---|---|---|---|---|
| pequeno | 388 → 319 ms | 91 → 90 ms | 2,3 → 2,3 ms | 6,5 → 6,3 ms | 2 / 2 / 0 (igual) |
| médio (24 furos) | 433 → 418 ms | 398 → 410 ms | 1,6 → 2,4 ms | 2,3 → 2,3 ms | 4 / 4 / 0 (igual) |
| grande (120 furos) | 1 134 → 1 124 ms | 1 117 → 1 080 ms | 4,8 → 6,8 ms | 4,1 → 5,8 ms | 4 / 4 / 0 (igual) |

- Diferenças de poucos ms em operações de 2–7 ms são ruído de medição: a planificação e o DXF nem passam pelo glue.
- O heap do Node (34–81 MB) varia com o coletor de lixo entre rodadas, antes e depois.

## 3. App inteiro — Chromium, build de produção (abrir + motor + regeneração + malha)

| Projeto | Motor pronto: antes (1) → depois (2 tauri / 3 estrito) | Regeneração: antes → depois tauri → depois estrito |
|---|---|---|
| `etapa2_completo` | 414 → 345 / 317 ms | 1 540 → 1 327 → 1 140 ms |
| `fase3_peca_parametrica` (booleana + arredondamento) | 337 → 332 / 319 ms | 410 → 463 → 443 ms |
| `fase2_projeto_3d` | 359 → 319 / 335 ms | 348 → 340 → 290 ms |
| `etapa1_chapa` | 335 → 326 / 345 ms | 586 → 678 → 713 ms |
| `grande_120furos` | 341 → 342 / 328 ms | 3 213 → 2 856 → 2 950 ms |
| heap JS da página | 7–12 MB | 7–11 MB |

## 4. App Tauri compilado (WebKitGTK), 3 rodadas antes e 3 depois

| Projeto | Motor pronto (antes → depois) | Regeneração (antes → depois) |
|---|---|---|
| `etapa2_completo` | 1 149 → 1 018 ms | 4 499 → 4 488 ms |
| `fase3_peca_parametrica` | 1 124 → 1 061 ms | 831 → 625 ms |
| `fase2_projeto_3d` | 1 185 → 969 ms | 623 → 641 ms |
| `etapa1_chapa` | 1 002 → 1 011 ms | 1 018 → 1 020 ms |
| `grande_120furos` | 1 123 → 1 115 ms | 7 554 → 7 821 ms (+3,5 %) |

Inicialização igual ou mais rápida. Regeneração dentro da variação entre rodadas: o `etapa2` foi de 1 836 a 4 931 ms nas rodadas "antes" e de 1 657 a 4 691 ms nas "depois"; o `grande`, de 7 345 a 8 783 ms antes e de 7 759 a 7 959 ms depois.

## 5. Comunicação interface ↔ worker

A correção **não toca** no caminho de mensagens (`postMessage`, `Transferable`, protocolo). Para referência, a ida e volta de uma operação leve (`stats`, mediana de 30) depois da correção:

| Ambiente | Mediana por projeto (5 projetos) |
|---|---|
| Chromium, CSP estrita | 0 – 0,1 ms |
| Chromium, CSP como o Tauri | 0 – 0,1 ms |
| Tauri compilado (WebKitGTK) | 0 ms nos 5: abaixo da resolução do relógio do WebKit (~1 ms), portanto **< 1 ms** |

Fonte: `/tmp/final5/*/resultado.json`, `medidas.comunicacao_ms`.

Não há "antes" para essa medida, porque o gancho de medição (`pingMs`) foi criado nesta etapa.

## Conclusão

**Sem perda de desempenho mensurável.**
- A inicialização do motor ficou igual ou um pouco mais rápida: o glue original compilava milhares de funções com `new Function` no início.
- Chamadas, booleanas, regeneração, memória e CPU ficaram dentro do ruído.
- Não há instabilidade nova:
  - formas OCCT voltam a 0;
  - 6 reinicializações seguidas;
  - 3 rodadas completas sem falha em cada ambiente.

Hardware real (P2): `validar_instalado.ps1` no PC da AGTN.
