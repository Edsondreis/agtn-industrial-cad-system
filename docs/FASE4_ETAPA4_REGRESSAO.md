# FASE 4 · ETAPA 4 — Regressão e integridade

Data: 13/11/2026 · HEAD testado: branch `feature/agtn-3d-ia` (commits da ETAPA 4) · referência: `main` `23a2540` (v3.1.1).

## Resultado

| ID | Validação | Status |
|---|---|---|
| R1 | 2D da v3.1.1 preservado (.agtncad, DXF R12, DXF R2000, SVG, PDF) | **APROVADO** |
| R2 | DWG no conversor nativo | **APROVADO** (Linux) · **PENDENTE** (Windows, W1) |
| C1 | `.agtncad` das FASES 2, 3 e das ETAPAS 1, 2 reabrem e regeneram igual | **APROVADO** |
| C2 | DXF da planificação igual antes e depois de salvar/reabrir | **APROVADO** |
| G1–G4 | fórmulas, sólidos, B-Rep, proveniência | **APROVADO** |

## R1 — hashes regerados agora (sem confiar no arquivo da ETAPA 3)

O gerador `tests/regressao2d/gerador_golden2d.test.ts.txt` foi rodado **duas vezes nesta etapa**, com a mesma entrada:
1. num worktree novo da `main` `23a2540`;
2. na branch.

| Saída | main 23a2540 | branch | Igual? | = `v311_hashes.json` (ETAPA 3)? |
|---|---|---|---|---|
| `.agtncad` | `67041877d5202a17…` | `67041877d5202a17…` | sim | sim |
| DXF R12 | `00bf09de1a605556…` | `00bf09de1a605556…` | sim | sim |
| DXF R2000 | `1266e242f7859f46…` | `1266e242f7859f46…` | sim | sim |
| SVG A3 | `7bf70e49203e64ba…` | `7bf70e49203e64ba…` | sim | sim |
| PDF A3 | `7579ebe2…` / `a2826554…` | — | difere só no `CreationDate` (1 ocorrência); com a data normalizada os dois dão `a036b336bb5cd28f…` | o teste usa outra normalização: `fcf7fa1d…` = ref |

Também na suíte (`modules/dxf/src/regressao2d.test.ts`, 3/3), o arquivo da v3.1.1 aberto pelo código atual:
- abre sem item ignorado e sem aviso;
- regravado dá o mesmo hash;
- DXF R12/R2000, SVG e PDF iguais à referência.

No app compilado (Linux), `v311_desenho.agtncad` abre pela linha de comando com **114 objetos** (S2D).

## Código que não pode mudar

| Arquivo / módulo | Situação |
|---|---|
| `modules/sheetmetal/src/bend.ts` | blob `524d4033c60b` = main |
| `modules/sheetmetal/src/tray.ts` | blob `37246476931e` = main |
| `modules/dxf/src` (exportador 2D) | = main, salvo `regressao2d.test.ts` (novo, só teste) |
| `core/geometry`, `core/document`, `modules/plot` | = main |
| motor geométrico (`modules/sheet3d/src/build.ts`, `flat.ts`, solver) | sem alteração na ETAPA 4 |
| formato `.agtncad` | sem alteração (v1, 3D em `extras["agtn3d"]`) |
| Rust (`lib.rs`, `cadconv.rs`), `tauri.conf.json`, CSP | sem alteração na ETAPA 4 |

Única mudança de produto na ETAPA 4: o gancho de teste em `Workspace3D.tsx`, ativo só com a flag de teste. Ver `FASE4_ETAPA4_AUDITORIA_TECNICA.md` §4.

## Execução completa (13/11/2026, final)

| Conjunto | Resultado |
|---|---|
| typecheck (TS estrito) | OK |
| Vitest | **597 aprovados, 0 reprovados, 1 pulado** (o "grande" de desempenho; com `AGTN_PERF=1`: 3/3), 54 arquivos |
| Vitest num checkout com CRLF (`core.autocrlf=true`, como o Git for Windows) | 578 + 1 pulado, 0 falhas (no commit `a4c6d0a`) |
| `cargo test --release` com DWG reais (AC1015, AC1021, AC1032) | **15/15** |
| e2e Chromium | `e2e3d` 34/34 · `e2e_param` 25/25 · `e2e_param2` 22/22 · `e2e_audit` 15/15 · `e2e_sheet` 18/18 · `e2e_etapa2` 24/24 = **138/138** |
| `load3d.py` | 38 corpos, quadro 0,8 / 0,9 ms (mediana) |
| App Tauri compilado no Linux (`.deb` da branch) | `tauri_compiled` 5/5 · `tauri_param` 5/5 · `tauri_sheet` 3/3 · `tauri_etapa2` 5/5 · `tauri_smoke` **58/58** |
| Build de produção no Chromium com a CSP (modo Tauri) | **61/61** |
| Mesmo build, CSP também no worker (modo estrito, demonstração da F-05) | 20/30: falham S2 e S3 nos 5 projetos (motor não inicia), como esperado |
| Auditoria DXF (ezdxf) | 20/20 arquivos, 14 conferências cada |
| F-01 (reprodução com outra semente) | 2 001 esboços, 23 050 regiões, idêntico |

## Persistência, histórico, planificação, redobramento, proveniência

Cobertos pela suíte e refeitos:
- `persist3` (C1/C2, 5): as 4 fases reabrem, regravam igual e regeneram com volume a 1e-9; DXF igual antes/depois.
- `audit3` (G1–G4, 27): fórmulas × geometria pura; volumes, caixas, raios e eixos medidos no B-Rep. Também:
  - editar e voltar dá a peça idêntica (histórico);
  - desdobrar/redobrar 10× dá a peça bit a bit igual;
  - rótulos e chaves estáveis sob edição, com adulteração detectada.
- `smokeref` (novo): as referências do teste do Windows (volumes, áreas, blank e SHA-256 dos DXF) batem com o código atual.
- `industrial` (10): os 20 DXF entregues são exatamente o que o código gera.
- `e2e_etapa2` e `tauri_etapa2`: undo/redo, desdobrar/redobrar e reabrir pela interface.

## Divergência registrada

A 1ª execução do `e2e_etapa2` nesta etapa terminou sem saída. Eu alterei `Workspace3D.tsx` com o servidor de desenvolvimento ligado, e a recarga automática interrompeu o teste. Repetido em seguida e na execução final: **24/24**. Não foi defeito do produto.
