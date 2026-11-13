# Ficha de abertura em CAD real — ZWCAD e AutoCAD (ETAPA 4, D3/D4)

Arquivos: `tests/industrial/dxf_referencia/` (20 DXF; `SHA256SUMS.txt`; o teste `industrial.test.ts` confere que o código
gera exatamente estes bytes). Leitura automática pelo ezdxf: 20/20 sem falha em 14 conferências
(`python3 tests/industrial/auditoria_dxf.py`). **Isso não substitui esta ficha**: só vale como APROVADO o que for
aberto e conferido no programa.

Preencha: programa e versão — ZWCAD ________________ · AutoCAD ________________ · data ____/____/______ · quem ________

## Como conferir cada arquivo (nos dois programas)

1. **Abrir** (Arquivo › Abrir). Anotar qualquer mensagem (versão, fonte, unidade, "erros encontrados").
2. **Unidade:** comando `UNITS` → mm. No R12 o arquivo não grava unidade; o programa usa a do modelo — conferir que
   continua mm.
3. **Escala 1:1 e coordenadas:** `DIST` do canto inferior esquerdo ao superior direito do contorno externo; o canto
   inferior esquerdo deve estar em **0,0** (`ID` no vértice). Comparar com o blank da tabela.
4. **Contornos fechados:** selecionar o contorno externo e cada furo → `LIST` / Propriedades: *Fechada = Sim*
   (círculos são fechados por definição).
5. **Duplicados e soltos:** `OVERKILL` com tudo selecionado → deve responder **0 objetos removidos**. `PEDIT` /
   seleção rápida: nenhuma linha solta na camada de corte.
6. **Camadas:** `LAYER` → só CUT_OUTER, CUT_INNER, BEND_UP, BEND_DOWN, BEND_MARK, BEND_REGION, REFERENCE (e 0).
7. **Linhas de dobra:** BEND_UP (cima) / BEND_DOWN (baixo) com a quantidade da tabela; atravessam o blank de borda a
   borda (ou até o recorte).
8. **Textos:** BEND_MARK ("D1 CIMA 90,0° RI2,00": o `%%d` deve aparecer como °) e REFERENCE (nome · blank · dobras).
   Nenhum texto em CUT_*.
9. **Geometria de corte:** furos e recortes no lugar (comparar com a imagem/medidas da peça, se houver).

## Tabela

| Arquivo | Blank esperado (mm) | Camadas (entidades) | ZWCAD | AutoCAD | Escala (medido) | Camadas ok | Observações |
|---|---|---|---|---|---|---|---|
| 01_chapa_furos_R12.dxf | 300.000 × 200.000 | CUT_INNER 6, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |
| 01_chapa_furos_R2000.dxf | 300.000 × 200.000 | CUT_INNER 6, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |
| 02_caixa_dobrada_R12.dxf | 492.985 × 392.985 | BEND_MARK 4, BEND_REGION 8, BEND_UP 4, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |
| 02_caixa_dobrada_R2000.dxf | 492.985 × 392.985 | BEND_MARK 4, BEND_REGION 8, BEND_UP 4, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |
| 03_bandeja_710CUH25_R12.dxf | 574.660 × 559.660 | BEND_MARK 4, BEND_REGION 8, BEND_UP 4, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |
| 03_bandeja_710CUH25_R2000.dxf | 574.660 × 559.660 | BEND_MARK 4, BEND_REGION 8, BEND_UP 4, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |
| 04_tampa_dobras_laterais_R12.dxf | 600.000 × 319.477 | BEND_MARK 4, BEND_REGION 8, BEND_UP 4, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |
| 04_tampa_dobras_laterais_R2000.dxf | 600.000 × 319.477 | BEND_MARK 4, BEND_REGION 8, BEND_UP 4, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |
| 05_caixa_protecao_R12.dxf | 504.739 × 404.739 | BEND_MARK 4, BEND_REGION 8, BEND_UP 4, CUT_INNER 12, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |
| 05_caixa_protecao_R2000.dxf | 504.739 × 404.739 | BEND_MARK 4, BEND_REGION 8, BEND_UP 4, CUT_INNER 12, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |
| 06_multiplas_dobras_R12.dxf | 1000.000 × 175.970 | BEND_DOWN 2, BEND_MARK 4, BEND_REGION 8, BEND_UP 2, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |
| 06_multiplas_dobras_R2000.dxf | 1000.000 × 175.970 | BEND_DOWN 2, BEND_MARK 4, BEND_REGION 8, BEND_UP 2, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |
| 07_alivios_R12.dxf | 300.000 × 199.477 | BEND_MARK 2, BEND_REGION 4, BEND_UP 2, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |
| 07_alivios_R2000.dxf | 300.000 × 199.477 | BEND_MARK 2, BEND_REGION 4, BEND_UP 2, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |
| 08_recortes_perto_dobra_R12.dxf | 400.000 × 236.492 | BEND_MARK 1, BEND_REGION 6, BEND_UP 3, CUT_INNER 4, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |
| 08_recortes_perto_dobra_R2000.dxf | 400.000 × 236.492 | BEND_MARK 1, BEND_REGION 6, BEND_UP 3, CUT_INNER 4, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |
| 09_fechamento_cantos_R12.dxf | 417.111 × 417.111 | BEND_MARK 4, BEND_REGION 8, BEND_UP 4, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |
| 09_fechamento_cantos_R2000.dxf | 417.111 × 417.111 | BEND_MARK 4, BEND_REGION 8, BEND_UP 4, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |
| 10_geometria_complexa_R12.dxf | 354.144 × 243.626 | BEND_MARK 3, BEND_REGION 8, BEND_UP 4, CUT_INNER 2, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |
| 10_geometria_complexa_R2000.dxf | 354.144 × 243.626 | BEND_MARK 3, BEND_REGION 8, BEND_UP 4, CUT_INNER 2, CUT_OUTER 1, REFERENCE 1 | ☐ abre ☐ mm ☐ 1:1 | ☐ abre ☐ mm ☐ 1:1 | DIST: ______ | ☐ ok | |

Resultado: ZWCAD ☐ APROVADO ☐ REPROVADO · AutoCAD ☐ APROVADO ☐ REPROVADO ☐ não disponível (fica PENDENTE)

Assinatura: ______________________
