# FASE 4 · ETAPA 4 — Desempenho (P1 contêiner, P2 hardware real)

Data: 13/11/2026.

## Resultado

| ID | Validação | Status |
|---|---|---|
| P1 | Desempenho e estabilidade no **contêiner** | **APROVADO** (refeito nesta etapa) |
| P2 | Desempenho no **PC real da AGTN** | **PENDENTE** (procedimento pronto; nada medido em Windows) |

**Regra:** os números do contêiner **não** valem como medida do PC da AGTN, e não foram misturados. As tabelas abaixo dizem onde cada número foi medido.

## P1 — contêiner Linux (2 vCPU Xeon 2,10 GHz, 7 GB), refeito em 13/11/2026

### Motor sozinho (Node, `perf3.test.ts` com `AGTN_PERF=1`, 3/3)

| Modelo | Abrir (ms) | Editar aba (ms) | Editar raio dos furos (ms) | Planificar (ms) | DXF + validação (ms) | Formas OCCT: depois de 1 / das edições / ao fechar |
|---|---|---|---|---|---|---|
| pequeno (4 abas) | 405 | 91 | — | 2,5 | 6,6 | 2 / 2 / 0 |
| médio (24 furos) | 424 | 396 | 327 | 1,7 | 2,4 | 4 / 4 / 0 |
| grande (2000×1000, 120 furos) | 1 050 | 1 043 | 1 033 | 3,9 | 4,1 | 4 / 4 / 0 |

- **Sem vazamento:** as formas OCCT não acumulam nas edições e fecham em 0.
- **Sem degradação:** no grande, as 3 primeiras edições levam 1 053 ms e as 3 últimas 1 085 ms.

### App inteiro (abrir arquivo + motor + regeneração + malha), teste de fumaça

| Projeto | Chromium (build de produção, CSP) | App Tauri compilado (WebKitGTK) |
|---|---|---|
| Motor pronto (ms) | 331–414 | 1 097–1 184 |
| `fase2_projeto_3d` (3 corpos), regeneração | 204 ms | 849 ms |
| `fase3_peca_parametrica` (booleana + arredondamento) | 414 ms | 816 ms |
| `etapa1_chapa` | 777 ms | 1 223 ms |
| `etapa2_completo` | 1 408 ms | 1 870 ms |
| `grande_120furos` (198 faces) | 3 087 ms | 8 596 ms |
| DXF R2000 conferido no grande | — | 74 ms |
| DWG gravado e relido no grande | — | 204 ms |

**Leitura:** o motor JavaScript muda muito o tempo. O app compilado no Linux (JavaScriptCore) leva 2,8× o Chromium (V8) no projeto grande. O WebView2 usa o V8 do Edge, então a expectativa é ficar mais perto da coluna do Chromium, **mas isso só o P2 confirma**. O app regenera mais que o motor sozinho, porque gera malha e topologia de todas as faces para a tela. Por isso 3,1 s × 1,05 s no grande.

### Interface (load3d.py, 38 corpos, Chromium)

| Tela | Regeneração | Quadro (mediana) | Quadro (p95) | Heap JS |
|---|---|---|---|---|
| paisagem | 789 ms | 0,8 ms | 1,6 ms | 62 MB |
| vertical | 852 ms | 0,9 ms | 1,4 ms | 57 MB |

## P2 — procedimento no PC real

**Automático:** `validar_instalado.ps1 -Repeticoes 3`, que chama `smoke\webview2_smoke.ps1`. Registra:

| Dado | Fonte |
|---|---|
| Processador, núcleos | `Win32_Processor` |
| Memória RAM | `Win32_OperatingSystem` |
| GPU, driver, resolução | `Win32_VideoController` |
| Windows (edição, versão, build) | `Win32_OperatingSystem` |
| WebView2 | registro EdgeUpdate `{F3017226-…}` e `/json/version` do próprio WebView2 |
| Versão do app | `DisplayVersion` do registro + versão do arquivo + SHA-256 do executável |
| Tempo de inicialização | do `Start-Process` até a página do app aparecer (`janela_ms`) |
| Abertura de projeto | arquivo da linha de comando até o título (`abertura_ms`) |
| Motor 3D pronto | `motorPronto_ms` |
| Geração dos sólidos | `regeneracao_ms` (por projeto, inclusive o grande) |
| Planificação e exportação | ms de S6, S7-R2000, S7-R12, S7-disco-dxf, S7-dwg |
| RAM | memória de trabalho e privada de **todos** os processos (app + `msedgewebview2.exe`) |
| CPU | soma do tempo de CPU dos mesmos processos |
| Estabilidade | 3 repetições do conjunto. Reprovado se a memória privada de um projeto crescer mais de 50 % entre a 1ª e a última repetição, ou se alguma verificação falhar |

**Manual (recomendado no PC da oficina):**
1. Abrir `grande_120furos.agtncad`, girar a vista e medir a fluidez.
2. Editar a altura da aba 10 vezes, anotando o tempo de cada regeneração na barra de status.
3. Acompanhar o Gerenciador de Tarefas (memória e CPU de "AGTN Industrial CAD" + "Microsoft Edge WebView2").
4. Deixar 30 min aberto, voltar e editar de novo.

**Não há meta aprovada.** O P2 entrega os números. Se a AGTN quiser critério (por exemplo, regenerar o projeto grande em menos de X s), a meta é dela (`FASE4_ETAPA4_PENDENCIAS_AGTN.md`).
