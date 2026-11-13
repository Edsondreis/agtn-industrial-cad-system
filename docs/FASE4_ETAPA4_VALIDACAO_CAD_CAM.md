# FASE 4 · ETAPA 4 — Validação em CAD comercial (ZWCAD, AutoCAD) e CAM do laser

Data: 13/11/2026.

## Resultado

| ID | Validação | Status | Evidência |
|---|---|---|---|
| D1 | Leitura e conferência automáticas dos 20 DXF | **APROVADO** (automático) | validador do app + ezdxf, 14 conferências por arquivo, 20/20 |
| D2 | Camada por entidade | **APROVADO** (automático) | contagem por camada = modelo |
| D3 | ZWCAD | **PENDENTE** | sem acesso ao PC da AGTN nesta sessão; ficha pronta |
| D4 | AutoCAD | **PENDENTE** | idem (a AGTN tem AutoCAD) |
| D5 | CAM do laser | **PENDENTE** | depende do operador; ficha pronta |

D1 e D2 **não** aprovam o DXF industrialmente. Só ZWCAD, AutoCAD e o operador do CAM aprovam. Não foi feito nenhum corte físico.

## Pacote de arquivos (versionado)

`tests/industrial/dxf_referencia/`: 20 DXF (10 peças × R12 e R2000) e `SHA256SUMS.txt`.

- São **os mesmos bytes** entregues no zip da ETAPA 3 (20/20 conferidos agora).
- O `industrial.test.ts` falha se o código passar a gerar um byte diferente. Foi testado: alterar 1 byte num arquivo de referência faz o teste falhar.

## Conferência automática (leitor independente: `python3 tests/industrial/auditoria_dxf.py`)

| Conferência | Regra | 20 arquivos |
|---|---|---|
| estrutura | `recover.readfile` sem erro e sem correção | ok |
| unidade | R2000: `$INSUNITS` = 4 (mm); R12: não existe no formato (n/a) | ok / n/a |
| coordenadas | canto inferior esquerdo do contorno de corte em (0, 0) | ok |
| escala 1:1 | extensão do corte = blank do modelo (1e-6 mm) | ok |
| contorno externo | exatamente 1 em CUT_OUTER | ok |
| internos | CUT_INNER = furos + recortes do modelo | ok |
| contornos fechados | toda polilinha de corte fechada | ok (54 polilinhas) |
| segmentos desconectados | nenhuma LINE/ARC solta nas camadas de corte | ok |
| micro-segmentos | nenhum trecho < 0,0001 mm | ok (0) |
| duplicados | nenhuma entidade repetida (mesma camada e geometria a 1e-6) | ok (0) |
| linhas de dobra | BEND_UP + BEND_DOWN = trechos de dobra do modelo | ok |
| camadas | só CUT_OUTER, CUT_INNER, BEND_UP, BEND_DOWN, BEND_MARK, BEND_REGION, REFERENCE | ok |
| textos fora do corte | nenhum TEXT em CUT_* | ok |
| textos só onde devem | 60 em BEND_MARK, 20 em REFERENCE | ok |

Tabela por arquivo: `tests/output/industrial/auditoria_dxf.md`. A 1ª versão da auditoria exigia texto só em REFERENCE e acusou os textos de dobra em BEND_MARK. A regra estava errada (BEND_MARK é a camada das marcas, por projeto) e foi corrigida para "nenhum texto em CUT_*". O arquivo não mudou.

## Fichas para preenchimento

| Ficha | Para quem | Conteúdo |
|---|---|---|
| `tests/industrial/FICHA_CAD.md` | engenharia (ZWCAD e AutoCAD) | procedimento comando a comando: `UNITS`, `DIST`, `ID` em 0,0, `LIST` fechada, `OVERKILL` = 0, `LAYER`, dobras, textos (`%%d` → °). Tabela: Arquivo · ZWCAD · AutoCAD · Escala · Camadas · Observações, com o blank esperado e as camadas de cada arquivo |
| `tests/industrial/FICHA_CAM_LASER.md` | operador do laser | o que cada camada é (cortar / não cortar); identificação (fabricante, modelo, potência, CAM, versão, formato DXF); por arquivo: importação, unidade/escala, camadas reconhecidas, camadas usadas no corte, ajuste manual, resultado; resultado final e assinaturas |

## Riscos para o CAM (a conferir pelo operador)

| Risco | Gravidade | O que fazer |
|---|---|---|
| CAM que importa todas as camadas como corte | MÉDIA | filtro de camadas (só CUT_*); registrar na ficha se o CAM guarda a regra |
| TEXT virando gravação ou corte | MÉDIA | conferir BEND_MARK e REFERENCE fora das trajetórias |
| R12 sem unidade gravada | BAIXA | preferir R2000, ou conferir mm |
| `%%d` no texto | BAIXA | só estético (aparece "%%d" no lugar de "°") |
| Arcos em bulge | BAIXA | se o CAM quebrar em segmentos, anotar a tolerância |
