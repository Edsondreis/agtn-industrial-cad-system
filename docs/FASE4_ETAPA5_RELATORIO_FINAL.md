# FASE 4 · ETAPA 5 — Relatório final: estabilização do motor 3D, CSP e WebView2

Data: 13/11/2026 · Branch `feature/agtn-3d-ia` · `main` = `23a2540` (v3.1.1), **não alterada**.
Sem merge, sem publicação, sem Release. **Homologação continua PENDENTE** (WebView2 real não executado).

## Veredito: **F-05 RESOLVIDO TECNICAMENTE**

- O motor 3D **não gera mais código em tempo de execução**.
- Ele inicia e funciona com a CSP aplicada inclusive ao worker, sem `'unsafe-eval'`. Esse é o cenário que falhava na ETAPA 4: 20/30 antes, 66/66 agora (3 rodadas).
- O mesmo vale com o V8 proibindo geração de código: a suíte inteira passa (628 testes).

**Ressalva obrigatória:** a prova foi feita em Linux (Node, Chromium, WebKitGTK compilado). No WebView2 real ainda não rodou. A homologação Windows continua pendente.

## 1. Causa raiz

- O glue do **Emscripten** (embind) publicado no `occt-wasm` 5.17.1 gerava código com `new Function` em 2 lugares:
  - `createJsInvoker`: o invocador de **cada** função C++, criado na inicialização;
  - `__emval_create_invoker`: o chamador de métodos JS a partir do C++.
- Não é o OCCT nem o `.wasm`. Só acontece no worker dedicado do motor: não há workers secundários, Blob nem `eval`.
- O motor funcionava apenas porque o Tauri 2.12.5 não manda CSP para o script do worker.

Detalhes: `FASE4_ETAPA5_AUDITORIA_ARQUITETURAL.md`.

## 2. Solução escolhida

**Alternativa B.** No build, os 2 geradores são trocados por closures de comportamento idêntico, o mesmo que o Emscripten emite com `-sDYNAMIC_EXECUTION=0`.
- Arquivo: `core/solid/src/occt-csp-patch.ts`.
- É aplicada no build da página e do worker, no `vite dev` e nos testes.
- Fica presa ao SHA-256 do glue: se o occt-wasm mudar, o build **para**.
- Nenhum `.wasm` foi alterado.

Alternativas avaliadas (`FASE4_ETAPA5_SOLUCAO_CSP.md`):

| Alternativa | Avaliação |
|---|---|
| A. Recompilar com `EMBIND_AOT` | melhor a longo prazo, mas exige fork e toolchain que não existem aqui; recomendada como pedido ao mantenedor do occt-wasm |
| C. Motor nativo / IPC | desproporcional |
| D. `'unsafe-eval'` | rejeitada (vale para o app inteiro) |

## 3. Antes × depois

| | Antes (`c32f309`) | Depois |
|---|---|---|
| Geração de código no build | 2 arquivos (as 2 cópias do glue) | **0** |
| Motor com CSP também no worker (Chromium) | **20/30**: não inicia nos 5 projetos | **66/66** × 3 rodadas |
| Motor com `Function`/`eval` proibidos (Node) | falha (EvalError) | inicia; sólido + booleanas exatos; 0 chamadas |
| Suíte com o V8 proibindo geração de código | motor não inicia | **628/628** |
| Erro do motor na tela | "Não foi possível iniciar o motor 3D (OCCT)" para tudo | título + explicação + "2D permanece disponível" + o que fazer + código (7 tipos) + detalhes técnicos + copiar + tentar novamente |
| Recuperar após falha | só reiniciando o app | "Tentar novamente" |
| CSP | `… worker-src 'self' blob: …` | `worker-src 'self'`, mais `object-src 'none'` e `base-uri 'self'` |

## 4. Testes executados (números)

| Conjunto | Resultado |
|---|---|
| Typecheck TS estrito | OK |
| Vitest | **628 aprovados**, 0 reprovados, 2 pulados (desempenho "grande" e microbenchmark, rodados à parte: 3/3 e 1/1 em cada medição) |
| `npm run test:sem-eval` (V8 sem geração de código) | **628 aprovados**, 0 reprovados |
| Novos testes unitários | `occt-csp-patch` 4, `diagnostics` 12, `security` 12, `version` 3, `scripts_windows` 6 (atualizado) |
| `cargo test --release` com DWG reais | **15/15** |
| e2e Chromium (`vite dev`) | `e2e3d` 34/34 · `e2e_param` 25/25 · `e2e_param2` 22/22 · `e2e_audit` 15/15 · `e2e_sheet` 18/18 · `e2e_etapa2` 24/24 |
| App Tauri compilado Linux (`.deb` com a correção) | `tauri_compiled` 5/5 · `tauri_param` 5/5 · `tauri_sheet` 3/3 · `tauri_etapa2` 5/5 · `tauri_smoke` **65/65** |
| Chromium, build de produção, CSP estrita (também no worker) | **66/66** (antes: 20/30) |
| Chromium, CSP como o Tauri | **66/66** |
| Falhas forçadas, diagnóstico, recuperação, 6 inicializações (`engine_fail.py`) | **33/33** |
| Regressão 2D (hashes contra a main: `.agtncad`, DXF R12/R2000, SVG, PDF) | iguais (`regressao2d.test.ts` 3/3) |

## 5. Alterações de código

| Arquivo | Tipo | Por quê |
|---|---|---|
| `core/solid/src/occt-csp-patch.ts` (novo) | build | F-05 |
| `apps/desktop/vite.config.ts`, `vitest.config.ts` | build | aplicar a correção (app, dev, testes) |
| `apps/desktop/src/ws3d/engine.ts`, `engine.worker.ts`, `protocol.ts`, `core/solid/src/occt.ts` | produto | F-06: etapa e erro original; prazo de 90 s; liberar o worker após falha |
| `apps/desktop/src/ws3d/diagnostics.ts` (novo), `Workspace3D.tsx`, `ws3d.css` | produto | F-06: tela de diagnóstico, rótulos de falha de operação, gancho de teste `pingMs` (só com a flag de teste) |
| `apps/desktop/src-tauri/tauri.conf.json` | produto (segurança) | CSP mais restrita |
| `scripts/windows/smoke/agtn_smoke.js`, `webview2_smoke.ps1` | instrumento | F-09 (não pular a planificação), código do diagnóstico, comunicação, **S11** (CSP no worker do WebView2) |
| `tests/e2e/engine_fail.py` (novo), `csp_chromium_smoke.py` | teste | falhas forçadas; S10 (sem requisição externa) |
| `scripts/test-sem-eval.mjs`, `package.json` (`test:sem-eval`) | teste | suíte com o V8 proibindo geração de código |

**Não alterados:**
- `bend.ts`, `tray.ts`;
- grafo, build e planificação da chapa;
- `modules/dxf` (exportador 2D), `core/geometry`, `core/document`, `modules/plot`;
- formato `.agtncad`;
- Rust.

## 6. Impacto no desempenho

Nenhum mensurável (`FASE4_ETAPA5_DESEMPENHO.md`):
- inicialização igual ou um pouco mais rápida;
- chamadas, booleanas, regeneração, memória e CPU dentro do ruído;
- sem vazamento de formas OCCT.

## 7. Situação da CSP

**Ativa e mais restrita que na ETAPA 4.** A única permissão além da v3.1.1 é `'wasm-unsafe-eval'`, que é a mínima para compilar WebAssembly e **não** permite eval de JavaScript. Detalhes em `FASE4_ETAPA5_SEGURANCA.md`.

## 8. Situação do WebView2

**Não testado** (não há Windows nesta sessão). Preparado:
- `webview2_smoke.ps1` com S1–S11:
  - mostra o código do diagnóstico se o motor falhar;
  - pergunta ao worker, no WebView2, se a CSP é aplicada a ele;
- `validar_instalado.ps1` e `homologacao.ps1` (ETAPA 4), agora com o novo teste de fumaça;
- passo manual no GitHub Actions (sem publicar), se a cobrança for resolvida.

**Não declaro compatibilidade com o WebView2.**

## 9. Riscos remanescentes

| Risco | Gravidade | Situação |
|---|---|---|
| WebView2 real não executado | ALTA (homologação) | instrumentos prontos; depende do PC da AGTN |
| Atualização do occt-wasm | MÉDIA | o build para (SHA-256) e obriga a revisar; procedimento em `FASE4_ETAPA5_MOTOR_3D.md` |
| Correção mantida pela AGTN (não pelo autor do occt-wasm) | BAIXA | 1 arquivo, testes de equivalência, de execução e controles negativos; pedir `EMBIND_AOT` ao mantenedor |
| `MEMORY`/`COMMUNICATION` sem teste de ponta a ponta | BAIXA | classificação coberta por teste unitário com mensagens reais |
| **F-08: publicação automática** | ALTA (processo) | ver §10; nada foi alterado |
| PowerShell nunca executado | MÉDIA | scripts revisados; o transporte CDP só se prova no Windows |

## 10. Versão e publicação (F-08) — proposta para decisão do Edson

**Estado conferido:**
- **Versão em 5 lugares**, todos "3.1.1": `tauri.conf.json`, `package.json` (raiz e desktop), `Cargo.toml` e `Cargo.lock`. Novo teste `version.test.ts` garante que concordam, sem mudar nada.
- **Na tela**, o app mostra `__APP_VERSION__` (do `apps/desktop/package.json`). O `.exe` e o NSIS usam a do `tauri.conf.json`.
- **Tags no GitHub:** `v1.1.0`, `v3.0.0`, `v3.1.0`. **Não existe `v3.1.1`.** Releases: só a v3.1.0 tem instaladores.
- **Gatilhos do `build-windows.yml`:**

  | Evento | O que faz |
  |---|---|
  | `push` na `main` ou tag `v*` | build + **publica a Release `v<versão>`** se ela não existir (cria a tag, usa `docs/release-notes/v<versão>.md`) |
  | `pull_request` | build e testes, sem publicar |
  | `workflow_dispatch` | build e testes + homologação do instalado, **sem publicar** |

- **Histórico:** o push da `main` `23a2540` (v3.1.1) em 12/11 **falhou** (cobrança). Por isso a v3.1.1 nunca virou Release no GitHub.

**Consequências:**
1. Com a cobrança resolvida, **reexecutar** a execução que falhou da `23a2540` publicaria a v3.1.1 correta (só 2D).
2. Se, em vez disso, a branch fosse mesclada antes com a versão 3.1.1, sairia uma Release **"v3.1.1" com o 3D**, colidindo com a 3.1.1 já em uso.

**Proposta (não executada):**
1. **Fechar a v3.1.1 na origem certa:** publicar a Release `v3.1.1` a partir da `main` `23a2540`, reexecutando aquela execução quando o Actions voltar. A tag `v3.1.1` fica no commit certo.
2. **Próxima versão comercial com o 3D: `3.2.0`.** Pelo semver é *minor*: muita funcionalidade nova, mas compatível (`.agtncad` v1 inalterado, abre arquivos antigos, 2D idêntico). `4.0.0` também é defensável como marco comercial ("AGTN 3D"), mas não há quebra técnica que exija major.
3. **Builds de homologação:** `3.2.0-1`, `3.2.0-2`… O pré-lançamento precisa ser **só numérico**, porque o bundler do Tauri para MSI só aceita assim<sup>[1]</sup>. Não publicar esses builds como Release comum: ou só por `workflow_dispatch` (artefato), ou ajustar o workflow para marcar `prerelease: true` quando a versão tiver "-".
4. **Antes de qualquer merge:**
   - trocar a versão nos 5 lugares (o `version.test.ts` confere);
   - criar `docs/release-notes/v3.2.0.md` (o teste exige a nota da versão);
   - conferir que a v3.1.1 já foi publicada pela `main`.

A decisão é do Edson. Nenhuma versão, tag ou Release foi criada ou alterada.

[1] Tauri bundler 1.2.0: suporte a pré-lançamento e número de build no `.msi`, "only one of each can be used and it must be numeric only" (https://v2.tauri.app/release/tauri-bundler/v1.2.0/).

## 11. Commits

Branch `feature/agtn-3d-ia`, sobre `c32f309` (ETAPA 4). A `main` não foi tocada.

| Commit | Conteúdo |
|---|---|
| `de4972c` | F-05: correção do glue no build, testes de execução sem eval, `test:sem-eval`, CSP mais restrita |
| `1f7ca6a` | F-06: diagnóstico do motor 3D, recuperação, rótulos de falha de operação |
| `eb4532a` | instrumentos: `engine_fail.py`, S10, F-09, S11 no WebView2, `security.test`, `version.test` |
| `442fb45` | estes 8 documentos `FASE4_ETAPA5_*` (+ correção de 1 linha deste relatório no commit seguinte) |

## Critérios de aceitação da etapa

| Critério | Situação |
|---|---|
| F-05 resolvido ou formalmente dependência externa | **resolvido tecnicamente** (falta só a confirmação no WebView2) |
| F-06 corrigido | sim |
| CSP ativa | sim, mais restrita |
| Motor 3D funcionando com a política proposta | sim (Node, Chromium estrito, WebKitGTK compilado) |
| OCCT inicializa | sim |
| Sólidos corretos | sim (volumes a 1e-9) |
| Booleanas | sim |
| Planificação correta | sim (área, blank, corte; DXF com SHA-256 igual) |
| 2D idêntico à referência | sim (hashes) |
| Regressão passa | sim |
| Sem perda de funcionalidade | sim |
| Documentado | 8 documentos `FASE4_ETAPA5_*` |
| WebView2 real | **PENDENTE** (obrigatório para homologação) |
