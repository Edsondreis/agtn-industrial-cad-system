# FASE 5 — DXF e STEP: homologação

**Situação: HOMOLOGAÇÃO PENDENTE** (sessão interrompida em 2026-11-14 22:48 a pedido do usuário; o PC precisava ser liberado).
Branch `feature/agtn-3d-ia`, HEAD 8a2b7cc+ · `main` intocada (23a2540) · sem merge, Release ou tag.

## 1. O que foi entregue
- Auditoria: `docs/FASE5_AUDITORIA_INTEGRACAO_DXF_STEP.md`. Decisão do usuário: OCCT + reaproveitar o viewer.
- STEP/STP abre como **documento próprio, só de leitura** (aba STEP):
  - motor próprio, liberado ao fechar;
  - `.agtncad` intocado;
  - 5 estados de leitura;
  - 7 vistas, ajustar, sólido/arame, orto, Y para cima;
  - seleção com medidas exatas;
  - unidade do arquivo e exibição em mm/cm/m/in;
  - corpos inválidos sinalizados.
- DXF: leitor preservado. A unidade agora é explícita na mensagem de abertura e importação.
- Versão de homologação 3.2.0-2 (`docs/release-notes/v3.2.0-2.md`). Não publicar.

## 2. Resultados até agora
| Item | Resultado | Evidência |
|---|---|---|
| Abrir DXF R12 | APROVADO (Linux/Chromium) — falta no app instalado | `modules/dxf/src/fase5.test.ts` 27/27 contra ezdxf |
| Abrir DXF R2000 | APROVADO (Linux/Chromium) — falta no app instalado | idem; 3DFACE/RAY/XLINE avisadas |
| Abrir STEP | APROVADO (Chromium dev e produção com CSP) — falta no app instalado | `e2e_step.py` 35/35; `step_smoke_chromium.py` 90/90 |
| Abrir STP | APROVADO (Chromium) — falta no app instalado | `vazio.stp`, roteamento `.stp` |
| Múltiplos sólidos | APROVADO | tank_assembly 4, cone_sphere_torus 3, grande 400 |
| Superfícies curvas | **PARCIAL** | cilindro, cone, esfera, toro e B-spline exatos; **vessel_revolved: OCCT 8 lê as calotas elípticas inválidas** (volume −28%). Detectado e avisado, não corrigido |
| Assemblies | APROVADO | hierarquia e nomes (tank_assembly, fusion_srr_assembly) |
| Unidades | APROVADO | mm, in, cm, m, ft; arquivo sem unidade → "desconhecida" + aviso |
| Zoom e rotação | APROVADO (Chromium) | E2E com mouse real |
| Arquivos grandes | APROVADO (Chromium) | 21 MB / 400 sólidos: leitura 5,6 s + visualização 5,1 s; memória liberada ao fechar |
| Regressão 2D/3D | APROVADO (Linux) — falta no app instalado 3.2.0-2 | vitest 696 + 1 falha conhecida; sem-eval; e2e3d 34/34; e2e_sheet 18/18 |
| Segurança CSP | APROVADO (Chromium produção) | 0 violações; sem eval |
| Instalador Windows | **PENDENTE** | build nativo OK; ciclo de instalação **não executado** |

## 3. Windows nativo (PC desktop-p4d6iou)
- Build 49872dc (MSVC, NSIS): `D:\AGTN_DEV\homologacao\AGTN Industrial CAD_3.2.0-2_x64-setup.exe`
  - SHA-256 A5886F483138FEB1E1043FA8A7C993E02DC3B1C230B3667D561F607B31E7C61E
  - 8 878 035 bytes; produto/arquivo 3.2.0-2
  - Os instaladores 3.1.1 e 3.2.0-1 continuam na pasta.
  - **Este build é anterior** aos ajustes 8f3d954 (formatação/rótulos), 490194f e 8a2b7cc. O próximo build guarda o atual como `_superado_*` (não apaga).
- Testes nesse build:
  - npm ci, typecheck, cargo test --release e tauri build: OK.
  - vitest e sem-eval: 1 falha, `version.test.ts`. O Cargo.lock veio com CRLF no checkout Windows; o teste foi corrigido em 490194f.
- Ciclo de instalação (passo 12): **adiado**. Nada foi instalado; o PC está como antes (nenhum AGTN instalado).

## 4. Para retomar (uma execução, ~45 min, PC livre)
1. Duplo clique em `C:\Users\Luiza\Desktop\AGTN_FASE5\14_tudo_v2.cmd`. O bundle 8a2b7cc já está em `D:\AGTN_DEV\src\agtn_fase5.bundle`.
2. Antes disso, recolocar o `12_ciclo.ps1` real em `D:\AGTN_DEV\scripts\fase5\` (hoje é um adiamento sem efeito) e o `11_build.ps1` corrigido ($h/$H). Ver `docs/evidencias/fase5_windows/scripts/`.
3. Gerar o bundle novo se houver commits depois de 8a2b7cc e ajustar o hash no .cmd.
4. Preencher este documento com o `ciclo_resumo.json` e o `step_resultado.json`.

## 5. Pendências
- P-F5-01: defeito do leitor STEP do OCCT 8 em SURFACE_OF_REVOLUTION com ELLIPSE (vessel_revolved).
- P-F5-02: ciclo real do instalador 3.2.0-2 (instalar, atalho, DXF/STEP no WebView2, memória, regressão, atualização, desinstalação).
- Herdadas da ETAPA 6: P-01 (sem assinatura), P-02/P-03 (resíduos de associação), P-12 (testes externos).
