# FASE 4 · ETAPA 5 — Regressão

Data: 13/11/2026 · Ambiente: Linux (Node 22, Chromium Playwright, Tauri 2.12.5 compilado sobre WebKitGTK, Xvfb).
Todas as rodadas abaixo foram feitas **depois** da correção F-05/F-06, sobre o código que será commitado.
**WebView2 não executado** (ver `FASE4_ETAPA5_RELATORIO_FINAL.md` §8).

## 1. Resumo

| Conjunto | Resultado |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | OK |
| `npx vitest run` | **628 aprovados**, 0 reprovados, 2 pulados (58 arquivos + 1 pulado) |
| `npm run test:sem-eval` (V8 com `--disallow-code-generation-from-strings`) | **628 aprovados**, 0 reprovados, 2 pulados |
| `cargo test --release` (DWG reais) | **15/15** |
| e2e Chromium, `vite dev` (glue corrigido confirmado no servidor de dev) | `e2e3d` 34/34 · `e2e_param` 25/25 · `e2e_param2` 22/22 · `e2e_audit` 15/15 · `e2e_sheet` 18/18 · `e2e_etapa2` 24/24 |
| Carga 3D (`load3d`, 38 corpos, 1 072 triângulos) | paisagem: quadro mediano 0,9 ms, p95 1,6 ms, heap 40 MB · vertical: 0,8 / 2,0 ms, 54 MB · motor pronto em 588–650 ms |
| App Tauri compilado (`.deb` reconstruído com a correção e instalado) | `tauri_compiled` 5/5 · `tauri_param` 5/5 · `tauri_sheet` 3/3 · `tauri_etapa2` 5/5 · `tauri_smoke` **65/65** |
| Chromium, build de produção, CSP estrita em **todas** as respostas (inclusive o worker) | **66/66** |
| Chromium, build de produção, CSP só no HTML (como o Tauri) | **66/66** |
| Falhas forçadas + diagnóstico + recuperação + 6 inicializações (`engine_fail.py`) | **33/33** |
| `security.test.ts` sobre o `dist` de produção | **12/12** |

Os 2 pulados são os testes de desempenho pesados (`perf3` "grande" e `occt_bench`). Eles só rodam com variável de ambiente e foram executados à parte nas medições de `FASE4_ETAPA5_DESEMPENHO.md` (3/3 e 1/1 em cada uma).

## 2. Cobertura pedida × evidência

| Item pedido | Testes que cobrem (todos aprovados nesta rodada) |
|---|---|
| Sólidos | `core/solid`:<br>• `solid.test` 28<br>• `part.test` 20<br>• `topology.test` 10<br>• `audit.test` 17<br>• `occt-csp-patch.test` 4 (volumes exatos com `Function`/`eval` interceptados)<br>`e2e3d` 34 · `tauri_compiled` 5 |
| Booleanas (unir, cortar, interseção, furo) | `solid.test`, `audit.test`, `occt-csp-patch.test` (fusão, corte, interseção caixa × cilindro, volume comparado com π·r²·h) · `e2e3d` · `e2e_audit` 15 |
| Perfis U, L, enrijecidos, calandrados | `modules/sheetmetal`:<br>• `sheetmetal.test` 32<br>• `profiles_new.test` 6<br>• `rolling.test` 7<br>• `tray.test` 21<br>`sheet3d/cross.test` 15 |
| Planificação | `unfold.test` 7 · `sheet3d/flat.test` 8 · `flatcut.test` 6 · `build.test` 22 · `industrial/*` 31 · `e2e_sheet` 18 · `tauri_sheet` 3 · smoke S6/S7 nos 5 projetos (Chromium 66/66 e Tauri 65/65) |
| Linhas de dobra | `sheet3d/flatdxf.test` 10 · `flat.test` · smoke S7 (DXF da planificação gravado em disco e relido igual; DWG relido com a camada `CUT_OUTER`) |
| Edição paramétrica | `e2e_param` 25 · `e2e_param2` 22 · `tauri_param` 5 · `part3d.test` 7 · `stableids.test` 6 |
| Redobra | `unfold.test` · `audit3.test` 27 · `persist2.test` 2 · `e2e_etapa2` 24 · `tauri_etapa2` 5 |
| Histórico (desfazer/refazer, árvore) | `core/document/document.test` 17 · `audit3d.test` 6 · `e2e_param*` |
| `.agtncad` | `persist2.test` · `persist3.test` 5 · `compat.test` 3 · `compat4.test` 4 · `regressao2d.test` (salvar de novo = arquivo idêntico ao da v3.1.1) · smoke S8 (salvo e relido em caminho com acento) |
| DXF | `modules/dxf`: `dxf.test` 18 · `dxf2000.test` 6 · `curves.test` 5 · `regressao2d.test` (R12 e R2000 com hash igual ao da `main`) |
| DWG | `cargo test --release` 15/15 com arquivos DWG reais |
| Desenho 2D | `core/geometry` 49 · `core/sketch` 35 · `cad/input.test` 7 · `regressao2d.test` · `engine_fail.py` (o 2D continua utilizável com o motor 3D em falha) |
| SVG / PDF | `modules/plot/plot.test` 10 · `regressao2d.test` (SVG e PDF com hash igual ao da `main`) |

## 3. Código não alterado (conferido com `git`)

- `modules/sheetmetal/src/bend.ts`: SHA-256 `d2613c5a…ff857a7`, idêntico à `main` e à ETAPA 4 (`c32f309`). Última alteração: `733d0a1`.
- `modules/sheetmetal/src/tray.ts`: SHA-256 `b7de7297…0c40`, idêntico à `main` e à ETAPA 4. Última alteração: `6953fb7`.
- Nenhuma linha alterada nesta etapa em:
  - `modules/dxf`, `modules/plot`, `modules/sheetmetal`, `modules/sheet3d`;
  - `core/geometry`, `core/document`, `core/sketch`;
  - Rust (`apps/desktop/src-tauri/src`);
  - formato `.agtncad`.
- Diferenças para a ETAPA 4: só os arquivos listados em `FASE4_ETAPA5_RELATORIO_FINAL.md` §5 (motor 3D, diagnóstico, CSP, instrumentos, testes, docs).

## 4. Regressão do instrumento (F-09)

- Na ETAPA 4, o smoke **pulava em silêncio** S6/S7 (planificação) no projeto "grande" quando a chapa ainda não estava pronta: 8 verificações em vez de 15.
- Corrigido em `scripts/windows/smoke/agtn_smoke.js`: espera até 60 s e **reprova** se a planificação não chegar.
- Nesta rodada, os 5 projetos fizeram S6/S7 em todos os ambientes:
  - Chromium: 66 verificações;
  - Tauri: 65 verificações. A diferença de 1 é o S10 "sem requisição externa", que só existe no Chromium porque precisa do registro de rede do Playwright.

## 5. Limitações

- O WebView2 não foi executado. O WebKitGTK e o Chromium **não** substituem o WebView2.
- As classificações `MEMORY` e `COMMUNICATION` do diagnóstico só têm teste unitário, com mensagens reais. Não foi forçado um esgotamento de memória de ponta a ponta.
- Os scripts PowerShell (`webview2_smoke.ps1`, `validar_instalado.ps1`, `homologacao.ps1`) foram revisados e o JavaScript que injetam foi testado (`scripts_windows.test`), mas o PowerShell nunca rodou.
