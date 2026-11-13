# FASE 4 · ETAPA 4 — Auditoria técnica

Data: 13/11/2026 · Branch `feature/agtn-3d-ia` · `main` = `23a2540` (v3.1.1), **não alterada**.
Ambiente: contêiner Linux x86_64, 2 vCPU Xeon 2,10 GHz, 7 GB · Node 22.23.4 · Rust 1.97.0 · Tauri 2.12.5 ·
occt-wasm 5.17.1 · ezdxf 1.4.5. **Não há Windows nesta sessão.**

## 1. Estado inicial (conferido, não copiado do relatório)

| Item | Resultado |
|---|---|
| Branch local | `feature/agtn-3d-ia`, sem alteração pendente |
| HEAD local = remoto | `ab0ecce` = `ab0ecce` |
| `main` local = remota | `23a2540` = `23a2540`, ancestral da branch |
| Commits da ETAPA 3 | `fa604c6`, `1d3eba4`, `ab0ecce`: existem, autor Edson dos Reis, mensagens conferem |
| Documentos da ETAPA 3 | os 8 `docs/FASE4_ETAPA3_*.md`, `tests/industrial/CHECKLIST_DXF.md` e `scripts/windows/homologacao.ps1` presentes |
| `bend.ts` / `tray.ts` | blob idêntico ao da main (`524d4033c60b` / `37246476931e`) |
| `modules/dxf`, `core/geometry`, `core/document`, `modules/plot` | sem diferença da main, salvo 1 teste novo (`regressao2d.test.ts`) |
| Release v3.1.1 no GitHub | **não existe**: só a v3.1.0 tem instalador (`AGTN.Industrial.CAD_3.1.0_x64-setup.exe`) |
| GitHub Actions | últimas 3 execuções (12/11) falharam (cobrança) |

## 2. Reprodução da ETAPA 3 (não foi confiar no relatório)

| Verificação | ETAPA 3 dizia | Refeito agora |
|---|---|---|
| typecheck | OK | OK |
| Vitest | 571 + 1 pulado | **572/572** com `AGTN_PERF=1` (o "grande" também) |
| `cargo test --release` com DWG reais | 15/15 | **15/15** |
| e2e Chromium | 138/138 | 34 + 25 + 22 + 15 + 18 + 24 = **138/138**; `load3d` OK |
| Hashes 2D da main | iguais | **regerados agora** num worktree da main `23a2540` e na branch: `.agtncad`, DXF R12, DXF R2000 e SVG com SHA-256 idênticos; PDF idêntico com `CreationDate` normalizada |
| 20 DXF entregues no zip da ETAPA 3 | — | regerados pelo código atual: **20/20 byte a byte iguais** aos do zip |
| F-01, saída idêntica | 3 007 esboços | **outra semente**, 2 001 esboços e 23 050 regiões: idêntico; 120 furos 9 896 → 13 ms |
| Suíte com checkout estilo Windows (`core.autocrlf=true`) | não testado | ETAPA 3: **571 + 1 pulado**; ETAPA 4 (com `.gitattributes`): **578 + 1 pulado**, 0 falhas |

**Divergência encontrada na reprodução:** a 1ª execução do `e2e_etapa2` desta etapa terminou sem saída. A causa foi minha: editei `Workspace3D.tsx` com o servidor de desenvolvimento rodando, e a recarga automática derrubou o teste. Repetido em seguida: 24/24.

## 3. Falhas encontradas na ETAPA 4

Campos: ID · gravidade · módulo · descrição · como reproduzir · esperado · obtido · causa raiz · correção · teste · status.

### F-04 · ALTA · `scripts/windows/*.ps1` — o script da ETAPA 3 não abriria no Windows PowerShell 5.1

| Campo | Conteúdo |
|---|---|
| Descrição | O `homologacao.ps1` entregue na ETAPA 3 estava em UTF-8 **sem BOM**. O Windows PowerShell 5.1 (o que vem no Windows) lê .ps1 sem BOM como ANSI (cp1252). |
| Como reproduzir | Decodificar o arquivo de `fa604c6` como cp1252. A linha 116 `"FALHOU — ver homologacao.log"` vira `"FALHOU â€” ver…"`, e o byte 0x94 do "—" vira `”`, que o PowerShell trata como **aspas**. |
| Esperado | O script roda com `powershell -File homologacao.ps1`. |
| Obtido | A string fecha no meio da linha e sobra texto solto. O PowerShell analisa o arquivo inteiro antes de executar, então o script **não abre** (erro de análise). |
| Causa raiz | Arquivo gravado sem BOM; não havia teste de codificação. |
| Correção | BOM UTF-8 nos três `.ps1`. Teste novo `apps/desktop/src/scripts_windows.test.ts`. |
| Teste | O teste **falha** com o arquivo da ETAPA 3 (conferido: 1 reprovado) e passa com o novo (6/6). |
| Status | **CORRIGIDA**. Evidência por simulação da decodificação; o PowerShell em si não foi executado (ver §5). |

### F-05 · ALTA (risco latente; **não** é falha reproduzida no alvo) · motor 3D × CSP

| Campo | Conteúdo |
|---|---|
| Descrição | O código de ligação do OCCT (embind, `occt-wasm-*.js`) gera funções com `Function(...)` dentro do worker do motor. A CSP de produção (`script-src 'self' 'wasm-unsafe-eval'`) **proíbe** isso. |
| Como reproduzir | `MODO=estrito python3 tests/e2e/csp_chromium_smoke.py` (CSP também no script do worker). Detalhe capturado do worker: "Evaluating a string as JavaScript violates the following Content Security Policy directive… 'unsafe-eval' is not an allowed source". |
| Esperado | Motor inicia. |
| Obtido | No modo estrito: "Não foi possível iniciar o motor 3D", nos 5 arquivos. No modo igual ao Tauri: **inicia** (61/61). No app Tauri compilado no Linux: **inicia** (58/58). |
| Causa raiz | O Tauri 2.12.5 só manda o cabeçalho CSP nas respostas `.html` (`tauri/src/manager/mod.rs`, `is_html`). O script do worker chega sem CSP, e o Chromium aplica ao worker a política da resposta dele, não a do documento. O motor depende desse comportamento. |
| Correção | **Nenhuma no produto.** Não há prova de falha no WebView2, e as saídas (`'unsafe-eval'` ou recompilar o OCCT sem geração dinâmica) mudam segurança ou motor sem necessidade comprovada. O teste de fumaça agora captura o erro detalhado do worker (S2). |
| Teste | `csp_chromium_smoke.py` nos dois modos; `tauri_smoke.py`; no Windows, `webview2_smoke.ps1` (S2, S9-cdp). |
| Status | **RISCO ABERTO** até o WebView2 real. Se uma atualização do Tauri passar a mandar CSP em todos os arquivos, o 3D para; o S2 detecta. |

### F-06 · BAIXA · `Workspace3D.tsx` — erro do motor sem detalhe na tela

| Campo | Conteúdo |
|---|---|
| Descrição | Quando o motor falha, a tela mostra só "Não foi possível iniciar o motor 3D (OCCT)". O motivo real (`details`) chega do worker e não é exibido. |
| Reprodução | Igual à F-05 no modo estrito. |
| Correção | Nenhuma (UI do produto; não é necessária para homologar). Recomendação: mostrar `details` num "ver detalhes". |
| Status | **ABERTA (recomendação)**. |

### F-07 · BAIXA · instrumento de teste (não é o produto) — corrida no teste de fumaça

| Campo | Conteúdo |
|---|---|
| Descrição | Na 1ª versão, o teste entrava no 3D antes de o arquivo da linha de comando abrir e guardava o gancho antigo: "corpos não regenerados em 120 s" em 2 de 4 arquivos. |
| Causa raiz | O teste lia uma referência velha de `window.__agtn3d`. O app estava certo: com o 3D aberto antes, a tela mostrou o corpo (252 triângulos). |
| Correção | O teste espera o título do arquivo (S1b) e relê o gancho a cada consulta. |
| Status | **CORRIGIDA**. App compilado 58/58 depois. |

### F-08 · ALTA (processo, não código) · merge na main publicaria uma Release automaticamente

| Campo | Conteúdo |
|---|---|
| Descrição | O `build-windows.yml` da main cria tag e Release quando a versão do `tauri.conf.json` ainda não tem Release. A branch está com versão **3.1.1**, e a v3.1.1 **não tem Release**. |
| Obtido | Um push/merge na main, com o Actions funcionando, publicaria **"v3.1.1"** com todo o 3D, sem pré-lançamento. |
| Correção | Nenhuma (decisão de versão e publicação é do Edson). |
| Status | **ABERTA — decisão do Edson antes de qualquer merge**: definir a versão (ex.: 3.2.0 ou 3.2.0-rc) e as notas `docs/release-notes/v<versão>.md`. |

### Outras observações (BAIXA)

- O texto de dobra usa `%%d` para o "°" (padrão AutoCAD). O ZWCAD e o AutoCAD mostram "°"; um CAM pode mostrar `%%d`. Vai conferido na ficha do CAM.
- O instalador NSIS usa o modo padrão do WebView2 (`downloadBootstrapper`): num PC **sem internet e sem WebView2**, a instalação falha. Opções: `embedBootstrapper` ou `offlineInstaller` (decisão de empacotamento).
- `homologacao.ps1` (ETAPA 3): a etapa "git fetch + checkout + pull" usava só o código de saída do último comando, e `$LASTEXITCODE` podia vir da etapa anterior. Agora é zerado em cada etapa.
- O VC++ Runtime vai **estático** no executável: `tauri-build` 2.7.4 tem `staticVCRuntime = true` por padrão. Não depende de "Visual C++ Redistributable" na máquina final (W6).

## 4. Alterações de código de produto nesta etapa (com justificativa)

| Arquivo | Mudança | Justificativa | Efeito no app normal |
|---|---|---|---|
| `apps/desktop/src/ws3d/Workspace3D.tsx` | o gancho de teste `window.__agtn3d` (só existe com `localStorage["agtn.e2e"]="1"` ou em desenvolvimento) passa a devolver `text`/`bytes` do DXF da planificação e ganha `serialize()` | Sem isso não dá para provar, no WebView2, que o DXF é idêntico ao de referência (SHA-256) nem gravar pelo mesmo caminho do diálogo (`write_file` + CP1252) | **Nenhum**: o bloco só roda com a flag de teste; os testes antigos que liam `.ok/.checks` continuam iguais |

Nada mudou em:
- `bend.ts`, `tray.ts`, motor geométrico (`build.ts`, `flat.ts`, solver);
- exportador 2D (`modules/dxf`) e formato `.agtncad`;
- `tauri.conf.json`, CSP e Rust (`lib.rs`, `cadconv.rs`).

## 5. Limites desta auditoria

- **Nenhum PowerShell foi executado.** A instalação do `pwsh` para Linux (SHA-256 conferido com o `hashes.sha256` oficial) foi **bloqueada duas vezes** pela proteção da sessão. Os `.ps1` foram revisados linha a linha, e o JavaScript que eles injetam foi validado no app compilado e no Chromium. O transporte (WebSocket/CDP em PowerShell) só será provado no Windows.
- **Não houve acesso a pastas do PC da AGTN.** `connectedFolders` estava vazio, e o pedido anterior (ETAPA 3) foi negado. Não foi repetido.
- O Chromium **não** é o WebView2. As provas no Chromium e no WebKitGTK reduzem o risco, mas não substituem o W7.
