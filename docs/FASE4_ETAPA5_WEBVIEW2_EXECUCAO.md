# FASE 4 · ETAPA 5 — Execução no WebView2 real (Windows)

Data: 14/11/2026 · PC do Edson (`desktop-p4d6iou`) · branch `feature/agtn-3d-ia`.
Evidências brutas em `docs/evidencias/etapa5_webview2/`.

## Resultado

**WebView2 real: 228/228 verificações APROVADAS** em 3 repetições × 6 projetos (rodada 3).
Isso vale depois da correção **F-10**, encontrada nesta execução.

**Não é homologação Windows completa.** Faltam W1 (build MSVC oficial), W2–W4 (instalador NSIS: instalar, atualizar, desinstalar), W6 (PC sem ferramentas), P2 formal, D3–D5 e I2. Detalhes no §5.

## 1. Ambiente

| Item | Valor |
|---|---|
| Sistema | Windows 11 Pro 10.0.26200 |
| WebView2 Runtime | **157.0.4341.46** (instalado, sistema) |
| PowerShell | 5.1.26100 |
| CPU / RAM | AMD Ryzen 5 3500X · 8 GB |
| Ferramentas | sem git, Node, Rust e VS Build Tools (C: com 4 GB livres) |

O `homologacao.ps1` compila no próprio PC e por isso **não pôde rodar** (W1 continua pendente).

## 2. Como o executável foi gerado (importante)

Não havia como compilar no PC, nem com a toolchain MSVC aqui, nem pelo GitHub Actions (sem cobrança). Por isso:

- **Compilação cruzada no Linux** para `x86_64-pc-windows-gnu`:
  - linker mingw-w64 (gcc 13);
  - `std` compilada a partir do fonte da 1.97.0 (`-Zbuild-std`, com `RUSTC_BOOTSTRAP=1`), porque o proxy bloqueia o download do `rust-std` pronto;
  - `--features tauri/custom-protocol`, igual ao `tauri build`.
- Código: commit `58df155` + correção F-10.
- Executável usado na rodada 3: `agtn-cad.exe`, SHA-256 `45a22941…09ae6510`.
- Pasta portátil, sem instalador: `app\agtn-cad.exe`, `app\WebView2Loader.dll` (loader oficial da Microsoft, do crate `webview2-com-sys`) e `app\occt\occt-wasm.wasm`.

**Diferenças para o build oficial:**
- toolchain GNU em vez de MSVC;
- sem instalador;
- sem `staticVCRuntime`.

O que este teste prova é o comportamento do **WebView2 do Windows** com o app real: frontend de produção, CSP real, IPC real e gravação de arquivos pelo Rust no Windows. **Não** prova o build MSVC nem o instalador.

## 3. Execução

O script é `scripts/windows/smoke/webview2_smoke.ps1` (S1–S11, CDP no WebView2), sem alterações. Foi disparado por um `.cmd` na Área de Trabalho, com duplo clique.

| Rodada | Executável | Resultado | Observação |
|---|---|---|---|
| 1 | `e3f85a2d…` (sem F-10) | **65/76** | S9 e S9-cdp reprovam nos 6 projetos: violação `style-src-attr` (F-10). Todo o resto aprovado |
| 2 | o mesmo `e3f85a2d…` (o PC recebeu o executável antigo de novo; conferido por SHA-256) | **193/226** | igual à rodada 1, mais 1 S1 intermitente (v311, repetição 1: página ainda não carregada, "origem null"). Não se repetiu nas outras 2 repetições nem na rodada 3 |
| 3 | `45a22941…` (com F-10) | **228/228 APROVADO** | 3 repetições × 6 projetos, 0 falhas |

### O que passou no WebView2 (rodada 3, ×3)

- **S1/S1b**: o app abre pela linha de comando com um caminho que tem espaço, acento e `#`.
- **S2/S3 (motor 3D):** worker, WebAssembly e OCCT 8 sobem; motor pronto em **277–298 ms** (medianas).
- **S4/S4b**: sólidos com o volume de referência a 1e-9, nos 5 projetos 3D; todas as operações sem erro.
- **S5**: a operação booleana dá o volume exato.
- **S6**: planificação com área, blank e corte iguais aos de referência.
- **S7:**
  - DXF R2000 e R12 conferidos no app, com **SHA-256 idêntico ao de referência** (o mesmo do Linux e do Node);
  - DXF gravado pelo Rust e relido igual;
  - DWG gravado pelo conversor nativo e relido.
- **S8**: `.agtncad` salvo e relido, em caminho com acento.
- **S2D**: o desenho 2D da v3.1.1 abre com os 114 objetos.
- **S9/S9-cdp**: nenhuma violação de CSP e nenhum erro de segurança no console da página e do worker (depois da F-10).
- **S11 (CSP no worker):** `{"wasm":true,"eval":"permitido (worker SEM CSP)"}`. **No WebView2, o Tauri 2.12.5 também não aplica a CSP ao worker**, igual ao Linux.

## 4. Achado F-10 (corrigido)

- **Sintoma:** em todo início, o WebView2 registra:

  > Applying inline style violates the following Content Security Policy directive 'style-src 'self' 'unsafe-inline' 'nonce-…''. Note that 'unsafe-inline' is ignored if either a hash or nonce value is present in the source list.

- **Causa:**
  - O Tauri acrescenta um `nonce` ao `style-src` para liberar o bloco `<style>` do `index.html`.
  - Pela especificação de CSP, quando há nonce, `'unsafe-inline'` é **ignorado**.
  - Com isso, o atributo `style="width:240px;margin-bottom:16px"` do logo da tela de abertura é bloqueado.
- **Efeito:** só visual (o logo da abertura aparece sem o tamanho definido). Nenhuma função afetada.
- **Origem:** já existe na `main` v3.1.1 (`git show main:apps/desktop/index.html`). Não foi introduzido pela ETAPA 5. O Linux (WebKitGTK) e o Chromium em teste não o acusaram; só o WebView2 real mostrou.
- **Correção:** o estilo foi para o bloco `<style>` (`#splash img { width: 240px; margin-bottom: 16px; }`) e o atributo foi removido. Sem mudança visual pretendida.
- **Proteção:**
  - novo teste em `apps/desktop/src/security.test.ts`: o `index.html` não pode ter atributo `style=`;
  - verificado de novo no WebView2 real (rodada 3: S9/S9-cdp OK nos 18 casos).
- **Nota:** o `'unsafe-inline'` do `style-src` é **inócuo** no Tauri, porque o nonce o anula. Os estilos do React (`style={{…}}`) entram por CSSOM e não são afetados pela CSP. A remoção desse `'unsafe-inline'` fica como proposta para a próxima etapa, depois de nova rodada no WebView2.

## 5. Desempenho no WebView2 (rodada 3, mediana de 3)

| Projeto | Janela (ms) | Motor pronto (ms) | Regeneração (ms) | Ida e volta UI↔worker (ms) | Memória app + WebView2 (MB) | CPU (s) |
|---|---|---|---|---|---|---|
| `etapa2_completo` | 788 | 298 | 619 | 0,1 | 512 | 5,6 |
| `fase3_peca_parametrica` | 609 | 277 | 229 | 0,1 | 487 | 4,3 |
| `fase2_projeto_3d` | 619 | 290 | 202 | 0 | 492 | 4,0 |
| `etapa1_chapa` | 630 | 283 | 404 | 0 | 488 | 4,7 |
| `grande_120furos` | 619 | 291 | 2 216 | 0,1 | 567 | 8,3 |
| `v311_desenho` (só 2D) | 619 | — | — | — | 370 | 2,6 |

- A memória é a soma de 7 processos: `agtn-cad.exe` mais 6 `msedgewebview2.exe`.
- O "CPU (s)" é o total do teste inteiro (abrir, regenerar, planificar, exportar, gravar), não o consumo parado.
- No WebView2, o motor fica pronto mais rápido que no WebKitGTK do Linux (~1 000–1 200 ms).

## 6. O que continua pendente para homologação Windows

| Item | Situação |
|---|---|
| W1 build MSVC + testes no Windows | PENDENTE: o PC não tem as ferramentas. Instalar no D: precisa da autorização do Edson |
| W2/W3/W4 instalador NSIS (instalar, atualizar sobre a 3.1.1, desinstalar) | PENDENTE: depende do W1 ou do Actions |
| W5 caminhos com espaço e acento | **coberto aqui** (S1b, S7-disco, S8) com o executável portátil |
| W6 PC sem ferramentas | **parcial**: este PC não tem ferramentas de desenvolvimento e o app rodou, mas sem instalador |
| W7 funcionamento no WebView2 | **APROVADO** com o executável GNU portátil (228/228); falta repetir com o instalador oficial |
| P2 desempenho no Windows | medido (§5); falta a referência do instalado |
| D3–D5 (ZWCAD/AutoCAD, CAM do laser), I2 (peças reais) | PENDENTE (AGTN) |
