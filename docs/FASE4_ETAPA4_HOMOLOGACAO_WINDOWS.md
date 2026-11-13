# FASE 4 · ETAPA 4 — Homologação Windows (W1–W7)

Data: 13/11/2026.

## Resultado: **PENDENTE**

Não há Windows nesta sessão. **Nenhum resultado de Windows foi inventado.** Tudo está preparado para rodar no PC da AGTN, ou no GitHub Actions se a cobrança for resolvida.

| ID | Validação | Status | O que cobre (script) |
|---|---|---|---|
| W1 | Build completo Windows | PENDENTE | `homologacao.ps1`: ambiente, `npm ci`, typecheck, vitest, `cargo test` com DWG reais, `tauri build` NSIS |
| W2 | Instalação limpa | PENDENTE | `validar_instalado.ps1`: `/S`, registro, pasta, `agtn-cad.exe`, `occt\occt-wasm.wasm` (tamanho e SHA-256), atalhos |
| W3 | Atualização sobre a v3.1.1 | PENDENTE | `-InstaladorAnterior`: instala a anterior, confere, instala a nova por cima. Prova pelo **hash** do executável (as duas dizem 3.1.1, ver F-08). Depois, teste de fumaça e desenho 2D da v3.1.1 com 114 objetos |
| W4 | Desinstalação | PENDENTE | `/S` do desinstalador: registro e pasta do programa removidos, sobras listadas, projeto do usuário em Documentos **intacto** (hash), dados do app que ficam |
| W5 | Caminhos com espaço e acento | PENDENTE | projetos abertos pela linha de comando de `…\Projetos AGTN\Peça ção #1 (rev.2)\`; DXF, DWG e `.agtncad` gravados e relidos pelo Rust ali |
| W6 | Sem ferramentas de desenvolvimento | PENDENTE | `pacote_validacao\` roda só com PowerShell 5.1. Vira APROVADO **só** se não houver `node`/`rustc`/`cargo` no PATH |
| W7 | Funcionamento completo | PENDENTE | automático: `webview2_smoke.ps1` (S1–S9). Manual: roteiro abaixo |

## Auditoria do script da ETAPA 3 (o que ele cobria e o que faltava)

| Ponto | ETAPA 3 | ETAPA 4 |
|---|---|---|
| W1 build e testes | sim | sim, com etapa zerando `$LASTEXITCODE` |
| Abrir no PowerShell 5.1 | **não abriria** (sem BOM, F-04) | BOM + teste |
| Checkout com CRLF | não previsto | `git -c core.autocrlf=false` + `.gitattributes`; suíte passa mesmo com CRLF |
| W2–W7 | não | `validar_instalado.ps1` + `webview2_smoke.ps1` |
| GPU, resolução, WebView2, versão do instalador | WebView2 sim; GPU/resolução não | todos |
| Resultado por teste | só etapas do build | `resumo.json` + `resumo_instalado.json` + `webview2_resultado.json` (cada verificação com id, ok, detalhe, ms) |

## Auditoria do carregamento do motor 3D (o risco principal)

| Ponto | Como é | Situação |
|---|---|---|
| `occt-wasm.wasm` no pacote | `bundle.resources` → `occt/occt-wasm.wasm` (21,3 MB) | no `.deb` gerado agora: presente, SHA-256 = `node_modules` (`cea5998c…`). No NSIS: o W2 confere |
| Leitura do `.wasm` | comando Rust `read_engine` (lista fechada de nomes, `BaseDirectory::Resource`) → IPC → `ArrayBuffer` | Linux compilado: OK. Windows: IPC por `http://ipc.localhost` está na CSP (`connect-src`) |
| Worker | `new Worker(new URL("./engine.worker.ts"), { type: "module" })`, mesmo origem (`http://tauri.localhost` no Windows) | `worker-src 'self' blob:` cobre |
| Compilação WASM | `WebAssembly.instantiate` | `'wasm-unsafe-eval'` cobre |
| Código dinâmico do embind no worker | `Function(...)` | **proibido pela CSP**; funciona porque o Tauri não manda CSP ao script do worker (F-05) |
| VC++ Runtime | estático (`staticVCRuntime` padrão `true` no tauri-build 2.7.4) | sem dependência |
| WebView2 Runtime | NSIS `downloadBootstrapper` (padrão) | PC sem internet e sem WebView2: instalação falha (decisão de empacotamento) |
| Permissões | `capabilities/default.json`: `core:default`, janela, diálogos; comandos próprios do app | sem mudança na ETAPA 4 |
| Persistência | `write_atomic` (salvamento interrompido não corrompe; teste Rust) | W5 grava e relê em caminho com acento |
| DXF / DWG | DXF por `write_file` (bytes CP1252); DWG por `dwg_write_from_dxf` (conversor próprio em processo filho) | S7-disco-dxf, S7-dwg |

## O teste de fumaça do WebView2 (S1–S9)

`scripts/windows/smoke/webview2_smoke.ps1` precisa só de PowerShell 5.1. Para cada projeto:
1. abre o app instalado com o arquivo na linha de comando;
2. liga a depuração do WebView2 **só para aquele processo** (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port`) e usa uma pasta de dados separada, sem mexer no perfil do usuário;
3. pelo protocolo de depuração (CDP), recarrega com um ouvinte de violação de CSP desde o primeiro script;
4. escuta console, log e exceções **da página e do worker** (`Target.setAutoAttach`);
5. injeta `agtn_smoke.js`, mede memória e CPU de todos os processos (app + `msedgewebview2.exe`) e fecha.

| ID | Pergunta do Edson | Verificação |
|---|---|---|
| S1 / S1b | o app abre? | interface 2D montada; arquivo da linha de comando aberto (título) |
| S2 | o motor WASM inicializa? | worker + WebAssembly, ponto verde. Se falhar: mensagem da tela **e** detalhe do worker |
| S3 | o OCCT carrega? | kernel "OCCT 8 (WebAssembly)" e tempo de init |
| S4 / S4b | um sólido 3D é criado? | volumes de cada corpo = referência a 1e-9 (`referencias.json`, calculado no Node com o mesmo `.wasm`); nenhuma operação com erro |
| S5 | booleanas funcionam? | peça da FASE 3 (extrusão + **corte** + arredondamento) com volume exato |
| S6 | a planificação funciona? | estado "válida", área, blank e corte = referência |
| S7 | a exportação funciona? | DXF R2000 e R12 conferidos no app; **SHA-256 igual ao do Node**; DXF gravado pelo Rust e relido igual; DWG gravado pelo conversor nativo e relido |
| S8 | persistência? | `.agtncad` salvo e relido igual (caminho com acento) |
| S9 / S9-cdp | sem erro de segurança no console? | ouvinte `securitypolicyviolation` + CDP (página e worker) sem "Content Security Policy" / "Refused to" / EvalError |
| S2D | 2D da v3.1.1 | `v311_desenho.agtncad` abre com 114 objetos |

Projetos: `etapa2_completo`, `fase3_peca_parametrica`, `fase2_projeto_3d`, `etapa1_chapa`, `grande_120furos` (sintético, 2000×1000) e o desenho 2D da v3.1.1.

### Validação do instrumento (Linux; NÃO é resultado de Windows)

| Onde | Resultado | O que prova |
|---|---|---|
| App Tauri **compilado e instalado** (`.deb`), WebKitGTK, CSP real, IPC real (`tests/e2e/tauri_smoke.py`) | **58/58** | O JS do teste funciona no app real, incluindo DXF/DWG/`.agtncad` gravados pelo Rust em `Peça ção #1 (rev.2)` e SHA-256 do DXF idêntico ao do Node |
| Build de produção no **Chromium** com a CSP aplicada como o Tauri aplica, só no HTML (`csp_chromium_smoke.py`, MODO=tauri) | **61/61** (sem as gravações, que precisam do Tauri) | No motor Chromium (família do WebView2), worker + WASM + OCCT funcionam com a CSP de produção |
| Mesmo build, CSP **também no worker** (MODO=estrito) | motor **não inicia** (esperado) | Mostra a dependência da F-05 e que o S2 a detecta, com o motivo exato |

O transporte em PowerShell (WebSocket/CDP) **não foi executado**: o `pwsh` foi bloqueado nesta sessão. É a parte que só o Windows prova.

## Como rodar no PC da AGTN

```powershell
# 1) build + testes + instalador + validação do instalado (precisa de Node 22, Rust MSVC, VS Build Tools)
powershell -ExecutionPolicy Bypass -File .\homologacao.ps1 [-InstaladorAnterior "C:\…\setup_3.1.1.exe"]

# 2) num PC SEM ferramentas (W6): copiar C:\AGTN_HOMOLOGACAO\<data>\pacote_validacao\ e rodar
powershell -ExecutionPolicy Bypass -File .\validar_instalado.ps1 -Instalador ".\AGTN Industrial CAD_3.1.1_x64-setup.exe"
```

Saída em `C:\AGTN_HOMOLOGACAO\<data-hora>\`:
- `homologacao.log`, `resumo.json` (W1 + o resumo da validação);
- o instalador com SHA-256;
- `instalado\homologacao_instalado.log` e `resumo_instalado.json` (W2–W7, P2);
- `instalado\webview2\` (log, resultado, console de cada projeto).

**Alternativa:** com a cobrança do Actions resolvida, rodar "CI e build Windows" manualmente na branch (`workflow_dispatch`). O passo "Homologação do instalado (só manual)" roda o mesmo `validar_instalado.ps1` no Windows PowerShell 5.1 do runner e guarda os resultados no artefato `homologacao-windows`. Num disparo manual, nada é publicado (a Release só acontece em push na main). **O runner não é o hardware da AGTN**: vale para W1/W2/W4/W5/W7, não para P2.

## Roteiro manual do W7 (o que o teste automático não cobre)

| # | Ação no app instalado | Esperado | OK |
|---|---|---|---|
| 1 | Abrir com duplo clique um `.agtncad` em pasta com acento | abre no AGTN | ☐ |
| 2 | 3D: criar chapa (base 200×100, T 2) e abas em 2 arestas | sólido e árvore sem erro | ☐ |
| 3 | Alívio retangular, canto sobreposto, recorte plano atravessando dobra | sem erro; volume muda | ☐ |
| 4 | Desdobrar / redobrar | volta ao mesmo volume | ☐ |
| 5 | Selecionar face/aresta/vértice e medir | valores coerentes | ☐ |
| 6 | DXF chapa R2000 e R12 (diálogo), salvar em `Peça ção\` | "gravado e conferido" | ☐ |
| 7 | Importar e exportar STEP | abre no Fusion 360 | ☐ |
| 8 | 2D: abrir um DXF e um DWG da v3.1.1; imprimir/PDF | igual à 3.1.1 | ☐ |
| 9 | Fechar com alteração não salva | mesmo comportamento da 3.1.1 | ☐ |
| 10 | Tela vertical (monitor da CNC) | layout em retrato | ☐ |

Com aprovação do Edson na tela, posso fazer este roteiro por controle remoto: o app instalado é um app comum, com controle total.
