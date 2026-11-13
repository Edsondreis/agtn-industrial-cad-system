# FASE 4 · ETAPA 3 — Windows real (build, instalador e testes funcionais)

Data: 13/11/2026.

## Resultado: **PENDENTE** — nenhum build Windows foi executado nesta etapa

Nada desta seção foi declarado como testado. Os resultados de build vão vir do log do script rodado no PC da AGTN.

| # | Verificação | Status | Por quê |
|---|---|---|---|
| W1 | Build completo no Windows: tsc, vitest, cargo test, `tauri build` NSIS | **PENDENTE** | ver "Bloqueios" |
| W2 | Instalação limpa, abrir e reabrir | **PENDENTE** | depende do W1 |
| W3 | Atualizar por cima da 3.1.1 | **PENDENTE** | depende do W1 e do instalador 3.1.1 |
| W4 | Desinstalar, conferir limpeza e projetos do usuário preservados | **PENDENTE** | depende do W2 |
| W5 | Caminhos com espaço, acento e caracteres especiais | **PENDENTE** | depende do W2 |
| W6 | PC sem ferramentas de desenvolvimento (só o WebView2 do sistema) | **PENDENTE** | depende do W1; idealmente outro PC |
| W7 | Funcional: `.agtncad`, STEP, seleção, medição, chapa, abas, alívios, cantos, recortes, desdobrar, DXF | **PENDENTE** | depende do W2 |
| R2 (Windows) | DWG no conversor nativo, no Windows | **PENDENTE** | o script roda `cargo test` com as amostras DWG |
| P2 | Desempenho no hardware real | **PENDENTE** | depende do W2 |

## Bloqueios (verificados, não supostos)

| Caminho | Situação | Evidência |
|---|---|---|
| GitHub Actions (`windows-latest`) | **bloqueado** | a última execução falhou em 4 s por cobrança da conta GitHub |
| Build cruzado Linux → Windows nesta sessão | **bloqueado** | o proxy da sessão recusa `static.rust-lang.org` (rust-std MSVC) e os servidores da Microsoft (CRT/SDK): 403 |
| PC da AGTN (`desktop-edn3mjc`, Windows x64) por controle de tela | **não dá para o build** | terminais e IDEs ficam no nível "só clique": não é possível digitar comandos no PowerShell |
| Pasta do PC da AGTN (para copiar arquivos) | **negado** | o pedido de acesso a `~/Documents` foi recusado pela proteção da sessão. Não foi contornado |

## O que foi preparado

### `scripts/windows/homologacao.ps1` (W1)

Não precisa de administrador, não instala nada e não mexe na main. Passos:
1. Registra o ambiente: versão do Windows, CPU, RAM, Node, npm, git, rustc, cargo, WebView2 (registro) e Visual Studio Build Tools (vswhere). Confere os pré-requisitos.
2. Clona ou atualiza a branch `feature/agtn-3d-ia` em `%USERPROFILE%\agtn-homologacao\`.
3. Roda `npm ci`, typecheck, `npx vitest run`, `cargo test --release` (com `AGTN_DWG_SAMPLES`) e `npm run tauri build -- --bundles nsis`.
4. Copia o instalador com o SHA-256 e grava `homologacao.log` e `resumo.json` em `C:\AGTN_HOMOLOGACAO\<data-hora>\`.

```powershell
powershell -ExecutionPolicy Bypass -File .\homologacao.ps1
```

O script está no pacote `AGTN_HOMOLOGACAO_ETAPA3.zip`, já entregue, e no repositório.

### Roteiro W2–W7 (depois do build)

1. **W2:** instalar o `.exe` gerado. Abrir, fechar, abrir de novo. Anotar a pasta de instalação e a versão em "Sobre".
2. **W3:** num PC com a 3.1.1 instalada, instalar por cima. Conferir que os projetos 2D abrem iguais.
3. **W4:** desinstalar pelo Painel de Controle. Conferir que a pasta do programa sumiu e que os `.agtncad` do usuário continuam.
4. **W5:** salvar e abrir em `C:\Projetos AGTN\Peça ção #1 (rev.2)\peça.agtncad`. Exportar DXF e STEP no mesmo lugar.
5. **W7:** no app instalado:
   - abrir `modules/sheet3d/src/fixtures/etapa2_completo.agtncad` (e os das FASES 2, 3 e ETAPA 1);
   - criar uma chapa com abas, alívio, canto e recorte;
   - desdobrar e exportar DXF R2000 e R12;
   - importar e exportar STEP;
   - medir uma face;
   - conferir o 2D (abrir um DXF/DWG da v3.1.1).

   Com aprovação do Edson na tela, posso fazer o W7 por controle de tela: o app instalado é um app comum, com controle total.

## Risco que só o Windows responde

A CSP do app mudou em relação à v3.1.1: agora tem `'wasm-unsafe-eval'` e `worker-src 'self' blob:`, para o OCCT em WebAssembly no worker. No Chromium e no WebKitGTK (app Tauri compilado no Linux, FASES 2 a 4) funciona. **No WebView2 ainda não foi visto.** Se o WebView2 bloquear, o 3D não abre, e o 2D precisa continuar funcionando. Isso é a primeira coisa a olhar no W2.
