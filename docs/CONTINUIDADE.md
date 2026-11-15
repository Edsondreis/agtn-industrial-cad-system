# AGTN Industrial CAD — guia de continuidade (outro computador)

Atualizado em 2026-11-15, no fechamento da FASE 5. Este guia existe porque o PC usado até aqui (desktop-p4d6iou, usuário
Luiza, `D:\AGTN_DEV`) **deixa de estar disponível**. Nada do que precisa ser preservado depende dele: código, scripts,
relatórios e evidências estão no GitHub, e os instaladores de homologação foram entregues fora do PC (ver §5).

## 1. Onde está cada coisa

| O quê | Onde |
|---|---|
| Repositório | `github.com/Edsondreis/agtn-industrial-cad-system` (privado) |
| Versão publicada (estável) | `main` = 23a2540 → **3.1.1**. Intocada desde a FASE 1 do 3D |
| Desenvolvimento 3D + DXF/STEP | branch `feature/agtn-3d-ia` → **3.2.0-2 (homologação, não publicar)** |
| Plano e histórico | `docs/PLANO_3D_IA.md`, `docs/CHANGELOG.md`, relatórios `docs/FASE*.md` |
| Última fase | `docs/FASE5_AUDITORIA_INTEGRACAO_DXF_STEP.md`, `docs/FASE5_DXF_STEP_HOMOLOGACAO.md` |
| Notas de versão | `docs/release-notes/v3.2.0-1.md`, `v3.2.0-2.md` |
| Scripts de homologação Windows | `scripts/windows/` (fumaças WebView2), `docs/evidencias/etapa6_windows/scripts/` (instalar ambiente) e `docs/evidencias/fase5_windows/scripts/` (build + ciclo do instalador) |
| Evidências | `docs/evidencias/` (ETAPA 5, ETAPA 6, FASE 5 Chromium e Windows) |
| Referência do visualizador STEP | repositório `Edsondreis/agtn-cad-tank-viewer` (Kotlin) — o corpus de testes já foi copiado para `tests/step/viewer_ref/` |

**Regras que continuam valendo:**
- não fazer merge na `main`, não criar tag e não publicar Release sem autorização expressa do Edson;
- `bend.ts` e `tray.ts` não se mexem;
- CSP sempre ativa, sem `unsafe-eval`.

## 2. Montar o ambiente num Windows novo (x64)

Mesmo conjunto homologado na ETAPA 6/FASE 5. As versões abaixo são as testadas; versões mais novas devem funcionar, mas
rode a suíte inteira antes de confiar.

1. **Git** 2.56+ (ou Git portátil) — `git clone https://github.com/Edsondreis/agtn-industrial-cad-system.git` e
   `git checkout feature/agtn-3d-ia`. Com acesso ao GitHub no PC novo, **não precisa mais de git bundle**.
2. **Node.js 22** (testado 22.23.5).
3. **Visual Studio Build Tools 2022** (17.14, MSVC 14.44) com os componentes
   `Microsoft.VisualStudio.Component.VC.Tools.x86.x64` e `Microsoft.VisualStudio.Component.Windows11SDK.26100`
   (pede UAC uma vez). Script pronto: `docs/evidencias/etapa6_windows/scripts/01_vs_buildtools.ps1`.
4. **Rust** estável MSVC (testado 1.97.0) via `rustup-init.exe` (conferir o SHA-256 oficial). Script pronto:
   `docs/evidencias/etapa6_windows/scripts/02_ferramentas.ps1` (instala Node, Git e Rust portáteis em `D:\AGTN_DEV`;
   ajuste a variável `$R` se o disco/pasta for outro).
5. **WebView2 Runtime** — já vem no Windows 11.

Os scripts de `docs/evidencias/fase5_windows/scripts/` esperam `D:\AGTN_DEV\{src\agtn,rust,tools,cache,tmp,logs,homologacao}`.
Para outro caminho, troque `$R` no topo de cada `.ps1`.

## 3. Fluxo diário

```powershell
npm ci
npm run typecheck
npx vitest run                     # 702 testes: 699 ok, 1 "falha esperada" (vessel_revolved, ver §6), 2 pulados
npm run test:sem-eval              # mesma suíte com geração dinâmica de código proibida
cd apps\desktop\src-tauri; cargo test --release; cd ..\..\..
npm run dev                        # app no navegador (http://localhost:1420)
npm run tauri dev                  # app desktop
npm run tauri build -- --bundles nsis   # instalador; só NSIS (MSI fora do escopo)
```

O instalador sai em `apps\desktop\src-tauri\target\release\bundle\nsis\AGTN Industrial CAD_<versão>_x64-setup.exe`.
Ele usa o modo currentUser, sem UAC. O WASM do motor vai em `occt\occt-wasm.wasm`.

**Testes de interface (Linux ou WSL, com Chrome e Playwright para Python):**
- `tests/e2e/e2e_step.py`: STEP/DXF, 35 verificações;
- `tests/e2e/step_smoke_chromium.py`: build de produção com a CSP real, 90 verificações;
- `tests/e2e/e2e3d.py` e `tests/e2e/e2e_sheet.py`.

**App instalado (WebView2 real):**
- `scripts/windows/smoke/webview2_smoke.ps1`: 2D, 3D, planificação, DXF, DWG e .agtncad;
- `scripts/windows/smoke/webview2_step_smoke.ps1`: STEP e DXF pela linha de comando, com memória.

**Ciclo completo num comando:** `docs/evidencias/fase5_windows/scripts/11_build.ps1 -Esperado <commit>`, seguido de
`12_ciclo.ps1`. O ciclo faz instalação limpa, atalho, regressão, DXF/STEP, desinstalação e atualização com backup.

## 4. Nova versão (checklist)

1. Trocar a versão nos 5 lugares:
   - `package.json`;
   - `apps/desktop/package.json`;
   - `apps/desktop/src-tauri/tauri.conf.json`;
   - `apps/desktop/src-tauri/Cargo.toml`;
   - `Cargo.lock` (bloco `agtn-cad`).
2. Trocar também em `package-lock.json` (3 ocorrências).
3. Pré-lançamento **só numérico** (`3.2.0-3`, nunca `-beta`), por exigência do MSI/WiX.
4. `docs/release-notes/v<versão>.md`. O `apps/desktop/src/version.test.ts` confere tudo isso.
5. Ao atualizar o `occt-wasm`, seguir `docs/FASE4_ETAPA5_MOTOR_3D.md`. O patch de CSP do glue
   (`core/solid/src/occt-csp-patch.ts`) está preso ao SHA-256 do arquivo.
6. Nada de atributo `style=` no `apps/desktop/index.html`: o nonce do Tauri anula `'unsafe-inline'`.
7. Nos testes, use `fileURLToPath` e aceite `\r\n`. O checkout no Windows pode vir com CRLF, como aconteceu no
   `Cargo.lock` na FASE 5.

## 5. Artefatos de homologação (fora do PC antigo)

Estes são os instaladores de `D:\AGTN_DEV\homologacao\`. Foram entregues ao Edson na conversa da FASE 5, e o SHA-256
de cada um está abaixo e em `docs/evidencias/fase5_windows/`. **São de homologação: não publicar.**

| Arquivo | Bytes | SHA-256 | Origem |
|---|---|---|---|
| `AGTN Industrial CAD_3.1.1_x64-setup.exe` | 4 006 579 | `28129A73EA451AD2CF81ADE6C72AFEA4B3BDF5C73D8ABA93C1A9FD9246F6F24A` | build nativo da `main` 23a2540 (ETAPA 6) |
| `AGTN Industrial CAD_3.2.0-1_x64-setup.exe` | 8 860 779 | `35262E34A8082B35DF5698B842E50FB87A6970D6804AD2E552CD3B04E49D4C5C` | ETAPA 6, commit 6057c94+ |
| `AGTN Industrial CAD_3.2.0-2_x64-setup.exe` | 8 875 779 | `EF4DA3DDB5FB4BD8C33F65799E25558AF4E7C2D6688FA83C289FEA1934798900` | FASE 5, commit c3497a3 — ciclo 15/15 |

Para gerar de novo em qualquer PC: `git checkout <commit>` e depois `npm ci && npm run tauri build -- --bundles nsis`.

## 6. Pendências em aberto (prioridade)

1. **F-08 / P-06:** decidir a versão comercial. Publicar a 3.1.1 pela `main` antes de qualquer merge.
2. **P-F5-01:** o leitor STEP do OCCT 8 (occt-wasm 5.17.1) lê errado superfície de revolução com geratriz elíptica
   (`vessel_revolved.step`).
   - O app sinaliza a forma inválida, mas não corrige.
   - Caminhos possíveis: versão nova do occt-wasm; reconstrução da face a partir da geratriz; ou ler esse caso com o
     parser do viewer Kotlin.
   - O teste `it.fails` em `core/model3d/src/stepdoc.test.ts` avisa quando o motor passar a ler certo.
3. **P-01:** certificado de assinatura de código (`docs/ASSINATURA.md`).
4. **P-02/P-03:** resíduos de associação `.agtncad`/`.dxf`/`.dwg` depois de desinstalar uma versão atualizada.
   A correção está proposta no `hooks.nsh` e não foi executada.
5. **P-12:**
   - fichas CAD/CAM (D3–D5);
   - 5–10 peças reais (I2);
   - impressão real;
   - DWG/DXF 2000 no AutoCAD e no ZWCAD;
   - monitor da CNC.
6. **2D:**
   - MULTILEADER/MLINE;
   - cotas associativas no DXF 2000;
   - hachura por ponto interno;
   - cone calandrado;
   - modo touch.
