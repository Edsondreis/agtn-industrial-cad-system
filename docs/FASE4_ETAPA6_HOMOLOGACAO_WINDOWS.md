# FASE 4 · ETAPA 6 — Homologação nativa Windows (MSVC, NSIS, ciclo de instalação)

**Data:** 14/11/2026
**PC:** do Edson (`desktop-p4d6iou`)
**Branch:** `feature/agtn-3d-ia`
**`main`:** `23a2540` (v3.1.1), **intocada**. Sem merge, sem tag, sem Release.
**Evidências:** `docs/evidencias/etapa6_windows/`. Os scripts usados estão em `scripts/`, os logs em `logs/`, o ciclo em `ciclo_1/` e `reteste/`.

## Veredito: **APROVADO COM RESSALVAS**

- Compilação nativa MSVC, instalador NSIS, instalação limpa, atualização sobre a 3.1.1, desinstalação e uso sem ferramentas de desenvolvimento: **aprovados no Windows 11 real, com evidência executada**.
- As ressalvas estão em §8:
  - instalador sem assinatura digital;
  - resíduo de associação `.agtncad` depois de desinstalar uma versão que foi atualizada (já existia na v3.1.x);
  - itens de processo.
- **Não é homologação industrial.** Continuam pendentes os testes externos com ZWCAD/AutoCAD (D3/D4), o CAM do laser (D5) e as peças reais (I2).

## 1. Ambiente

| Item | Valor |
|---|---|
| Windows | 11 Pro 25H2, build 26200.9711, x64. Ryzen 5 3500X (6 lógicos), 7,9 GB RAM |
| UAC | ligado (área de trabalho segura). **1 elevação** em toda a etapa (VS Build Tools) |
| Reinicialização | havia uma pendente (Windows Update). Não foi necessário reiniciar; o VS terminou com código 0, sem pedir reinício |
| MSVC | VS Build Tools 2022 **17.14.45**: `VC.Tools.x86.x64` (**MSVC 14.44**) + `Windows11SDK.26100` |
| Windows SDK | 10.0.26100 (instalado como 10.1.26100.9457) em **`D:\Windows Kits\10`** |
| Rust | **1.97.0** (2d8144b78), host `x86_64-pc-windows-msvc`, via rustup em `D:\AGTN_DEV\rust` (sem mexer no PATH) |
| Node / npm | **22.23.5** / 10.9.9 (zip oficial, SHA-256 conferido), em `D:\AGTN_DEV\tools\node` |
| Git | **2.56.1** (PortableGit, assinatura válida, SHA-256 = digest do GitHub) |
| Tauri | crate 2.12.5 · CLI 2.12.4 · wry 0.57.1 · webview2-com 0.39.1. NSIS baixado pelo próprio Tauri em `%LOCALAPPDATA%\tauri` (10 MB) |
| WebView2 Runtime | **157.0.4341.46** (sistema) |
| Outros | Vite 8.3.6 · occt-wasm 5.17.1 · PowerShell 5.1.26100 · Defender ativo (nenhuma exclusão foi criada) |

**Espaço usado:**

| Unidade | Antes | Depois | Usado | Onde |
|---|---|---|---|---|
| **C:** | 147,1 GB livres | 144,5 GB livres | **2,6 GB** | Medido no fim (não havia medida por pasta antes): `C:\ProgramData\Package Cache` 0,73 GB, instalador do VS 0,17 GB, `ProgramData\Microsoft\VisualStudio` 0,02 GB, NSIS do Tauri 0,01 GB, perfil do app 0,01 GB |
| **D:** | 449,5 GB livres | 439,5 GB livres | **10,0 GB** | `D:\AGTN_DEV` 8,8 GB (BuildTools 1,63; cache do VS 0,57; Rust 1,07; Git+Node 0,48; código e builds 4,42; homologação 0,47) e `D:\Windows Kits` 1,68 GB |

**PATH e variáveis:** nenhuma alteração permanente, nem de usuário nem de máquina (conferido no fim). Tudo foi definido por processo, dentro dos scripts.

**Código no PC:** veio por *git bundle* gerado aqui, sem credenciais do GitHub no PC.
- Na clonagem, os hashes conferiram: branch `6057c94…`, `main` `23a2540…`.
- Atualização só por *fast-forward*: `c35c0a0`, depois `56dee72`.

## 2. Compilação nativa — W1: **APROVADO**

| Etapa (MSVC, no PC) | Resultado |
|---|---|
| `npm ci` | OK (23–29 s) |
| Typecheck TS | OK |
| vitest, commit final `56dee72` | **629 aprovados**, 0 reprovados, 2 pulados (desempenho pesado, opcional) |
| `test:sem-eval` (V8 com `--disallow-code-generation-from-strings`) | **629 aprovados**, 0 reprovados |
| `cargo test --release` com DWG reais | **14/14**. O 15º do Linux (`oda_fallback_with_fake_oda`) é `#[cfg(unix)]` |
| `tauri build --bundles nsis`, branch | OK: 630 s (frio) / 382 s (incremental) |
| `tauri build --bundles nsis`, `main` 3.1.1 | OK: 605 s (só para o teste de atualização; a `main` não foi alterada) |

**Erros encontrados e corrigidos (só testes e instrumentos; o produto não mudou):**

| ID | Causa comprovada | Correção | Commit |
|---|---|---|---|
| F-11 | `scripts_windows`, `security` e `version` montavam a raiz com `new URL(...).pathname`. No Windows isso vira `D:\D:\...` (ENOENT) | `fileURLToPath` | `c35c0a0` |
| F-11b | `scripts_windows` comparava caminhos com `/`, mas o Windows devolve `\` | normaliza o separador | `c048b67` |
| F-12 | `perf2` estourava os 5 s padrão do vitest (5,6 s neste PC); o próprio teste aceita até 20 s por caso | tempo do vitest em 120 s; o limite do teste continua 20 s | `c35c0a0` |
| F-13 | **Instrumento:** o `webview2_smoke.ps1` recarregava a página enquanto ela ainda estava em `about:blank` com a navegação pendente, e a recarga cancelava a abertura do app. Com o app nativo isso acontecia em toda execução (eventos CDP em `ciclo_1/`) | espera a página do app carregar antes de recarregar | `56dee72` |

Avisos (nenhum afeta o produto):
- MSVC: `linker stdout: Criando biblioteca ...agtn_cad_lib.dll.lib e objeto .exp`. É informativo, do `cdylib`.
- Vite: "import sem extensão no `vite.config.ts`" (`configLoader: 'native'`, futuro). Fica para a próxima etapa.
- `node:module` externalizado no glue do occt-wasm: é o ramo só do Node, igual no Linux.

**Hashes (build `c35c0a0`; os commits seguintes só mudam testes e instrumentos):**

| Artefato | SHA-256 | Bytes |
|---|---|---|
| `AGTN Industrial CAD_3.2.0-1_x64-setup.exe` | `35262E34A8082B35DF5698B842E50FB87A6970D6804AD2E552CD3B04E49D4C5C` | 8 860 779 |
| `AGTN Industrial CAD_3.1.1_x64-setup.exe` (da `main`) | `28129A73EA451AD2CF81ADE6C72AFEA4B3BDF5C73D8ABA93C1A9FD9246F6F24A` | 4 006 579 |
| `target\release\agtn-cad.exe` (3.2.0-1) | `45537C6415C68136CD7A34AD81EC210630F05FF67ED4E476D7E69AA579477DBD` | 12 225 024 |
| `agtn-cad.exe` **instalado** (3.2.0-1) | `49D3AEA075095C5B99FAECDB63219AC9180F0577B8F0B144C40F8A8E79565319` | 12 225 024 |
| `occt/occt-wasm.wasm` (build = instalado) | `CEA5998C8FA6E6EFCFF216F8E5257145E36156300FEF4808189B88976BB2BD88` | 21 343 771 |
| `uninstall.exe` | `8F5184071A28D1197AF98EF22F6C4FC7B00044C90496A27BD3F7B6298A3DD8DD` | — |

O `.exe` instalado difere do `target\release` **apenas** no marcador que o bundler do Tauri grava numa cópia do binário (`__TAURI_BUNDLE_TYPE_VAR_UNK` → `_NSS`, offset 11 698 055). Isso foi conferido byte a byte: depois de trocar o marcador, os SHA-256 são iguais. Com a 3.1.1 dá o mesmo resultado (offset 11 375 751).

## 3. Instalador — W2: **APROVADO** (ressalvas P-01 e P-05)

- **Formato:** NSIS. O instalador é um stub **x86**, o padrão do NSIS. O app instalado é **x64** (cabeçalho PE conferido).
- **Metadados:**

  | Campo | Valor |
  |---|---|
  | ProductName | "AGTN Industrial CAD" |
  | FileDescription | "AGTN Industrial CAD" |
  | Versão | **3.2.0-1** (arquivo e produto) |
  | Copyright | "© AGTN. Todos os direitos reservados." |
  | **CompanyName** | **vazio**: o template NSIS do Tauri não grava esse campo |
  | Fabricante no registro (`Publisher`) | **AGTN** |
  | Assinatura | **NotSigned** |

- **Conteúdo instalado:** 3 arquivos: `agtn-cad.exe`, `occt\occt-wasm.wasm` e `uninstall.exe`. Tamanho no registro: 32 860 KB.
- **O que vai dentro do `.exe`:**
  - o frontend e os workers vêm embutidos no `.exe` (protocolo `tauri.localhost`);
  - o motor 3D carrega o `.wasm` da pasta de instalação.
- **Atalhos:** menu Iniciar e Área de Trabalho (`OneDrive\Desktop`).
- **Associações:**
  - `.agtncad` → classe "Projeto AGTN Industrial CAD";
  - `.dxf` e `.dwg` → apenas "Abrir com" (`OpenWithProgids`). Na instalação silenciosa, o programa padrão do usuário **não** muda (conferido).
- **WebView2:** o instalador usa o modo padrão do Tauri (*download bootstrapper*); o runtime já estava presente.
- **Dependências do `.exe`:**
  - `dumpbin /dependents` mostra só DLLs do Windows e o UCRT (`api-ms-win-crt-*`, que faz parte do Windows 10/11);
  - o runtime do VC++ vai embutido (`staticVCRuntime`), sem `vcruntime140.dll`;
  - **o `WebView2Loader.dll` não é necessário no build MSVC**.
- **Guardado sem publicar:** `D:\AGTN_DEV\homologacao\` (os 2 instaladores + `SHA256SUMS.txt`).

## 4. Instalação e ciclo de vida

Valem os resultados do reteste `reteste/`, com o smoke corrigido. Na 1ª rodada (`ciclo_1/`) só reprovaram o funcional (F-13) e os critérios que eu tinha definido errado (empresa e hash bruto do `.exe`); as causas estão em §2 e §3.

| Item | Resultado | Evidência |
|---|---|---|
| **W3 · instalação limpa** | **APROVADO** | `/S`, código 0, 5 s. 1 entrada no registro. `.exe` = build, exceto o marcador; `.wasm` = build. 2 atalhos |
| W3 · abrir pelo atalho | **APROVADO** | janela "AGTN Industrial CAD" em 621 ms. 45 módulos carregados, **nenhum** fora do Windows, da pasta instalada ou do runtime WebView2 (nada do repositório) |
| W3 · abrir pelo `.exe`, fechar e reabrir | **APROVADO** | 521 ms e 522 ms; fechou pela janela nas duas vezes |
| W3 · funcional no app **instalado** (WebView2 real) | **APROVADO 228/228** | 3 repetições × 6 projetos (§5) |
| **W6 · sem ferramentas** | **APROVADO** | processo sem git, node, npm, cargo, rustc, cl e link no PATH; smoke 228/228. Dependências reais: Windows + UCRT + WebView2 Runtime |
| W4 · desinstalação (instalação limpa) | **APROVADO** | registro, pasta e atalhos removidos. Dados do app mantidos (comportamento do Tauri) |
| W4 · base 3.1.1 | **APROVADO** | 3.1.1 (build da `main`) instalada; `.exe` = build, exceto o marcador |
| W4 · dados do usuário antes | — | projeto aberto na 3.1.1 → lista de recentes no perfil real. Backup: `backup_antes_atualizar` (perfil com 209 arquivos + registro). Rollback: instalador 3.1.1 guardado |
| **W4 · atualização 3.1.1 → 3.2.0-1** | **APROVADO** | código 0, 5 s. 1 entrada no registro, mesma pasta, `.exe` novo = build, `.wasm` presente |
| W4 · dados intactos | **APROVADO** | **0 de 209** arquivos do perfil alterados pelo instalador; projeto do usuário com o mesmo SHA-256 |
| W4 · preferências e recentes | **APROVADO** | a 3.2.0-1 leu, pelo CDP no perfil real, a mesma lista de recentes gravada pela 3.1.1 |
| W4 · funcional depois de atualizar | **APROVADO 76/76** | 1 repetição × 6 projetos |
| **W4 · desinstalação final** | **APROVADO** (ressalva P-02) | registro, pasta e atalhos removidos; projeto do usuário intacto; perfil mantido |
| W4 · resíduo de associação | **REPROVADO (BAIXA, P-02)** | `.agtncad` continua apontando para a classe "Projeto AGTN Industrial CAD", que já foi apagada (`reteste/registro_5_*.txt`) |

**Estado final do PC:**
- nenhum AGTN instalado;
- nenhum atalho `.lnk` do AGTN (`logs/10_atalhos_lnk.txt`). O ícone que pode aparecer na Área de Trabalho é só o Explorer sem atualizar (F5 resolve);
- ficaram os resíduos de registro de P-02/P-03 e o perfil WebView2 dos testes (P-04).

## 5. Testes funcionais e desempenho (app nativo instalado, WebView2 157)

**Verificações S1–S11 por projeto, nas 3 repetições:**
- **2D:** o desenho da v3.1.1 abre com os **114 objetos** (S2D).
- **3D:** motor no worker e OCCT 8 (S2/S3); sólidos com volume de referência a 1e-9 (S4/S4b); booleana com volume exato (S5).
- **Planificação:** área, blank e corte iguais aos de referência (S6).
- **DXF:** R2000 e R12 conferidos, com **SHA-256 idêntico ao de referência** (S7); DXF gravado pelo Rust e relido igual.
- **DWG:** gravado pelo conversor nativo e relido.
- **Persistência:** `.agtncad` salvo e relido, em `Peça ção #1 (rev.2)` (S8).
- **Segurança:** 0 violações de CSP e 0 erros de segurança na página e no worker (S9/S9-cdp).
- **S11:** o worker não recebe CSP, como no Linux e na ETAPA 5. A F-05 garante que o motor não depende disso.

**Cobertura no Windows nativo (vitest 629 + `cargo`, no PC):**
- **2D:** `regressao2d` (`.agtncad`, DXF R12/R2000, SVG e PDF byte a byte iguais aos da v3.1.1), `dxf`, `dxf2000`, `plot` e `geometry`.
- **Perfis:**
  - U e L: `sheetmetal`, `profiles_new`;
  - enrijecidos (bandeja com pestana): `tray`;
  - calandrados: `rolling`.
- **Planificação e linhas de dobra:** `unfold`, `flat`, `flatdxf`, `flatcut`, `industrial/*` (dimensões e áreas).
- **Edição paramétrica e histórico:** `part3d`, `stableids`, `audit3d`, `document`.
- **Projetos antigos:** `persist2`, `persist3` (arquivos das FASES 2 a 4 abrem e regeneram com os volumes de quando foram gravados).
- **Segurança:** `security.test` sobre o `dist` gerado no próprio PC (0 código dinâmico, CSP exata); `test:sem-eval` 629/629; `diagnostics` 12/12.
- **DWG:** `cargo test` com DWG reais do AutoCAD (14/14).

**Desempenho (mediana de 3, processo do app + WebView2):**

| Projeto | Janela (ms) | Motor pronto (ms) | Regeneração (ms) | UI↔worker (ms) | Memória total (MB) | Privada (MB) por repetição | CPU (s) |
|---|---|---|---|---|---|---|---|
| `etapa2_completo` | 942 | 336 | 608 | 0,1 | 540 | 609 · 618 · 613 | 5,7 |
| `fase3_peca_parametrica` | 786 | 321 | 404 | 0,1 | 513 | 589 · 588 · 599 | 4,4 |
| `fase2_projeto_3d` | 1 043 | 319 | 203 | 0,1 | 496 | 585 · 584 · 553 | 4,1 |
| `etapa1_chapa` | 799 | 314 | 405 | 0 | 507 | 564 · 567 · 591 | 4,8 |
| `grande_120furos` | 773 | 329 | 2 217 | 0,1 | 589 | 597 · 612 · 597 | 8,2 |
| `v311_desenho` (só 2D) | 1 032 | — | — | — | 389 | 299 · 289 · 287 | 2,4 |

- Memória estável entre repetições: nenhum crescimento acima de 50 %.
- Fora do smoke:
  - instalar 5 s, atualizar 5 s, desinstalar 4–5 s;
  - abrir sem arquivo: 521–621 ms.
- Comparado à ETAPA 5 (executável GNU portátil, mesmo PC):
  - motor 277–298 ms × 314–336 ms;
  - regeneração do projeto grande 2 216 × 2 217 ms;
  - mesma ordem de grandeza, sem regressão.
- **Não há meta de desempenho aprovada pela AGTN.** Os números são dados, não critério.

## 6. Segurança

- CSP ativa, igual à da ETAPA 5: `script-src 'self' 'wasm-unsafe-eval'`, sem `'unsafe-eval'`, `worker-src 'self'`, `object-src 'none'`.
- Nenhuma violação de CSP em 304 verificações no WebView2 (228 + 76).
- Nenhuma geração dinâmica de código: `security.test` no `dist` do PC e a suíte inteira com o V8 proibindo `eval`.
- Diagnóstico de falhas: testes unitários no Windows (12/12). As falhas forçadas de ponta a ponta (`engine_fail.py`) rodaram só no Linux/Chromium (P-07).
- **Instalação e desinstalação não pediram UAC** (modo `currentUser`). O único UAC da etapa foi o do VS Build Tools.

## 7. Commits da etapa (só em `feature/agtn-3d-ia`)

| Commit | Conteúdo |
|---|---|
| `6057c94` | Versão de homologação **3.2.0-1** (aprovada pelo Edson), em 5 lugares + `package-lock.json` + `docs/release-notes/v3.2.0-1.md` ("não publicar") |
| `c35c0a0` | F-11 (`fileURLToPath`) e F-12 (tempo do vitest no `perf2`) |
| `c048b67` | F-11b (separador de caminho) |
| `56dee72` | F-13 (smoke espera a página antes de recarregar) |
| commit desta documentação | relatório + evidências + scripts da etapa |

O `build-windows.yml` só publica em push na `main` ou em tag `v*`, então nada foi publicado.

## 8. Pendências

| ID | Severidade | Descrição | Evidência | Impacto | Próxima ação |
|---|---|---|---|---|---|
| **P-01** | MÉDIA | Instalador e `.exe` **sem assinatura digital** | `Get-AuthenticodeSignature` = NotSigned | O SmartScreen avisa "Editor desconhecido" ao baixar e instalar; dificulta a distribuição comercial | Certificado OV/EV + secrets no Actions (já estava pendente) |
| **P-02** | BAIXA | Depois de uma **atualização**, desinstalar deixa `.agtncad` apontando para a classe apagada. O `APP_ASSOCIATE` do Tauri guarda a classe que está em uso como `Projeto AGTN Industrial CAD_backup`; numa atualização, essa classe é a do próprio AGTN, e o `APP_UNASSOCIATE` a "restaura" | `reteste/registro_0..5_*.txt` | Duplo clique em `.agtncad` com o AGTN desinstalado: o Windows pergunta com qual app abrir. Sem perda de dados. Existe desde a v3.1.x (toda atualização) | Proposta, não executada: no `hooks.nsh`, POSTINSTALL apaga o `_backup` quando é igual à própria classe; POSTUNINSTALL remove o padrão que aponta para a classe inexistente. Depois, reteste do ciclo |
| P-03 | BAIXA | Depois de desinstalar, `.dxf` e `.dwg` ficam com o valor padrão vazio e `AGTNCAD.*_backup` vazio (criados pelo hook e pelo Tauri; antes não existiam) | `registro_5` | Nenhum efeito funcional observado (sem ProgId padrão) | Entra na mesma correção da P-02 |
| P-04 | INFO | Depois de desinstalar, ficam `HKCU\Software\AGTN\AGTN Industrial CAD` (pasta de instalação) e o perfil WebView2 em `%LOCALAPPDATA%\br.com.agtn.cad` (recentes) | `registro_5`, `09_estado_final.txt` | Esperado: o Tauri só apaga com "apagar dados do app"; preserva preferências | Documentar no manual. Limpar o PC de teste só com autorização |
| P-05 | BAIXA | "Empresa" (CompanyName) vazio nas propriedades do instalador | metadados em §3 | Cosmético; o fabricante aparece correto em "Aplicativos instalados" | Aceitar, ou template NSIS próprio |
| **P-06** | ALTA (processo) | A branch está em **3.2.0-1** (homologação). A Release v3.1.1 ainda não foi publicada pela `main` (F-08) | `version.test.ts`; Releases do GitHub | Um merge sem decidir a versão publicaria uma versão errada | Edson decide a versão comercial (proposta: 3.2.0) e publica a v3.1.1 pela `main` antes |
| P-07 | BAIXA | Os testes de UI e2e (Playwright) e as falhas forçadas (`engine_fail.py`) não rodaram no Windows (sem Python/Playwright no PC) | §6 | Cobertos no Linux/Chromium; o smoke do WebView2 cobre o fluxo principal | Opcional: instalar Python + Playwright no D: |
| P-08 | BAIXA | W6 feito no mesmo PC (as ferramentas estão no disco, mas fora do PATH) | `logs/09_estado_final.txt` | Evidência forte (imports + módulos carregados), mas não é um PC "virgem" | Repetir com o instalador num PC sem ferramentas (pacote: só o `setup.exe` + smoke) |
| P-09 | BAIXA | Rollback (voltar da 3.2.0-1 para a 3.1.1) não executado | instalador 3.1.1 guardado | Caminho de volta disponível, não testado | Testar se a AGTN quiser rollback formal |
| P-10 | BAIXA | MSI não gerado nem testado (escopo NSIS) | `--bundles nsis` | Só se a AGTN distribuir MSI | Decidir se o MSI continua no `tauri.conf.json` |
| P-11 | INFO | Avisos do Vite (`configLoader native`, import sem extensão) e `node:module` externalizado | logs do build | Nenhum hoje | Adicionar `.ts` no import do `vite.config.ts` na próxima etapa |
| **P-12** | ALTA (externo) | ZWCAD/AutoCAD (D3/D4), CAM do laser (D5), peças reais (I2) | `FASE4_ETAPA4_PENDENCIAS_AGTN.md` | Impede a homologação industrial | AGTN |

## 9. O que ficou no PC

- **`D:\AGTN_DEV`:**
  - ferramentas, código e builds;
  - `homologacao\`: os 2 instaladores, `SHA256SUMS.txt`, `evidencia\agtn-cad_3.2.0-1_instalado.exe`, `ciclo_*` e `reteste_*` (com backups e dumps do registro);
  - `logs\`.
- **Fora de `D:\AGTN_DEV`:**
  - `D:\Windows Kits` (SDK);
  - VS Installer e Package Cache no C:;
  - a pasta `Desktop\AGTN_ETAPA6` com os `.cmd`.
- **Nada foi apagado do usuário.** Os resíduos de registro de P-02/P-03 e o perfil de teste continuam no PC. Para limpar é preciso autorização: é uma operação nova.
