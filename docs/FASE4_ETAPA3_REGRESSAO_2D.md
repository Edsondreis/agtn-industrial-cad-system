# FASE 4 · ETAPA 3 — Regressão do CAD 2D publicado (v3.1.1)

Data: 13/11/2026 · Branch `feature/agtn-3d-ia` · `main` = `23a2540` (v3.1.1), não alterada.

## Resultado: **APROVADO** (Linux). Windows: **PENDENTE** (depende do W1)

| # | Verificação | Status | Evidência |
|---|---|---|---|
| R1.1 | Código do 2D sem alteração desde a main | APROVADO | `git diff main..HEAD` vazio em `modules/dxf/src` (só 1 arquivo de teste novo), `core/geometry`, `core/document`, `modules/plot`, `modules/sheetmetal/src/bend.ts`, `tray.ts` |
| R1.2 | Nenhum teste 2D removido | APROVADO | a lista do Vitest da main é subconjunto da lista da branch |
| R1.3 | Suíte completa na branch | APROVADO | Vitest **571 aprovados, 0 reprovados, 1 pulado** (o caso "grande" de desempenho, só com `AGTN_PERF=1`), 51 arquivos |
| R1.4 | Arquivo `.agtncad` da v3.1.1 abre igual | APROVADO | `modules/dxf/src/regressao2d.test.ts` |
| R1.5 | Re-gravar dá o mesmo arquivo | APROVADO | SHA-256 igual ao da main |
| R1.6 | DXF R12, DXF R2000, SVG idênticos à v3.1.1 | APROVADO | SHA-256 iguais (tabela abaixo) |
| R1.7 | PDF idêntico à v3.1.1 | APROVADO | SHA-256 igual com `CreationDate` normalizada (é a única diferença: data da geração) |
| R1.8 | Bandejas e perfis (planificação 2D) | APROVADO | perfil U desenvolvido 160,9849549892668 mm; bandeja 710 574,6599726378566 × 559,6599726378566; bandeja enrijecida 489,9699099785337 × 389,9699099785337 — iguais na main e na branch |
| R2.1 | DWG no conversor nativo (Linux) | APROVADO | `cargo test --release` com `AGTN_DWG_SAMPLES=tests/dwg`: **15/15**, inclui `real_autocad_samples` (AC1015, AC1021, AC1032) |
| R2.2 | DWG e 2D no Windows | **PENDENTE** | depende do script `homologacao.ps1` no PC da AGTN |

## Como o arquivo de referência foi feito

O código da **main 23a2540** foi aberto num worktree separado e gerou o desenho de referência.
- Gerador: `tests/regressao2d/gerador_golden2d.test.ts.txt`, com entrada fixa e ids fixos.
- Conteúdo: 114 entidades em 11 camadas. Inclui todos os tipos de entidade e de cota, o perfil U (planificado e em corte), a bandeja 710 e a bandeja enrijecida com alívio redondo.
- Saída da main: `tests/regressao2d/v311_desenho.agtncad` e os hashes em `tests/regressao2d/v311_hashes.json`.

O teste da branch abre esse arquivo com o código atual, re-grava e exporta. Depois confere os hashes contra os da main.

| Saída | SHA-256 (main = branch) |
|---|---|
| `.agtncad` | `67041877d5202a173baf8108c3a467139ee0502b49e57161ef659311f08aa651` |
| DXF R12 | `00bf09de1a605556e48413a81b8512c92608dddb1543b2547d4134e37bfce4a5` |
| DXF R2000 | `1266e242f7859f469ca48862c07e8ffd1dd102de8385820061bf7e5742c13670` |
| SVG | `7bf70e49203e64bafb66b39f336f54cacf01b303786dd3e82f729323dc1a506c` |
| PDF (data normalizada) | `fcf7fa1d5f5c0a18245c8318446ec26345e6fc3699510e99b3c5d1ba23c06237` |

## Interface 2D (navegador)

`e2e3d.py` passou **34/34** no Chromium. Ele inclui o 2D intacto depois de abrir e fechar o 3D.

## O que mudou fora do 2D e pode afetar o Windows

`apps/desktop/src-tauri/tauri.conf.json` difere da main em três pontos (vêm da FASE 2):
- CSP com `'wasm-unsafe-eval'` e `worker-src 'self' blob:`, para o OCCT em WebAssembly no worker;
- descrição longa;
- `occt-wasm.wasm` como recurso do pacote.

`lib.rs` tem +38 linhas (`read_engine`). Nada disso toca o desenho 2D, mas **só o W7 no WebView2 real prova** que a CSP nova não bloqueia nada do 2D no Windows.
