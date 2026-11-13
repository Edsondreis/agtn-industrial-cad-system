# FASE 4 · ETAPA 3 — Compatibilidade DXF (ZWCAD, AutoCAD e CAM do laser)

Data: 13/11/2026.

## Resultado: **PENDENTE**

Os arquivos passaram em todas as conferências automáticas. Isso **não** prova compatibilidade com ZWCAD, AutoCAD ou CAM: nenhum deles foi aberto nesta etapa.

| # | Verificação | Status | Evidência |
|---|---|---|---|
| D1 | Validação automática de 20 DXF (10 peças × R12 e R2000) | **APROVADO** | `industrial.test.ts` (validador do próprio app) + leitura independente com ezdxf 1.4.5 |
| D2 | Camada por tipo de entidade | **APROVADO** | `industrial.test.ts` (regra por camada) + contagem pelo ezdxf |
| D3 | Abrir no ZWCAD | **PENDENTE** | acesso à pasta do PC da AGTN não foi concedido nesta sessão; arquivos e checklist entregues ao Edson |
| D4 | Abrir no AutoCAD | **PENDENTE** | não há AutoCAD nesta sessão; não se sabe se há no PC da AGTN |
| D5 | Importar no CAM do laser | **PENDENTE** | o CAM fica na máquina de corte; depende do operador da AGTN |

## D1 — o que foi conferido automaticamente

**Validador do app** (`validateFlatDxf`, o mesmo do botão de exportar). Ele relê o arquivo gravado e confere:
- leitura sem entidade não suportada;
- unidade: R2000 com `$INSUNITS` = mm; R12 lido como mm 1:1;
- camadas presentes;
- 1 contorno externo, e internos = recortes + furos;
- todos os contornos fechados;
- sem micro-segmentos (< 0,0001 mm) e sem entidades duplicadas;
- área e comprimento de corte = grafo (10⁻⁹ relativo);
- caixa = blank;
- linhas de dobra por sentido (BEND_UP / BEND_DOWN).

**Leitura independente (ezdxf 1.4.5, `recover.readfile`, que faz auditoria estrutural):**

| Item | Resultado nos 20 arquivos |
|---|---|
| Erros estruturais | **0** |
| Correções necessárias | **0** |
| Versão | R12 = AC1009, R2000 = AC1015 |
| `$INSUNITS` | R2000 = **4 (mm)**; R12 = ausente (a variável não existe no R12) |
| Polilinhas de corte | **54, todas fechadas**; 14 com arcos (bulge) |
| Tipos de entidade | LWPOLYLINE (R2000) / POLYLINE (R12), CIRCLE, LINE, TEXT |
| Codificação | CP1252 (acentos legíveis em CAD Windows) |

## D2 — camadas (contagem do ezdxf, igual em R12 e R2000)

| Peça | CUT_OUTER | CUT_INNER | BEND_UP | BEND_DOWN | BEND_REGION | BEND_MARK | REFERENCE |
|---|---|---|---|---|---|---|---|
| 01 chapa com furos | 1 | 6 | — | — | — | — | 1 |
| 02 caixa dobrada | 1 | — | 4 | — | 8 | 4 | 1 |
| 03 bandeja 710.0CUH25 | 1 | — | 4 | — | 8 | 4 | 1 |
| 04 tampa dobras laterais | 1 | — | 4 | — | 8 | 4 | 1 |
| 05 caixa de proteção | 1 | 12 | 4 | — | 8 | 4 | 1 |
| 06 múltiplas dobras | 1 | — | 2 | 2 | 8 | 4 | 1 |
| 07 alívios | 1 | — | 2 | — | 4 | 2 | 1 |
| 08 recortes perto da dobra | 1 | 4 | 3 (1 dobra cortada em 3 trechos) | — | 6 | 1 | 1 |
| 09 fechamento de cantos | 1 | — | 4 | — | 8 | 4 | 1 |
| 10 geometria complexa | 1 | 2 | 4 (3 dobras, 1 em 2 trechos) | — | 8 | 3 | 1 |

## Peça real

A planificação da bandeja **710.0CUH25-01-03** (nº 3) gerada pelo caminho 3D é **igual ao DXF de produção** `tests/dxf/fixtures/bandeja_710.0CUH25-01-03.dxf`:
- 20 vértices iguais a 10⁻⁶ mm;
- mesmas linhas de dobra;
- perímetro 2310,0798905514 mm.

É a única peça com referência real até agora.

## O que falta e como fazer (D3–D5)

Pacote entregue ao Edson: `AGTN_HOMOLOGACAO_ETAPA3.zip`, com os 20 DXF, `resultados.json`, `homologacao.ps1` e `CHECKLIST_DXF.md`. O checklist também está no repositório, em `tests/industrial/CHECKLIST_DXF.md`.

Para cada arquivo, no ZWCAD e no AutoCAD, conferir:
- abre sem mensagem;
- unidade mm, escala 1:1 (DIST no blank);
- contornos fechados;
- OVERKILL não acha nada;
- camadas corretas.

No CAM:
- importar só CUT_OUTER e CUT_INNER;
- furos reconhecidos como internos;
- conferir sentido de corte e kerf;
- **nenhuma** BEND_* nem o TEXT da camada REFERENCE pode virar corte.

Registrar nome e versão do CAM e a máquina.

## Riscos conhecidos (não testados em CAD/CAM real)

| Risco | Gravidade | Comentário |
|---|---|---|
| R12 sem unidade no arquivo | BAIXA | inerente ao formato; o leitor assume a unidade do desenho. Preferir R2000 no CAM, ou conferir mm ao abrir |
| CAM que importa todas as camadas | MÉDIA (operacional) | linhas de dobra, marcas e o texto de referência viriam como corte. Precisa de filtro de camadas no CAM |
| Arcos como bulge em polilinha | BAIXA | padrão DXF; alguns CAM antigos explodem em segmentos. Conferir no D5 |
